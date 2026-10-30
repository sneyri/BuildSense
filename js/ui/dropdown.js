// Выпадающие списки: обычный <select> остаётся в DOM (значение, событие change, disabled), а пользователь видит свой список —
// с полным текстом, галочкой у выбранного пункта и пояснением. Пояснение и метка берутся из <option data-desc="…" data-tag="…">.
// Ничего подключать вручную не нужно: модуль сам оформляет все <select> (в том числе созданные позже).
// Не нужно оформлять конкретный список — поставьте ему атрибут data-native.
(function (BS) {
  "use strict";
  const valueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  let openInst = null;

  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function close() {
    if (!openInst) return;
    const { list, wrap, btn } = openInst;
    list.remove();
    wrap.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("resize", close);
    window.removeEventListener("blur", close);
    document.removeEventListener("scroll", onScroll, true);
    openInst = null;
  }
  function onOutside(e) { if (openInst && !openInst.list.contains(e.target) && !openInst.wrap.contains(e.target)) close(); }
  function onScroll(e) { if (openInst && !openInst.list.contains(e.target)) close(); }

  const infoOf = (sel, o) => (BS.optionInfo ? BS.optionInfo.get(sel, o) : { desc: o.dataset.desc || "", tag: o.dataset.tag || "", thumb: null, color: "" });

  /** Плитка пункта: иллюстрация (BS.thumbs) или цветной образец материала. null — если картинки нет. */
  function tileOf(info) {
    if (info.thumb && BS.thumbs && BS.thumbs[info.thumb]) { const t = h("span", "dd-thumb"); t.innerHTML = BS.thumbs[info.thumb]; return t; }
    if (info.color) { const t = h("span", "dd-thumb swatch"); t.style.setProperty("--sw", info.color); return t; }
    return null;
  }

  function enhance(sel) {
    if (sel.dataset.dd || sel.multiple || sel.size > 1 || sel.hasAttribute("data-native")) return;
    sel.dataset.dd = "1";
    const wrap = h("div", "dd");
    const btn = h("button", "dd-btn");
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    const val = h("span", "dd-val"), tag = h("span", "dd-tag"), chev = h("span", "dd-chev"), tile = h("span", "dd-tile");
    chev.setAttribute("aria-hidden", "true");
    btn.append(tile, val, tag, chev);
    const desc = h("div", "dd-desc");
    wrap.append(btn, desc);
    sel.classList.add("dd-native");
    sel.tabIndex = -1;
    sel.before(wrap);

    function sync() {
      const o = sel.options[sel.selectedIndex];
      const info = o ? infoOf(sel, o) : { desc: "", tag: "" };
      val.textContent = o ? o.textContent : "—";
      tag.textContent = info.tag || "";
      desc.textContent = info.desc || "";
      const t = tileOf(info);
      tile.replaceChildren(...(t ? [t] : []));
      tile.hidden = !t;
      desc.hidden = !desc.textContent;
      wrap.classList.toggle("disabled", sel.disabled);
      btn.disabled = sel.disabled;
      btn.title = sel.title || "";
      const lbl = sel.getAttribute("aria-label");
      if (lbl) btn.setAttribute("aria-label", lbl);
    }
    // программная установка value (например, смена темы) не шлёт change — перехватываем сами
    Object.defineProperty(sel, "value", { configurable: true, get() { return valueProp.get.call(this); }, set(v) { valueProp.set.call(this, v); sync(); } });
    sel.addEventListener("change", sync);
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "title"] });
    sync();

    function pick(i) {
      close();
      if (i !== sel.selectedIndex) { sel.selectedIndex = i; sel.dispatchEvent(new Event("change", { bubbles: true })); }
      sync();
      btn.focus();
    }

    function openList() {
      if (openInst) { const same = openInst.wrap === wrap; close(); if (same) return; }
      const list = h("div", "dd-list");
      list.setAttribute("role", "listbox");
      const items = [];
      const addOpt = (o) => {
        const row = h("div", "dd-opt");
        row.setAttribute("role", "option");
        row.dataset.index = String(o.index);
        row.setAttribute("aria-selected", String(o.index === sel.selectedIndex));
        const info = infoOf(sel, o);
        const t = tileOf(info);
        if (t) { row.classList.add("has-tile"); row.append(h("span", "dd-check", "✓"), t); } else row.append(h("span", "dd-check", "✓"));
        const text = h("span", "dd-text");
        text.append(h("span", "dd-name", o.textContent));
        if (info.desc) text.append(h("span", "dd-d", info.desc));
        row.append(text, h("span", "dd-tag", info.tag || ""));
        if (o.disabled) row.classList.add("dis");
        else row.addEventListener("click", () => pick(o.index));
        items.push(row);
        return row;
      };
      for (const child of sel.children) {
        if (child.tagName === "OPTGROUP") { list.append(h("div", "dd-group", child.label)); for (const o of child.children) list.append(addOpt(o)); }
        else list.append(addOpt(child));
      }
      document.body.append(list);
      const r = btn.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 280), window.innerWidth - 16);
      list.style.width = `${width}px`;
      list.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
      const want = Math.min(list.scrollHeight + 2, 360);
      if (want > below && above > below) { list.style.bottom = `${window.innerHeight - r.top + 4}px`; list.style.maxHeight = `${Math.min(360, above)}px`; }
      else { list.style.top = `${r.bottom + 4}px`; list.style.maxHeight = `${Math.min(360, below)}px`; }
      wrap.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      let act = Math.max(0, sel.selectedIndex);
      const mark = (i) => {
        act = i;
        items.forEach((n, k) => n.classList.toggle("act", k === i));
        if (items[i]) items[i].scrollIntoView({ block: "nearest" });
      };
      mark(act);
      items.forEach((n, k) => n.addEventListener("pointermove", () => { if (act !== k) mark(k); }));
      openInst = { list, wrap, btn, mark, items, get act() { return act; } };
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", close);
      window.addEventListener("blur", close);
    }

    btn.addEventListener("click", openList);
    btn.addEventListener("keydown", (e) => {
      const n = sel.options.length;
      if (openInst && openInst.wrap === wrap) {
        const step = (d) => { let i = openInst.act; do { i = (i + d + n) % n; } while (sel.options[i].disabled && i !== openInst.act); openInst.mark(i); };
        if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
        else if (e.key === "Home") { e.preventDefault(); openInst.mark(0); }
        else if (e.key === "End") { e.preventDefault(); openInst.mark(n - 1); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(openInst.act); }
        else if (e.key === "Escape" || e.key === "Tab") { if (e.key === "Escape") e.stopPropagation(); close(); }
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openList(); }
    });
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.tagName === "SELECT") enhance(root);
    root.querySelectorAll && root.querySelectorAll("select").forEach(enhance);
  }

  function start() {
    scan(document.body);
    new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach(scan); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  BS.dropdown = { enhance, close };
})(globalThis.BuildSense || (globalThis.BuildSense = {}));
