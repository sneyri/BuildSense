// Пошаговый мастер создания дома (8 шагов). Каждый шаг объясняет, что делать, предлагает
// автоматическое построение или инструмент мыши и показывает, выполнен ли шаг (по состоянию модели).
(function (BS) {
  "use strict";
  const { el, numberField, selectField, iconButton } = BS.dom;
  const fmt = BS.util.fmt;

  const has = (p, pred) => p.elements.some(pred);

  const STEPS = [
    {
      title: "1. Фундамент",
      text: "Фундамент передаёт вес дома на грунт. Задайте размеры дома и создайте плиту — или нарисуйте ленточный фундамент и отдельные опоры инструментами.",
      inputs: (p, h) => [
        numberField({ label: "Длина дома", value: p.house.length, step: 0.5, onChange: (v) => h.onHouse({ length: v }) }),
        numberField({ label: "Ширина дома", value: p.house.width, step: 0.5, onChange: (v) => h.onHouse({ width: v }) }),
        numberField({ label: "Толщина плиты", value: p.house.foundationThickness, step: 0.05, onChange: (v) => h.onHouse({ foundationThickness: v }) }),
      ],
      actions: [["slab", "Создать плиту фундамента", "wiz-foundation"], ["strip", "Ленточный (рисовать)", "tool:strip_foundation"], ["pad", "Опоры (ставить)", "tool:pad_foundation"]],
      done: (p) => has(p, (e) => BS.types.isFoundation(e)),
      doneText: "Фундамент есть.",
    },
    {
      title: "2. Стены и несущие элементы",
      text: "Наружные стены строятся по контуру фундамента автоматически или рисуются мышью (щелчки по углам — магнит притянет). Внутри дома рисуются перегородки и колонны.",
      inputs: (p, h) => [
        numberField({ label: "Высота стен", value: p.house.wallHeight, step: 0.05, onChange: (v) => h.onHouse({ wallHeight: v }) }),
        numberField({ label: "Толщина наружных стен", value: p.house.wallThickness, step: 0.01, onChange: (v) => h.onHouse({ wallThickness: v }) }),
      ],
      actions: [["wall", "Стены по контуру фундамента", "wiz-walls"], ["wall", "Рисовать стену", "tool:wall"], ["column", "Колонна", "tool:column"]],
      done: (p) => p.elements.filter((e) => e.type === "wall" && e.category === "exterior").length >= 3,
      doneText: "Наружные стены построены.",
    },
    {
      title: "3. Этажи и перекрытия",
      text: "Пол первого этажа кладётся внутри стен. Кнопка «Добавить этаж» создаёт перекрытие над стенами и копию наружных стен выше.",
      actions: [["slab", "Пол первого этажа", "wiz-floor"], ["level", "Добавить этаж", "add-level"], ["beam", "Балка (рисовать)", "tool:beam"]],
      done: (p) => has(p, (e) => e.type === "slab"),
      doneText: "Перекрытие есть.",
    },
    {
      title: "4. Окна и двери",
      text: "Расставьте проёмы автоматически (окно в каждую наружную стену и входная дверь) или выберите инструмент и щёлкните по стене.",
      actions: [["window", "Расставить автоматически", "wiz-openings"], ["window", "Окно", "tool:window"], ["door", "Дверь", "tool:door"]],
      done: (p) => has(p, (e) => e.type === "door") && has(p, (e) => e.type === "window"),
      doneText: "Есть окна и дверь.",
    },
    {
      title: "5. Крыша",
      text: "Крыша ложится на верх наружных стен верхнего этажа со свесом.",
      inputs: (p, h) => [
        selectField({ label: "Форма крыши", value: p.house.roofType, options: [{ value: "gable", label: "Двускатная" }, { value: "hip", label: "Вальмовая" }, { value: "shed", label: "Односкатная" }, { value: "flat", label: "Плоская" }], onChange: (v) => h.onHouse({ roofType: v }) }),
        numberField({ label: "Уклон", unit: "°", value: p.house.roofSlope, step: 1, onChange: (v) => h.onHouse({ roofSlope: v }) }),
        numberField({ label: "Свес", value: p.house.roofOverhang, step: 0.05, onChange: (v) => h.onHouse({ roofOverhang: v }) }),
      ],
      actions: [["roof", "Крыша над домом", "roof-over"]],
      done: (p) => has(p, (e) => e.type === "roof"),
      doneText: "Крыша есть.",
    },
    {
      title: "6. Проверка проекта",
      text: "Проверки запускаются автоматически. Красное — ошибка, оранжевое — предупреждение. Щёлкните сообщение — камера покажет элемент. У многих сообщений есть кнопка «Исправить».",
      actions: [["check", "Открыть список проблем", "tab:problems"]],
      done: (p, f, v) => v && v.summary.error === 0,
      doneText: "Ошибок нет.",
      todoText: (p, f, v) => (v ? `Ошибок: ${v.summary.error}, предупреждений: ${v.summary.warning}.` : ""),
    },
    {
      title: "7. Демонстрационная симуляция",
      text: "Выберите сценарий (например, отказ опоры), элемент и запустите. Это наглядная иллюстрация по правилам опирания, а не расчёт прочности.",
      actions: [["play", "Открыть симуляцию", "tab:sim"]],
      done: (p, f) => f.simulated,
      doneText: "Симуляция запускалась.",
    },
    {
      title: "8. Экспорт",
      text: "Сохраните проект (JSON) и выгрузите модель для FreeCAD: в FreeCAD запустите макрос freecad/import_house.FCMacro и выберите файл.",
      actions: [["save", "Сохранить проект", "save"], ["export", "Экспорт в FreeCAD", "export"], ["code", "Скачать макрос", "macro"]],
      done: (p, f) => f.exported,
      doneText: "Модель выгружена.",
    },
  ];

  /**
   * state: { project, wizardStep, flags, validation }
   * h: onAction(name), onHouse(patch), onStep(i), onClose()
   */
  function render(root, state, h) {
    const i = Math.max(0, Math.min(STEPS.length - 1, state.wizardStep));
    const st = STEPS[i];
    const done = st.done(state.project, state.flags, state.validation);
    const actions = st.actions.map(([icon, label, action]) => iconButton(icon, label, () => h.onAction(action), { class: action.startsWith("wiz") || action === "roof-over" ? "primary" : null }));
    BS.dom.fill(root, 
      el("header", {}, el("strong", {}, "Мастер создания дома"), el("button", { type: "button", onclick: h.onClose, title: "Закрыть мастер" }, "✕")),
      el("div", { class: "steps" }, STEPS.map((s, k) => el("span", {
        class: k === i ? "cur" : s.done(state.project, state.flags, state.validation) ? "done" : "",
        title: s.title,
      }))),
      el("div", { class: "body" },
        el("h4", {}, st.title),
        el("p", {}, st.text),
        st.inputs ? el("div", { class: "form" }, st.inputs(state.project, h)) : null,
        el("div", { class: "actions" }, actions),
        el("div", { class: `status ${done ? "ok" : "todo"}` }, done ? `✓ ${st.doneText}` : (st.todoText ? st.todoText(state.project, state.flags, state.validation) : "") || "Шаг ещё не выполнен.")),
      el("div", { class: "nav" },
        el("button", { type: "button", disabled: i === 0, onclick: () => h.onStep(i - 1) }, "← Назад"),
        el("span", { class: "note" }, `${i + 1} из ${STEPS.length}`),
        el("button", { type: "button", class: "primary", disabled: i === STEPS.length - 1, onclick: () => h.onStep(i + 1) }, "Далее →")));
  }

  BS.ui = BS.ui || {};
  BS.ui.wizard = { render, STEPS, fmt };
})(globalThis.BuildSense);
