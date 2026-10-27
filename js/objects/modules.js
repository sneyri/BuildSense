// Библиотека модульных узлов: типовые элементы со ссылкой на стандарт на изделие.
// Узел — это обычный элемент реестра типов (стена, перекрытие, лестница) с заранее заданными
// категорией, материалом и размерами; в params.node хранится идентификатор узла.
// Размеры узлов — демонстрационные значения: соответствие типоразмерам стандарта не сверено
// (статус показывается пользователю, как у правил норм).
(function (BS) {
  "use strict";
  const U = BS.util;

  const NOT_VERIFIED = "Размеры — демонстрационные; соответствие типоразмерам стандарта не сверено.";

  const NODES = [
    { id: "panel_ext", label: "Наружная стеновая панель", icon: "wall", base: "wall", category: "exterior", material: "concrete",
      size: { thickness: 0.3 }, standard: "ГОСТ 11024-2024", standardTitle: "Панели стеновые наружные бетонные и железобетонные для жилых и общественных зданий" },
    { id: "aerated_wall", label: "Стена из газобетона", icon: "wall", base: "wall", category: "exterior", material: "aerated",
      size: { thickness: 0.4 }, standard: "ГОСТ 31360-2024", standardTitle: "Изделия для каменной кладки. Блоки из ячеистого бетона автоклавного твердения" },
    { id: "hollow_slab", label: "Плита многопустотная", icon: "slab", base: "slab", category: "floor", material: "concrete",
      size: { height: 0.22 }, standard: "ГОСТ 9561-2016", standardTitle: "Плиты перекрытий железобетонные многопустотные для зданий и сооружений" },
    { id: "stair_flight", label: "Лестничный марш", icon: "stairs", base: "stairs", category: null, material: "concrete",
      size: { width: 1.05 }, standard: "ГОСТ 9818-2015", standardTitle: "Марши и площадки лестниц железобетонные" },
  ];
  const BY_ID = new Map(NODES.map((n) => [n.id, n]));

  /** Узлы, которых пока нет в библиотеке (показываются как план). */
  const PLANNED = [
    { label: "Санитарно-техническая кабина", standard: "ГОСТ 18048-2018" },
    { label: "Шахта лифта", standard: "ГОСТ 17538-2016" },
  ];

  function get(id) {
    return BY_ID.get(id) || null;
  }

  /** Применяет узел к только что созданному элементу базового типа. Длину, нарисованную мышью, не трогает. */
  function apply(project, elId, nodeId) {
    const node = get(nodeId);
    const el = BS.project.find(project, elId);
    if (!node || !el) throw new Error(`Узел ${nodeId} не применён`);
    if (el.type !== node.base) throw new Error(`Узел «${node.label}» строится как «${BS.types.label(node.base)}»`);
    const patch = { material: node.material, size: U.clone(node.size), params: { node: node.id } };
    if (node.category) patch.category = node.category;
    patch.name = `${node.label} ${el.id.split("-")[1]}`;
    return BS.project.updateElement(project, elId, patch);
  }

  function ofElement(el) {
    return el && el.params && el.params.node ? get(el.params.node) : null;
  }

  BS.modules = { NODES, PLANNED, NOT_VERIFIED, get, apply, ofElement };
})(globalThis.BuildSense);
