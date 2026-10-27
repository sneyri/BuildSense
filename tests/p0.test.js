// Исправления P0 (docs/RULES_REVIEW.md, сценарии T1, T3, T7, T8): п. 6.2 СП 55 по каждому этажу,
// область применения документа, «неприменимо» вместо пустого «пройдено».
import test from "node:test";
import assert from "node:assert/strict";
import { loadBS, plain } from "./loader.js";

const BS = loadBS();
const P = BS.project;
const fresh = (key) => BS.projectIO.fromData(plain(BS.examples[key])).project;
const norm = (r, id) => r.norms.results.filter((n) => n.ruleId === id);
const attic = (p, levelId, z) => P.addElement(p, "slab", { category: "attic", levelId, position: { x: 0, y: 0, z }, size: { length: 10, width: 8, height: 0.2 } });

/** Двухэтажный дом с этажом 2 высотой h (стены этажа 2 и при желании чердачное перекрытие над ними). */
function twoStorey(h, { flatCeiling }) {
  const p = fresh("twoStorey");
  const l2 = p.levels.find((l) => l.id === "L2");
  l2.height = h;
  for (const w of p.elements.filter((e) => e.type === "wall" && e.levelId === "L2")) w.size.height = h;
  for (const r of p.elements.filter((e) => e.type === "roof")) r.position.z = l2.elevation + h;
  p.elements = p.elements.filter((e) => !(e.levelId === "L2" && ["chimney", "lintel"].includes(e.type)));
  if (flatCeiling) attic(p, "L2", l2.elevation + h);
  return p;
}

test("T1: корректный двухэтажный дом — проверка балок «неприменима», а не «пройдена»", () => {
  const r = BS.validation.validate(fresh("twoStorey"));
  assert.equal(r.summary.error, 0);
  assert.ok(!r.issues.some((i) => i.checkId === "STR-BEAMS"), "нет сообщения «балки опираются…» без балок");
  assert.ok(r.notApplicable.some((n) => n.checkId === "STR-BEAMS"), "STR-BEAMS в списке неприменимых");
  assert.equal(r.summary.notApplicable, r.notApplicable.length);
  const h = norm(r, "SP55-6.2-HEIGHT-OTHER");
  assert.deepEqual(plain(h.map((n) => [n.elementName, n.status])), [["Этаж 1", "PASS"], ["Этаж 2", "PASS"]], "п. 6.2 — по каждому этажу");
});

test("T3: второй этаж 2,2 м с плоским потолком — FAIL п. 6.2 именно у этажа 2 (раньше был ложный PASS)", () => {
  const r = BS.validation.validate(twoStorey(2.2, { flatCeiling: true }));
  const [l1, l2] = norm(r, "SP55-6.2-HEIGHT-OTHER");
  assert.equal(l1.status, "PASS");
  assert.equal(l2.status, "FAIL");
  assert.equal(l2.elementName, "Этаж 2");
  assert.ok(Math.abs(l2.actual - 2.2) < 1e-6, `высота этажа 2: ${l2.actual}`);
  const issue = r.issues.find((i) => i.checkId === "NORM-SP55-6.2-HEIGHT-OTHER" && i.severity === "error");
  assert.ok(issue, "сверенная норма — ошибка");
  assert.ok(issue.elementIds.length >= 4 && issue.elementIds.every((id) => id.startsWith("wall-")), "подсвечиваются стены этажа 2");
});

test("T7: жилая секция вне области применения СП 55 — пункты 6.x не дают PASS", () => {
  const r = BS.validation.validate(fresh("section"));
  const scope = norm(r, "SP55-1.1-STOREYS")[0];
  assert.equal(scope.status, "OUT OF SCOPE");
  const issue = r.issues.find((i) => i.checkId === "NORM-SP55-1.1-STOREYS");
  assert.equal(issue.severity, "info", "вне области применения — не «ошибка»");
  assert.match(issue.title, /СП 55\.13330\.2016 не применяется/);
  assert.equal(norm(r, "SP55-1.1-HEIGHT")[0].status, "PASS", "второй критерий области применения (высота 17,4 ≤ 20 м) выполнен");
  for (const id of ["SP55-6.2-HEIGHT-OTHER", "SP55-6.2-HEIGHT-COLD", "SP55-9.18-DAYLIGHT", "SP55-6.1-COMMON-ROOM"]) {
    assert.equal(norm(r, id).length, 0, `${id} не проверяется`);
  }
  assert.ok(r.norms.notApplicable.some((n) => n.rule.id === "SP55-6.2-HEIGHT-OTHER" && n.outOfScope && /вне области применения/.test(n.reason)));
  assert.ok(r.notApplicable.some((n) => n.checkId === "NORM-SP55-6.2-HEIGHT-OTHER"), "видно в списке неприменимого");
  assert.ok(norm(r, "DEMO-WALL-THICKNESS").length > 0, "правила других документов проверяются как раньше");
  assert.ok(!r.issues.some((i) => i.category === "norms" && i.severity === "error"), "ни одной нормативной «ошибки»");
});

test("T7: в области применения (2 этажа) правило 1.1 даёт PASS, остальные пункты проверяются", () => {
  const r = BS.validation.validate(fresh("twoStorey"));
  assert.equal(norm(r, "SP55-1.1-STOREYS")[0].status, "PASS");
  assert.equal(r.norms.outOfScope.length, 0);
});

test("T8: мансарда — низкие стены под скатной крышей без перекрытия: «требуется проверка», не FAIL", () => {
  const p = twoStorey(1.5, { flatCeiling: false });
  const r = BS.validation.validate(p);
  const l2 = norm(r, "SP55-6.2-HEIGHT-OTHER").find((n) => n.elementName === "Этаж 2");
  assert.equal(l2.status, "NEEDS REVIEW");
  assert.equal(l2.demoOutcome, "FAIL", "по высоте у стен требование не выполнено, но вывод о нарушении не делается");
  assert.match(l2.reason, /скатами крыши/);
  const issue = r.issues.find((i) => i.norm === l2 || (i.checkId === "NORM-SP55-6.2-HEIGHT-OTHER" && i.title.includes("Этаж 2")));
  assert.equal(issue.severity, "warning");
  assert.match(issue.title, /^Требуется проверка/);
});

test("T8: под скатной крышей при достаточной высоте у стен — PASS (у конька потолок только выше)", () => {
  const r = BS.validation.validate(twoStorey(2.8, { flatCeiling: false }));
  assert.equal(norm(r, "SP55-6.2-HEIGHT-OTHER").find((n) => n.elementName === "Этаж 2").status, "PASS");
});

test("формат правил: role и undecidable проверяются", () => {
  const C = BS.checker;
  const base = plain(BS.ruleRegistry.builtin().rules.find((r) => r.id === "SP55-6.2-HEIGHT-OTHER"));
  assert.deepEqual(plain(C.validateRule(base)), []);
  assert.ok(C.validateRule({ ...base, role: "main" }).some((e) => /role/.test(e)));
  assert.ok(C.validateRule({ ...base, undecidable: [{ parameter: "x" }] }).some((e) => /undecidable/.test(e)));
});
