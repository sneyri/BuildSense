// Опирание: на что ставится элемент и на чём он стоит.
// Используется при построении (элемент «садится» на основание), в проверках и в симуляции.
(function (BS) {
  "use strict";
  const G = BS.geometry;
  const S = BS.shapes;
  const LEVEL_TOL = 0.02; // м: допуск совпадения отметок низа и верха

  /** Может ли элемент нести другой элемент (служить основанием). */
  function canCarry(el) {
    const t = BS.types.get(el.type);
    if (!t || t.nonSolid || t.shape === "opening" || t.shape === "fixture") return false;
    return true;
  }

  /** Лежит ли точка плана внутри контура элемента (с допуском tol). */
  function containsPoint(el, project, x, y, tol = 0.001) {
    const fp = S.footprint(el, project);
    return fp.length >= 3 && G.pointInConvex({ x, y }, fp, tol);
  }

  /**
   * Верх самого высокого основания в точке плана, не выше below.
   * types — список допустимых типов основания (по умолчанию — любые несущие формы).
   */
  function supportAt(project, x, y, { below = Infinity, types = null, excludeIds = [] } = {}) {
    let best = null;
    for (const el of project.elements) {
      if (excludeIds.includes(el.id) || !canCarry(el)) continue;
      if (types && !types.includes(el.type)) continue;
      if (!containsPoint(el, project, x, y)) continue;
      const top = S.top(el, project);
      if (top > below + LEVEL_TOL) continue;
      if (!best || top > best.z) best = { z: top, element: el };
    }
    return best;
  }

  /** Отметка установки по нескольким точкам: максимум найденных оснований, иначе fallback. */
  function supportLevel(project, points, options = {}) {
    let z = null;
    for (const p of points) {
      const s = supportAt(project, p.x, p.y, options);
      if (s && (z === null || s.z > z)) z = s.z;
    }
    return z ?? options.fallback ?? 0;
  }

  /** Контрольные точки элемента для проверки опирания (по оси для линейных, по сетке для плоских). */
  function samplePoints(el, project) {
    const t = BS.types.get(el.type) || {};
    if (t.shape === "cylinder") return [{ ...el.position }];
    const ps = S.planSize(el);
    if (!ps) return [S.center(el, project)];
    const [a, b] = ps;
    const pts = [];
    const nu = a > b * 3 ? 11 : 5, nv = a > b * 3 ? 1 : 5;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const u = (a * (i + 0.5)) / nu, v = nv === 1 ? b / 2 : (b * (j + 0.5)) / nv;
        const p = G.localToWorld(el, u, v, 0);
        pts.push({ x: p.x, y: p.y, u });
      }
    }
    return pts;
  }

  /**
   * На чём стоит элемент: { supports: [элементы], share: доля контрольных точек с опорой,
   * gap: зазор до ближайшего основания ниже (или null), ends: [опора в начале, опора в конце] }.
   * Опора — несущий по форме элемент, верх которого совпадает с низом элемента.
   */
  function supportInfo(project, el) {
    // Перемычка заделана в свою стену и опирается на её простенки
    const hostWall = el.params && el.params.hostWallId && project.elements.find((e) => e.id === el.params.hostWallId);
    if (hostWall) return { supports: [hostWall], areal: false, share: 1, gap: null, below: null, ends: [true, true] };
    const z = S.bottom(el, project);
    const pts = samplePoints(el, project);
    const found = new Map();
    let hits = 0;
    let below = null;
    const hitAt = [];
    for (const p of pts) {
      let ok = false;
      for (const s of project.elements) {
        if (s.id === el.id || s.hostId === el.id || !canCarry(s)) continue;
        if (!containsPoint(s, project, p.x, p.y, 0.005)) continue;
        const top = S.top(s, project);
        if (Math.abs(top - z) <= LEVEL_TOL) {
          ok = true;
          found.set(s.id, s);
        } else if (top < z && (below === null || top > below)) {
          below = top;
        }
      }
      if (ok) hits++;
      hitAt.push(ok);
    }
    const ends = pts.length > 2 ? [hitAt.slice(0, 2).some(Boolean), hitAt.slice(-2).some(Boolean)] : [hits > 0, hits > 0];

    // Плоскостные элементы (крыша, перекрытие, площадка) опираются краями на стены и балки:
    // точки по площади их не находят, поэтому опоры ищутся по касанию контуров.
    const areal = AREAL.includes(el.type);
    if (areal) {
      const fp = grow(S.footprint(el, project), 0.03);
      for (const s of project.elements) {
        if (s.id === el.id || found.has(s.id) || !canCarry(s)) continue;
        if (Math.abs(S.top(s, project) - z) > LEVEL_TOL) continue;
        if (G.overlapArea(fp, S.footprint(s, project)) > 0.0005) found.set(s.id, s);
      }
    }
    return {
      supports: [...found.values()], areal,
      share: areal ? (found.size ? 1 : 0) : pts.length ? hits / pts.length : 0,
      gap: below === null ? null : z - below, below, ends,
    };
  }

  const AREAL = ["roof", "slab", "landing", "terrace", "truss", "balcony"];

  function grow(poly, d) {
    if (!poly.length) return poly;
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    return poly.map((p) => {
      const len = Math.hypot(p.x - cx, p.y - cy) || 1;
      return { x: p.x + ((p.x - cx) / len) * d * Math.SQRT2, y: p.y + ((p.y - cy) / len) * d * Math.SQRT2 };
    });
  }

  /** Касается ли элемент сбоку стены или перекрытия (для навесных элементов). */
  function attachedTo(project, el) {
    const fp = S.footprint(el, project);
    const z0 = S.bottom(el, project), z1 = S.top(el, project);
    return project.elements.filter((o) => {
      if (o.id === el.id || !["wall", "slab", "column", "beam", "slab_foundation"].includes(o.type)) return false;
      const zOverlap = Math.min(z1, S.top(o, project)) - Math.max(z0, S.bottom(o, project));
      if (zOverlap < -LEVEL_TOL) return false;
      return G.polygonDistance(fp, S.footprint(o, project)) <= 0.03;
    });
  }

  BS.support = { LEVEL_TOL, canCarry, containsPoint, supportAt, supportLevel, supportInfo, attachedTo, samplePoints };
})(globalThis.BuildSense);
