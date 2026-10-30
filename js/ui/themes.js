// BuildSense · темы оформления. BS.themes.apply(id), BS.themes.list, BS.themes.current(), BS.themes.next().
// Тема = атрибут body[data-theme]; цвета — токены в css/themes.css. Светлые темы дополнительно получают body.light.
(function (BS) {
  "use strict";
  const KEY = "buildsense.themeId";
  const LIST = [
    { id: "dark", name: "Инженерная тёмная", light: false },
    { id: "light", name: "Светлая", light: true },
    { id: "tflex", name: "САПР светлая", light: true },
    { id: "blueprint", name: "Синяя (чертёжная)", light: false },
  ];
  let cur = "dark";
  const listeners = [];

  function find(id) { return LIST.find((t) => t.id === id) || LIST[0]; }

  function apply(id, opts = {}) {
    const t = find(id);
    cur = t.id;
    document.body.dataset.theme = t.id;
    document.body.classList.toggle("light", t.light);
    document.querySelectorAll(".theme-select").forEach((s) => { if (s.value !== t.id) s.value = t.id; });
    if (opts.persist !== false) { try { localStorage.setItem(KEY, t.id); } catch { /* не критично */ } }
    for (const fn of listeners) { try { fn(t); } catch (e) { console.warn(e); } }
    return t;
  }

  function init() {
    let id = null;
    try {
      id = localStorage.getItem(KEY);
      if (!id && localStorage.getItem("buildsense.theme") === "light") id = "light"; // старый переключатель
    } catch { /* не критично */ }
    const sel = document.querySelector(".theme-select");
    if (sel) sel.dataset.info = "theme";
    if (sel && !sel.options.length) for (const t of LIST) sel.add(new Option(t.name, t.id));
    if (sel) sel.addEventListener("change", () => apply(sel.value));
    apply(id || "dark", { persist: false });
  }

  BS.themes = {
    list: LIST,
    current: () => cur,
    apply,
    init,
    next() { return apply(LIST[(LIST.findIndex((t) => t.id === cur) + 1) % LIST.length].id); },
    onChange(fn) { listeners.push(fn); },
  };
})(globalThis.BuildSense || (globalThis.BuildSense = {}));
