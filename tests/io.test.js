// Сохранение/загрузка, миграция старого формата, экспорт для FreeCAD, расчёты.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadBS, plain, ROOT } from "./loader.js";

const BS = loadBS();
// Объекты из контекста vm принадлежат другому «миру» JS — сравниваем их как обычные данные
const deepEqual = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const IO = BS.projectIO;
const P = BS.project;

test("сохранение и загрузка без потерь (двухэтажный пример)", () => {
  const p = IO.fromData(plain(BS.examples.twoStorey)).project;
  const back = IO.parse(IO.serialize(p));
  deepEqual(back.warnings, []);
  deepEqual(plain(back.project), plain(p));
});

test("файлы примеров совпадают со встроенными (examples.js)", () => {
  for (const [file, key] of [["starter-house", "starter"], ["two-storey", "twoStorey"], ["house-with-errors", "issues"]]) {
    const disk = JSON.parse(readFileSync(path.join(ROOT, "examples", `${file}.buildsense.json`), "utf-8"));
    deepEqual(disk, plain(BS.examples[key]), `${file}: запустите node tools/make-examples.js`);
  }
});

test("встроенный текст макроса (кнопка «Скачать макрос») совпадает с freecad/import_house.FCMacro", () => {
  const disk = readFileSync(path.join(ROOT, "freecad", "import_house.FCMacro"), "utf-8");
  assert.equal(BS.freecadMacro.source, disk, "запустите node tools/build-macro.js");
  assert.equal(BS.freecadMacro.fileName, "import_house.FCMacro");
});

test("миграция проекта FreeCAD Checker (версия 1)", () => {
  const { project, warnings } = IO.parse(readFileSync(path.join(ROOT, "examples/legacy-v1-house.project.json"), "utf-8"));
  assert.match(warnings[0], /преобразован/);
  assert.ok(project.elements.some((e) => e.type === "slab_foundation"));
  assert.ok(project.elements.some((e) => e.type === "slab" && e.size.height > 0));
  assert.equal(BS.validation.validate(project).summary.error, 0);
});

test("загрузка отклоняет повреждённые и чужие файлы", () => {
  assert.throws(() => IO.parse("{oops"), /JSON/);
  assert.throws(() => IO.parse(JSON.stringify({ format: "buildsense-freecad-export" })), /экспорта/);
  assert.throws(() => IO.parse(JSON.stringify({ format: "x" })), /формат/);
  const p = P.createStarterProject();
  p.elements.push({ ...p.elements[0] });
  assert.throws(() => IO.parse(JSON.stringify(p)), /Повторяющийся/);
  const q = P.createStarterProject();
  q.elements[0].size.length = "10";
  assert.throws(() => IO.parse(JSON.stringify(q)), /числом/);
});

test("некорректный размер из файла не исправляется молча — его ловит проверка геометрии", () => {
  const p = P.createStarterProject();
  p.elements.find((e) => e.type === "wall").size.height = -1;
  const { project } = IO.parse(JSON.stringify(p));
  assert.ok(BS.validation.validate(project).issues.some((i) => i.checkId === "GEO-SIZE"));
});

test("экспорт FreeCAD: схема, миллиметры, этажи, связи, положение проёмов", () => {
  const p = IO.fromData(plain(BS.examples.twoStorey)).project;
  const { data, warnings } = BS.freecadExport.build(p);
  deepEqual(warnings, []);
  assert.equal(data.format, "buildsense-freecad-export");
  assert.equal(data.schemaVersion, 2);
  assert.equal(data.units, "mm");
  assert.equal(data.levels.length, 2);
  assert.equal(data.levels[1].elevation, 3000);
  const wall = data.elements.find((e) => e.id === "wall-1");
  deepEqual(wall.size, { length: 10000, thickness: 400, height: 2800 });
  deepEqual(wall.placement, { x: 0, y: 0, z: 0, rotationZ: 0 });
  assert.ok(wall.relations.hosted.length >= 2);
  deepEqual(wall.relations.supports, ["slab_foundation-1"]);
  const door = data.elements.find((e) => e.type === "door");
  assert.equal(door.hostId, door.relations.hostId);
  assert.ok(door.void.placement.z < 0, "вырез двери ниже низа стены");
  assert.equal(data.elements.length, p.elements.length);
});

test("расчёт балки по формулам сопромата (проверка вручную)", () => {
  const p = P.createProject();
  const b = P.addSegment(p, "beam", { x: 0, y: 0 }, { x: 4, y: 0 }); // брус 0,15 × 0,25, дерево
  const c = BS.calculations.beamCheck(b, BS.materials.get("timber"), { lineLoad: 5 });
  const q = (500 * 9.81 * 0.15 * 0.25) / 1000 + 5; // кН/м
  assert.ok(Math.abs(c.M - (q * 16) / 8) < 1e-9);
  assert.ok(Math.abs(c.sigma - (q * 16) / 8 / ((0.15 * 0.25 ** 2) / 6) / 1000) < 1e-9);
  const I = (0.15 * 0.25 ** 3) / 12;
  assert.ok(Math.abs(c.f - (5 * q * 4 ** 4) / (384 * 10e6 * I)) < 1e-12);
  const res = BS.calculations.forElement(p, b, {});
  assert.ok(res.items.every((i) => i.formula && i.unit !== undefined && Array.isArray(i.inputs)));
  assert.ok(res.assumptions.some((a) => /учебн/.test(a)));
});

test("объём стены учитывает проёмы", () => {
  const p = P.createStarterProject();
  const w = p.elements.find((e) => e.shell === "south");
  const holes = P.hosted(p, w.id).reduce((s, o) => s + o.size.width * o.size.height, 0);
  const v = BS.shapes.volume(w, p).value;
  assert.ok(Math.abs(v - (10 * 2.8 - holes) * 0.4) < 1e-9);
});
