// BuildSense · Машиностроение — сетки деталей (Three.js r147), объём по сетке, экспорт STL.
// Геометрия выводится из фич mechModel.evaluate(): тела вращения — THREE.LatheGeometry по каждому
// ребру профиля (острые кромки остаются острыми), фланец — диск с отверстиями (THREE.Shape с holes,
// триангуляция THREE.ShapeUtils) и ступица, сшитые в ОДНУ замкнутую оболочку без внутренних граней.
// Сетка — только для показа и STL; точные значения (объём, масса) берутся из параметров.
(function (BS) {
  "use strict";
  const M = BS.mechModel;
  const T = globalThis.THREE;

  const DEFAULT_SEGMENTS = 128; // по окружности тела вращения
  const HOLE_SEGMENTS = 48; // по окружности малых отверстий

  // ------------------------------------------------------------------ треугольники

  /**
   * Набор треугольников: positions (9 чисел на треугольник) и normals (по вершинам).
   * Ориентация каждого треугольника выравнивается по заданной нормали «наружу».
   */
  function TriSet() {
    this.pos = [];
    this.nrm = [];
  }
  TriSet.prototype.add = function (a, b, c, na, nb, nc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const area2 = Math.hypot(cx, cy, cz);
    if (area2 < 1e-10) return; // вырожденный треугольник (например, у оси вращения)
    nb = nb || na;
    nc = nc || na;
    const s = (na[0] + nb[0] + nc[0]) * cx + (na[1] + nb[1] + nc[1]) * cy + (na[2] + nb[2] + nc[2]) * cz;
    if (s < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; }
    this.pos.push(...a, ...b, ...c);
    this.nrm.push(...na, ...nb, ...nc);
  };
  TriSet.prototype.toGeometry = function () {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(this.nrm, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  };

  // ------------------------------------------------------------------ тело вращения

  function signedArea(profile) {
    let a = 0;
    for (let i = 0; i < profile.length; i++) {
      const [x1, y1] = profile[i];
      const [x2, y2] = profile[(i + 1) % profile.length];
      a += x1 * y2 - x2 * y1;
    }
    return a / 2;
  }

  /** Профиль (r, z) → замкнутая оболочка вращения вокруг Z. Каждое ребро — своя LatheGeometry. */
  function revolveGeometry(profile, segments = DEFAULT_SEGMENTS) {
    const prof = signedArea(profile) < 0 ? profile.slice().reverse() : profile; // против часовой → нормали наружу
    const tris = new TriSet();
    const rotX = new T.Matrix4().makeRotationX(Math.PI / 2); // ось Y LatheGeometry → ось Z детали
    for (let i = 0; i < prof.length; i++) {
      const p = prof[i], q = prof[(i + 1) % prof.length];
      if (p[0] < 1e-12 && q[0] < 1e-12) continue; // ребро на оси не даёт поверхности
      const lathe = new T.LatheGeometry([new T.Vector2(p[0], p[1]), new T.Vector2(q[0], q[1])], segments, 0, Math.PI * 2);
      lathe.applyMatrix4(rotX);
      const pa = lathe.getAttribute("position"), na = lathe.getAttribute("normal"), idx = lathe.getIndex();
      const v = (k) => [pa.getX(k), pa.getY(k), pa.getZ(k)];
      const n = (k) => [na.getX(k), na.getY(k), na.getZ(k)];
      for (let t = 0; t < idx.count; t += 3) {
        const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
        tris.add(v(a), v(b), v(c), n(a), n(b), n(c));
      }
      lathe.dispose();
    }
    return tris;
  }

  // ------------------------------------------------------------------ фланец

  function circle(cx, cy, r, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      pts.push(new T.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
    return pts;
  }

  /** Плоская грань (контур с дырами) на высоте z, нормаль ±Z. */
  function cap(tris, contour, holes, z, up) {
    const shape = new T.Shape(contour);
    shape.holes = holes.map((h) => new T.Path(h));
    const all = contour.concat(...holes);
    const nz = [0, 0, up ? 1 : -1];
    for (const f of T.ShapeUtils.triangulateShape(contour.slice(), holes.map((h) => h.slice()))) {
      const p = f.map((k) => [all[k].x, all[k].y, z]);
      tris.add(p[0], p[1], p[2], nz);
    }
    return shape;
  }

  /** Цилиндрическая стенка по окружности от z0 до z1; outward=true — нормаль от центра окружности. */
  function wall(tris, loop, cx, cy, z0, z1, outward) {
    const n = loop.length;
    const nr = (p) => {
      const dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1;
      return outward ? [dx / l, dy / l, 0] : [-dx / l, -dy / l, 0];
    };
    for (let i = 0; i < n; i++) {
      const p = loop[i], q = loop[(i + 1) % n];
      const a = [p.x, p.y, z0], b = [q.x, q.y, z0], c = [q.x, q.y, z1], d = [p.x, p.y, z1];
      tris.add(a, b, c, nr(p), nr(q), nr(q));
      tris.add(a, c, d, nr(p), nr(q), nr(p));
    }
  }

  /** Фланец: диск ⌀D×T с центральным отверстием, ступицей и отверстиями по окружности — одна оболочка. */
  function flangeGeometry(part, segments = DEFAULT_SEGMENTS) {
    const p = part.params;
    const ev = M.evaluate(part);
    const tris = new TriSet();
    const hub = p.hubD > 0 && p.hubH > 0;
    const outer = circle(0, 0, p.D / 2, segments);
    const bore = circle(0, 0, p.d / 2, segments);
    const hubLoop = hub ? circle(0, 0, p.hubD / 2, segments) : null;
    const holeLoops = ev.holes.map((h) => ({ h, loop: circle(h.x, h.y, h.d / 2, HOLE_SEGMENTS) }));
    const holes = holeLoops.map((x) => x.loop);
    const top = p.T + (hub ? p.hubH : 0);

    const shape = cap(tris, outer, [bore, ...holes], 0, false); // низ диска
    cap(tris, outer, [hub ? hubLoop : bore, ...holes], p.T, true); // верх диска
    wall(tris, outer, 0, 0, 0, p.T, true);
    for (const { h, loop } of holeLoops) wall(tris, loop, h.x, h.y, 0, p.T, false);
    if (hub) {
      cap(tris, hubLoop, [bore], top, true); // торец ступицы
      wall(tris, hubLoop, 0, 0, p.T, top, true);
    }
    wall(tris, bore, 0, 0, 0, top, false);
    tris.shape = shape; // эскиз диска с отверстиями (THREE.Shape) — для отладки и будущего выдавливания
    return tris;
  }

  // ------------------------------------------------------------------ плоская деталь (выдавливание)

  /** Контур (две проушины или плита) с отверстиями → THREE.Shape в плоскости XY. */
  function outlineShape(ex, holes) {
    const o = ex.outline;
    const s = new T.Shape();
    if (o.kind === "stadium") {
      const phi = Math.acos((o.r1 - o.r2) / o.C); // направление нормали к внешней касательной
      s.moveTo(o.r1 * Math.cos(phi), o.r1 * Math.sin(phi));
      s.absarc(0, 0, o.r1, phi, 2 * Math.PI - phi, false);
      s.lineTo(o.C + o.r2 * Math.cos(-phi), o.r2 * Math.sin(-phi));
      s.absarc(o.C, 0, o.r2, -phi, phi, false);
      s.closePath();
    } else {
      s.moveTo(o.x0, o.y0); s.lineTo(o.x1, o.y0); s.lineTo(o.x1, o.y1); s.lineTo(o.x0, o.y1); s.closePath();
    }
    for (const h of holes) {
      const path = new T.Path();
      path.absarc(h.x, h.y, h.d / 2, 0, 2 * Math.PI, true);
      s.holes.push(path);
    }
    return s;
  }

  /** Выдавливание контура на высоту вдоль Z — одна замкнутая оболочка. */
  function extrudeTris(ev, segments = DEFAULT_SEGMENTS) {
    const g = new T.ExtrudeGeometry(outlineShape(ev.extrude, ev.holes), { depth: ev.extrude.height, bevelEnabled: false, curveSegments: Math.max(12, Math.round(segments / 2)) });
    const flat = g.index ? g.toNonIndexed() : g;
    const tris = new TriSet();
    tris.pos = Array.from(flat.getAttribute("position").array);
    flat.computeVertexNormals();
    tris.nrm = Array.from(flat.getAttribute("normal").array);
    if (flat !== g) flat.dispose();
    g.dispose();
    return tris;
  }

  // ------------------------------------------------------------------ деталь

  /** Сетка детали в локальной системе (ось вращения — Z, торец на z = 0). */
  function buildPartTris(part, segments = DEFAULT_SEGMENTS) {
    const ev = M.evaluate(part);
    if (ev.extrude) return extrudeTris(ev, segments);
    if (ev.holes.length) return flangeGeometry(part, segments);
    return revolveGeometry(ev.profile, segments);
  }

  function buildPartGeometry(part, segments) {
    return buildPartTris(part, segments).toGeometry();
  }

  /** Матрица положения детали (THREE.Euler "XYZ" в градусах). */
  function partMatrix(part) {
    const pl = part.placement;
    const d = Math.PI / 180;
    const q = new T.Quaternion().setFromEuler(new T.Euler(pl.rotation.x * d, pl.rotation.y * d, pl.rotation.z * d, "XYZ"));
    return new T.Matrix4().compose(new T.Vector3(pl.x, pl.y, pl.z), q, new T.Vector3(1, 1, 1));
  }

  /** Плоский массив треугольников (9 чисел на треугольник), при необходимости в мировых координатах. */
  function trianglesOf(geometry, matrix) {
    const pa = geometry.getAttribute("position");
    const out = new Float64Array(pa.count * 3);
    const v = new T.Vector3();
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i);
      if (matrix) v.applyMatrix4(matrix);
      out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    }
    return out;
  }

  /** Объём замкнутой сетки (формула дивергенции), мм³. */
  function meshVolume(tri) {
    let v = 0;
    for (let i = 0; i < tri.length; i += 9) {
      const ax = tri[i], ay = tri[i + 1], az = tri[i + 2];
      const bx = tri[i + 3], by = tri[i + 4], bz = tri[i + 5];
      const cx = tri[i + 6], cy = tri[i + 7], cz = tri[i + 8];
      v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return v / 6;
  }

  /** Замкнутость: каждое ребро (после сварки совпадающих вершин) — ровно у двух треугольников, встречно. */
  function checkClosed(tri, tol = 1e-4) {
    const key = (i) => `${Math.round(tri[i] / tol)},${Math.round(tri[i + 1] / tol)},${Math.round(tri[i + 2] / tol)}`;
    const ids = new Map();
    const vid = (i) => {
      const k = key(i);
      let id = ids.get(k);
      if (id === undefined) { id = ids.size; ids.set(k, id); }
      return id;
    };
    const edges = new Map();
    let degenerate = 0;
    for (let i = 0; i < tri.length; i += 9) {
      const a = vid(i), b = vid(i + 3), c = vid(i + 6);
      if (a === b || b === c || a === c) { degenerate++; continue; }
      for (const [u, w] of [[a, b], [b, c], [c, a]]) {
        const k = u < w ? `${u}_${w}` : `${w}_${u}`;
        const e = edges.get(k) || { n: 0, dir: 0 };
        e.n++;
        e.dir += u < w ? 1 : -1;
        edges.set(k, e);
      }
    }
    let boundary = 0, nonManifold = 0, misoriented = 0;
    for (const e of edges.values()) {
      if (e.n === 1) boundary++;
      else if (e.n > 2) nonManifold++;
      else if (e.dir !== 0) misoriented++;
    }
    return { triangles: tri.length / 9, vertices: ids.size, edges: edges.size, boundary, nonManifold, misoriented, degenerate, closed: boundary === 0 && nonManifold === 0 && misoriented === 0 };
  }

  function bounds(tri) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < tri.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (tri[i + k] < min[k]) min[k] = tri[i + k];
        if (tri[i + k] > max[k]) max[k] = tri[i + k];
      }
    }
    return { min, max, size: [0, 1, 2].map((k) => max[k] - min[k]) };
  }

  /** Сводка по детали: объём аналитический / по профилю (Папп) / по сетке, масса, габарит. */
  function partReport(part, segments = DEFAULT_SEGMENTS) {
    const g = buildPartGeometry(part, segments);
    const tri = trianglesOf(g, partMatrix(part));
    g.dispose();
    const analytic = M.analyticVolume(part);
    const ev = M.evaluate(part);
    let pappus = ev.profile ? M.profileVolume(ev.profile) : analytic; // у плоских деталей профиля вращения нет
    if (ev.profile) for (const h of ev.holes) pappus -= (Math.PI * h.d * h.d / 4) * (h.z1 - h.z0);
    const mesh = meshVolume(tri);
    const rho = M.density(part);
    return {
      analyticVolume: analytic, profileVolume: pappus, meshVolume: mesh,
      meshDeviation: (mesh - analytic) / analytic,
      mass: M.massKg(analytic, rho), density: rho,
      bounds: M.worldBounds(part), meshBounds: bounds(tri), triangles: tri.length / 9,
    };
  }

  // ------------------------------------------------------------------ STL

  /** Треугольники всех деталей проекта в мировых координатах (мм). */
  function projectTriangles(project, parts, segments = DEFAULT_SEGMENTS) {
    const list = (parts || project.parts).map((part) => {
      const g = buildPartGeometry(part, segments);
      const t = trianglesOf(g, partMatrix(part));
      g.dispose();
      return t;
    });
    const total = list.reduce((s, t) => s + t.length, 0);
    const out = new Float64Array(total);
    let o = 0;
    for (const t of list) { out.set(t, o); o += t.length; }
    return out;
  }

  function normalOf(t, i) {
    const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
    const vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  /** Двоичный STL (мм). Возвращает ArrayBuffer. */
  function stlBinary(tri, header = "BuildSense mech STL, units mm") {
    const n = tri.length / 9;
    const buf = new ArrayBuffer(84 + 50 * n);
    const dv = new DataView(buf);
    for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) & 0x7f : 0x20);
    dv.setUint32(80, n, true);
    let o = 84;
    for (let i = 0; i < tri.length; i += 9) {
      const nn = normalOf(tri, i);
      for (const x of nn) { dv.setFloat32(o, x, true); o += 4; }
      for (let k = 0; k < 9; k++) { dv.setFloat32(o, tri[i + k], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }

  /** Текстовый STL (мм). */
  function stlAscii(tri, name = "buildsense_mech") {
    const f = (x) => x.toExponential(6);
    const lines = [`solid ${name}`];
    for (let i = 0; i < tri.length; i += 9) {
      const nn = normalOf(tri, i);
      lines.push(`  facet normal ${f(nn[0])} ${f(nn[1])} ${f(nn[2])}`, "    outer loop");
      for (let k = 0; k < 9; k += 3) lines.push(`      vertex ${f(tri[i + k])} ${f(tri[i + k + 1])} ${f(tri[i + k + 2])}`);
      lines.push("    endloop", "  endfacet");
    }
    lines.push(`endsolid ${name}`);
    return lines.join("\n") + "\n";
  }

  /** Разбор двоичного STL (для тестов и проверки): Float64Array треугольников. */
  function parseStlBinary(buf) {
    const dv = new DataView(buf);
    const n = dv.getUint32(80, true);
    const out = new Float64Array(n * 9);
    let o = 84;
    for (let t = 0; t < n; t++) {
      o += 12;
      for (let k = 0; k < 9; k++) { out[t * 9 + k] = dv.getFloat32(o, true); o += 4; }
      o += 2;
    }
    return out;
  }

  BS.mechGeometry = {
    DEFAULT_SEGMENTS, HOLE_SEGMENTS,
    revolveGeometry, flangeGeometry, buildPartTris, buildPartGeometry, partMatrix, trianglesOf,
    meshVolume, checkClosed, bounds, partReport, projectTriangles, stlBinary, stlAscii, parseStlBinary,
  };
})(globalThis.BuildSense);
