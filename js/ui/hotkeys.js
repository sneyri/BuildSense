// BuildSense · единый менеджер горячих клавиш (оба режима) + справка «?» + контекстные подсказки.
//
//   BS.hotkeys.register({ id, group: "common"|"mech"|"arch", label, keys: ["Ctrl+KeyZ", …], run(e), enabled?() })
//   BS.hotkeys.dispatch(eventLike, { mode, dialogOpen }) → true, если сочетание обработано (используется и в тестах без DOM)
//   BS.hotkeys.list(mode) / bindings() / remap(id, combo) / resetAll()
//   BS.hotkeys.openHelp() / closeHelp()
//
// Обозначение сочетаний: модификаторы Ctrl/Shift/Alt + код клавиши (KeyZ, Delete, Escape, Numpad7, Digit7, "?").
// Коды (а не буквы) — чтобы работало и в русской раскладке. Единственный слушатель keydown на весь документ;
// события, уже обработанные локально (defaultPrevented, например холст плана при наборе длины), пропускаются.
(function (BS) {
  "use strict";
  const KEY = "buildsense.hotkeys";
  const defs = new Map();
  let custom = {};
  const hasDom = typeof document !== "undefined";

  function loadCustom() {
    try { custom = (hasDom && JSON.parse(localStorage.getItem(KEY) || "{}")) || {}; } catch { custom = {}; }
  }
  function saveCustom() {
    try { if (hasDom) localStorage.setItem(KEY, JSON.stringify(custom)); } catch { /* не критично */ }
  }

  /** Сочетание из события: "Ctrl+Shift+KeyZ". «?» распознаётся как отдельная клавиша. */
  function combo(e) {
    if (e.key === "?") return "?";
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    let code = e.code || "";
    if (!code && e.key) code = e.key.length === 1 ? `Key${e.key.toUpperCase()}` : e.key;
    if (/^(Control|Shift|Alt|Meta)(Left|Right)?$/.test(code)) return null; // голый модификатор
    parts.push(code);
    return parts.join("+");
  }

  const pretty = (c) => c
    .replace(/Ctrl\+/g, "Ctrl+").replace(/Shift\+/g, "Shift+").replace(/Alt\+/g, "Alt+")
    .replace(/Key([A-Z])$/, "$1").replace(/Digit(\d)$/, "$1").replace(/Numpad(\d)$/, "NumPad $1")
    .replace("Escape", "Esc").replace("Delete", "Del").replace("Slash", "/");

  function register(def) {
    if (!def || !def.id || !Array.isArray(def.keys) || typeof def.run !== "function") throw new Error("hotkeys.register: нужны id, keys и run");
    defs.set(def.id, { group: "common", label: def.id, ...def });
    return def.id;
  }
  function unregister(id) { defs.delete(id); }
  function clear() { defs.clear(); }

  const keysOf = (d) => (custom[d.id] && custom[d.id].length ? custom[d.id] : d.keys);
  const inScope = (d, mode) => d.group === "common" || d.group === mode;

  function typing(t) {
    return Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || "")));
  }

  /** Найти действие для сочетания в режиме mode (по приоритету: режимное перед общим). */
  function resolve(c, mode) {
    let found = null;
    for (const d of defs.values()) {
      if (!inScope(d, mode) || !keysOf(d).includes(c)) continue;
      if (!found || (found.group === "common" && d.group !== "common")) found = d;
    }
    return found;
  }

  function dispatch(e, { mode, dialogOpen = false } = {}) {
    if (e.defaultPrevented || e.isComposing) return false;
    if (typing(e.target)) return false; // пользователь вводит текст — не перехватываем ничего
    const c = combo(e);
    if (!c) return false;
    if (dialogOpen && c !== "Escape" && c !== "?") return false;
    const d = resolve(c, mode);
    if (!d) return false;
    if (d.enabled && !d.enabled()) return false;
    const handled = d.run(e) !== false;
    if (handled && e.preventDefault) e.preventDefault();
    return handled;
  }

  function list(mode) {
    const order = { common: 0, mech: 1, arch: 2 };
    return [...defs.values()].filter((d) => !mode || inScope(d, mode)).sort((a, b) => order[a.group] - order[b.group]).map((d) => ({ id: d.id, group: d.group, label: d.label, keys: keysOf(d), defaults: d.keys, custom: Boolean(custom[d.id]) }));
  }

  /** Назначить действию другое сочетание. Возвращает { ok, error }; конфликт внутри области действия отклоняется. */
  function remap(id, c) {
    const d = defs.get(id);
    if (!d) return { ok: false, error: "Нет такого действия" };
    if (!c || c === "Escape") return { ok: false, error: "Эту клавишу назначить нельзя" };
    const clash = [...defs.values()].find((x) => x.id !== id && (x.group === d.group || x.group === "common" || d.group === "common") && keysOf(x).includes(c));
    if (clash) return { ok: false, error: `Уже занято: «${clash.label}»` };
    custom[id] = [c];
    saveCustom();
    return { ok: true };
  }
  function resetAll() { custom = {}; saveCustom(); }

  // ------------------------------------------------------------------ подсказки (показать один раз, можно отключить)

  const HINT_KEY = "buildsense.hints";
  const hintState = () => { try { return (hasDom && JSON.parse(localStorage.getItem(HINT_KEY) || "{}")) || {}; } catch { return {}; } };
  const hints = {
    enabled() { return hintState().off !== true; },
    setEnabled(on) { const s = hintState(); s.off = !on; if (on) s.seen = {}; try { localStorage.setItem(HINT_KEY, JSON.stringify(s)); } catch { /* не критично */ } },
    /** Показать подсказку один раз (по ключу). Возвращает true, если показана. */
    once(key, text) {
      if (!hasDom || !hints.enabled()) return false;
      const s = hintState(); s.seen = s.seen || {};
      if (s.seen[key]) return false;
      s.seen[key] = true;
      try { localStorage.setItem(HINT_KEY, JSON.stringify(s)); } catch { /* не критично */ }
      toast(text);
      return true;
    },
  };

  function toast(text) {
    if (!hasDom) return;
    document.querySelectorAll(".hk-toast").forEach((n) => n.remove());
    const n = document.createElement("div");
    n.className = "hk-toast";
    n.setAttribute("role", "status");
    const t = document.createElement("span"); t.textContent = text;
    const off = document.createElement("button"); off.type = "button"; off.className = "ghost"; off.textContent = "Больше не показывать";
    off.addEventListener("click", () => { hints.setEnabled(false); n.remove(); });
    const ok = document.createElement("button"); ok.type = "button"; ok.textContent = "Понятно";
    ok.addEventListener("click", () => n.remove());
    n.append(t, off, ok);
    document.body.append(n);
    setTimeout(() => n.remove(), 14000);
  }

  // ------------------------------------------------------------------ справка

  const GROUPS = { common: "Общие", mech: "Машиностроение", arch: "Архитектура" };
  let help = null;

  function renderHelp() {
    if (!help) return;
    const mode = hasDom ? document.body.dataset.mode || "arch" : "arch";
    const body = document.createElement("div");
    body.className = "hk-body";
    const rows = list(mode);
    for (const g of ["common", mode]) {
      const items = rows.filter((r) => r.group === g);
      if (!items.length) continue;
      const h = document.createElement("h3"); h.textContent = GROUPS[g]; body.append(h);
      const t = document.createElement("table");
      for (const r of items) {
        const tr = document.createElement("tr");
        const k = document.createElement("td"); k.className = "hk-keys";
        for (const c of r.keys) {
          const b = document.createElement("button"); b.type = "button"; b.className = "hk-chip" + (r.custom ? " custom" : "");
          b.textContent = pretty(c); b.title = "Нажмите, затем новую клавишу, чтобы переназначить";
          b.addEventListener("click", () => capture(r.id, b));
          k.append(b);
        }
        const l = document.createElement("td"); l.textContent = r.label;
        tr.append(k, l); t.append(tr);
      }
      body.append(t);
    }
    const foot = document.createElement("div"); foot.className = "hk-foot";
    const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "Вернуть стандартные";
    reset.addEventListener("click", () => { resetAll(); renderHelp(); });
    const lab = document.createElement("label");
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = hints.enabled();
    cb.addEventListener("change", () => hints.setEnabled(cb.checked));
    lab.append(cb, " Показывать подсказки новичку");
    foot.append(lab, reset);
    help.querySelector(".hk-content").replaceChildren(body, foot);
  }

  function capture(id, chip) {
    chip.textContent = "Нажмите клавишу…";
    const on = (e) => {
      const c = combo(e);
      if (!c) return;
      e.preventDefault(); e.stopPropagation();
      document.removeEventListener("keydown", on, true);
      if (e.key === "Escape") return renderHelp();
      const r = remap(id, c);
      renderHelp();
      if (!r.ok) toast(r.error);
    };
    document.addEventListener("keydown", on, true);
  }

  function openHelp() {
    if (!hasDom || help) return;
    help = document.createElement("div");
    help.className = "hk-dialog";
    help.setAttribute("role", "dialog");
    help.setAttribute("aria-label", "Горячие клавиши");
    const box = document.createElement("div"); box.className = "hk-box";
    const head = document.createElement("div"); head.className = "hk-head";
    const h = document.createElement("strong"); h.textContent = "Горячие клавиши";
    const x = document.createElement("button"); x.type = "button"; x.textContent = "Закрыть"; x.addEventListener("click", closeHelp);
    head.append(h, x);
    const content = document.createElement("div"); content.className = "hk-content";
    box.append(head, content); help.append(box);
    help.addEventListener("click", (e) => { if (e.target === help) closeHelp(); });
    document.body.append(help);
    renderHelp();
  }
  function closeHelp() { if (help) { help.remove(); help = null; } }

  function install() {
    if (!hasDom || install.done) return;
    install.done = true;
    loadCustom();
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && help) { e.preventDefault(); closeHelp(); return; }
      const mode = document.body.dataset.mode || "arch";
      const dialogOpen = Boolean(document.querySelector(".drawing-dialog, .hk-dialog"));
      dispatch(e, { mode, dialogOpen });
    });
  }

  register({ id: "help", group: "common", label: "Справка по горячим клавишам", keys: ["?", "Shift+Slash", "F1"], run: () => { help ? closeHelp() : openHelp(); } });
  if (hasDom) { loadCustom(); if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install(); }

  BS.hotkeys = { register, unregister, clear, combo, pretty, resolve, dispatch, list, remap, resetAll, openHelp, closeHelp, typing, install, _setCustom: (c) => { custom = c; } };
  BS.hints = hints;
})(globalThis.BuildSense || (globalThis.BuildSense = {}));
