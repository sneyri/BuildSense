// Сохранение и загрузка проекта (JSON), проверка структуры, миграция старого формата, автосохранение.
// Скачивание и чтение файлов работают и при открытии index.html двойным щелчком (file://).
(function (BS) {
  "use strict";
  const U = BS.util;
  const P = BS.project;
  const AUTOSAVE_KEY = "buildsense.autosave.v2";

  function serialize(project) {
    return JSON.stringify(project, null, 2);
  }

  /** Разбор текста файла проекта: { project, warnings }. Неисправимые ошибки — Error с понятным текстом. */
  function parse(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`Файл не является корректным JSON: ${err.message}`);
    }
    return fromData(data);
  }

  function fromData(data) {
    if (!U.isObject(data)) throw new Error("Ожидался объект проекта в формате JSON");
    if (data.format === "buildsense-freecad-export" || data.format === "freecad-checker-export") {
      throw new Error("Это файл экспорта для FreeCAD (его читает макрос), а не файл проекта");
    }
    const warnings = [];
    if (data.format === "freecad-checker-project") {
      data = migrateV1(data);
      warnings.push("Проект прежней версии (FreeCAD Checker) преобразован в формат BuildSense 2");
    }
    if (data.format !== P.FORMAT) throw new Error(`Неизвестный формат файла: ожидалось "${P.FORMAT}"`);
    if (typeof data.schemaVersion !== "number" || data.schemaVersion > P.SCHEMA_VERSION) {
      throw new Error(`Версия схемы ${data.schemaVersion} не поддерживается (поддерживается до ${P.SCHEMA_VERSION})`);
    }
    if (!Array.isArray(data.elements)) throw new Error("В проекте нет списка элементов (elements)");
    if (data.units && data.units !== "m") throw new Error(`Единицы "${data.units}" не поддерживаются — проект хранится в метрах`);

    const project = P.createProject(typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Без названия");
    project.createdAt = data.createdAt || project.createdAt;
    project.updatedAt = data.updatedAt || project.updatedAt;
    project.settings = U.merge(U.clone(P.DEFAULT_SETTINGS), U.isObject(data.settings) ? data.settings : {});
    project.house = { ...P.DEFAULT_HOUSE, ...(U.isObject(data.house) ? data.house : {}) };
    if (Array.isArray(data.levels) && data.levels.length) {
      project.levels = data.levels.map((l, i) => ({
        id: String(l.id || `L${i + 1}`), name: String(l.name || `Этаж ${i + 1}`),
        elevation: Number(l.elevation) || 0, height: Number(l.height) || 2.8,
      }));
    }
    project.customRules = Array.isArray(data.customRules) ? data.customRules : [];

    const ids = new Set();
    const levelIds = new Set(project.levels.map((l) => l.id));
    for (const [i, raw] of data.elements.entries()) {
      const where = `элемент №${i + 1}`;
      if (!U.isObject(raw)) { warnings.push(`${where}: не объект — пропущен`); continue; }
      if (typeof raw.id !== "string" || !raw.id.trim()) throw new Error(`${where}: нет идентификатора id`);
      if (ids.has(raw.id)) throw new Error(`Повторяющийся идентификатор элемента: ${raw.id}`);
      ids.add(raw.id);
      const t = BS.types.get(raw.type);
      if (!t) { warnings.push(`${raw.id}: неизвестный тип "${raw.type}" — элемент пропущен`); continue; }
      for (const group of ["position", "size"]) {
        if (!U.isObject(raw[group])) throw new Error(`${raw.id}: нет блока ${group}`);
        for (const [k, v] of Object.entries(raw[group])) {
          if (typeof v !== "number") throw new Error(`${raw.id}: ${group}.${k} должно быть числом`);
        }
      }
      const el = U.clone(raw);
      el.name = typeof raw.name === "string" && raw.name ? raw.name : raw.id;
      el.params = { ...U.clone(t.params), ...(U.isObject(raw.params) ? raw.params : {}) };
      el.size = { ...t.size, ...raw.size };
      if (!t.materials.includes(el.material)) {
        warnings.push(`${raw.id}: материал "${raw.material}" не из списка для типа — заменён на «${BS.materials.label(t.materials[0])}»`);
        el.material = t.materials[0];
      }
      if (t.categories && !t.categories[el.category]) el.category = Object.keys(t.categories)[0];
      if (!levelIds.has(el.levelId)) el.levelId = project.levels[0].id;
      if (t.shape !== "opening" && typeof el.rotation !== "number") el.rotation = 0;
      project.elements.push(el);
    }
    // Размеры не «исправляются» молча: некорректные значения покажет проверка геометрии.
    for (const el of project.elements) {
      if ((BS.types.get(el.type) || {}).shape === "opening" && !project.elements.some((w) => w.id === el.hostId)) {
        warnings.push(`${el.id}: стена-основа "${el.hostId}" не найдена`);
      }
    }
    return { project, warnings };
  }

  /** Преобразование проекта FreeCAD Checker (версия 1) в формат BuildSense 2. */
  function migrateV1(old) {
    const typeMap = { foundation: "slab_foundation", floor: "slab", wall: "wall", roof: "roof", window: "window", door: "door" };
    const matMap = { aerated_concrete: "aerated", wood_board: "timber", pvc_window: "pvc", wood_window: "timber", steel_door: "steel" };
    const elements = (old.elements || []).map((e) => {
      const el = U.clone(e);
      el.type = typeMap[e.type] || e.type;
      el.material = matMap[e.material] || e.material;
      el.levelId = "L1";
      if (e.type === "floor" || e.type === "foundation") {
        el.size = { length: e.size.length, width: e.size.width, height: e.size.thickness };
        if (e.type === "floor") el.category = e.category === "slab" ? "attic" : "ground";
      }
      if (e.type === "wall" && e.category === "interior") el.category = "partition";
      return el;
    });
    return {
      format: P.FORMAT, schemaVersion: 2, name: old.name, units: "m",
      settings: { climateRegion: old.settings && old.settings.climateRegion, housingFund: old.settings && old.settings.housingFund },
      house: old.house ? { ...old.house, slabThickness: old.house.floorThickness } : undefined,
      levels: [{ id: "L1", name: "Этаж 1", elevation: 0, height: (old.house && old.house.wallHeight) || 2.8 }],
      elements,
    };
  }

  function fileNameFor(project, suffix) {
    const base = (project.name || "project").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 60);
    return `${base}${suffix}`;
  }

  // ---------------------------------------------------------------- браузер

  function download(filename, text, mime = "application/json") {
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

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Не удалось прочитать файл ${file.name}`));
      reader.readAsText(file, "utf-8");
    });
  }

  function autosave(project) {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialize(project));
    } catch {
      /* хранилище недоступно (приватный режим) — работаем без автосохранения */
    }
  }

  function loadAutosave() {
    try {
      const text = localStorage.getItem(AUTOSAVE_KEY);
      return text ? parse(text) : null;
    } catch {
      return null;
    }
  }

  function clearAutosave() {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      /* нет доступа — не критично */
    }
  }

  BS.projectIO = { serialize, parse, fromData, migrateV1, fileNameFor, download, readFile, autosave, loadAutosave, clearAutosave };
})(globalThis.BuildSense);
