// Экспорт модели в JSON для макроса freecad/import_house.FCMacro.
//
// Формат намеренно «плоский»: все координаты уже переведены в мировые миллиметры
// (FreeCAD хранит длины в мм), поэтому макрос только создаёт объекты и почти не считает.
// Это обычная CAD-геометрия (Part::Box, Part::Wedge, Part::Cut), а не BIM/IFC-модель.
import { materialColor, materialLabel } from "../model/catalog.js";
import { roofRise, round, wallLocalToWorld } from "../model/placement.js";

export const EXPORT_FORMAT = "freecad-checker-export";
export const EXPORT_VERSION = 1;

const VOID_MARGIN = 0.05;   // м: вырез выходит за грани стены, чтобы булева операция была надёжной
const WINDOW_PANEL = 0.06;  // м: толщина условного блока окна
const DOOR_PANEL = 0.05;    // м: толщина дверного полотна
const EPS = 1e-6;

const mm = (v) => round(v * 1000, 2);
const point = (p) => ({ x: mm(p.x), y: mm(p.y), z: mm(p.z) });

/**
 * @param {object} project
 * @param {{ checkSummary?: object }} [extra]
 * @returns {{ data: object, warnings: string[] }}
 */
export function buildFreecadExport(project, extra = {}) {
  const warnings = [];
  const elements = [];

  for (const el of project.elements) {
    const base = {
      id: el.id,
      type: el.type,
      name: el.name || el.id,
      category: el.category,
      material: el.material,
      materialLabel: materialLabel(el.material),
      color: materialColor(el.material),
    };

    if (el.type === "wall") {
      elements.push({
        ...base,
        placement: { ...point(el.position), rotationZ: el.rotation || 0 },
        size: { length: mm(el.size.length), thickness: mm(el.size.thickness), height: mm(el.size.height) },
        openings: project.elements.filter((o) => o.hostId === el.id).map((o) => o.id),
      });
    } else if (el.type === "floor" || el.type === "foundation") {
      elements.push({
        ...base,
        placement: { ...point(el.position), rotationZ: el.rotation || 0 },
        size: { length: mm(el.size.length), width: mm(el.size.width), thickness: mm(el.size.thickness) },
      });
    } else if (el.type === "roof") {
      const gable = el.params.roofType === "gable";
      elements.push({
        ...base,
        roofType: el.params.roofType,
        slope: gable ? el.params.slope : 0,
        placement: { ...point(el.position), rotationZ: el.rotation || 0 },
        size: gable
          ? { length: mm(el.size.length), width: mm(el.size.width), rise: mm(roofRise(el)) }
          : { length: mm(el.size.length), width: mm(el.size.width), thickness: mm(el.params.thickness) },
      });
    } else if (el.type === "window" || el.type === "door") {
      const host = project.elements.find((w) => w.id === el.hostId && w.type === "wall");
      if (!host) {
        warnings.push(`${el.id}: стена-основа ${el.hostId} не найдена — проём не экспортирован`);
        continue;
      }
      elements.push({ ...base, ...openingGeometry(el, host) });
    }
  }

  const data = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    units: "mm",
    generator: "FreeCAD Checker (учебный прототип)",
    exportedAt: new Date().toISOString(),
    axes: "Z вверх; placement — точка начала элемента и поворот вокруг Z (градусы); размеры в мм",
    project: {
      name: project.name,
      climateRegion: project.settings.climateRegion,
      housingFund: project.settings.housingFund,
    },
    elements,
  };
  if (extra.checkSummary) data.checkSummary = extra.checkSummary;
  return { data, warnings };
}

/**
 * Вырез в стене (void) и условное заполнение проёма (panel) в мировых координатах.
 * Локальные оси стены: u — вдоль, v — по толщине, w — вверх.
 */
function openingGeometry(el, host) {
  const L = host.size.length;
  const H = host.size.height;
  const t = host.size.thickness;
  const { offset, elevation } = el.position;
  const { width, height } = el.size;

  // Если проём касается края стены, вырез продлевается наружу, чтобы не было совпадающих граней
  const u0 = offset <= EPS ? offset - VOID_MARGIN : offset;
  const u1 = offset + width >= L - EPS ? offset + width + VOID_MARGIN : offset + width;
  const w0 = elevation <= EPS ? elevation - VOID_MARGIN : elevation;
  const w1 = elevation + height >= H - EPS ? elevation + height + VOID_MARGIN : elevation + height;

  const panelT = Math.min(el.type === "door" ? DOOR_PANEL : WINDOW_PANEL, t);
  const rotationZ = host.rotation || 0;

  return {
    hostId: host.id,
    size: { width: mm(width), height: mm(height) },
    position: { offset: mm(offset), elevation: mm(elevation) },
    void: {
      placement: { ...point(wallLocalToWorld(host, u0, -VOID_MARGIN, w0)), rotationZ },
      size: { length: mm(u1 - u0), width: mm(t + 2 * VOID_MARGIN), height: mm(w1 - w0) },
    },
    panel: {
      placement: { ...point(wallLocalToWorld(host, offset, (t - panelT) / 2, elevation)), rotationZ },
      size: { length: mm(width), width: mm(panelT), height: mm(height) },
    },
  };
}
