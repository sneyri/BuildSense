// Небольшие помощники для построения форм без фреймворков.

/** Создаёт DOM-элемент: el("div", { class: "x", onclick: fn }, child1, "текст"). */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (key === "class") {
      node.className = value;
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Числовое поле. onChange вызывается при подтверждении ввода (Enter или потеря фокуса). */
export function numberField({ label, value, min, max, step = 0.01, unit = "м", onChange, title, disabled }) {
  const input = el("input", {
    type: "number", value: formatNumber(value), min, max, step, title, disabled,
    onchange: () => {
      const v = Number(input.value);
      if (input.value === "" || !Number.isFinite(v)) {
        input.value = formatNumber(value);
        return;
      }
      onChange(v);
    },
  });
  return el("label", { class: "field", title },
    el("span", {}, label),
    el("span", { class: "unit-wrap" }, input, unit ? el("em", {}, unit) : null)
  );
}

export function selectField({ label, value, options, onChange, wide = false, title }) {
  const select = el("select", { title, onchange: () => onChange(select.value) },
    options.map((o) => el("option", { value: o.value, selected: o.value === value }, o.label))
  );
  return el("label", { class: wide ? "field wide" : "field select", title }, el("span", {}, label), select);
}

export function textField({ label, value, onChange, wide = true }) {
  const input = el("input", { type: "text", value: value ?? "", onchange: () => onChange(input.value.trim()) });
  return el("label", { class: wide ? "field wide" : "field" }, el("span", {}, label), input);
}

export function readonlyField(label, text) {
  return el("div", { class: "field" }, el("span", {}, label), el("span", { class: "readonly" }, text));
}

export function formatNumber(v, digits = 3) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "";
  return String(Math.round(Number(v) * 10 ** digits) / 10 ** digits);
}

/** Число для показа пользователю — с десятичной запятой (в полях ввода остаётся точка). */
export function formatRu(v, digits = 3) {
  return formatNumber(v, digits).replace(".", ",");
}
