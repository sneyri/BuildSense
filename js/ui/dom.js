// Помощники для построения интерфейса без фреймворков.
(function (BS) {
  "use strict";
  const fmtNum = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "" : String(Math.round(Number(v) * 1000) / 1000));

  /** el("div", { class: "x", onclick: fn }, ...дети) */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, String(v));
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  /** Числовое поле: onChange вызывается при подтверждении (Enter / потеря фокуса). */
  function numberField({ label, value, unit = "м", step = 0.05, min, max, onChange, title }) {
    const input = el("input", {
      type: "number", value: fmtNum(value), step, min, max, title,
      onchange: () => {
        const v = Number(input.value.replace(",", "."));
        if (input.value === "" || !Number.isFinite(v)) { input.value = fmtNum(value); return; }
        onChange(v);
      },
    });
    return el("label", { class: "field", title }, el("span", {}, label), el("span", { class: "unit" }, input, unit ? el("em", {}, unit) : null));
  }

  function selectField({ label, value, options, onChange, wide, title, info }) {
    const sel = el("select", { title, onchange: () => onChange(sel.value) },
      options.map((o) => el("option", { value: o.value, selected: String(o.value) === String(value), "data-desc": o.desc, "data-tag": o.tag, "data-thumb": o.thumb, "data-color": o.color }, o.label)));
    if (info) sel.dataset.info = info;
    return el("label", { class: wide ? "field wide" : "field", title }, el("span", {}, label), sel);
  }

  function textField({ label, value, onChange, wide = true }) {
    const input = el("input", { type: "text", value: value ?? "", onchange: () => onChange(input.value.trim()) });
    return el("label", { class: wide ? "field wide" : "field" }, el("span", {}, label), input);
  }

  function checkField({ label, value, onChange }) {
    const input = el("input", { type: "checkbox", checked: Boolean(value), onchange: () => onChange(input.checked) });
    return el("label", { class: "field" }, el("span", {}, label), el("span", {}, input));
  }

  function readonly(label, text) {
    return el("div", { class: "field" }, el("span", {}, label), el("span", { class: "ro" }, text));
  }

  function iconButton(icon, text, onclick, extra = {}) {
    const b = el("button", { type: "button", onclick, ...extra }, text || null);
    b.insertAdjacentHTML("afterbegin", BS.icons.svg(icon));
    return b;
  }

  /** Заменить содержимое узла; null/undefined/false пропускаются (replaceChildren превратил бы их в текст). */
  function fill(node, ...children) {
    node.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
    return node;
  }

  /** Плоский список узлов → карточки-разделы: каждый h3 начинает раздел (.psec) со своим телом. Узлы до первого h3 остаются как есть. */
  function sections(nodes) {
    const out = [];
    let body = null;
    for (const n of nodes.flat(Infinity)) {
      if (n === null || n === undefined || n === false) continue;
      if (n.tagName === "H3") {
        body = el("div", { class: "psec-body" });
        out.push(el("section", { class: "psec" }, n, body));
      } else if (n.tagName === "HR") {
        continue; // разделители заменены границами карточек
      } else if (body) body.append(n);
      else out.push(n);
    }
    return out;
  }

  BS.dom = { el, fill, sections, numberField, selectField, textField, checkField, readonly, iconButton, fmtNum };
})(globalThis.BuildSense);
