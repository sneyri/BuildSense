// Машиностроение: сборки — компоненты, сопряжения, решатель, пересечения, сохранение и экспорт.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadMech, interferenceExport, ROOT } from "./mech_build.mjs";

const BS = loadMech();
const M = BS.mechModel;
const A = BS.mechAssembly;
const IO = BS.mechIO;
const plain = (v) => JSON.parse(JSON.stringify(v));
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/** Демо-сборка: вал c1 (закреплён), фланец c2, втулка c3. */
function demo() {
  const pr = A.createDemoAssemblyProject();
  return { pr, asm: pr.assemblies[0], shaft: pr.parts[0], flange: pr.parts[1], bush: pr.parts[2] };
}
const status = (r) => plain(Object.fromEntries(Object.entries(r.components).map(([k, v]) => [k, v.status])));
const mates = (r) => plain(Object.fromEntries(Object.entries(r.mates).map(([k, v]) => [k, v.status])));
/** Осевая координата начала детали вдоль оси вала (вал лежит вдоль X). */
const axial = (pr, part) => part.placement.x - pr.parts[0].placement.x;

test("демо-сборка решена: вал закреплён, фланец и втулка определены, пересечений нет", () => {
  const { pr, asm, flange, bush } = demo();
  const r = A.solve(pr, asm);
  assert.equal(r.ok, true);
  assert.deepEqual(status(r), { c1: "fixed", c2: "solved", c3: "solved" });
  assert.deepEqual(mates(r), { m1: "ok", m2: "ok", m3: "ok", m4: "ok" });
  assert.equal(r.messages.filter((m) => m.severity !== "info").length, 0);
  assert.equal(axial(pr, flange), 50, "фланец встык к буртику (уступ на z = 50)");
  assert.equal(axial(pr, bush), 105, "втулка: уступ z = 100 + смещение 5");
  for (const p of [flange, bush]) assert.deepEqual([p.placement.y, p.placement.z], [0, 80], "соосно с валом");
  assert.ok(r.interference.every((i) => i.checked && i.volume === 0));
  assert.ok(r.contacts.every((c) => c.checked && c.width > 0), "кольца граней перекрываются — касание есть");
  assert.deepEqual(plain(M.validateProject(pr)), []);
});

test("изменение размеров детали пересчитывает сборку; параметры остальных деталей не меняются", () => {
  const { pr, asm, shaft, flange, bush } = demo();
  const before = plain([flange.params, bush.params]);
  shaft.params.steps[1].L = 20; // буртик длиннее на 10 мм
  A.solve(pr, asm);
  assert.equal(axial(pr, flange), 60);
  assert.equal(axial(pr, bush), 115);
  assert.deepEqual(plain([flange.params, bush.params]), before, "детали независимы: меняется только положение");
  bush.params.L = 20; // втулка короче — её положение задаётся левым торцом, не меняется
  flange.params.T = 20;
  const r = A.solve(pr, asm);
  assert.equal(r.ok, true);
  assert.equal(axial(pr, bush), 115);
  assert.equal(axial(pr, flange), 60);
  // смещение сопряжения меняет положение
  asm.mates.find((m) => m.type === "distance").offset = 12;
  A.solve(pr, asm);
  assert.equal(axial(pr, bush), 122);
});

test("без закреплённого компонента сборка не решается и об этом сказано", () => {
  const { pr, asm, flange } = demo();
  const was = plain(flange.placement);
  asm.components[0].fixed = false;
  const r = A.solve(pr, asm);
  assert.deepEqual(status(r), { c1: "free", c2: "free", c3: "free" });
  assert.ok(Object.values(r.mates).every((m) => m.status === "unsolved"));
  assert.match(r.messages[0].text, /нет закреплённого компонента/);
  assert.deepEqual(plain(flange.placement), was, "положение не подделывается");
});

test("закрепление можно перенести: закреплён фланец — вал и втулка решаются от него", () => {
  const { pr, asm, shaft, flange, bush } = demo();
  asm.components[0].fixed = false;
  asm.components[1].fixed = true;
  flange.placement = { x: 10, y: 20, z: 30, rotation: { x: 0, y: 0, z: 0 } }; // фланец стоит вертикально
  const r = A.solve(pr, asm);
  assert.deepEqual(status(r), { c1: "solved", c2: "fixed", c3: "solved" });
  assert.ok(near(shaft.placement.x, 10) && near(shaft.placement.y, 20) && near(shaft.placement.z, 30 - 50), "уступ вала на торце фланца");
  assert.ok(near(bush.placement.z, 30 - 50 + 105));
  assert.equal(r.ok, true);
});

test("недоопределённость: только соосность — свободно смещение вдоль оси, текущее положение сохраняется", () => {
  const { pr, asm, bush } = demo();
  asm.mates = asm.mates.filter((m) => m.id !== "m4");
  bush.placement.x = 33; // где-то на оси
  const r = A.solve(pr, asm);
  assert.equal(r.components.c3.status, "partial");
  assert.match(r.components.c3.text, /вдоль оси/);
  assert.equal(bush.placement.x, 33);
  assert.ok(r.messages.some((m) => m.severity === "warning" && /не полностью/.test(m.text)));
  // только грани без соосности — свободны смещение в плоскости и поворот
  asm.mates = asm.mates.filter((m) => m.id !== "m1");
  const r2 = A.solve(pr, asm);
  assert.equal(r2.components.c2.status, "partial");
  assert.match(r2.components.c2.text, /в плоскости грани/);
});

test("подавленное сопряжение не участвует; компонент без сопряжений — «нет сопряжений»", () => {
  const { pr, asm } = demo();
  asm.mates.find((m) => m.id === "m2").suppressed = true;
  const r = A.solve(pr, asm);
  assert.equal(r.mates.m2.status, "suppressed");
  assert.equal(r.components.c2.status, "partial");
  const extra = M.createPart(pr, "bushing", { name: "Лишняя" });
  pr.parts.push(extra);
  A.addComponent(pr, asm, extra.id);
  const r2 = A.solve(pr, asm);
  assert.equal(r2.components.c4.status, "free");
  assert.equal(r2.components.c4.text, "нет сопряжений");
});

test("некорректные сопряжения отклоняются с понятным текстом, сборка не меняется", () => {
  const { pr, asm } = demo();
  const n = asm.mates.length;
  const bad = (spec, re) => { assert.throws(() => A.addMate(pr, asm, spec), re); assert.equal(asm.mates.length, n); };
  bad({ type: "coaxial", a: { comp: "c1" }, b: { comp: "c1" } }, /сам с собой/);
  bad({ type: "planar", mode: "contact", a: { comp: "c1", ref: "step9" }, b: { comp: "c2", ref: "end0" } }, /нет плоской грани «step9»/);
  bad({ type: "planar", mode: "contact", a: { comp: "c1", ref: "axis" }, b: { comp: "c2", ref: "end0" } }, /нужна плоская грань/);
  bad({ type: "distance", mode: "contact", offset: -2, a: { comp: "c1", ref: "end1" }, b: { comp: "c3", ref: "end1" } }, /зашли бы друг в друга/);
  bad({ type: "distance", mode: "contact", offset: NaN, a: { comp: "c1", ref: "end1" }, b: { comp: "c3", ref: "end1" } }, /конечное число/);
  bad({ type: "coaxial", a: { comp: "c2" }, b: { comp: "c1" } }, /уже есть/);
  bad({ type: "coaxial", a: { comp: "c1" }, b: { comp: "c9" } }, /нет в сборке/);
  // противоречие: второе осевое положение фланца
  bad({ type: "distance", mode: "contact", offset: 3, a: { comp: "c1", ref: "step2" }, b: { comp: "c2", ref: "end1" } }, /не добавлено: .*противоречит/);
  // противоречие направления: втулка «встык» другим торцом при заданном направлении осей
  asm.mates.find((m) => m.id === "m3").orient = "same";
  bad({ type: "planar", mode: "contact", a: { comp: "c1", ref: "end1" }, b: { comp: "c3", ref: "end0" } }, /не добавлено/);
  assert.equal(A.solve(pr, asm).ok, true, "после отказов сборка по-прежнему решена");
});

test("согласное избыточное сопряжение допустимо; два закреплённых с невыполнимым сопряжением — ошибка", () => {
  const { pr, asm } = demo();
  // торец ступицы фланца в 30 мм от уступа вала: то же положение, что уже задано
  A.addMate(pr, asm, { type: "distance", mode: "align", offset: 30, a: { comp: "c1", ref: "step2" }, b: { comp: "c2", ref: "end1" } });
  assert.equal(A.solve(pr, asm).ok, true);
  asm.components[1].fixed = true;
  asm.mates.find((m) => m.type === "distance" && m.b.comp === "c2").offset = 31;
  const r = A.solve(pr, asm);
  assert.equal(r.ok, false);
  assert.ok(r.messages.some((m) => /оба компонента закреплены/.test(m.text)));
});

test("грань исчезла после изменения размеров — сопряжение «не найдена», а не решено", () => {
  const { pr, asm, shaft } = demo();
  shaft.params.steps[1].d = 40; // буртик того же диаметра, что ступень 3: уступа step2 больше нет
  const r = A.solve(pr, asm);
  assert.equal(r.mates.m2.status, "broken");
  assert.match(r.mates.m2.text, /нет плоской грани «step2»/);
  assert.equal(r.components.c2.status, "partial");
  assert.equal(r.ok, false);
});

test("пересечение деталей обнаруживается и не считается соединением; объём — точный для колец", () => {
  const { pr, asm, flange } = demo();
  flange.params.d = 36; // отверстие меньше ступени ⌀40
  const r = A.solve(pr, asm);
  assert.equal(r.ok, false);
  const hit = r.interference.find((i) => i.volume > 0);
  assert.ok(near(hit.volume, Math.PI * (20 * 20 - 18 * 18) * 30, 1e-6), `${hit.volume}`);
  assert.ok(r.messages.some((m) => m.severity === "error" && /пересекаются/.test(m.text) && /не соединение/.test(m.text)));
});

test("грани встык без перекрытия колец — предупреждение «контакта нет»", () => {
  const { pr, asm, flange } = demo();
  // фланец с отверстием ⌀50 торцом к уступу ⌀50→⌀40 (кольцо 20…25 мм): кольцо фланца начинается с 25 мм
  flange.params.d = 50;
  flange.params.hubD = 70;
  const r = A.solve(pr, asm);
  assert.ok(r.messages.some((m) => m.severity === "warning" && /контакта нет/.test(m.text)));
  assert.equal(r.mates.m2.status, "nocontact", "не изображается как выполненное касание");
});

test("общие повороты: решатель работает при произвольно повёрнутом закреплённом вале", () => {
  const { pr, asm, shaft, flange } = demo();
  shaft.placement = { x: 5, y: -7, z: 11, rotation: { x: 33, y: -21, z: 70 } };
  const r = A.solve(pr, asm);
  assert.equal(r.ok, true);
  for (const m of asm.mates) {
    const poses = new Map(asm.components.map((c) => [c.id, { R: M.rotationMatrix(pr.parts.find((p) => p.id === c.partId).placement.rotation), t: ["x", "y", "z"].map((k) => pr.parts.find((p) => p.id === c.partId).placement[k]) }]));
    assert.equal(A.residual(pr, asm, m, poses).ok, true, m.id);
  }
  const R = M.rotationMatrix(flange.placement.rotation);
  const back = M.rotationMatrix(A.eulerXYZ(R));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(near(R[i][j], back[i][j], 1e-6));
});

test("деталь — не больше чем в одной сборке; удаление детали убирает её компонент и сопряжения", () => {
  const { pr, asm, bush } = demo();
  const a2 = A.createAssembly(pr, "Вторая");
  assert.throws(() => A.addComponent(pr, a2, bush.id), /уже входит в сборку «Узел вала»/);
  A.removePart(pr, bush.id);
  pr.parts = pr.parts.filter((p) => p !== bush);
  assert.equal(asm.components.length, 2);
  assert.ok(asm.mates.every((m) => m.a.comp !== "c3" && m.b.comp !== "c3"));
  assert.deepEqual(plain(M.validateProject(pr)), []);
});

test("сохранение и открытие: структура сборки и сопряжения без потерь; старый файл v1 открывается", () => {
  const { pr } = demo();
  const back = IO.parse(IO.serialize(pr));
  assert.deepEqual(plain(back.errors), []);
  assert.deepEqual(plain(back.project), plain(pr));
  assert.equal(A.solve(back.project, back.project.assemblies[0]).ok, true);
  const v1 = plain(M.createDemoProject());
  v1.schemaVersion = 1;
  delete v1.assemblies;
  const old = IO.parse(JSON.stringify(v1));
  assert.deepEqual(plain(old.errors), []);
  assert.equal(old.project.schemaVersion, 2);
  assert.deepEqual(plain(old.project.assemblies), []);
  // испорченная ссылка в файле: компонент без детали убирается с пояснением
  const broken = plain(pr);
  broken.assemblies[0].components[2].partId = "p99";
  const r = IO.parse(JSON.stringify(broken));
  assert.equal(r.project.assemblies[0].components.length, 2);
  assert.ok(r.notes.some((n) => /без детали/.test(n)));
  assert.ok(r.notes.some((n) => /сопряжение m3 без компонента/.test(n)));
});

test("экспорт FreeCAD: без сборок — схема 1 как раньше; со сборкой — схема 2 со структурой и статусами", () => {
  assert.equal(M.exportForCad(M.createDemoProject()).schemaVersion, 1);
  const { pr } = demo();
  const ex = M.exportForCad(pr);
  assert.equal(ex.schemaVersion, 2);
  assert.equal(ex.parts.length, 3);
  const a = ex.assemblies[0];
  assert.equal(a.ok, true);
  assert.deepEqual(plain(a.components.map((c) => [c.partId, c.fixed, c.status])), [["p1", true, "fixed"], ["p2", false, "solved"], ["p3", false, "solved"]]);
  assert.equal(a.mates.length, 4);
  assert.ok(a.mates.every((m) => m.status === "ok" && m.label));
});

test("файлы демо-сборки синхронны с кодом (node tests/mech_build.mjs)", () => {
  const read = (f) => JSON.parse(readFileSync(path.join(ROOT, f), "utf-8"));
  assert.deepEqual(read("examples/mech/assembly.mech.json"), plain(A.createDemoAssemblyProject()));
  assert.deepEqual(read("examples/mech/assembly.mech-freecad.json"), plain(M.exportForCad(A.createDemoAssemblyProject())));
  assert.deepEqual(read("tests/mech_interference.freecad.json"), plain(interferenceExport(BS)));
});
