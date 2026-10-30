// Генерирует крупные архитектурные прототипы в examples/prototypes/ теми же модулями, что и редактор.
// Запуск: node tools/make-prototypes.js
// Результат: *.buildsense.json (проект), *.freecad.json (экспорт для макроса FreeCAD)
// и examples/prototypes.js — те же проекты для меню «Новый» (работает по file://).
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadBS, ROOT } from "../tests/loader.js";

const BS = loadBS();
const P = BS.project, C = BS.contour;
const FIXED = "2026-10-30T12:00:00.000Z";
const dir = path.join(ROOT, "examples", "prototypes");
mkdirSync(dir, { recursive: true });

/** Новый пустой проект с участком под большой дом. */
function base(name, { site, house = {}, climate = "2V" } = {}) {
  const p = P.createProject(name);
  p.elements = [];
  p.plan = { contours: [] };
  Object.assign(p.house, house);
  p.levels = [{ id: "L1", name: "Этаж 1", elevation: 0, height: p.house.wallHeight }];
  p.settings.climateRegion = climate;
  p.settings.site = { x: -15, y: -15, length: 100, width: 80, maxHeight: 40, ...site };
  return p;
}

/** Контур → плита/лента → стены → пол → проёмы → перемычки. Возвращает контур этажа 1. */
function shell(p, pts, { found = { type: "slab", thickness: 0.5 }, wall = {}, floorT = 0.2 } = {}) {
  const c = C.addContour(p, pts, { levelId: "L1" });
  C.foundationFromContour(p, c.id, found);
  C.wallsFromContour(p, c.id, { thickness: p.house.wallThickness, height: p.house.wallHeight, material: "brick", ...wall });
  C.slabFromContour(p, c.id, { kind: "ground", thickness: floorT });
  return c;
}

/**
 * Проёмы наружных стен этажа: на каждой стене окна ровными шагами, на первой стене первого этажа
 * в середине — входная дверь. Перемычки над всеми проёмами.
 */
function openings(p, levelId, { slot = 3.2, width = 1.5, height, doorWidth = 1.2, doorHeight = 2.2, door = true } = {}) {
  const ws = p.elements.filter((e) => e.type === "wall" && e.category === "exterior" && e.levelId === levelId);
  let doorDone = !door;
  for (const w of ws) {
    const L = w.size.length, margin = 0.9;
    const n = Math.floor((L - 2 * margin) / slot);
    if (n < 1) continue;
    const step = (L - 2 * margin) / n;
    for (let i = 0; i < n; i++) {
      const centre = margin + step * (i + 0.5);
      if (!doorDone && i === Math.floor(n / 2)) {
        P.placeOpening(p, "door", w.id, centre - doorWidth / 2, { size: { width: doorWidth, height: doorHeight } });
        doorDone = true;
      } else {
        P.placeOpening(p, "window", w.id, centre - width / 2, { size: height ? { width, height } : { width } });
      }
    }
    P.addLintels(p, w.id);
  }
}

/** Колонна/опора с точной высотой: от своего основания до отметки topZ. */
function post(p, type, x, y, levelId, topZ) {
  const el = P.placeAt(p, type, { x, y }, { levelId });
  el.size.height = Math.round((topZ - el.position.z) * 1000) / 1000;
  return el;
}

const out = [];
const add = (key, p, note) => out.push({ key, p, note });

// ============================================================ 1. Загородная усадьба (Г-образная, 2 этажа + мансарда-крыша)
{
  const p = base("Усадьба «Берёзовая роща» (Г-образная, 2 этажа)", { house: { wallHeight: 3.0, wallThickness: 0.5, slabThickness: 0.25 } });
  const pts = [{ x: 0, y: 0 }, { x: 22, y: 0 }, { x: 22, y: 9 }, { x: 11, y: 9 }, { x: 11, y: 18 }, { x: 0, y: 18 }];
  shell(p, pts, { found: { type: "strip", width: 0.7, depth: 1.5 }, wall: { material: "ceramic_block" } });
  openings(p, "L1", { slot: 3.4, width: 1.6 });
  P.addLevel(p, { copyWalls: true });
  const c2 = C.forLevel(p, "L2")[0];
  C.roofFromContour(p, c2.id, { roofType: "hip", slope: 35, overhang: 0.7, material: "clay_tile" });
  P.addRect(p, "terrace", { x: 0, y: -4 }, { x: 8, y: 0 }, { levelId: "L1" });
  P.addRect(p, "terrace", { x: 14, y: 9 }, { x: 22, y: 13 }, { levelId: "L1" });
  P.placeAt(p, "chimney", { x: 17, y: 4.5 }, { levelId: "L2" }).size.height = 5.2;
  P.placeAt(p, "stairs", { x: 5.5, y: 3 }, { levelId: "L1", rotation: 0 });
  add("estate", p, "Г-образная усадьба: ленточный фундамент, 2 этажа, вальмовая крыша по контуру, террасы, дымоход, лестница.");
}

// ============================================================ 2. П-образный особняк с курдонёром (3 этажа)
{
  const p = base("Особняк «Курдонёр» (П-образный, 3 этажа)", { house: { wallHeight: 3.3, wallThickness: 0.6, slabThickness: 0.3, foundationThickness: 0.6 } });
  const pts = [{ x: 0, y: 0 }, { x: 36, y: 0 }, { x: 36, y: 24 }, { x: 27, y: 24 }, { x: 27, y: 10 }, { x: 9, y: 10 }, { x: 9, y: 24 }, { x: 0, y: 24 }];
  shell(p, pts, { found: { type: "slab", thickness: 0.7 }, wall: { material: "brick" }, floorT: 0.25 });
  openings(p, "L1", { slot: 3.6, width: 1.8 });
  P.addLevel(p, { copyWalls: true });
  P.addLevel(p, { copyWalls: true });
  const top = C.forLevel(p, "L3")[0];
  C.roofFromContour(p, top.id, { roofType: "gable", slope: 28, overhang: 0.8, material: "metal_tile" });
  // Парадный портик на главном (южном) фасаде: 6 колонн на столбчатых опорах, балка в каждом пролёте
  const cx = (i) => 12.6 + i * 2.15, cy = -3.5, floor2 = p.levels[1].elevation - p.house.slabThickness;
  for (let i = 0; i < 6; i++) {
    P.placeAt(p, "pad_foundation", { x: cx(i), y: cy }, { levelId: "L1", size: { length: 0.9, width: 0.9, height: 1.2 } });
    post(p, "column", cx(i), cy, "L1", floor2).size.length = 0.45;
  }
  for (let i = 0; i < 5; i++) P.addSegment(p, "beam", { x: cx(i), y: cy }, { x: cx(i + 1), y: cy }, { levelId: "L1" });
  // Балкон 2-го этажа над портиком, примыкает к южной стене
  P.placeAt(p, "balcony", { x: 18, y: -0.6 }, { levelId: "L2" });
  // Лестницы в боковых крыльях
  P.placeAt(p, "stairs", { x: 2, y: 12 }, { levelId: "L1", rotation: 90 });
  P.placeAt(p, "stairs", { x: 34, y: 12 }, { levelId: "L1", rotation: 90 });
  add("mansion", p, "П-образный особняк на плитном фундаменте: 3 этажа, колоннада с балкой, балкон, две лестницы, двускатные крылья.");
}

// ============================================================ 3. Жилой комплекс: 7-этажная секция (плоская крыша)
{
  const p = base("ЖК «Северный» — 7-этажная секция", {
    house: { wallHeight: 3.0, wallThickness: 0.5, slabThickness: 0.22, foundationThickness: 0.9, roofType: "flat" },
    site: { maxHeight: 45, length: 120, width: 100 },
  });
  const pts = [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 15 }, { x: 0, y: 15 }];
  shell(p, pts, { found: { type: "slab", thickness: 0.9 }, wall: { material: "concrete", thickness: 0.4 }, floorT: 0.22 });
  openings(p, "L1", { slot: 3.6, width: 1.5 });
  // Внутренние несущие стены и лестнично-лифтовой узел на первом этаже
  P.addWallByPoints(p, { x: 16, y: 0.5 }, { x: 16, y: 14.5 }, { category: "interior", thickness: 0.3, levelId: "L1" });
  P.addWallByPoints(p, { x: 32, y: 0.5 }, { x: 32, y: 14.5 }, { category: "interior", thickness: 0.3, levelId: "L1" });
  P.addWallByPoints(p, { x: 0.4, y: 7.5 }, { x: 15.85, y: 7.5 }, { category: "interior", thickness: 0.25, levelId: "L1" });
  P.addWallByPoints(p, { x: 16.15, y: 7.5 }, { x: 31.85, y: 7.5 }, { category: "interior", thickness: 0.25, levelId: "L1" });
  P.addWallByPoints(p, { x: 32.15, y: 7.5 }, { x: 47.6, y: 7.5 }, { category: "interior", thickness: 0.25, levelId: "L1" });
  const inner = p.elements.filter((e) => e.type === "wall" && e.category === "interior").map((e) => e.id);
  for (let i = 1; i < 7; i++) {
    const { level } = P.addLevel(p, { copyWalls: true });
    // Стены стояли на полу 1-го этажа (0,22 м); на этажах выше они стоят на перекрытии и доходят до следующего
    for (const w of P.duplicate(p, inner, { x: 0, y: 0, z: level.elevation - 0.22 }, level.id)) w.size.height = level.height;
  }
  const top = C.forLevel(p, "L7")[0];
  C.roofFromContour(p, top.id, { roofType: "flat", overhang: 0.3, material: "membrane" });
  for (const [x, y] of [[8, 15.6], [24, 15.6], [40, 15.6]]) P.placeAt(p, "balcony", { x: x - 1.5, y }, { levelId: "L2" });
  P.placeAt(p, "stairs", { x: 24, y: 3 }, { levelId: "L1", rotation: 0 });
  add("tower", p, "7-этажная жилая секция 48×15 м: плита 0,9 м, железобетонные стены, внутренние несущие стены, балконы, плоская кровля.");
}

// ============================================================ 4. Дворцовый комплекс: крестообразная вилла с центральным залом
{
  const p = base("Вилла «Крест» (крестообразная, 2 этажа)", { house: { wallHeight: 3.6, wallThickness: 0.5, slabThickness: 0.3, foundationThickness: 0.6 } });
  const a = 10, b = 14, c0 = 12; // ширина луча, половина длины, центр
  const pts = [
    { x: b - a / 2 + 0, y: 0 }, { x: b + a / 2, y: 0 }, { x: b + a / 2, y: b - a / 2 }, { x: 2 * b, y: b - a / 2 },
    { x: 2 * b, y: b + a / 2 }, { x: b + a / 2, y: b + a / 2 }, { x: b + a / 2, y: 2 * b }, { x: b - a / 2, y: 2 * b },
    { x: b - a / 2, y: b + a / 2 }, { x: 0, y: b + a / 2 }, { x: 0, y: b - a / 2 }, { x: b - a / 2, y: b - a / 2 },
  ];
  void c0;
  shell(p, pts, { found: { type: "slab", thickness: 0.6 }, wall: { material: "silicate_brick" } });
  openings(p, "L1", { slot: 3.2, width: 1.8 });
  P.addLevel(p, { copyWalls: true });
  const top = C.forLevel(p, "L2")[0];
  C.roofFromContour(p, top.id, { roofType: "gable", slope: 32, overhang: 0.6, material: "soft_tile" });
  // Центральный зал: четыре колонны и ферма перекрытия
  const beamH = 0.25, under = p.levels[1].elevation - p.house.slabThickness - beamH; // колонны и балки умещаются под перекрытием
  for (const [x, y] of [[b - 2, b - 2], [b + 2, b - 2], [b - 2, b + 2], [b + 2, b + 2]]) post(p, "round_column", x, y, "L1", under).size.diameter = 0.5;
  P.addSegment(p, "beam", { x: b - 2.2, y: b - 2 }, { x: b + 2.2, y: b - 2 }, { levelId: "L1" });
  P.addSegment(p, "beam", { x: b - 2.2, y: b + 2 }, { x: b + 2.2, y: b + 2 }, { levelId: "L1" });
  P.placeAt(p, "stairs", { x: b - 3, y: b - 0.5 }, { levelId: "L1", rotation: 0 });
  add("villa", p, "Крестообразная вилла: 12-вершинный контур, силикатный кирпич, центральный зал с круглыми колоннами и балками, лестница.");
}

// ============================================================ 5. Деревянный дом-усадьба на сваях (Т-образный, срубовый)
{
  const p = base("Бревенчатый дом на сваях (Т-образный)", { house: { wallHeight: 2.8, wallThickness: 0.3, slabThickness: 0.2, foundationThickness: 0.3 }, climate: "1V" });
  const pts = [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 6 }, { x: 12, y: 6 }, { x: 12, y: 13 }, { x: 6, y: 13 }, { x: 6, y: 6 }, { x: 0, y: 6 }];
  const c = shell(p, pts, { found: { type: "strip", width: 0.5, depth: 1.4 }, wall: { material: "log", thickness: 0.3 }, floorT: 0.2 });
  openings(p, "L1", { slot: 3.0, width: 1.3 });
  P.addLevel(p, { copyWalls: true });
  const top = C.forLevel(p, "L2")[0];
  C.roofFromContour(p, top.id, { roofType: "gable", slope: 40, overhang: 0.8, material: "profiled_sheet" });
  // Сваи под террасой
  P.addRect(p, "terrace", { x: 0, y: -3.5 }, { x: 9, y: 0 }, { levelId: "L1" });
  for (let i = 0; i < 4; i++) P.placeAt(p, "pile", { x: 0.3 + i * 2.8, y: -3.2 }, { levelId: "L1" });
  P.placeAt(p, "chimney", { x: 15, y: 3 }, { levelId: "L2" }).size.height = 5;
  add("timber", p, "Т-образный срубовый дом на ленте, сваи под террасой, крутая крыша из профлиста, холодный климатический район.");
}

// ============================================================ 6. Общественное здание: торговый центр с фермами
{
  const p = base("Торговый центр «Галерея» (1 этаж + фермы)", {
    house: { wallHeight: 6.0, wallThickness: 0.4, slabThickness: 0.3, foundationThickness: 0.8, roofType: "gable", roofSlope: 8 },
    site: { length: 140, width: 100 },
  });
  p.settings.housingFund = "public";
  p.settings.profile.maxBeamSpan = 32; // учебный профиль проекта: фермы покрытия большого пролёта
  const pts = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 30 }, { x: 0, y: 30 }];
  shell(p, pts, { found: { type: "slab", thickness: 0.8 }, wall: { material: "concrete", height: 6 }, floorT: 0.3 });
  // Колонный каркас 10×10 м
  for (let ix = 1; ix < 6; ix++) for (let iy = 1; iy < 3; iy++) post(p, "column", ix * 10, iy * 10, "L1", 6).size = { length: 0.5, width: 0.5, height: 5.7 };
  // Крайние колонны под концами ферм (ферма опирается на них в 1,35 м от торца)
  for (let ix = 1; ix < 6; ix++) for (const y of [1.55, 28.45]) { const c = post(p, "column", ix * 10, y, "L1", 6); c.size.length = c.size.width = 0.5; }
  // Фермы покрытия по осям колонн
  for (let ix = 0; ix <= 6; ix++) { try { P.addSegment(p, "truss", { x: ix * 10, y: 0.2 }, { x: ix * 10, y: 29.8 }, { levelId: "L1" }); } catch { /* вне стен */ } }
  openings(p, "L1", { slot: 7, width: 4, height: 3.2, doorWidth: 3, doorHeight: 3 });
  const c = C.forLevel(p, "L1")[0];
  C.roofFromContour(p, c.id, { roofType: "gable", slope: 8, overhang: 0.5, material: "profiled_sheet" });
  add("mall", p, "Торговый центр 60×30 м: каркас из 10 колонн, фермы покрытия, плитный фундамент 0,8 м, общественный фонд.");
}

for (const { p } of out) {
  p.createdAt = p.updatedAt = FIXED;
}
const index = {};
for (const { key, p, note } of out) {
  const file = key;
  writeFileSync(path.join(dir, `${file}.buildsense.json`), BS.projectIO.serialize(p) + "\n");
  const exp = BS.freecadExport.build(p).data;
  exp.exportedAt = FIXED;
  writeFileSync(path.join(dir, `${file}.freecad.json`), JSON.stringify(exp, null, 2) + "\n");
  index[key] = p;
  const v = BS.validation.validate(p).summary;
  const stats = {};
  for (const e of p.elements) stats[e.type] = (stats[e.type] || 0) + 1;
  console.log(`${key}: ${p.name}\n  ${note}\n  элементов ${p.elements.length}, этажей ${p.levels.length}; ошибки ${v.error}, предупреждения ${v.warning}, инфо ${v.info}, пройдено ${v.pass}`);
  console.log("  ", JSON.stringify(stats));
}
writeFileSync(path.join(ROOT, "examples", "prototypes.js"), `// СГЕНЕРИРОВАНО tools/make-prototypes.js — крупные архитектурные прототипы для меню «Новый».
(function (BS) {
  "use strict";
  BS.examples = Object.assign(BS.examples || {}, ${JSON.stringify(index)});
})(globalThis.BuildSense);
`);
