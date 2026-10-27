// Оболочка здания: исходные данные для теплотехнического расчёта по СП 50.13330 «Тепловая защита зданий».
// Считаются площади по габаритам элементов модели; сам теплотехнический расчёт (сопротивление
// теплопередаче, удельная характеристика) не выполняется.
(function (BS) {
  "use strict";
  const U = BS.util;
  const G = BS.geometry;
  const S = BS.shapes;

  /** Площадь ската крыши по габаритам: плоская — план, скатные — план / cos(уклона). */
  function roofArea(el) {
    const plan = el.size.length * el.size.width;
    const type = (el.params && el.params.roofType) || "gable";
    if (type === "flat") return plan;
    const slope = ((el.params && el.params.slope) || 0) * Math.PI / 180;
    return plan / Math.cos(slope);
  }

  /**
   * @returns {null | { wallGross, windows, doors, wallNet, glazingFacade, roof, footprint, height, volume, envelope, compactness, counts }}
   *   площади — м², объём — м³; null, если в модели нет наружных стен.
   */
  function compute(project) {
    const walls = project.elements.filter((e) => e.type === "wall" && e.category === "exterior");
    if (!walls.length) return null;
    const ids = new Set(walls.map((w) => w.id));
    let wallGross = 0, windows = 0, doors = 0, nWin = 0, nDoor = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const w of walls) {
      wallGross += w.size.length * w.size.height;
      for (const [u, v] of [[0, 0], [w.size.length, 0], [0, w.size.thickness], [w.size.length, w.size.thickness]]) {
        const p = G.localToWorld(w, u, v, 0);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      zMin = Math.min(zMin, S.bottom(w, project)); zMax = Math.max(zMax, S.top(w, project));
    }
    for (const o of project.elements) {
      if (!ids.has(o.hostId)) continue;
      const a = o.size.width * o.size.height;
      if (o.type === "window") { windows += a; nWin++; } else if (o.type === "door") { doors += a; nDoor++; }
    }
    const roof = project.elements.filter((e) => e.type === "roof").reduce((s, r) => s + roofArea(r), 0);
    const footprint = (maxX - minX) * (maxY - minY);
    const height = zMax - zMin;
    const volume = footprint * height;
    // Наружные стены + пол первого этажа + перекрытие верхнего этажа (условно по пятну застройки)
    const envelope = wallGross + 2 * footprint;
    const r = (v, d = 2) => U.round(v, d);
    return {
      wallGross: r(wallGross), windows: r(windows), doors: r(doors), wallNet: r(wallGross - windows - doors),
      glazingFacade: r(windows / wallGross, 4), roof: r(roof), footprint: r(footprint), height: r(height, 3),
      volume: r(volume), envelope: r(envelope), compactness: volume > 0 ? r(envelope / volume, 3) : null,
      counts: { walls: walls.length, windows: nWin, doors: nDoor },
    };
  }

  BS.envelope = { compute, roofArea };
})(globalThis.BuildSense);
