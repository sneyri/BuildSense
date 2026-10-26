// Расчёт проверяемых параметров модели. Результат — простой объект,
// который получает checker.js: ему не нужно знать о геометрии и Three.js.
import { OPENING_TYPES } from "./catalog.js";
import { elementBounds, round } from "./placement.js";

const MIN_STOREY_HEIGHT = 2.0; // м: уровень пола считается этажом, если над ним есть наружные стены такой высоты

/** Описание параметров: подпись, единица измерения и допущения модели. */
export const PARAMETERS = {
  "project.climateRegion": { label: "Климатический подрайон", unit: null },
  "project.housingFund": { label: "Жилищный фонд", unit: null },
  "building.storeys": {
    label: "Количество надземных этажей", unit: "count",
    note: "Этаж — уровень элемента «Пол», над которым есть наружные стены высотой не менее 2 м.",
  },
  "building.height": {
    label: "Высота дома", unit: "m",
    note: "От отметки z = 0 (условная отметка земли) до верхней точки модели (конька крыши).",
  },
  "building.floorArea": { label: "Площадь полов этажей", unit: "m2" },
  "building.windowArea": { label: "Площадь окон в наружных стенах", unit: "m2" },
  "building.glazingRatio": {
    label: "Отношение площади окон к площади пола", unit: "ratio",
    note: "Весь дом рассматривается как одно помещение: комнаты в модели не задаются.",
  },
  "room.clearHeight": {
    label: "Высота помещений первого этажа (от пола до потолка)", unit: "m",
    note: "От верха пола первого этажа до низа ближайшего перекрытия или до верха наружных стен.",
  },
  "rooms.commonRoomArea": {
    label: "Площадь общей комнаты", unit: "m2",
    note: "Помещения (комнаты) в прототипе не моделируются — параметр недоступен.",
  },
  "element.category": { label: "Категория элемента", unit: null },
  "wall.length": { label: "Длина стены", unit: "m" },
  "wall.thickness": { label: "Толщина стены", unit: "m" },
  "wall.height": { label: "Высота стены", unit: "m" },
  "floor.thickness": { label: "Толщина пола", unit: "m" },
  "foundation.thickness": { label: "Толщина фундамента", unit: "m" },
  "foundation.depth": { label: "Заглубление фундамента ниже отметки 0", unit: "m" },
  "floor.area": { label: "Площадь пола", unit: "m2" },
  "roof.type": { label: "Тип крыши", unit: null },
  "roof.slope": { label: "Уклон крыши", unit: "deg" },
  "window.width": { label: "Ширина окна", unit: "m" },
  "window.height": { label: "Высота окна", unit: "m" },
  "window.sillHeight": { label: "Высота подоконника", unit: "m" },
  "window.area": { label: "Площадь окна", unit: "m2" },
  "door.width": { label: "Ширина дверного проёма", unit: "m", note: "Ширина проёма в стене, а не «в свету» дверной коробки." },
  "door.height": { label: "Высота дверного проёма", unit: "m" },
};

export function parameterUnits() {
  return Object.fromEntries(Object.entries(PARAMETERS).map(([k, v]) => [k, v.unit]));
}

/**
 * Собирает параметры модели для проверки норм.
 * Отсутствующее значение — null: проверка по нему получит статус NOT VERIFIED.
 */
export function collectParameters(project) {
  const storeyFloors = findStoreyFloors(project);
  const exteriorWindows = project.elements.filter((e) => {
    if (e.type !== "window") return false;
    const host = project.elements.find((w) => w.id === e.hostId);
    return host && host.category === "exterior";
  });

  const floorArea = sum(storeyFloors.map((f) => f.size.length * f.size.width));
  const windowArea = sum(exteriorWindows.map((w) => w.size.width * w.size.height));

  const building = {
    "project.climateRegion": project.settings.climateRegion ?? null,
    "project.housingFund": project.settings.housingFund ?? null,
    "building.storeys": storeyFloors.length ? new Set(storeyFloors.map((f) => levelKey(floorTop(f)))).size : null,
    "building.height": buildingHeight(project),
    "building.floorArea": storeyFloors.length ? round(floorArea, 3) : null,
    "building.windowArea": round(windowArea, 3),
    "building.glazingRatio": floorArea > 0 ? round(windowArea / floorArea, 4) : null,
    "room.clearHeight": clearHeight(project, storeyFloors),
    "rooms.commonRoomArea": null,
  };

  const elements = project.elements.map((el) => ({
    id: el.id,
    type: el.type,
    name: el.name,
    values: elementValues(el),
  }));

  return { units: parameterUnits(), building, elements };
}

function elementValues(el) {
  const v = { "element.category": el.category };
  const s = el.size;
  if (el.type === "wall") {
    Object.assign(v, { "wall.length": s.length, "wall.thickness": s.thickness, "wall.height": s.height });
  } else if (el.type === "floor") {
    Object.assign(v, { "floor.thickness": s.thickness, "floor.area": round(s.length * s.width, 3) });
  } else if (el.type === "foundation") {
    Object.assign(v, { "foundation.thickness": s.thickness, "foundation.depth": round(Math.max(0, -el.position.z), 3) });
  } else if (el.type === "roof") {
    Object.assign(v, {
      "roof.type": el.params.roofType,
      "roof.slope": el.params.roofType === "gable" ? el.params.slope : null,
    });
  } else if (el.type === "window") {
    Object.assign(v, {
      "window.width": s.width, "window.height": s.height,
      "window.sillHeight": el.position.elevation, "window.area": round(s.width * s.height, 3),
    });
  } else if (el.type === "door") {
    Object.assign(v, { "door.width": s.width, "door.height": s.height });
  }
  return v;
}

function floorTop(f) {
  return f.position.z + f.size.thickness;
}

function levelKey(z) {
  return Math.round(z * 20) / 20; // уровни с точностью 5 см
}

function exteriorWalls(project) {
  return project.elements.filter((e) => e.type === "wall" && e.category === "exterior");
}

/** Полы, над которыми стоят наружные стены высотой не менее MIN_STOREY_HEIGHT. */
function findStoreyFloors(project) {
  const walls = exteriorWalls(project);
  return project.elements.filter((f) => {
    if (f.type !== "floor") return false;
    const top = floorTop(f);
    return walls.some((w) => w.position.z <= top + 0.01 && w.position.z + w.size.height >= top + MIN_STOREY_HEIGHT);
  });
}

function clearHeight(project, storeyFloors) {
  if (!storeyFloors.length) return null;
  const top = Math.min(...storeyFloors.map(floorTop));
  const ceilings = [];
  for (const w of exteriorWalls(project)) {
    const wTop = w.position.z + w.size.height;
    if (w.position.z <= top + 0.01 && wTop > top) ceilings.push(wTop);
  }
  for (const f of project.elements) {
    if (f.type === "floor" && f.position.z > top + 0.01) ceilings.push(f.position.z);
  }
  return ceilings.length ? round(Math.min(...ceilings) - top, 3) : null;
}

function buildingHeight(project) {
  let maxZ = -Infinity;
  for (const el of project.elements) {
    if (OPENING_TYPES.includes(el.type)) continue;
    const b = elementBounds(el, project);
    if (b) maxZ = Math.max(maxZ, b.max.z);
  }
  return Number.isFinite(maxZ) ? round(maxZ, 3) : null;
}

function sum(list) {
  return list.reduce((a, b) => a + b, 0);
}
