// Условные материалы. Плотности — типичные справочные значения для учебных оценок
// собственного веса; модуль упругости и «учебное допустимое напряжение» — НЕ нормативные
// расчётные сопротивления, а пользовательские допущения для демонстрации формул.
(function (BS) {
  "use strict";

  /**
   * density — кг/м³; E — модуль упругости, ГПа (для балок); allowStress — учебное допустимое
   * напряжение при изгибе, МПа (задаётся пользователем, по умолчанию — условное значение).
   */
  const MATERIALS = {
    concrete: { label: "Железобетон", color: "#9ea3a8", density: 2500, E: 30, allowStress: 10 },
    brick: { label: "Кирпич", color: "#b4643c", density: 1800, E: null, allowStress: null },
    aerated: { label: "Газобетон", color: "#d8d2c4", density: 500, E: null, allowStress: null },
    timber: { label: "Дерево (брус)", color: "#c49a6c", density: 500, E: 10, allowStress: 10 },
    steel: { label: "Сталь", color: "#7d8791", density: 7850, E: 210, allowStress: 160 },
    glass: { label: "Стекло", color: "#7fb6e0", density: 2500, E: null, allowStress: null },
    metal_tile: { label: "Металлочерепица", color: "#8c3b32", density: 7850, E: null, allowStress: null },
    soft_tile: { label: "Гибкая черепица", color: "#5a4a42", density: 1400, E: null, allowStress: null },
    membrane: { label: "Рулонная кровля", color: "#4a4f55", density: 1200, E: null, allowStress: null },
    pvc: { label: "ПВХ-профиль", color: "#f2f4f5", density: 1400, E: null, allowStress: null },
    wood_door: { label: "Дерево (дверь)", color: "#7a4a24", density: 600, E: null, allowStress: null },
    ceramic: { label: "Керамика", color: "#f5f6f7", density: 2300, E: null, allowStress: null },
    fabric: { label: "Ткань / мебель", color: "#6d7fa3", density: 300, E: null, allowStress: null },
    plastic: { label: "Пластик", color: "#e9ecef", density: 1200, E: null, allowStress: null },
    zone: { label: "Зона (без материала)", color: "#4cc9f0", density: 0, E: null, allowStress: null },
  };

  BS.materials = {
    MATERIALS,
    get(id) {
      return MATERIALS[id] || { label: id || "—", color: "#cccccc", density: 0, E: null, allowStress: null };
    },
    label(id) {
      return (MATERIALS[id] || {}).label || id || "—";
    },
    color(id) {
      return (MATERIALS[id] || {}).color || "#cccccc";
    },
  };
})(globalThis.BuildSense);
