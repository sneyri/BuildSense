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

// 2. Двухэтажный дом с лестницей, дымоходом и террасой
const two = P.createStarterProject("Двухэтажный дом");
const L1 = two.levels[0].id;
P.placeAt(two, "stairs", { x: 8.2, y: 4.3 }, { levelId: L1, rotation: 90 });
const { level: L2 } = P.addLevel(two, { copyWalls: true });
const part2 = P.addWallByPoints(two, { x: 4, y: 0.4 }, { x: 4, y: 7.6 }, { category: "partition", levelId: L2.id });
part2.name = "Перегородка (этаж 2)";
P.placeOpening(two, "door", part2.id, 1.0);
for (const w of two.elements.filter((e) => e.type === "wall" && e.levelId === L2.id && e.category === "exterior")) P.addLintels(two, w.id);
// Сантехника, электрика и мебель в примеры не входят (группы скрыты из сценария; типы остаются для старых файлов)
P.placeAt(two, "chimney", { x: 7.0, y: 3.6 }, { levelId: L2.id }).size.height = 4.2;
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

// 3а. Г-образный дом по контуру плана: контур → плитный фундамент → стены → пол → проёмы → этаж → крыша
const lh = P.createProject("Г-образный дом");
const C = BS.contour;
const lc = C.addContour(lh, [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 10 }, { x: 0, y: 10 }]);
C.foundationFromContour(lh, lc.id, { type: "slab", thickness: 0.4 });
C.wallsFromContour(lh, lc.id, { thickness: 0.4, height: 2.8, material: "aerated" });
C.slabFromContour(lh, lc.id, { kind: "ground", thickness: 0.2 });
P.autoOpenings(lh, "L1");
for (const w of C.linked(lh, lc.id, C.GEN.wall)) P.addLintels(lh, w.id);
P.addLevel(lh, { copyWalls: true });
const lc2 = C.forLevel(lh, "L2")[0];
C.roofFromContour(lh, lc2.id, { roofType: "hip", slope: 30, overhang: 0.4, material: "clay_tile" });

// 3б. Т-образный дом на ленточном фундаменте (для проверки макроса FreeCAD: ленты по рёбрам контура)
const th = P.createProject("Т-образный дом на ленте");
const tc = C.addContour(th, [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 9 }, { x: 4, y: 9 }, { x: 4, y: 4 }, { x: 0, y: 4 }]);
C.wallsFromContour(th, tc.id, { thickness: 0.38, height: 2.7, material: "brick" });
C.foundationFromContour(th, tc.id, { type: "strip", width: 0.6, depth: 1.2 });
C.slabFromContour(th, tc.id, { kind: "floor", thickness: 0.22 });
C.roofFromContour(th, tc.id, { roofType: "gable", slope: 30, overhang: 0.5 });

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

const examples = { starter, twoStorey: two, issues: bad, lHouse: lh };
for (const p of Object.values(examples)) p.createdAt = p.updatedAt = FIXED;
writeFileSync(out("starter-house.buildsense.json"), BS.projectIO.serialize(starter) + "\n");
writeFileSync(out("two-storey.buildsense.json"), BS.projectIO.serialize(two) + "\n");
writeFileSync(out("house-with-errors.buildsense.json"), BS.projectIO.serialize(bad) + "\n");
writeFileSync(out("l-house.buildsense.json"), BS.projectIO.serialize(lh) + "\n");
th.createdAt = th.updatedAt = FIXED;
for (const [file, p] of [["two-storey", two], ["starter-house", starter], ["all-types", all], ["l-house", lh], ["t-house-strip", th]]) {
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
