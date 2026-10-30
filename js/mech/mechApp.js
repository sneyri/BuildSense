// BuildSense · Машиностроение — интерфейс режима: своя Three.js-сцена (мм, ось Z вверх),
// команды, дерево деталей и фич, сборки (компоненты и сопряжения, js/mech/mechAssembly.js),
// панель параметров с живой проверкой.
// BS.mechApp.mount({ viewport, tree, props, commands }), BS.mechApp.resize(), BS.mechApp.isMounted().
// Параметры детали меняются только корректными значениями: при ошибке проверки поле подсвечивается,
// сообщение показывается под полем, а модель остаётся с последней корректной геометрией.
(function (BS) {
  "use strict";
  const M = BS.mechModel;
  const G = BS.mechGeometry;
  const IO = BS.mechIO;
  const A = BS.mechAssembly;
  const T = globalThis.THREE;

  const S = {
    mounted: false,
    dom: null,
    project: null,
    selectedId: null,
    selectedAsm: null, // выбранная сборка (без детали) или сборка выбранного сопряжения
    selectedMate: null,
    solved: null, // id сборки → результат решения (обновляется в syncMeshes)
    history: null,
    gl: null,
    meshes: new Map(), // id → { key, mesh, edges }
    fieldNodes: new Map(), // поле → { input, errNode }
    focusSnapshot: null,
    preview: null, // предпросмотр соединения: id детали → положение (данные проекта не меняются)
    previewMover: null,
    ix: null, // управление мышью (mechInteract.js)
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

    // манипуляторы, «Соединить детали», подсветка — до обработчиков ниже, чтобы они могли перехватить начало перетаскивания
    S.ix = BS.mechInteract.create({
      T, renderer, scene, camera, controls, host: container,
      api: {
        project: () => S.project, meshes: () => S.meshes, selectedId: () => S.selectedId, select,
        commit: (prevJson, label) => { S.history.push(JSON.parse(prevJson), label); IO.autosave(S.project); renderProps(); renderCalc(); renderCommandsState(); },
        restore: (json) => { const old = JSON.parse(json); for (const p of S.project.parts) { const o = old.parts.find((x) => x.id === p.id); if (o) p.placement = o.placement; } syncMeshes(); renderProps(); },
        syncMeshes, status, edit,
        setPreview: (map, moverId) => { S.preview = map && Object.keys(map).length ? map : null; S.previewMover = S.preview ? moverId : null; syncMeshes(); },
        toggleFixed,
      },
    });

    // выбор щелчком; перетаскивание детали мышью: по умолчанию — по горизонтали (X/Y), с Shift — по высоте (Z)
    const ray = new T.Raycaster();
    const setRay = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    };
    let down = null;
    let drag = null;
    // плоскость перетаскивания: горизонтальная через точку (X/Y) или вертикальная, повёрнутая к камере (Z)
    const dragPlane = (vertical, point) => {
      if (!vertical) return new T.Plane(new T.Vector3(0, 0, 1), -point.z);
      const n = camera.getWorldDirection(new T.Vector3());
      n.z = 0;
      if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
      return new T.Plane().setFromNormalAndCoplanarPoint(n.normalize(), point);
    };
    // Shift нажали или отпустили посреди перетаскивания: продолжаем с текущего места в другой плоскости
    const switchMode = (vertical) => {
      if (!drag || drag.vertical === vertical) return;
      drag.origin = { ...drag.part.placement };
      drag.plane = dragPlane(vertical, drag.point);
      drag.start = drag.point.clone();
      drag.vertical = vertical;
    };
    // попадание луча: скрытые детали и часть, отсечённая разрезом (js/mech/mechViewer.js), не выбираются
    const pick = () => ray.intersectObjects([...S.meshes.values()].map((m) => m.mesh).filter((m) => m.visible), false)
      .find((h) => !S.view || S.view.acceptHit(h)) || null;
    window.addEventListener("keydown", (e) => { if (e.key === "Shift") switchMode(true); });
    window.addEventListener("keyup", (e) => { if (e.key === "Shift") switchMode(false); });
    renderer.domElement.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary) { down = null; return; } // второй палец — щипок камеры, не клик
      down = [e.clientX, e.clientY];
      if (e.button !== 0 || S.ix.state().tool !== "select") return;
      setRay(e);
      const hit = pick();
      if (!hit) return;
      const part = S.project.parts.find((q) => q.id === hit.object.userData.partId);
      if (!part) return;
      // пальцем деталь тянется только после выбора: первое касание выбирает, а не мешает вращать камеру
      if (e.pointerType === "touch" && S.selectedId !== part.id) return;
      const vlock = S.view && S.view.lock(part); // взрывной вид, симуляция или деталь механизма — не тянуть
      if (vlock) { select(part.id); status(vlock, "warn"); return; }
      const rule = BS.mechConnect.moveRule(S.project, part.id);
      if (rule.mode === "mated") { select(part.id); S.ix.showLock(part, rule); return; }
      if (rule.reason) status(rule.reason, "warn");
      const plane = dragPlane(e.shiftKey, hit.point);
      const start = ray.ray.intersectPlane(plane, new T.Vector3());
      if (!start) return;
      e.stopImmediatePropagation(); // не вращать камеру, пока тянем деталь
      renderer.domElement.setPointerCapture(e.pointerId);
      drag = { part, plane, start, point: start.clone(), origin: { ...part.placement }, vertical: e.shiftKey, moved: false, sx: e.clientX, sy: e.clientY };
    }, true);
    renderer.domElement.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      switchMode(e.shiftKey);
      setRay(e);
      const p = ray.ray.intersectPlane(drag.plane, new T.Vector3());
      if (!p) return;
      drag.point = p;
      if (!drag.moved) { drag.moved = true; S.history.push(S.project, `Переместить: ${drag.part.name}`); select(drag.part.id); }
      const pl = drag.part.placement, o = drag.origin, d = p.clone().sub(drag.start);
      const r = (v) => (S.ix.snapEnabled() ? Math.round(v) : v);
      if (drag.vertical) pl.z = r(o.z + d.z);
      else { pl.x = r(o.x + d.x); pl.y = r(o.y + d.y); }
      syncMeshes();
      status(`${drag.part.name}: X ${fmt(pl.x, 1)} · Y ${fmt(pl.y, 1)} · Z ${fmt(pl.z, 1)} мм`);
    });
    const endDrag = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* не захвачен */ }
      if (d.moved) { IO.autosave(S.project); renderProps(); renderCalc(); renderCommandsState(); return; }
      select(d.part.id);
    };
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (drag) { endDrag(e); down = null; return; }
      if (S.ix.state().tool !== "select") return;
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      setRay(e);
      const hit = pick();
      select(hit ? hit.object.userData.partId : null);
    });
    renderer.domElement.addEventListener("pointercancel", endDrag);

    new ResizeObserver(() => resize()).observe(container);
    const loop = () => {
      requestAnimationFrame(loop);
      const c = renderer.domElement;
      if (!container.clientWidth || !container.clientHeight) return; // режим скрыт
      if (S.gl.frame++ % 60 === 0) applyTheme();
      controls.update();
      S.ix.update();
      if (S.view) S.view.frame(performance.now());
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
    S.solved = A.solveAll(S.project); // положения компонентов сборок — из сопряжений
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
      const ghost = S.preview && S.preview[part.id];
      rec.mesh.matrix.copy(G.partMatrix(ghost ? { placement: ghost } : part));
      rec.mesh.matrixWorldNeedsUpdate = true;
      rec.mesh.material.emissive.setHex(part.id === S.previewMover ? 0x7a4a00 : part.id === S.selectedId ? 0x16305e : 0x000000);
      rec.mesh.material.transparent = Boolean(ghost);
      rec.mesh.material.opacity = ghost ? 0.7 : 1;
      // кромки показывают состояние: закреплена — синие, положение задано сопряжениями — зелёные
      const rule = BS.mechConnect.moveRule(S.project, part.id);
      rec.edges.material.color.setHex(rule.mode === "anchor" ? 0x2f7dff : rule.mode === "mated" ? 0x2fb36a : 0x1d232b);
      rec.edges.material.opacity = rule.mode === "free" ? 0.55 : 0.95;
    }
    for (const [id, rec] of S.meshes) if (!alive.has(id)) { disposeRec(rec); S.meshes.delete(id); }
    updateSelectionBox();
    if (S.view) { S.view.changed(); S.view.apply(); } // временный показ: разборка, симуляция, разрез, скрытие
    BS.events.emit("mech:sync"); // для визуального обучения (mechCoach): проект или выбор изменились
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
      const cp = part && A.componentOfPart(S.project, part.id);
      const inAsm = cp ? ` · ${cp.asm.name}: ${A.STATUS_LABEL[resultOf(cp.asm).components[cp.comp.id].status]}` : "";
      const rule = part ? BS.mechConnect.moveRule(S.project, part.id) : null;
      const state = rule ? { free: " · свободна", anchor: " · закреплена", mated: " · положение задано сопряжениями" }[rule.mode] : "";
      S.dom.hud.textContent = part
        ? `${part.name}: габарит ${b3(part).map((v) => fmt(v, 2)).join(" × ")} мм (X × Y × Z)${state}${inAsm}`
        : `Деталей: ${S.project.parts.length}. Щелчок — выбор; стрелки — перемещение, дуги — поворот; J — соединить детали; ? — горячие клавиши.`;
    }
  }
  const b3 = (part) => M.worldBounds(part).size;

  // ================================================================== проект и история

  function setProject(project, { keepSelection = false, fit = false } = {}) {
    S.project = project;
    A.list(project);
    if (!keepSelection || !selected()) S.selectedId = project.parts[0] ? project.parts[0].id : null;
    if (!keepSelection || !A.list(project).some((a) => a.id === S.selectedAsm)) { S.selectedAsm = null; S.selectedMate = null; }
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
    if (S.selectedId === id && !S.selectedMate && !S.selectedAsm) return;
    S.selectedId = id;
    S.selectedMate = null;
    S.selectedAsm = null;
    syncMeshes();
    renderTree();
    renderProps();
    renderCommandsState();
    if (S.ix) { S.ix.refresh(); S.ix.hideLock(); }
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

  /** Закрепить на месте / снять закрепление выбранной детали (клавиша K). */
  function toggleFixed() {
    const part = selected();
    if (!part) return status("Сначала выберите деталь", "warn");
    let res;
    edit(`Закрепление: ${part.name}`, (pr) => { res = BS.mechConnect.toggleFixed(pr, part.id); });
    renderProps();
    if (S.ix) S.ix.refresh();
    status(res.text, "ok");
  }

  /** Дублировать выбранную деталь (Ctrl+D): копия рядом с новым id. */
  function duplicateSelected() {
    const part = selected();
    if (!part) return status("Выберите деталь для копирования", "warn");
    let copy;
    edit(`Дублировать: ${part.name}`, (pr) => { copy = BS.mechConnect.duplicatePart(pr, part.id); });
    S.selectedId = copy.id;
    syncMeshes();
    renderAll();
    status(`Создана копия «${copy.name}» рядом. Ctrl+Z — отменить.`, "ok");
  }

  /** Стандартные виды камеры: top / front / iso. */
  function setView(kind) {
    const box = new T.Box3();
    for (const m of S.meshes.values()) box.expandByObject(m.mesh);
    if (box.isEmpty()) return;
    const center = box.getCenter(new T.Vector3());
    const radius = Math.max(box.getSize(new T.Vector3()).length() / 2, 20);
    const cam = S.gl.camera;
    const dist = radius / Math.sin((cam.fov * Math.PI) / 360) * 1.1;
    const dir = kind === "top" ? new T.Vector3(0, -0.0001, 1) : kind === "front" ? new T.Vector3(0, -1, 0.0001) : new T.Vector3(0.45, -0.75, 0.5);
    cam.position.copy(center).addScaledVector(dir.normalize(), dist);
    cam.near = Math.max(0.5, dist / 1000);
    cam.far = dist * 50;
    cam.updateProjectionMatrix();
    S.gl.controls.target.copy(center);
    S.gl.controls.update();
  }

  function removeSelected() {
    const part = selected();
    if (!part) return status("Выберите деталь для удаления", "warn");
    const idx = S.project.parts.indexOf(part);
    edit(`Удалить «${part.name}»`, (pr) => { A.removePart(pr, part.id); if (BS.mechKinematics) BS.mechKinematics.removePart(pr, part.id); pr.parts.splice(idx, 1); });
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
    const bad = IO.dropInvalidParts(res); // и из сборок тоже: иначе компоненты ссылались бы на удалённые детали
    S.history.push(S.project, "Открыть проект");
    setProject(res.project, { fit: true });
    IO.autosave(S.project);
    if (res.errors.length) status(`Открыт «${res.project.name}», пропущено деталей с ошибками: ${bad.size}. ${res.errors[0].message}`, "warn");
    else status(`Открыт проект «${res.project.name}»: деталей ${res.project.parts.length}`, "ok");
  }

  function exportStl() {
    if (!S.project.parts.length) return status("Нет деталей для STL", "warn");
    const tri = G.projectTriangles(S.project);
    // замкнутость проверяется по каждой детали: у касающихся деталей сборки общие рёбра колец, и общая сетка «не многообразна» — это не дефект
    const open = S.project.parts.filter((p) => !G.checkClosed(G.projectTriangles(S.project, [p])).closed).length;
    IO.download(IO.fileNameFor(S.project, ".stl"), G.stlBinary(tri), "model/stl");
    status(`STL: ${S.project.parts.length} дет., ${tri.length / 9} треугольников, мм; оболочки ${open ? `НЕ замкнуты у деталей: ${open}` : "всех деталей замкнуты"}`, open ? "warn" : "ok");
  }

  function exportFreecad() {
    try {
      IO.download(IO.fileNameFor(S.project, ".mech-freecad.json"), IO.exportFreecadJson(S.project));
      status("Экспорт для FreeCAD сохранён. Запустите макрос import_parts.FCMacro и выберите этот файл.", "ok");
    } catch (e) {
      status(e.message, "error");
    }
  }

  /** Учебный чертёж выбранной детали (или первой, если ничего не выбрано): предпросмотр и скачивание PNG. */
  function showDrawing() {
    const part = selected() || S.project.parts[0];
    if (!part) return status("Сначала добавьте деталь", "warn");
    if (!BS.mechDrawing) return status("Модуль чертежей не подключён (js/mech/mechDrawing.js)", "error");
    if (M.isExtrude && M.isExtrude(part.type)) return status(`«${part.name}» — плоская деталь (выдавливание): учебный чертёж пока строится только для тел вращения`, "warn");
    if (M.validateParams(part.type, part.params).length) return status("Исправьте параметры детали — чертёж строится только по корректным размерам", "warn");
    let canvas;
    try {
      canvas = BS.mechDrawing.render(part, { project: S.project });
    } catch (e) {
      return status(`Не удалось построить чертёж: ${e.message}`, "error");
    }
    const fileName = IO.fileNameFor({ name: part.name }, "_чертёж.png");
    const save = async () => {
      try { IO.download(fileName, await BS.mechDrawing.toBlob(canvas), "image/png"); status(`Чертёж сохранён: ${fileName}`, "ok"); }
      catch (e) { status(e.message, "error"); }
    };
    canvas.className = "drawing-canvas";
    const close = () => { dlg.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const dlg = el("div", { class: "drawing-dialog", role: "dialog", "aria-label": "Чертёж детали" },
      el("div", { class: "drawing-box" },
        el("div", { class: "drawing-head" },
          el("strong", {}, `Чертёж: ${part.name}`),
          el("span", { class: "drawing-note" }, "Лист A3, 4200 × 2970 px. Масштаб подобран автоматически."),
          button("export", "Скачать PNG", save, "Сохранить чертёж как PNG", { class: "primary" }),
          button(null, "Закрыть", close, "Закрыть (Esc)")),
        el("div", { class: "drawing-scroll" }, canvas)));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
    document.addEventListener("keydown", onKey);
    document.body.append(dlg);
  }

  /** «Механизм»: роли деталей берутся из соединений; при нехватке данных — понятный текст, проект не меняется. */
  function createMechanism(type) {
    const trial = JSON.parse(JSON.stringify(S.project));
    const t = BS.mechMechanism.create(trial, type);
    if (!t.ok) return status(t.error, "warn");
    let res;
    edit(`Механизм: ${BS.mechMechanism.LABEL[type]}`, (pr) => { res = BS.mechMechanism.create(pr, type); });
    status(`Создан механизм «${res.mechanism.name}». ${res.check.notes.join("; ")}. Откройте внизу «Симуляция» → «Пуск».`, "ok");
    if (S.view) S.view.changed();
  }

  // ---------------------------------------------------------------- визуальное обучение (mechCoach + mechLessons)

  /** Контекст урока: операции над проектом (общие с тестами) + помощники интерфейса для подсветки и проверки шагов. */
  function coachContext() {
    const hooks = {
      addPart: (type) => { addPart(type); return selected(); },
      newProject: () => { S.history.push(S.project, "Новый проект"); setProject(M.createProject(), { fit: true }); IO.autosave(S.project); status("Новый проект деталей", "ok"); },
    };
    const c = BS.mechCoach.dataContext(() => S.project, (label, fn) => edit(label, fn), hooks);
    const root = () => document.getElementById("mech-root") || document;
    const byText = (scope, sel, text) => [...scope.querySelectorAll(sel)].find((b) => (b.textContent || "").trim().startsWith(text)) || null;
    const union = (nodes) => {
      const rs = nodes.map((n) => n.getBoundingClientRect()).filter((r) => r.width || r.height);
      if (!rs.length) return null;
      const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
      return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y };
    };
    c.ui = {
      /** Кнопка ленты; если её вкладка не открыта — подсвечивается вкладка (сначала откройте её). */
      ribbon(text) {
        const btn = byText(document, ".mech-commands button", text);
        if (!btn) return null;
        const panel = btn.closest(".rb-panel");
        const rbn = btn.closest(".ribbon");
        if (rbn && rbn.classList.contains("collapsed")) return rbn.querySelector(".rb-tabs .active") || rbn.querySelector(".rb-tabs button");
        if (panel && !panel.classList.contains("active")) {
          return document.querySelector(`.mech-commands [data-rtab="${panel.dataset.rpanel}"]`) || btn;
        }
        return btn;
      },
      tool: (id) => (id === undefined ? S.ix.state().tool : document.querySelector(`.ix-tool[data-tool="${id}"]`)),
      setTool: (t) => S.ix.setTool(t),
      conn: () => S.ix.state().conn,
      pick: (cls) => S.ix._pick(cls),
      confirm: () => S.ix.confirm(),
      connectApply: () => byText(document, ".ix-panel .ix-actions button", "Применить"),
      selectedId: () => S.selectedId,
      treeRow: (id) => [...S.dom.tree.querySelectorAll(".row")].find((r) => (r.getAttribute("title") || "").endsWith(`· ${id}`)) || null,
      section(title) {
        const props = S.dom.props;
        const h = [...props.querySelectorAll("h3")].find((n) => n.textContent.trim().startsWith(title));
        if (h) { const nodes = [h]; for (let n = h.nextElementSibling; n && n.tagName !== "H3"; n = n.nextElementSibling) nodes.push(n); return union(nodes); }
        return props.querySelector(".mech-steps");
      },
      field(label) { return [...S.dom.props.querySelectorAll(".mech-field")].find((f) => f.textContent.includes(label)) || null; },
      surface: (id, want) => S.ix.surfaceRect(id, want),
      fit: () => fitView(),
      viewerMode: () => (S.view ? S.view.state().mode : "edit"),
      viewerState: () => (S.view ? S.view.state() : {}),
      viewerButton: (text) => byText(document, ".mv-bar button, .mv-panel button", text),
      viewerClick: (text) => { const b = byText(document, ".mv-bar button, .mv-panel button", text); if (b) b.click(); },
      select: (id) => select(id),
    };
    return c;
  }

  /** Запустить визуальный урок: «engine» (одноцилиндровый двигатель) или «screw» (винтовая пара). */
  function startLesson(id) {
    const lesson = BS.mechLessons && BS.mechLessons.LESSONS.find((l) => l.id === id);
    if (!lesson || !BS.mechCoach) return status("Визуальные уроки не подключены", "error");
    if (BS.mechTutorial) BS.mechTutorial.close();
    const rb = document.getElementById("mech-ribbon");
    if (rb && BS.ribbon && rb.classList.contains("collapsed")) BS.ribbon.setCollapsed(rb, false, false); // подсвечиваемые кнопки должны быть видны
    S.ix.setTool("select");
    if (S.view && S.view.restore) S.view.restore(); // выйти из взрывного вида/симуляции: урок начинается с обычного режима
    const ctx = coachContext();
    BS.mechCoach.start(lesson, ctx, status);
  }

  function toggleTutorial() {
    if (!BS.mechTutorial) return status("Модуль обучения не подключён (js/mech/mechTutorial.js)", "error");
    BS.mechTutorial.toggle({
      host: S.dom.viewport, status,
      addPart, newProject, loadDemoAssembly, newAssembly, showDrawing, fit: fitView, startLesson,
    });
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
    const group = (label, ...kids) => el("div", { class: "bgroup", role: "group", "aria-label": label, "data-label": label }, ...kids);
    const tab = (id, label) => el("button", { type: "button", role: "tab", "data-rtab": id }, label);
    const panel = (id, ...groups) => el("div", { class: "rb-panel", role: "tabpanel", "data-rpanel": id }, ...groups);
    BS.dom.fill(c,
      el("nav", { class: "rb-tabs", role: "tablist", "aria-label": "Вкладки ленты" },
        tab("home", "Главная"), tab("add", "Вставка"), tab("view", "Вид"), tab("output", "Вывод")),
      panel("home",
        group("Обучение", button("help", "Обучение", toggleTutorial, "Пошаговое обучение: детали, сборка, сопряжения, чертёж", { class: "tut-btn" })),
        group("Демонстрация", button("file", "Демо-проекты", () => S.view && S.view.openGallery(), "Вал на опорах, двигатель, домкрат: взрывной вид, симуляция, разрез", { class: "primary" })),
        group("Файл",
          button("file", "Новый проект", newProject, "Новый пустой проект деталей"),
          button("open", "Открыть", () => IO.openFile(loadProject, (e) => status(e.message, "error")), "Открыть проект *.mech.json"),
          button("save", "Сохранить", () => { IO.download(IO.fileNameFor(S.project, ".mech.json"), IO.serialize(S.project)); status("Проект сохранён (*.mech.json)", "ok"); }, "Скачать проект *.mech.json")),
        group("Правка", S.dom.delBtn, S.dom.undoBtn, S.dom.redoBtn)),
      panel("add",
        group("Деталь",
          button("bushing", "Втулка", () => addPart("bushing"), "Добавить втулку"),
          button("shaft", "Вал", () => addPart("shaft"), "Добавить ступенчатый вал"),
          button("flange", "Фланец", () => addPart("flange"), "Добавить фланец с отверстиями"),
          button("part", "Рычаг", () => addPart("link"), "Плоская деталь с двумя проушинами: шатун, щека, рычаг"),
          button("pad", "Корпус", () => addPart("block"), "Плита с отверстием: корпус опоры, стенка, основание"),
          button("round", "Поршень", () => addPart("piston"), "Поршень: днище и юбка"),
          button("shaft", "Винт", () => addPart("screw"), "Винт с условной резьбой (шаг = ход за оборот)")),
        group("Соединение",
          button("part", "Соединить детали", () => S.ix.connect(), "Выбрать поверхности двух деталей — программа предложит способ соединения (J)", { class: "primary" }),
          button("part", "Закрепить на месте", toggleFixed, "Закрепить выбранную деталь / снять закрепление (K)")),
        group("Сборка",
          button("part", "Сборка", newAssembly, "Новая сборка; выбранная деталь станет закреплённым компонентом"),
          button("file", "Учебная сборка", loadDemoAssembly, "Открыть пример: вал с буртиком, фланец встык, втулка со смещением")),
        group("Механизм",
          button("part", "Кривошипно-шатунный", () => createMechanism("slider-crank"), "Двигатель: по соединениям определить цилиндр, поршень, шатун и коленвал и проверить, что механизм проворачивается"),
          button("part", "Винтовая пара", () => createMechanism("screw"), "Винт и гайка: вращение винта превращается в подъём на шаг резьбы за оборот"))),
      panel("view",
        group("Камера",
          button("fit", "Показать все", fitView, "Показать все детали (F)"),
          button("fit", "Сверху", () => setView("top"), "Вид сверху (NumPad 7)"),
          button("fit", "Спереди", () => setView("front"), "Вид спереди (NumPad 1)"),
          button("fit", "Изометрия", () => setView("iso"), "Изометрический вид (NumPad 0)")),
        group("Справка", button("help", "Горячие клавиши", () => BS.hotkeys && BS.hotkeys.openHelp(), "Список горячих клавиш (?)")),
        group("Панели",
          button("panel-left", "Дерево", null, "Свернуть / развернуть левую панель (дерево детали)", { "data-collapse": "left" }),
          button("panel-right", "Параметры", null, "Свернуть / развернуть правую панель (параметры)", { "data-collapse": "right" }))),
      panel("output",
        group("Чертёж и сетка",
          button("export", "Чертёж PNG", showDrawing, "Чёрно-белый чертёж выбранной детали с размерами и штампом — предпросмотр и PNG"),
          button("export", "STL", exportStl, "Сетка всех деталей в STL (мм) — для просмотра и 3D-печати")),
        group("FreeCAD",
          button("export", "Экспорт FreeCAD (JSON)", exportFreecad, "Файл для макроса import_parts.FCMacro (твёрдые тела, STEP)", { class: "primary" }),
          button("code", "Скачать макрос", downloadMacro, "Макрос FreeCAD import_parts.FCMacro"))));
    if (BS.ribbon) { const r = c.closest(".ribbon"); if (!r.querySelector(".rb-tabs .active")) BS.ribbon.select(r, "home", false); BS.ribbon.restore(r); }
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
    if (!S.project.parts.length && !A.list(S.project).length) {
      BS.dom.fill(node, el("p", { class: "empty" }, "Деталей нет. Добавьте втулку, вал или фланец кнопками сверху или откройте «Учебная сборка»."));
      return;
    }
    const icon = (n) => {
      const s = el("span", { class: "mech-ico" });
      if (BS.icons && hasIcon(n)) s.innerHTML = BS.icons.svg(n);
      return s;
    };
    const items = S.project.parts.map((part) => {
      const sel = part.id === S.selectedId;
      const hidden = S.view && S.view.isHidden(part.id);
      const eye = el("button", { type: "button", class: `icon-only ghost mv-eye${hidden ? " off" : ""}`, title: hidden ? "Показать деталь" : "Скрыть деталь (только на экране)", "aria-label": hidden ? "Показать" : "Скрыть",
        onclick: (e) => { e.stopPropagation(); if (S.view) S.view.toggleHidden(part.id); } });
      eye.innerHTML = BS.icons && hasIcon("eye") ? BS.icons.svg("eye") : "👁";
      const row = el("div", { class: `${sel ? "row selected" : "row"}${hidden ? " is-hidden" : ""}`, onclick: () => select(part.id), title: `${M.TYPES[part.type].label} · ${part.id}` },
        icon(part.type), el("span", { class: "mech-name" }, part.name), eye);
      const li = el("li", {}, row);
      if (sel) {
        const feats = M.features(part).map((f) => el("li", {}, el("div", { class: "row mech-feature", title: `Фича: ${f.kind}` }, el("span", { class: "mech-kind" }, f.kind), el("span", {}, f.label))));
        li.append(el("ul", {}, feats));
      }
      return li;
    });
    const asms = renderAsmTree();
    BS.dom.fill(node, el("ul", {}, items),
      asms.length ? el("div", { class: "mech-tree-head" }, "Сборки") : null, asms.length ? el("ul", {}, asms) : null,
      el("p", { class: "note" }, "Под выбранной деталью — дерево фич: эскиз профиля, фаски, вращение, отверстия. Под сборкой — компоненты и сопряжения со статусом решения."));
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
    const cp = A.componentOfPart(S.project, part.id);
    if (cp) {
      const s = asmSummary(cp.asm);
      status(`${part.name}: перестроено, сборка пересчитана. ${s.text}`, s.kind === "ok" ? null : s.kind);
    } else status(`${part.name}: перестроено`, null);
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
    const asmSel = !part && S.selectedAsm ? asmById(S.selectedAsm) : null;
    if (asmSel) {
      const m = S.selectedMate && asmSel.mates.find((x) => x.id === S.selectedMate);
      BS.dom.fill(node, BS.dom.sections(m ? renderMateProps(asmSel, m) : renderAsmProps(asmSel)));
      return;
    }
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
      options: Object.entries(M.MATERIALS).map(([value, m]) => ({ value, label: m.label, tag: `${m.density} кг/м³`, desc: m.desc, color: "#" + m.color.toString(16).padStart(6, "0") })),
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
    const lock = lockedReason(part);
    if (lock) {
      for (const k of ["x", "y", "z"]) for (const f of [`placement.${k}`, `rotation.${k}`]) S.fieldNodes.get(f).input.disabled = true;
      sections.push(el("p", { class: "note" }, `${lock}.`));
    }
    sections.push(...renderPartAssembly(part));

    sections.push(el("h3", {}, "Размеры и масса"));
    S.dom.calc = el("div", { class: "mech-calc" });
    sections.push(S.dom.calc);
    BS.dom.fill(node, BS.dom.sections(sections));
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

  // ================================================================== сборки

  const BADGE = { fixed: "info", solved: "pass", partial: "warning", free: "warning", conflict: "error", invalid: "error",
    ok: "pass", unsolved: "warning", broken: "error", suppressed: "info", nocontact: "warning" };
  const COMP_SHORT = { fixed: "закр.", solved: "положение", partial: "недоопределён", free: "свободен", conflict: "конфликт", invalid: "ошибка" };
  const MATE_STATUS = { ok: "выполнено", conflict: "конфликт", broken: "ошибка", unsolved: "не решено", suppressed: "подавлено", nocontact: "нет контакта" };
  const badge = (st, text) => el("span", { class: `badge ${BADGE[st] || "info"}`, title: text || "" }, text || st);
  const asmById = (id) => A.list(S.project).find((a) => a.id === id) || null;
  const resultOf = (asm) => (S.solved && S.solved.get(asm.id)) || A.solve(JSON.parse(JSON.stringify(S.project)), asm, { apply: false });

  /** Почему компонент нельзя двигать вручную (положение задано сопряжениями) — или null. */
  function lockedReason(part) {
    const cp = A.componentOfPart(S.project, part.id);
    if (!cp) return null;
    const st = resultOf(cp.asm).components[cp.comp.id];
    if (st && (st.status === "solved" || st.status === "conflict")) {
      return `«${part.name}»: положение задано сопряжениями сборки «${cp.asm.name}». Подавите сопряжение или двигайте закреплённый компонент`;
    }
    return null;
  }

  /** Короткая сводка сборки для строки состояния. */
  function asmSummary(asm) {
    const r = resultOf(asm);
    const err = r.messages.find((m) => m.severity === "error");
    const warn = r.messages.find((m) => m.severity === "warning");
    if (err) return { text: `Сборка «${asm.name}»: ${err.text}`, kind: "error" };
    if (warn) return { text: `Сборка «${asm.name}»: ${warn.text}`, kind: "warn" };
    return { text: `Сборка «${asm.name}» решена: компонентов ${asm.components.length}, сопряжений ${asm.mates.length}`, kind: "ok" };
  }

  function selectMate(asmId, mateId) {
    S.selectedAsm = asmId;
    S.selectedMate = mateId;
    S.selectedId = null;
    syncMeshes();
    renderTree();
    renderProps();
    renderCommandsState();
  }

  function selectAsm(asmId) {
    selectMate(asmId, null);
  }

  function newAssembly() {
    const part = selected();
    let asm;
    edit("Новая сборка", (pr) => {
      asm = A.createAssembly(pr);
      if (part && !A.assemblyOfPart(pr, part.id)) A.addComponent(pr, asm, part.id, { fixed: true });
    });
    if (part && asm.components.length) {
      renderProps();
      status(`Создана «${asm.name}»: «${part.name}» — закреплённый компонент. Включите другие детали и задайте сопряжения`, "ok");
    } else {
      selectAsm(asm.id);
      status(`Создана «${asm.name}». Выберите деталь и включите её в сборку`, "ok");
    }
  }

  function loadDemoAssembly() {
    S.history.push(S.project, "Учебная сборка");
    setProject(A.createDemoAssemblyProject(), { fit: true });
    IO.autosave(S.project);
    const s = asmSummary(S.project.assemblies[0]);
    status(`Открыта учебная сборка. ${s.text}`, s.kind);
  }

  /** Раздел «Сборка» в свойствах детали. */
  function renderPartAssembly(part) {
    const out = [el("h3", {}, "Сборка")];
    const cp = A.componentOfPart(S.project, part.id);
    if (!cp) {
      const asms = A.list(S.project);
      if (asms.length) {
        let target = asms[0].id;
        if (asms.length > 1) {
          out.push(BS.dom.selectField({ label: "Сборка", value: target, options: asms.map((a) => ({ value: a.id, label: a.name })), onChange: (v) => { target = v; } }));
        }
        out.push(button("plus", asms.length > 1 ? "Включить в сборку" : `Включить в «${asms[0].name}»`, () => {
          const asm = asmById(target);
          edit(`Включить в сборку: ${part.name}`, (pr) => A.addComponent(pr, A.list(pr).find((a) => a.id === asm.id), part.id, { fixed: !asm.components.length }));
          renderProps();
          const s = asmSummary(asmById(target));
          status(`«${part.name}» — компонент сборки. ${s.text}`, s.kind);
        }, "Деталь станет компонентом сборки; её размеры и материал остаются своими"));
      }
      out.push(button("part", "Новая сборка с этой деталью", newAssembly, "Создать сборку; эта деталь станет закреплённым компонентом"));
      out.push(el("p", { class: "note" }, "Деталь не входит в сборку. В сборке деталь остаётся отдельной и редактируемой; положение задают сопряжения."));
      return out;
    }
    const { asm, comp } = cp;
    const r = resultOf(asm);
    const st = r.components[comp.id];
    const tone = BADGE[st.status] || "info";
    const stateText = st.status === "fixed" ? "Деталь закреплена: она стоит на месте, а остальные детали подстраиваются под неё." : st.text;
    const nMates = asm.mates.filter((m) => m.a.comp === comp.id || m.b.comp === comp.id);

    // 1. Где деталь и в каком она состоянии
    out.push(el("div", { class: "asm-card" },
      el("div", { class: "asm-card-head" },
        el("span", { class: "asm-ico", html: BS.icons ? BS.icons.svg("part") : "" }),
        el("div", { class: "asm-card-title" }, el("strong", {}, asm.name), el("span", { class: "note" }, `Деталь — компонент ${comp.id}. Всего в сборке: компонентов ${asm.components.length}, сопряжений ${asm.mates.length}`)),
        badge(st.status, A.STATUS_LABEL[st.status])),
      el("div", { class: `asm-state ${tone}` }, stateText)));

    // 2. Закрепление — переключатель с пояснением
    const fixedBox = el("input", {
      type: "checkbox", class: "switch", checked: Boolean(comp.fixed), "aria-label": "Закрепить деталь",
      onchange: () => {
        const v = fixedBox.checked;
        edit(v ? "Закрепить компонент" : "Снять закрепление", () => { comp.fixed = v; });
        renderProps();
        const s = asmSummary(asm);
        status(`${v ? "Закреплён" : "Закрепление снято"}: «${part.name}». ${s.text}`, s.kind);
      },
    });
    out.push(el("label", { class: "toggle-row", title: "Закреплённая деталь — точка отсчёта сборки: она не двигается" },
      el("span", { class: "tr-text" }, el("strong", {}, "Закрепить деталь"), el("span", { class: "note" }, "Неподвижная опора сборки. Обычно закрепляют одну, самую большую деталь.")),
      fixedBox));

    // 3. Сопряжения этой детали
    out.push(el("div", { class: "sub-head" },
      el("strong", {}, "Сопряжения"), el("span", { class: "count-chip" }, String(nMates.length)),
      el("span", { class: "note" }, "условия, как деталь привязана к соседним")));
    if (nMates.length) {
      out.push(el("ul", { class: "mech-mate-list" }, nMates.map((m) => el("li", {},
        el("button", { type: "button", class: "mate-row", onclick: () => selectMate(asm.id, m.id), title: "Открыть параметры сопряжения" },
          badge(r.mates[m.id].status, MATE_STATUS[r.mates[m.id].status]),
          el("span", { class: "mate-main" }, el("strong", {}, A.mateLabel(S.project, asm, m)), el("span", { class: "note" }, r.mates[m.id].text)))))));
    } else {
      out.push(el("div", { class: "empty-card" }, el("strong", {}, "Сопряжений пока нет"), el("span", { class: "note" }, "Пока деталь ни с чем не связана, её положение задаёте только вы — вручную.")));
    }
    out.push(renderMateForm(asm, comp));

    // 4. Опасное действие — отдельно и внизу
    out.push(button("trash", "Исключить из сборки", () => {
      edit(`Исключить из сборки: ${part.name}`, () => A.removeComponent(asm, comp.id));
      renderProps();
      status(`«${part.name}» исключена из «${asm.name}» вместе со своими сопряжениями; деталь осталась в проекте`);
    }, "Убрать компонент и его сопряжения; деталь остаётся в проекте", { class: "danger" }));
    out.push(el("p", { class: "note" }, "Деталь останется в проекте — пропадёт только её связь со сборкой."));
    return out;
  }

  const MATE_KINDS = [
    { value: "coaxial", thumb: "coaxial", label: "Совместить оси", type: "coaxial", desc: "Оси двух деталей встают на одну линию — как вал, вставленный в отверстие." },
    { value: "contact", thumb: "contact", label: "Грани встык", type: "planar", mode: "contact", desc: "Две плоские грани прижимаются друг к другу — детали стоят торец к торцу." },
    { value: "align", thumb: "align", label: "Грани заподлицо", type: "planar", mode: "align", desc: "Две грани лежат в одной плоскости — торцы деталей вровень." },
    { value: "distance", thumb: "distance", label: "Осевое смещение (зазор)", type: "distance", mode: "contact", desc: "Деталь стоит на заданном расстоянии вдоль оси: с зазором или со смещением." },
  ];
  const ORIENT_OPTIONS = [
    { value: "auto", label: "по граням / как сейчас", desc: "Программа сама выберет направление — так, как детали уже стоят." },
    { value: "same", label: "в одну сторону", desc: "Оси обеих деталей смотрят в одну сторону." },
    { value: "opposite", label: "навстречу", desc: "Оси смотрят навстречу друг другу, как торцы у стыка." },
  ];
  const MODE_OPTIONS = [
    { value: "contact", label: "встык (навстречу)", desc: "Грани смотрят друг на друга и прижаты." },
    { value: "align", label: "заподлицо (в одну сторону)", desc: "Грани смотрят в одну сторону и лежат в одной плоскости." },
  ];

  /** Форма нового сопряжения от компонента comp. */
  function renderMateForm(asm, comp) {
    const others = asm.components.filter((c) => c.id !== comp.id);
    const box = el("div", { class: "mech-mate-form" }, el("div", { class: "mech-steps-head" }, el("strong", {}, "Новое сопряжение")));
    if (!others.length) {
      box.classList.add("is-empty");
      const free = S.project.parts.filter((x) => !A.componentOfPart(S.project, x.id));
      box.append(el("strong", {}, "Не с чем соединять"),
        el("p", { class: "note" }, "Сопряжение связывает две детали, а в сборке пока только эта. Добавьте ещё одну:"));
      if (free.length) {
        box.append(el("div", { class: "quick-add" }, free.map((x) => button("plus", x.name, () => {
          edit(`Включить в сборку: ${x.name}`, (pr) => A.addComponent(pr, A.list(pr).find((a) => a.id === asm.id), x.id, { fixed: false }));
          renderProps();
          const sm = asmSummary(asmById(asm.id));
          status(`«${x.name}» — компонент сборки. ${sm.text}`, sm.kind);
        }, `Включить «${x.name}» в сборку «${asm.name}»`))));
      } else {
        box.append(el("p", { class: "note" }, "Свободных деталей нет: создайте новую на вкладке «Вставка» (Втулка, Вал, Фланец)."));
      }
      return box;
    }
    const me = A.partOf(S.project, asm, comp.id);
    const f = { kind: "coaxial", myRef: null, other: others[0].id, otherRef: null, offset: 5, orient: "auto" };
    const faceOpts = (part) => A.faces(part).map((x) => ({ value: x.id, label: x.label }));
    const body = el("div", {});
    const err = el("div", { class: "mech-err", role: "alert" });
    const draw = () => {
      const kind = MATE_KINDS.find((k) => k.value === f.kind);
      const otherPart = A.partOf(S.project, asm, f.other);
      const nodes = [BS.dom.selectField({ label: "Тип", value: f.kind, options: MATE_KINDS, onChange: (v) => { f.kind = v; draw(); } })];
      nodes.push(BS.dom.selectField({ label: "С компонентом", value: f.other, options: others.map((c) => ({ value: c.id, label: A.partOf(S.project, asm, c.id).name })), onChange: (v) => { f.other = v; f.otherRef = null; draw(); } }));
      if (kind.type === "coaxial") {
        nodes.push(BS.dom.selectField({ label: "Направление осей", value: f.orient, options: ORIENT_OPTIONS, onChange: (v) => { f.orient = v; } }));
      } else {
        const mo = faceOpts(me), oo = faceOpts(otherPart);
        if (!mo.some((o) => o.value === f.myRef)) f.myRef = mo[0] && mo[0].value;
        if (!oo.some((o) => o.value === f.otherRef)) f.otherRef = oo[0] && oo[0].value;
        nodes.push(BS.dom.selectField({ label: `Грань: ${me.name}`, value: f.myRef, options: mo, onChange: (v) => { f.myRef = v; } }));
        nodes.push(BS.dom.selectField({ label: `Грань: ${otherPart.name}`, value: f.otherRef, options: oo, onChange: (v) => { f.otherRef = v; } }));
        if (kind.type === "distance") nodes.push(BS.dom.numberField({ label: "Смещение", unit: "мм", value: f.offset, step: 1, onChange: (v) => { f.offset = v; } }));
      }
      BS.dom.fill(body, nodes);
      err.textContent = "";
    };
    draw();
    const create = button("plus", "Создать сопряжение", () => {
      const kind = MATE_KINDS.find((k) => k.value === f.kind);
      // сторона a — другой компонент (опора), b — этот: смещение откладывается от грани опоры
      const spec = { type: kind.type, mode: kind.mode, orient: f.orient, offset: f.offset, a: { comp: f.other, ref: f.otherRef }, b: { comp: comp.id, ref: f.myRef } };
      try {
        const trial = JSON.parse(JSON.stringify(S.project));
        A.addMate(trial, A.list(trial).find((a) => a.id === asm.id), spec);
      } catch (e) {
        err.textContent = e.message;
        return status(e.message, "error");
      }
      let mate;
      edit("Добавить сопряжение", () => { mate = A.addMate(S.project, asm, spec).mate; });
      renderProps();
      const s = asmSummary(asm);
      status(`Добавлено: ${A.mateLabel(S.project, asm, mate)}. ${s.text}`, s.kind);
    }, "Проверить и добавить сопряжение; противоречивое не добавляется");
    box.append(body, create, err);
    return box;
  }

  /** Свойства выбранного сопряжения. */
  function renderMateProps(asm, m) {
    const r = resultOf(asm);
    const st = r.mates[m.id] || { status: "unsolved", text: "" };
    const sections = [el("h3", {}, A.MATE_TYPES[m.type].label)];
    sections.push(el("div", { class: "mech-asm-status" }, badge(st.status, MATE_STATUS[st.status]), el("span", {}, ` ${asm.name} · ${m.id}`)));
    sections.push(el("p", { class: "note" }, st.text));
    for (const side of [m.a, m.b]) {
      const p = A.partOf(S.project, asm, side.comp);
      sections.push(BS.dom.readonly(p ? p.name : side.comp, A.refLabel(p, side.ref)));
    }
    const err = el("div", { class: "mech-err", role: "alert" });
    /** Изменение сопряжения: пробное решение; конфликт — изменение не применяется. */
    const change = (label, fn) => {
      const trial = JSON.parse(JSON.stringify(S.project));
      const tm = A.list(trial).find((a) => a.id === asm.id).mates.find((x) => x.id === m.id);
      fn(tm);
      const e = A.mateError(trial, A.list(trial).find((a) => a.id === asm.id), tm);
      const tr = e ? null : A.solve(trial, A.list(trial).find((a) => a.id === asm.id));
      const ts = tr && tr.mates[m.id];
      if (e || (ts && (ts.status === "conflict" || ts.status === "broken"))) {
        err.textContent = `Не применено: ${e || ts.text}`;
        status(err.textContent, "error");
        return renderPropsSoon();
      }
      edit(label, () => fn(m));
      renderProps();
      const s = asmSummary(asm);
      status(`${label}. ${s.text}`, s.kind);
    };
    if (m.type === "coaxial") {
      sections.push(BS.dom.selectField({ label: "Направление осей", value: m.orient || "auto", options: ORIENT_OPTIONS, onChange: (v) => change("Направление осей", (x) => { x.orient = v; }) }));
    } else {
      sections.push(BS.dom.selectField({ label: "Грани", value: m.mode, options: MODE_OPTIONS, onChange: (v) => change("Режим граней", (x) => { x.mode = v; }) }));
      if (m.type === "distance") {
        sections.push(BS.dom.numberField({ label: "Осевое смещение", unit: "мм", value: m.offset, step: 1, onChange: (v) => change("Осевое смещение", (x) => { x.offset = v; }) }));
      }
    }
    sections.push(err);
    sections.push(BS.dom.checkField({ label: "Подавить (временно отключить)", value: m.suppressed, onChange: (v) => change(v ? "Подавить сопряжение" : "Включить сопряжение", (x) => { x.suppressed = v; }) }));
    sections.push(button("trash", "Удалить сопряжение", () => {
      edit("Удалить сопряжение", () => { asm.mates = asm.mates.filter((x) => x.id !== m.id); });
      S.selectedMate = null;
      renderAll();
      const s = asmSummary(asm);
      status(`Сопряжение удалено. ${s.text}`, s.kind);
    }));
    const p = A.partOf(S.project, asm, m.b.comp);
    if (p) sections.push(button("part", `К компоненту «${p.name}»`, () => select(p.id)));
    return sections;
  }

  /** Свойства выбранной сборки: итог решения, сообщения, проверка пересечений. */
  function renderAsmProps(asm) {
    const r = resultOf(asm);
    const sections = [el("h3", {}, "Сборка")];
    sections.push(BS.dom.textField({ label: "Название", value: asm.name, onChange: (v) => { if (v && v !== asm.name) { edit("Переименовать сборку", () => { asm.name = v; }); renderAll(); } } }));
    const counts = {};
    for (const c of asm.components) { const s = r.components[c.id].status; counts[s] = (counts[s] || 0) + 1; }
    sections.push(BS.dom.readonly("Компоненты", asm.components.length ? Object.entries(counts).map(([k, v]) => `${A.STATUS_LABEL[k]}: ${v}`).join("; ") : "нет"));
    sections.push(BS.dom.readonly("Сопряжения", String(asm.mates.length)));
    sections.push(el("div", { class: "mech-asm-status" }, badge(r.ok ? "solved" : "conflict", r.ok ? "без ошибок" : "есть ошибки")));
    const items = r.messages.map((x) => el("li", { class: `mech-msg ${x.severity}` }, badge(x.severity === "error" ? "conflict" : x.severity === "warning" ? "partial" : "fixed", x.severity === "error" ? "ошибка" : x.severity === "warning" ? "внимание" : "сведения"), el("span", {}, ` ${x.text}`)));
    if (items.length) sections.push(el("ul", { class: "mech-mate-list" }, items));
    const checked = r.interference.filter((i) => i.checked);
    sections.push(el("p", { class: "note" },
      `Пересечения: проверено пар соосных деталей с перекрывающимися габаритами — ${checked.length}, с общим объёмом — ${checked.filter((i) => i.volume > 0).length}. ` +
      "Касание граней и отсутствие пересечений — это геометрия, а не доказательство работоспособности узла: посадки, прочность и сборка/разборка не проверяются."));
    sections.push(button("trash", "Удалить сборку", () => {
      edit("Удалить сборку", (pr) => { pr.assemblies = pr.assemblies.filter((a) => a.id !== asm.id); });
      S.selectedAsm = null;
      renderAll();
      status(`Сборка «${asm.name}» удалена; детали остались в проекте на своих местах`);
    }, "Удалить сборку и сопряжения; детали остаются"));
    return sections;
  }

  function renderPropsSoon() {
    setTimeout(renderProps, 0);
  }

  /** Узлы сборок в дереве: компоненты и сопряжения со статусами. */
  function renderAsmTree() {
    return A.list(S.project).map((asm) => {
      const r = resultOf(asm);
      const selA = S.selectedAsm === asm.id && !S.selectedMate;
      const comps = asm.components.map((c) => {
        const p = A.partOf(S.project, asm, c.id);
        const st = r.components[c.id];
        return el("li", {}, el("div", { class: p && p.id === S.selectedId ? "row selected" : "row", onclick: () => p && select(p.id), title: st.text },
          badge(st.status, c.fixed ? "закр." : COMP_SHORT[st.status] || st.status), el("span", { class: "mech-name" }, p ? p.name : c.partId)));
      });
      const mts = asm.mates.map((m) => {
        const st = r.mates[m.id] || { status: "unsolved", text: "" };
        return el("li", {}, el("div", { class: S.selectedMate === m.id && S.selectedAsm === asm.id ? "row selected" : "row", onclick: () => selectMate(asm.id, m.id), title: st.text },
          badge(st.status, MATE_STATUS[st.status]), el("span", { class: "mech-name" }, A.mateLabel(S.project, asm, m))));
      });
      return el("li", {},
        el("div", { class: selA ? "row selected" : "row", onclick: () => selectAsm(asm.id), title: r.ok ? "Сборка без ошибок" : "В сборке есть ошибки" },
          badge(r.ok ? "solved" : "conflict", r.ok ? "ок" : "ошибки"), el("span", { class: "mech-name" }, asm.name)),
        el("ul", {},
          el("li", {}, el("div", { class: "row mech-feature" }, el("span", { class: "mech-kind" }, "компон."), el("span", {}, String(asm.components.length)))),
          el("ul", {}, comps),
          el("li", {}, el("div", { class: "row mech-feature" }, el("span", { class: "mech-kind" }, "сопряж."), el("span", {}, String(asm.mates.length)))),
          el("ul", {}, mts)));
    });
  }

  // ================================================================== клавиши

  /** Горячие клавиши режима: через единый менеджер BS.hotkeys (правила ввода текста и диалогов — там). */
  function registerHotkeys() {
    const H = BS.hotkeys;
    if (!H) return;
    const R = (def) => H.register({ group: "mech", ...def });
    const ix = () => S.ix;
    R({ id: "mech.undo", label: "Отменить", keys: ["Ctrl+KeyZ"], run: () => undo() });
    R({ id: "mech.redo", label: "Повторить", keys: ["Ctrl+KeyY", "Ctrl+Shift+KeyZ"], run: () => redo() });
    R({ id: "mech.save", label: "Сохранить проект (*.mech.json)", keys: ["Ctrl+KeyS"], run: () => { IO.download(IO.fileNameFor(S.project, ".mech.json"), IO.serialize(S.project)); status("Проект сохранён (*.mech.json)", "ok"); } });
    R({ id: "mech.duplicate", label: "Дублировать деталь", keys: ["Ctrl+KeyD"], enabled: () => Boolean(selected()), run: () => duplicateSelected() });
    R({ id: "mech.delete", label: "Удалить выбранную деталь", keys: ["Delete"], enabled: () => Boolean(selected()), run: () => removeSelected() });
    R({ id: "mech.escape", label: "Отмена операции / выход из режима / снять выделение", keys: ["Escape"], run: () => { if (ix().cancel()) return true; if (S.selectedId) { select(null); return true; } return false; } });
    R({ id: "mech.confirm", label: "Подтвердить соединение (в режиме «Соединить детали»)", keys: ["Enter"], enabled: () => ix().state().tool === "connect", run: () => ix().confirm() });
    R({ id: "mech.select", label: "Выбрать (без манипулятора)", keys: ["KeyV"], run: () => { ix().setTool("select"); ix().setGizmo("select"); } });
    R({ id: "mech.move", label: "Переместить: стрелки по осям (или тяните деталь)", keys: ["KeyG"], run: () => { ix().setTool("select"); ix().setGizmo("move"); } });
    R({ id: "mech.rotate", label: "Повернуть: дуги вокруг осей", keys: ["KeyR"], run: () => { ix().setTool("select"); ix().setGizmo("rotate"); } });
    R({ id: "mech.connect", label: "Соединить детали (выбрать две поверхности)", keys: ["KeyJ"], run: () => ix().connect() });
    R({ id: "mech.fix", label: "Закрепить на месте / снять закрепление", keys: ["KeyK"], enabled: () => Boolean(selected()), run: () => toggleFixed() });
    R({ id: "mech.snap", label: "Привязки: включить / выключить", keys: ["KeyX"], run: () => ix().toggleSnap() });
    R({ id: "mech.fit", label: "Показать всё в кадре", keys: ["KeyF"], run: () => fitView() });
    R({ id: "mech.view.top", label: "Вид сверху", keys: ["Numpad7", "Digit7"], run: () => setView("top") });
    R({ id: "mech.view.front", label: "Вид спереди", keys: ["Numpad1", "Digit1"], run: () => setView("front") });
    R({ id: "mech.view.iso", label: "Изометрический вид", keys: ["Numpad0", "Digit0"], run: () => setView("iso") });
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
    if (BS.mechViewer) {
      S.view = BS.mechViewer.create({
        getProject: () => S.project, getMeshes: () => S.meshes, gl: () => S.gl, viewport, selectedId: () => S.selectedId,
        status, fitView, previewActive: () => Boolean(S.preview), refreshTree: () => renderTree(), resync: () => syncMeshes(),
        openProject: (pr, label) => { S.history.push(S.project, label); setProject(pr, { fit: true }); IO.autosave(S.project); },
      });
    }
    setProject(project, { fit: true });
    status(note, "ok");
    registerHotkeys();
    BS.events.on("layout", resize);
    BS.events.on("mode", (m) => { if (m === "mech") { resize(); applyTheme(); } });
  }

  BS.mechApp = {
    mount,
    resize,
    isMounted: () => S.mounted,
    /** Для отладки и тестов в браузере. */
    getProject: () => S.project,
    getSolved: () => S.solved,
    getGL: () => S.gl,
    getInteract: () => S.ix,
    getViewer: () => S.view,
    fitView,
    startLesson,
    coachContext,
  };
})(globalThis.BuildSense);
