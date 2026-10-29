// Экспорт модели в JSON для макроса freecad/import_house.FCMacro (схема buildsense-freecad-export, версия 2).
// Все длины — в миллиметрах (единица FreeCAD), координаты мировые, ось Z вверх.
// Для проёмов дополнительно вычислены вырез (void) и заполнение (panel), чтобы макросу не пересчитывать геометрию.
(function (BS) {
  "use strict";
  const U = BS.util;
  const G = BS.geometry;
  const S = BS.shapes;

  const FORMAT = "buildsense-freecad-export";
  const VERSION = 2;
  const VOID_MARGIN = 0.05;
  const mm = (v) => U.round(v * 1000, 2);
  const point = (p) => ({ x: mm(p.x), y: mm(p.y), z: mm(p.z) });

  /** @returns {{ data: object, warnings: string[] }} */
  function build(project, extra = {}) {
    const warnings = [];
    const elements = [];
    const graph = BS.loadGraph ? BS.loadGraph.build(project) : null;
    for (const el of project.elements) {
      const t = BS.types.get(el.type);
      if (!t) { warnings.push(`${el.id}: неизвестный тип ${el.type} — пропущен`); continue; }
      const sizeOk = Object.values(el.size || {}).every((v) => Number.isFinite(v) && v > 0);
      if (!sizeOk) { warnings.push(`${el.id}: некорректные размеры — пропущен`); continue; }
      const mat = BS.materials.get(el.material);
      const base = {
        id: el.id, type: el.type, typeLabel: t.label, shape: t.shape, ifcType: t.ifc || null,
        name: el.name, category: el.category || null, levelId: el.levelId,
        material: el.material, materialLabel: mat.label, color: mat.color, density: mat.density,
        params: U.clone(el.params || {}),
        relations: {
          hostId: el.hostId || (el.params && el.params.hostWallId) || null,
          hosted: project.elements.filter((o) => o.hostId === el.id).map((o) => o.id),
          supports: graph && graph.get(el.id) ? [...graph.get(el.id).supports.keys()] : [],
        },
      };
      if (t.shape === "opening") {
        const host = project.elements.find((w) => w.id === el.hostId && w.type === "wall");
        if (!host) { warnings.push(`${el.id}: стена-основа ${el.hostId} не найдена — проём не экспортирован`); continue; }
        elements.push({ ...base, ...openingGeometry(el, host) });
        continue;
      }
      const size = {};
      for (const [k, v] of Object.entries(el.size)) size[k] = mm(v);
      if (t.shape === "roof") size.rise = mm(S.roofRise(el));
      elements.push({ ...base, placement: { ...point(el.position), rotationZ: U.round(el.rotation || 0, 3) }, size });
    }
    const data = {
      format: FORMAT,
      schemaVersion: VERSION,
      units: "mm",
      generator: `BuildSense ${BS.version}`,
      exportedAt: U.nowIso(),
      axes: "Z вверх; placement — точка привязки элемента (угол бруса, центр основания цилиндра, начало оси трубы) и поворот вокруг Z в градусах",
      project: { name: project.name, climateRegion: project.settings.climateRegion, housingFund: project.settings.housingFund },
      levels: project.levels.map((l) => ({ id: l.id, name: l.name, elevation: mm(l.elevation), height: mm(l.height) })),
      elements,
    };
    if (extra.summary) data.validationSummary = extra.summary;
    return { data, warnings };
  }

  function openingGeometry(el, host) {
    const L = host.size.length, H = host.size.height, t = host.size.thickness;
    const { offset, elevation } = el.position;
    const { width, height } = el.size;
    const e = 1e-6;
    const u0 = offset <= e ? offset - VOID_MARGIN : offset;
    const u1 = offset + width >= L - e ? offset + width + VOID_MARGIN : offset + width;
    const w0 = elevation <= e ? elevation - VOID_MARGIN : elevation;
    const w1 = elevation + height >= H - e ? elevation + height + VOID_MARGIN : elevation + height;
    const panelT = Math.min(el.type === "door" ? 0.05 : 0.06, t);
    const rotationZ = U.round(host.rotation || 0, 3);
    return {
      hostId: host.id,
      size: { width: mm(width), height: mm(height) },
      position: { offset: mm(offset), elevation: mm(elevation) },
      hostThickness: mm(t),
      placement: { ...point(G.localToWorld(host, offset, 0, elevation)), rotationZ },
      void: { placement: { ...point(G.localToWorld(host, u0, -VOID_MARGIN, w0)), rotationZ }, size: { length: mm(u1 - u0), width: mm(t + 2 * VOID_MARGIN), height: mm(w1 - w0) } },
      panel: { placement: { ...point(G.localToWorld(host, offset, (t - panelT) / 2, elevation)), rotationZ }, size: { length: mm(width), width: mm(panelT), height: mm(height) } },
    };
  }

  BS.freecadExport = { FORMAT, VERSION, build };
})(globalThis.BuildSense);
