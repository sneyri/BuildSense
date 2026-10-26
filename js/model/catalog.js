// Справочники: типы элементов, материалы, категории, климатические районы.
// Не зависят от Three.js и используются и в браузере, и в тестах Node.js.

export const MATERIALS = {
  brick: { label: "Кирпич", color: "#b4643c" },
  aerated_concrete: { label: "Газобетон", color: "#d8d2c4" },
  timber: { label: "Брус (дерево)", color: "#c49a6c" },
  concrete: { label: "Железобетон", color: "#9ea3a8" },
  wood_board: { label: "Деревянный настил", color: "#b98b5a" },
  metal_tile: { label: "Металлочерепица", color: "#8c3b32" },
  soft_tile: { label: "Гибкая черепица", color: "#5a4a42" },
  membrane: { label: "Рулонная кровля", color: "#4a4f55" },
  pvc_window: { label: "ПВХ-профиль, стеклопакет", color: "#f2f4f5" },
  wood_window: { label: "Деревянная рама, стеклопакет", color: "#a0703f" },
  wood_door: { label: "Деревянная дверь", color: "#7a4a24" },
  steel_door: { label: "Стальная дверь", color: "#5d6670" },
};

export const ELEMENT_TYPES = {
  foundation: {
    label: "Фундамент",
    materials: ["concrete"],
    categories: { slab: "Фундаментная плита", strip: "Ленточный фундамент" },
  },
  wall: {
    label: "Стена",
    materials: ["brick", "aerated_concrete", "timber", "concrete"],
    categories: { exterior: "Наружная стена", interior: "Внутренняя стена" },
  },
  floor: {
    label: "Пол",
    materials: ["concrete", "wood_board"],
    categories: { ground: "Пол первого этажа", slab: "Перекрытие" },
  },
  roof: {
    label: "Крыша",
    materials: ["metal_tile", "soft_tile", "membrane"],
    categories: { main: "Основная крыша", canopy: "Навес" },
  },
  window: {
    label: "Окно",
    materials: ["pvc_window", "wood_window"],
    categories: { exterior: "Окно в наружной стене", interior: "Внутреннее окно" },
  },
  door: {
    label: "Дверь",
    materials: ["wood_door", "steel_door"],
    categories: { entrance: "Входная дверь", interior: "Межкомнатная дверь" },
  },
};

export const OPENING_TYPES = ["window", "door"];

export const ROOF_TYPES = {
  gable: "Двускатная",
  flat: "Плоская",
};

// Климатические подрайоны по СП 131.13330. id — латиницей, label — как в документе.
export const CLIMATE_REGIONS = [
  ["1A", "IА"], ["1B", "IБ"], ["1V", "IВ"], ["1G", "IГ"], ["1D", "IД"],
  ["2A", "IIА"], ["2B", "IIБ"], ["2V", "IIВ"], ["2G", "IIГ"],
  ["3A", "IIIА"], ["3B", "IIIБ"], ["3V", "IIIВ"],
  ["4A", "IVА"], ["4B", "IVБ"], ["4V", "IVВ"], ["4G", "IVГ"],
].map(([id, label]) => ({ id, label }));

export const HOUSING_FUNDS = [
  { id: "private", label: "Частный жилищный фонд" },
  { id: "public", label: "Государственный или муниципальный фонд" },
];

export function materialColor(materialId) {
  return (MATERIALS[materialId] || {}).color || "#cccccc";
}

export function materialLabel(materialId) {
  return (MATERIALS[materialId] || {}).label || materialId || "—";
}

export function typeLabel(type) {
  return (ELEMENT_TYPES[type] || {}).label || type;
}

export function categoryLabel(type, category) {
  const cats = (ELEMENT_TYPES[type] || {}).categories || {};
  return cats[category] || category || "—";
}
