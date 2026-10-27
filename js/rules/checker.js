// Проверка нормативных и пользовательских правил по параметрам модели (см. validation/metrics.js).
// PASS/FAIL выдаются только для правил со статусом "verified" (сверено с текстом документа)
// и "user" (пользовательское учебное ограничение — с пометкой, что это не норма).
// Для "unverified" и "demo" результат всегда NOT VERIFIED, а сравнение показывается справочно.
(function (BS) {
  "use strict";

  const STATUS = Object.freeze({ PASS: "PASS", FAIL: "FAIL", NOT_VERIFIED: "NOT VERIFIED" });

  const VERIFICATION_STATUSES = Object.freeze({
    verified: "Сверено с текстом документа",
    unverified: "Значение требует проверки по действующей редакции",
    demo: "Демонстрационное правило — не норматив",
    user: "Пользовательское учебное ограничение — не норма",
  });

  const OPERATORS = Object.freeze({
    ">=": "≥", ">": ">", "<=": "≤", "<": "<", "==": "=", "!=": "≠",
    between: "в диапазоне", in: "одно из", not_in: "не из",
  });

  const UNITS = {
    m: ["length", 1], cm: ["length", 0.01], mm: ["length", 0.001],
    m2: ["area", 1], deg: ["angle", 1], ratio: ["ratio", 1], "%": ["ratio", 0.01], count: ["count", 1],
  };
  const EPS = 1e-9;

  function validateRule(rule) {
    const errors = [];
    const need = (cond, text) => { if (!cond) errors.push(text); };
    need(rule && typeof rule === "object", "правило должно быть объектом");
    if (errors.length) return errors;
    need(typeof rule.id === "string" && rule.id, "нет id");
    need(rule.document && rule.document.id && rule.document.title, "нет document.id / document.title");
    need(typeof rule.clause === "string" && rule.clause, "нет номера пункта clause");
    need(typeof rule.requirement === "string" && rule.requirement, "нет описания требования requirement");
    need(typeof rule.parameter === "string" && rule.parameter, "нет проверяемого параметра parameter");
    need(Object.prototype.hasOwnProperty.call(OPERATORS, rule.operator), `неизвестный оператор "${rule.operator}"`);
    need(rule.value !== undefined && rule.value !== null, "нет порогового значения value");
    if (rule.operator === "between") {
      need(Array.isArray(rule.value) && rule.value.length === 2 && rule.value.every(Number.isFinite), "для between значение — массив [min, max]");
    } else if (rule.operator === "in" || rule.operator === "not_in") {
      need(Array.isArray(rule.value), `для ${rule.operator} значение — массив`);
    }
    need(rule.unit === null || typeof rule.unit === "string", "unit должен быть строкой или null");
    if (typeof rule.unit === "string" && rule.unit) need(Object.prototype.hasOwnProperty.call(UNITS, rule.unit), `неизвестная единица "${rule.unit}"`);
    need(rule.applicability && typeof rule.applicability === "object", "нет условий применимости applicability");
    for (const c of (rule.applicability && rule.applicability.conditions) || []) {
      need(c && typeof c.parameter === "string" && Object.prototype.hasOwnProperty.call(OPERATORS, c.operator), "некорректное условие применимости");
    }
    need(rule.source && rule.source.title, "нет источника source.title");
    need(rule.verification && Object.prototype.hasOwnProperty.call(VERIFICATION_STATUSES, rule.verification.status),
      "verification.status должен быть verified, unverified, demo или user");
    return errors;
  }

  function convertValue(value, fromUnit, toUnit) {
    if (Array.isArray(value)) {
      const list = value.map((v) => convertValue(v, fromUnit, toUnit));
      return list.some((v) => v === undefined) ? undefined : list;
    }
    if (typeof value !== "number") return value;
    if ((fromUnit || null) === (toUnit || null)) return value;
    if (!fromUnit || !toUnit) return undefined;
    const a = UNITS[fromUnit], b = UNITS[toUnit];
    if (!a || !b || a[0] !== b[0]) return undefined;
    return (value * a[1]) / b[1];
  }

  function compare(actual, operator, expected) {
    if (actual === null || actual === undefined) return null;
    switch (operator) {
      case ">=": return actual >= expected - EPS;
      case ">": return actual > expected + EPS;
      case "<=": return actual <= expected + EPS;
      case "<": return actual < expected - EPS;
      case "==": return typeof actual === "number" ? Math.abs(actual - expected) <= EPS : actual === expected;
      case "!=": return typeof actual === "number" ? Math.abs(actual - expected) > EPS : actual !== expected;
      case "between": return actual >= expected[0] - EPS && actual <= expected[1] + EPS;
      case "in": return expected.includes(actual);
      case "not_in": return !expected.includes(actual);
      default: return null;
    }
  }

  function evaluateConditions(conditions = [], ctx) {
    let missing = false;
    for (const c of conditions) {
      const res = compare(ctx[c.parameter], c.operator, c.value);
      if (res === false) return false;
      if (res === null) missing = true;
    }
    return missing ? null : true;
  }

  /** Проверка правил: { results, notApplicable, summary }. */
  function checkModel(parameters, rules) {
    const results = [];
    const notApplicable = [];
    for (const rule of rules) {
      const elementType = (rule.applicability && rule.applicability.elementType) || null;
      const targets = elementType ? parameters.elements.filter((e) => e.type === elementType) : [null];
      if (elementType && !targets.length) {
        notApplicable.push({ rule, reason: `в модели нет элементов типа «${BS.types.label(elementType)}»` });
        continue;
      }
      let applicable = 0;
      for (const target of targets) {
        const ctx = { ...parameters.building, ...(target ? target.values : {}) };
        const app = evaluateConditions(rule.applicability.conditions, ctx);
        if (app === false) continue;
        applicable++;
        results.push(evaluateRule(rule, ctx, target, parameters.units, app === null));
      }
      if (!applicable) notApplicable.push({ rule, reason: rule.applicability.description || "условия применимости не выполнены" });
    }
    const summary = { [STATUS.PASS]: 0, [STATUS.FAIL]: 0, [STATUS.NOT_VERIFIED]: 0, notApplicable: notApplicable.length };
    for (const r of results) summary[r.status]++;
    summary.total = results.length;
    return { results, notApplicable, summary };
  }

  function evaluateRule(rule, ctx, target, units, conditionDataMissing) {
    const base = {
      ruleId: rule.id, rule, elementId: target ? target.id : null, elementName: target ? target.name : null,
      parameter: rule.parameter, unit: units[rule.parameter] ?? rule.unit ?? null,
      actual: ctx[rule.parameter] ?? null, expected: null, demoOutcome: null,
      official: rule.verification.status !== "user",
    };
    if (conditionDataMissing) return { ...base, status: STATUS.NOT_VERIFIED, reason: "В модели нет данных, чтобы определить применимость правила" };
    if (base.actual === null) return { ...base, status: STATUS.NOT_VERIFIED, reason: `В модели нет данных для параметра «${rule.parameter}»` };
    const expected = convertValue(rule.value, rule.unit, units[rule.parameter]);
    if (expected === undefined) {
      return { ...base, status: STATUS.NOT_VERIFIED, reason: `Единицы правила (${rule.unit}) несовместимы с параметром (${units[rule.parameter]})` };
    }
    const ok = compare(base.actual, rule.operator, expected);
    if (ok === null) return { ...base, expected, status: STATUS.NOT_VERIFIED, reason: "Значения нельзя сравнить" };
    const outcome = ok ? STATUS.PASS : STATUS.FAIL;
    if (rule.verification.status === "unverified" || rule.verification.status === "demo") {
      return { ...base, expected, status: STATUS.NOT_VERIFIED, demoOutcome: outcome, reason: VERIFICATION_STATUSES[rule.verification.status] };
    }
    return { ...base, expected, status: outcome, reason: null };
  }

  BS.checker = { STATUS, VERIFICATION_STATUSES, OPERATORS, UNITS, validateRule, convertValue, compare, checkModel };
})(globalThis.BuildSense);
