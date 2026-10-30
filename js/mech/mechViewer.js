// BuildSense · Машиностроение — режим просмотра: «Взрывной вид», «Симуляция» (кинематика), «Разрез» (визуальное
// отсечение плоскостью), скрытие деталей, «Восстановить сборку» и галерея демонстрационных проектов.
//
// Всё, что делает этот модуль, — ВРЕМЕННЫЕ преобразования показа: матрицы сеток, видимость, плоскость отсечения.
// Проект (положения, сопряжения, размеры) не меняется, в сохранение и экспорт ничего из этого не попадает.
// BS.mechViewer.create(api) → { frame(now), apply(), lock(part), acceptHit(hit), isHidden(id), toggleHidden(id), openGallery() }
//   api = { getProject, getMeshes, gl, viewport, selectedId, status, fitView, openProject, previewActive }
(function (BS) {
  "use strict";
  const T = globalThis.THREE;
  const M = BS.mechModel;
  const G = BS.mechGeometry;
  const K = BS.mechKinematics;
  const E = BS.mechExplode;
  const D = BS.mechDemos;
  const STASH_KEY = "buildsense.mech.stash.v1";
  const el = (...a) => BS.dom.el(...a);
  const svg = (n) => (BS.icons && (!BS.icons.has || BS.icons.has(n)) ? BS.icons.svg(n) : "");

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* не критично */ } },
  };

  function poseMatrix(p) {
    const R = p.R, t = p.t;
    return new T.Matrix4().set(R[0][0], R[0][1], R[0][2], t[0], R[1][0], R[1][1], R[1][2], t[1], R[2][0], R[2][1], R[2][2], t[2], 0, 0, 0, 1);
  }

  function create(api) {
    const V = {
      mode: "edit", // edit | explode | sim
      explode: null, explodeKey: null, tween: E.createTween({ duration: 1100 }), amount: 1,
      sim: K.createSimulation({ rpm: 30 }), mechId: null, mechCheck: null, simText: "", lastText: 0,
      section: { on: false, axis: "y", pos: 0.5, flip: false, plane: new T.Plane(new T.Vector3(0, -1, 0), 0) },
      hidden: new Set(),
      caps: new Map(), // id → BackSide-сетка «заливки» разреза
      dom: {},
    };

    // ---------------------------------------------------------------- состояние

    const project = () => api.getProject();
    const mechs = () => (Array.isArray(project().mechanisms) ? project().mechanisms : []);
    const mech = () => mechs().find((m) => m.id === V.mechId) || mechs()[0] || null;
    const now = () => performance.now();
    const exploding = () => V.tween.target > 0 || V.tween.value(now()) > 1e-4;
    const simActive = () => V.sim.state !== "stopped";

    function explodeData() {
      const key = JSON.stringify(project().parts.map((p) => [p.id, p.placement, p.params]));
      if (key !== V.explodeKey) { V.explode = E.computeExplode(project()); V.explodeKey = key; }
      return V.explode;
    }

    // ---------------------------------------------------------------- применение к сеткам

    function apply() {
      const meshes = api.getMeshes();
      if (!meshes) return;
      const pr = project();
      const preview = api.previewActive();
      const k = preview ? 0 : V.tween.value(now()) * V.amount;
      const ex = k > 1e-6 ? explodeData() : null;
      let sim = null;
      if (!preview && simActive() && mech()) {
        V.mechCheck = V.mechCheck || K.check(pr, mech());
        if (V.mechCheck.ok) {
          sim = K.poseAt(pr, mech(), V.sim.phase, V.mechCheck);
          if (sim.ok) V.simText = sim.text;
        }
      }
      for (const part of pr.parts) {
        const rec = meshes.get(part.id);
        if (!rec) continue;
        rec.mesh.visible = !V.hidden.has(part.id);
        if (preview) continue; // идёт предпросмотр соединения — показ не трогаем
        const ps = sim && sim.ok && sim.poses.get(part.id);
        // без смещений — ровно исходное положение (не остаток последнего кадра анимации)
        const m = ps ? poseMatrix(ps) : G.partMatrix(part);
        const off = ex && ex.offsets.get(part.id);
        if (off) m.premultiply(new T.Matrix4().makeTranslation(off[0] * k, off[1] * k, off[2] * k));
        rec.mesh.matrix.copy(m);
        rec.mesh.matrixWorldNeedsUpdate = true;
      }
      const sel = api.selectedId();
      const rec = sel && meshes.get(sel);
      const gl = api.gl();
      if (rec && (ex || sim)) { rec.mesh.updateMatrixWorld(true); gl.selBox.box.setFromObject(rec.mesh); }
      if (rec && V.hidden.has(sel)) gl.selBox.visible = false;
      applySection();
    }

    function frame(t) {
      const moving = !V.tween.isDone(t) || V.sim.state === "running";
      if (V.sim.state === "running") V.sim.tick(t);
      // последний кадр после окончания анимации тоже применяется — иначе детали «застревают» на 80–90 % хода
      if (moving || V.wasMoving) apply();
      else if (V.section.on) sectionPlane(); // камеру повернули — срез снова к зрителю (плоскость общая для всех материалов)
      V.wasMoving = moving;
      if (V.mode === "sim" && t - V.lastText > 120) { V.lastText = t; renderSimState(); }
    }

    // ---------------------------------------------------------------- разрез (визуальное отсечение)

    function sectionPlane() {
      const s = V.section, meshes = api.getMeshes();
      const box = new T.Box3();
      for (const r of meshes.values()) if (r.mesh.visible) box.expandByObject(r.mesh);
      if (box.isEmpty()) box.set(new T.Vector3(-1, -1, -1), new T.Vector3(1, 1, 1));
      const i = { x: 0, y: 1, z: 2 }[s.axis];
      const lo = box.min.getComponent(i), hi = box.max.getComponent(i);
      const c = lo + (hi - lo) * s.pos;
      // отсекается половина со стороны камеры — срез обращён к зрителю; «Другая сторона» — наоборот
      const cam = api.gl().camera.position.getComponent(i);
      let sign = cam > c ? -1 : 1;
      if (s.flip) sign = -sign;
      const n = new T.Vector3(); n.setComponent(i, sign);
      s.plane.set(n, -sign * c); // видна часть, где n·p + d ≥ 0
      return { lo, hi, c };
    }

    function applySection() {
      const meshes = api.getMeshes();
      const gl = api.gl();
      gl.renderer.localClippingEnabled = V.section.on;
      const planes = V.section.on ? [V.section.plane] : [];
      if (V.section.on) sectionPlane();
      for (const [id, rec] of meshes) {
        for (const mat of [rec.mesh.material, rec.edges.material]) {
          const was = (mat.clippingPlanes || []).length;
          mat.clippingPlanes = planes;
          if (was !== planes.length) mat.needsUpdate = true; // шейдер пересобирается только при включении/выключении
        }
        let cap = V.caps.get(id);
        if (V.section.on && (!cap || cap.geometry !== rec.mesh.geometry)) {
          if (cap) { cap.parent && cap.parent.remove(cap); cap.material.dispose(); }
          // внутренние (обратные) грани заливаются цветом — так видно «срез» стенок; это не геометрия сечения
          cap = new T.Mesh(rec.mesh.geometry, new T.MeshBasicMaterial({ color: 0xd9534f, side: T.BackSide, clippingPlanes: planes }));
          cap.raycast = () => {};
          rec.mesh.add(cap);
          V.caps.set(id, cap);
        }
        if (cap) { cap.visible = V.section.on; cap.material.clippingPlanes = planes; }
      }
      for (const [id, cap] of V.caps) if (!meshes.has(id)) { cap.material.dispose(); V.caps.delete(id); }
    }

    /** Попадание луча в отсечённую часть детали не считается выбором. */
    function acceptHit(hit) {
      if (!hit.object.visible) return false;
      return !V.section.on || V.section.plane.distanceToPoint(hit.point) >= -1e-6;
    }

    // ---------------------------------------------------------------- режимы

    function setMode(mode) {
      if (mode !== "sim" && simActive()) V.sim.stop();
      if (mode !== "explode" && V.tween.target > 0) V.tween.to(0, now());
      V.mode = mode;
      if (mode === "explode") V.tween.to(1, now());
      if (mode === "sim") {
        V.mechCheck = mech() ? K.check(project(), mech()) : null;
      }
      apply();
      render();
    }

    /** «Редактировать»: собрать обратно, остановить симуляцию; разрез и скрытые детали остаются. */
    function toEdit() {
      setMode("edit");
      api.status("Режим редактирования: детали на своих местах, их можно двигать и менять");
    }

    /** «Восстановить сборку»: всё временное убрать — разборку, симуляцию, разрез, скрытие; камеру — на модель. */
    function restore() {
      V.sim.stop();
      V.tween.to(0, now());
      V.section.on = false;
      V.hidden.clear();
      V.mode = "edit";
      apply();
      render();
      api.refreshTree();
      setTimeout(() => api.fitView(), 0);
      api.status("Сборка восстановлена: детали на исходных местах, разрез выключен, скрытые детали показаны", "ok");
    }

    function lock(part) {
      if (exploding()) return "Включён «Взрывной вид»: детали показаны раздвинутыми. Нажмите «Редактировать», чтобы двигать детали";
      if (simActive()) return "Идёт симуляция: детали показаны в движении. Нажмите «Стоп» или «Редактировать», чтобы двигать детали";
      const driven = K.drivenParts(project());
      if (driven.has(part.id)) return `«${part.name}»: положение задаёт механизм «${driven.get(part.id)}» — оно выводится из положения коленвала`;
      return null;
    }

    function toggleHidden(id) {
      if (V.hidden.has(id)) V.hidden.delete(id); else V.hidden.add(id);
      apply();
      api.refreshTree();
      const p = project().parts.find((x) => x.id === id);
      api.status(`${p ? p.name : id}: ${V.hidden.has(id) ? "скрыта (только на экране — в проекте и экспорте деталь остаётся)" : "показана"}`);
    }

    // ---------------------------------------------------------------- панель в 3D-окне

    function btn(icon, text, onclick, title, cls = "") {
      const b = el("button", { type: "button", class: cls, title: title || text, onclick });
      if (icon) b.insertAdjacentHTML("afterbegin", svg(icon));
      b.append(el("span", {}, text));
      return b;
    }

    function render() {
      const d = V.dom;
      const on = (m) => (V.mode === m ? "on" : "");
      BS.dom.fill(d.bar,
        btn("cursor", "Редактировать", toEdit, "Вернуться к редактированию: детали на своих местах", on("edit")),
        btn("play", "Симуляция", () => setMode("sim"), "Кинематика механизма: запуск, пауза, скорость", on("sim")),
        btn("split", "Взрывной вид", () => (V.mode === "explode" ? toEdit() : setMode("explode")), "Плавно раздвинуть детали, чтобы рассмотреть устройство", `${on("explode")} accent`),
        btn("clean", "Разрез", () => { V.section.on = !V.section.on; apply(); render(); }, "Посмотреть внутрь: отсечь модель плоскостью (только показ)", V.section.on ? "on" : ""),
        btn("reset", "Восстановить сборку", restore, "Собрать, остановить симуляцию, убрать разрез, показать скрытые детали, камеру — на модель"),
        el("span", { class: "mv-sep" }),
        btn("file", "Демо-проекты", openGallery, "Галерея: вал на опорах, двигатель, домкрат", "primary"));
      const parts = [];
      if (V.mode === "explode") parts.push(renderExplodePanel());
      if (V.mode === "sim") parts.push(renderSimPanel());
      if (V.section.on) parts.push(renderSectionPanel());
      BS.dom.fill(d.panel, parts);
      d.panel.hidden = !parts.length;
    }

    function slider({ label, min, max, step, value, onInput, unit = "" }) {
      const out = el("output", {}, `${value}${unit}`);
      const inp = el("input", { type: "range", min, max, step, value, "aria-label": label });
      inp.addEventListener("input", () => { out.textContent = `${inp.value}${unit}`; onInput(Number(inp.value)); });
      return el("label", { class: "mv-slider" }, el("span", {}, label), inp, out);
    }

    function renderExplodePanel() {
      const paused = V.tween.paused;
      return el("div", { class: "mv-row" },
        el("strong", {}, "Взрывной вид"),
        slider({ label: "Степень", min: 0, max: 150, step: 5, value: Math.round(V.amount * 100), unit: " %", onInput: (v) => { V.amount = v / 100; apply(); } }),
        btn(paused ? "play" : "pause", paused ? "Продолжить" : "Пауза", () => { if (V.tween.paused) V.tween.resume(now()); else V.tween.pause(now()); render(); }, "Остановить / продолжить движение деталей"),
        btn("back", "Собрать", () => { V.tween.to(0, now()); }, "Плавно вернуть детали на места"),
        btn("split", "Разобрать", () => { V.tween.to(1, now()); }, "Плавно раздвинуть детали"),
        el("span", { class: "note" }, "Только показ: координаты деталей и сопряжения не меняются."));
    }

    function renderSimPanel() {
      const m = mech();
      if (!m) {
        return el("div", { class: "mv-row" }, el("strong", {}, "Симуляция"),
          el("span", { class: "note" }, "В этом проекте нет механизма. Откройте «Демо-проекты» → «Одноцилиндровый двигатель» или «Винтовой домкрат»."));
      }
      const c = V.mechCheck || (V.mechCheck = K.check(project(), m));
      const head = [el("strong", {}, "Симуляция"), mechs().length > 1
        ? BS.dom.selectField({ label: "Механизм", value: m.id, options: mechs().map((x) => ({ value: x.id, label: x.name })), onChange: (v) => { V.sim.stop(); V.mechId = v; V.mechCheck = null; apply(); render(); } })
        : el("span", { class: "mv-chip" }, m.name)];
      if (!c.ok) {
        return el("div", { class: "mv-col" }, el("div", { class: "mv-row" }, ...head),
          el("div", { class: "mv-err" }, `Механизм не может двигаться: ${c.errors.join("; ")}. Исправьте размеры или положение деталей — анимация не запускается.`));
      }
      const st = V.sim.state;
      const play = st === "running"
        ? btn("pause", "Пауза", () => { V.sim.pause(now()); render(); }, "Пауза", "on")
        : btn("play", st === "paused" ? "Продолжить" : "Пуск", () => { if (st === "paused") V.sim.resume(now()); else { V.mechCheck = K.check(project(), m); V.sim.start(now()); } render(); }, "Запустить движение", "primary");
      V.dom.simState = el("span", { class: "mv-state" }, V.simText || "Исходное положение (угол 0°)");
      return el("div", { class: "mv-col" },
        el("div", { class: "mv-row" }, ...head, play,
          btn("reset", "Стоп", () => { V.sim.stop(); V.simText = ""; api.resync(); render(); }, "Остановить и вернуть в исходное положение"),
          slider({ label: m.type === "screw" ? "Скорость, об/мин винта" : "Скорость, об/мин", min: 2, max: 240, step: 1, value: Math.round(V.sim.rpm), onInput: (v) => V.sim.setSpeed(v, now()) })),
        el("div", { class: "mv-row" }, el("span", { class: `mv-badge ${st}` }, st === "running" ? "идёт" : st === "paused" ? "пауза" : "остановлено"), V.dom.simState),
        c.warnings.length ? el("div", { class: "mv-err" }, `Внимание: ${c.warnings.join("; ")}.`) : null,
        el("details", { class: "mv-more" }, el("summary", {}, "Как считается (кинематика, а не физика)"),
          el("div", { class: "note" }, `${m.type === "screw" ? "Подъём s = P·φ/2π" : "Поршень: x(θ) = r·cos θ + √(l² − (e − r·sin θ)²)"}. Силы, масса, трение и инерция не считаются. ${c.notes.join("; ")}.`)));
    }

    function renderSimState() {
      if (V.dom.simState) V.dom.simState.textContent = V.simText || "Исходное положение (угол 0°)";
    }

    function renderSectionPanel() {
      const s = V.section;
      return el("div", { class: "mv-row" },
        el("strong", {}, "Разрез"),
        BS.dom.selectField({ label: "Плоскость ⟂", value: s.axis, options: [{ value: "x", label: "оси X" }, { value: "y", label: "оси Y" }, { value: "z", label: "оси Z" }], onChange: (v) => { s.axis = v; apply(); } }),
        slider({ label: "Положение", min: 0, max: 100, step: 1, value: Math.round(s.pos * 100), unit: " %", onInput: (v) => { s.pos = v / 100; apply(); } }),
        BS.dom.checkField({ label: "Другая сторона", value: s.flip, onChange: (v) => { s.flip = v; apply(); } }),
        el("span", { class: "note" }, "Визуальное отсечение при показе (clipping), не CAD-операция: детали и экспорт не меняются. Красным залиты внутренние стенки."));
    }

    // ---------------------------------------------------------------- галерея

    let previews = null;
    function renderPreviews() {
      if (previews) return previews;
      previews = new Map();
      let r;
      try {
        r = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
      } catch { return previews; }
      r.setSize(360, 220, false);
      for (const d of D.DEMOS) {
        const pr = d.create();
        const scene = new T.Scene();
        scene.add(new T.HemisphereLight(0xffffff, 0x445566, 0.8));
        const key = new T.DirectionalLight(0xffffff, 0.9); key.position.set(300, -400, 600); scene.add(key);
        const box = new T.Box3();
        const geos = [];
        for (const p of pr.parts) {
          const g = G.buildPartGeometry(p, 64);
          geos.push(g);
          const mesh = new T.Mesh(g, new T.MeshStandardMaterial({ color: (M.MATERIALS[p.material] || M.MATERIALS.steel).color, metalness: 0.3, roughness: 0.5 }));
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(G.partMatrix(p));
          mesh.updateMatrixWorld(true);
          scene.add(mesh);
          box.expandByObject(mesh);
        }
        const cam = new T.PerspectiveCamera(35, 360 / 220, 1, 50000);
        cam.up.set(0, 0, 1);
        const c = box.getCenter(new T.Vector3()), rad = box.getSize(new T.Vector3()).length() / 2;
        cam.position.copy(c).addScaledVector(new T.Vector3(0.55, -0.7, 0.45).normalize(), rad / Math.sin((35 * Math.PI) / 360) * 1.05);
        cam.lookAt(c);
        r.render(scene, cam);
        previews.set(d.id, r.domElement.toDataURL("image/png"));
        for (const g of geos) g.dispose();
        scene.traverse((o) => o.material && o.material.dispose());
      }
      r.dispose();
      if (r.forceContextLoss) r.forceContextLoss();
      return previews;
    }

    function stash() {
      const txt = store.get(STASH_KEY);
      if (!txt) return null;
      try { return JSON.parse(txt); } catch { return null; }
    }

    function openDemo(id, close) {
      const cur = project();
      // текущий проект пользователя не пропадает: откладывается (а также остаётся в «Отменить»)
      if (!cur.demo && cur.parts.length) {
        store.set(STASH_KEY, JSON.stringify({ name: cur.name, at: new Date().toISOString(), text: BS.mechIO.serialize(cur) }));
      }
      V.sim.stop(); V.tween.set(0); V.section.on = false; V.hidden.clear(); V.mode = "edit"; V.mechId = null; V.mechCheck = null;
      const d = D.DEMOS.find((x) => x.id === id);
      api.openProject(D.create(id), `Демо: ${d.title}`);
      render();
      close();
      api.status(`Открыт демонстрационный проект «${d.title}» — это новая копия: детали, сборка и механизм настоящие, их можно менять. ${!cur.demo && cur.parts.length ? `Ваш проект «${cur.name}» отложен — вернуть его можно в «Демо-проекты».` : ""}`, "ok");
    }

    function restoreStash(close) {
      const s = stash();
      if (!s) return;
      let res;
      try { res = BS.mechIO.parse(s.text); } catch (e) { api.status(`Не удалось вернуть проект: ${e.message}`, "error"); return; }
      BS.mechIO.dropInvalidParts(res);
      V.sim.stop(); V.tween.set(0); V.mode = "edit"; V.mechId = null; V.mechCheck = null;
      api.openProject(res.project, `Вернуть проект «${s.name}»`);
      store.del(STASH_KEY);
      render();
      close();
      api.status(`Возвращён ваш проект «${s.name}»`, "ok");
    }

    function openGallery() {
      const imgs = renderPreviews();
      const close = () => { dlg.remove(); document.removeEventListener("keydown", onKey); };
      const onKey = (e) => { if (e.key === "Escape") close(); };
      const cards = D.DEMOS.map((d) => el("article", { class: "mv-card" },
        imgs.get(d.id) ? el("img", { src: imgs.get(d.id), alt: `Превью: ${d.title}` }) : el("div", { class: "mv-noimg" }, "превью недоступно"),
        el("div", { class: "mv-card-body" },
          el("strong", {}, d.title),
          el("p", {}, d.desc),
          el("ul", {}, d.features.map((f) => el("li", {}, f))),
          el("div", { class: "mv-card-actions" },
            btn("open", project().demo === d.id ? "Открыть заново (исходный вид)" : "Открыть", () => openDemo(d.id, close), "Создать новую копию демонстрационного проекта", "primary")))));
      const s = stash();
      const back = s ? el("div", { class: "mv-stash" },
        el("span", {}, `Ваш проект «${s.name}» отложен при открытии демо.`),
        btn("back", "Вернуть мой проект", () => restoreStash(close), "Открыть отложенный проект")) : null;
      const dlg = el("div", { class: "drawing-dialog mv-gallery", role: "dialog", "aria-label": "Демонстрационные проекты" },
        el("div", { class: "drawing-box" },
          el("div", { class: "drawing-head" },
            el("strong", {}, "Демонстрационные проекты"),
            el("span", { class: "drawing-note" }, "Учебные модели из настоящих параметрических деталей. Не сертифицированные конструкции и не производственные чертежи."),
            btn(null, "Закрыть", close, "Закрыть (Esc)")),
          back,
          el("div", { class: "mv-cards" }, cards)));
      dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
      document.addEventListener("keydown", onKey);
      document.body.append(dlg);
    }

    // ---------------------------------------------------------------- монтирование

    V.dom.root = el("div", { class: "mv-root" });
    V.dom.bar = el("div", { class: "mv-bar", role: "toolbar", "aria-label": "Просмотр сборки" });
    V.dom.panel = el("div", { class: "mv-panel" });
    V.dom.root.append(V.dom.bar, V.dom.panel);
    api.viewport.append(V.dom.root);
    render();

    return {
      frame, apply, lock, acceptHit, toggleHidden, openGallery, restore,
      isHidden: (id) => V.hidden.has(id),
      /** Проект сменился (открыт другой файл, отмена): временное состояние сбрасывается. */
      reset() { V.sim.stop(); V.tween.set(0); V.mode = "edit"; V.mechId = null; V.mechCheck = null; V.hidden.clear(); render(); },
      /** Размеры или сборка изменились: перепроверить механизм. */
      changed() { V.mechCheck = null; if (V.mode === "sim") render(); },
      state: () => ({ mode: V.mode, explode: V.tween.value(now()) * V.amount, sim: V.sim.state, phase: V.sim.phase, section: V.section.on, hidden: [...V.hidden] }),
      _V: V,
    };
  }

  BS.mechViewer = { create, STASH_KEY };
})(globalThis.BuildSense);
