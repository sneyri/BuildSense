// «Соединить детали» мышью: классификация поверхностей, варианты, предпросмотр, применение, правила перемещения.
// Чистая логика (js/mech/mechConnect.js) — тесты запускаются в Node; рисование и мышь проверяются отдельно в браузере.
import test from "node:test";
import assert from "node:assert/strict";
import { loadMech } from "./mech_build.mjs";

const BS = loadMech();
const M = BS.mechModel, A = BS.mechAssembly, C = BS.mechConnect, IO = BS.mechIO;
const plain = (v) => JSON.parse(JSON.stringify(v));
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const eq = (a, b, m) => assert.deepEqual(plain(a), plain(b), m);

function scene() {
  const pr = M.createProject("Соединение");
  const shaft = M.createPart(pr, "shaft", { name: "Вал", params: { c1: 1, c2: 1, steps: [{ d: 30, L: 40 }, { d: 50, L: 10 }, { d: 40, L: 50 }, { d: 25, L: 30 }] }, placement: { x: 0, y: 0, z: 0, rotation: { x: 0, y: 90, z: 0 } } });
  pr.parts.push(shaft);
  const bush = M.createPart(pr, "bushing", { name: "Втулка", placement: { x: 300, y: 80, z: 40, rotation: { x: 20, y: 10, z: 5 } } });
  pr.parts.push(bush);
  const fl = M.createPart(pr, "flange", { name: "Фланец", placement: { x: -300, y: -100, z: 0 } });
  pr.parts.push(fl);
  return { pr, shaft, bush, fl };
}
// «клики» по реальной геометрии: точка и нормаль в системе детали
const hitBushOuter = (b) => C.classifyHit(b, [20, 0, 15], [1, 0, 0]);
const hitBushBore = (b) => C.classifyHit(b, [12.5, 0, 15], [-1, 0, 0]);
const hitBushEnd0 = (b) => C.classifyHit(b, [16, 0, 0], [0, 0, -1]);
const hitShaftStep3 = (s) => C.classifyHit(s, [16, 0, 100], [0, 0, 1]); // уступ ⌀40 → ⌀25 (z = 100)
const hitShaftEnd1 = (s) => C.classifyHit(s, [6, 0, 130], [0, 0, 1]);
const hitShaftTip = (s) => C.classifyHit(s, [12.5, 0, 115], [1, 0, 0]); // цилиндр ⌀25

test("1 классификация: торцы и уступы — плоскости с настоящими id граней решателя", () => {
  const { shaft, bush } = scene();
  const e0 = hitBushEnd0(bush);
  assert.equal(e0.kind, "plane"); assert.equal(e0.ref, "end0");
  const st = hitShaftStep3(shaft);
  assert.equal(st.kind, "plane"); assert.equal(st.ref, "step3");
  assert.ok(A.faces(shaft).some((f) => f.id === st.ref), "такой грани нет у решателя");
  assert.equal(hitShaftEnd1(shaft).ref, "end1");
});

test("2 классификация: цилиндр снаружи, отверстие, цилиндр вала по радиусу из профиля", () => {
  const { shaft, bush } = scene();
  const o = hitBushOuter(bush), b = hitBushBore(bush), t = hitShaftTip(shaft);
  assert.equal(o.kind, "cylinder"); assert.equal(o.outward, true); assert.ok(near(o.r, 20));
  assert.equal(b.kind, "cylinder"); assert.equal(b.outward, false); assert.ok(near(b.r, 12.5));
  assert.equal(t.kind, "cylinder"); assert.ok(near(t.r, 12.5));
  assert.ok(/Отверстие ⌀25/.test(b.label));
});

test("3 отверстие под болт фланца и фаска — не поддерживаются, и объясняют почему", () => {
  const { fl, bush } = scene();
  const hole = C.classifyHit(fl, [62, 0, 7], [1, 0, 0]); // стенка отверстия ⌀14 на окружности 110
  assert.equal(hole.kind, "hole");
  assert.match(hole.reason, /отверстие под болт/);
  const chamfer = C.classifyHit(bush, [19.7, 0, 0.3], [0.7, 0, -0.7]);
  assert.equal(chamfer.kind, "unsupported");
});

test("4 варианты: цилиндры → «Совместить оси»; торцы → прижать/зазор/вровень; смесь и одна деталь → объяснение", () => {
  const { shaft, bush } = scene();
  eq(C.proposals(hitShaftTip(shaft), hitBushBore(bush)).choices.map((c) => c.id), ["axes"]);
  eq(C.proposals(hitShaftStep3(shaft), hitBushEnd0(bush)).choices.map((c) => c.id), ["press", "gap", "flush"]);
  const mixed = C.proposals(hitShaftStep3(shaft), hitBushBore(bush));
  assert.equal(mixed.choices.length, 0);
  assert.match(mixed.reason, /два плоских торца|цилиндрические/);
  const same = C.proposals(hitBushEnd0(bush), hitBushEnd0(bush));
  assert.equal(same.choices.length, 0);
  assert.match(same.reason, /одна и та же деталь/);
  assert.equal(C.proposals(hitShaftTip(shaft), null).choices.length, 0);
  assert.equal(C.CHOICES.press.label, "Прижать поверхности");
  assert.equal(C.CHOICES.gap.label, "Оставить зазор");
});

test("5 предпросмотр не меняет проект и показывает, куда встанет деталь", () => {
  const { pr, shaft, bush } = scene();
  const before = JSON.stringify(pr);
  const a = hitShaftTip(shaft), b = hitBushBore(bush);
  const p = C.plan(pr, a, b, "axes");
  assert.equal(p.ok, true, p.error);
  assert.equal(JSON.stringify(pr), before, "предпросмотр изменил проект");
  assert.ok(p.placements[bush.id], "втулка должна сдвинуться");
  assert.equal(p.moverId, bush.id);
  assert.ok(p.info.before > 1, "расстояние до соединения должно быть показано");
  assert.ok(near(p.info.after, 0, 1e-6), "оси должны совпасть: " + p.info.after);
});

test("6 применение создаёт настоящее сопряжение и решённую сборку; первая выбранная деталь закрепляется", () => {
  const { pr, shaft, bush } = scene();
  const r = C.apply(pr, hitShaftTip(shaft), hitBushBore(bush), "axes");
  assert.equal(r.ok, true, r.error);
  assert.equal(pr.assemblies.length, 1);
  const asm = pr.assemblies[0];
  assert.equal(asm.mates.length, 1);
  assert.equal(asm.mates[0].type, "coaxial");
  assert.equal(asm.components.find((c) => c.partId === shaft.id).fixed, true);
  assert.equal(A.solve(pr, asm).components[asm.components.find((c) => c.partId === bush.id).id].status, "partial");
  eq(A.validate(pr), []);
});

test("7 «Прижать поверхности» + «Совместить оси»: втулка полностью определена, торец лежит на уступе, пересечений нет", () => {
  const { pr, shaft, bush } = scene();
  assert.equal(C.apply(pr, hitShaftTip(shaft), hitBushBore(bush), "axes").ok, true);
  const r = C.apply(pr, hitShaftStep3(shaft), hitBushEnd0(bush), "press");
  assert.equal(r.ok, true, r.error);
  assert.equal(r.status, "solved");
  assert.equal(r.interference.length, 0);
  assert.ok(near(bush.placement.x, 100, 1e-6) && near(bush.placement.y, 0, 1e-6) && near(bush.placement.z, 0, 1e-6), JSON.stringify(plain(bush.placement)));
});

test("8 «Оставить зазор»: расстояние между поверхностями ровно заданное", () => {
  const { pr, shaft, bush } = scene();
  C.apply(pr, hitShaftTip(shaft), hitBushBore(bush), "axes");
  const r = C.apply(pr, hitShaftStep3(shaft), hitBushEnd0(bush), "gap", { gap: 7.5 });
  assert.equal(r.ok, true, r.error);
  assert.ok(near(C.distanceBetween(pr, hitShaftStep3(shaft), hitBushEnd0(bush)), 7.5, 1e-6));
});

test("9 конфликт: противоречащее соединение не применяется, проект остаётся прежним, ложного успеха нет", () => {
  const { pr, shaft, bush } = scene();
  C.apply(pr, hitShaftTip(shaft), hitBushBore(bush), "axes");
  C.apply(pr, hitShaftStep3(shaft), hitBushEnd0(bush), "press");
  const before = JSON.stringify(pr);
  const r = C.apply(pr, hitShaftStep3(shaft), hitBushEnd0(bush), "gap", { gap: 9 });
  assert.equal(r.ok, false);
  assert.ok(r.error && r.error.length > 10, r.error);
  assert.equal(JSON.stringify(pr), before, "частично изменённая сборка после отказа");
});

test("10 обе детали закреплены / разные сборки — понятный отказ; закреплена вторая — едет первая", () => {
  const { pr, shaft, bush, fl } = scene();
  C.apply(pr, hitShaftTip(shaft), hitBushBore(bush), "axes");
  const asm2 = A.createAssembly(pr, "Другая");
  A.addComponent(pr, asm2, fl.id, { fixed: true });
  const diff = C.plan(pr, C.classifyHit(fl, [50, 0, 14], [0, 0, 1]), hitBushEnd0(bush), "press");
  assert.equal(diff.ok, false);
  assert.match(diff.error, /разные сборки|в разные/);
  const s2 = scene();
  assert.equal(C.apply(s2.pr, C.classifyHit(s2.fl, [50, 0, 14], [0, 0, 1]), hitShaftStep3(s2.shaft), "press").ok, true);
  const comp = (pid) => s2.pr.assemblies[0].components.find((c) => c.partId === pid);
  assert.equal(comp(s2.fl.id).fixed, true, "первый выбранный закреплён");
  assert.equal(comp(s2.shaft.id).fixed, false);
  const both = scene();
  C.toggleFixed(both.pr, both.shaft.id);
  const asm = A.assemblyOfPart(both.pr, both.shaft.id);
  A.addComponent(both.pr, asm, both.bush.id, { fixed: true });
  const r = C.plan(both.pr, hitShaftTip(both.shaft), hitBushBore(both.bush), "axes");
  assert.equal(r.ok, false);
  assert.match(r.error, /Обе детали закреплены/);
});

test("11 правила перемещения: свободная / закреплённая (двигает всю сборку) / соединённая (нельзя) + действия", () => {
  const { pr, shaft, bush, fl } = scene();
  assert.equal(C.moveRule(pr, bush.id).mode, "free");
  C.apply(pr, hitShaftTip(shaft), hitBushBore(bush), "axes");
  C.apply(pr, hitShaftStep3(shaft), hitBushEnd0(bush), "press");
  const anchor = C.moveRule(pr, shaft.id);
  assert.equal(anchor.mode, "anchor"); assert.match(anchor.reason, /вся сборка|поедет/);
  const mated = C.moveRule(pr, bush.id);
  assert.equal(mated.mode, "mated"); assert.match(mated.reason, /сопряжения|правило/);
  assert.ok(mated.actions.some((a) => a.id === "suppress") && mated.actions.some((a) => a.id === "exclude"));
  assert.equal(C.moveRule(pr, fl.id).mode, "free");
  const placed = plain(bush.placement);
  assert.equal(C.resolveLock(pr, bush.id, "suppress"), true);
  assert.equal(C.moveRule(pr, bush.id).mode, "free");
  eq(bush.placement, placed);
  assert.equal(C.resolveLock(pr, bush.id, "exclude"), true);
  assert.equal(A.componentOfPart(pr, bush.id), null);
});

test("12 «Закрепить / снять закрепление» (K): создаёт сборку, переключает, переживает сохранение", () => {
  const { pr, shaft } = scene();
  assert.equal(C.toggleFixed(pr, shaft.id).fixed, true);
  assert.equal(A.componentOfPart(pr, shaft.id).comp.fixed, true);
  const back = IO.parse(IO.serialize(pr));
  assert.equal(A.componentOfPart(back.project, shaft.id).comp.fixed, true);
  assert.equal(C.toggleFixed(pr, shaft.id).fixed, false);
});

test("13 «Дублировать» (Ctrl+D): новая деталь с новым id, независимыми параметрами, рядом, вне сборки", () => {
  const { pr, bush } = scene();
  const copy = C.duplicatePart(pr, bush.id);
  assert.notEqual(copy.id, bush.id);
  assert.equal(pr.parts.length, 4);
  copy.params.D = 99;
  assert.equal(bush.params.D, 40);
  assert.equal(A.componentOfPart(pr, copy.id), null);
  assert.ok(copy.placement.x > bush.placement.x);
});

test("14 результат соединения мышью сохраняется, загружается и попадает в экспорт с актуальными положениями", () => {
  const { pr, shaft, bush } = scene();
  C.apply(pr, hitShaftTip(shaft), hitBushBore(bush), "axes");
  C.apply(pr, hitShaftStep3(shaft), hitBushEnd0(bush), "press");
  const back = IO.parse(IO.serialize(pr));
  eq(back.errors, []);
  eq(back.project.assemblies, pr.assemblies);
  eq(back.project.parts.map((p) => p.placement), pr.parts.map((p) => p.placement));
  const ex = M.exportForCad(pr);
  assert.equal(ex.assemblies[0].mates.length, 2);
  assert.ok(ex.assemblies[0].mates.every((m) => m.status === "ok"));
  assert.ok(near(ex.parts.find((p) => p.id === bush.id).placement.x, 100, 1e-6));
});

test("15 отмена: неудачное применение не оставляет «хвостов» (пустая сборка не создаётся)", () => {
  const { pr, shaft, bush } = scene();
  const before = JSON.stringify(pr);
  assert.equal(C.apply(pr, hitShaftStep3(shaft), hitBushBore(bush), "press").ok, false); // плоскость + цилиндр
  assert.equal(JSON.stringify(pr), before);
  assert.equal(pr.assemblies.length, 0);
});
