// Модель проекта BuildSense — единственный источник данных о доме.
// 3D-сцена, проверки, симуляция и экспорт читают эту структуру; Three.js её не хранит.
// Все функции изменяют переданный project и не зависят от DOM.
(function (BS) {
  "use strict";
  const U = BS.util;
  const G = BS.geometry;
  const S = BS.shapes;

  const FORMAT = "buildsense-project";
  const SCHEMA_VERSION = 2;

  const DEFAULT_SETTINGS = {
    climateRegion: "2V",
    housingFund: "private",
    grid: 0.1,
    snap: true,
    site: { x: -10, y: -10, length: 40, width: 40, maxHeight: 30 },
    // Учебный профиль: пользовательские ограничения для предварительных проверок (не нормы).
    profile: {
      minExteriorWall: 0.3, minInteriorWall: 0.2, minPartition: 0.08, minColumn: 0.2, minSlab: 0.12,
      maxBeamSpan: 6, maxBeamSpanToDepth: 20, maxSlabSpan: 7, maxSlenderness: 25, freeWallSlenderness: 12,
    },
    // Пользовательские нагрузки для симуляции и расчётов (учебные значения, задаются пользователем).
    loads: { liveLoad: 2.0, slabCapacity: 8.0 },
  };

  const DEFAULT_HOUSE = {
    length: 10, width: 8, wallHeight: 2.8, wallThickness: 0.4, slabThickness: 0.2,
    foundationThickness: 0.4, roofType: "gable", roofSlope: 30, roofOverhang: 0.4,
  };

  // ---------------------------------------------------------------- проект и этажи

  function createProject(name = "Новый проект") {
    const now = U.nowIso();
    return {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      name,
      units: "m",
      createdAt: now,
      updatedAt: now,
      settings: U.clone(DEFAULT_SETTINGS),
      house: { ...DEFAULT_HOUSE },
      levels: [{ id: "L1", name: "Этаж 1", elevation: 0, height: DEFAULT_HOUSE.wallHeight }],
      elements: [],
      customRules: [],
    };
  }

  function touch(project) {
    project.updatedAt = U.nowIso();
  }

  function level(project, id) {
    return project.levels.find((l) => l.id === id) || project.levels[0];
  }

  function topLevel(project) {
    return [...project.levels].sort((a, b) => b.elevation - a.elevation)[0];
  }

  function find(project, id) {
    return project.elements.find((e) => e.id === id) || null;
  }

  function hosted(project, id) {
    return project.elements.filter((e) => e.hostId === id);
  }

  function nextId(project, type) {
    let max = 0;
    const re = new RegExp(`^${type}-(\\d+)$`);
    for (const el of project.elements) {
      const m = re.exec(el.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `${type}-${max + 1}`;
  }

  /** Создаёт объект типа type с параметрами по умолчанию и добавляет его в проект. */
  function addElement(project, type, opts = {}) {
    const t = BS.types.get(type);
    if (!t) throw new Error(`Неизвестный тип объекта: ${type}`);
    const id = nextId(project, type);
    const el = {
      id,
      type,
      name: opts.name || `${t.label} ${id.split("-")[1]}`,
      category: opts.category || (t.categories ? Object.keys(t.categories)[0] : null),
      material: opts.material || t.materials[0],
      levelId: opts.levelId || project.levels[0].id,
      position: { x: 0, y: 0, z: 0, ...(opts.position || {}) },
      rotation: opts.rotation || 0,
      size: { ...t.size, ...(opts.size || {}) },
      params: { ...U.clone(t.params), ...(opts.params || {}) },
    };
    if (t.shape === "opening") {
      el.hostId = opts.hostId;
      el.position = { offset: 0, elevation: t.sill, ...(opts.position || {}) };
      delete el.rotation;
    }
    if (opts.shell) el.shell = opts.shell;
    project.elements.push(el);
    normalize(project, el);
    touch(project);
    return el;
  }

  // ---------------------------------------------------------------- ограничения значений

  /** Приводит значения к допустимым диапазонам из описания типа; возвращает тексты корректировок. */
  function normalize(project, el) {
    const notes = [];
    const t = BS.types.get(el.type);
    if (!t) return notes;
    for (const [path, f] of Object.entries(t.fields || {})) {
      const [group, key] = path.split(".");
      const obj = el[group];
      if (!obj) continue;
      let max = f.max;
      if (t.shape === "opening" && el.hostId) {
        const h = find(project, el.hostId);
        if (h && key === "width") max = Math.min(max, h.size.length);
        if (h && key === "height") max = Math.min(max, h.size.height);
      }
      const raw = Number(obj[key]);
      if (key === "offset" || key === "elevation") continue; // проверяются ниже, относительно стены
      const v = U.clamp(Number.isFinite(raw) ? raw : f.min, f.min, Math.max(f.min, max));
      if (!Number.isFinite(raw) || Math.abs(v - raw) > 1e-9) {
        notes.push(`${f.label}: значение ограничено диапазоном ${U.fmt(f.min)}–${U.fmt(max)} ${f.unit}`);
      }
      obj[key] = U.round(v, 3);
    }
    if (t.shape === "opening") {
      const h = find(project, el.hostId);
      if (h) {
        const offMax = Math.max(0, h.size.length - el.size.width);
        const elMax = Math.max(0, h.size.height - el.size.height);
        const off = U.clamp(Number(el.position.offset) || 0, 0, offMax);
        const elev = U.clamp(Number(el.position.elevation) || 0, 0, elMax);
        if (Math.abs(off - el.position.offset) > 1e-9) notes.push(`Отступ ограничен длиной стены (до ${U.fmt(offMax)} м)`);
        if (Math.abs(elev - el.position.elevation) > 1e-9) notes.push(`Высота низа ограничена высотой стены (до ${U.fmt(elMax)} м)`);
        el.position.offset = U.round(off, 3);
        el.position.elevation = U.round(elev, 3);
      }
    } else if (typeof el.rotation === "number") {
      el.rotation = U.round(((el.rotation % 360) + 360) % 360, 3);
    }
    if (t.shape === "roof" && !["flat", "shed", "gable", "hip"].includes(el.params.roofType)) el.params.roofType = "gable";
    return notes;
  }

  /** Изменяет элемент (patch — вложенные поля). Возвращает тексты корректировок. */
  function updateElement(project, id, patch) {
    const el = find(project, id);
    if (!el) throw new Error(`Элемент ${id} не найден`);
    U.merge(el, patch);
    if (el.shell && (patch.position || patch.size || patch.rotation !== undefined)) delete el.shell;
    const notes = normalize(project, el);
    for (const o of hosted(project, id)) notes.push(...normalize(project, o));
    touch(project);
    return notes;
  }

  function removeElements(project, ids) {
    const removed = new Set(ids);
    for (const el of project.elements) if (removed.has(el.hostId)) removed.add(el.id);
    project.elements = project.elements.filter((e) => !removed.has(e.id));
    touch(project);
    return [...removed];
  }

  // ---------------------------------------------------------------- отметки установки

  /** Низ нового элемента: фундаменты — под отметкой 0, остальное садится на основание этажа. */
  function baseZ(project, type, points, levelId, height) {
    const t = BS.types.get(type);
    const lv = level(project, levelId);
    if (t.support === "ground") return -height;
    if (type === "beam" || type === "truss") {
      return BS.support.supportLevel(project, points, { below: lv.elevation + lv.height + 0.1, fallback: lv.elevation + lv.height - height });
    }
    if (type === "light") return lv.elevation + lv.height - height;
    if (type === "socket") return lv.elevation + 0.3;
    if (type === "switch") return lv.elevation + 0.9;
    if (type === "balcony") return lv.elevation - height;
    if (type === "decor") return lv.elevation + lv.height - height;
    return BS.support.supportLevel(project, points, { below: lv.elevation + 0.35, fallback: lv.elevation });
  }

  // ---------------------------------------------------------------- построение мышью

  /**
   * Параметры стены по двум точкам плана — без добавления в проект (для предпросмотра).
   * Перегородка и внутренняя стена рисуются по оси. Наружная — по наружной грани:
   * толщина уходит в ту сторону, где есть фундамент или пол.
   */
  function planWall(project, p1, p2, opts = {}) {
    const lv = level(project, opts.levelId);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const insideSlab = project.elements.some((e) => e.type === "slab" && BS.support.containsPoint(e, project, mid.x, mid.y, -0.01) &&
      Math.abs(S.top(e, project) - lv.elevation) < 0.5);
    const category = opts.category || (insideSlab ? "partition" : "exterior");
    const h = project.house;
    const thickness = opts.thickness || (category === "partition" ? 0.12 : category === "interior" ? 0.25 : h.wallThickness);
    const nx = length ? -dy / length : 0, ny = length ? dx / length : 1;
    let shift = -thickness / 2;
    if (category === "exterior" && length) {
      const supported = (k) => project.elements.some((e) => (BS.types.isFoundation(e) || e.type === "slab") &&
        BS.support.containsPoint(e, project, mid.x + nx * thickness * k, mid.y + ny * thickness * k, -0.001));
      if (supported(0.5) && !supported(-0.5)) shift = 0;
      else if (supported(-0.5) && !supported(0.5)) shift = -thickness;
    }
    const samples = [0.02, 0.5, 0.98].map((f) => ({ x: p1.x + dx * f + nx * (shift + thickness / 2), y: p1.y + dy * f + ny * (shift + thickness / 2) }));
    const z = baseZ(project, "wall", samples, lv.id, 0);
    const height = opts.height || Math.max(0.5, lv.elevation + lv.height - z);
    return {
      type: "wall", category, levelId: lv.id,
      material: opts.material || (category === "exterior" ? "brick" : "aerated"),
      position: { x: U.round(p1.x + nx * shift, 3), y: U.round(p1.y + ny * shift, 3), z: U.round(z, 3) },
      rotation: length ? (Math.atan2(dy, dx) * 180) / Math.PI : 0,
      size: { length: U.round(length, 3), thickness, height: U.round(height, 3) },
    };
  }

  function addWallByPoints(project, p1, p2, opts = {}) {
    const spec = planWall(project, p1, p2, opts);
    if (spec.size.length < 0.2) throw new Error("Стена слишком короткая — отметьте вторую точку дальше");
    const el = addElement(project, "wall", spec);
    el.name = `${spec.category === "partition" ? "Перегородка" : "Стена"} ${el.id.split("-")[1]}`;
    trimToNeighbours(project, el);
    normalize(project, el);
    return el;
  }

  /** Линейный элемент по двум точкам (ленточный фундамент, балка, перила, труба, карниз), ось — по линии. */
  function planSegment(project, type, p1, p2, opts = {}) {
    const t = BS.types.get(type);
    const lv = level(project, opts.levelId);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    const width = t.shape === "pipe" ? t.size.diameter : (opts.width || t.size.width);
    const nx = length ? -dy / length : 0, ny = length ? dx / length : 1;
    const height = t.shape === "pipe" ? t.size.diameter : t.size.height;
    const shift = t.shape === "pipe" ? 0 : -width / 2;
    const z = t.shape === "pipe" ? lv.elevation + 0.5 : baseZ(project, type, [p1, p2], lv.id, height);
    return {
      type, levelId: lv.id,
      position: { x: U.round(p1.x + nx * shift, 3), y: U.round(p1.y + ny * shift, 3), z: U.round(z, 3) },
      rotation: length ? (Math.atan2(dy, dx) * 180) / Math.PI : 0,
      size: t.shape === "pipe" ? { length: U.round(length, 3), diameter: width } : { length: U.round(length, 3), width, height },
    };
  }

  function addSegment(project, type, p1, p2, opts = {}) {
    const spec = planSegment(project, type, p1, p2, opts);
    if (spec.size.length < 0.1) throw new Error("Слишком короткий элемент — отметьте вторую точку дальше");
    const el = addElement(project, type, spec);
    if (type === "strip_foundation") trimToNeighbours(project, el, ["strip_foundation"]);
    return el;
  }

  /** Прямоугольный элемент по двум углам (плиты, терраса, комната, площадка). */
  function planRect(project, type, a, b, opts = {}) {
    const t = BS.types.get(type);
    const lv = level(project, opts.levelId);
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    const length = Math.abs(b.x - a.x), width = Math.abs(b.y - a.y);
    let height = t.size.height;
    if (type === "slab_foundation") height = project.house.foundationThickness;
    if (type === "slab") height = project.house.slabThickness;
    if (type === "room") height = lv.height - project.house.slabThickness;
    const center = { x: x0 + length / 2, y: y0 + width / 2 };
    const z = baseZ(project, type, [center], lv.id, height);
    const spec = {
      type, levelId: lv.id,
      position: { x: U.round(x0, 3), y: U.round(y0, 3), z: U.round(z, 3) },
      size: { length: U.round(length, 3), width: U.round(width, 3), height },
    };
    if (type === "slab") spec.category = z < 0.5 ? "ground" : "floor";
    return spec;
  }

  function addRect(project, type, a, b, opts = {}) {
    const spec = planRect(project, type, a, b, opts);
    if (spec.size.length < 0.3 || spec.size.width < 0.3) throw new Error("Прямоугольник слишком маленький");
    return addElement(project, type, spec);
  }

  /** Точечный элемент (колонна, опора, мебель, лестница…) с центром в точке плана. */
  function planPoint(project, type, p, opts = {}) {
    const t = BS.types.get(type);
    const lv = level(project, opts.levelId);
    const size = { ...t.size, ...(opts.size || {}) };
    if (type === "column" || type === "round_column") {
      size.height = lv.height;
    }

    const rotation = opts.rotation || 0;
    let position;
    if (t.shape === "cylinder") {
      position = { x: p.x, y: p.y, z: 0 };
    } else {
      const a = size.length, b = size.width;
      const tmp = { position: { x: 0, y: 0, z: 0 }, rotation };
      const c = G.localToWorld(tmp, a / 2, b / 2, 0);
      position = { x: p.x - c.x, y: p.y - c.y, z: 0 };
    }
    const h = t.shape === "cylinder" ? size.height : size.height;
    const z = baseZ(project, type, [p], lv.id, h);
    if ((type === "column" || type === "round_column") && z > lv.elevation) size.height = U.round(Math.max(0.5, lv.elevation + lv.height - z), 3);
    let params = opts.params;
    if (type === "stairs") {
      // Марш от пола, на котором стоит лестница, до пола следующего этажа
      const above = project.levels.filter((l) => l.elevation > lv.elevation).sort((x, y) => x.elevation - y.elevation)[0];
      const target = above ? above.elevation : lv.elevation + lv.height + project.house.slabThickness;
      size.height = U.round(Math.max(0.3, target - z), 3);
      const steps = Math.max(3, Math.round(size.height / 0.175));
      params = { steps, ...(opts.params || {}) };
      size.length = U.round(steps * 0.25, 3);
    }
    position.z = U.round(z, 3);
    position.x = U.round(position.x, 3);
    position.y = U.round(position.y, 3);
    return { type, levelId: lv.id, position, rotation, size, params };
  }

  function placeAt(project, type, p, opts = {}) {
    return addElement(project, type, planPoint(project, type, p, opts));
  }

  /** Окно или дверь в стене. Если место занято, ищется ближайшее свободное. */
  function placeOpening(project, type, wallId, offset, opts = {}) {
    const wall = find(project, wallId);
    if (!wall || wall.type !== "wall") throw new Error("Окна и двери ставятся только в стены");
    const t = BS.types.get(type);
    const size = { ...t.size, ...(opts.size || {}) };
    size.width = Math.min(size.width, wall.size.length);
    const elevation = t.sill;
    size.height = Math.min(size.height, wall.size.height - elevation);
    let off = offset;
    if (off == null || off < 0 || off + size.width > wall.size.length || !isFree(project, wall, off, size.width, 0.1)) {
      off = findFreeOffset(project, wall, size.width);
    }
    if (off === null) throw new Error(`В стене «${wall.name}» нет свободного места для проёма`);
    return addElement(project, type, {
      hostId: wall.id, levelId: wall.levelId, size,
      position: { offset: U.round(off, 3), elevation },
      category: type === "door" ? (wall.category === "exterior" ? "entrance" : "interior") : undefined,
    });
  }

  function isFree(project, wall, offset, width, gap) {
    return hosted(project, wall.id).every((o) =>
      offset + width <= o.position.offset - gap || offset >= o.position.offset + o.size.width + gap);
  }

  function findFreeOffset(project, wall, width, gap = 0.3) {
    const L = wall.size.length;
    if (width > L) return null;
    const cands = [];
    for (let x = 0; x <= L - width + 1e-9; x += 0.05) cands.push(U.round(x, 3));
    const c = (L - width) / 2;
    cands.sort((a, b) => Math.abs(a - c) - Math.abs(b - c));
    return cands.find((x) => isFree(project, wall, x, width, gap)) ?? null;
  }

  /** Стыковка встык: торец новой линейной детали, зашедший в соседнюю, укорачивается до её грани. */
  function trimToNeighbours(project, el, types = ["wall"]) {
    for (const other of project.elements) {
      if (!types.includes(other.type) || other.id === el.id) continue;
      const zOverlap = Math.min(S.top(el, project), S.top(other, project)) - Math.max(S.bottom(el, project), S.bottom(other, project));
      if (zOverlap <= 0.02) continue;
      const poly = G.clipPolygon(S.footprint(el, project), S.footprint(other, project));
      if (poly.length < 3) continue;
      const us = poly.map((p) => G.worldToLocal(el, p.x, p.y).u);
      const u0 = Math.min(...us), u1 = Math.max(...us);
      const L = el.size.length;
      if (u1 - u0 < 0.001) continue;
      if (u0 <= 0.01 && u1 < L - 0.2) {
        const r = el.rotation * G.DEG;
        el.position.x = U.round(el.position.x + Math.cos(r) * u1, 3);
        el.position.y = U.round(el.position.y + Math.sin(r) * u1, 3);
        el.size.length = U.round(L - u1, 3);
      } else if (u1 >= L - 0.01 && u0 > 0.2) {
        el.size.length = U.round(u0, 3);
      }
    }
  }

  // ---------------------------------------------------------------- перемещение и копирование

  /**
   * Сдвиг элемента. Опирающиеся элементы после сдвига по плану снова «садятся» на основание
   * под ними (если оно есть); dz сдвигает по высоте явно.
   */
  function moveElement(project, id, dx, dy, dz = 0, { reseat = true } = {}) {
    const el = find(project, id);
    if (!el || el.hostId) return [];
    const t = BS.types.get(el.type);
    const pos = { x: U.round(el.position.x + dx, 3), y: U.round(el.position.y + dy, 3), z: U.round(el.position.z + dz, 3) };
    if (reseat && dz === 0 && t.support === "gravity" && el.type !== "beam" && el.type !== "truss") {
      const moved = { ...el, position: pos };
      const pts = BS.support.samplePoints(moved, project);
      pos.z = U.round(BS.support.supportLevel(project, pts, { below: el.position.z + 0.3, excludeIds: [el.id], fallback: el.position.z }), 3);
    }
    return updateElement(project, id, { position: pos });
  }

  function rotateElement(project, id, delta) {
    const el = find(project, id);
    if (!el || el.hostId) return [];
    // Поворот вокруг центра контура
    const c0 = S.center(el, project);
    const rotated = { ...el, rotation: (el.rotation || 0) + delta };
    const c1 = S.center(rotated, project);
    return updateElement(project, id, {
      rotation: rotated.rotation,
      position: { x: U.round(el.position.x + c0.x - c1.x, 3), y: U.round(el.position.y + c0.y - c1.y, 3) },
    });
  }

  /** Копии элементов (вместе с проёмами стен) со сдвигом. Возвращает новые элементы. */
  function duplicate(project, ids, offset = { x: 1, y: 1, z: 0 }, levelId = null) {
    const created = [];
    const idMap = new Map();
    const sources = ids.map((id) => find(project, id)).filter(Boolean).filter((e) => !e.hostId || !ids.includes(e.hostId));
    for (const src of sources) {
      if (src.hostId) {
        const copy = placeOpening(project, src.type, src.hostId, src.position.offset + src.size.width + 0.3, { size: src.size });
        created.push(copy);
        continue;
      }
      const copy = U.clone(src);
      copy.id = nextId(project, src.type);
      copy.name = `${src.name} (копия)`;
      copy.position.x = U.round(copy.position.x + offset.x, 3);
      copy.position.y = U.round(copy.position.y + offset.y, 3);
      copy.position.z = U.round(copy.position.z + (offset.z || 0), 3);
      if (levelId) copy.levelId = levelId;
      delete copy.shell;
      project.elements.push(copy);
      idMap.set(src.id, copy.id);
      created.push(copy);
      for (const o of hosted(project, src.id)) {
        const oc = U.clone(o);
        oc.id = nextId(project, o.type);
        oc.hostId = copy.id;
        oc.levelId = copy.levelId;
        project.elements.push(oc);
        created.push(oc);
      }
    }
    touch(project);
    return created;
  }

  /**
   * Новый этаж над верхним: перекрытие по контуру наружных стен, по желанию — копии наружных стен
   * с окнами (двери не копируются); крыша поднимается на новый верх стен.
   */
  function addLevel(project, { copyWalls = true } = {}) {
    const prev = topLevel(project);
    const slabT = project.house.slabThickness;
    const top = prev.elevation + prev.height;
    const id = `L${project.levels.length + 1}`;
    const lv = { id, name: `Этаж ${project.levels.length + 1}`, elevation: U.round(top + slabT, 3), height: prev.height };
    project.levels.push(lv);
    const valid = (e) => Object.values(e.size).every((v) => Number.isFinite(v) && v > 0);
    const ext = project.elements.filter((e) => e.type === "wall" && e.category === "exterior" && e.levelId === prev.id && valid(e));
    const created = [];
    if (ext.length) {
      const b = G.bbox2(ext.flatMap((w) => S.footprint(w, project)));
      created.push(addElement(project, "slab", {
        levelId: id, category: "floor", name: `Перекрытие (${prev.name} / ${lv.name})`,
        position: { x: U.round(b.minX, 3), y: U.round(b.minY, 3), z: U.round(top, 3) },
        size: { length: U.round(b.maxX - b.minX, 3), width: U.round(b.maxY - b.minY, 3), height: slabT },
      }));
      if (copyWalls) {
        const ids = ext.map((w) => w.id);
        const copies = duplicate(project, ids, { x: 0, y: 0, z: lv.elevation - prev.elevation }, id);
        for (const c of copies) {
          if (c.type === "door") removeElements(project, [c.id]);
          else {
            c.name = c.name.replace(" (копия)", ` (${lv.name.toLowerCase()})`);
            created.push(c);
          }
        }
      }
    }
    for (const r of project.elements.filter((e) => e.type === "roof")) {
      if (Math.abs(r.position.z - top) < 0.05) r.position.z = U.round(lv.elevation + lv.height, 3);
    }
    touch(project);
    return { level: lv, created };
  }

  /** Перемычки над проёмами стены: брус шире проёма на 0,25 м с каждой стороны. */
  function addLintels(project, wallId) {
    const wall = find(project, wallId);
    if (!wall) return [];
    const out = [];
    for (const o of hosted(project, wallId)) {
      const bearingLen = 0.25;
      const u0 = Math.max(0, o.position.offset - bearingLen);
      const u1 = Math.min(wall.size.length, o.position.offset + o.size.width + bearingLen);
      const z = o.position.elevation + o.size.height;
      const h = Math.min(0.2, wall.size.height - z);
      if (h < 0.05) continue;
      const p = G.localToWorld(wall, u0, 0, z);
      out.push(addElement(project, "lintel", {
        levelId: wall.levelId, name: `Перемычка над «${o.name}»`, material: "concrete",
        position: { x: U.round(p.x, 3), y: U.round(p.y, 3), z: U.round(p.z, 3) }, rotation: wall.rotation,
        size: { length: U.round(u1 - u0, 3), width: wall.size.thickness, height: U.round(h, 3) },
        params: { hostWallId: wall.id },
      }));
    }
    return out;
  }

  /** Крыша над наружными стенами верхнего этажа со свесом. */
  function addRoofOverBuilding(project, opts = {}) {
    const lv = topLevel(project);
    const walls = project.elements.filter((e) => e.type === "wall" && e.category === "exterior" && e.levelId === lv.id);
    if (!walls.length) throw new Error("Сначала постройте наружные стены — крыше не на что опереться");
    const b = G.bbox2(walls.flatMap((w) => S.footprint(w, project)));
    const oh = opts.overhang ?? project.house.roofOverhang;
    const z = Math.max(...walls.map((w) => S.top(w, project)));
    return addElement(project, "roof", {
      levelId: lv.id, name: "Крыша",
      position: { x: U.round(b.minX - oh, 3), y: U.round(b.minY - oh, 3), z: U.round(z, 3) },
      size: { length: U.round(b.maxX - b.minX + 2 * oh, 3), width: U.round(b.maxY - b.minY + 2 * oh, 3) },
      params: { roofType: opts.roofType || project.house.roofType, slope: opts.slope ?? project.house.roofSlope, thickness: 0.25 },
    });
  }

  // ---------------------------------------------------------------- автоматическое размещение (мастер)

  /** Наружные стены по контуру фундамента (габариты всех фундаментов этажа 1). */
  function wallsAroundFoundation(project, opts = {}) {
    const found = project.elements.filter((e) => BS.types.isFoundation(e));
    if (!found.length) throw new Error("Сначала создайте фундамент — стены строятся по его контуру");
    const b = G.bbox2(found.flatMap((f) => S.footprint(f, project)));
    const pts = [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }, { x: b.minX, y: b.minY }];
    const created = [];
    for (let i = 0; i < 4; i++) {
      created.push(addWallByPoints(project, pts[i], pts[i + 1], { category: "exterior", thickness: opts.thickness, levelId: opts.levelId }));
    }
    return created;
  }

  /** Пол (плита) внутри наружных стен этажа. */
  function slabInsideWalls(project, levelId) {
    const lv = level(project, levelId);
    const walls = project.elements.filter((e) => e.type === "wall" && e.category === "exterior" && e.levelId === lv.id);
    if (walls.length < 3) throw new Error("Нужны наружные стены этажа — пол кладётся внутри них");
    const t = Math.min(...walls.map((w) => w.size.thickness));
    const b = G.bbox2(walls.flatMap((w) => S.footprint(w, project)));
    const el = addRect(project, "slab", { x: b.minX + t, y: b.minY + t }, { x: b.maxX - t, y: b.maxY - t }, { levelId: lv.id });
    el.name = `Пол (${lv.name.toLowerCase()})`;
    return el;
  }

  /** Окно по центру каждой наружной стены без проёмов и входная дверь, если её нет. */
  function autoOpenings(project, levelId) {
    const lv = level(project, levelId);
    const walls = project.elements.filter((e) => e.type === "wall" && e.category === "exterior" && e.levelId === lv.id);
    const created = [];
    const hasDoor = project.elements.some((e) => e.type === "door" && walls.some((w) => w.id === e.hostId));
    walls.forEach((w, i) => {
      if (hosted(project, w.id).length || w.size.length < 2.5) return;
      if (!hasDoor && i === 0 && lv.elevation < 0.5) {
        created.push(placeOpening(project, "door", w.id, w.size.length * 0.25));
        created.push(placeOpening(project, "window", w.id, w.size.length * 0.7 - 0.75));
      } else {
        created.push(placeOpening(project, "window", w.id, (w.size.length - 1.5) / 2));
      }
    });
    return created;
  }

  // ---------------------------------------------------------------- стартовый дом

  /** Стартовый одноэтажный дом по project.house: фундамент, 4 стены, пол, перегородка, проёмы, крыша, комнаты. */
  function buildStarterHouse(project) {
    const h = project.house;
    project.elements = [];
    project.levels = [{ id: "L1", name: "Этаж 1", elevation: 0, height: h.wallHeight }];
    const L = h.length, W = h.width, t = h.wallThickness;
    addElement(project, "slab_foundation", {
      name: "Фундаментная плита", shell: "foundation",
      position: { x: 0, y: 0, z: -h.foundationThickness }, size: { length: L, width: W, height: h.foundationThickness },
    });
    const walls = {
      south: [{ x: 0, y: 0 }, { x: L, y: 0 }], east: [{ x: L, y: 0 }, { x: L, y: W }],
      north: [{ x: L, y: W }, { x: 0, y: W }], west: [{ x: 0, y: W }, { x: 0, y: 0 }],
    };
    const names = { south: "Стена южная", east: "Стена восточная", north: "Стена северная", west: "Стена западная" };
    const ids = {};
    for (const [side, [a, b]] of Object.entries(walls)) {
      const w = addWallByPoints(project, a, b, { category: "exterior", thickness: t });
      w.name = names[side];
      w.shell = side;
      ids[side] = w.id;
    }
    addElement(project, "slab", {
      name: "Пол первого этажа", category: "ground", shell: "floor",
      position: { x: t, y: t, z: 0 }, size: { length: L - 2 * t, width: W - 2 * t, height: h.slabThickness },
    });
    const part = addWallByPoints(project, { x: L * 0.6, y: t }, { x: L * 0.6, y: W - t }, { category: "partition" });
    part.name = "Перегородка";
    placeOpening(project, "door", ids.south, L * 0.3);
    placeOpening(project, "window", ids.south, L * 0.75 - 0.75);
    placeOpening(project, "window", ids.north, 1.5);
    placeOpening(project, "window", ids.north, L - 3.2);
    placeOpening(project, "window", ids.east, null);
    placeOpening(project, "window", ids.west, null);
    placeOpening(project, "door", part.id, 1.0);
    for (const side of ["south", "east", "north", "west"]) addLintels(project, ids[side]);
    addRoofOverBuilding(project);
    const z0 = h.slabThickness;
    addElement(project, "room", { name: "Гостиная", params: { roomName: "Гостиная", roomType: "common" },
      position: { x: t, y: t, z: z0 }, size: { length: L * 0.6 - t - 0.06, width: W - 2 * t, height: h.wallHeight - z0 } });
    addElement(project, "room", { name: "Спальня", params: { roomName: "Спальня", roomType: "bedroom" },
      position: { x: L * 0.6 + 0.06, y: t, z: z0 }, size: { length: L * 0.4 - t - 0.06, width: W - 2 * t, height: h.wallHeight - z0 } });
    touch(project);
    return project;
  }

  function createStarterProject(name = "Стартовый дом") {
    return buildStarterHouse(createProject(name));
  }

  BS.project = {
    FORMAT, SCHEMA_VERSION, DEFAULT_SETTINGS, DEFAULT_HOUSE,
    createProject, createStarterProject, buildStarterHouse, touch, level, topLevel, find, hosted, nextId,
    addElement, normalize, updateElement, removeElements, baseZ,
    planWall, addWallByPoints, planSegment, addSegment, planRect, addRect, planPoint, placeAt, placeOpening,
    findFreeOffset, trimToNeighbours, moveElement, rotateElement, duplicate, addLevel, addLintels, addRoofOverBuilding,
    wallsAroundFoundation, slabInsideWalls, autoOpenings,
  };
})(globalThis.BuildSense);
