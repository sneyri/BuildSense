// BIM-код по правилу именования, библиотека модульных узлов, оболочка здания, пример жилой секции.
import test from "node:test";
import assert from "node:assert/strict";
import { loadBS, plain } from "./loader.js";

const BS = loadBS();
const P = BS.project;
const IO = BS.projectIO;
const fresh = (key) => IO.fromData(plain(BS.examples[key])).project;
const CODE = /^[^-]+-[^-]+-Э\d{2}-(КР|АР|ВК|ЭО)-[А-Я]{2,3}-\d{3}$/;

test("BIM-код: формат объект-секция-Э<этаж>-<раздел>-<тип>-<номер>, коды уникальны", () => {
  const p = fresh("twoStorey");
  const codes = BS.bimCode.all(p);
  assert.equal(codes.size, p.elements.length);
  for (const c of codes.values()) assert.match(c, CODE);
  assert.equal(new Set(codes.values()).size, codes.size, "коды не повторяются");
  const slab2 = p.elements.find((e) => e.type === "slab" && e.category === "floor");
  assert.match(codes.get(slab2.id), /^ЖК01-С1-Э02-КР-ПЛТ-\d{3}$/, "перекрытие второго этажа");
  const partition = p.elements.find((e) => e.type === "wall" && e.category === "partition");
  assert.match(codes.get(partition.id), /-ПРГ-/);
  p.settings.bim = { object: "ЖК07", section: "С3" };
  assert.ok([...BS.bimCode.all(p).values()].every((c) => c.startsWith("ЖК07-С3-Э")), "код объекта и секции из настроек проекта");
});

test("BIM-код: настройки по умолчанию появляются у старых файлов", () => {
  const raw = plain(BS.examples.starter);
  delete raw.settings.bim;
  const p = IO.fromData(raw).project;
  assert.deepEqual(plain(p.settings.bim), { object: "ЖК01", section: "С1" });
});

test("модульный узел: категория, материал, размеры и стандарт; длина, нарисованная мышью, сохраняется", () => {
  const p = P.createStarterProject("Узлы");
  const w = P.addWallByPoints(p, { x: 0, y: -3 }, { x: 6, y: -3 }, { category: "partition" });
  BS.modules.apply(p, w.id, "aerated_wall");
  assert.equal(w.category, "exterior");
  assert.equal(w.material, "aerated");
  assert.equal(w.size.thickness, 0.4);
  assert.ok(Math.abs(w.size.length - 6) < 0.5, "длина не заменена");
  const node = BS.modules.ofElement(w);
  assert.equal(node.standard, "ГОСТ 31360-2024");
  assert.throws(() => BS.modules.apply(p, w.id, "hollow_slab"), /строится как/);
  for (const n of BS.modules.NODES) assert.match(n.standard, /^ГОСТ \d+-\d{4}$/);
});

test("оболочка здания: площади двухэтажного дома совпадают с ручным расчётом по экспорту", () => {
  const env = BS.envelope.compute(fresh("twoStorey"));
  assert.equal(env.counts.walls, 8);
  assert.equal(env.counts.windows, 10);
  assert.ok(Math.abs(env.wallGross - 192.64) < 0.01, `стены ${env.wallGross}`);
  assert.ok(Math.abs(env.windows - 21.0) < 0.01, "10 окон 1,5 × 1,4 м");
  assert.ok(Math.abs(env.doors - 1.89) < 0.01, "входная дверь 0,9 × 2,1 м");
  assert.ok(Math.abs(env.glazingFacade - 0.109) < 0.001);
  assert.equal(env.footprint, 80);
  assert.equal(env.volume, 464);
  assert.ok(Math.abs(env.compactness - 352.64 / 464) < 0.001);
  assert.equal(BS.envelope.compute(P.createProject("Пусто")), null, "без наружных стен — нет оболочки");
});

test("экспорт для FreeCAD: BIM-код, узел и оболочка", () => {
  const { data } = BS.freecadExport.build(fresh("section"));
  assert.ok(data.elements.every((e) => CODE.test(e.bimCode)));
  const node = data.elements.find((e) => e.node && e.node.id === "hollow_slab");
  assert.ok(node, "плиты секции — узел библиотеки");
  assert.equal(node.node.standard, "ГОСТ 9561-2016");
  assert.equal(node.node.verified, false);
  assert.ok(data.envelope && data.envelope.wallGross > 0);
  assert.deepEqual(plain(data.project.bim), { object: "ЖК01", section: "С1" });
});

test("жилая секция: 5 этажей, геометрия без ошибок, СП 55 честно не применим (FAIL области применения)", () => {
  const p = fresh("section");
  assert.equal(p.levels.length, 5);
  const t0 = Date.now();
  const r = BS.validation.validate(p);
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, `проверка заняла ${ms} мс`);
  assert.equal(r.issues.filter((i) => i.severity === "error" && i.category === "geometry").length, 0, "нет геометрических ошибок");
  const storeys = r.norms.results.find((n) => n.ruleId === "SP55-1.1-STOREYS");
  assert.equal(storeys.status, "FAIL");
  assert.equal(storeys.actual, 5);
});
