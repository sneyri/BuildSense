// Генерирует демонстрационные проекты в examples/ теми же модулями, что и редактор.
// Запуск: node tools/make-examples.js
// Результат: *.buildsense.json (проекты), two-storey.freecad.json (экспорт для макроса)
// и examples.js — те же проекты для меню «Новый» (работает без сервера, по file://).
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadBS, ROOT } from "../tests/loader.js";

const BS = loadBS();
const P = BS.project;
const FIXED = "2026-10-27T12:00:00.000Z";
const out = (name) => path.join(ROOT, "examples", name);

// 1. Стартовый дом
const starter = P.createStarterProject("Стартовый дом");

// 2. Двухэтажный дом с лестницей, мебелью и инженерией
const two = P.createStarterProject("Двухэтажный дом");
const L1 = two.levels[0].id;
P.placeAt(two, "stairs", { x: 8.2, y: 4.3 }, { levelId: L1, rotation: 90 });
const { level: L2 } = P.addLevel(two, { copyWalls: true });
const part2 = P.addWallByPoints(two, { x: 4, y: 0.4 }, { x: 4, y: 7.6 }, { category: "partition", levelId: L2.id });
part2.name = "Перегородка (этаж 2)";
P.placeOpening(two, "door", part2.id, 1.0);
for (const w of two.elements.filter((e) => e.type === "wall" && e.levelId === L2.id && e.category === "exterior")) P.addLintels(two, w.id);
P.placeAt(two, "bed", { x: 2, y: 5.5 }, { levelId: L2.id });
P.placeAt(two, "wardrobe", { x: 1.2, y: 1.0 }, { levelId: L2.id });
P.placeAt(two, "sofa", { x: 3, y: 6.8 }, { levelId: L1 });
P.placeAt(two, "table", { x: 3, y: 3.5 }, { levelId: L1 });
P.placeAt(two, "chair", { x: 3, y: 2.8 }, { levelId: L1 });
P.placeAt(two, "toilet", { x: 9.2, y: 7.0 }, { levelId: L1 });
P.placeAt(two, "sink", { x: 9.2, y: 6.2 }, { levelId: L1 });
P.placeAt(two, "light", { x: 3, y: 4 }, { levelId: L1 });
P.placeAt(two, "chimney", { x: 7.0, y: 3.6 }, { levelId: L2.id }).size.height = 4.2;
P.addSegment(two, "pipe", { x: 9.0, y: 7.2 }, { x: 9.0, y: 5.0 }, { levelId: L1 });
P.addRect(two, "terrace", { x: 0, y: -3 }, { x: 4, y: 0 }, { levelId: L1 });

// 3. Дом с намеренными ошибками (для демонстрации проверок)
const bad = P.createStarterProject("Дом с ошибками");
const east = bad.elements.find((e) => e.shell === "east");
P.updateElement(bad, east.id, { position: { z: 0.3 } });                    // зазор под стеной
const col = P.placeAt(bad, "column", { x: 14, y: 4 });                       // колонна на грунте без фундамента
col.name = "Колонна без фундамента";
const beam = P.addSegment(bad, "beam", { x: 14, y: 4 }, { x: 20, y: 4 });    // балка: один конец без опоры
beam.name = "Балка с консолью";
const thin = P.addWallByPoints(bad, { x: 3, y: 2 }, { x: 3, y: 5 }, { category: "partition", thickness: 0.08 }); // отдельно стоящая тонкая стена
thin.name = "Отдельная тонкая стенка";
const north = bad.elements.find((e) => e.shell === "north");
const w = bad.elements.find((e) => e.hostId === north.id && e.type === "window");
P.placeOpening(bad, "window", north.id, w.position.offset + 0.5);            // свободное место найдётся само
const extra = bad.elements.filter((e) => e.hostId === north.id && e.type === "window").pop();
extra.position.offset = w.position.offset + 0.5;                             // принудительное наложение проёмов
const roof = bad.elements.find((e) => e.type === "roof");
roof.position.z = 3.2;                                                       // крыша висит над стенами
bad.settings.climateRegion = "1A";                                           // FAIL по п. 6.2 (2,6 м < 2,7 м)

// 4. Все типы объектов (для проверки макроса FreeCAD): по одному каждого вида на отдельной площадке
const all = P.createStarterProject("Все типы объектов");
let x = 14;
for (const type of Object.keys(BS.types.TYPES)) {
  const t = BS.types.get(type);
  if (all.elements.some((e) => e.type === type) || t.shape === "opening") continue;
  const kind = { wall: "line", strip_foundation: "line", beam: "line", truss: "line", railing: "line", pipe: "line", decor: "line",
    slab_foundation: "rect", slab: "rect", terrace: "rect", room: "rect", landing: "rect" }[type] || "point";
  if (kind === "line") P.addSegment(all, type, { x, y: 0 }, { x: x + 3, y: 1 });
  else if (kind === "rect") P.addRect(all, type, { x, y: 0 }, { x: x + 2, y: 1.5 });
  else P.placeAt(all, type, { x: x + 1, y: 0.8 }, { rotation: 30 });
  x += 3.5;
}
["flat", "shed", "hip"].forEach((roofType, i) => P.addElement(all, "roof", {
  name: `Крыша ${roofType}`, position: { x: 14 + i * 7, y: 6, z: 0 }, size: { length: 6, width: 4 },
  rotation: i === 0 ? 15 : 0, params: { roofType, slope: 25, thickness: 0.25 },
}));

const examples = { starter, twoStorey: two, issues: bad };
for (const p of Object.values(examples)) p.createdAt = p.updatedAt = FIXED;
writeFileSync(out("starter-house.buildsense.json"), BS.projectIO.serialize(starter) + "\n");
writeFileSync(out("two-storey.buildsense.json"), BS.projectIO.serialize(two) + "\n");
writeFileSync(out("house-with-errors.buildsense.json"), BS.projectIO.serialize(bad) + "\n");
for (const [file, p] of [["two-storey", two], ["starter-house", starter], ["all-types", all]]) {
  const exp = BS.freecadExport.build(p).data;
  exp.exportedAt = FIXED;
  writeFileSync(out(`${file}.freecad.json`), JSON.stringify(exp, null, 2) + "\n");
}
writeFileSync(out("examples.js"), `// СГЕНЕРИРОВАНО tools/make-examples.js — демонстрационные проекты для меню «Новый».
(function (BS) {
  "use strict";
  BS.examples = ${JSON.stringify(examples)};
})(globalThis.BuildSense);
`);
for (const [k, p] of Object.entries(examples)) {
  const v = BS.validation.validate(p).summary;
  console.log(`${k}: элементов ${p.elements.length}, этажей ${p.levels.length}; ошибки ${v.error}, предупреждения ${v.warning}, инфо ${v.info}, пройдено ${v.pass}`);
}
