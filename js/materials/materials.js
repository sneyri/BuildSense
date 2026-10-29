// Условные материалы. Плотности — типичные справочные значения для учебных оценок
// собственного веса; модуль упругости и «учебное допустимое напряжение» — НЕ нормативные
// расчётные сопротивления, а пользовательские допущения для демонстрации формул.
(function (BS) {
  "use strict";

  /**
   * density — кг/м³; E — модуль упругости, ГПа (для балок); allowStress — учебное допустимое
   * напряжение при изгибе, МПа (задаётся пользователем, по умолчанию — условное значение).
   */
  /*
   * Вид в 3D: color — основной цвет, roughness/metalness — параметры PBR-материала Three.js,
   * texture — процедурная текстура (рисуется кодом в js/scene/meshBuilder.js, без файлов):
   * "brick" — кладка, "block" — газоблок, "wood" — доски/брус, "tile" — черепица, "concrete" — бетон,
   * "metal" — профлист; tile — размер повторения текстуры в метрах.
   * id существующих материалов не меняются (на них ссылаются сохранённые проекты и правила).
   */
  const MATERIALS = {
    concrete: { label: "Железобетон", color: "#9ea3a8", density: 2500, E: 30, allowStress: 10, roughness: 0.92, metalness: 0, texture: "concrete", tile: 2 },
    brick: { label: "Кирпич", color: "#b4643c", density: 1800, E: null, allowStress: null, roughness: 0.9, metalness: 0, texture: "brick", tile: 1 },
    aerated: { label: "Газобетон", color: "#d8d2c4", density: 500, E: null, allowStress: null, roughness: 0.95, metalness: 0, texture: "block", tile: 1.25 },
    timber: { label: "Дерево (брус)", color: "#c49a6c", density: 500, E: 10, allowStress: 10, roughness: 0.8, metalness: 0, texture: "wood", tile: 1 },
    steel: { label: "Сталь", color: "#7d8791", density: 7850, E: 210, allowStress: 160, roughness: 0.4, metalness: 0.7 },
    glass: { label: "Стекло", color: "#7fb6e0", density: 2500, E: null, allowStress: null, roughness: 0.1, metalness: 0 },
    metal_tile: { label: "Металлочерепица", color: "#8c3b32", density: 7850, E: null, allowStress: null, roughness: 0.45, metalness: 0.35, texture: "tile", tile: 1.2 },
    soft_tile: { label: "Гибкая черепица", color: "#5a4a42", density: 1400, E: null, allowStress: null, roughness: 0.9, metalness: 0, texture: "tile", tile: 1 },
    membrane: { label: "Рулонная кровля", color: "#4a4f55", density: 1200, E: null, allowStress: null, roughness: 0.85, metalness: 0, texture: "concrete", tile: 3 },
    pvc: { label: "ПВХ-профиль", color: "#f2f4f5", density: 1400, E: null, allowStress: null, roughness: 0.5, metalness: 0 },
    wood_door: { label: "Дерево (дверь)", color: "#7a4a24", density: 600, E: null, allowStress: null, roughness: 0.7, metalness: 0, texture: "wood", tile: 1 },
    ceramic: { label: "Керамика", color: "#f5f6f7", density: 2300, E: null, allowStress: null, roughness: 0.25, metalness: 0 },
    fabric: { label: "Ткань / мебель", color: "#6d7fa3", density: 300, E: null, allowStress: null, roughness: 1, metalness: 0 },
    plastic: { label: "Пластик", color: "#e9ecef", density: 1200, E: null, allowStress: null, roughness: 0.6, metalness: 0 },
    zone: { label: "Зона (без материала)", color: "#4cc9f0", density: 0, E: null, allowStress: null, roughness: 1, metalness: 0 },
    // Новые материалы (учебные плотности — типичные справочные значения)
    ceramic_block: { label: "Керамический блок", color: "#c27b4f", density: 800, E: null, allowStress: null, roughness: 0.9, metalness: 0, texture: "block", tile: 1 },
    silicate_brick: { label: "Силикатный кирпич", color: "#e4e1d8", density: 1800, E: null, allowStress: null, roughness: 0.9, metalness: 0, texture: "brick", tile: 1 },
    log: { label: "Бревно / клеёный брус", color: "#b98654", density: 500, E: 10, allowStress: 10, roughness: 0.75, metalness: 0, texture: "wood", tile: 1.5 },
    clay_tile: { label: "Керамическая черепица", color: "#a8502e", density: 1900, E: null, allowStress: null, roughness: 0.8, metalness: 0, texture: "tile", tile: 1 },
    profiled_sheet: { label: "Профлист", color: "#6b7d8c", density: 7850, E: null, allowStress: null, roughness: 0.4, metalness: 0.5, texture: "metal", tile: 1 },
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
    /** Параметры вида в 3D: { color, roughness, metalness, texture, tile }. */
    look(id) {
      const m = MATERIALS[id] || {};
      return { color: m.color || "#cccccc", roughness: m.roughness ?? 0.85, metalness: m.metalness ?? 0.02, texture: m.texture || null, tile: m.tile || 1 };
    },
  };
})(globalThis.BuildSense);
