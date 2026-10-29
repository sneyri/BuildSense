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
    "room.clearHeight": { label: "Высота помещений первого этажа", unit: "m", note: "От верха пола первого этажа до низа перекрытия или верха наружных стен." },
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
    const building = {
      "project.climateRegion": project.settings.climateRegion ?? null,
      "project.housingFund": project.settings.housingFund ?? null,
      "building.storeys": storeyLevels.size || null,
      "building.height": maxTop === null ? null : U.round(maxTop, 3),
      "building.floorArea": floors.length ? U.round(floorArea, 3) : null,
      "building.windowArea": U.round(windowArea, 3),
      "building.glazingRatio": floorArea > 0 ? U.round(windowArea / floorArea, 4) : null,
      "room.clearHeight": clearHeight(project),
    };
    const elements = els.map((el) => ({ id: el.id, type: el.type, name: el.name, values: elementValues(el) }));
    return { units: units(), building, elements };
  }

  function clearHeight(project) {
    const first = project.levels.slice().sort((a, b) => a.elevation - b.elevation)[0];
    const ground = project.elements.filter((e) => e.type === "slab" && e.levelId === first.id && e.category === "ground");
    if (!ground.length) return null;
    const floorTop = Math.min(...ground.map((g) => S.top(g, project)));
    const ceilings = [];
    for (const w of project.elements.filter((e) => e.type === "wall" && e.category === "exterior" && e.levelId === first.id)) {
      ceilings.push(S.top(w, project));
    }
    for (const s of project.elements.filter((e) => e.type === "slab" && S.bottom(e, project) > floorTop + 0.01)) {
      ceilings.push(S.bottom(s, project));
    }
    return ceilings.length ? U.round(Math.min(...ceilings) - floorTop, 3) : null;
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
