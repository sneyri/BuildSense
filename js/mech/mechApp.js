// BuildSense · Машиностроение — интерфейс режима: своя Three.js-сцена (мм, ось Z вверх),
// команды, дерево деталей и фич, панель параметров с живой проверкой.
// BS.mechApp.mount({ viewport, tree, props, commands }), BS.mechApp.resize(), BS.mechApp.isMounted().
// Параметры детали меняются только корректными значениями: при ошибке проверки поле подсвечивается,
// сообщение показывается под полем, а модель остаётся с последней корректной геометрией.
(function (BS) {
  "use strict";
  const M = BS.mechModel;
  const G = BS.mechGeometry;
  const IO = BS.mechIO;
  const T = globalThis.THREE;

  const S = {
    mounted: false,
    dom: null,
    project: null,
    selectedId: null,
    history: null,
    gl: null,
    meshes: new Map(), // id → { key, mesh, edges }
    fieldNodes: new Map(), // поле → { input, errNode }
    focusSnapshot: null,
  };

  const el = (...a) => BS.dom.el(...a);
  const status = (text, kind = null) => BS.events.emit("status", { text, kind });
  const fmt = (v, d = 2) => (BS.util && BS.util.fmt ? BS.util.fmt(v, d) : String(Math.round(v * 100) / 100));
  const selected = () => S.project && S.project.parts.find((p) => p.id === S.selectedId) || null;
  const hasIcon = (n) => BS.icons && (typeof BS.icons.has === "function" ? BS.icons.has(n) : true);

  function button(icon, text, onclick, title, extra = {}) {
    const b = el("button", { type: "button", title: title || text, onclick, ...extra });
    if (icon && BS.icons && hasIcon(icon)) b.insertAdjacentHTML("afterbegin", BS.icons.svg(icon));
    if (text) b.append(el("span", {}, text));
    return b;
  }

  // ================================================================== сцена

  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(S.dom.viewport).getPropertyValue(name).trim();
      return v || fallback;
    } catch {
      return fallback;
    }
  }

  function initScene(container) {
    const renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = "mech-canvas";
    container.prepend(renderer.domElement);

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(40, 1, 1, 50000);
    camera.up.set(0, 0, 1);
    camera.position.set(260, -420, 300);
    const controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.target.set(0, 0, 20);

    // сетка-пол: мелкая 10 мм, крупная 100 мм (GridHelper лежит в XZ — поворачиваем в XY)
    const fine = new T.GridHelper(1000, 100, 0x5b6672, 0x5b6672);
    const coarse = new T.GridHelper(1000, 10, 0x7d8a97, 0x7d8a97);
    for (const g of [fine, coarse]) {
      g.rotation.x = Math.PI / 2;
      g.material.transparent = true;
      g.material.depthWrite = false;
    }
    fine.material.opacity = 0.18;
    coarse.material.opacity = 0.4;
    scene.add(fine, coarse);
    const axes = new T.AxesHelper(60);
    axes.position.z = 0.05;
    scene.add(axes);

    const hemi = new T.HemisphereLight(0xffffff, 0x404850, 0.75);
    hemi.position.set(0, 0, 1);
    const key = new T.DirectionalLight(0xffffff, 0.85);
    key.position.set(300, -400, 600);
    const fill = new T.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-500, 300, 200);
    scene.add(hemi, key, fill);

    const parts = new T.Group();
    scene.add(parts);
    const selBox = new T.Box3Helper(new T.Box3(), 0x3d7dff);
    selBox.visible = false;
    scene.add(selBox);

    S.gl = { renderer, scene, camera, controls, parts, selBox, grid: [fine, coarse], frame: 0, bg: null };

    // выбор щелчком (без перетаскивания)
    let down = null;
    renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ray = new T.Raycaster();
      ray.setFromCamera(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects([...S.meshes.values()].map((m) => m.mesh), false)[0];
      select(hit ? hit.object.userData.partId : null);
    });

    new ResizeObserver(() => resize()).observe(container);
    const loop = () => {
      requestAnimationFrame(loop);
      const c = renderer.domElement;
      if (!container.clientWidth || !container.clientHeight) return; // режим скрыт
      if (S.gl.frame++ % 60 === 0) applyTheme();
      controls.update();
      renderer.render(scene, camera);
      if (c.width === 0) resize();
    };
    loop();
    resize();
  }

  function applyTheme() {
    const bg = cssVar("--viewport", "#161b22");
    if (bg === S.gl.bg) return;
    S.gl.bg = bg;
    try { S.gl.renderer.setClearColor(new T.Color(bg)); } catch { S.gl.renderer.setClearColor(0x161b22); }
  }

  function resize() {
    if (!S.gl) return;
    const c = S.dom.viewport;
    const w = Math.max(1, c.clientWidth), h = Math.max(1, c.clientHeight);
    S.gl.renderer.setSize(w, h, false);
    S.gl.renderer.domElement.style.width = "100%";
    S.gl.renderer.domElement.style.height = "100%";
    S.gl.camera.aspect = w / h;
    S.gl.camera.updateProjectionMatrix();
  }

  function fitView() {
    const box = new T.Box3();
    for (const m of S.meshes.values()) box.expandByObject(m.mesh);
    if (box.isEmpty()) box.set(new T.Vector3(-50, -50, 0), new T.Vector3(50, 50, 50));
    const center = box.getCenter(new T.Vector3());
    const radius = Math.max(box.getSize(new T.Vector3()).length() / 2, 20);
    const cam = S.gl.camera;
    const dist = radius / Math.sin((cam.fov * Math.PI) / 360) * 1.1;
    const dir = new T.Vector3(0.45, -0.75, 0.5).normalize();
    cam.position.copy(center).addScaledVector(dir, dist);
    cam.near = Math.max(0.5, dist / 1000);
    cam.far = dist * 50;
    cam.updateProjectionMatrix();
    S.gl.controls.target.copy(center);
    S.gl.controls.update();
  }

  /** Перестроить сетки (только изменившиеся детали); геометрия берётся из корректных params. */
  function syncMeshes() {
    const alive = new Set();
    for (const part of S.project.parts) {
      alive.add(part.id);
      const key = JSON.stringify([part.type, part.params, part.material]);
      let rec = S.meshes.get(part.id);
      if (!rec || rec.key !== key) {
        if (M.validateParams(part.type, part.params).length) continue; // не портим последнюю корректную сетку
        let geometry;
        try {
          geometry = G.buildPartGeometry(part);
        } catch (e) {
          status(`${part.name}: не удалось построить геометрию — ${e.message}`, "error");
          continue;
        }
        if (rec) disposeRec(rec);
        const mat = M.MATERIALS[part.material] || M.MATERIALS.steel;
        const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ color: mat.color, metalness: 0.3, roughness: 0.5 }));
        mesh.userData.partId = part.id;
        mesh.matrixAutoUpdate = false;
        const edges = new T.LineSegments(new T.EdgesGeometry(geometry, 30), new T.LineBasicMaterial({ color: 0x1d232b, transparent: true, opacity: 0.55 }));
        edges.raycast = () => {};
        mesh.add(edges);
        S.gl.parts.add(mesh);
        rec = { key, mesh, edges };
        S.meshes.set(part.id, rec);
      }
      rec.mesh.matrix.copy(G.partMatrix(part));
      rec.mesh.matrixWorldNeedsUpdate = true;
      rec.mesh.material.emissive.setHex(part.id === S.selectedId ? 0x16305e : 0x000000);
    }
    for (const [id, rec] of S.meshes) if (!alive.has(id)) { disposeRec(rec); S.meshes.delete(id); }
    updateSelectionBox();
  }

  function disposeRec(rec) {
    S.gl.parts.remove(rec.mesh);
    rec.mesh.geometry.dispose();
    rec.mesh.material.dispose();
    rec.edges.geometry.dispose();
    rec.edges.material.dispose();
  }

  function updateSelectionBox() {
    const part = selected();
    const rec = part && S.meshes.get(part.id);
    S.gl.selBox.visible = Boolean(rec);
    if (rec) {
      rec.mesh.updateMatrixWorld(true);
      const b = M.worldBounds(part);
      S.gl.selBox.box.set(new T.Vector3(...b.min), new T.Vector3(...b.max));
    }
    if (S.dom.hud) {
      S.dom.hud.textContent = part
        ? `${part.name}: габарит ${b3(part).map((v) => fmt(v, 2)).join(" × ")} мм (X × Y × Z)`
        : `Деталей: ${S.project.parts.length}. Щелчок по детали — выбор; колесо — масштаб; правая кнопка — сдвиг.`;
    }
  }
  const b3 = (part) => M.worldBounds(part).size;

  // ================================================================== проект и история

  function setProject(project, { keepSelection = false, fit = false } = {}) {
    S.project = project;
    if (!keepSelection || !selected()) S.selectedId = project.parts[0] ? project.parts[0].id : null;
    syncMeshes();
    renderAll();
    if (fit) fitView();
  }

  /** Изменение с записью в историю и автосохранением. */
  function edit(label, fn) {
    S.history.push(S.project, label);
    fn(S.project);
    afterChange();
  }

  function afterChange() {
    IO.autosave(S.project);
    syncMeshes();
    renderTree();
    renderCommandsState();
  }

  function undo() {
    const r = S.history.undo(S.project);
    if (!r) return status("Нечего отменять", "warn");
    setProject(r.project, { keepSelection: true });
    IO.autosave(S.project);
    status(`Отменено: ${r.label}`);
  }

  function redo() {
    const r = S.history.redo(S.project);
    if (!r) return status("Нечего повторять", "warn");
    setProject(r.project, { keepSelection: true });
    IO.autosave(S.project);
    status(`Повторено: ${r.label}`);
  }

  function select(id) {
    if (S.selectedId === id) return;
    S.selectedId = id;
    syncMeshes();
    renderTree();
    renderProps();
    renderCommandsState();
  }

  /** Новая деталь справа от уже стоящих (по габаритам), чтобы не пересекались. */
  function addPart(type) {
    let x = 0;
    if (S.project.parts.length) {
      const maxX = Math.max(...S.project.parts.map((p) => M.worldBounds(p).max[0]));
      const part = M.createPart(S.project, type);
      const half = M.worldBounds(part).size[0] / 2;
      x = Math.ceil((maxX + 20 + half) / 10) * 10;
    }
    let created;
    edit(`Добавить: ${M.TYPES[type].label}`, (pr) => {
      created = M.createPart(pr, type, { placement: { x, y: 0, z: 0 } });
      pr.parts.push(created);
    });
    S.selectedId = created.id;
    syncMeshes();
    renderAll();
    status(`Добавлена деталь «${created.name}»`, "ok");
  }

  function removeSelected() {
    const part = selected();
    if (!part) return status("Выберите деталь для удаления", "warn");
    const idx = S.project.parts.indexOf(part);
    edit(`Удалить «${part.name}»`, (pr) => pr.parts.splice(idx, 1));
    const next = S.project.parts[Math.min(idx, S.project.parts.length - 1)];
    S.selectedId = next ? next.id : null;
    syncMeshes();
    renderAll();
    status(`Удалена деталь «${part.name}» (Ctrl+Z — вернуть)`);
  }

  function newProject() {
    if (S.project.parts.length && !window.confirm("Начать новый проект? Текущий можно вернуть кнопкой «Отменить».")) return;
    S.history.push(S.project, "Новый проект");
    setProject(M.createProject(), { fit: true });
    IO.autosave(S.project);
    status("Новый проект деталей", "ok");
  }

  /** Загрузка: детали с ошибками пропускаются, остальное открывается. */
  function loadProject(text, file) {
    let res;
    try {
      res = IO.parse(text);
    } catch (e) {
      return status(`Не удалось открыть ${file ? file.name : "файл"}: ${e.message}`, "error");
    }
    const bad = new Set(res.errors.map((e) => e.partId).filter(Boolean));
    res.project.parts = res.project.parts.filter((p) => !bad.has(p.id));
    S.history.push(S.project, "Открыть проект");
    setProject(res.project, { fit: true });
    IO.autosave(S.project);
    if (res.errors.length) status(`Открыт «${res.project.name}», пропущено деталей с ошибками: ${bad.size}. ${res.errors[0].message}`, "warn");
    else status(`Открыт проект «${res.project.name}»: деталей ${res.project.parts.length}`, "ok");
  }

  function exportStl() {
    if (!S.project.parts.length) return status("Нет деталей для STL", "warn");
    const tri = G.projectTriangles(S.project);
    const check = G.checkClosed(tri);
    IO.download(IO.fileNameFor(S.project, ".stl"), G.stlBinary(tri), "model/stl");
    status(`STL: ${S.project.parts.length} дет., ${tri.length / 9} треугольников, мм; оболочки ${check.closed ? "замкнуты" : "НЕ замкнуты"}`, check.closed ? "ok" : "warn");
  }

  function exportFreecad() {
    try {
      IO.download(IO.fileNameFor(S.project, ".mech-freecad.json"), IO.exportFreecadJson(S.project));
      status("Экспорт для FreeCAD сохранён. Запустите макрос import_parts.FCMacro и выберите этот файл.", "ok");
    } catch (e) {
      status(e.message, "error");
    }
  }

  function downloadMacro() {
    const m = BS.mechMacro;
    if (!m) return status("Исходник макроса не подключён (js/mech/mechMacroSource.js); макрос лежит в freecad/import_parts.FCMacro", "error");
    IO.download(m.fileName, m.source, "text/x-python");
    status(`Скачан ${m.fileName}`, "ok");
  }

  // ================================================================== команды

  function renderCommands() {
    const c = S.dom.commands;
    S.dom.undoBtn = button("undo", null, undo, "Отменить (Ctrl+Z)", { class: "icon-only ghost" });
    S.dom.redoBtn = button("redo", null, redo, "Повторить (Ctrl+Y)", { class: "icon-only ghost" });
    S.dom.delBtn = button("trash", "Удалить", removeSelected, "Удалить выбранную деталь (Delete)");
    BS.dom.fill(c,
      button("file", "Новый проект", newProject, "Новый пустой проект деталей"),
      el("span", { class: "segmented", role: "group", "aria-label": "Добавить деталь" },
        button("bushing", "Втулка", () => addPart("bushing"), "Добавить втулку"),
        button("shaft", "Вал", () => addPart("shaft"), "Добавить ступенчатый вал"),
        button("flange", "Фланец", () => addPart("flange"), "Добавить фланец с отверстиями")),
      S.dom.delBtn, S.dom.undoBtn, S.dom.redoBtn,
      el("span", { class: "mech-sep" }),
      button("save", "Сохранить", () => { IO.download(IO.fileNameFor(S.project, ".mech.json"), IO.serialize(S.project)); status("Проект сохранён (*.mech.json)", "ok"); }, "Скачать проект *.mech.json"),
      button("open", "Открыть", () => IO.openFile(loadProject, (e) => status(e.message, "error")), "Открыть проект *.mech.json"),
      button("export", "Экспорт FreeCAD (JSON)", exportFreecad, "Файл для макроса import_parts.FCMacro (твёрдые тела, STEP)"),
      button("code", "Скачать макрос", downloadMacro, "Макрос FreeCAD import_parts.FCMacro"),
      button("export", "STL", exportStl, "Сетка всех деталей в STL (мм) — для просмотра и 3D-печати"),
      button("fit", null, fitView, "Показать все детали", { class: "icon-only ghost" }));
    renderCommandsState();
  }

  function renderCommandsState() {
    if (!S.dom.undoBtn) return;
    S.dom.undoBtn.disabled = !S.history.canUndo();
    S.dom.undoBtn.title = S.history.canUndo() ? `Отменить: ${S.history.undoLabel()} (Ctrl+Z)` : "Отменить (Ctrl+Z)";
    S.dom.redoBtn.disabled = !S.history.canRedo();
    S.dom.redoBtn.title = S.history.canRedo() ? `Повторить: ${S.history.redoLabel()} (Ctrl+Y)` : "Повторить (Ctrl+Y)";
    S.dom.delBtn.disabled = !selected();
  }

  // ================================================================== дерево

  function renderTree() {
    const node = S.dom.tree;
    node.classList.add("tree", "mech-tree");
    if (!S.project.parts.length) {
      BS.dom.fill(node, el("p", { class: "empty" }, "Деталей нет. Добавьте втулку, вал или фланец кнопками сверху."));
      return;
    }
    const icon = (n) => {
      const s = el("span", { class: "mech-ico" });
      if (BS.icons && hasIcon(n)) s.innerHTML = BS.icons.svg(n);
      return s;
    };
    const items = S.project.parts.map((part) => {
      const sel = part.id === S.selectedId;
      const row = el("div", { class: sel ? "row selected" : "row", onclick: () => select(part.id), title: `${M.TYPES[part.type].label} · ${part.id}` },
        icon(part.type), el("span", { class: "mech-name" }, part.name));
      const li = el("li", {}, row);
      if (sel) {
        const feats = M.features(part).map((f) => el("li", {}, el("div", { class: "row mech-feature", title: `Фича: ${f.kind}` }, el("span", { class: "mech-kind" }, f.kind), el("span", {}, f.label))));
        li.append(el("ul", {}, feats));
      }
      return li;
    });
    BS.dom.fill(node, el("ul", {}, items), el("p", { class: "note" }, "Под выбранной деталью — дерево фич: эскиз профиля, фаски, вращение, отверстия."));
  }

  // ================================================================== параметры

  /** Числовое поле с живой проверкой: значение применяется к модели, только если проверка прошла. */
  function liveNumber({ field, label, unit, value, step = 1, hint, apply }) {
    const input = el("input", { type: "number", step, value: BS.dom.fmtNum(value), "aria-label": label });
    const errNode = el("div", { class: "mech-err", role: "alert" });
    S.fieldNodes.set(field, { input, errNode });
    input.addEventListener("focus", () => { S.focusSnapshot = JSON.stringify(S.project); });
    input.addEventListener("input", () => {
      const txt = input.value.replace(",", ".");
      const v = Number(txt);
      if (txt.trim() === "" || !Number.isFinite(v)) return showErrors([{ field, message: `${label}: нужно число` }]);
      apply(v);
    });
    input.addEventListener("change", commitFocus);
    return el("div", { class: "mech-field" },
      el("label", { class: "field", title: hint || label }, el("span", {}, label), el("span", { class: "unit" }, input, unit ? el("em", {}, unit) : null)),
      errNode);
  }

  /** Запись в историю после правки поля (снимок до фокуса). */
  function commitFocus() {
    if (S.focusSnapshot && S.focusSnapshot !== JSON.stringify(S.project)) {
      S.history.push(JSON.parse(S.focusSnapshot), "Изменить параметры");
      S.focusSnapshot = JSON.stringify(S.project);
      IO.autosave(S.project);
      renderCommandsState();
    }
  }

  function showErrors(errors) {
    for (const { input, errNode } of S.fieldNodes.values()) {
      input.classList.remove("invalid");
      input.removeAttribute("aria-invalid");
      errNode.textContent = "";
    }
    const general = [];
    for (const e of errors) {
      const n = S.fieldNodes.get(e.field);
      if (n) {
        n.input.classList.add("invalid");
        n.input.setAttribute("aria-invalid", "true");
        n.errNode.textContent = n.errNode.textContent ? `${n.errNode.textContent}; ${e.message}` : e.message;
      } else general.push(e.message);
    }
    if (S.dom.generalErr) S.dom.generalErr.textContent = general.join("; ");
    if (errors.length) status(`${errors[0].message}. Модель не изменена — показана последняя корректная геометрия.`, "error");
    return errors;
  }

  /** Попытка изменить параметр детали: при ошибке модель не меняется. */
  function tryParams(part, mutate) {
    const cand = JSON.parse(JSON.stringify(part.params));
    mutate(cand);
    const errors = M.validateParams(part.type, cand);
    showErrors(errors);
    if (errors.length) return false;
    part.params = cand;
    syncMeshes();
    renderCalc();
    status(`${part.name}: перестроено`, null);
    return true;
  }

  function tryPlacement(part, mutate) {
    const pl = JSON.parse(JSON.stringify(part.placement));
    mutate(pl);
    showErrors([]);
    part.placement = pl;
    syncMeshes();
    renderCalc();
  }

  function renderProps() {
    const node = S.dom.props;
    S.fieldNodes.clear();
    const part = selected();
    if (!part) {
      BS.dom.fill(node, el("p", { class: "empty" }, S.project.parts.length ? "Выберите деталь в дереве или в 3D-виде." : "Добавьте деталь кнопками «Втулка», «Вал» или «Фланец»."));
      return;
    }
    const t = M.TYPES[part.type];
    const sections = [];
    sections.push(el("h3", {}, t.label));
    sections.push(BS.dom.textField({
      label: "Название", value: part.name,
      onChange: (v) => { if (v && v !== part.name) { edit("Переименовать", () => { part.name = v; }); renderProps(); } },
    }));
    sections.push(BS.dom.selectField({
      label: "Материал", value: part.material,
      options: Object.entries(M.MATERIALS).map(([value, m]) => ({ value, label: `${m.label} (${m.density} кг/м³)` })),
      onChange: (v) => { edit("Материал", () => { part.material = v; }); renderCalc(); },
    }));

    sections.push(el("h3", {}, "Размеры, мм"));
    for (const d of t.params) {
      sections.push(liveNumber({
        field: d.key, label: d.label, unit: d.unit, value: part.params[d.key], step: d.step, hint: d.hint,
        apply: (v) => tryParams(part, (p) => { p[d.key] = v; }),
      }));
    }
    if (part.type === "shaft") sections.push(renderSteps(part));
    S.dom.generalErr = el("div", { class: "mech-err" });
    sections.push(S.dom.generalErr);

    sections.push(el("h3", {}, "Положение"));
    const pl = part.placement;
    for (const k of ["x", "y", "z"]) {
      sections.push(liveNumber({ field: `placement.${k}`, label: k.toUpperCase(), unit: "мм", value: pl[k], step: 5, apply: (v) => tryPlacement(part, (p) => { p[k] = v; }) }));
    }
    for (const k of ["x", "y", "z"]) {
      sections.push(liveNumber({ field: `rotation.${k}`, label: `Поворот вокруг ${k.toUpperCase()}`, unit: "°", value: pl.rotation[k], step: 15, apply: (v) => tryPlacement(part, (p) => { p.rotation[k] = v; }) }));
    }
    sections.push(el("p", { class: "note" }, "Локальная ось детали — Z, левый торец на z = 0. Поворот — углы Эйлера X → Y → Z."));

    sections.push(el("h3", {}, "Размеры и масса"));
    S.dom.calc = el("div", { class: "mech-calc" });
    sections.push(S.dom.calc);
    BS.dom.fill(node, sections);
    renderCalc();
  }

  function renderSteps(part) {
    const steps = part.params.steps;
    const rows = steps.map((s, i) => el("div", { class: "mech-step" },
      el("span", { class: "mech-step-n" }, String(i + 1)),
      liveNumber({ field: `steps.${i}.d`, label: "d", unit: "мм", value: s.d, step: 1, apply: (v) => tryParams(part, (p) => { p.steps[i].d = v; }) }),
      liveNumber({ field: `steps.${i}.L`, label: "L", unit: "мм", value: s.L, step: 1, apply: (v) => tryParams(part, (p) => { p.steps[i].L = v; }) }),
      button("trash", null, () => {
        if (steps.length <= 1) return status("У вала должна остаться хотя бы одна ступень", "warn");
        const cand = JSON.parse(JSON.stringify(part.params));
        cand.steps.splice(i, 1);
        const errs = M.validateParams("shaft", cand);
        if (errs.length) return showErrors(errs);
        edit("Удалить ступень", () => { part.params = cand; });
        renderProps();
      }, `Удалить ступень ${i + 1}`, { class: "icon-only ghost" })));
    const add = button("plus", "Добавить ступень", () => {
      const cand = JSON.parse(JSON.stringify(part.params));
      const last = cand.steps[cand.steps.length - 1];
      cand.steps.push({ d: Math.max(1, Math.round(last.d * 0.8)), L: last.L });
      const errs = M.validateParams("shaft", cand);
      if (errs.length) return showErrors(errs);
      edit("Добавить ступень", () => { part.params = cand; });
      renderProps();
    }, "Добавить ступень в конец вала");
    return el("div", { class: "mech-steps" }, el("div", { class: "mech-steps-head" }, el("span", {}, "Ступени вала (слева направо)"), S.dom.stepsErr = el("span", {})), rows, add);
  }

  function renderCalc() {
    const part = selected();
    if (!part || !S.dom.calc) return;
    if (M.validateParams(part.type, part.params).length) return;
    let r;
    try {
      r = G.partReport(part);
    } catch (e) {
      BS.dom.fill(S.dom.calc, el("p", { class: "mech-err" }, e.message));
      return;
    }
    const row = (k, v) => BS.dom.readonly(k, v);
    const s = r.bounds.size;
    BS.dom.fill(S.dom.calc,
      row("Габарит X × Y × Z", `${fmt(s[0])} × ${fmt(s[1])} × ${fmt(s[2])} мм`),
      row("Объём (по формулам)", `${fmt(r.analyticVolume / 1000, 3)} см³`),
      row("Масса", `${fmt(r.mass, 3)} кг`),
      row("Объём сетки", `${fmt(r.meshVolume / 1000, 3)} см³ (${r.meshDeviation >= 0 ? "+" : ""}${fmt(r.meshDeviation * 100, 3)} %)`),
      row("Треугольников", String(r.triangles)),
      el("p", { class: "note" }, "Масса — по справочной плотности материала. Сетка вписана в окружности, поэтому её объём чуть меньше точного."));
    updateSelectionBox();
    renderTree();
  }

  function renderAll() {
    renderTree();
    renderProps();
    renderCommandsState();
    updateSelectionBox();
  }

  // ================================================================== клавиши

  function onKey(e) {
    if (document.body.dataset.mode !== "mech") return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (!mod && e.key === "Delete") { e.preventDefault(); removeSelected(); }
  }

  // ================================================================== монтирование

  function mount({ viewport, tree, props, commands }) {
    if (S.mounted) return;
    if (!viewport || !tree || !props || !commands) throw new Error("mechApp.mount: нужны контейнеры viewport, tree, props, commands");
    if (!T || !T.OrbitControls) throw new Error("Three.js или OrbitControls не загружены (vendor/three)");
    S.dom = { viewport, tree, props, commands };
    S.history = BS.history ? BS.history.createHistory(100) : { push() {}, canUndo: () => false, canRedo: () => false, undoLabel: () => null, redoLabel: () => null, undo: () => null, redo: () => null };
    viewport.classList.add("mech-viewport");
    initScene(viewport);
    S.dom.hud = el("div", { class: "mech-hud" });
    viewport.append(S.dom.hud);
    S.mounted = true;

    const saved = IO.loadAutosave();
    let project = M.createDemoProject();
    let note = "Открыт демонстрационный проект: втулка, вал, фланец";
    if (saved) {
      const bad = new Set(saved.errors.map((e) => e.partId));
      saved.project.parts = saved.project.parts.filter((p) => !bad.has(p.id));
      project = saved.project;
      note = `Восстановлен автосохранённый проект «${project.name}»`;
    }
    renderCommands();
    setProject(project, { fit: true });
    status(note, "ok");
    document.addEventListener("keydown", onKey);
    BS.events.on("layout", resize);
    BS.events.on("mode", (m) => { if (m === "mech") { resize(); applyTheme(); } });
  }

  BS.mechApp = {
    mount,
    resize,
    isMounted: () => S.mounted,
    /** Для отладки и тестов в браузере. */
    getProject: () => S.project,
    fitView,
  };
})(globalThis.BuildSense);
