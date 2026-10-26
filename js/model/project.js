// Модель строительного проекта — единственный источник данных о доме.
// Three.js только отображает эти данные; проверка норм и экспорт в FreeCAD
// тоже работают с этой структурой, а не с 3D-объектами.
import { ELEMENT_TYPES, OPENING_TYPES } from "./catalog.js";
import { footprint, footprintContains } from "./placement.js";
import { supportLevel } from "./support.js";

export const PROJECT_FORMAT = "freecad-checker-project";
export const PROJECT_VERSION = 1;

export const DEFAULT_HOUSE = {
  length: 10,        // м, вдоль оси X
  width: 8,          // м, вдоль оси Y
  wallHeight: 2.8,   // м
  wallThickness: 0.4,
  floorThickness: 0.2,
  foundationThickness: 0.4, // м, плита фундамента под домом (ниже отметки 0)
  roofType: "gable",
  roofSlope: 30,     // градусы
  roofOverhang: 0.4, // м
  roofThickness: 0.25,
};

export const DEFAULT_SETTINGS = {
  climateRegion: "2V",   // IIВ
  housingFund: "private",
};

/** Допустимые диапазоны значений [min, max] — защищают модель от вырожденной геометрии. */
export const LIMITS = {
  house: {
    length: [3, 40], width: [3, 40], wallHeight: [2, 6], wallThickness: [0.1, 1],
    floorThickness: [0.05, 0.6], roofSlope: [5, 60], roofOverhang: [0, 1.5], roofThickness: [0.05, 0.6],
    foundationThickness: [0.2, 1.5],
  },
  foundation: { length: [0.3, 60], width: [0.3, 60], thickness: [0.1, 3] },
  wall: { length: [0.2, 60], thickness: [0.05, 1.2], height: [0.5, 10] },
  floor: { length: [0.2, 60], width: [0.2, 60], thickness: [0.03, 1] },
  roof: { length: [0.5, 70], width: [0.5, 70], slope: [0, 70], thickness: [0.03, 1] },
  window: { width: [0.3, 6], height: [0.3, 4] },
  door: { width: [0.5, 3], height: [1.5, 3.5] },
};

const FIELD_LABELS = { length: "Длина", width: "Ширина", thickness: "Толщина", height: "Высота" };

const SHELL_NAMES = {
  foundation: "Фундаментная плита",
  south: "Наружная стена — юг",
  east: "Наружная стена — восток",
  north: "Наружная стена — север",
  west: "Наружная стена — запад",
  floor: "Пол первого этажа",
  roof: "Крыша",
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------- создание

export function createProject(name = "Новый дом") {
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    units: "m",
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS },
    house: { ...DEFAULT_HOUSE },
    elements: [],
  };
}

/** Новый проект с базовым домом: 4 наружные стены, пол, крыша, дверь и окна. */
export function createBasicHouseProject(name = "Базовый дом") {
  const project = createProject(name);
  buildBasicHouse(project);
  return project;
}

/** Пересоздаёт все элементы проекта по параметрам project.house. */
export function buildBasicHouse(project) {
  normalizeHouse(project.house);
  const specs = shellSpecs(project.house);
  project.elements = [];

  project.elements.push({
    id: nextId(project, "foundation"),
    type: "foundation",
    name: SHELL_NAMES.foundation,
    category: "slab",
    material: "concrete",
    shell: "foundation",
    position: specs.foundation.position,
    rotation: 0,
    size: specs.foundation.size,
    params: {},
  });

  for (const side of ["south", "east", "north", "west"]) {
    project.elements.push({
      id: nextId(project, "wall"),
      type: "wall",
      name: SHELL_NAMES[side],
      category: "exterior",
      material: "brick",
      shell: side,
      position: specs[side].position,
      rotation: specs[side].rotation,
      size: specs[side].size,
      params: {},
    });
  }
  project.elements.push({
    id: nextId(project, "floor"),
    type: "floor",
    name: SHELL_NAMES.floor,
    category: "ground",
    material: "concrete",
    shell: "floor",
    position: specs.floor.position,
    rotation: 0,
    size: specs.floor.size,
    params: {},
  });
  project.elements.push({
    id: nextId(project, "roof"),
    type: "roof",
    name: SHELL_NAMES.roof,
    category: "main",
    material: "metal_tile",
    shell: "roof",
    position: specs.roof.position,
    rotation: 0,
    size: specs.roof.size,
    params: specs.roof.params,
  });

  // Проёмы по умолчанию: входная дверь и окна на каждой стороне.
  // В маленьком доме лишние проёмы, которым не хватило места, просто не создаются.
  const wallBySide = (side) => project.elements.find((e) => e.shell === side);
  const south = wallBySide("south");
  const north = wallBySide("north");
  const L = south.size.length;
  const defaults = [
    ["door", south, (L - 0.9) / 2],
    ["window", south, 1.5],
    ["window", south, L - 3],
    ["window", north, L * 0.2],
    ["window", north, L * 0.8 - 1.5],
    ["window", wallBySide("east"), null],
    ["window", wallBySide("west"), null],
  ];
  for (const [type, wall, offset] of defaults) {
    try {
      addElement(project, type, { hostId: wall.id, offset: offset ?? undefined });
    } catch {
      /* нет места — пропускаем */
    }
  }
  touch(project);
  return project;
}

/**
 * Геометрия «коробки» дома по габаритам.
 * Наружные стены обходят периметр; их локальная ось v смотрит внутрь дома,
 * поэтому наружная грань каждой стены находится при v = 0.
 */
export function shellSpecs(house) {
  const { length: L, width: W, wallHeight: H, wallThickness: t, floorThickness: ft } = house;
  const oh = house.roofOverhang;
  const fd = house.foundationThickness ?? DEFAULT_HOUSE.foundationThickness;
  return {
    foundation: { position: { x: 0, y: 0, z: -fd }, size: { length: L, width: W, thickness: fd } },
    south: { position: { x: 0, y: 0, z: 0 }, rotation: 0, size: { length: L, thickness: t, height: H } },
    east: { position: { x: L, y: t, z: 0 }, rotation: 90, size: { length: W - 2 * t, thickness: t, height: H } },
    north: { position: { x: L, y: W, z: 0 }, rotation: 180, size: { length: L, thickness: t, height: H } },
    west: { position: { x: 0, y: W - t, z: 0 }, rotation: 270, size: { length: W - 2 * t, thickness: t, height: H } },
    floor: { position: { x: t, y: t, z: 0 }, size: { length: L - 2 * t, width: W - 2 * t, thickness: ft } },
    roof: {
      position: { x: -oh, y: -oh, z: H },
      size: { length: L + 2 * oh, width: W + 2 * oh },
      params: { roofType: house.roofType, slope: house.roofSlope, thickness: house.roofThickness },
    },
  };
}

/**
 * Применяет изменённые габариты дома к элементам коробки (стены, пол, крыша),
 * сохраняя их материалы и id. Проёмы остаются в своих стенах и сдвигаются, если не помещаются.
 */
export function applyHouseDimensions(project) {
  normalizeHouse(project.house);
  const specs = shellSpecs(project.house);
  for (const el of project.elements) {
    if (!el.shell || !specs[el.shell]) continue;
    const spec = specs[el.shell];
    el.position = { ...spec.position };
    if (spec.rotation !== undefined) el.rotation = spec.rotation;
    el.size = { ...spec.size };
    if (spec.params) el.params = { ...el.params, ...spec.params };
  }
  clampAllOpenings(project);
  touch(project);
}

export function normalizeHouse(h) {
  const lim = LIMITS.house;
  for (const key of Object.keys(lim)) {
    const v = Number(h[key]);
    h[key] = clamp(Number.isFinite(v) ? v : DEFAULT_HOUSE[key], lim[key][0], lim[key][1]);
  }
  // Стены не должны «съедать» весь дом
  h.wallThickness = Math.min(h.wallThickness, Math.min(h.length, h.width) / 4);
  h.floorThickness = Math.min(h.floorThickness, h.wallHeight / 3);
  if (!["gable", "flat"].includes(h.roofType)) h.roofType = DEFAULT_HOUSE.roofType;
  return h;
}

// ---------------------------------------------------------------- элементы

export function findElement(project, id) {
  return project.elements.find((e) => e.id === id) || null;
}

export function hostedOpenings(project, wallId) {
  return project.elements.filter((e) => e.hostId === wallId);
}

export function nextId(project, type) {
  let max = 0;
  const re = new RegExp(`^${type}-(\\d+)$`);
  for (const el of project.elements) {
    const m = re.exec(el.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${type}-${max + 1}`;
}

/**
 * Добавляет элемент с разумными параметрами по умолчанию.
 * options: { hostId, offset } — для окон и дверей.
 * Возвращает созданный элемент или бросает Error с понятным сообщением.
 */
export function addElement(project, type, options = {}) {
  if (!ELEMENT_TYPES[type]) throw new Error(`Неизвестный тип элемента: ${type}`);
  const h = project.house;
  const id = nextId(project, type);
  const number = id.split("-")[1];
  let el;

  if (type === "foundation") {
    const spec = shellSpecs(h).foundation;
    el = {
      id, type, name: `Фундамент ${number}`, category: "slab", material: "concrete",
      position: spec.position, rotation: 0, size: spec.size, params: {},
    };
  } else if (type === "wall") {
    // Перегородка поперёк дома посередине
    el = {
      id, type, name: `Перегородка ${number}`, category: "interior", material: "aerated_concrete",
      position: { x: round3(h.length / 2), y: h.wallThickness, z: h.floorThickness },
      rotation: 90,
      size: { length: round3(h.width - 2 * h.wallThickness), thickness: 0.12, height: round3(h.wallHeight - h.floorThickness) },
      params: {},
    };
  } else if (type === "floor") {
    // Перекрытие по верху наружных стен (чердачное)
    el = {
      id, type, name: `Перекрытие ${number}`, category: "slab", material: "concrete",
      position: { x: h.wallThickness, y: h.wallThickness, z: h.wallHeight },
      rotation: 0,
      size: { length: round3(h.length - 2 * h.wallThickness), width: round3(h.width - 2 * h.wallThickness), thickness: 0.2 },
      params: {},
    };
  } else if (type === "roof") {
    const hasMainRoof = project.elements.some((e) => e.type === "roof" && e.category === "main");
    if (!hasMainRoof) {
      const spec = shellSpecs(h).roof;
      el = {
        id, type, name: SHELL_NAMES.roof, category: "main", material: "metal_tile", shell: "roof",
        position: spec.position, rotation: 0, size: spec.size, params: spec.params,
      };
    } else {
      // Навес над входом с южной стороны
      el = {
        id, type, name: `Навес ${number}`, category: "canopy", material: "membrane",
        position: { x: round3(h.length / 2 - 1.5), y: -1.5, z: round3(Math.min(h.wallHeight, 2.4)) },
        rotation: 0,
        size: { length: 3, width: 1.5 },
        params: { roofType: "flat", slope: 0, thickness: 0.1 },
      };
    }
  } else {
    el = createOpening(project, type, id, number, options);
  }

  project.elements.push(el);
  normalizeElement(project, el);
  touch(project);
  return el;
}

/**
 * Параметры стены по двум точкам плана (ось стены проходит по линии p1 → p2) — без добавления в проект.
 * Низ стены ставится на верх фундамента или пола под ней, верх выравнивается по верху наружных стен.
 * Используется и для предпросмотра при рисовании, и для создания стены.
 */
export function planWall(project, p1, p2, options = {}) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy);
  const h = project.house;
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const insideFloor = project.elements.some((e) => e.type === "floor" && footprintContains(e, mid.x, mid.y, -0.01));
  const category = options.category || (insideFloor ? "interior" : "exterior");
  const thickness = options.thickness || (category === "interior" ? 0.12 : h.wallThickness);
  const samples = [0.02, 0.5, 0.98].map((f) => ({ x: p1.x + dx * f, y: p1.y + dy * f }));
  const base = supportLevel(project, samples);
  const height = options.height || Math.max(LIMITS.wall.height[0], h.wallHeight - base);
  const rotation = length ? (Math.atan2(dy, dx) * 180) / Math.PI : 0;
  const nx = length ? -dy / length : 0, ny = length ? dx / length : 1; // нормаль влево: в эту сторону откладывается толщина
  return {
    type: "wall",
    category,
    material: options.material || (category === "interior" ? "aerated_concrete" : "brick"),
    position: { x: round3(p1.x - (nx * thickness) / 2), y: round3(p1.y - (ny * thickness) / 2), z: round3(base) },
    rotation,
    size: { length: round3(length), thickness, height: round3(height) },
    params: {},
  };
}

/** Добавляет стену по двум точкам плана (см. planWall). */
export function addWallByPoints(project, p1, p2, options = {}) {
  const spec = planWall(project, p1, p2, options);
  if (spec.size.length < LIMITS.wall.length[0]) throw new Error("Стена слишком короткая — отметьте вторую точку дальше");
  const id = nextId(project, "wall");
  const el = {
    id,
    name: `${spec.category === "interior" ? "Перегородка" : "Стена"} ${id.split("-")[1]}`,
    ...spec,
  };
  project.elements.push(el);
  normalizeElement(project, el);
  touch(project);
  return el;
}

/** Фундамент или пол прямоугольником по двум углам плана. */
export function addRectElement(project, type, a, b) {
  if (type !== "floor" && type !== "foundation") throw new Error(`Прямоугольником строятся только пол и фундамент`);
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const length = Math.abs(b.x - a.x), width = Math.abs(b.y - a.y);
  const lim = LIMITS[type];
  if (length < lim.length[0] || width < lim.width[0]) throw new Error("Прямоугольник слишком маленький");
  const h = project.house;
  const id = nextId(project, type);
  const n = id.split("-")[1];
  let el;
  if (type === "foundation") {
    const t = h.foundationThickness;
    el = {
      id, type, name: `Фундамент ${n}`, category: Math.min(length, width) < 1.2 ? "strip" : "slab", material: "concrete",
      position: { x: round3(x0), y: round3(y0), z: -t }, rotation: 0,
      size: { length: round3(length), width: round3(width), thickness: t }, params: {},
    };
  } else {
    const z = supportLevel(project, [{ x: x0 + length / 2, y: y0 + width / 2 }], { types: ["foundation"] });
    el = {
      id, type, name: `Пол ${n}`, category: z < 0.5 ? "ground" : "slab", material: "concrete",
      position: { x: round3(x0), y: round3(y0), z: round3(z) }, rotation: 0,
      size: { length: round3(length), width: round3(width), thickness: h.floorThickness }, params: {},
    };
  }
  project.elements.push(el);
  normalizeElement(project, el);
  touch(project);
  return el;
}

/**
 * Перемещение элемента на плане. Стены и полы после переноса снова «садятся» на основание под ними
 * (фундамент, пол), поэтому их не нужно поднимать или опускать вручную.
 */
export function moveElement(project, id, dx, dy) {
  const el = findElement(project, id);
  if (!el || !el.position || el.hostId) return [];
  const pos = { x: round3(el.position.x + dx), y: round3(el.position.y + dy), z: el.position.z };
  const moved = { ...el, position: pos };
  if (el.type === "wall" || el.type === "floor") {
    const types = el.type === "wall" ? ["foundation", "floor"] : ["foundation"];
    const pts = footprint(moved);
    const center = { x: (pts[0].x + pts[2].x) / 2, y: (pts[0].y + pts[2].y) / 2 };
    const s = supportLevel(project, [center, ...shrink(pts, center, 0.9)], { types, below: el.position.z + 0.3, excludeIds: [el.id], fallback: el.position.z });
    pos.z = round3(s);
  }
  return updateElement(project, id, { position: pos });
}

function shrink(points, center, k) {
  return points.map((p) => ({ x: center.x + (p.x - center.x) * k, y: center.y + (p.y - center.y) * k }));
}

function createOpening(project, type, id, number, options) {
  const host = options.hostId
    ? findElement(project, options.hostId)
    : project.elements.find((e) => e.type === "wall" && e.category === "exterior") ||
      project.elements.find((e) => e.type === "wall");
  if (!host || host.type !== "wall") {
    throw new Error("Окна и двери можно добавить только в стену. Сначала добавьте или выберите стену.");
  }
  const isDoor = type === "door";
  const size = isDoor ? { width: 0.9, height: 2.1 } : { width: 1.5, height: 1.4 };
  const elevation = isDoor ? 0 : 0.9;
  if (size.width > host.size.length) size.width = host.size.length;
  if (elevation + size.height > host.size.height) size.height = Math.max(0.3, host.size.height - elevation);

  let offset = options.offset;
  if (offset === undefined || offset < 0 || offset + size.width > host.size.length ||
      !isFree(project, host, offset, size.width, 0.1)) {
    offset = findFreeOffset(project, host, size.width);
  }
  if (offset === null) {
    throw new Error(`В стене «${host.name}» нет свободного места для нового проёма.`);
  }
  return {
    id, type,
    name: isDoor ? `Дверь ${number}` : `Окно ${number}`,
    category: isDoor ? (host.category === "exterior" ? "entrance" : "interior") : (host.category === "exterior" ? "exterior" : "interior"),
    material: isDoor ? "wood_door" : "pvc_window",
    hostId: host.id,
    position: { offset: round3(offset), elevation },
    size,
    params: {},
  };
}

/** Ищет свободное место вдоль стены, начиная от середины. */
export function findFreeOffset(project, wall, width, gap = 0.3) {
  const L = wall.size.length;
  if (width > L) return null;
  const candidates = [];
  for (let x = 0; x <= L - width + 1e-9; x += 0.05) candidates.push(round3(x));
  const center = (L - width) / 2;
  candidates.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
  return candidates.find((x) => isFree(project, wall, x, width, gap)) ?? null;
}

/** Не пересекается ли участок стены [offset, offset + width] с другими проёмами (с зазором gap). */
function isFree(project, wall, offset, width, gap) {
  return hostedOpenings(project, wall.id).every((o) =>
    offset + width <= o.position.offset - gap || offset >= o.position.offset + o.size.width + gap
  );
}

/**
 * Изменяет элемент. patch может содержать вложенные position/size/params.
 * После изменения значения приводятся к допустимым диапазонам.
 * Возвращает список сообщений о скорректированных значениях.
 */
export function updateElement(project, id, patch) {
  const el = findElement(project, id);
  if (!el) throw new Error(`Элемент ${id} не найден`);
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      el[key] = { ...(el[key] || {}), ...value };
    } else {
      el[key] = value;
    }
  }
  // Ручное редактирование отвязывает элемент от параметров дома
  if (el.shell && (patch.position || patch.size || patch.rotation !== undefined)) delete el.shell;
  const notes = normalizeElement(project, el);
  if (el.type === "wall") {
    for (const o of hostedOpenings(project, el.id)) notes.push(...normalizeElement(project, o));
  }
  touch(project);
  return notes;
}

/** Удаляет элемент; вместе со стеной удаляются её окна и двери. Возвращает id удалённых. */
export function removeElement(project, id) {
  const removed = new Set([id]);
  for (const el of project.elements) if (el.hostId === id) removed.add(el.id);
  project.elements = project.elements.filter((e) => !removed.has(e.id));
  touch(project);
  return [...removed];
}

/** Приводит размеры элемента к допустимым диапазонам; возвращает тексты корректировок. */
export function normalizeElement(project, el) {
  const notes = [];
  const lim = LIMITS[el.type] || {};
  const fix = (obj, key, min, max, label = FIELD_LABELS[key] || key, unit = "м") => {
    const raw = Number(obj[key]);
    const v = clamp(Number.isFinite(raw) ? raw : min, min, max);
    if (Math.abs(v - raw) > 1e-9 || !Number.isFinite(raw)) {
      notes.push(`${label}: значение ограничено диапазоном ${round3(min)}–${round3(max)} ${unit}`);
    }
    obj[key] = round3(v);
  };

  if (el.type === "wall" || el.type === "floor" || el.type === "foundation") {
    for (const key of Object.keys(lim)) fix(el.size, key, lim[key][0], lim[key][1]);
    el.rotation = normAngle(el.rotation);
  } else if (el.type === "roof") {
    fix(el.size, "length", ...lim.length);
    fix(el.size, "width", ...lim.width);
    el.params = { roofType: "gable", slope: 30, thickness: 0.2, ...el.params };
    if (!["gable", "flat"].includes(el.params.roofType)) el.params.roofType = "gable";
    fix(el.params, "slope", ...lim.slope, "Уклон", "°");
    fix(el.params, "thickness", ...lim.thickness);
    el.rotation = normAngle(el.rotation);
  } else if (OPENING_TYPES.includes(el.type)) {
    const host = findElement(project, el.hostId);
    if (!host || host.type !== "wall") {
      notes.push("Проём не привязан к стене");
      return notes;
    }
    fix(el.size, "width", lim.width[0], Math.max(lim.width[0], Math.min(lim.width[1], host.size.length)), "Ширина");
    fix(el.size, "height", lim.height[0], Math.max(lim.height[0], Math.min(lim.height[1], host.size.height)), "Высота");
    fix(el.position, "offset", 0, Math.max(0, host.size.length - el.size.width), "Отступ от начала стены");
    fix(el.position, "elevation", 0, Math.max(0, host.size.height - el.size.height), "Высота низа проёма");
  }
  return notes;
}

/**
 * Замечания к целостности модели (не нормы!): пересекающиеся проёмы, проёмы без стены.
 * Возвращает [{ elementId, message }].
 */
export function findModelIssues(project) {
  const issues = [];
  const walls = new Map(project.elements.filter((e) => e.type === "wall").map((w) => [w.id, w]));
  for (const el of project.elements) {
    if (OPENING_TYPES.includes(el.type) && !walls.has(el.hostId)) {
      issues.push({ elementId: el.id, message: `${el.name}: стена-основа «${el.hostId}» не найдена` });
    }
  }
  for (const wall of walls.values()) {
    const list = hostedOpenings(project, wall.id);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const overlapU = a.position.offset < b.position.offset + b.size.width - 1e-6 &&
          b.position.offset < a.position.offset + a.size.width - 1e-6;
        const overlapW = a.position.elevation < b.position.elevation + b.size.height - 1e-6 &&
          b.position.elevation < a.position.elevation + a.size.height - 1e-6;
        if (overlapU && overlapW) {
          issues.push({ elementId: b.id, message: `${a.name} и ${b.name} пересекаются в стене «${wall.name}»` });
        }
      }
    }
  }
  return issues;
}

function clampAllOpenings(project) {
  for (const el of project.elements) {
    if (OPENING_TYPES.includes(el.type)) normalizeElement(project, el);
  }
}

function normAngle(a) {
  const v = Number(a) || 0;
  return round3(((v % 360) + 360) % 360);
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

export function touch(project) {
  project.updatedAt = new Date().toISOString();
}
