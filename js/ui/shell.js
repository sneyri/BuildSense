// Оболочка интерфейса: режимы «Архитектура» / «Машиностроение», вид рабочей области (план / 3D / оба),
// сворачивание панелей, «чистый просмотр» и строка состояния. Контракт — docs/INTEGRATION.md.
// Загружается ДО js/app.js, поэтому к BS.app и модулям обращается только после DOMContentLoaded.
(function (BS) {
  "use strict";
  const MODES = ["arch", "mech"];
  const VIEWS = ["plan", "3d", "split"];
  const KEY = { mode: "buildsense.mode", view: "buildsense.archview", panels: "buildsense.panels" };
  const $ = (id) => document.getElementById(id);

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим и т. п. — не критично */ } },
  };

  const state = { mode: "arch", archview: "split", mechMounted: false, ready: false };

  /** Сообщить модулям, что размеры областей изменились (после пересчёта раскладки). */
  let layoutPending = false;
  function emitLayout() {
    if (layoutPending) return; // несколько изменений подряд — одно событие
    layoutPending = true;
    const fire = () => { layoutPending = false; BS.events.emit("layout"); };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(fire));
    else setTimeout(fire, 0);
  }

  function pressed(selector, attr, value) {
    document.querySelectorAll(selector).forEach((b) => {
      const on = b.getAttribute(attr) === value;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  function placeholder(node, title, text) {
    if (!node) return;
    const box = document.createElement("div");
    box.className = "empty-state";
    const h = document.createElement("strong");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = text;
    box.append(h, p);
    node.replaceChildren(box);
  }

  function mountMech() {
    if (state.mechMounted) return;
    state.mechMounted = true;
    const app = BS.mechApp;
    if (!app || typeof app.mount !== "function") {
      placeholder($("mech-viewport"), "Модуль машиностроения не загружен",
        "Не найден файл js/mech/mechApp.js. Проверьте, что папка js/mech лежит рядом с index.html, и обновите страницу.");
      setStatus("Модуль машиностроения не загружен (js/mech/mechApp.js)", "error");
      return;
    }
    try {
      if (!(typeof app.isMounted === "function" && app.isMounted())) {
        app.mount({ viewport: $("mech-viewport"), tree: $("mech-tree"), props: $("mech-props"), commands: $("mech-commands") });
      }
    } catch (err) {
      placeholder($("mech-viewport"), "Не удалось запустить модуль машиностроения", String(err && err.message || err));
      setStatus(`Машиностроение: ${err && err.message || err}`, "error");
    }
  }

  function setMode(mode, opts = {}) {
    if (!MODES.includes(mode)) mode = "arch";
    const changed = mode !== state.mode || !state.ready;
    state.mode = mode;
    document.body.dataset.mode = mode;
    pressed("[data-setmode]", "data-setmode", mode);
    document.title = mode === "mech" ? "BuildSense — машиностроение" : "BuildSense — архитектура";
    if (opts.persist !== false) store.set(KEY.mode, mode);
    if (mode === "mech") mountMech();
    if (changed) BS.events.emit("mode", mode);
    emitLayout();
    return mode;
  }

  function setArchView(view, opts = {}) {
    if (!VIEWS.includes(view)) view = "split";
    state.archview = view;
    document.body.dataset.archview = view;
    pressed("[data-archview]", "data-archview", view);
    if (opts.persist !== false) store.set(KEY.view, view);
    BS.events.emit("archview", view);
    emitLayout();
    return view;
  }

  function togglePanel(side) {
    document.body.classList.toggle(`collapse-${side}`);
    savePanels();
    emitLayout();
  }

  function savePanels() {
    const b = document.body.classList;
    store.set(KEY.panels, JSON.stringify({ left: b.contains("collapse-left"), right: b.contains("collapse-right") }));
  }

  function setCleanView(on) {
    const v = on === undefined ? !document.body.classList.contains("clean-view") : Boolean(on);
    document.body.classList.toggle("clean-view", v);
    document.querySelectorAll('[data-action="clean-view"]').forEach((b) => {
      b.classList.toggle("on", v);
      b.setAttribute("aria-pressed", String(v));
    });
    setStatus(v ? "Чистый просмотр: панели скрыты. Повторное нажатие кнопки или Esc — вернуть." : "Панели снова видны");
    emitLayout();
    return v;
  }

  /** Строка состояния: BS.events.emit("status", { text, kind }) — kind: null | "error" | "warn" | "ok". */
  function setStatus(text, kind = null) {
    const n = $("status-text");
    if (!n) return;
    n.textContent = text == null ? "" : String(text);
    n.title = n.textContent; // длинное сообщение обрезается многоточием — полностью видно в подсказке
    n.className = kind || "";
  }

  BS.events.on("status", (s) => {
    if (typeof s === "string") return setStatus(s);
    if (s) setStatus(s.text, s.kind || null);
  });

  function fromHash() {
    try {
      const h = new URLSearchParams(location.hash.slice(1));
      return { mode: h.get("mode"), archview: h.get("archview") };
    } catch { return {}; }
  }

  function init() {
    if (state.ready) return;
    const h = fromHash();
    let panels = null;
    try { panels = JSON.parse(store.get(KEY.panels) || "null"); } catch { panels = null; }
    if (panels) {
      document.body.classList.toggle("collapse-left", Boolean(panels.left));
      document.body.classList.toggle("collapse-right", Boolean(panels.right));
    }

    const planAvailable = typeof BS.PlanEditor === "function";
    if (!planAvailable) {
      const pv = $("plan-view");
      if (pv && !pv.children.length) placeholder(pv, "2D-план недоступен", "Не найден файл js/plan/planEditor.js. Работайте в 3D или обновите страницу после установки модуля.");
    }
    const savedView = h.archview || store.get(KEY.view);
    setArchView(VIEWS.includes(savedView) ? savedView : (planAvailable ? "split" : "3d"), { persist: Boolean(h.archview) });

    const mode = h.mode || store.get(KEY.mode) || "arch";
    setMode(mode, { persist: Boolean(h.mode) });
    state.ready = true;

    document.addEventListener("click", (e) => {
      const m = e.target.closest("[data-setmode]");
      if (m) { setMode(m.dataset.setmode); return; }
      const v = e.target.closest("button[data-archview]"); // body тоже несёт data-archview (текущий вид)
      if (v) { setArchView(v.dataset.archview); return; }
      const c = e.target.closest("[data-collapse]");
      if (c) { togglePanel(c.dataset.collapse); return; }
      if (e.target.closest('[data-action="clean-view"]')) setCleanView();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.body.classList.contains("clean-view")) setCleanView(false);
    });
    window.addEventListener("hashchange", () => {
      const x = fromHash();
      if (x.mode && x.mode !== state.mode) setMode(x.mode);
      if (x.archview && x.archview !== state.archview) setArchView(x.archview);
    });
    window.addEventListener("resize", emitLayout);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else setTimeout(init, 0);

  BS.shell = {
    setMode,
    setArchView,
    setCleanView,
    togglePanel,
    setStatus,
    get mode() { return state.mode; },
    get archview() { return state.archview; },
  };
})(globalThis.BuildSense);
