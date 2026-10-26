// Геометрические расчёты по данным модели (без Three.js).
// Общие для 3D-отображения, расчёта параметров и экспорта в FreeCAD.
//
// Система координат: метры, ось Z вверх (как в FreeCAD).
// Стена — брус с началом в точке position, повёрнутый на rotation градусов вокруг Z:
//   локальная ось u — вдоль длины, v — по толщине (внутрь дома), w — вверх.

export const DEG = Math.PI / 180;

export function wallAxes(wall) {
  const a = (wall.rotation || 0) * DEG;
  return { ux: Math.cos(a), uy: Math.sin(a), vx: -Math.sin(a), vy: Math.cos(a) };
}

/** Перевод точки из локальных координат стены (u, v, w) в мировые. */
export function wallLocalToWorld(wall, u, v, w) {
  const { ux, uy, vx, vy } = wallAxes(wall);
  const p = wall.position;
  return {
    x: p.x + u * ux + v * vx,
    y: p.y + u * uy + v * vy,
    z: p.z + w,
  };
}

/** Высота подъёма крыши над карнизом. Для плоской крыши — её толщина. */
export function roofRise(roof) {
  const params = roof.params || {};
  if (params.roofType === "gable") {
    return (roof.size.width / 2) * Math.tan((params.slope || 0) * DEG);
  }
  return params.thickness || 0;
}

/**
 * Габариты элемента в мировых координатах {min:{x,y,z}, max:{x,y,z}}.
 * Для проёмов нужен проект, чтобы найти стену-основу.
 */
export function elementBounds(el, project) {
  const pts = elementCorners(el, project);
  if (!pts.length) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) {
    for (const k of ["x", "y", "z"]) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return { min, max };
}

function elementCorners(el, project) {
  const s = el.size;
  switch (el.type) {
    case "wall":
      return boxCorners(el, s.length, s.thickness, s.height);
    case "floor":
    case "foundation":
      return boxCorners(el, s.length, s.width, s.thickness);
    case "roof":
      return boxCorners(el, s.length, s.width, roofRise(el));
    case "window":
    case "door": {
      const host = project && project.elements.find((e) => e.id === el.hostId);
      if (!host) return [];
      const pts = [];
      for (const u of [el.position.offset, el.position.offset + s.width]) {
        for (const v of [0, host.size.thickness]) {
          for (const w of [el.position.elevation, el.position.elevation + s.height]) {
            pts.push(wallLocalToWorld(host, u, v, w));
          }
        }
      }
      return pts;
    }
    default:
      return [];
  }
}

// Углы бруса с началом в position, повёрнутого вокруг Z (используется для всех «коробочных» элементов).
function boxCorners(el, a, b, c) {
  const pts = [];
  for (const u of [0, a]) for (const v of [0, b]) for (const w of [0, c]) {
    pts.push(wallLocalToWorld(el, u, v, w));
  }
  return pts;
}

/** Размеры «пятна» элемента на плане: [вдоль u, вдоль v] или null для проёмов. */
export function planSize(el) {
  const s = el.size;
  if (el.type === "wall") return [s.length, s.thickness];
  if (el.type === "floor" || el.type === "foundation" || el.type === "roof") return [s.length, s.width];
  return null;
}

/** Контур элемента на плане — 4 угла {x, y} по обходу. */
export function footprint(el) {
  const ps = planSize(el);
  if (!ps) return [];
  const [a, b] = ps;
  return [[0, 0], [a, 0], [a, b], [0, b]].map(([u, v]) => {
    const p = wallLocalToWorld(el, u, v, 0);
    return { x: p.x, y: p.y };
  });
}

/** Точка (x, y) в локальных осях элемента на плане. */
export function worldToLocal(el, x, y) {
  const { ux, uy, vx, vy } = wallAxes(el);
  const dx = x - el.position.x, dy = y - el.position.y;
  return { u: dx * ux + dy * uy, v: dx * vx + dy * vy };
}

/** Лежит ли точка внутри контура элемента на плане (tol > 0 — с запасом, tol < 0 — строго внутри). */
export function footprintContains(el, x, y, tol = 0) {
  const ps = planSize(el);
  if (!ps) return false;
  const { u, v } = worldToLocal(el, x, y);
  return u >= -tol && u <= ps[0] + tol && v >= -tol && v <= ps[1] + tol;
}

/** Низ и верх элемента по Z. */
export function elementBase(el) {
  return el.position.z;
}

export function elementTop(el) {
  const s = el.size;
  if (el.type === "wall") return el.position.z + s.height;
  if (el.type === "floor" || el.type === "foundation") return el.position.z + s.thickness;
  if (el.type === "roof") return el.position.z + roofRise(el);
  return el.position.z;
}

/** Расстояние между выпуклыми многоугольниками на плане (0 — касаются или пересекаются). */
export function polygonDistance(a, b) {
  if (polygonsOverlap(a, b)) return 0;
  let best = Infinity;
  for (const [p, poly] of [[a, b], [b, a]]) {
    for (const pt of p) {
      for (let i = 0; i < poly.length; i++) {
        best = Math.min(best, pointSegmentDistance(pt, poly[i], poly[(i + 1) % poly.length]));
      }
    }
  }
  return best;
}

/** Площадь пересечения двух выпуклых многоугольников (отсечение Сазерленда — Ходжмана). */
export function overlapArea(a, b) {
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
  return out.length >= 3 ? Math.abs(polygonArea(out)) : 0;
}

function polygonsOverlap(a, b) {
  return overlapArea(a, b) > 1e-9;
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

export function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function pointSegmentDistance(p, a, b) {
  const c = closestPointOnSegment(p, a, b);
  return Math.hypot(p.x - c.x, p.y - c.y);
}

export function round(value, digits = 3) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
