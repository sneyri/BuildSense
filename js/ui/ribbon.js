// Лента команд: вкладки → панели с группами. Разметка: .ribbon > .rb-tabs [data-rtab] + .rb-panel [data-rpanel].
// Работает через делегирование, поэтому подходит и для статической ленты (архитектура), и для построенной кодом (машиностроение).
(function (BS) {
  "use strict";
  const KEY = "buildsense.ribbon";
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } },
    set(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* не критично */ } },
  };

  function select(ribbon, name, persist = true) {
    if (!ribbon || !ribbon.querySelector(`[data-rpanel="${name}"]`)) return false;
    ribbon.querySelectorAll("[data-rtab]").forEach((b) => {
      const on = b.dataset.rtab === name;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    ribbon.querySelectorAll("[data-rpanel]").forEach((p) => p.classList.toggle("active", p.dataset.rpanel === name));
    if (persist && ribbon.id) { const o = store.get(); o[ribbon.id] = name; store.set(o); }
    return true;
  }

  /** Открыть вкладку, в которой лежит элемент (например, чтобы подсветить кнопку обучения). */
  function reveal(node) {
    const panel = node && node.closest ? node.closest("[data-rpanel]") : null;
    if (panel) select(panel.closest(".ribbon"), panel.dataset.rpanel, false);
  }

  function setCollapsed(ribbon, on, persist = true) {
    ribbon.classList.toggle("collapsed", on);
    const t = ribbon.querySelector(".rb-collapse");
    if (t) { t.setAttribute("aria-pressed", String(on)); t.title = on ? "Показать ленту" : "Свернуть ленту — больше места для модели"; t.textContent = on ? "▾" : "▴"; }
    if (persist && ribbon.id) { const o = store.get(); o[`${ribbon.id}:collapsed`] = on; store.set(o); }
    BS.events && BS.events.emit("layout");
  }

  /** Вернуть сохранённую вкладку и состояние ленты; добавить кнопку сворачивания, если её ещё нет. */
  function restore(ribbon) {
    if (!ribbon) return;
    const tabs = ribbon.querySelector(".rb-tabs");
    if (tabs && !tabs.querySelector(".rb-collapse")) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "rb-collapse ghost icon-only";
      tabs.append(b);
    }
    const o = store.get();
    if (o[ribbon.id]) select(ribbon, o[ribbon.id], false);
    setCollapsed(ribbon, Boolean(o[`${ribbon.id}:collapsed`]), false);
  }

  document.addEventListener("click", (e) => {
    const c = e.target.closest(".rb-collapse");
    if (c) { const r = c.closest(".ribbon"); setCollapsed(r, !r.classList.contains("collapsed")); return; }
    const t = e.target.closest("[data-rtab]");
    if (t) {
      const r = t.closest(".ribbon");
      const same = t.classList.contains("active");
      select(r, t.dataset.rtab);
      if (r.classList.contains("collapsed")) setCollapsed(r, false); // выбор вкладки раскрывает свёрнутую ленту
      else if (same && e.detail === 2) setCollapsed(r, true); // двойной щелчок по активной вкладке — свернуть
    }
  });
  document.addEventListener("DOMContentLoaded", () => document.querySelectorAll(".ribbon").forEach(restore));

  BS.ribbon = { select, reveal, restore, setCollapsed };
})(globalThis.BuildSense || (globalThis.BuildSense = {}));
