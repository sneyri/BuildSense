// Контур дома на плане и построение по нему: 2D-план → фундамент → стены → перекрытия → крыша.
//
// project.plan = { contours: [{ id, levelId, closed: true, points: [{ id, x, y }] }] } — метры, мировые XY,
// обход всегда против часовой стрелки (внутренность слева от ребра). Элементы, построенные по контуру,
// помечены params.contourId и params.generatedBy; стены и ленты — ещё params.edgeFrom (id начальной вершины
// ребра) и params.edgeStart (начало элемента вдоль ребра, м). Это позволяет перестраивать их при изменении
// контура или толщины/высоты стен, сохраняя id элементов (проёмы остаются в своих стенах).
//
// Угловые стыки стен и лент считаются точно по линиям граней (см. bandLayout): углы без выступов наружу
// и без щелей, в том числе вогнутые углы L-, Т-, П-образных домов и стыки стен разной толщины.
(function (BS) {
  "use strict";
  const U = BS.util;
  const G = BS.geometry;
  const S = BS.shapes;

  const GEN = {
    foundation: "contour-foundation", strip: "contour-strip", wall: "contour-wall",
    slab: "contour-slab", floor: "contour-floor", roof: "contour-roof",
  };
  const EPS = 1e-6;
  const P = () => BS.project;

  // ---------------------------------------------------------------- данные контура

  function ensurePlan(project) {
    if (!U.isObject(project.plan) || !Array.isArray(project.plan.contours)) project.plan = { contours: [] };
    return project.plan;
  }

  function list(project) {
    return ensurePlan(project).contours;
  }

  function get(project, id) {
    return list(project).find((c) => c.id === id) || null;
  }

  function forLevel(project, levelId) {
    return list(project).filter((c) => c.levelId === levelId);
  }

  function nextContourId(project) {
    let n = 0;
    for (const c of list(project)) { const m = /^C(\d+)$/.exec(c.id); if (m) n = Math.max(n, Number(m[1])); }
    return `C${n + 1}`;
  }

  function nextPointId(points) {
    let n = 0;
    for (const p of points) { const m = /^p(\d+)$/.exec(p.id || ""); if (m) n = Math.max(n, Number(m[1])); }
    return `p${n + 1}`;
  }

  /** Чистит список вершин: округление, повторы подряд, id; обход — против часовой стрелки. */
  function cleanPoints(points) {
    const out = [];
    for (const p of points) {
      const q = { id: p.id, x: U.round(Number(p.x), 3), y: U.round(Number(p.y), 3) };
      const prev = out[out.length - 1];
      if (prev && Math.hypot(prev.x - q.x, prev.y - q.y) < 0.005) continue;
      out.push(q);
    }
    while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 0.005) out.pop();
    for (const p of out) if (!p.id || out.filter((o) => o.id === p.id).length > 1) p.id = nextPointId(out.filter((o) => o !== p && o.id));
    if (out.length >= 3 && G.polygonArea(out) < 0) out.reverse();
    return out;
  }

  /** Ошибка контура (текст) или null. */
  function problem(points) {
    if (!Array.isArray(points) || points.length < 3) return "В контуре должно быть не меньше трёх вершин";
    if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return "Координаты вершин должны быть числами";
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.1) return `Ребро ${i + 1} короче 0,1 м`;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;
        if (segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return `Контур самопересекается (рёбра ${i + 1} и ${j + 1})`;
      }
    }
    if (Math.abs(G.polygonArea(points)) < 1) return "Площадь контура меньше 1 м²";
    return null;
  }

  function segmentsCross(a, b, c, d) {
    const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;
    const on = (p, q, r) => Math.abs(o(p, q, r)) <= EPS && Math.min(p.x, q.x) - EPS <= r.x && r.x <= Math.max(p.x, q.x) + EPS &&
      Math.min(p.y, q.y) - EPS <= r.y && r.y <= Math.max(p.y, q.y) + EPS;
    return on(c, d, a) || on(c, d, b) || on(a, b, c) || on(a, b, d);
  }

  function addContour(project, points, { levelId } = {}) {
    const pts = cleanPoints(points);
    const err = problem(pts);
    if (err) throw new Error(err);
    const c = { id: nextContourId(project), levelId: levelId || project.levels[0].id, closed: true, points: pts };
    list(project).push(c);
    P().touch(project);
    return c;
  }

  /** Новые вершины контура; связанные элементы перестраиваются (при невозможности — Error, модель не меняется у вызывающего). */
  function setPoints(project, id, points, { rebuild: doRebuild = true } = {}) {
    const c = get(project, id);
    if (!c) throw new Error(`Контур ${id} не найден`);
    const pts = cleanPoints(points);
    const err = problem(pts);
    if (err) throw new Error(err);
    c.points = pts;
    const notes = doRebuild && linked(project, id).length ? rebuild(project, id).notes : [];
    P().touch(project);
    return notes;
  }

  function removeContour(project, id, { withElements = false } = {}) {
    const ids = linked(project, id).map((e) => e.id);
    if (withElements) P().removeElements(project, ids);
    else for (const e of linked(project, id)) { delete e.params.contourId; delete e.params.generatedBy; delete e.params.edgeFrom; delete e.params.edgeStart; }
    ensurePlan(project).contours = list(project).filter((c) => c.id !== id);
    P().touch(project);
  }

  /** Прямоугольный контур по размерам дома (быстрый старт). */
  function rectangle(x0, y0, length, width) {
    return [{ x: x0, y: y0 }, { x: x0 + length, y: y0 }, { x: x0 + length, y: y0 + width }, { x: x0, y: y0 + width }];
  }

  function linked(project, id, gen = null) {
    return project.elements.filter((e) => e.params && e.params.contourId === id && (!gen || e.params.generatedBy === gen));
  }

  // ---------------------------------------------------------------- рёбра и полосы

  function edges(points) {
    const n = points.length;
    return points.map((a, i) => {
      const b = points[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      return { i, a, b, len, d, n: { x: -d.y, y: d.x }, from: a.id };
    });
  }

  const dot = (p, q) => p.x * q.x + p.y * q.y;
  const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
  const addv = (p, q, k = 1) => ({ x: p.x + q.x * k, y: p.y + q.y * k });

  /** Точка линии грани: ребро e, смещение внутрь v. */
  function linePoint(e, v) {
    return addv(e.a, e.n, v);
  }

  function intersect(e1, v1, e2, v2) {
    const p = linePoint(e1, v1), q = addv(p, e1.d);
    const c = linePoint(e2, v2), d = addv(c, e2.d);
    return G.lineIntersection(p, q, c, d);
  }

  const uOf = (e, p) => dot(sub(p, e.a), e.d);
  const vOf = (e, p) => dot(sub(p, e.a), e.n);

  /**
   * Интервал параметра s прямой base + s·dir внутри прямоугольника полосы e:
   * u ∈ [uMin, uMax], v ∈ [vMin, vMax]. Возвращает [lo, hi] или null.
   */
  function lineInBand(base, dir, e, uMin, uMax, vMin, vMax) {
    let lo = -Infinity, hi = Infinity;
    const cons = [[uOf(e, base), dot(dir, e.d), uMin, uMax], [vOf(e, base), dot(dir, e.n), vMin, vMax]];
    for (const [c0, c1, mn, mx] of cons) {
      if (Math.abs(c1) < 1e-12) {
        if (c0 < mn - 1e-6 || c0 > mx + 1e-6) return null;
        continue;
      }
      let s0 = (mn - 1e-6 - c0) / c1, s1 = (mx + 1e-6 - c0) / c1;
      if (s0 > s1) [s0, s1] = [s1, s0];
      lo = Math.max(lo, s0);
      hi = Math.min(hi, s1);
    }
    return lo <= hi ? [lo, hi] : null;
  }

  /**
   * Раскладка полос (стен или лент) по рёбрам контура с угловыми стыками встык.
   * bands[i] = { o, t }: полоса ребра i занимает смещения внутрь v ∈ [o, o + t].
   * В каждом углу «ведущим» считается ребро с меньшим номером: оно доходит до угла целиком,
   * второе упирается в его грань. Для непрямых углов стык считается по линиям граней:
   * без выступов наружу и без щелей внутри (при остром угле < 90° возможен зазор на острие — warn).
   * @returns {{ items: Array<{start, end}>, notes: string[] }} start/end — вдоль ребра от его начала, м.
   */
  function bandLayout(points, bands) {
    const es = edges(points);
    const n = es.length;
    const items = es.map((e) => ({ start: 0, end: e.len }));
    const notes = [];
    for (let k = 0; k < n; k++) {
      const ia = (k + n - 1) % n, ib = k; // вершина k — конец ребра ia и начало ребра ib
      const a = es[ia], b = es[ib], ba = bands[ia], bb = bands[ib];
      const cr = a.d.x * b.d.y - a.d.y * b.d.x;
      if (Math.abs(cr) < 1e-6) continue; // продолжение прямой: стык встык в вершине
      const { aEnd, bStart } = solveCorner(a, ba, b, bb, ia < ib);
      items[ia].end = aEnd;
      items[ib].start = bStart;
      const angle = interiorAngle(a, b);
      if (angle < 89.5) notes.push(`Острый угол ${U.fmt(angle, 0)}° у вершины ${k + 1}: стык упрощён, на острие возможен небольшой зазор`);
    }
    items.forEach((it, i) => {
      if (it.end - it.start < 0.05) notes.push(`Ребро ${i + 1} слишком короткое для толщины стен — элемент по нему не строится`);
    });
    return { items, notes, edges: es };
  }

  /**
   * Угловой стык двух полос: a — входящее в угол ребро (угол у его конца), b — исходящее (угол у начала).
   * ba/bb = { o, t } — смещение наружной грани внутрь и толщина. ownerIsA — какая полоса доходит до угла.
   * @returns {{ aEnd: number, bStart: number }} вдоль рёбер от их начальных точек.
   */
  function solveCorner(a, ba, b, bb, ownerIsA) {
    const Pp = intersect(a, ba.o, b, bb.o), Qq = intersect(a, ba.o + ba.t, b, bb.o + bb.t);
    const X = intersect(a, ba.o + ba.t, b, bb.o), Y = intersect(a, ba.o, b, bb.o + bb.t);
    // Ограничения «не выходить за наружную грань соседа» действуют только на выпуклом углу
    const aLimit = () => {
      const kk = dot(a.d, b.n);
      if (kk >= -1e-9) return Infinity;
      let lim = Infinity;
      for (const v of [ba.o, ba.o + ba.t]) {
        const c = dot(sub(linePoint(a, v), b.a), b.n) - bb.o;
        lim = Math.min(lim, -c / kk);
      }
      return lim;
    };
    const bLimit = () => {
      const kk = dot(b.d, a.n);
      if (kk <= 1e-9) return -Infinity;
      let lim = -Infinity;
      for (const v of [bb.o, bb.o + bb.t]) {
        const c = dot(sub(linePoint(b, v), a.a), a.n) - ba.o;
        lim = Math.max(lim, -c / kk);
      }
      return lim;
    };
    let aEnd, bStart;
    if (ownerIsA) {
      aEnd = Math.min(Math.max(uOf(a, Pp), uOf(a, Qq)), aLimit());
      // Ребро b начинается там, где кончается покрытие ведущей полосы на обеих его гранях
      const starts = [[bb.o, Pp, X], [bb.o + bb.t, Y, Qq]].map(([v, p1, p2]) => {
        const s0 = Math.min(uOf(b, p1), uOf(b, p2)), s1 = Math.max(uOf(b, p1), uOf(b, p2));
        const iv = lineInBand(linePoint(b, v), b.d, a, -Infinity, aEnd, ba.o, ba.o + ba.t);
        if (iv && iv[0] <= s0 + 1e-6) return Math.min(Math.max(iv[1], s0), s1);
        return s0;
      });
      // Часть полосы b вне полосы a (за гранью a, через которую уходит тело b) должна быть закрыта самой b
      const viaInner = dot(b.d, a.n) > 0;
      const bound = viaInner ? [X, Qq] : [Pp, Y];
      const need = Math.min(...bound.map((q) => uOf(b, q)));
      bStart = Math.max(Math.min(...starts, need), bLimit());
    } else {
      bStart = Math.max(Math.min(uOf(b, Pp), uOf(b, Qq)), bLimit());
      const ends = [[ba.o, Pp, Y], [ba.o + ba.t, X, Qq]].map(([v, p1, p2]) => {
        const s0 = Math.min(uOf(a, p1), uOf(a, p2)), s1 = Math.max(uOf(a, p1), uOf(a, p2));
        const iv = lineInBand(linePoint(a, v), a.d, b, bStart, Infinity, bb.o, bb.o + bb.t);
        if (iv && iv[1] >= s1 - 1e-6) return Math.max(Math.min(iv[0], s1), s0);
        return s1;
      });
      const viaInner = dot({ x: -a.d.x, y: -a.d.y }, b.n) > 0;
      const bound = viaInner ? [Y, Qq] : [Pp, X];
      const need = Math.max(...bound.map((q) => uOf(a, q)));
      aEnd = Math.min(Math.max(...ends, need), aLimit());
    }
    return { aEnd, bStart };
  }

  /** Внутренний угол контура (против часовой стрелки) в вершине между рёбрами a и b, градусы. */
  function interiorAngle(a, b) {
    const turn = Math.atan2(a.d.x * b.d.y - a.d.y * b.d.x, dot(a.d, b.d)) * 180 / Math.PI; // + влево
    return 180 - turn;
  }

  /** Контур, смещённый внутрь на offsets[i] по каждому ребру (вершины — пересечения смещённых рёбер). */
  function offsetPolygon(points, offsets) {
    const es = edges(points);
    const n = es.length;
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = es[(k + n - 1) % n], b = es[k];
      const cr = a.d.x * b.d.y - a.d.y * b.d.x;
      const oa = offsets[(k + n - 1) % n], ob = offsets[k];
      if (Math.abs(cr) < 1e-6) { out.push(linePoint(b, ob)); continue; }
      out.push(intersect(a, oa, b, ob));
    }
    return out.map((p) => ({ x: U.round(p.x, 4), y: U.round(p.y, 4) }));
  }

  const isAxisRect = (pts) => pts.length === 4 && pts.every((p, i) => {
    const q = pts[(i + 1) % 4];
    return Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.y - q.y) < 1e-6;
  });

  /** Положение и размеры плиты по многоугольнику: прямоугольник по осям — брус, иначе — контур в params.points. */
  function applyPolygon(el, poly, height) {
    const b = G.bbox2(poly);
    el.position = { x: U.round(b.minX, 3), y: U.round(b.minY, 3), z: el.position ? el.position.z : 0 };
    el.rotation = 0;
    el.size = { ...el.size, length: U.round(b.maxX - b.minX, 3), width: U.round(b.maxY - b.minY, 3), height };
    if (isAxisRect(poly)) delete el.params.points;
    else el.params.points = poly.map((p) => ({ x: U.round(p.x - b.minX, 4), y: U.round(p.y - b.minY, 4) }));
  }

  // ---------------------------------------------------------------- построение по контуру

  function contourOrThrow(project, id) {
    const c = get(project, id);
    if (!c) throw new Error("Сначала нарисуйте контур дома на плане");
    const err = problem(c.points);
    if (err) throw new Error(`Контур ${c.id}: ${err}`);
    return c;
  }

  function lvOf(project, c) {
    return P().level(project, c.levelId);
  }

  /** Толщины стен по рёбрам: из существующих стен контура, иначе по умолчанию. */
  function wallThicknesses(project, c, fallback) {
    const walls = linked(project, c.id, GEN.wall);
    return c.points.map((p) => {
      const w = walls.find((x) => x.params.edgeFrom === p.id);
      return w ? w.size.thickness : fallback;
    });
  }

  /**
   * Фундамент по контуру. type "slab" — плита-призма по контуру (thickness), "strip" — ленты по рёбрам
   * (width, depth) под осью стен. Прежний фундамент этого контура заменяется.
   */
  function foundationFromContour(project, contourId, opts = {}) {
    const c = contourOrThrow(project, contourId);
    const lv = lvOf(project, c);
    const h = project.house;
    P().removeElements(project, [...linked(project, c.id, GEN.foundation), ...linked(project, c.id, GEN.strip)].map((e) => e.id));
    const top = lv.elevation;
    const created = [];
    if ((opts.type || "slab") === "slab") {
      const t = U.clamp(Number(opts.thickness) || h.foundationThickness, 0.1, 3);
      const el = P().addElement(project, "slab_foundation", {
        name: "Фундаментная плита", levelId: lv.id, position: { x: 0, y: 0, z: U.round(top - t, 3) },
        params: { contourId: c.id, generatedBy: GEN.foundation },
      });
      applyPolygon(el, c.points, t);
      el.position.z = U.round(top - t, 3);
      P().normalize(project, el);
      created.push(el);
    } else {
      const w = U.clamp(Number(opts.width) || 0.5, 0.2, 2);
      const depth = U.clamp(Number(opts.depth) || 1.2, 0.2, 4);
      const tw = wallThicknesses(project, c, Number(opts.wallThickness) || h.wallThickness);
      const { items, edges: es } = bandLayout(c.points, tw.map((t) => ({ o: (t - w) / 2, t: w })));
      es.forEach((e, i) => {
        const it = items[i];
        if (it.end - it.start < 0.05) return;
        const o = (tw[i] - w) / 2;
        const p0 = addv(linePoint(e, o), e.d, it.start);
        const el = P().addElement(project, "strip_foundation", {
          name: `Лента ${i + 1}`, levelId: lv.id,
          position: { x: U.round(p0.x, 3), y: U.round(p0.y, 3), z: U.round(top - depth, 3) },
          rotation: U.round(Math.atan2(e.d.y, e.d.x) * 180 / Math.PI, 4),
          size: { length: U.round(it.end - it.start, 3), width: w, height: depth },
          params: { contourId: c.id, generatedBy: GEN.strip, edgeFrom: e.from, edgeStart: U.round(it.start, 4) },
        });
        created.push(el);
      });
    }
    const notes = linked(project, c.id, GEN.wall).length ? rebuild(project, c.id).notes : [];
    P().touch(project);
    return { created, notes };
  }

  /** Наружные стены по рёбрам контура (повторный вызов — перестройка с новыми параметрами). */
  function wallsFromContour(project, contourId, opts = {}) {
    const c = contourOrThrow(project, contourId);
    const res = rebuild(project, c.id, { walls: { thickness: opts.thickness, height: opts.height, material: opts.material, create: true } });
    return { created: linked(project, c.id, GEN.wall), notes: res.notes };
  }

  /** Перекрытие по контуру: kind "ground" — пол внутри стен, "floor" — перекрытие на верхе стен этажа. */
  function slabFromContour(project, contourId, opts = {}) {
    const c = contourOrThrow(project, contourId);
    const kind = opts.kind || "ground";
    const gen = kind === "ground" ? GEN.slab : GEN.floor;
    const t = U.clamp(Number(opts.thickness) || project.house.slabThickness, 0.05, 1);
    if (kind === "floor" && !linked(project, c.id, GEN.wall).length) throw new Error("Перекрытие над этажом ложится на стены — сначала постройте стены по контуру");
    P().removeElements(project, linked(project, c.id, gen).map((e) => e.id));
    const lv = lvOf(project, c);
    const above = project.levels.filter((l) => l.elevation > lv.elevation + 0.01).sort((a, b) => a.elevation - b.elevation)[0];
    const el = P().addElement(project, "slab", {
      name: kind === "ground" ? `Пол (${lv.name.toLowerCase()})` : `Перекрытие над «${lv.name}»`,
      category: kind === "ground" ? (lv.elevation < 0.5 ? "ground" : "floor") : (above ? "floor" : "attic"),
      levelId: kind === "floor" && above ? above.id : lv.id,
      size: { height: t }, params: { contourId: c.id, generatedBy: gen },
    });
    const notes = rebuild(project, c.id).notes;
    return { created: [el], notes };
  }

  /** Крыша над контуром (габарит стен контура + свес); существующая крыша контура заменяется. */
  function roofFromContour(project, contourId, opts = {}) {
    const c = contourOrThrow(project, contourId);
    const walls = linked(project, c.id, GEN.wall);
    if (!walls.length) throw new Error("Сначала постройте стены по контуру — крыше не на что опереться");
    P().removeElements(project, linked(project, c.id, GEN.roof).map((e) => e.id));
    const h = project.house;
    const el = P().addElement(project, "roof", {
      levelId: c.levelId, name: "Крыша",
      params: { roofType: opts.roofType || h.roofType, slope: opts.slope ?? h.roofSlope, thickness: 0.25,
        overhang: opts.overhang ?? h.roofOverhang, contourId: c.id, generatedBy: GEN.roof },
    });
    if (opts.material) el.material = opts.material;
    const notes = rebuild(project, c.id).notes;
    return { created: [el], notes };
  }

  // ---------------------------------------------------------------- раскладка крыши по контуру

  const ROOF_MAX_PARTS = 6;

  /**
   * Делит контур из прямых углов на части крыши: основной объём и крылья.
   * Возвращает [{ x, y, rotation, length, width }] (мировые координаты, конёк — вдоль length) или
   * null, если в контуре есть косые рёбра или он слишком дробный — тогда крыша строится по габариту.
   * Свес oh — только по наружным сторонам; крыло заходит в основной объём до его конька, и фронтон
   * крыла прячется под скатом (обычное примыкание двускатных крыш Г-, Т-, П-образного дома).
   */
  function roofLayout(points, oh) {
    const n = points.length;
    let a = null;
    for (let i = 0; i < n && a === null; i++) {
      const p = points[i], q = points[(i + 1) % n];
      if (Math.hypot(q.x - p.x, q.y - p.y) > EPS) a = Math.atan2(q.y - p.y, q.x - p.x);
    }
    if (a === null) return null;
    const quarter = Math.PI / 2;
    a -= quarter * Math.round(a / quarter); // ось кадра — ближайшая к оси X, в пределах ±45°
    const d = { x: Math.cos(a), y: Math.sin(a) };
    const nn = { x: -d.y, y: d.x };
    const loc = points.map((p) => ({ x: p.x * d.x + p.y * d.y, y: p.x * nn.x + p.y * nn.y }));
    for (let i = 0; i < n; i++) {
      const p = loc[i], q = loc[(i + 1) % n];
      if (Math.abs(q.x - p.x) > 1e-4 && Math.abs(q.y - p.y) > 1e-4) return null; // косое ребро
    }
    const uniq = (v) => [...new Set(v.map((x) => U.round(x, 4)))].sort((m, k) => m - k);
    const xs = uniq(loc.map((p) => p.x)), ys = uniq(loc.map((p) => p.y));
    if (xs.length > 12 || ys.length > 12) return null;
    const NI = xs.length - 1, NJ = ys.length - 1;
    const inside = (i, j) => i >= 0 && j >= 0 && i < NI && j < NJ &&
      G.pointInPolygon({ x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 }, loc);
    const cell = [];
    for (let i = 0; i < NI; i++) { cell.push([]); for (let j = 0; j < NJ; j++) cell[i].push(inside(i, j)); }
    const used = cell.map((r) => r.map(() => false));
    const free = (i, j) => cell[i][j] && !used[i][j];

    // 1. Разбиение на прямоугольники без наложений: каждый раз — наибольший из свободных клеток
    const rects = [];
    for (;;) {
      let best = null;
      for (let i0 = 0; i0 < NI; i0++) for (let j0 = 0; j0 < NJ; j0++) {
        for (let i1 = i0; i1 < NI && free(i1, j0); i1++) {
          for (let j1 = j0; j1 < NJ; j1++) {
            let ok = true;
            for (let i = i0; i <= i1 && ok; i++) ok = free(i, j1);
            if (!ok) break;
            const area = (xs[i1 + 1] - xs[i0]) * (ys[j1 + 1] - ys[j0]);
            if (!best || area > best.area + EPS) best = { i0, i1, j0, j1, area };
          }
        }
      }
      if (!best) break;
      for (let i = best.i0; i <= best.i1; i++) for (let j = best.j0; j <= best.j1; j++) used[i][j] = true;
      rects.push(best);
      if (rects.length > ROOF_MAX_PARTS) return null;
    }
    if (!rects.length) return null;

    // 2. Сторона, хоть частью лежащая на контуре, — наружная (со свесом); остальные — примыкания
    const sideOuter = (r, side) => {
      if (side === "x0" || side === "x1") {
        const i = side === "x0" ? r.i0 - 1 : r.i1 + 1;
        for (let j = r.j0; j <= r.j1; j++) if (!inside(i, j)) return true;
      } else {
        const j = side === "y0" ? r.j0 - 1 : r.j1 + 1;
        for (let i = r.i0; i <= r.i1; i++) if (!inside(i, j)) return true;
      }
      return false;
    };
    const parts = rects.map((r) => ({
      r, x0: xs[r.i0], x1: xs[r.i1 + 1], y0: ys[r.j0], y1: ys[r.j1 + 1], ridge: null,
      ext: { x0: 0, x1: 0, y0: 0, y1: 0 },
    }));
    for (const pt of parts) for (const side of ["x0", "x1", "y0", "y1"]) if (sideOuter(pt.r, side)) pt.ext[side] = oh;

    // 3. Конёк: у основного объёма — вдоль длинной стороны; у крыла — поперёк стороны примыкания
    const e4 = 1e-4;
    const touches = (pt, side, D) => {
      if (side === "y0") return Math.abs(D.y1 - pt.y0) < e4 && D.x0 < pt.x1 - e4 && D.x1 > pt.x0 + e4;
      if (side === "y1") return Math.abs(D.y0 - pt.y1) < e4 && D.x0 < pt.x1 - e4 && D.x1 > pt.x0 + e4;
      if (side === "x0") return Math.abs(D.x1 - pt.x0) < e4 && D.y0 < pt.y1 - e4 && D.y1 > pt.y0 + e4;
      return Math.abs(D.x0 - pt.x1) < e4 && D.y0 < pt.y1 - e4 && D.y1 > pt.y0 + e4;
    };
    parts.forEach((pt, k) => {
      const dx = pt.x1 - pt.x0, dy = pt.y1 - pt.y0;
      const own = dx >= dy ? "x" : "y";
      if (k === 0) { pt.ridge = own; return; }
      for (const side of ["y0", "y1", "x0", "x1"]) {
        if (pt.ext[side] > 0) continue;
        const axis = side[0]; // конёк крыла — поперёк стороны примыкания
        const D = parts.slice(0, k).find((q) => q.ridge && q.ridge !== axis && touches(pt, side, q));
        if (!D) continue;
        const span = axis === "y" ? dx : dy, spanD = axis === "y" ? D.y1 - D.y0 : D.x1 - D.x0;
        if (span > spanD + e4) continue; // крыло шире основного объёма — его фронтон не спрятать
        pt.ridge = axis;
        if (side === "y0") pt.ext.y0 = pt.y0 - (D.y0 + D.y1) / 2;
        else if (side === "y1") pt.ext.y1 = (D.y0 + D.y1) / 2 - pt.y1;
        else if (side === "x0") pt.ext.x0 = pt.x0 - (D.x0 + D.x1) / 2;
        else pt.ext.x1 = (D.x0 + D.x1) / 2 - pt.x1;
        return;
      }
      pt.ridge = own;
    });

    // 4. В мировые координаты: угол элемента и поворот (ось length — конёк)
    const world = (u, v) => ({ x: u * d.x + v * nn.x, y: u * d.y + v * nn.y });
    const deg = a / G.DEG;
    return parts.map((pt) => {
      const x0 = pt.x0 - pt.ext.x0, x1 = pt.x1 + pt.ext.x1, y0 = pt.y0 - pt.ext.y0, y1 = pt.y1 + pt.ext.y1;
      if (pt.ridge === "x") return { ...world(x0, y0), rotation: deg, length: x1 - x0, width: y1 - y0 };
      return { ...world(x1, y0), rotation: deg + 90, length: y1 - y0, width: x1 - x0 };
    });
  }

  // ---------------------------------------------------------------- перестройка

  /**
   * Перестраивает элементы, связанные с контуром: фундамент, ленты, стены (с проёмами и перемычками),
   * перекрытия, крышу. Если перестроить нельзя (например, проём больше новой стены) — Error с понятным
   * текстом; вызывающий код (edit в app.js) откатывает изменение целиком.
   * overrides.walls = { thickness, height, material, create } — новые параметры всех стен контура.
   */
  function rebuild(project, contourId, overrides = {}) {
    const Pm = P();
    const c = contourOrThrow(project, contourId);
    const lv = lvOf(project, c);
    const h = project.house;
    const notes = [];
    const ow = overrides.walls || {};

    // 1. Плитный фундамент — по контуру, верх остаётся на месте
    for (const f of linked(project, c.id, GEN.foundation)) {
      const t = f.size.height;
      const top = f.position.z + t;
      applyPolygon(f, c.points, t);
      f.position.z = U.round(top - t, 3);
      Pm.normalize(project, f);
    }

    // 2. Стены
    const oldWalls = linked(project, c.id, GEN.wall);
    const wantWalls = oldWalls.length > 0 || ow.create;
    const es = edges(c.points);
    const thick = c.points.map((p) => {
      const w = oldWalls.find((x) => x.params.edgeFrom === p.id);
      return U.clamp(Number(ow.thickness) || (w ? w.size.thickness : h.wallThickness), 0.05, 1.2);
    });
    const ownIds = linked(project, c.id).filter((e) => e.type !== "slab_foundation" && e.type !== "strip_foundation").map((e) => e.id);
    if (wantWalls) {
      const { items, notes: ln } = bandLayout(c.points, thick.map((t) => ({ o: 0, t })));
      notes.push(...ln);
      const keep = new Set();
      es.forEach((e, i) => {
        const it = items[i];
        const len = it.end - it.start;
        let w = oldWalls.find((x) => x.params.edgeFrom === e.from);
        if (len < 0.2) {
          if (w && Pm.hosted(project, w.id).length) throw new Error(`Стена «${w.name}» стала короче 0,2 м, а в ней есть проёмы — перестройка отменена`);
          return;
        }
        const p0 = addv(e.a, e.d, it.start);
        const samples = [0.02, 0.5, 0.98].map((f) => addv(addv(e.a, e.d, it.start + len * f), e.n, thick[i] / 2));
        // Стена садится на фундамент или перекрытие под ней; плиты и крыша самого контура не в счёт
        const z = BS.support.supportLevel(project, samples, { below: lv.elevation + 0.35, fallback: lv.elevation, excludeIds: ownIds });
        const autoH = Math.max(0.5, lv.elevation + lv.height - z);
        const height = U.clamp(Number(ow.height) || (w ? w.size.height : autoH), 0.5, 10);
        const spec = {
          position: { x: U.round(p0.x, 3), y: U.round(p0.y, 3), z: U.round(z, 3) },
          rotation: U.round(Math.atan2(e.d.y, e.d.x) * 180 / Math.PI, 4),
          size: { length: U.round(len, 3), thickness: thick[i], height: U.round(height, 3) },
        };
        if (!w) {
          w = Pm.addElement(project, "wall", {
            ...spec, category: "exterior", levelId: lv.id, material: ow.material || "brick",
            params: { contourId: c.id, generatedBy: GEN.wall, edgeFrom: e.from, edgeStart: U.round(it.start, 4) },
          });
          w.name = `Стена ${i + 1} (контур ${c.id})`;
        } else {
          const shift = (w.params.edgeStart || 0) - it.start; // проёмы остаются на месте вдоль ребра
          for (const o of Pm.hosted(project, w.id)) {
            if (o.size.width > spec.size.length + 1e-9) {
              throw new Error(`Проём «${o.name}» (ширина ${U.fmt(o.size.width)} м) не помещается в стену «${w.name}» длиной ${U.fmt(spec.size.length)} м — перестройка отменена. Уменьшите проём или удлините ребро.`);
            }
            if (o.position.elevation + o.size.height > spec.size.height + 1e-9) {
              throw new Error(`Проём «${o.name}» выше новой стены «${w.name}» (${U.fmt(spec.size.height)} м) — перестройка отменена`);
            }
            let off = o.position.offset + shift;
            const max = spec.size.length - o.size.width;
            if (off < -1e-9 || off > max + 1e-9) {
              notes.push(`Проём «${o.name}» сдвинут, чтобы остаться в стене «${w.name}»`);
              off = U.clamp(off, 0, max);
            }
            o.position.offset = U.round(off, 3);
          }
          Object.assign(w.position, spec.position);
          w.rotation = spec.rotation;
          Object.assign(w.size, spec.size);
          w.params.edgeStart = U.round(it.start, 4);
          if (ow.material) w.material = ow.material;
        }
        Pm.normalize(project, w);
        for (const o of Pm.hosted(project, w.id)) Pm.normalize(project, o);
        keep.add(w.id);
        // Перемычки стены пересоздаются по новому положению
        const lintels = project.elements.filter((l) => l.type === "lintel" && l.params && l.params.hostWallId === w.id);
        if (lintels.length) {
          Pm.removeElements(project, lintels.map((l) => l.id));
          Pm.addLintels(project, w.id);
        }
      });
      const gone = oldWalls.filter((w) => !keep.has(w.id));
      if (gone.length) {
        notes.push(`Удалены стены удалённых рёбер: ${gone.map((w) => w.name).join(", ")}`);
        const lint = project.elements.filter((l) => l.type === "lintel" && gone.some((w) => w.id === l.params.hostWallId));
        Pm.removeElements(project, [...gone, ...lint].map((e) => e.id));
      }
    }

    // 3. Ленточный фундамент — под осью стен
    const strips = linked(project, c.id, GEN.strip);
    if (strips.length) {
      const w0 = strips[0].size.width, d0 = strips[0].size.height;
      const top = strips[0].position.z + d0;
      const tw = wallThicknesses(project, c, h.wallThickness);
      const { items } = bandLayout(c.points, tw.map((t) => ({ o: (t - w0) / 2, t: w0 })));
      const keep = new Set();
      es.forEach((e, i) => {
        const it = items[i];
        if (it.end - it.start < 0.05) return;
        const o = (tw[i] - w0) / 2;
        const p0 = addv(linePoint(e, o), e.d, it.start);
        let s = strips.find((x) => x.params.edgeFrom === e.from);
        const pos = { x: U.round(p0.x, 3), y: U.round(p0.y, 3), z: U.round(top - d0, 3) };
        const rot = U.round(Math.atan2(e.d.y, e.d.x) * 180 / Math.PI, 4);
        if (!s) {
          s = Pm.addElement(project, "strip_foundation", { name: `Лента ${i + 1}`, levelId: lv.id, position: pos, rotation: rot,
            size: { length: 1, width: w0, height: d0 }, params: { contourId: c.id, generatedBy: GEN.strip, edgeFrom: e.from } });
        }
        s.position = pos;
        s.rotation = rot;
        s.size.length = U.round(it.end - it.start, 3);
        s.params.edgeStart = U.round(it.start, 4);
        Pm.normalize(project, s);
        keep.add(s.id);
      });
      Pm.removeElements(project, strips.filter((s) => !keep.has(s.id)).map((s) => s.id));
    }

    // 4. Перекрытия
    const walls = linked(project, c.id, GEN.wall);
    const wallTop = walls.length ? Math.max(...walls.map((w) => S.top(w, project))) : lv.elevation + lv.height;
    for (const s of linked(project, c.id, GEN.slab)) {
      const tw = wallThicknesses(project, c, walls.length ? h.wallThickness : 0);
      const poly = offsetPolygon(c.points, tw);
      if (problem(poly) || G.polygonArea(poly) <= 0) throw new Error("Толщина стен слишком велика для контура: пол внутри стен не помещается — перестройка отменена");
      applyPolygon(s, poly, s.size.height);
      const probe = { ...s, id: "__probe__", position: { ...s.position } };
      const pts = BS.support.samplePoints(probe, project);
      s.position.z = U.round(BS.support.supportLevel(project, pts, { below: lv.elevation + 0.35, fallback: lv.elevation, excludeIds: ownIds }), 3);
      Pm.normalize(project, s);
    }
    for (const s of linked(project, c.id, GEN.floor)) {
      applyPolygon(s, c.points, s.size.height);
      s.position.z = U.round(wallTop, 3);
      Pm.normalize(project, s);
    }

    // 5. Крыша — над стенами контура (или над перекрытием на них) со свесом. Контур из прямых углов
    //    (Г, Т, П, крест) — по частям, иначе — одна крыша по габариту стен.
    const roofs = linked(project, c.id, GEN.roof).sort((m, k) => (m.params.part || 0) - (k.params.part || 0));
    if (roofs.length) {
      const first = roofs[0];
      const oh = first.params.overhang ?? h.roofOverhang;
      const floors = linked(project, c.id, GEN.floor);
      const z = floors.length ? Math.max(...floors.map((f) => S.top(f, project))) : wallTop;
      let layout = first.params.roofType === "shed" ? null : roofLayout(c.points, oh);
      if (layout && layout.length === 1) layout = null; // один прямоугольник — как раньше, по габариту стен
      if (!layout) {
        const src = walls.length ? walls.flatMap((w) => S.footprint(w, project)) : c.points;
        const b = G.bbox2(src);
        layout = [{ x: b.minX - oh, y: b.minY - oh, rotation: 0, length: b.maxX - b.minX + 2 * oh, width: b.maxY - b.minY + 2 * oh }];
        if (G.polygonArea(c.points) < (b.maxX - b.minX) * (b.maxY - b.minY) - 0.01) {
          notes.push(first.params.roofType === "shed"
            ? "Односкатная крыша строится по габариту дома — над вогнутыми углами будут свесы"
            : "В контуре есть косые углы — крыша построена по габариту дома");
        }
      }
      Pm.removeElements(project, roofs.slice(layout.length).map((e) => e.id));
      layout.forEach((q, k) => {
        let r = roofs[k];
        if (!r) {
          r = Pm.addElement(project, "roof", { levelId: first.levelId, params: U.clone(first.params) });
          r.material = first.material;
        }
        r.params.part = k;
        r.name = layout.length > 1 ? (k === 0 ? "Крыша — основной объём" : `Крыша — крыло ${k}`) : "Крыша";
        r.position = { x: U.round(q.x, 3), y: U.round(q.y, 3), z: U.round(z, 3) };
        r.rotation = U.round(q.rotation, 3);
        r.size.length = U.round(q.length, 3);
        r.size.width = U.round(q.width, 3);
        Pm.normalize(project, r);
      });
    }
    Pm.touch(project);
    return { notes: [...new Set(notes)] };
  }

  // ---------------------------------------------------------------- стык стен, нарисованных мышью

  /**
   * Представление стены как полосы для solveCorner. corner: "start" | "end" — где у стены угол;
   * role: "in" (угол в конце полосы) | "out" (угол в начале). inward — направление биссектрисы угла
   * между телами двух стен: «внутренние» грани обращены к нему, наружные — от него.
   */
  function wallBand(w, corner, role, bisector) {
    const r = (w.rotation || 0) * G.DEG;
    const d = { x: Math.cos(r), y: Math.sin(r) };
    const nW = { x: -d.y, y: d.x };
    const L = w.size.length, t = w.size.thickness;
    const p0 = { x: w.position.x, y: w.position.y };
    const p1 = addv(p0, d, L);
    const flip = (corner === "end") !== (role === "in"); // направление полосы против оси стены
    const dir = flip ? { x: -d.x, y: -d.y } : d;
    const base0 = flip ? p1 : p0;
    const innerPlus = dot(bisector, nW) >= 0;
    const a = innerPlus ? base0 : addv(base0, nW, t);
    const n = innerPlus ? nW : { x: -nW.x, y: -nW.y };
    return {
      edge: { a, d: dir, n }, band: { o: 0, t },
      /** Новые [start, end] вдоль оси стены по координате полосы у угла. */
      apply(uBand) {
        const u = flip ? L - uBand : uBand;
        return corner === "start" ? [u, L] : [0, u];
      },
    };
  }

  /** Угловое примыкание (Г-стык) двух стен: какие концы встречаются, или null. */
  function findCorner(nw, ew) {
    const axis = (w) => {
      const r = (w.rotation || 0) * G.DEG;
      const d = { x: Math.cos(r), y: Math.sin(r) };
      const nn = { x: -d.y, y: d.x };
      const c = addv(w.position, nn, w.size.thickness / 2);
      return { c, d, L: w.size.length };
    };
    const A = axis(nw), B = axis(ew);
    if (Math.abs(A.d.x * B.d.y - A.d.y * B.d.x) < 0.05) return null; // параллельные — не угол
    const M = G.lineIntersection(A.c, addv(A.c, A.d), B.c, addv(B.c, B.d));
    const tol = Math.max(nw.size.thickness, ew.size.thickness) + 0.05;
    const uA = dot(sub(M, A.c), A.d), uB = dot(sub(M, B.c), B.d);
    const endA = Math.abs(uA) <= tol ? "start" : Math.abs(uA - A.L) <= tol ? "end" : null;
    const endB = Math.abs(uB) <= tol ? "start" : Math.abs(uB - B.L) <= tol ? "end" : null;
    if (!endA || !endB) return null;
    const bodyA = endA === "start" ? A.d : { x: -A.d.x, y: -A.d.y };
    const bodyB = endB === "start" ? B.d : { x: -B.d.x, y: -B.d.y };
    return { endA, endB, bisector: addv(bodyA, bodyB), dist: Math.abs(endA === "start" ? uA : uA - A.L) };
  }

  /** Меняет начало/конец стены вдоль оси; проёмы остаются на месте. */
  function setWallSpan(project, w, start, end) {
    if (end - start < 0.2) return false;
    const r = (w.rotation || 0) * G.DEG;
    if (Math.abs(start) > 1e-9) {
      w.position.x = U.round(w.position.x + Math.cos(r) * start, 3);
      w.position.y = U.round(w.position.y + Math.sin(r) * start, 3);
      for (const o of P().hosted(project, w.id)) o.position.offset = U.round(o.position.offset - start, 3);
    }
    w.size.length = U.round(end - start, 3);
    return true;
  }

  /**
   * Стыкует концы новой стены с соседними стенами, если они сходятся в угол (Г-стык): существующая стена
   * доходит до угла (при необходимости удлиняется или укорачивается), новая упирается в неё. Углы любых
   * знаков (выпуклые и вогнутые) и разной толщины — без выступа наружу и без щели.
   * @returns {{ start: boolean, end: boolean }} какие концы новой стены состыкованы.
   */
  function joinWallCorners(project, w) {
    const done = { start: false, end: false };
    const others = project.elements.filter((o) => o.type === "wall" && o.id !== w.id &&
      Math.min(S.top(o, project), S.top(w, project)) - Math.max(S.bottom(o, project), S.bottom(w, project)) > 0.02);
    for (const which of ["start", "end"]) {
      let best = null;
      for (const o of others) {
        const c = findCorner(w, o);
        if (c && c.endA === which && (!best || c.dist < best.c.dist)) best = { o, c };
      }
      if (!best) continue;
      const { o, c } = best;
      // Существующая стена ведёт; полоса «in» — та, у которой угол в конце
      const newIn = which === "end";
      const bandNew = wallBand(w, which, newIn ? "in" : "out", c.bisector);
      const bandOld = wallBand(o, c.endB, newIn ? "out" : "in", c.bisector);
      const [A, B] = newIn ? [bandNew, bandOld] : [bandOld, bandNew];
      const res = solveCorner(A.edge, A.band, B.edge, B.band, !newIn);
      const spanA = A.apply(res.aEnd), spanB = B.apply(res.bStart);
      const [spanNew, spanOld] = newIn ? [spanA, spanB] : [spanB, spanA];
      const okOld = setWallSpan(project, o, spanOld[0], spanOld[1]);
      if (!okOld) continue;
      setWallSpan(project, w, which === "start" ? spanNew[0] : 0, which === "start" ? w.size.length : spanNew[1]);
      done[which] = true;
    }
    return done;
  }

  /** Связан ли элемент с контуром так, что после его правки нужна перестройка. */
  function needsRebuild(el, patch) {
    if (!el || !el.params || !el.params.contourId) return false;
    const g = el.params.generatedBy;
    if (g === GEN.wall) return !!(patch.size && (patch.size.thickness !== undefined || patch.size.height !== undefined));
    if (g === GEN.foundation || g === GEN.strip) return !!(patch.size && (patch.size.height !== undefined || patch.size.width !== undefined));
    if (g === GEN.slab || g === GEN.floor) return !!(patch.size && patch.size.height !== undefined);
    return false;
  }

  /** Правка стены контура из панели свойств: толщина и высота применяются, затем перестраиваются соседи. */
  function applyElementPatch(project, el, patch) {
    const g = el.params.generatedBy;
    if (g === GEN.strip && patch.size) {
      // Все ленты контура имеют одно сечение
      for (const s of linked(project, el.params.contourId, GEN.strip)) {
        if (patch.size.width !== undefined) s.size.width = el.size.width;
        if (patch.size.height !== undefined) { const top = s.position.z + s.size.height; s.size.height = el.size.height; s.position.z = U.round(top - s.size.height, 3); }
      }
    }
    if (g === GEN.foundation && patch.size && patch.size.height !== undefined) {
      const lv = P().level(project, el.levelId);
      el.position.z = U.round(lv.elevation - el.size.height, 3);
    }
    return rebuild(project, el.params.contourId).notes;
  }

  BS.contour = {
    GEN, ensurePlan, list, get, forLevel, addContour, setPoints, removeContour, rectangle, linked, problem, cleanPoints,
    edges, bandLayout, solveCorner, offsetPolygon, interiorAngle, joinWallCorners, findCorner,
    foundationFromContour, wallsFromContour, slabFromContour, roofFromContour, roofLayout, rebuild, needsRebuild, applyElementPatch,
  };
})(globalThis.BuildSense);
