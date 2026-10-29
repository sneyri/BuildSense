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

  /** Выпуклый ли многоугольник (вершины в одном направлении обхода, допускаются коллинеарные). */
  function isConvex(poly) {
    if (poly.length < 4) return true;
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
      const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cr) < 1e-12) continue;
      const s = cr > 0 ? 1 : -1;
      if (sign && s !== sign) return false;
      sign = s;
    }
    return true;
  }

  /** Разбиение простого многоугольника на треугольники (отсечение «ушей»). */
  function triangulate(poly) {
    const pts = polygonArea(poly) >= 0 ? poly.slice() : poly.slice().reverse();
    const idx = pts.map((_, i) => i);
    const tris = [];
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    let guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
      let cut = false;
      for (let k = 0; k < idx.length; k++) {
        const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
        const a = pts[ia], b = pts[ib], c = pts[ic];
        const cr = cross(a, b, c);
        if (cr < -1e-12) continue; // вогнутая вершина
        if (Math.abs(cr) <= 1e-12) { idx.splice(k, 1); cut = true; break; } // коллинеарная — просто убрать
        const tri = [a, b, c];
        const blocked = idx.some((j) => j !== ia && j !== ib && j !== ic && pointInTriangle(pts[j], tri));
        if (blocked) continue;
        tris.push(tri);
        idx.splice(k, 1);
        cut = true;
        break;
      }
      if (!cut) break; // вырожденный контур — остаток отдаётся как есть
    }
    if (idx.length === 3) tris.push(idx.map((i) => pts[i]));
    return tris;
  }

  function pointInTriangle(p, [a, b, c]) {
    const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
    const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
    const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
    const neg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12;
    const pos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
    return !(neg && pos);
  }

  function convexParts(poly) {
    return isConvex(poly) ? [poly] : triangulate(poly);
  }

  /** Площадь пересечения многоугольников (невыпуклые раскладываются на треугольники). */
  function overlapArea(a, b) {
    if (a.length < 3 || b.length < 3) return 0;
    let sum = 0;
    for (const pa of convexParts(a)) {
      for (const pb of convexParts(b)) {
        const out = clipPolygon(pa, pb);
        if (out.length >= 3) sum += Math.abs(polygonArea(out));
      }
    }
    return sum;
  }

  /** Точка внутри простого многоугольника; tol > 0 — с допуском наружу, tol < 0 — не ближе |tol| к границе. */
  function pointInPolygon(p, poly, tol = 1e-9) {
    if (poly.length < 3) return false;
    let inside = false;
    let dmin = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      dmin = Math.min(dmin, pointSegmentDistance(p, a, b));
    }
    if (tol >= 0) return inside || dmin <= tol;
    return inside && dmin >= -tol;
  }

  function pointInConvex(p, poly, tol = 1e-9) {
    if (poly.length < 3) return false;
    if (!isConvex(poly)) return pointInPolygon(p, poly, tol);
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
    if (a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a))) return 0;
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
    DEG, axes, localToWorld, worldToLocal, polygonArea, clipPolygon, overlapArea, pointInConvex, pointInPolygon,
    isConvex, triangulate, lineIntersection,
    closestPointOnSegment, pointSegmentDistance, polygonDistance, bbox2, rectFootprint,
  };
})(globalThis.BuildSense);
