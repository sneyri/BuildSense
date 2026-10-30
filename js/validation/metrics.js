// Проверяемые параметры модели для правил (нормативных и пользовательских).
// Результат — простой объект; checker.js не знает о геометрии.
(function (BS) {
  "use strict";
  const S = BS.shapes;
  const U = BS.util;

  const PARAMETERS = {
    "project.climateRegion": { label: "Климатический подрайон", unit: null },
    "project.housingFund": { label: "Жилищный фонд", unit: null },
    "building.storeys": { label: "Количество надземных этажей", unit: "count", note: "Этажи проекта, на которых есть наружные стены." },
    "building.height": { label: "Высота дома", unit: "m", note: "От отметки 0 (условная отметка земли) до верхней точки модели." },
    "building.floorArea": { label: "Площадь полов этажей", unit: "m2" },
    "building.windowArea": { label: "Площадь окон в наружных стенах", unit: "m2" },
    "building.glazingRatio": { label: "Отношение площади окон к площади пола", unit: "ratio", note: "Считается по всему дому, а не по каждой комнате." },
    "room.clearHeight": { label: "Высота помещений этажа", unit: "m", note: "Для каждого этажа: от верха пола этажа до низа перекрытия над ним или до верха наружных стен; отделка не учитывается. На уровне здания — наименьшее значение по этажам." },
    "storey.slopedCeiling": { label: "Потолок образован скатами крыши", unit: null, note: "Над этажом нет перекрытия, этаж накрыт скатной крышей: высота у стен — наименьшая, к коньку потолок выше." },
    "element.category": { label: "Категория элемента", unit: null },
    "wall.length": { label: "Длина стены", unit: "m" },
    "wall.thickness": { label: "Толщина стены", unit: "m" },
    "wall.height": { label: "Высота стены", unit: "m" },
    "column.section": { label: "Меньший размер сечения колонны", unit: "m" },
    "beam.span": { label: "Длина (пролёт) балки", unit: "m" },
    "beam.depth": { label: "Высота сечения балки", unit: "m" },
    "slab.thickness": { label: "Толщина перекрытия", unit: "m" },
    "slab.area": { label: "Площадь перекрытия", unit: "m2" },
    "foundation.depth": { label: "Заглубление фундамента ниже отметки 0", unit: "m" },
    "roof.type": { label: "Тип крыши", unit: null },
    "roof.slope": { label: "Уклон крыши", unit: "deg" },
    "window.width": { label: "Ширина окна", unit: "m" },
    "window.height": { label: "Высота окна", unit: "m" },
    "window.sillHeight": { label: "Высота подоконника", unit: "m" },
    "window.area": { label: "Площадь окна", unit: "m2" },
    "door.width": { label: "Ширина дверного проёма", unit: "m" },
    "door.height": { label: "Высота дверного проёма", unit: "m" },
    "stairs.riser": { label: "Высота ступени", unit: "m" },
    "stairs.tread": { label: "Глубина ступени", unit: "m" },
    "stairs.width": { label: "Ширина марша", unit: "m" },
    "railing.height": { label: "Высота ограждения", unit: "m" },
    "room.area": { label: "Площадь комнаты", unit: "m2" },
    "room.type": { label: "Назначение комнаты", unit: null },
    "room.height": { label: "Высота зоны комнаты", unit: "m" },
  };

  function units() {
    return Object.fromEntries(Object.entries(PARAMETERS).map(([k, v]) => [k, v.unit]));
  }

  function collect(project) {
    const els = project.elements;
    const exterior = els.filter((e) => e.type === "wall" && e.category === "exterior");
    const storeyLevels = new Set(exterior.map((w) => w.levelId));
    const floors = els.filter((e) => e.type === "slab" && (e.category === "ground" || e.category === "floor"));
    const floorArea = floors.reduce((s, f) => s + f.size.length * f.size.width, 0);
    const windows = els.filter((e) => e.type === "window" && exterior.some((w) => w.id === e.hostId));
    const windowArea = windows.reduce((s, w) => s + w.size.width * w.size.height, 0);
    let maxTop = null;
    for (const el of els) {
      const t = BS.types.get(el.type);
      if (!t || t.nonSolid || t.shape === "opening") continue;
      const top = S.top(el, project);
      if (maxTop === null || top > maxTop) maxTop = top;
    }
    const storeys = storeyValues(project);
    const heights = storeys.map((s) => s.values["room.clearHeight"]).filter((v) => v !== null);
    const building = {
      "project.climateRegion": project.settings.climateRegion ?? null,
      "project.housingFund": project.settings.housingFund ?? null,
      "building.storeys": storeyLevels.size || null,
      "building.height": maxTop === null ? null : U.round(maxTop, 3),
      "building.floorArea": floors.length ? U.round(floorArea, 3) : null,
      "building.windowArea": U.round(windowArea, 3),
      "building.glazingRatio": floorArea > 0 ? U.round(windowArea / floorArea, 4) : null,
      "room.clearHeight": heights.length ? Math.min(...heights) : null,
    };
    const elements = els.map((el) => ({ id: el.id, type: el.type, name: el.name, values: elementValues(el) }));
    elements.push(...storeys);
    return { units: units(), building, elements };
  }

  /**
   * Этажи как объекты проверки (type "storey"): высота помещений этажа и признак наклонного потолка.
   * Этаж учитывается, если на нём есть наружные стены. memberIds — стены этажа (для подсветки в 3D).
   */
  function storeyValues(project) {
    const out = [];
    const els = project.elements;
    const slabs = els.filter((e) => e.type === "slab");
    const roofs = els.filter((e) => e.type === "roof");
    for (const lv of project.levels.slice().sort((a, b) => a.elevation - b.elevation)) {
      const walls = els.filter((e) => e.type === "wall" && e.category === "exterior" && e.levelId === lv.id);
      if (!walls.length) continue;
      // Пол этажа: плита пола этого этажа (верх около отметки этажа или выше — на толщину пола)
      const floors = slabs.filter((s) => s.levelId === lv.id && (s.category === "ground" || s.category === "floor") &&
        S.top(s, project) >= lv.elevation - 0.05 && S.top(s, project) <= lv.elevation + 0.6);
      const wallTop = Math.min(...walls.map((w) => S.top(w, project)));
      let height = null, sloped = null;
      if (floors.length) {
        const floorTop = Math.max(...floors.map((f) => S.top(f, project)));
        const above = slabs.filter((s) => S.bottom(s, project) > floorTop + 0.5 && S.bottom(s, project) <= wallTop + 0.6);
        const ceiling = Math.min(wallTop, ...above.map((s) => S.bottom(s, project)));
        height = U.round(ceiling - floorTop, 3);
        sloped = !above.length && roofs.some((r) => (r.params && r.params.roofType) !== "flat");
      }
      out.push({ id: lv.id, type: "storey", name: lv.name, memberIds: walls.map((w) => w.id),
        values: { "room.clearHeight": height, "storey.slopedCeiling": sloped } });
    }
    return out;
  }

  function elementValues(el) {
    const v = { "element.category": el.category };
    const s = el.size || {};
    switch (el.type) {
      case "wall": Object.assign(v, { "wall.length": s.length, "wall.thickness": s.thickness, "wall.height": s.height }); break;
      case "column": v["column.section"] = Math.min(s.length, s.width); break;
      case "round_column": v["column.section"] = s.diameter; break;
      case "beam": Object.assign(v, { "beam.span": s.length, "beam.depth": s.height }); break;
      case "slab": Object.assign(v, { "slab.thickness": s.height, "slab.area": U.round(s.length * s.width, 3) }); break;
      case "roof": Object.assign(v, { "roof.type": el.params.roofType, "roof.slope": el.params.roofType === "flat" ? null : el.params.slope }); break;
      case "window": Object.assign(v, { "window.width": s.width, "window.height": s.height, "window.sillHeight": el.position.elevation, "window.area": U.round(s.width * s.height, 3) }); break;
      case "door": Object.assign(v, { "door.width": s.width, "door.height": s.height }); break;
      case "stairs": {
        const n = Math.max(1, el.params.steps || 1);
        Object.assign(v, { "stairs.riser": U.round(s.height / n, 3), "stairs.tread": U.round(s.length / n, 3), "stairs.width": s.width });
        break;
      }
      case "railing": v["railing.height"] = s.height; break;
      case "room": Object.assign(v, { "room.area": U.round(s.length * s.width, 3), "room.type": el.params.roomType || null, "room.height": s.height }); break;
      default:
        if (BS.types.isFoundation(el)) v["foundation.depth"] = U.round(Math.max(0, -el.position.z), 3);
    }
    return v;
  }

  BS.metrics = { PARAMETERS, units, collect, elementValues };
})(globalThis.BuildSense);
