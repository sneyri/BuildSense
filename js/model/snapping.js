// Привязки («магнит») при построении мышью: к углам и граням стен, фундамента и полов,
// к ортогональным направлениям и к сетке. Чистые функции — тестируются без браузера.
import { closestPointOnSegment, footprint } from "./placement.js";

const SNAP_TYPES = ["wall", "foundation", "floor"];
const ORTHO_DEG = 8; // в пределах ±8° от осей направление выравнивается

export const SNAP_KIND_LABELS = {
  corner: "угол",
  edge: "грань",
  ortho: "по оси",
  grid: "сетка",
  free: "",
};

export function snapTargets(project, excludeIds = []) {
  const corners = [];
  const edges = [];
  for (const el of project.elements) {
    if (!SNAP_TYPES.includes(el.type) || excludeIds.includes(el.id)) continue;
    const poly = footprint(el);
    poly.forEach((p, i) => {
      corners.push({ ...p, id: el.id });
      edges.push({ a: p, b: poly[(i + 1) % poly.length], id: el.id });
    });
  }
  return { corners, edges };
}

const gridRound = (v, grid) => (grid > 0 ? Math.round(v / grid) * grid : v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Привязывает точку плана.
 * @param {{x:number,y:number}} p — точка под курсором
 * @param {{ grid?: number, tol?: number, from?: {x,y}|null, excludeIds?: string[], targets?: object }} opts
 * @returns {{ x, y, kind: "corner"|"edge"|"ortho"|"grid", targetId: string|null }}
 */
export function snapPoint(project, p, { grid = 0.1, tol = 0.3, from = null, excludeIds = [], targets } = {}) {
  const { corners, edges } = targets || snapTargets(project, excludeIds);

  // 1. Углы — самая сильная привязка
  let best = null;
  for (const c of corners) {
    const d = dist(p, c);
    if (d <= tol && (!best || d < best.d)) best = { d, x: c.x, y: c.y, id: c.id };
  }
  if (best) return { x: best.x, y: best.y, kind: "corner", targetId: best.id };

  // 2. Ортогональное направление от предыдущей точки
  let q = p;
  let axis = null;
  if (from) {
    const ang = (Math.atan2(p.y - from.y, p.x - from.x) * 180) / Math.PI;
    const a = ((ang % 180) + 180) % 180;
    if (Math.min(a, 180 - a) <= ORTHO_DEG) axis = "x";
    else if (Math.abs(a - 90) <= ORTHO_DEG) axis = "y";
    if (axis === "x") q = { x: p.x, y: from.y };
    if (axis === "y") q = { x: from.x, y: p.y };
  }

  // 3. Грани: при выравнивании по оси — пересечение оси с гранью, иначе ближайшая точка грани
  let edgeHit = null;
  for (const e of edges) {
    let c = null;
    if (axis === "x" && Math.abs(e.b.y - e.a.y) > 1e-9) {
      const t = (q.y - e.a.y) / (e.b.y - e.a.y);
      if (t >= -1e-9 && t <= 1 + 1e-9) c = { x: e.a.x + t * (e.b.x - e.a.x), y: q.y };
    } else if (axis === "y" && Math.abs(e.b.x - e.a.x) > 1e-9) {
      const t = (q.x - e.a.x) / (e.b.x - e.a.x);
      if (t >= -1e-9 && t <= 1 + 1e-9) c = { x: q.x, y: e.a.y + t * (e.b.y - e.a.y) };
    }
    if (!c) c = closestPointOnSegment(q, e.a, e.b);
    const d = dist(q, c);
    if (d <= tol && (!edgeHit || d < edgeHit.d)) edgeHit = { d, ...c, id: e.id };
  }
  if (edgeHit) return { x: edgeHit.x, y: edgeHit.y, kind: "edge", targetId: edgeHit.id };

  // 4. Сетка (по свободной координате, если направление выровнено)
  if (axis === "x") return { x: gridRound(q.x, grid), y: q.y, kind: "ortho", targetId: null };
  if (axis === "y") return { x: q.x, y: gridRound(q.y, grid), kind: "ortho", targetId: null };
  return { x: gridRound(p.x, grid), y: gridRound(p.y, grid), kind: "grid", targetId: null };
}

/**
 * Привязка при перетаскивании элемента: углы его контура «прилипают» к углам и граням соседей,
 * иначе смещение округляется до шага сетки.
 * @returns {{ dx, dy, kind, targetId }}
 */
export function snapMove(project, el, dx, dy, { grid = 0.1, tol = 0.3 } = {}) {
  const { corners, edges } = snapTargets(project, [el.id, ...hostedIds(project, el.id)]);
  const moved = footprint(el).map((c) => ({ x: c.x + dx, y: c.y + dy }));
  let best = null;
  for (const m of moved) {
    for (const c of corners) {
      const d = dist(m, c);
      if (d <= tol && (!best || d < best.d)) {
        best = { d, cx: c.x - m.x, cy: c.y - m.y, kind: "corner", id: c.id };
      }
    }
  }
  if (!best) {
    for (const m of moved) {
      for (const e of edges) {
        const c = closestPointOnSegment(m, e.a, e.b);
        const d = dist(m, c);
        if (d <= tol && (!best || d < best.d)) best = { d, cx: c.x - m.x, cy: c.y - m.y, kind: "edge", id: e.id };
      }
    }
  }
  if (best) return { dx: dx + best.cx, dy: dy + best.cy, kind: best.kind, targetId: best.id };
  const p = el.position;
  return { dx: gridRound(p.x + dx, grid) - p.x, dy: gridRound(p.y + dy, grid) - p.y, kind: "grid", targetId: null };
}

function hostedIds(project, id) {
  return project.elements.filter((e) => e.hostId === id).map((e) => e.id);
}
