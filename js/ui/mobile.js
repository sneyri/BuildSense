// Телефон и планшет: боковые панели открываются «шторками» снизу кнопками нижней панели, вид «План / 3D» переключается одной кнопкой.
// Класс body.m-left / body.m-right — открытая шторка. На широком экране модуль ничего не делает (нижняя панель скрыта в CSS).
(function (BS) {
  "use strict";
  const QUERY = "(max-width: 820px), (pointer: coarse) and (max-width: 1000px)"; // тот же запрос, что в css/mobile.css
  const mq = typeof matchMedia === "function" ? matchMedia(QUERY) : { matches: false, addEventListener() {} };
  const body = () => document.body;
  const VIEW_LABEL = { plan: "План", "3d": "3D", split: "План + 3D" };
  const VIEW_ICON = { plan: "plan2d", "3d": "cube", split: "split" };
  const NEXT_VIEW = { plan: "3d", "3d": "split", split: "plan" };

  function sync() {
    const b = body();
    document.querySelectorAll("[data-msheet=\"left\"]").forEach((x) => x.setAttribute("aria-pressed", String(b.classList.contains("m-left"))));
    document.querySelectorAll("[data-msheet=\"right\"]").forEach((x) => x.setAttribute("aria-pressed", String(b.classList.contains("m-right"))));
    const label = document.getElementById("mbar-view");
    if (label) label.textContent = VIEW_LABEL[b.dataset.archview] || "План";
    const btn = document.querySelector("[data-msheet=\"view\"]");
    if (btn && BS.icons) {
      const svg = btn.querySelector("svg");
      if (svg) svg.outerHTML = BS.icons.svg(VIEW_ICON[b.dataset.archview] || "split");
    }
  }

  function closeSheets() {
    const b = body();
    if (!b.classList.contains("m-left") && !b.classList.contains("m-right")) return;
    b.classList.remove("m-left", "m-right");
    sync();
    BS.events && BS.events.emit("layout");
  }

  function toggleSheet(side) {
    const b = body();
    const cls = `m-${side}`;
    const on = !b.classList.contains(cls);
    b.classList.remove("m-left", "m-right");
    b.classList.toggle(cls, on);
    sync();
    BS.events && BS.events.emit("layout");
  }

  function init() {
    document.addEventListener("click", (e) => {
      const m = e.target.closest("[data-msheet]");
      if (m) {
        if (m.dataset.msheet === "view") { if (BS.shell) BS.shell.setArchView(NEXT_VIEW[body().dataset.archview] || "plan"); closeSheets(); sync(); }
        else toggleSheet(m.dataset.msheet);
        return;
      }
      // выбрали объект на палитре — шторку убираем, чтобы сразу ставить его на плане
      if (mq.matches && e.target.closest(".side-left [data-tool]")) closeSheets();
    });
    // касание рабочей области закрывает шторку (как тап по затемнению)
    document.addEventListener("pointerdown", (e) => {
      if (mq.matches && (body().classList.contains("m-left") || body().classList.contains("m-right")) && e.target.closest(".workarea")) closeSheets();
    }, true);
    if (BS.events) {
      BS.events.on("archview", sync);
      BS.events.on("mode", closeSheets);
    }
    mq.addEventListener && mq.addEventListener("change", closeSheets);

    if (mq.matches) {
      let saved = null;
      try { saved = localStorage.getItem("buildsense.archview"); } catch { /* не критично */ }
      // первый запуск на телефоне: сначала один план — две половинки экрана слишком малы
      if (!saved && BS.shell) BS.shell.setArchView("plan", { persist: false });
      // телефон на боку: высоты мало, ленту сворачиваем (вкладки остаются, касание вкладки раскрывает)
      if (window.innerHeight < 520 && BS.ribbon) document.querySelectorAll(".ribbon").forEach((r) => { if (r.id) BS.ribbon.setCollapsed(r, true, false); });
    }
    sync();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0)); else setTimeout(init, 0);
  BS.mobile = { closeSheets, toggleSheet, isMobile: () => mq.matches };
})(globalThis.BuildSense || (globalThis.BuildSense = {}));
