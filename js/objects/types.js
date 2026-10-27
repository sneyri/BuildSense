// Реестр типов строительных объектов. Чтобы добавить новый тип, достаточно описать его здесь:
// группа, форма геометрии (shape), размеры по умолчанию, поля свойств, материалы и роль в
// передаче нагрузки (support). Построение 3D, проверки, симуляция и экспорт работают по этим описаниям.
//
// shape: "box" — брус length × width × height с углом в position;
//        "wall" — стена length × thickness × height с проёмами;
//        "cylinder" — цилиндр diameter × height, position — центр основания;
//        "opening" — окно/дверь в стене (hostId, position.offset/elevation);
//        "roof", "stairs", "truss", "railing", "pipe", "balcony", "zone", "fixture".
// support: "ground"  — опирается на грунт (фундаменты);
//          "gravity" — должен стоять на другом элементе (несущем, если bearing);
//          "attached" — крепится к стене/перекрытию (балкон, светильник);
//          "hosted"  — живёт в стене (проёмы); "none" — не участвует (комнаты-зоны).
(function (BS) {
  "use strict";

  const L = (label, min, max, step = 0.05, unit = "м") => ({ label, min, max, step, unit });

  const GROUPS = {
    foundation: { label: "Фундамент", order: 1 },
    structure: { label: "Несущие конструкции", order: 2 },
    roof: { label: "Крыша", order: 3 },
    architecture: { label: "Архитектура", order: 4 },
    engineering: { label: "Инженерия", order: 5 },
    furniture: { label: "Мебель", order: 6 },
  };

  const BOX_FIELDS = (l, w, h) => ({ "size.length": l, "size.width": w, "size.height": h });

  const TYPES = {
    // ---------------------------------------------------------------- фундамент
    slab_foundation: {
      group: "foundation", label: "Плитный фундамент", icon: "slab", shape: "box", support: "ground", bearing: true,
      hint: "Монолитная плита под всем домом. Верх плиты — отметка 0, на него ставятся стены.",
      materials: ["concrete"], size: { length: 10, width: 8, height: 0.4 }, z: "below",
      fields: BOX_FIELDS(L("Длина", 0.5, 60), L("Ширина", 0.5, 60), L("Толщина", 0.1, 3)),
      ifc: "Footing",
    },
    strip_foundation: {
      group: "foundation", label: "Ленточный фундамент", icon: "strip", shape: "box", support: "ground", bearing: true,
      hint: "Лента под несущими стенами. Рисуется как стена: по двум точкам.",
      materials: ["concrete"], size: { length: 6, width: 0.5, height: 1.2 }, z: "below",
      fields: BOX_FIELDS(L("Длина", 0.3, 60), L("Ширина", 0.2, 2), L("Высота", 0.2, 4)),
      ifc: "Footing",
    },
    pad_foundation: {
      group: "foundation", label: "Столбчатая опора", icon: "pad", shape: "box", support: "ground", bearing: true,
      hint: "Отдельная прямоугольная опора под колонну или угол дома.",
      materials: ["concrete"], size: { length: 0.6, width: 0.6, height: 1.2 }, z: "below",
      fields: BOX_FIELDS(L("Длина", 0.2, 4), L("Ширина", 0.2, 4), L("Высота", 0.2, 4)),
      ifc: "Footing",
    },
    round_pad: {
      group: "foundation", label: "Круглая опора", icon: "round", shape: "cylinder", support: "ground", bearing: true,
      hint: "Круглая буронабивная опора.",
      materials: ["concrete"], size: { diameter: 0.4, height: 1.5 }, z: "below",
      fields: { "size.diameter": L("Диаметр", 0.1, 2, 0.05), "size.height": L("Высота", 0.3, 6) },
      ifc: "Footing",
    },
    pile: {
      group: "foundation", label: "Свая", icon: "pile", shape: "cylinder", support: "ground", bearing: true,
      hint: "Упрощённая свая: цилиндр, погружённый в грунт.",
      materials: ["concrete", "steel"], size: { diameter: 0.3, height: 3 }, z: "below",
      fields: { "size.diameter": L("Диаметр", 0.1, 1.5, 0.05), "size.height": L("Длина", 1, 20, 0.1) },
      ifc: "Pile",
    },

    // ---------------------------------------------------------------- несущие конструкции
    wall: {
      group: "structure", label: "Стена", icon: "wall", shape: "wall", support: "gravity", bearing: true,
      hint: "Рисуется по двум точкам. Наружная стена строится по наружной грани, перегородка — по оси.",
      categories: { exterior: "Наружная несущая", interior: "Внутренняя несущая", partition: "Перегородка" },
      materials: ["brick", "aerated", "timber", "concrete"], size: { length: 4, thickness: 0.4, height: 2.8 },
      fields: { "size.length": L("Длина", 0.2, 60), "size.thickness": L("Толщина", 0.05, 1.2, 0.01), "size.height": L("Высота", 0.5, 10) },
      ifc: "Wall",
    },
    column: {
      group: "structure", label: "Колонна", icon: "column", shape: "box", support: "gravity", bearing: true,
      hint: "Прямоугольная колонна. Ставится щелчком; встаёт на фундамент или перекрытие.",
      materials: ["concrete", "steel", "timber"], size: { length: 0.3, width: 0.3, height: 2.8 },
      fields: BOX_FIELDS(L("Сечение a", 0.1, 2, 0.05), L("Сечение b", 0.1, 2, 0.05), L("Высота", 0.5, 10)),
      ifc: "Column",
    },
    round_column: {
      group: "structure", label: "Круглая колонна", icon: "round", shape: "cylinder", support: "gravity", bearing: true,
      hint: "Круглая колонна.", materials: ["concrete", "steel"], size: { diameter: 0.3, height: 2.8 },
      fields: { "size.diameter": L("Диаметр", 0.1, 2, 0.05), "size.height": L("Высота", 0.5, 10) },
      ifc: "Column",
    },
    beam: {
      group: "structure", label: "Балка", icon: "beam", shape: "box", support: "gravity", bearing: true, spanning: true,
      hint: "Рисуется по двум точкам между опорами (колоннами, стенами). Низ балки ставится на верх опор.",
      materials: ["timber", "steel", "concrete"], size: { length: 4, width: 0.15, height: 0.25 },
      fields: BOX_FIELDS(L("Пролёт (длина)", 0.5, 20), L("Ширина сечения", 0.05, 1, 0.01), L("Высота сечения", 0.05, 1.5, 0.01)),
      ifc: "Beam",
    },
    slab: {
      group: "structure", label: "Перекрытие / пол", icon: "slab", shape: "box", support: "gravity", bearing: true, spanning: true,
      hint: "Плита пола или междуэтажного перекрытия. Рисуется прямоугольником.",
      categories: { ground: "Пол первого этажа", floor: "Междуэтажное перекрытие", attic: "Чердачное перекрытие" },
      materials: ["concrete", "timber"], size: { length: 4, width: 4, height: 0.2 },
      fields: BOX_FIELDS(L("Длина", 0.3, 60), L("Ширина", 0.3, 60), L("Толщина", 0.05, 1, 0.01)),
      ifc: "Slab",
    },
    lintel: {
      group: "structure", label: "Перемычка", icon: "beam", shape: "box", support: "gravity", bearing: true,
      hint: "Брус над проёмом. Кнопка «Перемычки над проёмами» в свойствах стены создаёт их автоматически.",
      materials: ["concrete", "steel", "timber"], size: { length: 1.8, width: 0.4, height: 0.2 },
      fields: BOX_FIELDS(L("Длина", 0.3, 8), L("Ширина", 0.05, 1.2, 0.01), L("Высота", 0.05, 0.8, 0.01)),
      ifc: "Beam",
    },
    truss: {
      group: "structure", label: "Ферма", icon: "truss", shape: "truss", support: "gravity", bearing: true, spanning: true,
      hint: "Простая треугольная ферма с раскосами. Опирается концами на стены.",
      materials: ["timber", "steel"], size: { length: 6, width: 0.1, height: 1.5 }, params: { panels: 4 },
      fields: { ...BOX_FIELDS(L("Пролёт", 1, 30), L("Толщина", 0.04, 0.5, 0.01), L("Высота", 0.3, 5)), "params.panels": L("Панелей", 2, 12, 1, "шт") },
      ifc: "Member",
    },
    stairs: {
      group: "structure", label: "Лестница", icon: "stairs", shape: "stairs", support: "gravity", bearing: true,
      hint: "Прямой марш. Высота должна доходить до пола следующего этажа.",
      materials: ["concrete", "timber", "steel"], size: { length: 4.2, width: 1.0, height: 3.0 }, params: { steps: 17 },
      fields: { ...BOX_FIELDS(L("Длина марша", 1, 12), L("Ширина", 0.6, 3), L("Высота подъёма", 0.3, 6)), "params.steps": L("Ступеней", 3, 40, 1, "шт") },
      ifc: "Stair",
    },
    landing: {
      group: "structure", label: "Площадка", icon: "slab", shape: "box", support: "gravity", bearing: true,
      hint: "Лестничная площадка.", materials: ["concrete", "timber"], size: { length: 1.2, width: 1.2, height: 0.2 },
      fields: BOX_FIELDS(L("Длина", 0.5, 6), L("Ширина", 0.5, 6), L("Толщина", 0.05, 0.6, 0.01)),
      ifc: "Slab",
    },

    // ---------------------------------------------------------------- крыша
    roof: {
      group: "roof", label: "Крыша", icon: "roof", shape: "roof", support: "gravity", bearing: true,
      hint: "Плоская, односкатная, двускатная или вальмовая. Низ крыши ложится на верх стен.",
      materials: ["metal_tile", "soft_tile", "membrane"], size: { length: 10.8, width: 8.8 },
      params: { roofType: "gable", slope: 30, thickness: 0.25 },
      fields: {
        "size.length": L("Длина", 0.5, 70), "size.width": L("Ширина (пролёт)", 0.5, 70),
        "params.slope": L("Уклон", 0, 70, 1, "°"), "params.thickness": L("Толщина (плоская)", 0.03, 1, 0.01),
      },
      selects: { "params.roofType": { label: "Форма", options: { flat: "Плоская", shed: "Односкатная", gable: "Двускатная", hip: "Вальмовая" } } },
      ifc: "Roof",
    },

    // ---------------------------------------------------------------- архитектура
    window: {
      group: "architecture", label: "Окно", icon: "window", shape: "opening", support: "hosted",
      hint: "Наведите на стену и щёлкните. Проём вырезается в стене.",
      materials: ["pvc", "timber"], size: { width: 1.5, height: 1.4 }, sill: 0.9,
      fields: { "size.width": L("Ширина", 0.3, 6), "size.height": L("Высота", 0.3, 4), "position.offset": L("Отступ от начала стены", 0, 60), "position.elevation": L("Подоконник", 0, 10) },
      ifc: "Window",
    },
    door: {
      group: "architecture", label: "Дверь", icon: "door", shape: "opening", support: "hosted",
      hint: "Наведите на стену и щёлкните.", materials: ["wood_door", "steel"], size: { width: 0.9, height: 2.1 }, sill: 0,
      categories: { entrance: "Входная", interior: "Межкомнатная" },
      fields: { "size.width": L("Ширина", 0.5, 4), "size.height": L("Высота", 1.5, 3.5), "position.offset": L("Отступ от начала стены", 0, 60) },
      ifc: "Door",
    },
    balcony: {
      group: "architecture", label: "Балкон", icon: "balcony", shape: "balcony", support: "attached", bearing: true,
      hint: "Консольная плита с ограждением. Должна примыкать к стене.",
      materials: ["concrete"], size: { length: 3, width: 1.2, height: 0.15 },
      fields: BOX_FIELDS(L("Длина", 0.8, 10), L("Вынос", 0.5, 3), L("Толщина", 0.08, 0.4, 0.01)),
      ifc: "Slab",
    },
    terrace: {
      group: "architecture", label: "Терраса", icon: "slab", shape: "box", support: "gravity", bearing: false,
      hint: "Настил у дома.", materials: ["timber", "concrete"], size: { length: 4, width: 3, height: 0.15 },
      fields: BOX_FIELDS(L("Длина", 0.5, 30), L("Ширина", 0.5, 30), L("Толщина", 0.05, 0.6, 0.01)),
      ifc: "Slab",
    },
    railing: {
      group: "architecture", label: "Перила", icon: "railing", shape: "railing", support: "gravity", bearing: false,
      hint: "Ограждение по линии.", materials: ["steel", "timber"], size: { length: 3, width: 0.05, height: 1.0 },
      fields: BOX_FIELDS(L("Длина", 0.3, 30), L("Толщина", 0.02, 0.2, 0.01), L("Высота", 0.5, 1.5)),
      ifc: "Railing",
    },
    chimney: {
      group: "architecture", label: "Дымоход", icon: "chimney", shape: "box", support: "gravity", bearing: false,
      hint: "Кирпичный дымоход.", materials: ["brick", "steel"], size: { length: 0.6, width: 0.6, height: 1.5 },
      fields: BOX_FIELDS(L("Длина", 0.2, 3), L("Ширина", 0.2, 3), L("Высота", 0.3, 15)),
      ifc: "Chimney",
    },
    room: {
      group: "architecture", label: "Комната (зона)", icon: "room", shape: "zone", support: "none", bearing: false, nonSolid: true,
      hint: "Условная зона помещения: название и площадь. Не является конструкцией.",
      materials: ["zone"], size: { length: 4, width: 3, height: 2.6 }, params: { roomName: "Комната", roomType: "common" },
      fields: BOX_FIELDS(L("Длина", 0.5, 40), L("Ширина", 0.5, 40), L("Высота", 1, 10)),
      texts: { "params.roomName": "Название" },
      selects: { "params.roomType": { label: "Назначение", options: { common: "Общая комната (гостиная)", bedroom: "Спальня", kitchen: "Кухня", bath: "Санузел", hall: "Прихожая / коридор", other: "Другое" } } },
      ifc: "Space",
    },
    decor: {
      group: "architecture", label: "Декор (карниз)", icon: "decor", shape: "box", support: "attached", bearing: false,
      hint: "Простой декоративный элемент — например, карниз на фасаде.",
      materials: ["concrete", "timber"], size: { length: 2, width: 0.15, height: 0.15 },
      fields: BOX_FIELDS(L("Длина", 0.1, 30), L("Вынос", 0.03, 1, 0.01), L("Высота", 0.03, 1, 0.01)),
      ifc: "BuildingElementProxy",
    },

    // ---------------------------------------------------------------- инженерия
    pipe: {
      group: "engineering", label: "Труба", icon: "pipe", shape: "pipe", support: "none", bearing: false, nonSolid: true,
      hint: "Прямой участок трубы вдоль оси элемента.", materials: ["steel", "plastic"], size: { length: 3, diameter: 0.05 },
      params: { vertical: false },
      fields: { "size.length": L("Длина", 0.1, 30), "size.diameter": L("Диаметр", 0.01, 0.6, 0.01) },
      checks: { "params.vertical": "Вертикальная (стояк)" },
      ifc: "Pipe",
    },
    toilet: fixture("Унитаз", "toilet", { length: 0.4, width: 0.7, height: 0.8 }, "ceramic", "SanitaryTerminal"),
    sink: fixture("Раковина", "sink", { length: 0.6, width: 0.45, height: 0.85 }, "ceramic", "SanitaryTerminal"),
    bathtub: fixture("Ванна", "bathtub", { length: 1.7, width: 0.75, height: 0.6 }, "ceramic", "SanitaryTerminal"),
    light: { ...fixture("Светильник", "light", { length: 0.4, width: 0.4, height: 0.15 }, "plastic", "LightFixture"), support: "attached" },
    socket: { ...fixture("Розетка", "socket", { length: 0.08, width: 0.03, height: 0.08 }, "plastic", "Outlet"), support: "attached" },
    switch: { ...fixture("Выключатель", "switch", { length: 0.08, width: 0.03, height: 0.08 }, "plastic", "SwitchingDevice"), support: "attached" },

    // ---------------------------------------------------------------- мебель
    bed: furniture("Кровать", "bed", { length: 2.0, width: 1.6, height: 0.5 }),
    table: furniture("Стол", "table", { length: 1.4, width: 0.8, height: 0.75 }),
    chair: furniture("Стул", "chair", { length: 0.45, width: 0.45, height: 0.9 }),
    sofa: furniture("Диван", "sofa", { length: 2.0, width: 0.9, height: 0.85 }),
    wardrobe: furniture("Шкаф", "wardrobe", { length: 1.2, width: 0.6, height: 2.1 }),
  };

  function fixture(label, recipe, size, material, ifc) {
    return {
      group: "engineering", label, icon: recipe, shape: "fixture", recipe, support: "gravity", bearing: false,
      hint: "Условная 3D-модель для заполнения помещения.", materials: [material], size,
      fields: BOX_FIELDS(L("Длина", 0.02, 5, 0.01), L("Ширина", 0.02, 5, 0.01), L("Высота", 0.02, 3, 0.01)),
      ifc,
    };
  }

  function furniture(label, recipe, size) {
    return { ...fixture(label, recipe, size, "fabric", "Furniture"), group: "furniture", materials: ["fabric", "timber"] };
  }

  for (const [id, t] of Object.entries(TYPES)) {
    t.id = id;
    t.params = t.params || {};
    t.categories = t.categories || null;
  }

  BS.types = {
    GROUPS,
    TYPES,
    get(id) {
      return TYPES[id] || null;
    },
    label(id) {
      return (TYPES[id] || {}).label || id;
    },
    byGroup() {
      const out = {};
      for (const t of Object.values(TYPES)) (out[t.group] || (out[t.group] = [])).push(t);
      return out;
    },
    isFoundation(el) {
      return (TYPES[el.type] || {}).support === "ground";
    },
    isBearing(el) {
      const t = TYPES[el.type];
      if (!t || !t.bearing) return false;
      return !(el.type === "wall" && el.category === "partition");
    },
  };
})(globalThis.BuildSense);
