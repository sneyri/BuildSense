// Реестр правил и проверка норм: структура правил, синхронность встроенной копии с JSON, статусы.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadBS, plain, ROOT } from "./loader.js";

const BS = loadBS();
// Объекты из контекста vm принадлежат другому «миру» JS — сравниваем их как обычные данные
const deepEqual = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const C = BS.checker;

test("встроенные правила (js/rules/builtinRules.js) совпадают с data/rules/*.json", () => {
  const index = JSON.parse(readFileSync(path.join(ROOT, "data/rules/index.json"), "utf-8"));
  const fromJson = index.files.map((f) => ({ file: f, data: JSON.parse(readFileSync(path.join(ROOT, "data/rules", f), "utf-8")) }));
  deepEqual(JSON.parse(JSON.stringify(BS.builtinRules.files)), fromJson, "запустите node tools/build-rules.js");
});

test("все встроенные правила корректны и содержат обязательные поля", () => {
  const { rules, errors } = BS.ruleRegistry.builtin();
  deepEqual(errors, []);
  for (const r of rules) {
    for (const f of ["id", "title", "requirement", "parameter", "operator", "clause"]) assert.ok(r[f] !== undefined, `${r.id}: ${f}`);
    assert.ok(r.document.id && r.document.title && r.source.title && r.applicability, r.id);
    assert.ok(["verified", "unverified", "demo"].includes(r.verification.status), r.id);
    assert.ok(BS.metrics.PARAMETERS[r.parameter], `${r.id}: параметр ${r.parameter} рассчитывается моделью`);
  }
  for (const r of rules.filter((x) => x.document.id === "DEMO")) assert.equal(r.verification.status, "demo");
});

test("операторы и единицы", () => {
  assert.equal(C.compare(2.5, ">=", 2.5), true);
  assert.equal(C.compare(30, "between", [15, 45]), true);
  assert.equal(C.compare("1A", "in", ["1A"]), true);
  assert.equal(C.convertValue(800, "mm", "m"), 0.8);
  assert.equal(C.convertValue(1, "m", "deg"), undefined);
});

test("непроверенные и демо-правила никогда не дают PASS/FAIL", () => {
  const p = BS.project.createStarterProject();
  const report = C.checkModel(BS.metrics.collect(p), BS.ruleRegistry.builtin().rules);
  for (const r of report.results.filter((x) => ["unverified", "demo"].includes(x.rule.verification.status))) {
    assert.equal(r.status, "NOT VERIFIED", r.ruleId);
  }
});

test("комнаты: площадь спальни проверяется для государственного фонда", () => {
  const p = BS.project.createStarterProject();
  p.settings.housingFund = "public";
  const bedroom = p.elements.find((e) => e.type === "room" && e.params.roomType === "bedroom");
  bedroom.size.width = 2; // 2 × 3,5 м = 7 м² < 8 м²
  const r = C.checkModel(BS.metrics.collect(p), BS.ruleRegistry.builtin().rules).results.find((x) => x.ruleId === "SP55-6.1-BEDROOM");
  assert.equal(r.status, "FAIL");
});

test("пользовательское правило: создание через форму, статус «учебное ограничение»", () => {
  const p = BS.project.createProject();
  const rule = BS.ruleRegistry.makeUserRule(p, { title: "Мин. уклон", parameter: "roof.slope", operator: ">=", value: "20", unit: "deg", elementType: "roof" });
  assert.equal(rule.verification.status, "user");
  deepEqual(C.validateRule(rule), []);
  assert.throws(() => BS.ruleRegistry.makeUserRule(p, { parameter: "roof.slope", operator: ">=", value: "abc", unit: "deg" }), /числом/);
});

test("импорт правил из JSON: корректные добавляются, ошибочные отклоняются с причиной", () => {
  const p = BS.project.createProject();
  const good = BS.ruleRegistry.makeUserRule(p, { title: "x", parameter: "wall.height", operator: "<=", value: "4", unit: "m", elementType: "wall" });
  const res = BS.ruleRegistry.importRules(p, JSON.stringify({ rules: [good, { id: "BAD" }] }));
  deepEqual(res.added, [good.id]);
  assert.equal(res.errors.length, 1);
  assert.throws(() => BS.ruleRegistry.importRules(p, "{oops"), /JSON/);
});
