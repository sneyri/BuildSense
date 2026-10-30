// BuildSense · Машиностроение — визуальное обучение: подсветка нужного места на экране, стрелка, пояснение и проверка,
// что человек действительно сделал шаг. Под капотом — обычные функции приложения, поэтому после обучения остаётся
// настоящий проект, а не картинка.
//
//   BS.mechCoach.dataContext(getProject, mutate, hooks) — операции над проектом для уроков (работают и без интерфейса: тесты)
//   BS.mechCoach.Runner                                  — ход урока без DOM: шаги, проверка done(), «сделать за меня»
//   BS.mechCoach.start(lessonId, uiCtx)                  — запустить урок с подсветкой на экране
//
// Шаг урока: { id, title, text:[…], target?(c) → Element | {x,y,w,h} | null, items?(c) → [{ text, done }],
//              done?(c) → bool, auto?(c), autoLabel?, info? (шаг без проверки: кнопка «Далее» сразу) }
// c — контекст: данные проекта (dataContext) + интерфейс (c.ui.* — только в браузере).
(function (BS) {
  "use strict";
  const M = BS.mechModel;
  const A = BS.mechAssembly;
  const C = BS.mechConnect;
  const plain = (v) => JSON.parse(JSON.stringify(v));

  // ================================================================== операции над проектом (общие для интерфейса и тестов)

  /**
   * getProject() → текущий проект; mutate(label, fn(project)) — выполняет изменение с историей и пересчётом
   * (в приложении — edit(), в тестах — прямой вызов). hooks.addPart(type) — «настоящее» добавление детали из интерфейса.
   */
  function dataContext(getProject, mutate, hooks = {}) {
    const P = getProject;
    const byId = (id) => P().parts.find((p) => p.id === id) || null;
    const ofType = (t) => P().parts.filter((p) => p.type === t);
    const ctx = {
      project: P,
      part: byId,
      parts: (t) => (t ? ofType(t) : P().parts.slice()),
      /** Деталь по роли в уроке: n-я деталь типа type (по порядку создания). */
      nth: (type, n = 0) => ofType(type)[n] || null,
      addPart(type) {
        if (hooks.addPart) return hooks.addPart(type);
        let part;
        mutate(`Добавить: ${M.TYPES[type].label}`, (pr) => {
          part = M.createPart(pr, type);
          const right = pr.parts.reduce((m, p) => Math.max(m, M.worldBounds(p).max[0]), -Infinity);
          if (Number.isFinite(right)) part.placement.x = right + 20;
          pr.parts.push(part);
        });
        return part;
      },
      /** Задать параметры (частично): ctx.setParams(id, { D: 66, d: 50 }). Недопустимое значение — ошибка, проект не меняется. */
      setParams(id, patch) {
        const part = byId(id);
        if (!part) throw new Error("Деталь не найдена");
        const cand = plain(part.params);
        Object.assign(cand, plain(patch));
        const errs = M.validateParams(part.type, cand);
        if (errs.length) throw new Error(errs[0].message);
        mutate(`Размеры: ${part.name}`, (pr) => { pr.parts.find((p) => p.id === id).params = cand; });
        return true;
      },
      place(id, placement) {
        mutate("Положение детали", (pr) => { const p = pr.parts.find((x) => x.id === id); p.placement = { ...plain(p.placement), ...plain(placement), rotation: { ...plain(p.placement.rotation), ...(placement.rotation ? plain(placement.rotation) : {}) } }; });
      },
      rename(id, name) { mutate("Название детали", (pr) => { pr.parts.find((p) => p.id === id).name = name; }); },
      isFixed(id) { const cp = A.componentOfPart(P(), id); return Boolean(cp && cp.comp.fixed); },
      ensureFixed(id) {
        if (ctx.isFixed(id)) return true;
        mutate("Закрепить на месте", (pr) => {
          const cp = A.componentOfPart(pr, id);
          if (cp) cp.comp.fixed = true; else C.toggleFixed(pr, id);
          A.solveAll(pr);
        });
        return true;
      },
      /** Соединить поверхности (то же, что кнопка «Применить»). sel — результат C.classifyHit. */
      connect(selA, selB, choice, opts) {
        const trial = C.plan(P(), selA, selB, choice, opts);
        if (!trial.ok) throw new Error(trial.error);
        let res;
        mutate(`Соединить: ${selA.partId} ↔ ${selB.partId}`, (pr) => { res = C.apply(pr, selA, selB, choice, opts); });
        return res;
      },
      /** Есть ли сопряжение данного типа между двумя деталями. */
      hasMate(aId, bId, type) {
        return A.list(P()).some((asm) => asm.mates.some((m) => {
          const pa = (asm.components.find((c) => c.id === m.a.comp) || {}).partId, pb = (asm.components.find((c) => c.id === m.b.comp) || {}).partId;
          return (type ? m.type === type : true) && ((pa === aId && pb === bId) || (pa === bId && pb === aId));
        }));
      },
      mechanisms() { return Array.isArray(P().mechanisms) ? P().mechanisms : []; },
      createMechanism(type) {
        const trial = plain(P());
        const t = BS.mechMechanism.create(trial, type);
        if (!t.ok) throw new Error(t.error);
        let res;
        mutate(`Механизм: ${BS.mechMechanism.LABEL[type]}`, (pr) => { res = BS.mechMechanism.create(pr, type); });
        return res;
      },
      newProject() { if (hooks.newProject) hooks.newProject(); else mutate("Новый проект", (pr) => { pr.parts.length = 0; pr.assemblies = []; pr.mechanisms = []; }); },
      /** Типовые поверхности для кликов уроков (по реальной геометрии детали). */
      surface(id, spec) {
        const part = byId(id);
        if (!part) throw new Error("Деталь не найдена");
        const faces = A.faces(part);
        if (spec.kind === "plane") {
          const f = faces.find((x) => x.id === spec.ref);
          if (!f) throw new Error(`У «${part.name}» нет грани «${spec.ref}»`);
          const r = f.rIn != null && f.rOut != null ? (f.rIn + f.rOut) / 2 : 5;
          return C.classifyHit(part, [r, 0, f.z], [0, 0, f.n]);
        }
        const ev = M.evaluate(part);
        const sketch = ev.features.find((x) => x.kind === "sketch").profile;
        const radii = sketch.map((q) => q[0]).filter((r) => r > 0);
        const r = spec.outer === false ? Math.min(...radii) : Math.max(...radii);
        const zs = sketch.filter((q) => Math.abs(q[0] - r) < 1e-9).map((q) => q[1]);
        return C.classifyHit(part, [r, 0, (Math.min(...zs) + Math.max(...zs)) / 2], [spec.outer === false ? -1 : 1, 0, 0]);
      },
    };
    return ctx;
  }

  // ================================================================== ход урока (без DOM)

  class Runner {
    constructor(lesson, ctx) {
      this.lesson = lesson;
      this.ctx = ctx;
      this.index = 0;
      this.log = [];
    }
    get step() { return this.lesson.steps[this.index]; }
    get count() { return this.lesson.steps.length; }
    isDone() {
      const s = this.step;
      if (!s) return true;
      if (s.info || !s.done) return true;
      try { return Boolean(s.done(this.ctx)); } catch { return false; }
    }
    items() { const s = this.step; return s && s.items ? s.items(this.ctx) : null; }
    /** «Сделать за меня»: выполнить действие шага. Возвращает { ok, error }. */
    auto() {
      const s = this.step;
      if (!s || !s.auto) return { ok: false, error: "Для этого шага нет автоматического действия" };
      try { s.auto(this.ctx); this.log.push(`auto:${s.id}`); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
    }
    next() { if (this.index < this.count) this.index++; return this.index >= this.count; }
    prev() { if (this.index > 0) this.index--; }
    finished() { return this.index >= this.count; }
  }

  // ================================================================== экран

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const rich = (parent, text) => {
    const re = /(\*\*[^*]+\*\*)/g;
    let last = 0, m;
    while ((m = re.exec(text))) { if (m.index > last) parent.append(text.slice(last, m.index)); parent.append(el("strong", "", m[0].slice(2, -2))); last = m.index + m[0].length; }
    if (last < text.length) parent.append(text.slice(last));
    return parent;
  };

  const UI = { root: null, runner: null, raf: 0, advanceTimer: 0, offEvents: [], lastKey: "" };

  function rectOf(t) {
    if (!t) return null;
    if (typeof t.getBoundingClientRect === "function") {
      const r = t.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    return t;
  }

  function stop(msg) {
    cancelAnimationFrame(UI.raf);
    clearTimeout(UI.advanceTimer);
    for (const off of UI.offEvents) off();
    UI.offEvents = [];
    if (UI.root) UI.root.remove();
    UI.root = null;
    UI.runner = null;
    if (msg && UI.status) UI.status(msg, "ok");
  }

  function build() {
    const root = el("div", "coach");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Визуальное обучение");
    root.innerHTML = '<div class="coach-spot"></div><svg class="coach-arrow" width="100%" height="100%"><defs><marker id="coach-head" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0 L9 4 L0 8 z"/></marker></defs><path d="" marker-end="url(#coach-head)"/></svg><div class="coach-card"></div>';
    document.body.append(root);
    return root;
  }

  function renderCard() {
    const R = UI.runner, root = UI.root;
    const card = root.querySelector(".coach-card");
    const s = R.step;
    if (!s) return;
    card.replaceChildren();
    const head = el("div", "coach-head");
    head.append(el("span", "coach-count", `${R.lesson.title} · шаг ${R.index + 1} из ${R.count}`));
    const x = el("button", "ghost coach-x", "×"); x.type = "button"; x.title = "Выйти из обучения (проект останется)"; x.addEventListener("click", () => stop("Обучение закрыто. Проект остался — можно продолжить самому."));
    head.append(x);
    const bar = el("div", "coach-bar");
    const fill = el("i"); fill.style.width = `${Math.round((R.index / R.count) * 100)}%`; bar.append(fill);
    card.append(head, bar, el("h3", "", s.title));
    const done = R.isDone() && !s.info && s.done;
    for (const t of s.text) { card.append(rich(el("p"), typeof t === "function" ? t(R.ctx) : t)); }
    const items = R.items();
    if (items) {
      const ul = el("ul", "coach-items");
      for (const it of items) { const li = el("li", it.done ? "ok" : ""); li.textContent = it.text; ul.append(li); }
      card.append(ul);
    }
    if (done) card.append(el("div", "coach-ok", "Готово! Идём дальше…"));
    else if (s.target && UI.noTarget) card.append(el("div", "coach-note", "Подсветки нет: нужное место сейчас не видно. Поверните сцену (левая кнопка мыши) или откройте нужную вкладку ленты."));
    const actions = el("div", "coach-actions");
    const back = el("button", "", "← Назад"); back.type = "button"; back.disabled = R.index === 0; back.addEventListener("click", () => { clearTimeout(UI.advanceTimer); R.prev(); sync(true); });
    actions.append(back);
    if (s.auto) {
      const a = el("button", "", s.autoLabel || "Сделать за меня"); a.type = "button"; a.title = "Программа выполнит этот шаг сама — вы увидите результат на экране";
      a.addEventListener("click", () => {
        const r = R.auto();
        if (!r.ok) { if (UI.status) UI.status(r.error, "warn"); showError(r.error); return; }
        sync(true);
      });
      actions.append(a);
    }
    const next = el("button", s.info || done ? "primary" : "", s.info ? (R.index === R.count - 1 ? "Закончить" : "Начать →") : done ? "Далее →" : "Пропустить →");
    next.type = "button";
    next.addEventListener("click", () => advance());
    actions.append(next);
    card.append(actions);
    if (UI.error) card.append(el("div", "coach-err", UI.error));
  }

  function showError(msg) { UI.error = msg; renderCard(); }

  function advance() {
    const R = UI.runner;
    if (!R) return;
    clearTimeout(UI.advanceTimer);
    UI.error = null;
    const fin = R.next();
    if (fin) { stop(`Урок «${R.lesson.title}» пройден!`); return; }
    sync(true);
  }

  /** Перерисовать карточку и, если шаг выполнен, перейти дальше после короткой паузы (чтобы человек увидел результат). */
  function sync(force) {
    const R = UI.runner;
    if (!R || !UI.root) return;
    const s = R.step;
    if (!s) return;
    const done = R.isDone() && !s.info && s.done;
    if (UI.entered !== R.index) { // вход в шаг: выбрать нужную деталь, чтобы справа были её параметры
      UI.entered = R.index;
      UI.error = null;
      try { const id = s.select && s.select(R.ctx); if (id && R.ctx.ui && R.ctx.ui.selectedId() !== id) R.ctx.ui.select(id); } catch { /* не критично */ }
    }
    const key = `${R.index}|${done}|${JSON.stringify(R.items())}|${UI.error || ""}|${UI.noTarget}`;
    if (force || key !== UI.lastKey) { UI.lastKey = key; renderCard(); }
    if (done && !UI.advanceTimer) {
      UI.advanceTimer = setTimeout(() => { UI.advanceTimer = 0; if (UI.runner && UI.runner.isDone()) advance(); }, 900);
    } else if (!done && UI.advanceTimer) { clearTimeout(UI.advanceTimer); UI.advanceTimer = 0; }
    place(); // и по событию: в свёрнутом окне requestAnimationFrame может не вызываться
  }

  function place() {
    const R = UI.runner, root = UI.root;
    if (!R || !root) return;
    const s = R.step;
    const spot = root.querySelector(".coach-spot"), card = root.querySelector(".coach-card"), arrow = root.querySelector(".coach-arrow path");
    let r = null;
    try { r = rectOf(s && s.target ? s.target(R.ctx) : null); } catch { r = null; }
    const W = innerWidth, H = innerHeight;
    const cr = card.getBoundingClientRect();
    UI.noTarget = false;
    if (r) {
      const pad = 6;
      spot.style.display = "block";
      spot.style.left = `${r.x - pad}px`; spot.style.top = `${r.y - pad}px`;
      spot.style.width = `${r.w + pad * 2}px`; spot.style.height = `${r.h + pad * 2}px`;
      root.classList.remove("no-target");
      // карточка — рядом, где есть место
      const room = { right: W - (r.x + r.w), left: r.x, bottom: H - (r.y + r.h), top: r.y };
      let cx, cy;
      if (room.right > cr.width + 40) { cx = r.x + r.w + 28; cy = Math.min(Math.max(12, r.y + r.h / 2 - cr.height / 2), H - cr.height - 12); }
      else if (room.left > cr.width + 40) { cx = r.x - cr.width - 28; cy = Math.min(Math.max(12, r.y + r.h / 2 - cr.height / 2), H - cr.height - 12); }
      else if (room.bottom > cr.height + 40) { cy = r.y + r.h + 28; cx = Math.min(Math.max(12, r.x + r.w / 2 - cr.width / 2), W - cr.width - 12); }
      else { cy = Math.max(12, r.y - cr.height - 28); cx = Math.min(Math.max(12, r.x + r.w / 2 - cr.width / 2), W - cr.width - 12); }
      card.style.left = `${cx}px`; card.style.top = `${cy}px`; card.style.bottom = "auto"; card.style.transform = "none";
      // стрелка от ближайшего края карточки к цели
      const tx = r.x + r.w / 2, ty = r.y + r.h / 2;
      const sx = Math.min(Math.max(tx, cx), cx + cr.width), sy = Math.min(Math.max(ty, cy), cy + cr.height);
      const dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy) || 1;
      const ex = tx - (dx / d) * (Math.min(r.w, r.h) / 2 + pad + 6), ey = ty - (dy / d) * (Math.min(r.w, r.h) / 2 + pad + 6);
      arrow.setAttribute("d", d > 30 ? `M${sx} ${sy} L${ex} ${ey}` : "");
    } else {
      UI.noTarget = Boolean(s && s.target);
      spot.style.display = "none";
      arrow.setAttribute("d", "");
      root.classList.add("no-target");
      card.style.left = "50%"; card.style.top = "auto"; card.style.bottom = "24px"; card.style.transform = "translateX(-50%)";
    }
  }

  function loop() {
    if (!UI.root) return;
    sync(false);
    place();
    UI.raf = requestAnimationFrame(loop);
  }

  /** Запустить урок. uiCtx = dataContext + ui-помощники (см. mechApp.getCoachContext). */
  function start(lesson, ctx, status) {
    stop();
    UI.status = status;
    UI.error = null;
    UI.lastKey = "";
    UI.entered = -1;
    UI.root = build();
    UI.runner = new Runner(lesson, ctx);
    renderCard();
    loop();
    return UI.runner;
  }

  // события приложения (изменился проект / интерфейс) — один раз на всю страницу; без активного урока ничего не делают
  if (typeof BS.events !== "undefined") for (const ev of ["mech:sync", "mech:ui"]) BS.events.on(ev, () => sync(false));

  BS.mechCoach = { dataContext, Runner, start, stop, active: () => Boolean(UI.root), _UI: UI };
})(globalThis.BuildSense);
