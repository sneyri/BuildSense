// Левая панель: общие параметры дома и проекта.
import { CLIMATE_REGIONS, HOUSING_FUNDS, ROOF_TYPES } from "../model/catalog.js";
import { LIMITS } from "../model/project.js";
import { el, numberField, selectField } from "./dom.js";

/**
 * @param {HTMLFormElement} form
 * @param {object} project
 * @param {{ onHouseChange: (key, value) => void, onSettingChange: (key, value) => void, onRebuild: () => void }} handlers
 */
export function renderHouseForm(form, project, handlers) {
  const h = project.house;
  const lim = LIMITS.house;
  const num = (key, label, unit = "м", step = 0.05) =>
    numberField({
      label, unit, step, value: h[key], min: lim[key][0], max: lim[key][1],
      title: `Допустимо: ${lim[key][0]}–${lim[key][1]} ${unit}`,
      onChange: (v) => handlers.onHouseChange(key, v),
    });

  form.replaceChildren(
    num("length", "Длина (по X)"),
    num("width", "Ширина (по Y)"),
    num("wallHeight", "Высота стен"),
    num("wallThickness", "Толщина стен", "м", 0.01),
    num("floorThickness", "Толщина пола", "м", 0.01),
    num("foundationThickness", "Толщина фундамента", "м", 0.05),
    selectField({
      label: "Тип крыши",
      value: h.roofType,
      options: Object.entries(ROOF_TYPES).map(([value, label]) => ({ value, label })),
      onChange: (v) => handlers.onHouseChange("roofType", v),
    }),
    h.roofType === "gable" ? num("roofSlope", "Уклон крыши", "°", 1) : num("roofThickness", "Толщина крыши", "м", 0.01),
    num("roofOverhang", "Свес крыши"),
    el("hr", { class: "form-sep" }),
    selectField({
      label: "Климатический подрайон (СП 131.13330)",
      wide: true,
      value: project.settings.climateRegion,
      options: CLIMATE_REGIONS.map((r) => ({ value: r.id, label: r.label })),
      onChange: (v) => handlers.onSettingChange("climateRegion", v),
    }),
    selectField({
      label: "Жилищный фонд",
      wide: true,
      value: project.settings.housingFund,
      options: HOUSING_FUNDS.map((f) => ({ value: f.id, label: f.label })),
      onChange: (v) => handlers.onSettingChange("housingFund", v),
    }),
    el("p", { class: "form-note" },
      "Габариты применяются к наружным стенам, полу и крыше. Окна и двери остаются на своих стенах."),
    el("div", { class: "form-actions" },
      el("button", {
        type: "button",
        title: "Удалить все элементы и построить дом заново по этим параметрам",
        onclick: handlers.onRebuild,
      }, "Пересоздать дом по параметрам")
    )
  );
}
