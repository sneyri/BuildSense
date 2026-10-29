// 2D-план (Canvas 2D): контур дома и построение по нему — фундамент, стены, перекрытие, крыша.
//
// new BS.PlanEditor(container, toolsContainer, api)
//   api = { getProject, getLevelId, getSelected, edit(label, fn), select(ids, additive), setStatus(text, kind) }
//   методы: render(), resize(), destroy().
// Модель меняется только через api.edit (история отмены сохраняется). Ось Y плана — вверх (как в 3D и FreeCAD).
(function (BS) {
  "use strict";
  const U = BS.util;
  const fmt = U.fmt;
  const SNAP_PX = 10;
  const HIT_PX = 8;

  const HINTS = {
    select: "План: перетаскивайте вершины контура, двойной щелчок по ребру — новая вершина, Delete — удалить выбранную вершину. Колесо — масштаб, перетаскивание пустого места — сдвиг.",
    draw: "Контур: щёлкайте по углам дома. Длину ребра можно набрать цифрами и нажать Enter (направление — по курсору, Shift — строго по осям). Замкнуть — щелчок в первую точку или Enter. Esc — отмена.",
  };

  class PlanEditor {
    constructor(container, toolsContainer, api) {
      this.container = container;
      this.toolsEl = toolsContainer || null;
      this.api = api;
      this.mode = "select";
      this.draft = [];
      this.cursor = null;
      this.snapKind = null;
      this.typed = "";
      this.shift = false;
      this.activeId = null;
      this.selVertex = null; // { contourId, index }
      this.drag = null;
      this.preview = null; // { contourId, points } во время перетаскивания вершины
      this.popup = null;
      this.view = { cx: 5, cy: 4, s: 40 };
      this.fitted = false;
      this.opts = null;
      this._toolsSig = "";
      this._tableSig = "";

      this.canvas = document.createElement("canvas");
      this.canvas.className = "plan-canvas";
      this.canvas.tabIndex = 0;
      this.canvas.setAttribute("aria-label", "2D-план: контур дома");
      this.overlay = document.createElement("div");
      this.overlay.className = "plan-overlay";
      this.empty = document.createElement("div");
      this.empty.className = "empty-state plan-empty";
      this.popEl = document.createElement("div");
      this.popEl.className = "plan-pop";
      this.popEl.hidden = true;
      this.table = document.createElement("div");
      this.table.className = "plan-table";
      this.table.hidden = true;
      this.info = document.createElement("div");
      this.info.className = "plan-info";
      this.overlay.append(this.empty, this.popEl, this.table, this.info);
      container.append(this.canvas, this.overlay);

      this._bind();
      this._ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.resize()) : null;
      if (this._ro) this._ro.observe(container);
      this.resize();
    }

    // ---------------------------------------------------------------- данные

    get project() { return this.api.getProject(); }
    get levelId() { return this.api.getLevelId(); }

    contours() {
      return BS.contour ? BS.contour.forLevel(this.project, this.levelId) : [];
    }

    activeContour() {
      const list = this.contours();
      return list.find((c) => c.id === this.activeId) || list[0] || null;
    }

    contourPoints(c) {
      return this.preview && this.preview.contourId === c.id ? this.preview.points : c.points;
    }

    _defaults() {
      const h = this.project.house;
      return {
        found: { type: "slab", thickness: h.foundationThickness, width: 0.5, depth: 1.2 },
        walls: { thickness: h.wallThickness, height: h.wallHeight, material: "brick" },
        slab: { kind: "ground", thickness: h.slabThickness },
        roof: { roofType: h.roofType, slope: h.roofSlope, overhang: h.roofOverhang, material: "metal_tile" },
      };
    }

    // ---------------------------------------------------------------- координаты

    size() {
      return { w: this.canvas.clientWidth || 1, h: this.canvas.clientHeight || 1 };
    }

    toScreen(p) {
      const { w, h } = this.size();
      return { x: w / 2 + (p.x - this.view.cx) * this.view.s, y: h / 2 - (p.y - this.view.cy) * this.view.s };
    }

    toWorld(sx, sy) {
      const { w, h } = this.size();
      return { x: this.view.cx + (sx - w / 2) / this.view.s, y: this.view.cy - (sy - h / 2) / this.view.s };
    }

    eventPoint(e) {
      const r = this.canvas.getBoundingClientRect();
      return { sx: e.clientX - r.left, sy: e.clientY - r.top };
    }

    grid() {
      return this.project.settings.grid || 0.1;
    }

    /** Привязка: вершины контуров и углы элементов (в пределах 10 пикс.), иначе сетка; Shift — по осям от from. */
    snap(world, from = null) {
      let p = { ...world };
      if (from && this.shift) {
        if (Math.abs(p.x - from.x) >= Math.abs(p.y - from.y)) p.y = from.y;
        else p.x = from.x;
      }
      if (this.project.settings.snap === false) return { p, kind: "free" };
      const tol = SNAP_PX / this.view.s;
      let best = null;
      const consider = (q, kind) => {
        const d = Math.hypot(q.x - world.x, q.y - world.y);
        if (d <= tol && (!best || d < best.d)) best = { d, p: { x: q.x, y: q.y }, kind };
      };
      for (const c of this.contours()) for (const q of this.contourPoints(c)) consider(q, "vertex");
      for (const q of this.draft) consider(q, "vertex");
      for (const el of this._levelElements()) {
        if (el.hostId) continue;
        for (const q of BS.shapes.footprint(el, this.project)) consider(q, "corner");
      }
      if (best && !(from && this.shift)) return best;
      const g = this.grid();
      const r = (v) => U.round(Math.round(v / g) * g, 4);
      if (from && this.shift) {
        if (p.y === from.y) p.x = r(p.x); else p.y = r(p.y);
        return { p, kind: "ortho" };
      }
      return { p: { x: r(p.x), y: r(p.y) }, kind: "grid" };
    }

    _levelElements() {
      const p = this.project;
      const lv = BS.project.level(p, this.levelId);
      return p.elements.filter((e) => {
        if (e.levelId === lv.id) return true;
        // Фундаменты видны на нижнем этаже, даже если созданы для другого
        return BS.types.isFoundation(e) && lv.elevation <= Math.min(...p.levels.map((l) => l.elevation)) + 1e-6;
      });
    }

    // ---------------------------------------------------------------- события

    _bind() {
      const cv = this.canvas;
      cv.addEventListener("contextmenu", (e) => e.preventDefault());
      cv.addEventListener("wheel", (e) => {
        e.preventDefault();
        const { sx, sy } = this.eventPoint(e);
        const before = this.toWorld(sx, sy);
        const k = Math.exp(-Math.sign(e.deltaY) * Math.min(0.25, Math.abs(e.deltaY) / 400));
        this.view.s = U.clamp(this.view.s * k, 4, 600);
        const after = this.toWorld(sx, sy);
        this.view.cx += before.x - after.x;
        this.view.cy += before.y - after.y;
        this.draw();
      }, { passive: false });
      cv.addEventListener("pointerdown", (e) => this._down(e));
      cv.addEventListener("pointermove", (e) => this._move(e));
      cv.addEventListener("pointerup", (e) => this._up(e));
      cv.addEventListener("pointerleave", () => { this.cursor = null; this.draw(); });
      cv.addEventListener("dblclick", (e) => this._dbl(e));
      cv.addEventListener("keydown", (e) => this._key(e));
      cv.addEventListener("keyup", (e) => { if (e.key === "Shift") { this.shift = false; this.draw(); } });
      this._docClick = (e) => {
        if (this.popup && !this.popEl.contains(e.target) && !(this.toolsEl && this.toolsEl.contains(e.target))) this._closePopup();
      };
      document.addEventListener("pointerdown", this._docClick);
    }

    _down(e) {
      this.canvas.focus();
      this.shift = e.shiftKey;
      const { sx, sy } = this.eventPoint(e);
      const world = this.toWorld(sx, sy);
      if (e.button === 1 || e.button === 2) { this._startPan(e, sx, sy); return; }
      if (this.mode === "draw") {
        const from = this.draft[this.draft.length - 1] || null;
        const { p } = this.snap(world, from);
        if (this.draft.length >= 3 && this._near(this.draft[0], sx, sy)) return this._finishDraft();
        if (from && Math.hypot(p.x - from.x, p.y - from.y) < 0.05) return;
        this.draft.push(p);
        this.typed = "";
        this.draw();
        return;
      }
      // Выбор: вершина → ребро → элемент → сдвиг вида
      const hitV = this._hitVertex(sx, sy);
      if (hitV) {
        this.activeId = hitV.contour.id;
        this.selVertex = { contourId: hitV.contour.id, index: hitV.index };
        this.drag = { kind: "vertex", contourId: hitV.contour.id, index: hitV.index, sx, sy, moved: false };
        this.canvas.setPointerCapture(e.pointerId);
        this.render();
        return;
      }
      const hitE = this._hitEdge(sx, sy);
      if (hitE) {
        this.activeId = hitE.contour.id;
        this.selVertex = null;
        this.render();
      }
      this.drag = { kind: "click", sx, sy, world, additive: e.shiftKey || e.ctrlKey, edge: !!hitE };
      this.canvas.setPointerCapture(e.pointerId);
    }

    _startPan(e, sx, sy) {
      this.drag = { kind: "pan", sx, sy, cx: this.view.cx, cy: this.view.cy };
      this.canvas.setPointerCapture(e.pointerId);
    }

    _move(e) {
      this.shift = e.shiftKey;
      const { sx, sy } = this.eventPoint(e);
      const world = this.toWorld(sx, sy);
      const d = this.drag;
      if (d && d.kind === "click" && Math.hypot(sx - d.sx, sy - d.sy) > 4) {
        this.drag = { kind: "pan", sx: d.sx, sy: d.sy, cx: this.view.cx, cy: this.view.cy };
      }
      if (this.drag && this.drag.kind === "pan") {
        this.view.cx = this.drag.cx - (sx - this.drag.sx) / this.view.s;
        this.view.cy = this.drag.cy + (sy - this.drag.sy) / this.view.s;
        this.draw();
        return;
      }
      if (d && d.kind === "vertex") {
        const c = BS.contour.get(this.project, d.contourId);
        if (!c) return;
        const pts = c.points.map((q) => ({ ...q }));
        const prev = pts[(d.index + pts.length - 1) % pts.length];
        this.preview = null; // привязка — к другим вершинам, не к самой перетаскиваемой
        const { p, kind } = this.snapExcept(world, prev, d.contourId, d.index);
        pts[d.index] = { ...pts[d.index], x: p.x, y: p.y };
        d.moved = d.moved || Math.hypot(sx - d.sx, sy - d.sy) > 3;
        this.preview = { contourId: c.id, points: pts };
        this.snapKind = kind;
        this.cursor = p;
        this.draw();
        return;
      }
      const from = this.mode === "draw" ? this.draft[this.draft.length - 1] || null : null;
      const s = this.snap(world, from);
      this.cursor = s.p;
      this.snapKind = s.kind;
      this.draw();
    }

    /** Привязка при перетаскивании вершины: без самой вершины. */
    snapExcept(world, from, contourId, index) {
      const c = BS.contour.get(this.project, contourId);
      const saved = c.points;
      c.points = saved.filter((_, i) => i !== index);
      try {
        return this.snap(world, this.shift ? from : null);
      } finally {
        c.points = saved;
      }
    }

    _up(e) {
      const d = this.drag;
      this.drag = null;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* не захвачен */ }
      if (!d) return;
      if (d.kind === "vertex") {
        const pv = this.preview;
        this.preview = null;
        if (d.moved && pv) {
          this.api.edit("Вершина контура", () => {
            const notes = BS.contour.setPoints(this.project, pv.contourId, pv.points);
            const q = pv.points[d.index];
            return `Вершина ${d.index + 1}: (${fmt(q.x)}; ${fmt(q.y)}) м${notes.length ? ". " + notes.join("; ") : ""}`;
          });
        }
        this.render();
        return;
      }
      if (d.kind === "click" && !d.edge) {
        const id = this._hitElement(d.world);
        this.api.select(id ? [id] : [], d.additive);
      }
    }

    _dbl(e) {
      if (this.mode !== "select") return;
      const { sx, sy } = this.eventPoint(e);
      const hit = this._hitEdge(sx, sy);
      if (!hit) return;
      const { p } = this.snap(hit.point);
      this.api.edit("Новая вершина контура", () => {
        const pts = hit.contour.points.map((q) => ({ ...q }));
        pts.splice(hit.index + 1, 0, { x: p.x, y: p.y });
        const notes = BS.contour.setPoints(this.project, hit.contour.id, pts);
        this.selVertex = { contourId: hit.contour.id, index: hit.index + 1 };
        return `Добавлена вершина ${hit.index + 2}. Перетащите её, чтобы изменить форму${notes.length ? ". " + notes.join("; ") : ""}`;
      });
    }

    _key(e) {
      const k = e.key;
      let handled = true;
      if (this.mode === "draw") {
        if (/^[0-9]$/.test(k) || ((k === "." || k === ",") && !this.typed.includes("."))) {
          if (!this.draft.length) { this.api.setStatus("Сначала щёлкните первую точку контура, затем набирайте длину ребра"); }
          else this.typed += k === "," ? "." : k;
        } else if (k === "Backspace") {
          if (this.typed) this.typed = this.typed.slice(0, -1);
          else this.draft.pop();
        } else if (k === "Enter") {
          if (this.typed) this._typedPoint();
          else if (this.draft.length >= 3) this._finishDraft();
          else this.api.setStatus("Для контура нужны хотя бы три точки", "warn");
        } else if (k === "Escape") {
          this.cancelDraft();
        } else if (k === "Shift") {
          this.shift = true;
        } else handled = false;
      } else if ((k === "Delete" || k === "Backspace") && this.selVertex) {
        this._deleteVertex(this.selVertex);
      } else if (k === "Escape" && (this.selVertex || this.popup)) {
        this.selVertex = null;
        this._closePopup();
      } else if (k === "Shift") {
        this.shift = true;
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation(); // горячие клавиши приложения (Del, Esc, V…) не срабатывают поверх плана
        this.render();
      }
    }

    _typedPoint() {
      const len = Number(this.typed);
      this.typed = "";
      const from = this.draft[this.draft.length - 1];
      if (!from || !(len > 0)) return;
      const to = this.cursor || { x: from.x + 1, y: from.y };
      let dx = to.x - from.x, dy = to.y - from.y;
      if (Math.hypot(dx, dy) < 1e-9) { dx = 1; dy = 0; }
      const ang = Math.atan2(dy, dx);
      const step = Math.PI / 2;
      const near = Math.round(ang / step) * step;
      // Shift — строго по осям; без Shift — ось, если курсор в пределах 8°
      const a = this.shift || Math.abs(ang - near) < (8 * Math.PI) / 180 ? near : ang;
      this.draft.push({ x: U.round(from.x + Math.cos(a) * len, 4), y: U.round(from.y + Math.sin(a) * len, 4) });
      this.api.setStatus(`Ребро ${this.draft.length - 1}: ${fmt(len)} м. Наберите длину следующего или щёлкните точку; Enter без числа — замкнуть контур.`);
    }

    _finishDraft() {
      const pts = this.draft.slice();
      this.draft = [];
      this.typed = "";
      this.mode = "select";
      this.api.edit("Контур дома", () => {
        const c = BS.contour.addContour(this.project, pts, { levelId: this.levelId });
        this.activeId = c.id;
        const area = Math.abs(BS.geometry.polygonArea(c.points));
        return `Контур ${c.id}: ${c.points.length} вершин, площадь ${fmt(area, 1)} м². Дальше — «Фундамент» на панели плана.`;
      });
      this.render();
    }

    cancelDraft() {
      this.draft = [];
      this.typed = "";
      this.mode = "select";
      this.api.setStatus("Рисование контура отменено");
      this.render();
    }

    _deleteVertex(sel) {
      const c = BS.contour.get(this.project, sel.contourId);
      if (!c) return;
      if (c.points.length <= 3) { this.api.setStatus("У контура должно остаться не меньше трёх вершин", "warn"); return; }
      this.api.edit("Удаление вершины контура", () => {
        const pts = c.points.filter((_, i) => i !== sel.index);
        const notes = BS.contour.setPoints(this.project, c.id, pts);
        this.selVertex = null;
        return `Вершина ${sel.index + 1} удалена${notes.length ? ". " + notes.join("; ") : ""}`;
      });
    }

    _near(p, sx, sy, px = SNAP_PX) {
      const s = this.toScreen(p);
      return Math.hypot(s.x - sx, s.y - sy) <= px;
    }

    _hitVertex(sx, sy) {
      for (const c of this.contours()) {
        const pts = this.contourPoints(c);
        for (let i = 0; i < pts.length; i++) if (this._near(pts[i], sx, sy, HIT_PX)) return { contour: c, index: i };
      }
      return null;
    }

    _hitEdge(sx, sy) {
      const w = this.toWorld(sx, sy);
      let best = null;
      for (const c of this.contours()) {
        const pts = c.points;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const q = BS.geometry.closestPointOnSegment(w, a, b);
          const d = Math.hypot(q.x - w.x, q.y - w.y) * this.view.s;
          if (d <= 6 && (!best || d < best.d)) best = { d, contour: c, index: i, point: q };
        }
      }
      return best;
    }

    _hitElement(w) {
      const order = (e) => (e.hostId ? 0 : e.type === "wall" ? 1 : BS.types.isFoundation(e) ? 4 : e.type === "slab" ? 3 : e.type === "roof" ? 5 : 2);
      const els = this._levelElements().filter((e) => e.type !== "roof").sort((a, b) => order(a) - order(b));
      for (const el of els) {
        const fp = BS.shapes.footprint(el, this.project);
        if (fp.length >= 3 && BS.geometry.pointInPolygon(w, fp, 2 / this.view.s)) return el.id;
      }
      return null;
    }

    // ---------------------------------------------------------------- команды

    startDraw() {
      this._closePopup();
      this.mode = this.mode === "draw" ? "select" : "draw";
      this.draft = [];
      this.typed = "";
      this.canvas.focus();
      this.api.setStatus(this.mode === "draw" ? HINTS.draw : HINTS.select);
      this.render();
    }

    rectangleFromHouse() {
      const h = this.project.house;
      this.api.edit("Контур-прямоугольник", () => {
        const c = BS.contour.addContour(this.project, BS.contour.rectangle(0, 0, h.length, h.width), { levelId: this.levelId });
        this.activeId = c.id;
        return `Контур ${c.id}: прямоугольник ${fmt(h.length)} × ${fmt(h.width)} м. Вершины можно перетаскивать.`;
      });
      this.fit();
    }

    _needContour() {
      const c = this.activeContour();
      if (!c) { this.api.setStatus("Сначала нарисуйте контур дома: кнопка «Контур» на панели плана", "warn"); return null; }
      return c;
    }

    run(cmd) {
      const C = BS.contour;
      const c = this._needContour();
      if (!c) return;
      const o = this.opts;
      const note = (n) => (n.length ? `. ${n.join("; ")}` : "");
      if (cmd === "found") {
        this.api.edit("Фундамент по контуру", () => {
          const r = C.foundationFromContour(this.project, c.id, o.found);
          return `${o.found.type === "slab" ? "Плитный" : "Ленточный"} фундамент по контуру ${c.id}: элементов ${r.created.length}. Дальше — «Стены»${note(r.notes)}`;
        });
      } else if (cmd === "walls") {
        this.api.edit("Стены по контуру", () => {
          const r = C.wallsFromContour(this.project, c.id, o.walls);
          return `Стены по контуру ${c.id}: ${r.created.length} шт., толщина ${fmt(o.walls.thickness)} м, высота ${fmt(o.walls.height)} м. Дальше — «Перекрытие»${note(r.notes)}`;
        });
      } else if (cmd === "slab") {
        this.api.edit("Перекрытие по контуру", () => {
          const r = C.slabFromContour(this.project, c.id, o.slab);
          return `${o.slab.kind === "ground" ? "Пол внутри стен" : "Перекрытие на верхе стен"}: ${r.created[0].name}. Дальше — «Крыша»${note(r.notes)}`;
        });
      } else if (cmd === "roof") {
        this.api.edit("Крыша по контуру", () => {
          const r = C.roofFromContour(this.project, c.id, o.roof);
          return `Крыша над контуром ${c.id} построена${note(r.notes)}`;
        });
      } else if (cmd === "rebuild") {
        if (!C.linked(this.project, c.id).length) { this.api.setStatus("По контуру ещё ничего не построено — начните с «Фундамента»", "warn"); return; }
        this.api.edit("Перестроить по контуру", () => {
          const r = C.rebuild(this.project, c.id);
          return `Элементы контура ${c.id} перестроены${note(r.notes)}`;
        });
      } else if (cmd === "delete") {
        this.api.edit("Удаление контура", () => {
          C.removeContour(this.project, c.id);
          this.activeId = null;
          return `Контур ${c.id} удалён (построенные элементы остались и больше не перестраиваются)`;
        });
      }
      this._closePopup();
    }

    fit() {
      const pts = [];
      for (const c of this.contours()) pts.push(...c.points);
      for (const el of this._levelElements()) if (!el.hostId) pts.push(...BS.shapes.footprint(el, this.project));
      if (!pts.length) pts.push({ x: 0, y: 0 }, { x: this.project.house.length || 10, y: this.project.house.width || 8 });
      const b = BS.geometry.bbox2(pts);
      const { w, h } = this.size();
      this.view.cx = (b.minX + b.maxX) / 2;
      this.view.cy = (b.minY + b.maxY) / 2;
      this.view.s = U.clamp(Math.min((w - 120) / Math.max(1, b.maxX - b.minX), (h - 100) / Math.max(1, b.maxY - b.minY)), 4, 300);
      this.fitted = true;
      this.draw();
    }

    // ---------------------------------------------------------------- панель команд и всплывающие формы

    _renderTools() {
      if (!this.toolsEl) return;
      const c = this.activeContour();
      const sig = `${this.mode}|${c ? c.id : "-"}|${this.popup || "-"}`;
      if (sig === this._toolsSig && this.toolsEl.childElementCount) return;
      this._toolsSig = sig;
      const btn = (label, icon, title, onclick, active = false) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.title = title;
        if (icon) b.dataset.icon = icon;
        if (active) { b.classList.add("active"); b.setAttribute("aria-pressed", "true"); }
        b.addEventListener("click", onclick);
        return b;
      };
      const seg = document.createElement("div");
      seg.className = "segmented plan-seg";
      seg.setAttribute("role", "group");
      seg.setAttribute("aria-label", "Построение по плану");
      seg.append(
        btn("Контур", "wall-line", "Нарисовать контур дома щелчками по углам", () => this.startDraw(), this.mode === "draw"),
        btn("Фундамент", "rect", "Фундамент по контуру: плита или лента", () => this._togglePopup("found"), this.popup === "found"),
        btn("Стены", "wall-line", "Наружные стены по рёбрам контура", () => this._togglePopup("walls"), this.popup === "walls"),
        btn("Перекрытие", "rect", "Пол внутри стен или перекрытие над этажом", () => this._togglePopup("slab"), this.popup === "slab"),
        btn("Крыша", "dimension", "Крыша над контуром", () => this._togglePopup("roof"), this.popup === "roof"));
      const extra = document.createElement("div");
      extra.className = "segmented plan-seg";
      extra.append(
        btn("Перестроить", null, "Перестроить элементы контура по его текущей форме", () => this.run("rebuild")),
        btn("Вписать", "grid", "Показать весь план", () => this.fit()));
      this.toolsEl.replaceChildren(seg, extra);
      if (BS.icons && BS.icons.apply) { try { BS.icons.apply(this.toolsEl); } catch { /* иконки не критичны */ } }
    }

    _togglePopup(kind) {
      if (this.mode === "draw") this.cancelDraft();
      this.popup = this.popup === kind ? null : kind;
      this.render();
    }

    _closePopup() {
      if (!this.popup) return;
      this.popup = null;
      this.render();
    }

    _renderPopup() {
      const kind = this.popup;
      this.popEl.hidden = !kind;
      if (!kind) { this.popEl.replaceChildren(); this._popSig = ""; return; }
      if (this._popSig === kind && this.popEl.childElementCount) return;
      this._popSig = kind;
      const o = this.opts;
      const D = BS.dom;
      const title = { found: "Фундамент по контуру", walls: "Стены по контуру", slab: "Перекрытие по контуру", roof: "Крыша" }[kind];
      const help = {
        found: "Плита — монолит под всем контуром; лента — полосы под стенами. Верх фундамента — отметка пола этажа, стены встанут на него.",
        walls: "Стены идут по наружной грани контура внутрь. Углы стыкуются встык, без выступов. Повторное нажатие перестроит стены с новыми параметрами (проёмы сохраняются).",
        slab: "Пол — плита внутри стен на фундаменте. Перекрытие — плита на верхе стен этажа по всему контуру (на неё встанет следующий этаж).",
        roof: "Крыша над стенами контура со свесом. Низ крыши — на верхе стен.",
      }[kind];
      const parts = [];
      const num = (label, obj, key, step, unit = "м") => D.numberField({ label, value: obj[key], step, unit, onChange: (v) => { obj[key] = v; } });
      const sel = (label, obj, key, options) => D.selectField({ label, value: obj[key], options, onChange: (v) => { obj[key] = v; if (kind === "found") { this._popSig = ""; this._renderPopup(); } } });
      if (kind === "found") {
        parts.push(sel("Тип", o.found, "type", [{ value: "slab", label: "Плита" }, { value: "strip", label: "Лента" }]));
        if (o.found.type === "slab") parts.push(num("Толщина плиты", o.found, "thickness", 0.05));
        else parts.push(num("Ширина ленты", o.found, "width", 0.05), num("Глубина ленты", o.found, "depth", 0.1));
      } else if (kind === "walls") {
        const wallMats = BS.types.get("wall").materials.map((m) => ({ value: m, label: BS.materials.label(m) }));
        parts.push(num("Толщина", o.walls, "thickness", 0.01), num("Высота", o.walls, "height", 0.05), sel("Материал", o.walls, "material", wallMats));
      } else if (kind === "slab") {
        parts.push(sel("Вид", o.slab, "kind", [{ value: "ground", label: "Пол внутри стен" }, { value: "floor", label: "Перекрытие над этажом" }]), num("Толщина", o.slab, "thickness", 0.01));
      } else if (kind === "roof") {
        const roofMats = BS.types.get("roof").materials.map((m) => ({ value: m, label: BS.materials.label(m) }));
        parts.push(sel("Форма", o.roof, "roofType", [{ value: "gable", label: "Двускатная" }, { value: "hip", label: "Вальмовая" }, { value: "shed", label: "Односкатная" }, { value: "flat", label: "Плоская" }]),
          num("Уклон", o.roof, "slope", 1, "°"), num("Свес", o.roof, "overhang", 0.05), sel("Материал", o.roof, "material", roofMats));
      }
      const go = document.createElement("button");
      go.type = "button";
      go.className = "primary";
      go.textContent = "Построить";
      go.addEventListener("click", () => this.run(kind));
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Закрыть";
      close.addEventListener("click", () => this._closePopup());
      const h = document.createElement("h4");
      h.textContent = title;
      const p = document.createElement("p");
      p.className = "note";
      p.textContent = help;
      const form = document.createElement("div");
      form.className = "form";
      form.append(...parts);
      const row = document.createElement("div");
      row.className = "row-actions";
      row.append(go, close);
      this.popEl.replaceChildren(h, p, form, row);
    }

    /** Таблица вершин активного контура: точный ввод координат, длины рёбер. */
    _renderTable() {
      const c = this.activeContour();
      const show = !!c && this.mode !== "draw";
      this.table.hidden = !show;
      if (!show) { this._tableSig = ""; return; }
      const pts = this.contourPoints(c);
      const sel = this.selVertex && this.selVertex.contourId === c.id ? this.selVertex.index : -1;
      const sig = JSON.stringify([c.id, pts.map((q) => [q.x, q.y]), sel, this._tableOpen !== false]);
      if (sig === this._tableSig || this.table.contains(document.activeElement)) return;
      this._tableSig = sig;
      const el = (tag, attrs = {}, ...kids) => {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
          if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
          else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
        }
        n.append(...kids.filter((x) => x !== null && x !== undefined));
        return n;
      };
      const head = el("header", {},
        el("strong", {}, `Контур ${c.id}`),
        el("span", { class: "note" }, `${fmt(Math.abs(BS.geometry.polygonArea(pts)), 1)} м²`),
        el("button", { type: "button", class: "ghost", title: "Свернуть / развернуть таблицу", onclick: () => { this._tableOpen = this._tableOpen === false; this._tableSig = ""; this._renderTable(); } }, this._tableOpen === false ? "▸" : "▾"));
      if (this._tableOpen === false) { this.table.replaceChildren(head); return; }
      const setXY = (i, key, v) => {
        if (!Number.isFinite(v)) return;
        this.api.edit("Координаты вершины", () => {
          const next = c.points.map((q) => ({ ...q }));
          next[i][key] = U.round(v, 3);
          const notes = BS.contour.setPoints(this.project, c.id, next);
          return `Вершина ${i + 1}: ${key.toUpperCase()} = ${fmt(v, 3)} м${notes.length ? ". " + notes.join("; ") : ""}`;
        });
      };
      const rows = pts.map((q, i) => {
        const nq = pts[(i + 1) % pts.length];
        const len = Math.hypot(nq.x - q.x, nq.y - q.y);
        const inp = (key) => {
          const input = el("input", { type: "number", step: this.grid(), value: String(U.round(q[key], 3)), "aria-label": `${key.toUpperCase()} вершины ${i + 1}` });
          input.addEventListener("change", () => setXY(i, key, Number(input.value)));
          return input;
        };
        return el("tr", { class: i === sel ? "sel" : null, onclick: () => { this.selVertex = { contourId: c.id, index: i }; this.draw(); } },
          el("td", {}, String(i + 1)), el("td", {}, inp("x")), el("td", {}, inp("y")), el("td", { class: "len" }, fmt(len)),
          el("td", {}, el("button", { type: "button", class: "ghost", title: "Удалить вершину", onclick: (ev) => { ev.stopPropagation(); this._deleteVertex({ contourId: c.id, index: i }); } }, "×")));
      });
      const tbl = el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "№"), el("th", {}, "X, м"), el("th", {}, "Y, м"), el("th", {}, "Ребро"), el("th", {}, ""))), el("tbody", {}, ...rows));
      const linkedN = BS.contour.linked(this.project, c.id).length;
      const foot = el("div", { class: "row-actions" },
        el("button", { type: "button", title: "Удалить контур (построенные элементы останутся)", onclick: () => this.run("delete") }, "Удалить контур"));
      const note = el("p", { class: "note" }, linkedN ? `Связано элементов: ${linkedN}. Изменение вершин перестраивает их.` : "По контуру ещё ничего не построено.");
      this.table.replaceChildren(head, tbl, note, foot);
    }

    _renderEmpty() {
      const has = this.contours().length > 0 || this.mode === "draw";
      this.empty.hidden = has;
      if (has || this.empty.childElementCount) return;
      const t = document.createElement("strong");
      t.textContent = "Начните с контура дома";
      const p = document.createElement("p");
      p.textContent = "Нажмите «Контур» и щёлкайте по углам дома (Г-, Т-, П-образный — любой). Замкнуть — щелчок в первую точку или Enter. Длину ребра можно набрать с клавиатуры.";
      const row = document.createElement("div");
      row.className = "row-actions";
      const b1 = document.createElement("button");
      b1.type = "button";
      b1.className = "primary";
      b1.textContent = "Нарисовать контур";
      b1.addEventListener("click", () => this.startDraw());
      const b2 = document.createElement("button");
      b2.type = "button";
      b2.textContent = "Прямоугольник по размерам дома";
      b2.addEventListener("click", () => this.rectangleFromHouse());
      row.append(b1, b2);
      this.empty.replaceChildren(t, p, row);
    }

    // ---------------------------------------------------------------- отрисовка

    render() {
      if (!this.opts) this.opts = this._defaults();
      if (this.activeId && !BS.contour.get(this.project, this.activeId)) this.activeId = null;
      if (this.selVertex && !BS.contour.get(this.project, this.selVertex.contourId)) this.selVertex = null;
      if (!this.fitted && this.canvas.clientWidth > 10) this.fit();
      this._renderTools();
      this._renderPopup();
      this._renderTable();
      this._renderEmpty();
      this.draw();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.dpr = dpr;
      if (!this.fitted && w > 10 && this.api) this.fit();
      else this.draw();
    }

    destroy() {
      if (this._ro) this._ro.disconnect();
      document.removeEventListener("pointerdown", this._docClick);
      this.canvas.remove();
      this.overlay.remove();
      if (this.toolsEl) this.toolsEl.replaceChildren();
    }

    _colors() {
      const cs = getComputedStyle(this.container);
      const v = (n, d) => (cs.getPropertyValue(n) || "").trim() || d;
      return {
        bg: v("--viewport", "#161b22"), line: v("--line", "#30363d"), text: v("--text", "#e6edf3"), muted: v("--muted", "#8b949e"),
        accent: v("--accent", "#3d7dff"), err: v("--err", "#ff5555"), warn: v("--warn", "#ff9900"), ok: v("--ok", "#3fb950"),
        font: v("--font", "system-ui, sans-serif"),
      };
    }

    draw() {
      const ctx = this.canvas.getContext("2d");
      if (!ctx) return;
      const col = this._colors();
      const { w, h } = this.size();
      ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
      ctx.fillStyle = col.bg;
      ctx.fillRect(0, 0, w, h);
      this._drawGrid(ctx, col, w, h);
      this._drawSite(ctx, col);
      this._drawElements(ctx, col);
      this._drawContours(ctx, col);
      this._drawDraft(ctx, col);
      this._drawCursor(ctx, col);
      this._drawScale(ctx, col, w, h);
    }

    _drawGrid(ctx, col, w, h) {
      const s = this.view.s;
      const a = this.toWorld(0, h), b = this.toWorld(w, 0);
      const lines = (step, alpha, width) => {
        if (step * s < 6) return false;
        ctx.strokeStyle = col.muted;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let x = Math.ceil(a.x / step) * step; x <= b.x; x += step) { const p = this.toScreen({ x, y: 0 }); ctx.moveTo(Math.round(p.x) + 0.5, 0); ctx.lineTo(Math.round(p.x) + 0.5, h); }
        for (let y = Math.ceil(a.y / step) * step; y <= b.y; y += step) { const p = this.toScreen({ x: 0, y }); ctx.moveTo(0, Math.round(p.y) + 0.5); ctx.lineTo(w, Math.round(p.y) + 0.5); }
        ctx.stroke();
        ctx.globalAlpha = 1;
        return true;
      };
      const g = this.grid();
      lines(g, 0.12, 1);
      if (!lines(1, 0.25, 1)) lines(5, 0.25, 1);
      lines(5, 0.35, 1);
      // Оси X и Y
      const o = this.toScreen({ x: 0, y: 0 });
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = "#e5534b";
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + 40, o.y); ctx.stroke();
      ctx.strokeStyle = "#3fb950";
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x, o.y - 40); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col.muted;
      ctx.font = `11px ${col.font}`;
      ctx.fillText("X", o.x + 43, o.y + 4);
      ctx.fillText("Y", o.x - 4, o.y - 44);
    }

    _drawSite(ctx, col) {
      const st = this.project.settings.site;
      if (!st) return;
      const a = this.toScreen({ x: st.x, y: st.y + st.width }), b = this.toScreen({ x: st.x + st.length, y: st.y });
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = col.muted;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    _poly(ctx, pts) {
      ctx.beginPath();
      pts.forEach((q, i) => { const p = this.toScreen(q); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.closePath();
    }

    _drawElements(ctx, col) {
      const project = this.project;
      const sel = new Set(this.api.getSelected ? this.api.getSelected() || [] : []);
      const clean = document.body && document.body.classList.contains("clean-view");
      const rank = (e) => (BS.types.isFoundation(e) ? 0 : e.type === "slab" ? 1 : e.type === "room" ? 2 : e.type === "roof" ? 6 : e.hostId ? 5 : e.type === "wall" ? 4 : 3);
      const els = this._levelElements().slice().sort((a, b) => rank(a) - rank(b));
      for (const el of els) {
        const fp = BS.shapes.footprint(el, project);
        if (fp.length < 3) continue;
        const t = BS.types.get(el.type) || {};
        const color = BS.materials.color(el.material);
        const isSel = sel.has(el.id);
        this._poly(ctx, fp);
        if (el.type === "roof") {
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = isSel ? col.accent : col.muted;
          ctx.lineWidth = isSel ? 2 : 1;
          ctx.stroke();
          ctx.setLineDash([]);
          continue;
        }
        if (el.type === "room") {
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = col.muted;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
          if (!clean) {
            const c = BS.shapes.center(el, project), p = this.toScreen(c);
            ctx.fillStyle = col.muted;
            ctx.font = `11px ${col.font}`;
            ctx.textAlign = "center";
            ctx.fillText(`${(el.params && el.params.roomName) || el.name} · ${fmt(el.size.length * el.size.width, 1)} м²`, p.x, p.y);
            ctx.textAlign = "left";
          }
          continue;
        }
        ctx.globalAlpha = t.shape === "opening" ? 0.9 : BS.types.isFoundation(el) ? 0.28 : el.type === "slab" ? 0.22 : 0.85;
        ctx.fillStyle = t.shape === "opening" ? col.bg : color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = isSel ? col.accent : el.type === "wall" ? "rgba(0,0,0,0.55)" : col.muted;
        ctx.lineWidth = isSel ? 2.5 : 1;
        ctx.stroke();
        if (t.shape === "opening") {
          // Окно — двойная линия, дверь — дуга открывания
          const host = project.elements.find((x) => x.id === el.hostId);
          if (host && el.type === "door") {
            const a = BS.geometry.localToWorld(host, el.position.offset, host.size.thickness, 0);
            const r = el.size.width * this.view.s;
            const p = this.toScreen(a);
            const ang = -((host.rotation || 0) * Math.PI) / 180;
            ctx.strokeStyle = col.muted;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, ang - Math.PI / 2, ang, false);
            ctx.stroke();
          } else if (host) {
            const m0 = BS.geometry.localToWorld(host, el.position.offset, host.size.thickness / 2, 0);
            const m1 = BS.geometry.localToWorld(host, el.position.offset + el.size.width, host.size.thickness / 2, 0);
            const p0 = this.toScreen(m0), p1 = this.toScreen(m1);
            ctx.strokeStyle = "#7fb6e0";
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
          }
        }
      }
    }

    _drawContours(ctx, col) {
      const active = this.activeContour();
      for (const c of this.contours()) {
        const pts = this.contourPoints(c);
        const isA = active && c.id === active.id;
        this._poly(ctx, pts);
        ctx.strokeStyle = isA ? col.accent : col.text;
        ctx.globalAlpha = isA ? 1 : 0.6;
        ctx.lineWidth = isA ? 2 : 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        // Размеры рёбер — снаружи контура
        ctx.font = `11px ${col.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len * this.view.s < 30) continue;
          const nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len; // наружу (обход против часовой)
          const off = 14 / this.view.s;
          const m = this.toScreen({ x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off });
          const text = `${fmt(len)} м`;
          const tw = ctx.measureText(text).width + 6;
          ctx.fillStyle = col.bg;
          ctx.globalAlpha = 0.8;
          ctx.fillRect(m.x - tw / 2, m.y - 8, tw, 16);
          ctx.globalAlpha = 1;
          ctx.fillStyle = isA ? col.text : col.muted;
          ctx.fillText(text, m.x, m.y);
        }
        // Вершины
        pts.forEach((q, i) => {
          const p = this.toScreen(q);
          const isSel = this.selVertex && this.selVertex.contourId === c.id && this.selVertex.index === i;
          ctx.fillStyle = isSel ? col.accent : col.bg;
          ctx.strokeStyle = isA ? col.accent : col.text;
          ctx.lineWidth = 1.5;
          ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
          ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
          if (isA) {
            ctx.fillStyle = col.muted;
            ctx.fillText(String(i + 1), p.x + 10, p.y - 10);
          }
        });
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
      }
    }

    _drawDraft(ctx, col) {
      if (this.mode !== "draw" || !this.draft.length) return;
      ctx.strokeStyle = col.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.draft.forEach((q, i) => { const p = this.toScreen(q); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.stroke();
      const last = this.draft[this.draft.length - 1];
      for (const q of this.draft) {
        const p = this.toScreen(q);
        ctx.fillStyle = col.accent;
        ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
      }
      const first = this.toScreen(this.draft[0]);
      if (this.draft.length >= 3) {
        ctx.strokeStyle = col.ok;
        ctx.beginPath();
        ctx.arc(first.x, first.y, SNAP_PX, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (this.cursor) {
        const a = this.toScreen(last), b = this.toScreen(this.cursor);
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = col.accent;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
        const len = Math.hypot(this.cursor.x - last.x, this.cursor.y - last.y);
        const label = this.typed ? `длина: ${this.typed.replace(".", ",")} м ↵` : `${fmt(len)} м`;
        ctx.font = `12px ${col.font}`;
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = this.typed ? col.accent : col.bg;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(b.x + 12, b.y + 10, tw, 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = this.typed ? "#fff" : col.text;
        ctx.fillText(label, b.x + 17, b.y + 23);
      }
    }

    _drawCursor(ctx, col) {
      if (!this.cursor || (this.mode !== "draw" && !this.drag)) return;
      const p = this.toScreen(this.cursor);
      ctx.strokeStyle = this.snapKind === "vertex" || this.snapKind === "corner" ? col.ok : col.accent;
      ctx.lineWidth = 1.5;
      if (this.snapKind === "vertex" || this.snapKind === "corner") {
        ctx.strokeRect(p.x - 6, p.y - 6, 12, 12);
      } else {
        ctx.beginPath();
        ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x + 8, p.y);
        ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x, p.y + 8);
        ctx.stroke();
      }
      ctx.fillStyle = col.muted;
      ctx.font = `11px ${col.font}`;
      ctx.fillText(`${fmt(this.cursor.x)}; ${fmt(this.cursor.y)}`, p.x + 10, p.y - 10);
    }

    _drawScale(ctx, col, w, h) {
      const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
      const m = steps.find((x) => x * this.view.s >= 60) || 50;
      const px = m * this.view.s;
      const x0 = 12, y0 = h - 14;
      ctx.strokeStyle = col.text;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 2); ctx.moveTo(x0 + px, y0 - 4); ctx.lineTo(x0 + px, y0 + 2); ctx.stroke();
      ctx.fillStyle = col.text;
      ctx.font = `11px ${col.font}`;
      ctx.fillText(`${fmt(m)} м · сетка ${fmt(this.grid())} м`, x0 + px + 8, y0 + 4);
    }
  }

  BS.PlanEditor = PlanEditor;
})(globalThis.BuildSense);
