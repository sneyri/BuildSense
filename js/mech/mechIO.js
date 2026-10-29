// BuildSense · Машиностроение — сохранение/загрузка проекта деталей, автосохранение, экспорт.
// Функции без DOM (serialize/parse/exportFreecadJson/fileNameFor) работают и в Node.
(function (BS) {
  "use strict";
  const M = BS.mechModel;
  const AUTOSAVE_KEY = "buildsense.mech.autosave.v1";

  function serialize(project) {
    return JSON.stringify(project, null, 2);
  }

  /** Текст → { project, errors }. Бросает Error с русским текстом, если это не проект деталей. */
  function parse(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Файл не является корректным JSON: ${e.message}`);
    }
    if (data && data.format === M.EXPORT_FORMAT)
      throw new Error("Это файл экспорта для FreeCAD (*.mech-freecad.json). Откройте сохранённый проект *.mech.json");
    return M.normalizeProject(data);
  }

  function exportFreecadJson(project) {
    return JSON.stringify(M.exportForCad(project), null, 2);
  }

  function fileNameFor(project, suffix) {
    const base = String(project.name || "mech").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 60) || "mech";
    return `${base}${suffix}`;
  }

  // ------------------------------------------------------------------ браузер

  /** Скачать файл: data — строка или ArrayBuffer. */
  function download(filename, data, mime = "application/json") {
    const type = typeof data === "string" ? `${mime};charset=utf-8` : mime;
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /** Диалог выбора файла; onText(text, file) вызывается с содержимым. */
  function openFile(onText, onError, accept = ".json,.mech.json,application/json") {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => onText(String(reader.result), file);
      reader.onerror = () => onError && onError(new Error(`Не удалось прочитать файл ${file.name}`));
      reader.readAsText(file, "utf-8");
    });
    document.body.append(input);
    input.click();
  }

  function autosave(project) {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialize(project));
      return true;
    } catch {
      return false; // хранилище недоступно — работаем без автосохранения
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
      /* не критично */
    }
  }

  BS.mechIO = { AUTOSAVE_KEY, serialize, parse, exportFreecadJson, fileNameFor, download, openFile, autosave, loadAutosave, clearAutosave };
})(globalThis.BuildSense);
