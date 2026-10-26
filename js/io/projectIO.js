// Сохранение и загрузка проекта в JSON, проверка структуры файла, автосохранение.
import { CLIMATE_REGIONS, ELEMENT_TYPES, HOUSING_FUNDS, OPENING_TYPES } from "../model/catalog.js";
import {
  DEFAULT_HOUSE, DEFAULT_SETTINGS, PROJECT_FORMAT, PROJECT_VERSION, normalizeElement, normalizeHouse,
} from "../model/project.js";

const AUTOSAVE_KEY = "freecad-checker.autosave.v1";

const REQUIRED = {
  wall: { position: ["x", "y", "z"], size: ["length", "thickness", "height"] },
  floor: { position: ["x", "y", "z"], size: ["length", "width", "thickness"] },
  foundation: { position: ["x", "y", "z"], size: ["length", "width", "thickness"] },
  roof: { position: ["x", "y", "z"], size: ["length", "width"] },
  window: { position: ["offset", "elevation"], size: ["width", "height"] },
  door: { position: ["offset", "elevation"], size: ["width", "height"] },
};

export function serializeProject(project) {
  return JSON.stringify(project, null, 2);
}

/**
 * Разбирает и проверяет текст файла проекта.
 * Возвращает { project, warnings }; при неисправимых ошибках бросает Error с понятным текстом.
 */
export function parseProject(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Файл не является корректным JSON: ${err.message}`);
  }
  return validateProjectData(data);
}

export function validateProjectData(data) {
  const warnings = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Ожидался объект проекта в формате JSON");
  }
  if (data.format === "freecad-checker-export") {
    throw new Error("Это файл экспорта для FreeCAD (его читает макрос import_house.FCMacro), а не файл проекта");
  }
  if (data.format !== PROJECT_FORMAT) {
    throw new Error(`Неизвестный формат файла: ожидалось "${PROJECT_FORMAT}"`);
  }
  if (typeof data.version !== "number" || data.version > PROJECT_VERSION) {
    throw new Error(`Версия файла ${data.version} не поддерживается (поддерживается до ${PROJECT_VERSION})`);
  }
  if (!Array.isArray(data.elements)) {
    throw new Error("В проекте нет списка элементов (elements)");
  }

  const project = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Без названия",
    units: "m",
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS, ...(isObject(data.settings) ? data.settings : {}) },
    house: { ...DEFAULT_HOUSE, ...(isObject(data.house) ? data.house : {}) },
    elements: [],
  };
  if (data.units && data.units !== "m") {
    throw new Error(`Единицы измерения "${data.units}" не поддерживаются — проект хранится в метрах ("m")`);
  }
  if (!CLIMATE_REGIONS.some((r) => r.id === project.settings.climateRegion)) {
    warnings.push(`Неизвестный климатический подрайон "${project.settings.climateRegion}" — установлен ${DEFAULT_SETTINGS.climateRegion}`);
    project.settings.climateRegion = DEFAULT_SETTINGS.climateRegion;
  }
  if (!HOUSING_FUNDS.some((f) => f.id === project.settings.housingFund)) {
    project.settings.housingFund = DEFAULT_SETTINGS.housingFund;
  }
  normalizeHouse(project.house);

  const ids = new Set();
  for (const [index, raw] of data.elements.entries()) {
    const where = `элемент №${index + 1}`;
    if (!isObject(raw)) {
      warnings.push(`${where}: не объект — пропущен`);
      continue;
    }
    if (typeof raw.id !== "string" || !raw.id.trim()) {
      throw new Error(`${where}: нет идентификатора id`);
    }
    if (ids.has(raw.id)) throw new Error(`Повторяющийся идентификатор элемента: ${raw.id}`);
    ids.add(raw.id);

    const typeInfo = ELEMENT_TYPES[raw.type];
    if (!typeInfo) {
      warnings.push(`${raw.id}: неизвестный тип "${raw.type}" — элемент пропущен`);
      continue;
    }
    const req = REQUIRED[raw.type];
    for (const group of ["position", "size"]) {
      if (!isObject(raw[group])) throw new Error(`${raw.id}: нет блока ${group}`);
      for (const key of req[group]) {
        if (typeof raw[group][key] !== "number" || !Number.isFinite(raw[group][key])) {
          throw new Error(`${raw.id}: ${group}.${key} должно быть числом`);
        }
      }
    }
    const element = {
      ...raw,
      position: { ...raw.position },
      size: { ...raw.size },
      params: isObject(raw.params) ? { ...raw.params } : {},
      name: typeof raw.name === "string" && raw.name ? raw.name : raw.id,
    };
    if (!typeInfo.materials.includes(element.material)) {
      warnings.push(`${raw.id}: материал "${raw.material}" не из справочника — заменён на "${typeInfo.materials[0]}"`);
      element.material = typeInfo.materials[0];
    }
    if (!typeInfo.categories[element.category]) {
      const fallback = Object.keys(typeInfo.categories)[0];
      warnings.push(`${raw.id}: категория "${raw.category}" не из справочника — заменена на "${fallback}"`);
      element.category = fallback;
    }
    if (!OPENING_TYPES.includes(element.type)) {
      element.rotation = typeof raw.rotation === "number" ? raw.rotation : 0;
    }
    project.elements.push(element);
  }

  // Нормализация после загрузки всех элементов: проёмам нужны их стены
  for (const element of project.elements) {
    if (OPENING_TYPES.includes(element.type) && !project.elements.some((e) => e.id === element.hostId && e.type === "wall")) {
      warnings.push(`${element.id}: стена-основа "${element.hostId}" не найдена`);
      continue;
    }
    for (const note of normalizeElement(project, element)) warnings.push(`${element.id}: ${note}`);
  }
  return { project, warnings };
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Имя файла из названия проекта (кириллица допустима, запрещённые символы убираются). */
export function fileNameFor(project, suffix) {
  const base = (project.name || "project").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 60);
  return `${base}${suffix}`;
}

// ---------------------------------------------------------------- браузерная часть

export function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Не удалось прочитать файл ${file.name}`));
    reader.readAsText(file, "utf-8");
  });
}

/** Автосохранение в localStorage браузера. Ошибки (приватный режим, квота) не критичны. */
export function autosave(project) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(project));
  } catch {
    /* хранилище недоступно — работаем без автосохранения */
  }
}

export function loadAutosave() {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? parseProject(text) : null;
  } catch {
    return null;
  }
}
