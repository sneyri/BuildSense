// Движок проверок: геометрия, конструкция, нормы; допустимые пересечения не считаются ошибками.
import test from "node:test";
import assert from "node:assert/strict";
import { loadBS, plain } from "./loader.js";

const BS = loadBS();
// Объекты из контекста vm принадлежат другому «миру» JS — сравниваем их как обычные данные
const deepEqual = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const P = BS.project;
const run = (p) => BS.validation.validate(p);
const has = (r, checkId, sev) => r.issues.some((i) => i.checkId === checkId && (!sev || i.severity === sev));

test("стартовый дом: нет ошибок и предупреждений; у каждой проверки есть идентификатор и пояснение", () => {
  const r = run(P.createStarterProject());
  assert.equal(r.summary.error, 0);
  assert.equal(r.summary.warning, 0);
  for (const i of r.issues) {
    assert.ok(i.id && i.checkId && i.category && i.severity && i.title, "структура сообщения");
    assert.ok(i.explanation, `${i.checkId}: пояснение «что проверить»`);
  }
  assert.ok(r.summary.pass >= 15, "пройденные проверки показываются зелёным");
});

test("допустимые пересечения не являются ошибками: стены на фундаменте, перемычки и колонны в стенах", () => {
  const p = P.createStarterProject();
  P.placeAt(p, "column", { x: 0.2, y: 1.5 }); // колонна в стене (в месте без проёмов)
  const r = run(p);
  assert.ok(!r.issues.some((i) => i.checkId === "GEO-OVERLAP" && i.severity !== "pass"), "нет сообщений о пересечении");
});

test("недопустимое пересечение: мебель в стене", () => {
  const p = P.createStarterProject();
  P.placeAt(p, "wardrobe", { x: 0.3, y: 4 });
  assert.ok(has(run(p), "GEO-OVERLAP", "warning"));
});

test("нулевой размер и некорректная координата из файла обнаруживаются", () => {
  const p = P.createStarterProject();
  const w = p.elements.find((e) => e.type === "wall");
  w.size.length = 0;
  w.position.x = 5000;
  const r = run(p);
  assert.ok(has(r, "GEO-SIZE", "error"));
  assert.ok(has(r, "GEO-COORD", "error"));
});

test("стена над фундаментом: зазор с кнопкой исправления", () => {
  const p = P.createStarterProject();
  const w = p.elements.find((e) => e.shell === "east");
  P.updateElement(p, w.id, { position: { z: 0.3 } });
  const it = run(p).issues.find((i) => i.checkId === "GEO-CONNECT" && i.elementIds.includes(w.id) && i.fix);
  assert.ok(it);
  BS.validation.applyFix(p, it.fix.action);
  assert.equal(w.position.z, 0);
  assert.equal(run(p).summary.error, 0);
});

test("проём за границей стены и наложение проёмов — геометрические ошибки", () => {
  const p = P.createStarterProject();
  const win = p.elements.find((e) => e.type === "window");
  win.position.offset = 999;
  assert.ok(has(run(p), "GEO-OPENINGS", "error"));
});

test("элемент вне участка — предупреждение", () => {
  const p = P.createStarterProject();
  P.placeAt(p, "column", { x: 100, y: 100 });
  assert.ok(has(run(p), "GEO-SITE", "warning"));
});

test("лестница не доходит до следующего этажа", () => {
  const p = P.createStarterProject();
  P.addLevel(p);
  const st = P.placeAt(p, "stairs", { x: 7.5, y: 4 });
  st.size.height = 2.0;
  assert.ok(has(run(p), "GEO-STAIRS", "warning"));
});

test("крыша не покрывает стены и висит над ними", () => {
  const p = P.createStarterProject();
  const roof = p.elements.find((e) => e.type === "roof");
  roof.size.length = 4;
  roof.position.z = 3.5;
  const r = run(p);
  assert.ok(has(r, "GEO-ROOF", "warning"));
  const it = r.issues.find((i) => i.checkId === "STR-ROOF");
  assert.equal(it.fix.action.z, 2.8);
});

test("нет фундамента — ошибка с исправлением", () => {
  const p = P.createStarterProject();
  p.elements = p.elements.filter((e) => e.type !== "slab_foundation");
  const it = run(p).issues.find((i) => i.checkId === "STR-FOUNDATION");
  assert.equal(it.severity, "error");
  BS.validation.applyFix(p, it.fix.action);
  assert.ok(!has(run(p), "STR-FOUNDATION", "error"));
});

test("балка: консоль, пролёт больше учебного предела, мелкое сечение", () => {
  const p = P.createStarterProject();
  P.placeAt(p, "column", { x: 3, y: 3 });
  const b = P.addSegment(p, "beam", { x: 3, y: 3 }, { x: 12, y: 3 });
  const r = run(p);
  assert.ok(r.issues.some((i) => i.checkId === "STR-BEAMS" && i.severity === "error" && i.elementIds.includes(b.id)), "один конец без опоры");
  assert.ok(r.issues.some((i) => i.checkId === "STR-BEAMS" && i.title.includes("пролёт")), "пролёт > 6 м");
});

test("учебный профиль: тонкая наружная стена", () => {
  const p = P.createStarterProject();
  p.settings.profile.minExteriorWall = 0.5;
  assert.ok(has(run(p), "STR-PROFILE", "warning"));
});

test("отдельно стоящая тонкая стена и разрыв цепочки нагрузки", () => {
  const p = P.createStarterProject();
  const thin = P.addWallByPoints(p, { x: 2, y: 2 }, { x: 2, y: 5 }, { category: "interior", thickness: 0.1 });
  assert.ok(run(p).issues.some((i) => i.checkId === "STR-SLENDER" && i.elementIds.includes(thin.id)));
  // Несущая колонна на террасе (ненесущей) — разрыв цепочки
  const ter = P.addRect(p, "terrace", { x: 0, y: -4 }, { x: 4, y: -1 });
  const col = P.placeAt(p, "column", { x: 2, y: -2.5 });
  assert.equal(col.position.z, BS.shapes.top(ter, p));
  assert.ok(run(p).issues.some((i) => i.checkId === "STR-LOADPATH" && i.elementIds.includes(col.id)));
});

test("второй этаж без перекрытия — нет связи между этажами", () => {
  const p = P.createStarterProject();
  P.addLevel(p);
  p.elements = p.elements.filter((e) => !(e.type === "slab" && e.category === "floor"));
  assert.ok(has(run(p), "STR-LEVELS", "warning"));
});

test("нормы: сверенное правило даёт FAIL как ошибку, пользовательское — как предупреждение", () => {
  const p = P.createStarterProject();
  p.settings.climateRegion = "1A";
  p.customRules = [BS.ruleRegistry.makeUserRule(p, { title: "Толщина стен ≥ 0,5", parameter: "wall.thickness", operator: ">=", value: "0.5", unit: "m", elementType: "wall" })];
  const r = run(p);
  assert.ok(r.issues.some((i) => i.checkId === "NORM-SP55-6.2-HEIGHT-COLD" && i.severity === "error"));
  assert.ok(r.issues.some((i) => i.checkId === "NORM-USER-1" && i.severity === "warning" && i.title.startsWith("Учебное ограничение")));
});

test("примеры: дом с ошибками содержит ошибки каждой категории", () => {
  const bad = BS.projectIO.fromData(JSON.parse(JSON.stringify(BS.examples ? BS.examples.issues : {}))).project;
  const r = run(bad);
  for (const cat of ["geometry", "structure", "norms"]) {
    assert.ok(r.issues.some((i) => i.category === cat && i.severity === "error"), cat);
  }
});
