// Геометрия по данным модели (без Three.js): локальные оси элементов, контуры на плане,
// пересечения многоугольников. Единицы — метры и градусы, ось Z вверх (как в FreeCAD).
//
// У «брусовых» элементов (стена, фундамент, плита, колонна, балка…) position — угол
// бруса, rotation — поворот вокруг Z. Локальные оси: u — вдоль длины, v — по ширине/толщине, w — вверх.
(function (BS) {
  "use strict";
  const DEG = Math.PI / 180;

  function axes(el) {
    const a = (el.rotation || 0) * DEG;
    return { ux: Math.cos(a), uy: Math.sin(a), vx: -Math.sin(a), vy: Math.cos(a) };
  }

  /** Локальная точка (u, v, w) элемента → мировые координаты. */
  function localToWorld(el, u, v, w) {
    const { ux, uy, vx, vy } = axes(el);
    const p = el.position;
    return { x: p.x + u * ux + v * vx, y: p.y + u * uy + v * vy, z: p.z + w };
  }

  function worldToLocal(el, x, y) {
    const { ux, uy, vx, vy } = axes(el);
    const dx = x - el.position.x, dy = y - el.position.y;
    return { u: dx * ux + dy * uy, v: dx * vx + dy * vy };
  }

  function polygonArea(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      s += p.x * q.y - q.x * p.y;
    }
    return s / 2;
  }

  function lineIntersection(p, q, c, d) {
    const a1 = q.y - p.y, b1 = p.x - q.x, c1 = a1 * p.x + b1 * p.y;
    const a2 = d.y - c.y, b2 = c.x - d.x, c2 = a2 * c.x + b2 * c.y;
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-12) return { ...p };
    return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
  }

  /** Пересечение выпуклых многоугольников (Сазерленд — Ходжман). */
  function clipPolygon(a, b) {
    let out = a;
    const sign = polygonArea(b) >= 0 ? 1 : -1;
    for (let i = 0; i < b.length && out.length; i++) {
      const c = b[i], d = b[(i + 1) % b.length];
      const inside = (p) => sign * ((d.x - c.x) * (p.y - c.y) - (d.y - c.y) * (p.x - c.x)) >= -1e-12;
      const input = out;
      out = [];
      for (let j = 0; j < input.length; j++) {
        const p = input[j], q = input[(j + 1) % input.length];
        const pin = inside(p), qin = inside(q);
        if (pin) out.push(p);
        if (pin !== qin) out.push(lineIntersection(p, q, c, d));
      }
    }
    return out;
  }

  function overlapArea(a, b) {
    if (a.length < 3 || b.length < 3) return 0;
    const out = clipPolygon(a, b);
    return out.length >= 3 ? Math.abs(polygonArea(out)) : 0;
  }

  function pointInConvex(p, poly, tol = 1e-9) {
    if (poly.length < 3) return false;
    const sign = polygonArea(poly) >= 0 ? 1 : -1;
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i], d = poly[(i + 1) % poly.length];
      const len = Math.hypot(d.x - c.x, d.y - c.y) || 1;
      if ((sign * ((d.x - c.x) * (p.y - c.y) - (d.y - c.y) * (p.x - c.x))) / len < -tol) return false;
    }
    return true;
  }

  function closestPointOnSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return { x: a.x + t * dx, y: a.y + t * dy };
  }

  function pointSegmentDistance(p, a, b) {
    const c = closestPointOnSegment(p, a, b);
    return Math.hypot(p.x - c.x, p.y - c.y);
  }

  /** Расстояние между выпуклыми многоугольниками (0 — касаются, пересекаются или вложены). */
  function polygonDistance(a, b) {
    if (overlapArea(a, b) > 1e-9) return 0;
    if (a.some((p) => pointInConvex(p, b)) || b.some((p) => pointInConvex(p, a))) return 0;
    let best = Infinity;
    for (const [pts, poly] of [[a, b], [b, a]]) {
      for (const pt of pts) {
        for (let i = 0; i < poly.length; i++) {
          best = Math.min(best, pointSegmentDistance(pt, poly[i], poly[(i + 1) % poly.length]));
        }
      }
    }
    return best;
  }

  function bbox2(points) {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }

  /** Прямоугольник u ∈ [0,a], v ∈ [0,b] элемента → 4 угла на плане. */
  function rectFootprint(el, a, b, du = 0, dv = 0) {
    return [[0, 0], [a, 0], [a, b], [0, b]].map(([u, v]) => {
      const p = localToWorld(el, u + du, v + dv, 0);
      return { x: p.x, y: p.y };
    });
  }

  BS.geometry = {
    DEG, axes, localToWorld, worldToLocal, polygonArea, clipPolygon, overlapArea, pointInConvex,
    closestPointOnSegment, pointSegmentDistance, polygonDistance, bbox2, rectFootprint,
  };
})(globalThis.BuildSense);
