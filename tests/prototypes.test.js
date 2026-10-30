// Крупные прототипы (examples/prototypes): совпадают с генератором, открываются, экспортируются, без геометрических ошибок.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadBS, CORE_FILES, ROOT, plain } from "./loader.js";

const BS = loadBS([...CORE_FILES, "examples/prototypes.js"]);
const KEYS = ["estate", "mansion", "tower", "villa", "timber", "mall"];
const FLOORS = { estate: 2, mansion: 3, tower: 7, villa: 2, timber: 2, mall: 1 };

for (const key of KEYS) {
  test(`прототип «${key}»: файл совпадает со встроенной копией и открывается без замечаний`, () => {
    const disk = JSON.parse(readFileSync(path.join(ROOT, "examples", "prototypes", `${key}.buildsense.json`), "utf8"));
    assert.deepEqual(disk, JSON.parse(BS.projectIO.serialize(BS.examples[key])), "запустите node tools/make-prototypes.js");
    const { project, warnings } = BS.projectIO.fromData(plain(disk));
    assert.equal(warnings.length, 0, warnings.join("; "));
    assert.equal(project.levels.length, FLOORS[key]);
  });

  test(`прототип «${key}»: нет геометрических ошибок, экспорт для FreeCAD без пропусков`, () => {
    const p = BS.projectIO.fromData(plain(BS.examples[key])).project;
    const { issues } = BS.validation.validate(p);
    const bad = issues.filter((i) => i.severity === "error" && !i.id.startsWith("NORM-"));
    assert.equal(bad.length, 0, bad.map((i) => i.title).join("; "));
    const exp = BS.freecadExport.build(p);
    assert.equal(exp.data.elements.length, p.elements.length, "часть элементов не экспортирована");
  });
}

test("башня: СП 55 вне области применения (до 3 этажей и 20 м) — не ошибка, остальные его пункты не дают PASS", () => {
  const p = BS.projectIO.fromData(plain(BS.examples.tower)).project;
  const r = BS.validation.validate(p);
  assert.equal(r.issues.filter((i) => i.severity === "error").length, 0);
  assert.equal(r.norms.results.find((n) => n.ruleId === "SP55-1.1-STOREYS").status, "OUT OF SCOPE");
  assert.ok(!r.norms.results.some((n) => /^SP55-(6|9)/.test(n.ruleId)), "пункты 6.x и 9.x не проверяются");
  assert.ok(r.notApplicable.some((n) => n.checkId === "NORM-SP55-6.2-HEIGHT-OTHER"));
});
