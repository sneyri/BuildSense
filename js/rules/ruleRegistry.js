// Реестр правил: встроенные (из data/rules через builtinRules.js) + пользовательские правила проекта.
// Пользовательские правила хранятся в project.customRules и сохраняются вместе с проектом.
(function (BS) {
  "use strict";

  /** Все встроенные правила с отметкой файла-источника. Ошибочные правила не включаются, а описываются в errors. */
  function builtin() {
    const errors = [];
    const rules = [];
    const ids = new Set();
    for (const { file, data } of (BS.builtinRules && BS.builtinRules.files) || []) {
      for (const rule of data.rules || []) {
        const problems = BS.checker.validateRule(rule);
        if (rule && ids.has(rule.id)) problems.push("повторяющийся id");
        if (problems.length) {
          errors.push(`${file} → ${(rule && rule.id) || "без id"}: ${problems.join("; ")}`);
          continue;
        }
        ids.add(rule.id);
        rules.push({ ...rule, sourceFile: file, builtin: true });
      }
    }
    return { rules, errors };
  }

  /** Встроенные + пользовательские правила проекта. */
  function all(project) {
    const { rules, errors } = builtin();
    const ids = new Set(rules.map((r) => r.id));
    for (const rule of (project && project.customRules) || []) {
      const problems = BS.checker.validateRule(rule);
      if (ids.has(rule.id)) problems.push("id совпадает с другим правилом");
      if (problems.length) {
        errors.push(`Пользовательское правило ${rule.id || "без id"}: ${problems.join("; ")}`);
        continue;
      }
      ids.add(rule.id);
      rules.push({ ...rule, sourceFile: "проект", builtin: false });
    }
    return { rules, errors };
  }

  /**
   * Создаёт пользовательское учебное правило из простой формы.
   * form: { title, description, parameter, operator, value, unit, elementType }
   */
  function makeUserRule(project, form) {
    const existing = new Set((project.customRules || []).map((r) => r.id));
    let n = existing.size + 1;
    let id = `USER-${n}`;
    while (existing.has(id)) id = `USER-${++n}`;
    const value = form.operator === "between"
      ? String(form.value).split(/[;,\s]+/).filter(Boolean).map(Number)
      : Number(String(form.value).replace(",", "."));
    const rule = {
      id,
      document: { id: "Учебное ограничение", title: "Пользовательские правила проекта (не нормативный документ)" },
      clause: "—",
      title: form.title || "Пользовательское правило",
      requirement: form.description || `${form.parameter} ${form.operator} ${form.value} ${form.unit || ""}`,
      parameter: form.parameter,
      operator: form.operator,
      value,
      unit: form.unit || null,
      applicability: {
        description: form.elementType ? `Элементы типа «${BS.types.label(form.elementType)}»` : "Весь проект",
        elementType: form.elementType || undefined,
        conditions: [],
      },
      source: { title: "Задано пользователем в BuildSense", url: null },
      verification: { status: "user", note: "Пользовательское учебное ограничение, не является официальной нормой." },
    };
    const errors = BS.checker.validateRule(rule);
    if (Array.isArray(value) ? value.some((v) => !Number.isFinite(v)) : !Number.isFinite(value)) errors.push("значение должно быть числом");
    if (errors.length) throw new Error(`Правило не создано: ${errors.join("; ")}`);
    return rule;
  }

  /** Импорт правил из JSON (формат как у data/rules/*.json). Возвращает { added, errors }. */
  function importRules(project, text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`Файл правил не является корректным JSON: ${err.message}`);
    }
    const list = Array.isArray(data) ? data : data.rules;
    if (!Array.isArray(list)) throw new Error("В файле нет списка rules");
    project.customRules = project.customRules || [];
    const known = new Set([...builtin().rules.map((r) => r.id), ...project.customRules.map((r) => r.id)]);
    const added = [];
    const errors = [];
    for (const rule of list) {
      const problems = BS.checker.validateRule(rule);
      if (rule && known.has(rule.id)) problems.push("правило с таким id уже есть");
      if (problems.length) {
        errors.push(`${(rule && rule.id) || "без id"}: ${problems.join("; ")}`);
        continue;
      }
      known.add(rule.id);
      project.customRules.push(rule);
      added.push(rule.id);
    }
    return { added, errors };
  }

  BS.ruleRegistry = { builtin, all, makeUserRule, importRules };
})(globalThis.BuildSense);
