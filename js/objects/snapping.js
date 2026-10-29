// Привязки («магнит») при построении мышью: углы и грани несущих элементов, оси X/Y, сетка.
(function (BS) {
  "use strict";
  const G = BS.geometry;
  const ORTHO_DEG = 8;

  const KIND_LABELS = { corner: "угол", edge: "грань", ortho: "по оси", grid: "сетка", free: "" };

  function snapTargets(project, excludeIds = []) {
    const corners = [];
    const edges = [];
    for (const el of project.elements) {
      if (excludeIds.includes(el.id) || !BS.support.canCarry(el)) continue;
      const t = BS.types.get(el.type);
      if (t.shape === "roof" || t.shape === "pipe") continue;
      const poly = BS.shapes.footprint(el, project);
      if (t.shape === "cylinder") {
        corners.push({ ...el.position, id: el.id });
        continue;
      }
      poly.forEach((p, i) => {
        corners.push({ ...p, id: el.id });
        edges.push({ a: p, b: poly[(i + 1) % poly.length], id: el.id });
      });
    }
    return { corners, edges };
  }

  const gridRound = (v, grid) => (grid > 0 ? Math.round(v / grid) * grid : v);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /** Привязка точки плана. Приоритет: угол → грань (с учётом оси) → ось → сетка. */
  function snapPoint(project, p, { grid = 0.1, tol = 0.3, from = null, excludeIds = [], targets, enabled = true } = {}) {
    if (!enabled) return { x: p.x, y: p.y, kind: "free", targetId: null };
    const { corners, edges } = targets || snapTargets(project, excludeIds);
    let best = null;
    for (const c of corners) {
      const d = dist(p, c);
      if (d <= tol && (!best || d < best.d)) best = { d, x: c.x, y: c.y, id: c.id };
    }
    if (best) return { x: best.x, y: best.y, kind: "corner", targetId: best.id };

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
      if (!c) c = G.closestPointOnSegment(q, e.a, e.b);
      const d = dist(q, c);
      if (d <= tol && (!edgeHit || d < edgeHit.d)) edgeHit = { d, ...c, id: e.id };
    }
    if (edgeHit) return { x: edgeHit.x, y: edgeHit.y, kind: "edge", targetId: edgeHit.id };

    if (axis === "x") return { x: gridRound(q.x, grid), y: q.y, kind: "ortho", targetId: null };
    if (axis === "y") return { x: q.x, y: gridRound(q.y, grid), kind: "ortho", targetId: null };
    return { x: gridRound(p.x, grid), y: gridRound(p.y, grid), kind: "grid", targetId: null };
  }

  /** Привязка при перетаскивании: углы контура элемента прилипают к углам и граням соседей. */
  function snapMove(project, el, dx, dy, { grid = 0.1, tol = 0.3, enabled = true } = {}) {
    const p = el.position;
    if (!enabled) return { dx, dy, kind: "free", targetId: null };
    const hosted = project.elements.filter((e) => e.hostId === el.id).map((e) => e.id);
    const { corners, edges } = snapTargets(project, [el.id, ...hosted]);
    const moved = BS.shapes.footprint(el, project).map((c) => ({ x: c.x + dx, y: c.y + dy }));
    let best = null;
    for (const m of moved) {
      for (const c of corners) {
        const d = dist(m, c);
        if (d <= tol && (!best || d < best.d)) best = { d, cx: c.x - m.x, cy: c.y - m.y, kind: "corner", id: c.id };
      }
    }
    if (!best) {
      for (const m of moved) {
        for (const e of edges) {
          const c = G.closestPointOnSegment(m, e.a, e.b);
          const d = dist(m, c);
          if (d <= tol && (!best || d < best.d)) best = { d, cx: c.x - m.x, cy: c.y - m.y, kind: "edge", id: e.id };
        }
      }
    }
    if (best) return { dx: dx + best.cx, dy: dy + best.cy, kind: best.kind, targetId: best.id };
    return { dx: gridRound(p.x + dx, grid) - p.x, dy: gridRound(p.y + dy, grid) - p.y, kind: "grid", targetId: null };
  }

  BS.snapping = { KIND_LABELS, snapTargets, snapPoint, snapMove };
})(globalThis.BuildSense);
