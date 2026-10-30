// Инструменты построения мышью. Модуль только показывает предпросмотр и сообщает о действии
// через обработчики (cb); изменение проекта, история и проверки — в app.js.
//
// Виды инструментов (по типу объекта, см. KIND):
//   line    — по двум точкам, цепочкой (стены, ленточный фундамент, балки, перила, трубы…);
//   rect    — прямоугольник по двум углам (плиты, пол, терраса, комната);
//   point   — щелчок в точку (колонны, опоры, лестница, мебель, сантехника); R — поворот на 90°;
//   opening — щелчок по стене (окно, дверь);
//   select  — выбор; выбранный элемент перетаскивается с привязками.
(function (BS) {
  "use strict";
  const T = THREE;
  const G = BS.geometry;
  const P = BS.project;
  const fmt = BS.util.fmt;

  const KIND = {
    wall: "line", strip_foundation: "line", beam: "line", truss: "line", railing: "line", pipe: "line", decor: "line",
    slab_foundation: "rect", slab: "rect", terrace: "rect", room: "rect", landing: "rect",
    window: "opening", door: "opening",
  };
  const kindOf = (type) => KIND[type] || "point";

  const HINTS = {
    select: "Выбор: щёлкните объект. Выбранный объект можно перетащить мышью — он прилипнет к углам и граням соседей.",
    line: "Щёлкните начало и конец. Построение идёт цепочкой, Esc — закончить. Привязки: углы, грани, оси X/Y, сетка.",
    rect: "Щёлкните два противоположных угла.",
    point: "Щёлкните место установки. R — повернуть на 90°. Объект встанет на перекрытие или фундамент под ним.",
    opening: "Наведите на стену и щёлкните.",
  };
  const SNAP_COLORS = { corner: 0xff3d71, edge: 0xff9f1a, ortho: 0x4c8dff, grid: 0x9aa5b1, free: 0x9aa5b1 };
  const STEP = 0.05;

  class Tools {
    /**
     * cb: getProject, getSelected, getLevelId, getSnap → {enabled, grid}, getWallCategory,
     *     onCreate(kind, type, args) → boolean, onMove(id, dx, dy), onMoveOpening(id, offset, elevation), onHint(text)
     */
    constructor(view, cb) {
      this.view = view;
      this.cb = cb;
      this.tool = "select";
      this.type = null;
      this.first = null;
      this.drag = null;
      this.down = null;
      this.rotation = 0;

      this.label = document.createElement("div");
      this.label.className = "measure";
      this.label.hidden = true;
      view.container.append(this.label);

      this.marker = new T.Mesh(new T.RingGeometry(0.1, 0.18, 24), new T.MeshBasicMaterial({ color: SNAP_COLORS.grid, depthTest: false, transparent: true }));
      this.marker.renderOrder = 10;
      this.marker.visible = false;
      this.preview = new T.Mesh(new T.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5),
        new T.MeshStandardMaterial({ color: 0x4c8dff, transparent: true, opacity: 0.45, depthWrite: false }));
      this.preview.visible = false;
      view.overlay.add(this.marker, this.preview);

      const c = view.container;
      c.addEventListener("pointerdown", (e) => this._down(e), { capture: true });
      c.addEventListener("pointermove", (e) => this._move(e));
      c.addEventListener("pointerup", (e) => this._up(e));
      c.addEventListener("pointerleave", () => { if (!this.drag) this._hide(); });
    }

    /** Повернуть размещаемый объект на 90° (горячая клавиша R из BS.hotkeys). Возвращает true, если инструмент размещения активен. */
    rotateStep() {
      if (this.tool !== "point") return false;
      this.rotation = (this.rotation + 90) % 360;
      this.cb.onHint(`${HINTS.point} Поворот: ${this.rotation}°.`);
      return true;
    }

    /** tool: "select" или тип объекта из реестра. */
    setTool(typeOrSelect) {
      this.cancel(true);
      if (typeOrSelect === "select") {
        this.tool = "select";
        this.type = null;
      } else {
        this.type = typeOrSelect;
        this.tool = kindOf(typeOrSelect);
      }
      this.view.pickEnabled = this.tool === "select";
      this.view.renderer.domElement.style.cursor = this.tool === "select" ? "" : "crosshair";
      const t = this.type && BS.types.get(this.type);
      this.cb.onHint(t ? `${t.label}: ${HINTS[this.tool]} ${t.hint || ""}` : HINTS.select);
    }

    cancel(silent = false) {
      const had = Boolean(this.first || this.drag);
      if (this.drag) this._endDrag(false);
      this.first = null;
      this._hide();
      if (!silent && had) this.setTool(this.type || "select");
      return had;
    }

    _onCanvas(e) {
      return e.target === this.view.renderer.domElement;
    }

    // ---------------------------------------------------------------- события

    _down(e) {
      if (e.button !== 0 || !e.isPrimary || !this._onCanvas(e)) { this.down = null; return; } // второй палец (щипок) — не клик
      this.down = { x: e.clientX, y: e.clientY };
      if (this.tool !== "select") return;
      const sel = this.cb.getSelected();
      if (!sel) return;
      const hit = this.view.pickDetailed(e.clientX, e.clientY);
      if (hit && hit.elementId === sel) this._startDrag(hit, e);
    }

    _move(e) {
      if (this.drag) return this._dragMove(e);
      if (this.tool === "select" || !this._onCanvas(e)) return;
      if (this.tool === "opening") return this._hoverOpening(e);
      return this._hoverPlan(e);
    }

    _up(e) {
      if (this.drag) return this._endDrag(true);
      if (e.button !== 0 || !this.down || !this._onCanvas(e)) return;
      const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      this.down = null;
      if (moved > 4 || this.tool === "select") return;
      if (this.tool === "opening") this._clickOpening(e);
      else this._clickPlan(e);
    }

    // ---------------------------------------------------------------- точки на плане

    _snapped(e) {
      const hit = this.view.pickDetailed(e.clientX, e.clientY);
      const project = this.cb.getProject();
      const lv = P.level(project, this.cb.getLevelId());
      let p = hit && hit.elementType !== "roof" ? hit.point : null;
      if (!p) p = this.view.pointOnPlane(e.clientX, e.clientY, null, lv.elevation);
      if (!p) return null;
      const snap = this.cb.getSnap();
      const tol = Math.min(0.6, Math.max(0.08, this.view.worldPerPixel(p) * 12));
      const res = BS.snapping.snapPoint(project, { x: p.x, y: p.y }, { from: this.tool === "line" ? this.first : null, tol, grid: snap.grid, enabled: snap.enabled });
      if (res && hit && hit.elementType !== "roof") res.hitZ = hit.point.z; // высота, на которую реально указывает курсор
      return res;
    }

    /** Этаж, на уровне которого находится курсор (если он указывает на стену другого этажа). */
    _otherLevelAt(hitZ, lv) {
      if (hitZ == null) return null;
      const project = this.cb.getProject();
      const at = project.levels.find((l) => hitZ >= l.elevation - 0.05 && hitZ <= l.elevation + l.height + 0.25);
      return at && at.id !== lv.id ? at : null;
    }

    _hoverPlan(e) {
      const s = this._snapped(e);
      if (!s) return;
      const project = this.cb.getProject();
      const levelId = this.cb.getLevelId();
      const z = BS.support.supportLevel(project, [s], { below: P.level(project, levelId).elevation + 0.35, fallback: P.level(project, levelId).elevation });
      this._marker(s, z);
      const kind = BS.snapping.KIND_LABELS[s.kind] ? ` · ${BS.snapping.KIND_LABELS[s.kind]}` : "";
      const other = this._otherLevelAt(s.hitZ, P.level(project, levelId));
      if (other) {
        this.preview.visible = false;
        this._label({ x: s.x, y: s.y, z }, `курсор на этаже «${other.name}», а активен «${P.level(project, levelId).name}» — переключите этаж слева`);
        return;
      }
      try {
        if (this.tool === "point") {
          const spec = P.planPoint(project, this.type, s, { levelId, rotation: this.rotation });
          const cyl = BS.types.get(this.type).shape === "cylinder";
          const at = cyl ? { ...spec, position: { ...spec.position, x: spec.position.x - spec.size.diameter / 2, y: spec.position.y - spec.size.diameter / 2 } } : spec;
          this._boxPreview(at, previewSize(this.type, spec.size));
          this._label({ x: s.x, y: s.y, z: spec.position.z + (spec.size.height || 0.5) }, `${BS.types.label(this.type)}${kind}`);
          return;
        }
        if (!this.first) { this.preview.visible = false; this._label({ x: s.x, y: s.y, z }, kind ? `привязка: ${kind.slice(3)}` : ""); return; }
        if (this.tool === "line") {
          const spec = this.type === "wall"
            ? P.planWall(project, this.first, s, { levelId, category: this.cb.getWallCategory() })
            : P.planSegment(project, this.type, this.first, s, { levelId });
          const L = spec.size.length;
          if (L < 0.05) return;
          const w = spec.size.thickness || spec.size.width || spec.size.diameter;
          const h = spec.size.height || spec.size.diameter;
          this._boxPreview(spec, [L, w, h], L < 0.2 ? 0xff4d4d : 0x4c8dff, spec.size.diameter ? -w / 2 : 0);
          const cat = spec.category ? ` · ${BS.types.get("wall").categories[spec.category].toLowerCase()}` : "";
          const top = G.localToWorld(spec, L / 2, w / 2, h);
          this._label(top, `${fmt(L)} м${cat}${kind}`);
        } else {
          const spec = P.planRect(project, this.type, this.first, s, { levelId });
          if (spec.size.length < 0.01 || spec.size.width < 0.01) return;
          this._boxPreview(spec, [spec.size.length, spec.size.width, spec.size.height], 0x4c8dff);
          this._label({ x: spec.position.x + spec.size.length / 2, y: spec.position.y + spec.size.width / 2, z: spec.position.z + spec.size.height },
            `${fmt(spec.size.length)} × ${fmt(spec.size.width)} м = ${fmt(spec.size.length * spec.size.width, 1)} м²`);
        }
      } catch {
        /* предпросмотр не критичен */
      }
    }

    _clickPlan(e) {
      const s = this._snapped(e);
      if (!s) return;
      const pt = { x: s.x, y: s.y };
      if (this.tool === "point") {
        this.cb.onCreate("point", this.type, { point: pt, rotation: this.rotation });
        return;
      }
      if (!this.first) {
        this.first = pt;
        this.cb.onHint(this.tool === "line" ? "Щёлкните конец. Esc — закончить." : "Щёлкните противоположный угол. Esc — отмена.");
        return;
      }
      if (this.tool === "line") {
        const ok = this.cb.onCreate("line", this.type, { p1: this.first, p2: pt, category: this.cb.getWallCategory() });
        if (ok) this.first = pt;
      } else {
        this.cb.onCreate("rect", this.type, { a: this.first, b: pt });
        this.first = null;
        this.preview.visible = false;
      }
    }

    // ---------------------------------------------------------------- проёмы

    _openingAt(e) {
      const hit = this.view.pickDetailed(e.clientX, e.clientY, { types: ["wall"] });
      if (!hit) return null;
      const project = this.cb.getProject();
      const wall = project.elements.find((w) => w.id === hit.elementId);
      if (!wall) return null;
      const t = BS.types.get(this.type);
      const width = Math.min(t.size.width, wall.size.length);
      const height = Math.min(t.size.height, wall.size.height - t.sill);
      const { u } = G.worldToLocal(wall, hit.point.x, hit.point.y);
      const offset = Math.min(Math.max(0, Math.round((u - width / 2) / STEP) * STEP), wall.size.length - width);
      return { wall, offset, width, height, sill: t.sill };
    }

    _hoverOpening(e) {
      const o = this._openingAt(e);
      if (!o) { this._hide(); return; }
      const origin = G.localToWorld(o.wall, o.offset, -0.01, o.sill);
      this._boxPreview({ position: origin, rotation: o.wall.rotation }, [o.width, o.wall.size.thickness + 0.02, o.height], this.type === "door" ? 0xb07a45 : 0x7fb6e0);
      this.marker.visible = false;
      this._label(G.localToWorld(o.wall, o.offset + o.width / 2, 0, o.sill + o.height), `${o.wall.name} · отступ ${fmt(o.offset)} м`);
    }

    _clickOpening(e) {
      const o = this._openingAt(e);
      if (!o) { this.cb.onHint("Щёлкните именно по стене: окна и двери ставятся только в стены."); return; }
      this.cb.onCreate("opening", this.type, { wallId: o.wall.id, offset: o.offset });
    }

    // ---------------------------------------------------------------- перетаскивание

    _startDrag(hit, e) {
      const project = this.cb.getProject();
      const el = project.elements.find((x) => x.id === hit.elementId);
      const obj = el && this.view.objectOf(el.id);
      if (!obj) return;
      const hostedObjs = project.elements.filter((o) => o.hostId === el.id || (o.params && o.params.hostWallId === el.id))
        .map((o) => this.view.objectOf(o.id)).filter(Boolean);
      const d = { el, obj, hosted: hostedObjs, origin: obj.position.clone(), hostedOrigins: hostedObjs.map((h) => h.position.clone()), result: null };
      if (el.hostId) {
        const host = project.elements.find((w) => w.id === el.hostId);
        if (!host) return;
        const ax = G.axes(host);
        d.host = host;
        d.plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(ax.vx, ax.vy, 0), new T.Vector3(host.position.x, host.position.y, 0));
        const p = this.view.pointOnPlane(e.clientX, e.clientY, d.plane);
        if (!p) return;
        d.start = { u: G.worldToLocal(host, p.x, p.y).u, w: p.z - host.position.z };
      } else {
        d.plane = new T.Plane(new T.Vector3(0, 0, 1), -hit.point.z);
        const p = this.view.pointOnPlane(e.clientX, e.clientY, d.plane);
        if (!p) return;
        d.start = { x: p.x, y: p.y };
      }
      this.drag = d;
      this.view.controls.enabled = false;
    }

    _dragMove(e) {
      const d = this.drag;
      const p = this.view.pointOnPlane(e.clientX, e.clientY, d.plane);
      if (!p) return;
      const project = this.cb.getProject();
      const snap = this.cb.getSnap();
      if (d.host) {
        const { u } = G.worldToLocal(d.host, p.x, p.y);
        const w = p.z - d.host.position.z;
        const r = (v) => (snap.enabled ? Math.round(v / STEP) * STEP : v);
        const offset = Math.min(Math.max(0, r(d.el.position.offset + u - d.start.u)), d.host.size.length - d.el.size.width);
        const elevation = d.el.type === "door" ? d.el.position.elevation
          : Math.min(Math.max(0, r(d.el.position.elevation + w - d.start.w)), d.host.size.height - d.el.size.height);
        const o = G.localToWorld(d.host, offset, 0, elevation);
        d.obj.position.set(o.x, o.y, o.z);
        d.result = { offset, elevation };
        this._label({ ...o, z: o.z + d.el.size.height }, `отступ ${fmt(offset)} м · низ ${fmt(elevation)} м`);
        return;
      }
      const tol = Math.min(0.6, Math.max(0.08, this.view.worldPerPixel(p) * 12));
      const s = BS.snapping.snapMove(project, d.el, p.x - d.start.x, p.y - d.start.y, { tol, grid: snap.grid, enabled: snap.enabled });
      d.obj.position.set(d.origin.x + s.dx, d.origin.y + s.dy, d.origin.z);
      d.hosted.forEach((h, i) => h.position.set(d.hostedOrigins[i].x + s.dx, d.hostedOrigins[i].y + s.dy, d.hostedOrigins[i].z));
      d.result = { dx: s.dx, dy: s.dy };
      const kind = BS.snapping.KIND_LABELS[s.kind] ? ` · ${BS.snapping.KIND_LABELS[s.kind]}` : "";
      this._label({ x: d.obj.position.x, y: d.obj.position.y, z: d.obj.position.z + 0.5 }, `Δx ${fmt(s.dx)} · Δy ${fmt(s.dy)} м${kind}`);
    }

    _endDrag(apply) {
      const d = this.drag;
      this.drag = null;
      this.view.controls.enabled = true;
      this.label.hidden = true;
      if (!apply || !d.result) {
        d.obj.position.copy(d.origin);
        d.hosted.forEach((h, i) => h.position.copy(d.hostedOrigins[i]));
        return;
      }
      if (d.host) {
        if (d.result.offset !== d.el.position.offset || d.result.elevation !== d.el.position.elevation) this.cb.onMoveOpening(d.el.id, d.result.offset, d.result.elevation);
      } else if (Math.abs(d.result.dx) > 1e-6 || Math.abs(d.result.dy) > 1e-6) {
        this.cb.onMove(d.el.id, d.result.dx, d.result.dy);
      }
    }

    // ---------------------------------------------------------------- предпросмотр

    _marker(s, z) {
      this.marker.visible = true;
      this.marker.position.set(s.x, s.y, z + 0.01);
      this.marker.material.color.setHex(SNAP_COLORS[s.kind] || SNAP_COLORS.grid);
    }

    /** Полупрозрачный брус [a, b, c] в осях spec (position — угол, rotation — поворот вокруг Z). */
    _boxPreview(spec, [a, b, c], color = 0x4c8dff, dv = 0) {
      const m = this.preview;
      m.visible = true;
      m.material.color.setHex(color);
      m.scale.set(Math.max(a, 0.01), Math.max(b, 0.01), Math.max(c, 0.01));
      const o = G.localToWorld({ position: spec.position, rotation: spec.rotation || 0 }, 0, dv, 0);
      m.position.set(o.x, o.y, o.z);
      m.rotation.set(0, 0, ((spec.rotation || 0) * Math.PI) / 180);
    }

    _label(point, text) {
      if (!text) { this.label.hidden = true; return; }
      const s = this.view.toScreen(new T.Vector3(point.x, point.y, point.z));
      this.label.hidden = !s.visible;
      this.label.textContent = text;
      this.label.style.left = `${s.x}px`;
      this.label.style.top = `${s.y}px`;
    }

    _hide() {
      this.preview.visible = false;
      this.marker.visible = false;
      this.label.hidden = true;
    }
  }

  function previewSize(type, size) {
    const t = BS.types.get(type);
    if (t.shape === "cylinder") return [size.diameter, size.diameter, size.height];
    return [size.length, size.width, size.height || 0.3];
  }

  BS.Tools = Tools;
  BS.toolKind = kindOf;
})(globalThis.BuildSense);
