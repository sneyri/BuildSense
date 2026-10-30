// Контроллер приложения BuildSense: связывает модель, 3D-сцену, инструменты, проверки, симуляцию и панели.
// Любое изменение модели идёт через edit(label, fn): снимок для отмены → изменение → refresh().
(function (BS) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const P = BS.project;
  const IO = BS.projectIO;
  const fmt = BS.util.fmt;

  const restored = IO.loadAutosave();
  const state = {
    project: restored ? restored.project : P.createStarterProject("Мой дом"),
    selectedIds: new Set(),
    levelId: "L1",
    activeTool: "select",
    activeNode: null,
    validation: null,
    sim: { scenario: "remove_support", params: { threshold: 0.5, intensity: 1, direction: 0 }, result: null, step: -1, ghost: false },
    flags: { simulated: false, exported: false },
    wizardOpen: !restored,
    wizardStep: 0,
    calcOpen: false,
    dims: false,
    isolate: false,
    inside: false,
    hiddenGroups: new Set(),
    issueMap: new Map(),
  };
  state.levelId = state.project.levels[0].id;
  const history = BS.history.createHistory(100);

  // ---------------------------------------------------------------- сцена и инструменты

  let view = null, tools = null, dims = null, player = null;
  try {
    view = new BS.SceneView($("viewport"), { onPick: (id, e) => select(id ? [id] : [], e && (e.ctrlKey || e.shiftKey)) });
    dims = new BS.Dimensions(view);
    player = new BS.SimPlayer(view);
    tools = new BS.Tools(view, {
      getProject: () => state.project,
      getSelected: () => (state.selectedIds.size === 1 ? [...state.selectedIds][0] : null),
      getLevelId: () => state.levelId,
      getSnap: () => ({ enabled: state.project.settings.snap !== false, grid: state.project.settings.grid || 0.1 }),
      getWallCategory: () => (state.wallCategory || undefined),
      onHint: (t) => { $("tool-hint").textContent = t; },
      onCreate: (kind, type, a) => edit(`Создать: ${BS.types.label(type)}`, () => {
        let el;
        if (kind === "line" && type === "wall") el = P.addWallByPoints(state.project, a.p1, a.p2, { category: a.category, levelId: state.levelId });
        else if (kind === "line") el = P.addSegment(state.project, type, a.p1, a.p2, { levelId: state.levelId });
        else if (kind === "rect") el = P.addRect(state.project, type, a.a, a.b, { levelId: state.levelId });
        else if (kind === "point") el = P.placeAt(state.project, type, a.point, { levelId: state.levelId, rotation: a.rotation });
        else if (kind === "opening") el = P.placeOpening(state.project, type, a.wallId, a.offset);
        const node = state.activeNode && BS.modules.get(state.activeNode);
        if (node && node.base === type) BS.modules.apply(state.project, el.id, node.id);
        state.selectedIds = new Set([el.id]);
        return `Создано: ${el.name}`;
      }),
      onMove: (id, dx, dy) => edit("Перемещение", () => {
        P.moveElement(state.project, id, dx, dy);
        const e = P.find(state.project, id);
        return `Перемещено: ${e.name} (низ на отметке ${fmt(e.position.z)} м)`;
      }),
      onMoveOpening: (id, offset, elevation) => edit("Перемещение проёма", () => {
        P.updateElement(state.project, id, { position: { offset, elevation } });
        return `${P.find(state.project, id).name}: отступ ${fmt(offset)} м`;
      }),
    });
  } catch (err) {
    showError(`Не удалось запустить 3D-сцену (WebGL): ${err.message}. Попробуйте другой браузер; редактирование через панели остаётся доступным.`);
  }

  // ---------------------------------------------------------------- 2D-план

  let plan = null;
  if (BS.PlanEditor && $("plan-view")) {
    try {
      plan = new BS.PlanEditor($("plan-view"), $("plan-tools"), {
        getProject: () => state.project,
        getLevelId: () => state.levelId,
        getSelected: () => [...state.selectedIds],
        edit: (label, fn) => edit(label, fn),
        select: (ids, additive) => select(ids, additive),
        setStatus: (text, kind) => setStatus(text, kind),
      });
    } catch (err) {
      console.warn("2D-план не запущен:", err);
    }
  }
  const syncCleanView = () => { if (view && view.setCleanView) view.setCleanView(document.body.classList.contains("clean-view")); };
  BS.events.on("layout", () => {
    if (plan) plan.resize();
    if (view) view.resize();
    syncCleanView();
  });
  BS.events.on("archview", () => { if (plan) plan.resize(); });

  // ---------------------------------------------------------------- изменение модели

  /** Выполнить изменение с записью в историю. fn возвращает текст для строки состояния. */
  function edit(label, fn) {
    const before = JSON.stringify(state.project);
    try {
      const msg = fn();
      history.push(JSON.parse(before), label);
      refresh(typeof msg === "string" ? msg : label);
      return true;
    } catch (err) {
      state.project = JSON.parse(before); // откат: ошибка не ломает проект
      setStatus(err.message, "error");
      return false;
    }
  }

  function refresh(message, { refit = false } = {}) {
    P.touch(state.project);
    const ids = new Set(state.project.elements.map((e) => e.id));
    state.selectedIds = new Set([...state.selectedIds].filter((id) => ids.has(id)));
    if (!state.project.levels.some((l) => l.id === state.levelId)) state.levelId = state.project.levels[0].id;
    if (player && player.active) { player.reset(); state.sim.result = null; state.sim.step = -1; $("sim-banner").hidden = true; }
    state.validation = BS.validation.validate(state.project);
    state.issueMap = BS.validation.severityByElement(state.validation.issues);
    if (view) {
      const { objects, failed } = BS.meshBuilder.buildAll(state.project);
      view.setObjects(objects);
      view.setSite(state.project.settings.site);
      view.setIssues(state.issueMap);
      view.setSelected(state.selectedIds);
      if (state.isolate) view.setIsolate([...state.selectedIds]);
      applyInside();
      if (refit) view.setView("iso");
      if (refit && plan && plan.fit) plan.fit();
      if (failed.length) message = `${message ? message + ". " : ""}Не построены (некорректные данные): ${failed.join(", ")}`;
    }
    IO.autosave(state.project);
    renderPanels();
    const s = state.validation.summary;
    if (message) setStatus(message, s.error ? "error" : null);
  }

  /** Режим «Внутри»: прячет крышу и всё выше потолка активного этажа (перекрытие, верхние этажи) — модель не меняется. */
  function applyInside() {
    if (!view) return;
    if (!state.inside) { view.setHiddenIds(null); return; }
    const lv = P.level(state.project, state.levelId);
    const cut = lv.elevation + lv.height - 0.01;
    const ids = state.project.elements
      .filter((e) => e.type === "roof" || BS.shapes.bottom(e, state.project) >= cut)
      .map((e) => e.id);
    view.setHiddenIds(ids);
  }

  function renderPanels() {
    $("project-name").value = state.project.name;
    BS.ui.palette.render($("palette"), $("levels"), state, {
      onTool: setTool, onNode: setNode, onAction: action, onLevel: (id) => { state.levelId = id; applyInside(); renderPanels(); setStatus(`Активный этаж: ${P.level(state.project, id).name}`); },
      onAddLevel: () => action("add-level"),
    });
    BS.ui.tree.render($("visibility"), $("tree"), { ...state, issues: state.issueMap }, {
      onSelect: (id, add) => select([id], add), onFocus: (id) => focus([id]),
      onToggleGroup: (g, v) => { v ? state.hiddenGroups.delete(g) : state.hiddenGroups.add(g); if (view) view.setGroupVisible(g, v); },
    });
    BS.ui.properties.render($("props"), { ...state, grid: state.project.settings.grid || 0.1 }, propHandlers);
    BS.ui.problems.render($("problems"), state.validation, { onFocus: focusIssue, onFix: (a) => edit("Исправление", () => BS.validation.applyFix(state.project, a)) });
    renderSim();
    BS.ui.rulesPanel.render($("rules"), state.project, state.validation, rulesHandlers);
    BS.ui.settingsPanel.render($("settings"), state.project, settingsHandlers);
    renderWizard();
    if (plan) plan.render();
    const s = state.validation.summary;
    const cnt = $("problems-count");
    cnt.textContent = s.error ? String(s.error) : s.warning ? String(s.warning) : "✓";
    cnt.className = `count ${s.error ? "" : s.warning ? "warn" : "ok"}`;
    document.querySelector('[data-action="undo"]').disabled = !history.canUndo();
    document.querySelector('[data-action="redo"]').disabled = !history.canRedo();
    document.querySelector('[data-action="undo"]').title = history.canUndo() ? `Отменить: ${history.undoLabel()} (Ctrl+Z)` : "Нечего отменять";
    document.querySelector('[data-action="redo"]').title = history.canRedo() ? `Повторить: ${history.redoLabel()} (Ctrl+Y)` : "Нечего повторять";
    const lv = P.level(state.project, state.levelId);
    $("status-info").textContent = `${lv.name} · объектов ${state.project.elements.length} · ошибки ${s.error} · предупр. ${s.warning} · сетка ${fmt(state.project.settings.grid)} м`;
    if (dims) dims.show(state.project, state.dims ? [...state.selectedIds] : [], state.dims);
  }

  // ---------------------------------------------------------------- выбор и камера

  function select(ids, additive = false) {
    if (additive) for (const id of ids) state.selectedIds.has(id) ? state.selectedIds.delete(id) : state.selectedIds.add(id);
    else state.selectedIds = new Set(ids);
    if (view) {
      view.setSelected(state.selectedIds);
      if (state.isolate) view.setIsolate([...state.selectedIds]);
    }
    if (state.selectedIds.size) switchTab("right", "props");
    renderPanels();
    if (state.selectedIds.size === 1 && BS.hints) {
      const el = state.project.elements.find((e) => e.id === [...state.selectedIds][0]);
      if (el && el.type === "wall" && !(el.params && el.params.contourId)) BS.hints.once("arch.handles", "Потяните квадратные ручки на концах стены на плане — длина и направление изменятся, проёмы останутся на месте.");
    }
  }

  function focus(ids) {
    if (!view || !ids.length) return;
    select(ids);
    if (!view.focus(ids)) setStatus("Элемент не отображается (скрыт или некорректен)", "error");
  }

  function focusIssue(issue) {
    const ids = (issue.elementIds || []).filter((id) => P.find(state.project, id));
    if (!ids.length) { setStatus(issue.title); return; }
    state.selectedIds = new Set(ids);
    if (view) {
      view.setSelected(state.selectedIds);
      view.focus(ids);
    }
    renderPanels();
    setStatus(`${issue.title}${issue.description ? " — " + issue.description : ""}`, issue.severity === "error" ? "error" : null);
  }

  function setNode(nodeId) {
    const node = BS.modules.get(nodeId);
    setTool(node.base);
    state.activeNode = nodeId;
    renderPanels();
    setStatus(`${node.label} (${node.standard}): постройте как «${BS.types.label(node.base)}». ${BS.modules.NOT_VERIFIED}`);
  }

  function setTool(type) {
    state.activeNode = null;
    state.activeTool = type;
    document.body.dataset.activeTool = type;
    if (tools) tools.setTool(type);
    document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === type));
    renderPanels();
    if (type === "wall" && BS.hints) BS.hints.once("arch.wall", "Стены: щёлкайте по точкам плана — длина видна во время рисования, можно набрать её цифрами. Esc — отмена, ? — горячие клавиши.");
  }

  // ---------------------------------------------------------------- обработчики панелей

  const propHandlers = {
    onChange: (id, patch) => edit("Изменение свойств", () => {
      const notes = P.updateElement(state.project, id, patch);
      // Элемент, построенный по контуру плана: соседние стены, пол, фундамент и крыша перестраиваются
      const changed = P.find(state.project, id);
      if (BS.contour && BS.contour.needsRebuild(changed, patch)) notes.push(...BS.contour.applyElementPatch(state.project, changed, patch));
      return notes.length ? `Скорректировано: ${notes.join("; ")}` : `Изменено: ${P.find(state.project, id).name}`;
    }),
    onMove: (id, dx, dy, dz) => edit("Сдвиг", () => { P.moveElement(state.project, id, dx, dy, dz, { reseat: false }); return "Сдвинуто"; }),
    onRotate: (id, d) => edit("Поворот", () => { P.rotateElement(state.project, id, d); return `Повёрнуто на ${d}°`; }),
    onDuplicate: (ids) => edit("Дублирование", () => {
      const created = P.duplicate(state.project, ids, { x: 1, y: 1, z: 0 });
      state.selectedIds = new Set(created.filter((c) => !c.hostId).map((c) => c.id));
      return `Создано копий: ${created.length}`;
    }),
    onCopyToLevel: (ids, levelId) => edit("Копирование на этаж", () => {
      const target = P.level(state.project, levelId);
      const src = P.find(state.project, ids[0]);
      const from = P.level(state.project, src.levelId);
      const created = P.duplicate(state.project, ids, { x: 0, y: 0, z: target.elevation - from.elevation }, levelId);
      // Копии садятся на основание целевого этажа (перекрытие может лежать не на той же высоте, что пол)
      for (const c of created) if (!c.hostId && BS.types.get(c.type).support === "gravity") P.moveElement(state.project, c.id, 0, 0);
      state.selectedIds = new Set(created.filter((c) => !c.hostId).map((c) => c.id));
      return `Скопировано на «${target.name}»: ${created.length}`;
    }),
    onDelete: (ids) => edit("Удаление", () => { const r = P.removeElements(state.project, ids); state.selectedIds.clear(); return `Удалено: ${r.length}`; }),
    onIsolate: (ids) => { state.isolate = true; state.selectedIds = new Set(ids); setToggle("isolate", true); if (view) view.setIsolate(ids); renderPanels(); },
    onFocus: (ids) => focus(ids),
    onAddOpening: (type, wallId) => edit(`Добавить ${type === "door" ? "дверь" : "окно"}`, () => {
      const o = P.placeOpening(state.project, type, wallId);
      state.selectedIds = new Set([o.id]);
      return `Добавлено: ${o.name}`;
    }),
    onLintels: (wallId) => edit("Перемычки", () => `Перемычек: ${P.addLintels(state.project, wallId).length}`),
    onSettings: (patch) => settingsHandlers.onSettings(patch),
    onSelect: (id) => select([id]),
  };

  const settingsHandlers = {
    onSettings: (patch) => edit("Настройки проекта", () => {
      if (patch.__level) {
        const [id, p] = patch.__level;
        Object.assign(P.level(state.project, id), p);
        return "Параметры этажа изменены";
      }
      BS.util.merge(state.project.settings, patch);
      return "Настройки проекта изменены";
    }),
    onDeleteLevel: (id) => edit("Удаление этажа", () => {
      if (state.project.elements.some((e) => e.levelId === id)) throw new Error("На этаже есть элементы — сначала удалите или перенесите их");
      state.project.levels = state.project.levels.filter((l) => l.id !== id);
      return "Этаж удалён";
    }),
  };

  const rulesHandlers = {
    onAddRule: (form) => edit("Новое правило", () => {
      const rule = BS.ruleRegistry.makeUserRule(state.project, form);
      state.project.customRules = [...(state.project.customRules || []), rule];
      return `Добавлено учебное правило ${rule.id}`;
    }),
    onDeleteRule: (id) => edit("Удаление правила", () => {
      state.project.customRules = (state.project.customRules || []).filter((r) => r.id !== id);
      return `Правило ${id} удалено`;
    }),
    onImport: () => $("rules-input").click(),
    onExport: () => IO.download(IO.fileNameFor(state.project, ".rules.json"), JSON.stringify({ rules: state.project.customRules }, null, 2)),
  };

  // ---------------------------------------------------------------- действия

  function action(name) {
    if (name.startsWith("tool:")) return setTool(name.slice(5));
    if (name.startsWith("tab:")) return switchTab("right", name.slice(4));
    const p = state.project;
    switch (name) {
      case "undo": return undoRedo(true);
      case "redo": return undoRedo(false);
      case "save": {
        const fn = IO.fileNameFor(p, ".buildsense.json");
        IO.download(fn, IO.serialize(p));
        return setStatus(`Проект сохранён: ${fn}`, "ok");
      }
      case "open": return $("file-input").click();
      case "export": {
        const { data, warnings } = BS.freecadExport.build(p, { summary: state.validation.summary });
        const fn = IO.fileNameFor(p, ".freecad.json");
        IO.download(fn, JSON.stringify(data, null, 2));
        state.flags.exported = true;
        renderPanels();
        return setStatus(`Скачан ${fn}${warnings.length ? ` (пропущено: ${warnings.join("; ")})` : ""}. В FreeCAD: Макрос → Макросы… → freecad/import_house.FCMacro.`, warnings.length ? "error" : "ok");
      }
      case "macro": {
        const m = BS.freecadMacro;
        if (!m) return setStatus("Текст макроса не найден (js/io/macroSource.js)", "error");
        IO.download(m.fileName, m.source, "text/x-python");
        return setStatus(`Скачан ${m.fileName}. Во FreeCAD: Макрос → Макросы… → укажите папку с файлом → import_house → Выполнить.`, "ok");
      }
      case "wizard":
        state.wizardOpen = !state.wizardOpen;
        return renderWizard();
      case "drawing": {
        try {
          const lv = P.level(state.project, state.levelId);
          const canvas = BS.houseDrawing.render(state.project, { levelId: state.levelId });
          BS.mechDrawing.openPreview(canvas, { title: `Чертёж: ${state.project.name || "Дом"} · ${lv.name}`, fileName: `${(state.project.name || "dom").replace(/[\/:*?"<>|]+/g, "_").replace(/\s+/g, "_")}_${lv.name.replace(/\s+/g, "_")}_чертёж.png`, onStatus: setStatus });
        } catch (e) { setStatus(e.message, "error"); }
        return;
      }
      case "rotate-tool":
        if (!tools || !tools.rotateStep()) setStatus("Поворот работает при расстановке: выберите на палитре объект (например, дверь или колонну) и нажмите «Повернуть».");
        return;
      case "delete-selected":
        if (!state.selectedIds.size) return setStatus("Сначала выберите объект: коснитесь его на плане или в 3D-модели.");
        return propHandlers.onDelete([...state.selectedIds]);
      case "duplicate-selected":
        if (!state.selectedIds.size) return setStatus("Сначала выберите объект: коснитесь его на плане или в 3D-модели.");
        return propHandlers.onDuplicate([...state.selectedIds]);
      case "cancel-tool":
        if (tools && tools.cancel()) return;
        if (state.activeTool !== "select") return setTool("select");
        return select([]);
      case "theme": return BS.themes.next();
      case "new-menu": return toggleMenu();
      case "wiz-foundation": return edit("Фундамент", () => {
        const h = p.house;
        const C = BS.contour;
        // Контур этажа с плана; если его нет — прямоугольник по размерам дома из мастера
        const c = C.forLevel(p, state.levelId)[0] || C.addContour(p, C.rectangle(0, 0, h.length, h.width), { levelId: state.levelId });
        C.foundationFromContour(p, c.id, { type: "slab", thickness: h.foundationThickness });
        return `Фундамент по контуру ${c.id}`;
      }) && view && view.setView("iso");
      case "wiz-walls": return edit("Стены по контуру", () => {
        p.levels[0].height = p.house.wallHeight;
        return `Стен построено: ${P.wallsAroundFoundation(p, { thickness: p.house.wallThickness, levelId: state.levelId }).length}`;
      });
      case "wiz-floor": return edit("Пол", () => `Создан: ${P.slabInsideWalls(p, state.levelId).name}`);
      case "wiz-openings": return edit("Окна и двери", () => {
        const created = P.autoOpenings(p, state.levelId);
        const walls = new Set(created.map((o) => o.hostId));
        let lintels = 0;
        for (const w of walls) if (BS.types.isBearing(P.find(p, w))) lintels += P.addLintels(p, w).length;
        return `Проёмов: ${created.length}, перемычек: ${lintels}`;
      });
      case "roof-over": return edit("Крыша", () => {
        const C = BS.contour;
        const top = P.topLevel(p);
        const c = C.forLevel(p, top.id).find((x) => C.linked(p, x.id, C.GEN.wall).length);
        const opts = { roofType: p.house.roofType, slope: p.house.roofSlope, overhang: p.house.roofOverhang };
        const r = c ? C.roofFromContour(p, c.id, opts).created[0] : P.addRoofOverBuilding(p, opts);
        state.selectedIds = new Set([r.id]);
        return "Крыша построена над домом";
      });
      case "add-level": return edit("Новый этаж", () => {
        const { level, created } = P.addLevel(p, { copyWalls: true });
        state.levelId = level.id;
        return `${level.name}: отметка ${fmt(level.elevation)} м, создано ${created.length} элементов`;
      });
      case "lintels": return edit("Перемычки", () => {
        const sel = [...state.selectedIds].map((id) => P.find(p, id)).filter((e) => e && e.type === "wall");
        const walls = sel.length ? sel : p.elements.filter((e) => e.type === "wall" && BS.types.isBearing(e));
        let n = 0;
        for (const w of walls) {
          const existing = p.elements.filter((l) => l.type === "lintel" && l.params.hostWallId === w.id);
          if (!existing.length) n += P.addLintels(p, w.id).length;
        }
        return `Добавлено перемычек: ${n}`;
      });
      case "clean-view":
        // Кнопку обрабатывает shell (скрывает панели); сцена убирает сетку, рёбра и подсветки
        syncCleanView();
        if (plan) plan.render();
        return null;
      default:
        return null;
    }
  }

  function undoRedo(isUndo) {
    const res = isUndo ? history.undo(state.project) : history.redo(state.project);
    if (!res) return;
    state.project = res.project;
    refresh(`${isUndo ? "Отменено" : "Повторено"}: ${res.label}`);
  }

  function newProject(kind) {
    hideMenu();
    let p;
    if (kind === "starter") p = P.createStarterProject("Мой дом");
    else if (kind === "empty") p = P.createProject("Новый проект");
    else {
      const key = kind.startsWith("proto-") ? kind.slice(6) : kind === "example-two" ? "twoStorey" : kind === "example-l" ? "lHouse" : kind === "example-section" ? "section" : "issues";
      if (!BS.examples || !BS.examples[key]) return setStatus("Пример не найден (examples/examples.js)", "error");
      p = IO.fromData(JSON.parse(JSON.stringify(BS.examples[key]))).project;
    }
    history.push(state.project, "Новый проект");
    state.project = p;
    state.selectedIds.clear();
    state.levelId = p.levels[0].id;
    state.flags = { simulated: false, exported: false };
    if (kind === "empty") { state.wizardOpen = true; state.wizardStep = 0; }
    refresh(`Открыт проект «${p.name}»`, { refit: true });
  }

  async function openFile(file) {
    try {
      const { project, warnings } = IO.parse(await IO.readFile(file));
      history.push(state.project, "Открытие файла");
      state.project = project;
      state.selectedIds.clear();
      state.levelId = project.levels[0].id;
      refresh(warnings.length ? `Открыт «${project.name}» с замечаниями: ${warnings.join("; ")}` : `Открыт проект «${project.name}»`, { refit: true });
    } catch (err) {
      setStatus(`Не удалось открыть ${file.name}: ${err.message}`, "error");
    }
  }

  // ---------------------------------------------------------------- симуляция

  function renderSim() {
    BS.ui.simulationPanel.render($("sim"), state, {
      onScenario: (id) => { state.sim.scenario = id; resetSim(); renderSim(); },
      onParam: (k, v) => {
        if (k === "slabCapacity") return settingsHandlers.onSettings({ loads: { slabCapacity: v } });
        state.sim.params[k] = v;
        renderSim();
      },
      onRun: runSim, onStep: (i) => { if (player) { player.showStep(i); state.sim.step = player.index; renderSim(); } },
      onPlay: playSim, onReset: () => { resetSim(); setStatus("Модель восстановлена в исходное состояние", "ok"); renderSim(); },
      onGhost: (on) => { state.sim.ghost = on; if (player) player.setGhost(on); },
      onSelect: (id) => { state.selectedIds = new Set([id]); if (view) view.setSelected(state.selectedIds); },
    });
  }

  let playTimer = null;
  function runSim() {
    resetSim();
    const sel = [...state.selectedIds][0];
    const r = BS.simulation.run(state.project, state.sim.scenario, { ...state.sim.params, targetId: sel });
    state.sim.result = r;
    if (!r.ok) { setStatus(r.error, "error"); return renderSim(); }
    state.flags.simulated = true;
    if (player) {
      player.load(r);
      $("sim-banner").textContent = r.disclaimer;
      $("sim-banner").hidden = false;
    }
    playSim();
  }

  function playSim() {
    if (!player || !state.sim.result || !state.sim.result.ok) return;
    clearInterval(playTimer);
    let i = 0;
    player.showStep(0, 300);
    state.sim.step = 0;
    renderSim();
    playTimer = setInterval(() => {
      i++;
      if (i >= state.sim.result.steps.length) { clearInterval(playTimer); renderWizard(); return; }
      player.showStep(i);
      state.sim.step = i;
      renderSim();
    }, 1300);
  }

  function resetSim() {
    clearInterval(playTimer);
    if (player) player.reset();
    state.sim.result = null;
    state.sim.step = -1;
    state.sim.ghost = false;
    $("sim-banner").hidden = true;
  }

  // ---------------------------------------------------------------- мастер, вкладки, меню

  function renderWizard() {
    const node = $("wizard");
    node.hidden = !state.wizardOpen;
    document.querySelector('[data-action="wizard"]').classList.toggle("on", state.wizardOpen);
    if (!state.wizardOpen) return;
    BS.ui.wizard.render(node, state, {
      onAction: action,
      onHouse: (patch) => {
        Object.assign(state.project.house, patch);
        if (patch.wallHeight) state.project.levels[0].height = patch.wallHeight;
        IO.autosave(state.project);
        renderWizard();
      },
      onStep: (i) => { state.wizardStep = i; renderWizard(); },
      onClose: () => { state.wizardOpen = false; renderWizard(); },
    });
  }

  function switchTab(side, tab) {
    const nav = document.querySelector(`[data-tabs="${side}"]`);
    nav.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    nav.parentElement.querySelectorAll("[data-pane]").forEach((p) => p.classList.toggle("active", p.dataset.pane === tab));
  }

  function toggleMenu() {
    const m = $("new-menu");
    if (!m.hidden) return hideMenu();
    const b = document.querySelector('[data-action="new-menu"]').getBoundingClientRect();
    m.style.left = `${b.left}px`;
    m.style.top = `${b.bottom + 4}px`;
    m.hidden = false;
  }
  function hideMenu() { $("new-menu").hidden = true; }

  function setToggle(name, on) {
    const b = document.querySelector(`[data-toggle="${name}"]`);
    if (b) b.classList.toggle("on", on);
  }

  function setStatus(text, kind = null) {
    const n = $("status-text");
    n.textContent = text;
    n.className = kind || "";
  }

  function showError(text) {
    const n = $("view-error");
    n.textContent = text;
    n.hidden = false;
  }

  // ---------------------------------------------------------------- события

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action]");
    if (a) { action(a.dataset.action); return; }
    const t = e.target.closest("[data-tabs] [data-tab]");
    if (t) { switchTab(t.closest("[data-tabs]").dataset.tabs, t.dataset.tab); return; }
    const n = e.target.closest("[data-new]");
    if (n) { newProject(n.dataset.new); return; }
    const tool = e.target.closest("[data-tool]");
    if (tool) { setTool(tool.dataset.tool); return; }
    const v = e.target.closest("[data-view]");
    if (v && view) { view.setView(v.dataset.view); if (v.dataset.view === "top") setToggle("ortho", true); return; }
    const tg = e.target.closest("[data-toggle]");
    if (tg) { toggle(tg.dataset.toggle); return; }
    if (!e.target.closest("#new-menu")) hideMenu();
  });

  function toggle(name) {
    if (name === "ortho" && view) { const on = !view.camera.isOrthographicCamera; view.setOrtho(on); setToggle("ortho", on); }
    if (name === "dims") { state.dims = !state.dims; setToggle("dims", state.dims); renderPanels(); }
    if (name === "isolate") {
      state.isolate = !state.isolate && state.selectedIds.size > 0;
      setToggle("isolate", state.isolate);
      if (view) view.setIsolate(state.isolate ? [...state.selectedIds] : null);
      if (!state.isolate && state.selectedIds.size === 0) setStatus("Сначала выберите объект для изоляции");
    }
    if (name === "inside") {
      state.inside = !state.inside;
      setToggle("inside", state.inside);
      applyInside();
      setStatus(state.inside ? "Режим «Внутри»: крыша и потолок активного этажа скрыты — можно ставить лестницы и перегородки. Повторное нажатие — вернуть." : "Потолок и крыша снова видны");
    }
    if (name === "snap") {
      const on = state.project.settings.snap === false;
      state.project.settings.snap = on;
      setToggle("snap", on);
      IO.autosave(state.project);
    }
  }

  $("grid-step").addEventListener("change", (e) => { state.project.settings.grid = Number(e.target.value); IO.autosave(state.project); renderPanels(); });
  $("project-name").addEventListener("change", (e) => edit("Название проекта", () => { state.project.name = e.target.value.trim() || "Без названия"; return "Название изменено"; }));
  $("file-input").addEventListener("change", async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) await openFile(f); });
  $("rules-input").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const text = await IO.readFile(f);
      edit("Импорт правил", () => {
        const { added, errors } = BS.ruleRegistry.importRules(state.project, text);
        return `Импортировано правил: ${added.length}${errors.length ? `; отклонено: ${errors.join("; ")}` : ""}`;
      });
    } catch (err) { setStatus(err.message, "error"); }
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) await openFile(f); });

  // Горячие клавиши архитектуры — через единый менеджер (js/ui/hotkeys.js); общие (отмена, сохранить, Delete …) — тоже здесь,
  // а в режиме машиностроения те же сочетания перекрываются его собственными действиями.
  function registerArchHotkeys() {
    const H = BS.hotkeys;
    const sel = () => state.selectedIds.size > 0;
    const R = (def) => H.register({ group: "arch", ...def });
    R({ id: "arch.undo", label: "Отменить", keys: ["Ctrl+KeyZ"], run: () => undoRedo(true) });
    R({ id: "arch.redo", label: "Повторить", keys: ["Ctrl+KeyY", "Ctrl+Shift+KeyZ"], run: () => undoRedo(false) });
    R({ id: "arch.save", label: "Сохранить проект (JSON)", keys: ["Ctrl+KeyS"], run: () => action("save") });
    R({ id: "arch.duplicate", label: "Дублировать выбранное", keys: ["Ctrl+KeyD"], enabled: sel, run: () => propHandlers.onDuplicate([...state.selectedIds]) });
    R({ id: "arch.delete", label: "Удалить выбранное", keys: ["Delete"], enabled: sel, run: () => propHandlers.onDelete([...state.selectedIds]) });
    R({ id: "arch.escape", label: "Отмена операции / сброс инструмента и выделения", keys: ["Escape"], run: () => {
      if (document.body.classList.contains("clean-view")) return false; // Esc в «чистом просмотре» обрабатывает shell.js
      if (tools && tools.cancel()) return true;
      if (state.activeTool !== "select") return setTool("select");
      if (state.isolate) return toggle("isolate");
      select([]);
    } });
    R({ id: "arch.select", label: "Выбор и перемещение (потяните выбранный объект)", keys: ["KeyV"], run: () => setTool("select") });
    R({ id: "arch.move", label: "Перемещение: выбрать объект и потянуть мышью", keys: ["KeyG"], run: () => { setTool("select"); setStatus("Перемещение: щёлкните объект и потяните его — он прилипает к сетке и к соседям. Esc — отмена."); } });
    R({ id: "arch.wall", label: "Инструмент «Стена»", keys: ["KeyW"], run: () => setTool("wall") });
    R({ id: "arch.rotate", label: "Повернуть размещаемый объект на 90° (при расстановке)", keys: ["KeyR"], run: () => { if (!tools || !tools.rotateStep()) setStatus("Поворот работает при расстановке объекта: выберите, например, дверь или колонну на палитре, затем нажмите R."); } });
    R({ id: "arch.isolate", label: "Изолировать выбранный объект", keys: ["KeyI"], run: () => toggle("isolate") });
    R({ id: "arch.snap", label: "Привязки: включить / выключить", keys: ["KeyX"], run: () => { toggle("snap"); setStatus(state.project.settings.snap === false ? "Привязки выключены" : "Привязки включены"); } });
    R({ id: "arch.fit", label: "Показать всё в кадре", keys: ["KeyF"], enabled: () => Boolean(view), run: () => view.setView("fit") });
    R({ id: "arch.view.top", label: "Вид сверху", keys: ["Numpad7", "Digit7"], enabled: () => Boolean(view), run: () => { view.setView("top"); setToggle("ortho", true); } });
    R({ id: "arch.view.front", label: "Вид спереди", keys: ["Numpad1", "Digit1"], enabled: () => Boolean(view), run: () => view.setView("front") });
    R({ id: "arch.view.iso", label: "Изометрический вид", keys: ["Numpad0", "Digit0"], enabled: () => Boolean(view), run: () => view.setView("iso") });
  }

  // ---------------------------------------------------------------- старт

  registerArchHotkeys();
  BS.themes.onChange(() => { if (view) view.applyCssTheme(); if (plan) plan.draw(); });
  BS.themes.init();
  BS.icons.apply();
  $("grid-step").value = String(state.project.settings.grid || 0.1);
  setToggle("snap", state.project.settings.snap !== false);
  if (tools) tools.setTool("select");
  refresh(restored ? "Восстановлен последний проект (автосохранение браузера)" : "Готово: открыт стартовый дом. Свой дом: на плане нарисуйте контур → «Фундамент» → «Стены» → «Перекрытие» → «Крыша».", { refit: true });

  // Ссылки вида index.html#example=twoStorey&wizard=0&roof=hidden&view=top&select=wall-1 — для демонстрации и скриншотов
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("example")) newProject({ starter: "starter", twoStorey: "example-two", issues: "example-issues", lHouse: "example-l", section: "example-section" }[hash.get("example")] || (["estate", "mansion", "tower", "villa", "timber", "mall"].includes(hash.get("example")) ? `proto-${hash.get("example")}` : "starter"));
  if (hash.get("wizard") === "0") { state.wizardOpen = false; renderWizard(); }
  if (hash.get("roof") === "hidden" && view) { state.hiddenGroups.add("roof"); view.setGroupVisible("roof", false); renderPanels(); }
  if (hash.get("view") && view) view.setView(hash.get("view"));
  if (hash.get("tab")) switchTab("right", hash.get("tab"));
  if (hash.get("select") && P.find(state.project, hash.get("select"))) select([hash.get("select")]);

  syncCleanView();

  // Для отладки и ручных тестов из консоли браузера
  BS.app = { state, edit, refresh, action, select, newProject, history, get view() { return view; }, get tools() { return tools; }, get plan() { return plan; }, get player() { return player; } };
})(globalThis.BuildSense);
