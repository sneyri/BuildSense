// BIM-код элемента по правилу именования из проекта стандарта организации:
// <объект>-<секция>-Э<этаж>-<раздел>-<тип>-<номер>, например ЖК01-С1-Э02-КР-ПЛТ-003.
// Код вычисляется из модели (не хранится): этаж — порядковый номер по отметке, номер — порядок элемента
// среди элементов того же кода типа. Объект и секция задаются во вкладке «Проект».
(function (BS) {
  "use strict";

  /** Коды типов (3 буквы, где возможно). */
  const TYPE_CODES = {
    slab_foundation: "ФПЛ", strip_foundation: "ФЛН", pad_foundation: "ФСТ", round_pad: "ФКР", pile: "СВ",
    wall: "СТН", column: "КЛН", round_column: "КЛН", beam: "БЛК", slab: "ПЛТ", lintel: "ПРМ", truss: "ФРМ",
    stairs: "ЛМ", landing: "ЛП", roof: "КРШ", window: "ОК", door: "ДВ", balcony: "БЛН", terrace: "ТРС",
    railing: "ОГР", chimney: "ДМХ", room: "ПМЩ", decor: "КРН", pipe: "ТРБ", toilet: "УНТ", sink: "РКВ",
    bath: "ВНН", light: "СВТ", socket: "РЗТ", switch: "ВКЛ",
  };
  /** Раздел проекта: КР — конструктивные решения, АР — архитектурные, ВК — водопровод и канализация, ЭО — электрооборудование. */
  const DISCIPLINE_BY_GROUP = { foundation: "КР", structure: "КР", roof: "КР", architecture: "АР", engineering: "ВК", furniture: "АР" };
  const DISCIPLINE_BY_TYPE = { light: "ЭО", socket: "ЭО", switch: "ЭО", window: "АР", door: "АР", lintel: "КР" };

  const pad = (n, w) => String(n).padStart(w, "0");

  function typeCode(el) {
    if (el.type === "wall" && el.category === "partition") return "ПРГ";
    const t = BS.types.get(el.type);
    return TYPE_CODES[el.type] || (t && t.group === "furniture" ? "МБЛ" : "ЭЛМ");
  }

  function discipline(el) {
    if (DISCIPLINE_BY_TYPE[el.type]) return DISCIPLINE_BY_TYPE[el.type];
    const t = BS.types.get(el.type);
    return (t && DISCIPLINE_BY_GROUP[t.group]) || "АР";
  }

  /** Коды всех элементов проекта: Map id → код. */
  function all(project) {
    const bim = (project.settings && project.settings.bim) || {};
    const prefix = `${bim.object || "ЖК01"}-${bim.section || "С1"}`;
    const levels = project.levels.slice().sort((a, b) => a.elevation - b.elevation);
    const levelNo = new Map(levels.map((l, i) => [l.id, i + 1]));
    const counters = new Map();
    const out = new Map();
    for (const el of project.elements) {
      const tc = typeCode(el);
      const n = (counters.get(tc) || 0) + 1;
      counters.set(tc, n);
      out.set(el.id, `${prefix}-Э${pad(levelNo.get(el.levelId) || 1, 2)}-${discipline(el)}-${tc}-${pad(n, 3)}`);
    }
    return out;
  }

  function code(project, el) {
    return all(project).get(el.id) || null;
  }

  BS.bimCode = { TYPE_CODES, all, code, typeCode, discipline };
})(globalThis.BuildSense);
