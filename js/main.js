// Точка входа: связывает модель проекта, 3D-сцену и панели интерфейса.
// Любое изменение идёт по одному пути: изменить project → commit() → перерисовать всё.
import { SceneView } from "./scene/sceneView.js";
import { buildProjectObjects } from "./scene/geometryBuilder.js";
import {
  addElement, applyHouseDimensions, buildBasicHouse, createBasicHouseProject,
  findElement, findModelIssues, removeElement, touch, updateElement,
} from "./model/project.js";
import { renderHouseForm } from "./ui/houseForm.js";
import { renderElementList } from "./ui/elementList.js";
import { renderProperties } from "./ui/propertiesPanel.js";
import {
  autosave, downloadText, fileNameFor, loadAutosave, parseProject, readFileAsText, serializeProject,
} from "./io/projectIO.js";
import { collectParameters } from "./model/metrics.js";
import { checkModel } from "./rules/checker.js";
import { loadRules } from "./rules/ruleLoader.js";
import { renderCheckPanel } from "./ui/checkPanel.js";
import { buildFreecadExport } from "./export/freecadExport.js";

const $ = (id) => document.getElementById(id);

const restored = loadAutosave();
const state = {
  project: restored ? restored.project : createBasicHouseProject("Дом 10×8"),
  selectedId: null,
  rules: [],
  ruleErrors: [],
  rulesStatus: "loading", // loading | ready | error
  rulesLoadError: null,
  report: null,
};

let view;
try {
  view = new SceneView($("viewport"), { onPick: (id) => select(id) });
} catch (err) {
  showViewError(`Не удалось запустить 3D-сцену (WebGL): ${err.message}`);
}

// ---------------------------------------------------------------- отрисовка

function commit({ refit = false, message } = {}) {
  touch(state.project);
  if (state.selectedId && !findElement(state.project, state.selectedId)) state.selectedId = null;
  autosave(state.project);
  renderAll();
  if (view) {
    view.setObjects(buildProjectObjects(state.project));
    view.setSelected(state.selectedId);
    if (refit) view.setView("iso");
  }
  const issues = findModelIssues(state.project);
  runChecks(issues);
  if (issues.length) {
    const prefix = message ? `${message}. ` : "";
    setStatus(`${prefix}Внимание: ${issues.map((i) => i.message).join("; ")}`, true);
  } else if (message) {
    setStatus(message);
  }
}

function renderAll() {
  $("project-name").value = state.project.name;
  renderHouseForm($("house-form"), state.project, {
    onHouseChange: (key, value) => {
      state.project.house[key] = value;
      applyHouseDimensions(state.project);
      commit({ message: "Габариты дома обновлены" });
    },
    onSettingChange: (key, value) => {
      state.project.settings[key] = value;
      commit({ message: "Параметры проекта обновлены" });
    },
    onRebuild: () => {
      if (!confirm("Удалить все элементы и построить дом заново по текущим параметрам?")) return;
      buildBasicHouse(state.project);
      state.selectedId = null;
      commit({ refit: true, message: "Дом пересоздан по параметрам" });
    },
  });
  renderElementList($("element-list"), $("element-count"), state.project, state.selectedId, select);
  renderProperties($("properties"), state.project, state.selectedId, {
    onChange: (id, patch) => {
      const notes = updateElement(state.project, id, patch);
      commit({ message: notes.length ? `Скорректировано: ${notes.join("; ")}` : `Элемент ${id} изменён` });
    },
    onDelete: (id) => {
      const removed = removeElement(state.project, id);
      state.selectedId = null;
      commit({ message: `Удалено: ${removed.join(", ")}` });
    },
    onAddOpening: (type, wallId) => addAndSelect(type, { hostId: wallId }),
    onSelect: select,
  });
  const h = state.project.house;
  $("status-dims").textContent = `Дом ${h.length} × ${h.width} м, стены ${h.wallHeight} м · элементов: ${state.project.elements.length}`;
}

// ---------------------------------------------------------------- проверка норм

function runChecks(issues = findModelIssues(state.project)) {
  const nodes = { summaryNode: $("check-summary"), resultsNode: $("check-results") };
  if (state.rulesStatus !== "ready") {
    renderCheckPanel(nodes, { loading: state.rulesStatus === "loading", loadError: state.rulesLoadError }, { onSelect: select });
    return;
  }
  state.report = checkModel(collectParameters(state.project), state.rules);
  renderCheckPanel(nodes, { report: state.report, ruleErrors: state.ruleErrors, modelIssues: issues }, { onSelect: select });
}

async function initRules() {
  try {
    const { rules, errors } = await loadRules("data/rules/");
    state.rules = rules;
    state.ruleErrors = errors;
    state.rulesStatus = "ready";
  } catch (err) {
    state.rulesStatus = "error";
    state.rulesLoadError = `Не удалось загрузить правила из data/rules: ${err.message}. ` +
      "Запустите приложение через локальный сервер (python serve.py), а не открытием файла index.html.";
  }
  runChecks();
}

function select(id) {
  state.selectedId = id;
  renderAll();
  if (view) view.setSelected(id);
}

function addAndSelect(type, options = {}) {
  try {
    const element = addElement(state.project, type, options);
    state.selectedId = element.id;
    commit({ message: `Добавлен элемент ${element.id}` });
  } catch (err) {
    setStatus(err.message, true);
  }
}

// ---------------------------------------------------------------- события

$("add-buttons").addEventListener("click", (e) => {
  const type = e.target.closest("[data-add]")?.dataset.add;
  if (!type) return;
  const selected = findElement(state.project, state.selectedId);
  const hostId = selected?.type === "wall" ? selected.id : selected?.hostId;
  addAndSelect(type, hostId ? { hostId } : {});
});

document.querySelectorAll("[data-view]").forEach((btn) =>
  btn.addEventListener("click", () => view && view.setView(btn.dataset.view))
);

$("btn-roof-toggle").addEventListener("click", (e) => {
  if (!view) return;
  const hide = !view.hiddenTypes.has("roof");
  view.setTypeVisible("roof", !hide);
  e.target.textContent = hide ? "Показать крышу" : "Скрыть крышу";
});

$("project-name").addEventListener("change", (e) => {
  state.project.name = e.target.value.trim() || "Без названия";
  commit();
});

$("btn-new").addEventListener("click", () => {
  if (!confirm("Создать новый проект с базовым домом? Несохранённые изменения будут потеряны.")) return;
  state.project = createBasicHouseProject("Новый дом");
  state.selectedId = null;
  commit({ refit: true, message: "Создан новый проект" });
});

// ---------------------------------------------------------------- файлы проекта

$("btn-save").addEventListener("click", () => {
  const name = fileNameFor(state.project, ".project.json");
  downloadText(name, serializeProject(state.project));
  setStatus(`Проект сохранён в файл ${name}`);
});

$("btn-export").addEventListener("click", () => {
  const { data, warnings } = buildFreecadExport(state.project, { checkSummary: state.report?.summary });
  const name = fileNameFor(state.project, ".freecad.json");
  downloadText(name, JSON.stringify(data, null, 2));
  const tail = "Откройте FreeCAD → Макрос → Макросы… → import_house.FCMacro и выберите этот файл.";
  setStatus(warnings.length
    ? `Экспорт ${name} с замечаниями: ${warnings.join("; ")}. ${tail}`
    : `Скачан ${name}. ${tail}`, warnings.length > 0);
});

$("btn-open").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // чтобы можно было повторно выбрать тот же файл
  if (file) await openProjectFile(file);
});

// Перетаскивание JSON-файла в окно
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) await openProjectFile(file);
});

async function openProjectFile(file) {
  try {
    const { project, warnings } = parseProject(await readFileAsText(file));
    state.project = project;
    state.selectedId = null;
    commit({
      refit: true,
      message: warnings.length
        ? `Загружен «${project.name}» с замечаниями (${warnings.length}): ${warnings.join("; ")}`
        : `Загружен проект «${project.name}» из ${file.name}`,
    });
  } catch (err) {
    setStatus(`Не удалось загрузить ${file.name}: ${err.message}`, true);
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") select(null);
  if (e.key === "Delete" && state.selectedId && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) {
    const removed = removeElement(state.project, state.selectedId);
    state.selectedId = null;
    commit({ message: `Удалено: ${removed.join(", ")}` });
  }
});

// ---------------------------------------------------------------- служебное

function setStatus(text, isError = false) {
  const node = $("status-text");
  node.textContent = text;
  node.classList.toggle("error", isError);
}

function showViewError(text) {
  const node = $("view-error");
  node.textContent = text;
  node.hidden = false;
}

commit({
  refit: true,
  message: restored ? "Восстановлен последний проект из автосохранения браузера" : "Готово. Создан базовый дом.",
});
initRules();

// Для отладки из консоли браузера
window.app = { state, commit };
