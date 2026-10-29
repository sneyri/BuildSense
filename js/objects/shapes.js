// Геометрические характеристики объектов по их типу: контур на плане, низ/верх, габариты, объём.
(function (BS) {
  "use strict";
  const G = BS.geometry;

  function typeOf(el) {
    return BS.types.get(el.type) || {};
  }

  /**
   * Многоугольная плита (фундамент или перекрытие по контуру плана): брусовый тип с params.points —
   * вершинами контура в локальных осях элемента (u, v от position). Толщина — size.height,
   * size.length/width — габариты контура (вычисляются автоматически).
   */
  function isPrism(el) {
    const p = el && el.params;
    return typeOf(el).shape === "box" && !!p && Array.isArray(p.points) && p.points.length >= 3;
  }

  /** Форма конкретного элемента: как у типа, но брус с контуром — "prism". */
  function shapeOf(el) {
    return isPrism(el) ? "prism" : typeOf(el).shape;
  }

  /** Контур многоугольной плиты в мировых координатах плана. */
  function prismOutline(el) {
    return el.params.points.map((q) => {
      const w = G.localToWorld(el, q.x, q.y, 0);
      return { x: w.x, y: w.y };
    });
  }

  function host(project, el) {
    return project ? project.elements.find((e) => e.id === el.hostId) || null : null;
  }

  /** Высота подъёма крыши над карнизом. */
  function roofRise(el) {
    const p = el.params || {};
    const tan = Math.tan((p.slope || 0) * G.DEG);
    if (p.roofType === "gable" || p.roofType === "hip") return (el.size.width / 2) * tan;
    if (p.roofType === "shed") return el.size.width * tan;
    return p.thickness || 0.2;
  }

  /** Размер «пятна» на плане [вдоль u, вдоль v] для прямоугольных форм. */
  function planSize(el) {
    const s = el.size || {};
    const t = typeOf(el);
    if (t.shape === "wall") return [s.length, s.thickness];
    if (t.shape === "pipe") return [s.length, s.diameter];
    if (t.shape === "cylinder" || t.shape === "opening" || isPrism(el)) return null;
    return [s.length, s.width];
  }

  /** Контур на плане (массив {x, y}). */
  function footprint(el, project) {
    const t = typeOf(el);
    const s = el.size || {};
    if (t.shape === "cylinder" || (t.shape === "pipe" && el.params && el.params.vertical)) {
      const r = (s.diameter || 0) / 2;
      const c = el.position;
      return Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
      });
    }
    if (t.shape === "pipe") return G.rectFootprint(el, s.length, s.diameter, 0, -s.diameter / 2);
    if (isPrism(el)) return prismOutline(el);
    if (t.shape === "opening") {
      const h = host(project, el);
      if (!h) return [];
      return G.rectFootprint(h, s.width, h.size.thickness, el.position.offset, 0);
    }
    const ps = planSize(el);
    return ps ? G.rectFootprint(el, ps[0], ps[1]) : [];
  }

  function elementHeight(el) {
    const t = typeOf(el);
    const s = el.size || {};
    if (t.shape === "roof") return roofRise(el);
    if (t.shape === "pipe") return el.params && el.params.vertical ? s.length : s.diameter;
    return s.height || 0;
  }

  function bottom(el, project) {
    if (typeOf(el).shape === "opening") {
      const h = host(project, el);
      return h ? h.position.z + el.position.elevation : el.position.elevation || 0;
    }
    if (typeOf(el).shape === "pipe" && !(el.params && el.params.vertical)) return el.position.z - (el.size.diameter || 0) / 2;
    return el.position.z;
  }

  function top(el, project) {
    return bottom(el, project) + elementHeight(el);
  }

  /** Габариты в мировых координатах. */
  function bounds(el, project) {
    const fp = footprint(el, project);
    if (!fp.length) return null;
    const b = G.bbox2(fp);
    return { min: { x: b.minX, y: b.minY, z: bottom(el, project) }, max: { x: b.maxX, y: b.maxY, z: top(el, project) } };
  }

  /** Центр контура на плане. */
  function center(el, project) {
    const fp = footprint(el, project);
    if (!fp.length) return { x: el.position.x || 0, y: el.position.y || 0 };
    return { x: fp.reduce((s, p) => s + p.x, 0) / fp.length, y: fp.reduce((s, p) => s + p.y, 0) / fp.length };
  }

  /**
   * Объём материала, м³, и формула для пояснения. Для условных форм (мебель, ферма, перила)
   * объём оценочный — это отмечается в поле approx.
   */
  function volume(el, project) {
    const t = typeOf(el);
    const s = el.size || {};
    const f = BS.util.fmt;
    if (isPrism(el)) {
      const area = Math.abs(G.polygonArea(el.params.points));
      return { value: area * s.height, formula: `V = S·h = ${f(area)}·${f(s.height)} (плита по контуру)` };
    }
    switch (t.shape) {
      case "box":
        return { value: s.length * s.width * s.height, formula: `V = a·b·h = ${f(s.length)}·${f(s.width)}·${f(s.height)}` };
      case "wall": {
        const ops = project ? project.elements.filter((o) => o.hostId === el.id) : [];
        const holes = ops.reduce((acc, o) => acc + o.size.width * o.size.height, 0);
        return {
          value: Math.max(0, (s.length * s.height - holes) * s.thickness),
          formula: `V = (L·h − ΣSпроёмов)·t = (${f(s.length)}·${f(s.height)} − ${f(holes)})·${f(s.thickness)}`,
        };
      }
      case "cylinder":
        return { value: (Math.PI * s.diameter ** 2 / 4) * s.height, formula: `V = π·d²/4·h = π·${f(s.diameter)}²/4·${f(s.height)}` };
      case "roof": {
        const p = el.params || {};
        const rise = roofRise(el);
        if (p.roofType === "flat") return { value: s.length * s.width * (p.thickness || 0), formula: `V = L·B·t` };
        if (p.roofType === "hip") {
          const r = Math.max(0, s.length - s.width);
          return { value: (rise * s.width * (2 * s.length + r)) / 6, formula: "V = h·B·(2L + Lконька)/6 (сплошное тело крыши)", approx: true };
        }
        return { value: 0.5 * s.width * rise * s.length, formula: "V = ½·B·h·L (сплошное тело крыши)", approx: true };
      }
      case "stairs": {
        const n = Math.max(1, Math.round((el.params || {}).steps || 1));
        const run = s.length / n, rise = s.height / n;
        return { value: s.width * run * rise * (n * (n + 1)) / 2, formula: "V = b·a·h·n(n+1)/2 (сплошные ступени)", approx: true };
      }
      case "balcony":
        return { value: s.length * s.width * s.height, formula: "V = a·b·t (плита без ограждения)" };
      case "truss": {
        const n = Math.max(2, (el.params || {}).panels || 4);
        const diag = Math.hypot(s.length / n, s.height);
        const lengthSum = s.length + 2 * Math.hypot(s.length / 2, s.height) + n * diag;
        return { value: lengthSum * s.width * s.width, formula: "V ≈ Σ длин стержней · b² (квадратное сечение)", approx: true };
      }
      case "pipe":
        return { value: (Math.PI * s.diameter ** 2 / 4) * s.length, formula: "V = π·d²/4·L (сплошной стержень)", approx: true };
      case "opening":
      case "zone":
        return { value: 0, formula: "—" };
      default:
        return { value: s.length * s.width * s.height * 0.4, formula: "V ≈ 0,4·a·b·h (условная модель)", approx: true };
    }
  }

  BS.shapes = { isPrism, shapeOf, prismOutline, roofRise, planSize, footprint, elementHeight, bottom, top, bounds, center, volume, host };
})(globalThis.BuildSense);
