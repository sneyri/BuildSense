// Правая панель «Проект»: место строительства, границы участка, учебный профиль, нагрузки.
(function (BS) {
  "use strict";
  const { el, numberField, selectField, textField } = BS.dom;

  const CLIMATE_REGIONS = [
    ["1A", "IА"], ["1B", "IБ"], ["1V", "IВ"], ["1G", "IГ"], ["1D", "IД"], ["2A", "IIА"], ["2B", "IIБ"], ["2V", "IIВ"], ["2G", "IIГ"],
    ["3A", "IIIА"], ["3B", "IIIБ"], ["3V", "IIIВ"], ["4A", "IVА"], ["4B", "IVБ"], ["4V", "IVВ"], ["4G", "IVГ"],
  ];

  /** h: onSettings(patch), onLevel(id, patch), onDeleteLevel(id) */
  function render(root, project, h) {
    const s = project.settings;
    const num = (label, value, unit, step, patch, title) => numberField({ label, value, unit, step, title, onChange: (v) => h.onSettings(patch(v)) });
    BS.dom.fill(root, el("div", { class: "form" },
      el("h3", {}, "Место строительства"),
      selectField({ label: "Климатический подрайон (СП 131.13330)", wide: true, value: s.climateRegion,
        options: CLIMATE_REGIONS.map(([value, label]) => ({ value, label })), onChange: (v) => h.onSettings({ climateRegion: v }) }),
      selectField({ label: "Жилищный фонд", wide: true, value: s.housingFund,
        options: [{ value: "private", label: "Частный" }, { value: "public", label: "Государственный или муниципальный" }], onChange: (v) => h.onSettings({ housingFund: v }) }),

      el("h3", {}, "BIM-код элементов"),
      el("p", { class: "note" }, "Правило именования: объект-секция-Э<этаж>-<раздел>-<тип>-<номер>, например ЖК01-С1-Э02-КР-ПЛТ-003."),
      textField({ label: "Код объекта", value: (s.bim || {}).object, onChange: (v) => h.onSettings({ bim: { object: v || "ЖК01" } }) }),
      textField({ label: "Код секции / корпуса", value: (s.bim || {}).section, onChange: (v) => h.onSettings({ bim: { section: v || "С1" } }) }),

      el("h3", {}, "Этажи"),
      ...project.levels.map((l) => el("div", { class: "card" },
        el("strong", {}, l.name),
        num("Отметка пола", l.elevation, "м", 0.05, (v) => ({ __level: [l.id, { elevation: v }] })),
        num("Высота этажа (до верха стен)", l.height, "м", 0.05, (v) => ({ __level: [l.id, { height: v }] })),
        project.levels.length > 1 ? el("button", { type: "button", class: "danger", onclick: () => h.onDeleteLevel(l.id) }, "Удалить этаж (без элементов)") : null)),

      el("h3", {}, "Границы участка"),
      num("Начало X", s.site.x, "м", 1, (v) => ({ site: { x: v } })),
      num("Начало Y", s.site.y, "м", 1, (v) => ({ site: { y: v } })),
      num("Длина участка", s.site.length, "м", 1, (v) => ({ site: { length: v } })),
      num("Ширина участка", s.site.width, "м", 1, (v) => ({ site: { width: v } })),
      num("Предельная высота", s.site.maxHeight, "м", 1, (v) => ({ site: { maxHeight: v } })),

      el("h3", {}, "Учебный профиль (пользовательские ограничения)"),
      el("p", { class: "note" }, "Не нормы: ориентиры для предварительных конструктивных проверок. Меняйте под задание преподавателя."),
      num("Мин. толщина наружной стены", s.profile.minExteriorWall, "м", 0.01, (v) => ({ profile: { minExteriorWall: v } })),
      num("Мин. толщина внутренней несущей", s.profile.minInteriorWall, "м", 0.01, (v) => ({ profile: { minInteriorWall: v } })),
      num("Мин. толщина перегородки", s.profile.minPartition, "м", 0.01, (v) => ({ profile: { minPartition: v } })),
      num("Мин. сечение колонны", s.profile.minColumn, "м", 0.01, (v) => ({ profile: { minColumn: v } })),
      num("Мин. толщина перекрытия", s.profile.minSlab, "м", 0.01, (v) => ({ profile: { minSlab: v } })),
      num("Предельный пролёт балки", s.profile.maxBeamSpan, "м", 0.5, (v) => ({ profile: { maxBeamSpan: v } })),
      num("Пролёт / высота балки, не более", s.profile.maxBeamSpanToDepth, "", 1, (v) => ({ profile: { maxBeamSpanToDepth: v } })),
      num("Предельный пролёт перекрытия", s.profile.maxSlabSpan, "м", 0.5, (v) => ({ profile: { maxSlabSpan: v } })),
      num("Гибкость стены h/t, не более", s.profile.maxSlenderness, "", 1, (v) => ({ profile: { maxSlenderness: v } })),
      num("Гибкость отдельной стены, не более", s.profile.freeWallSlenderness, "", 1, (v) => ({ profile: { freeWallSlenderness: v } })),

      el("h3", {}, "Нагрузки для симуляции и расчётов"),
      el("p", { class: "note" }, "Учебные значения, задаются вами — не нормативные нагрузки."),
      num("Пользовательская нагрузка на перекрытие", s.loads.liveLoad, "кПа", 0.5, (v) => ({ loads: { liveLoad: v } })),
      num("Условная несущая способность перекрытия", s.loads.slabCapacity, "кПа", 0.5, (v) => ({ loads: { slabCapacity: v } })),
      num("Нагрузка на балку", s.loads.lineLoad ?? 5, "кН/м", 0.5, (v) => ({ loads: { lineLoad: v } })),
      num("Предел прогиба L/n, n =", s.loads.deflectionLimit ?? 250, "", 10, (v) => ({ loads: { deflectionLimit: v } }))));
  }

  BS.ui = BS.ui || {};
  BS.ui.settingsPanel = { render, CLIMATE_REGIONS };
})(globalThis.BuildSense);
