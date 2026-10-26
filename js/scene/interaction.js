// Инструменты построения мышью: стены (цепочкой), фундамент и пол (прямоугольником),
// окна и двери (щелчком по стене), перетаскивание выбранного элемента с привязками.
// Модуль ничего не меняет в проекте сам — он вызывает обработчики из main.js.
import * as THREE from "three";
import { SNAP_KIND_LABELS, snapMove, snapPoint, snapTargets } from "../model/snapping.js";
import { DEG, wallAxes, wallLocalToWorld, worldToLocal } from "../model/placement.js";
import { planWall } from "../model/project.js";
import { supportLevel } from "../model/support.js";

export const TOOL_HINTS = {
  select: "Выбор: щёлкните элемент. Выбранный элемент можно перетащить мышью — он «прилипнет» к углам и граням соседей.",
  wall: "Стена: щёлкните начало, затем конец. Стены рисуются цепочкой, Esc — закончить. Магнит: углы, грани, оси X/Y, сетка 10 см.",
  foundation: "Фундамент: щёлкните два противоположных угла. Стены, поставленные сверху, сядут на него автоматически.",
  floor: "Пол: щёлкните два противоположных угла. Пол ляжет на фундамент под ним.",
  window: "Окно: наведите на стену и щёлкните. Подоконник — 0,9 м.",
  door: "Дверь: наведите на стену и щёлкните.",
};

const OPENING_SIZE = { window: { width: 1.5, height: 1.4, elevation: 0.9 }, door: { width: 0.9, height: 2.1, elevation: 0 } };
const SNAP_COLORS = { corner: 0xff3d71, edge: 0xff9f1a, ortho: 0x2f6fff, grid: 0x5b6b7a };
const STEP = 0.05; // м: шаг перемещения проёмов
const DRAGGABLE = ["wall", "floor", "foundation", "roof", "window", "door"];

const fmt = (v, d = 2) => String(Math.round(v * 10 ** d) / 10 ** d).replace(".", ",");

export class Interaction {
  /**
   * @param {import("./sceneView.js").SceneView} view
   * @param {object} cb обработчики: getProject, getSelected, getWallCategory, onCreateWall(p1, p2), onCreateRect(type, a, b),
   *   onPlaceOpening(type, wallId, offset), onMove(id, dx, dy), onMoveOpening(id, offset, elevation), onHint(text)
   */
  constructor(view, cb) {
    this.view = view;
    this.cb = cb;
    this.tool = "select";
    this.first = null;
    this.drag = null;
    this.down = null;

    this.label = document.createElement("div");
    this.label.className = "measure";
    this.label.hidden = true;
    view.container.append(this.label);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.2, 24),
      new THREE.MeshBasicMaterial({ color: SNAP_COLORS.grid, depthTest: false, transparent: true })
    );
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    view.overlay.add(this.marker);

    this.preview = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x2f6fff, transparent: true, opacity: 0.45, depthWrite: false })
    );
    this.preview.visible = false;
    view.overlay.add(this.preview);

    const c = view.container;
    c.addEventListener("pointerdown", (e) => this._down(e), { capture: true });
    c.addEventListener("pointermove", (e) => this._move(e));
    c.addEventListener("pointerup", (e) => this._up(e));
    c.addEventListener("pointerleave", () => { if (!this.drag) this._hidePreview(); });
  }

  setTool(tool) {
    this.cancel(true);
    this.tool = tool;
    this.view.pickEnabled = tool === "select";
    this.view.renderer.domElement.style.cursor = tool === "select" ? "" : "crosshair";
    this.cb.onHint(TOOL_HINTS[tool]);
  }

  /** Esc: прервать текущее построение. Возвращает true, если было что прерывать. */
  cancel(silent = false) {
    const had = Boolean(this.first || this.drag);
    if (this.drag) this._endDrag(false);
    this.first = null;
    this._hidePreview();
    if (!silent && had) this.cb.onHint(TOOL_HINTS[this.tool]);
    return had;
  }

  // ---------------------------------------------------------------- события

  _down(e) {
    if (e.button !== 0) return;
    this.down = { x: e.clientX, y: e.clientY };
    if (this.tool !== "select") return;
    const selected = this.cb.getSelected();
    if (!selected) return;
    const hit = this.view.pickDetailed(e.clientX, e.clientY);
    if (!hit || hit.elementId !== selected || !DRAGGABLE.includes(hit.elementType)) return;
    this._startDrag(hit, e);
  }

  _move(e) {
    if (this.drag) return this._dragMove(e);
    if (this.tool === "select") return;
    if (this.tool === "wall") return this._hoverWall(e);
    if (this.tool === "foundation" || this.tool === "floor") return this._hoverRect(e);
    if (this.tool === "window" || this.tool === "door") return this._hoverOpening(e);
  }

  _up(e) {
    if (this.drag) return this._endDrag(true);
    if (e.button !== 0 || !this.down) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
    this.down = null;
    if (moved > 4 || this.tool === "select") return; // перетаскивание камеры, а не щелчок
    if (this.tool === "wall") this._clickWall(e);
    else if (this.tool === "foundation" || this.tool === "floor") this._clickRect(e);
    else this._clickOpening(e);
  }

  // ---------------------------------------------------------------- стены

  _snapped(e) {
    const p = this.view.pointOnPlane(e.clientX, e.clientY, null, 0);
    if (!p) return null;
    const project = this.cb.getProject();
    const tol = this._worldTolerance(p);
    return snapPoint(project, { x: p.x, y: p.y }, { from: this.first, tol, targets: snapTargets(project) });
  }

  /** Допуск привязки ~12 px на экране, но в пределах 0,08–0,6 м. */
  _worldTolerance(p) {
    const d = this.view.camera.position.distanceTo(p);
    const px = this.view.renderer.domElement.clientHeight || 600;
    const worldPerPx = (2 * d * Math.tan((this.view.camera.fov * DEG) / 2)) / px;
    return Math.min(0.6, Math.max(0.08, worldPerPx * 12));
  }

  _hoverWall(e) {
    const s = this._snapped(e);
    if (!s) return;
    const project = this.cb.getProject();
    const z = supportLevel(project, [s]);
    this._showMarker(s, z);
    if (!this.first) {
      this._showLabel(new THREE.Vector3(s.x, s.y, z), SNAP_KIND_LABELS[s.kind] ? `привязка: ${SNAP_KIND_LABELS[s.kind]}` : "", e);
      return;
    }
    const spec = planWall(project, this.first, s, { category: this.cb.getWallCategory() });
    const len = spec.size.length;
    if (len < 0.05) return;
    this._placeBoxPreview(spec, spec.size.length, spec.size.thickness, spec.size.height, len < 0.2 ? 0xff3d3d : 0x2f6fff);
    const top = wallLocalToWorld(spec, len / 2, spec.size.thickness / 2, spec.size.height);
    const kind = SNAP_KIND_LABELS[s.kind] ? ` · ${SNAP_KIND_LABELS[s.kind]}` : "";
    const cat = spec.category === "interior" ? "перегородка" : "наружная";
    this._showLabel(new THREE.Vector3(top.x, top.y, top.z), `${fmt(len)} м · ${cat}${kind}`, e);
  }

  _clickWall(e) {
    const s = this._snapped(e);
    if (!s) return;
    if (!this.first) {
      this.first = { x: s.x, y: s.y };
      this.cb.onHint("Стена: щёлкните конец стены. Esc — отменить.");
      return;
    }
    const ok = this.cb.onCreateWall(this.first, { x: s.x, y: s.y }, this.cb.getWallCategory());
    if (ok) this.first = { x: s.x, y: s.y }; // продолжаем цепочку от конца новой стены
    this.cb.onHint("Стена создана. Щёлкните конец следующей стены или нажмите Esc.");
  }

  // ---------------------------------------------------------------- фундамент и пол

  _hoverRect(e) {
    const s = this._snapped(e);
    if (!s) return;
    const project = this.cb.getProject();
    const isFoundation = this.tool === "foundation";
    this._showMarker(s, isFoundation ? 0 : supportLevel(project, [s], { types: ["foundation"] }));
    if (!this.first) {
      this._showLabel(new THREE.Vector3(s.x, s.y, 0), SNAP_KIND_LABELS[s.kind] ? `привязка: ${SNAP_KIND_LABELS[s.kind]}` : "", e);
      return;
    }
    const a = this.first;
    const x0 = Math.min(a.x, s.x), y0 = Math.min(a.y, s.y);
    const L = Math.abs(s.x - a.x), W = Math.abs(s.y - a.y);
    if (L < 0.01 || W < 0.01) return;
    const h = project.house;
    const center = { x: x0 + L / 2, y: y0 + W / 2 };
    const z = isFoundation ? -h.foundationThickness : supportLevel(project, [center], { types: ["foundation"] });
    const t = isFoundation ? h.foundationThickness : h.floorThickness;
    this._placeBoxPreview({ position: { x: x0, y: y0, z }, rotation: 0 }, L, W, t, isFoundation ? 0x8a8f96 : 0x2f6fff);
    this._showLabel(new THREE.Vector3(center.x, center.y, z + t), `${fmt(L)} × ${fmt(W)} м`, e);
  }

  _clickRect(e) {
    const s = this._snapped(e);
    if (!s) return;
    if (!this.first) {
      this.first = { x: s.x, y: s.y };
      this.cb.onHint(`${this.tool === "foundation" ? "Фундамент" : "Пол"}: щёлкните противоположный угол. Esc — отменить.`);
      return;
    }
    this.cb.onCreateRect(this.tool, this.first, { x: s.x, y: s.y });
    this.first = null;
    this._hidePreview();
    this.cb.onHint(TOOL_HINTS[this.tool]);
  }

  // ---------------------------------------------------------------- окна и двери

  _openingAt(e) {
    const hit = this.view.pickDetailed(e.clientX, e.clientY, { types: ["wall"] });
    if (!hit) return null;
    const project = this.cb.getProject();
    const wall = project.elements.find((w) => w.id === hit.elementId);
    if (!wall) return null;
    const size = { ...OPENING_SIZE[this.tool] };
    size.width = Math.min(size.width, wall.size.length);
    size.height = Math.min(size.height, wall.size.height - size.elevation);
    const { u } = worldToLocal(wall, hit.point.x, hit.point.y);
    const offset = Math.min(Math.max(0, Math.round((u - size.width / 2) / STEP) * STEP), wall.size.length - size.width);
    return { wall, offset, size };
  }

  _hoverOpening(e) {
    const o = this._openingAt(e);
    if (!o) return this._hidePreview();
    const { wall, offset, size } = o;
    const origin = wallLocalToWorld(wall, offset, -0.01, size.elevation);
    this._placeBoxPreview({ position: origin, rotation: wall.rotation }, size.width, wall.size.thickness + 0.02, size.height,
      this.tool === "door" ? 0x7a4a24 : 0x7fb6e0);
    this.marker.visible = false;
    const top = wallLocalToWorld(wall, offset + size.width / 2, 0, size.elevation + size.height);
    this._showLabel(new THREE.Vector3(top.x, top.y, top.z), `${wall.name} · отступ ${fmt(offset)} м`, e);
  }

  _clickOpening(e) {
    const o = this._openingAt(e);
    if (!o) {
      this.cb.onHint("Щёлкните именно по стене — окна и двери ставятся только в стены.");
      return;
    }
    this.cb.onPlaceOpening(this.tool, o.wall.id, o.offset);
  }

  // ---------------------------------------------------------------- перетаскивание

  _startDrag(hit, e) {
    const project = this.cb.getProject();
    const el = project.elements.find((x) => x.id === hit.elementId);
    const obj = el && this.view.objectOf(el.id);
    if (!obj) return;
    const hosted = project.elements.filter((o) => o.hostId === el.id).map((o) => this.view.objectOf(o.id)).filter(Boolean);
    const drag = { el, obj, hosted, origin: obj.position.clone(), hostedOrigins: hosted.map((h) => h.position.clone()) };

    if (el.hostId) {
      const host = project.elements.find((w) => w.id === el.hostId);
      if (!host) return;
      const { vx, vy } = wallAxes(host);
      drag.host = host;
      drag.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(vx, vy, 0), new THREE.Vector3(host.position.x, host.position.y, 0));
      const p = this.view.pointOnPlane(e.clientX, e.clientY, drag.plane);
      if (!p) return;
      drag.start = { u: worldToLocal(host, p.x, p.y).u, w: p.z - host.position.z };
    } else {
      drag.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -hit.point.z);
      const p = this.view.pointOnPlane(e.clientX, e.clientY, drag.plane);
      if (!p) return;
      drag.start = { x: p.x, y: p.y };
    }
    drag.result = null;
    this.drag = drag;
    this.view.controls.enabled = false; // пока тащим элемент, камера не вращается
    this.view.container.setPointerCapture?.(e.pointerId);
  }

  _dragMove(e) {
    const d = this.drag;
    const p = this.view.pointOnPlane(e.clientX, e.clientY, d.plane);
    if (!p) return;
    const project = this.cb.getProject();
    if (d.host) {
      const { u } = worldToLocal(d.host, p.x, p.y);
      const w = p.z - d.host.position.z;
      const L = d.host.size.length, H = d.host.size.height;
      const snap = (v) => Math.round(v / STEP) * STEP;
      const offset = Math.min(Math.max(0, snap(d.el.position.offset + u - d.start.u)), L - d.el.size.width);
      const elevation = d.el.type === "door" ? d.el.position.elevation
        : Math.min(Math.max(0, snap(d.el.position.elevation + w - d.start.w)), H - d.el.size.height);
      const o = wallLocalToWorld(d.host, offset, 0, elevation);
      d.obj.position.set(o.x, o.y, o.z);
      d.result = { offset, elevation };
      this._showLabel(new THREE.Vector3(o.x, o.y, o.z + d.el.size.height),
        `отступ ${fmt(offset)} м · низ ${fmt(elevation)} м`, e);
      return;
    }
    const s = snapMove(project, d.el, p.x - d.start.x, p.y - d.start.y, { tol: this._worldTolerance(p) });
    d.obj.position.set(d.origin.x + s.dx, d.origin.y + s.dy, d.origin.z);
    d.hosted.forEach((h, i) => h.position.set(d.hostedOrigins[i].x + s.dx, d.hostedOrigins[i].y + s.dy, d.hostedOrigins[i].z));
    d.result = { dx: s.dx, dy: s.dy };
    const kind = SNAP_KIND_LABELS[s.kind] ? ` · ${SNAP_KIND_LABELS[s.kind]}` : "";
    this._showLabel(d.obj.position.clone().add(new THREE.Vector3(0, 0, 0.5)), `Δ ${fmt(s.dx)}; ${fmt(s.dy)} м${kind}`, e);
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
      if (d.result.offset !== d.el.position.offset || d.result.elevation !== d.el.position.elevation) {
        this.cb.onMoveOpening(d.el.id, d.result.offset, d.result.elevation);
      }
    } else if (Math.abs(d.result.dx) > 1e-6 || Math.abs(d.result.dy) > 1e-6) {
      this.cb.onMove(d.el.id, d.result.dx, d.result.dy);
    }
  }

  // ---------------------------------------------------------------- предпросмотр

  _showMarker(s, z) {
    this.marker.visible = true;
    this.marker.position.set(s.x, s.y, z + 0.01);
    this.marker.material.color.setHex(SNAP_COLORS[s.kind] || SNAP_COLORS.grid);
  }

  /** Полупрозрачный брус с углом в position, повёрнутый на rotation вокруг Z. */
  _placeBoxPreview(spec, a, b, c, color) {
    const m = this.preview;
    m.visible = true;
    m.material.color.setHex(color);
    m.scale.set(Math.max(a, 0.01), Math.max(b, 0.01), Math.max(c, 0.01));
    const center = wallLocalToWorld(spec, a / 2, b / 2, c / 2);
    m.position.set(center.x, center.y, center.z);
    m.rotation.set(0, 0, (spec.rotation || 0) * DEG);
  }

  _showLabel(point, text, e) {
    if (!text) {
      this.label.hidden = true;
      return;
    }
    const s = this.view.toScreen(point);
    this.label.hidden = !s.visible;
    this.label.textContent = text;
    this.label.style.left = `${s.x}px`;
    this.label.style.top = `${s.y}px`;
  }

  _hidePreview() {
    this.preview.visible = false;
    this.marker.visible = false;
    this.label.hidden = true;
  }
}
