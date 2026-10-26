// Правая панель: свойства выбранного элемента.
import { ELEMENT_TYPES, ROOF_TYPES, categoryLabel, materialLabel, typeLabel } from "../model/catalog.js";
import { LIMITS } from "../model/project.js";
import { elementBounds, roofRise, wallLocalToWorld } from "../model/placement.js";
import { el, formatRu, numberField, readonlyField, selectField, textField } from "./dom.js";

/**
 * @param {HTMLElement} root
 * @param {object} project
 * @param {string|null} selectedId
 * @param {{ onChange: (id, patch) => void, onDelete: (id) => void, onAddOpening: (type, wallId) => void, onSelect: (id) => void }} handlers
 */
export function renderProperties(root, project, selectedId, handlers) {
  const element = project.elements.find((e) => e.id === selectedId);
  if (!element) {
    root.replaceChildren(renderProjectSummary(project));
    return;
  }

  const change = (patch) => handlers.onChange(element.id, patch);
  const typeInfo = ELEMENT_TYPES[element.type];
  const lim = LIMITS[element.type] || {};
  const sizeField = (key, label, step = 0.05) =>
    numberField({
      label, step, value: element.size[key], min: lim[key]?.[0], max: lim[key]?.[1],
      onChange: (v) => change({ size: { [key]: v } }),
    });
  const posField = (key, label) =>
    numberField({ label, step: 0.05, value: element.position[key], onChange: (v) => change({ position: { [key]: v } }) });

  const fields = [
    readonlyField("Идентификатор", element.id),
    readonlyField("Тип", typeLabel(element.type)),
    textField({ label: "Название", value: element.name, onChange: (v) => change({ name: v || element.id }) }),
    selectField({
      label: "Категория",
      value: element.category,
      options: Object.entries(typeInfo.categories).map(([value, label]) => ({ value, label })),
      onChange: (v) => change({ category: v }),
    }),
    selectField({
      label: "Материал",
      value: element.material,
      options: typeInfo.materials.map((m) => ({ value: m, label: materialLabel(m) })),
      onChange: (v) => change({ material: v }),
    }),
    el("hr", { class: "form-sep" }),
  ];

  if (["wall", "floor", "foundation", "roof"].includes(element.type)) {
    fields.push(posField("x", "Начало X"), posField("y", "Начало Y"), posField("z", "Низ Z"),
      numberField({ label: "Поворот вокруг Z", unit: "°", step: 5, value: element.rotation, onChange: (v) => change({ rotation: v }) }));
  }

  if (element.type === "wall") {
    fields.push(sizeField("length", "Длина"), sizeField("thickness", "Толщина", 0.01), sizeField("height", "Высота"));
  } else if (element.type === "floor" || element.type === "foundation") {
    fields.push(sizeField("length", "Длина (по оси элемента)"), sizeField("width", "Ширина"), sizeField("thickness", "Толщина", 0.01));
  } else if (element.type === "roof") {
    fields.push(
      sizeField("length", "Длина (вдоль конька)"),
      sizeField("width", "Ширина (пролёт)"),
      selectField({
        label: "Тип крыши",
        value: element.params.roofType,
        options: Object.entries(ROOF_TYPES).map(([value, label]) => ({ value, label })),
        onChange: (v) => change({ params: { roofType: v } }),
      }),
      element.params.roofType === "gable"
        ? numberField({ label: "Уклон", unit: "°", step: 1, value: element.params.slope, min: lim.slope[0], max: lim.slope[1], onChange: (v) => change({ params: { slope: v } }) })
        : numberField({ label: "Толщина", step: 0.01, value: element.params.thickness, onChange: (v) => change({ params: { thickness: v } }) }),
      readonlyField("Высота подъёма", `${formatRu(roofRise(element), 2)} м`)
    );
  } else if (element.type === "window" || element.type === "door") {
    const walls = project.elements.filter((e) => e.type === "wall");
    const host = walls.find((w) => w.id === element.hostId);
    fields.push(
      selectField({
        label: "Стена-основа",
        value: element.hostId,
        options: walls.map((w) => ({ value: w.id, label: `${w.name} (${w.id})` })),
        onChange: (v) => change({ hostId: v }),
      }),
      numberField({ label: "Отступ от начала стены", step: 0.05, value: element.position.offset, onChange: (v) => change({ position: { offset: v } }) }),
      numberField({
        label: element.type === "window" ? "Высота подоконника" : "Низ проёма",
        step: 0.05, value: element.position.elevation, onChange: (v) => change({ position: { elevation: v } }),
      }),
      sizeField("width", "Ширина проёма"),
      sizeField("height", "Высота проёма"),
      readonlyField("Площадь проёма", `${formatRu(element.size.width * element.size.height, 2)} м²`)
    );
    if (host) {
      const p = wallLocalToWorld(host, element.position.offset, 0, element.position.elevation);
      fields.push(readonlyField("Мировые координаты", `${formatRu(p.x, 2)}; ${formatRu(p.y, 2)}; ${formatRu(p.z, 2)}`));
    }
  }

  const bounds = elementBounds(element, project);
  if (bounds) {
    fields.push(readonlyField("Верх элемента (Z)", `${formatRu(bounds.max.z, 2)} м`));
  }
  if (element.shell) {
    fields.push(el("p", { class: "form-note" }, "Элемент связан с параметрами дома: изменение габаритов слева перестроит его. Ручная правка размеров снимет эту связь."));
  }

  const actions = el("div", { class: "form-actions" });
  if (element.type === "wall") {
    actions.append(
      el("button", { type: "button", onclick: () => handlers.onAddOpening("window", element.id) }, "+ Окно"),
      el("button", { type: "button", onclick: () => handlers.onAddOpening("door", element.id) }, "+ Дверь")
    );
  }
  if (element.hostId) {
    actions.append(el("button", { type: "button", onclick: () => handlers.onSelect(element.hostId) }, "К стене"));
  }
  actions.append(el("button", { type: "button", class: "danger", onclick: () => handlers.onDelete(element.id) }, "Удалить"));
  fields.push(actions);

  root.replaceChildren(el("div", { class: "form" }, fields));
}

function renderProjectSummary(project) {
  const count = (type) => project.elements.filter((e) => e.type === type).length;
  return el("div", { class: "form" },
    el("p", { class: "empty" }, "Элемент не выбран. Щёлкните по элементу в 3D-сцене или в списке слева."),
    readonlyField("Стен", count("wall")),
    readonlyField("Полов / перекрытий", count("floor")),
    readonlyField("Крыш", count("roof")),
    readonlyField("Окон", count("window")),
    readonlyField("Дверей", count("door")),
    readonlyField("Категории стен", [...new Set(project.elements.filter((e) => e.type === "wall").map((e) => categoryLabel("wall", e.category)))].join(", ") || "—")
  );
}
