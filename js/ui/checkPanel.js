// Правая панель: результаты проверки норм.
import { OPERATORS, STATUS, VERIFICATION_STATUSES } from "../rules/checker.js";
import { PARAMETERS } from "../model/metrics.js";
import { CLIMATE_REGIONS } from "../model/catalog.js";
import { el, formatRu } from "./dom.js";

const STATUS_CLASS = { [STATUS.PASS]: "pass", [STATUS.FAIL]: "fail", [STATUS.NOT_VERIFIED]: "nv" };
const STATUS_ORDER = { [STATUS.FAIL]: 0, [STATUS.PASS]: 1, [STATUS.NOT_VERIFIED]: 2 };
const UNIT_TEXT = { m: "м", cm: "см", mm: "мм", m2: "м²", deg: "°", ratio: "", "%": "%", count: "" };

const expanded = new Set(); // раскрытые карточки сохраняются между перерисовками

/**
 * @param {{ summaryNode, resultsNode }} nodes
 * @param {{ report, ruleErrors: string[], modelIssues: Array, loading?: boolean, loadError?: string }} data
 * @param {{ onSelect: (id) => void }} handlers
 */
export function renderCheckPanel({ summaryNode, resultsNode }, data, handlers) {
  if (data.loading) {
    summaryNode.replaceChildren();
    resultsNode.replaceChildren(el("p", { class: "empty" }, "Загрузка правил…"));
    return;
  }
  if (data.loadError) {
    summaryNode.replaceChildren();
    resultsNode.replaceChildren(el("p", { class: "rule-warnings" }, data.loadError));
    return;
  }

  const { results, notApplicable, summary } = data.report;
  summaryNode.replaceChildren(
    el("span", { class: "badge pass", title: "Требование выполнено (сверенные правила)" }, `PASS ${summary[STATUS.PASS]}`),
    el("span", { class: "badge fail", title: "Требование не выполнено (сверенные правила)" }, `FAIL ${summary[STATUS.FAIL]}`),
    el("span", { class: "badge nv", title: "Правило не сверено, демонстрационное или в модели нет данных" }, `NOT VERIFIED ${summary[STATUS.NOT_VERIFIED]}`),
    el("span", { class: "badge na", title: "Правила, условия применимости которых не выполнены" }, `не применимо ${summary.notApplicable}`)
  );

  const nodes = [];
  if (data.ruleErrors.length) {
    nodes.push(el("div", { class: "rule-warnings" },
      el("strong", {}, "Ошибки в файлах правил (такие правила пропущены):"),
      el("ul", {}, data.ruleErrors.map((e) => el("li", {}, e)))
    ));
  }
  if (data.modelIssues.length) {
    nodes.push(el("div", { class: "rule-warnings" },
      el("strong", {}, "Замечания к модели:"),
      el("ul", {}, data.modelIssues.map((i) => el("li", {},
        el("span", { class: "r-el", onclick: () => handlers.onSelect(i.elementId) }, i.message))))
    ));
  }

  // Сначала нарушения, затем выполненные требования, затем непроверенные; демо-правила — в конце
  const isDemo = (r) => (r.rule.verification.status === "demo" ? 1 : 0);
  const sorted = [...results].sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || isDemo(a) - isDemo(b));
  for (const r of sorted) nodes.push(renderResult(r, handlers));
  if (!results.length) nodes.push(el("p", { class: "empty" }, "Нет применимых правил."));

  if (notApplicable.length) {
    nodes.push(el("details", { class: "na-list" },
      el("summary", {}, `Не применимо к этой модели: ${notApplicable.length}`),
      el("ul", {}, notApplicable.map(({ rule, reason }) =>
        el("li", {}, `${rule.document.id}, п. ${rule.clause} — ${rule.title || rule.id}: ${reason}`)))
    ));
  }
  resultsNode.replaceChildren(...nodes);
}

function renderResult(r, handlers) {
  const rule = r.rule;
  const key = `${r.ruleId}|${r.elementId || ""}`;
  const cls = STATUS_CLASS[r.status];
  const card = el("article", { class: `result ${cls}` });
  const details = el("div", { class: "r-details", hidden: !expanded.has(key) });

  const header = el("header", {
    onclick: () => {
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      details.hidden = !expanded.has(key);
    },
  },
    el("span", { class: "r-title" }, rule.title || rule.id),
    el("span", { class: `badge ${cls}` }, r.status)
  );

  const meta = el("div", { class: "r-meta" }, `${rule.document.id}, п. ${rule.clause}`);
  if (r.elementId) {
    meta.append(" · ", el("span", {
      class: "r-el",
      title: "Выбрать элемент",
      onclick: (e) => { e.stopPropagation(); handlers.onSelect(r.elementId); },
    }, r.elementName || r.elementId));
  }

  const values = el("div", { class: "r-values" },
    `Факт: ${formatValue(r.actual, r.unit, r.parameter)} · Требование: ${formatRequirement(rule, r)}`);

  const param = PARAMETERS[r.parameter] || {};
  details.append(
    el("p", {}, el("strong", {}, "Требование: "), rule.requirement),
    el("p", {}, el("strong", {}, "Параметр: "), `${param.label || r.parameter} (${r.parameter})`),
    el("p", {}, el("strong", {}, "Применимость: "), rule.applicability.description || "всегда"),
    rule.modelAssumptions || param.note ? el("p", {}, el("strong", {}, "Допущения модели: "), rule.modelAssumptions || param.note) : null,
    el("p", {}, el("strong", {}, "Достоверность: "),
      `${VERIFICATION_STATUSES[rule.verification.status]}${rule.verification.note ? `. ${rule.verification.note}` : ""}`),
    el("p", {}, el("strong", {}, "Источник: "), rule.source.title,
      rule.source.url ? [" — ", el("a", { href: rule.source.url, target: "_blank", rel: "noopener" }, rule.source.url)] : null),
    el("p", { class: "readonly" }, `id: ${rule.id} · файл: ${rule.sourceFile || "—"}`)
  );

  card.append(header, meta, values);
  if (r.reason) {
    const demo = r.demoOutcome ? ` Справочно: условие ${r.demoOutcome === STATUS.PASS ? "выполняется" : "не выполняется"}.` : "";
    card.append(el("div", { class: "r-meta" }, `${r.reason}.${demo}`));
  }
  card.append(details);
  return card;
}

function formatValue(value, unit, parameter) {
  if (value === null || value === undefined) return "нет данных";
  if (parameter === "project.climateRegion") return CLIMATE_REGIONS.find((c) => c.id === value)?.label || value;
  if (typeof value !== "number") return String(value);
  if (unit === "ratio") return `${formatRu(value, 3)} (1:${formatRu(1 / value, 1)})`;
  const u = UNIT_TEXT[unit] ?? unit ?? "";
  return `${formatRu(value, 3)}${u === "°" ? u : u ? ` ${u}` : ""}`;
}

function formatRequirement(rule, r) {
  const op = OPERATORS[rule.operator] || rule.operator;
  const unit = r.expected !== null ? r.unit : rule.unit;
  const value = r.expected !== null ? r.expected : rule.value;
  if (rule.operator === "between") {
    return `${formatValue(value[0], unit)} … ${formatValue(value[1], unit)}`;
  }
  if (Array.isArray(value)) return `${op} ${value.join(", ")}`;
  return `${op} ${formatValue(value, unit)}`;
}
