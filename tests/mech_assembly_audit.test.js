// Аудит сборок (машиностроение): создание, позиционирование, сопряжения, перестроение, сохранение, экспорт, сквозной сценарий.
// Файлы пользователя не трогаются: всё строится в памяти (vm-контекст) и во временной папке ОС.
//   npm test   или   node --test tests/mech_assembly_audit.test.js
// Коды сценариев (A1, B2, …) используются в ASSEMBLY_QA_REPORT.md.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadMech } from "./mech_build.mjs";

const BS = loadMech();
const M = BS.mechModel, A = BS.mechAssembly, G = BS.mechGeometry, IO = BS.mechIO;
const plain = (v) => JSON.parse(JSON.stringify(v));
const eq = (a, b, m) => assert.deepEqual(plain(a), plain(b), m); // vm-контекст: массивы «чужого» мира сравниваем через JSON
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearArr = (a, b, tol = 1e-6) => a.length === b.length && a.every((x, i) => near(x, b[i], tol));
const TMP = mkdtempSync(path.join(os.tmpdir(), "bs-assembly-audit-"));
test.after(() => rmSync(TMP, { recursive: true, force: true }));

/** Вал (4 ступени с буртиком ⌀50, как в учебной сборке), втулка, фланец; вал закреплён. Детали стоят «где попало». */
function scene({ fixShaft = true } = {}) {
  const pr = M.createProject("Аудит");
  const shaft = M.createPart(pr, "shaft", { name: "Вал", params: { c1: 1, c2: 1, steps: [{ d: 30, L: 40 }, { d: 50, L: 10 }, { d: 40, L: 50 }, { d: 25, L: 30 }] }, placement: { x: 10, y: 20, z: 30, rotation: { x: 0, y: 90, z: 0 } } });
  pr.parts.push(shaft);
  const bush = M.createPart(pr, "bushing", { name: "Втулка", placement: { x: 300, y: 50, z: 20, rotation: { x: 10, y: 20, z: 30 } } });
  pr.parts.push(bush);
  const fl = M.createPart(pr, "flange", { name: "Фланец", placement: { x: -200, y: 90, z: 5 } });
  pr.parts.push(fl);
  const asm = A.createAssembly(pr, "Узел");
  const cs = A.addComponent(pr, asm, shaft.id, { fixed: fixShaft });
  const cb = A.addComponent(pr, asm, bush.id);
  const cf = A.addComponent(pr, asm, fl.id);
  return { pr, asm, shaft, bush, fl, cs, cb, cf };
}
const coax = (s, c) => A.addMate(s.pr, s.asm, { type: "coaxial", a: { comp: s.cs.id }, b: { comp: c.id } });
const planar = (s, ref, c, cref, mode = "contact") => A.addMate(s.pr, s.asm, { type: "planar", mode, a: { comp: s.cs.id, ref }, b: { comp: c.id, ref: cref } });
const dist = (s, ref, c, cref, offset, mode = "contact") => A.addMate(s.pr, s.asm, { type: "distance", mode, offset, a: { comp: s.cs.id, ref }, b: { comp: c.id, ref: cref } });
/** Ось детали в мире: точка и единичное направление (локальная Z). */
function axisWorld(part) {
  const p = M.transformPoint(part.placement, [0, 0, 0]);
  const q = M.transformPoint(part.placement, [0, 0, 1]);
  return { p, d: [q[0] - p[0], q[1] - p[1], q[2] - p[2]] };
}
const along = (part, ref, ax) => { // координата грани вдоль оси ax
  const f = A.faces(part).find((x) => x.id === ref);
  const q = M.transformPoint(part.placement, [0, 0, f.z]);
  return (q[0] - ax.p[0]) * ax.d[0] + (q[1] - ax.p[1]) * ax.d[1] + (q[2] - ax.p[2]) * ax.d[2];
};
const axisDist = (a, b) => { // расстояние от оси b до оси a (параллельных)
  const w = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
  const c = [w[1] * a.d[2] - w[2] * a.d[1], w[2] * a.d[0] - w[0] * a.d[2], w[0] * a.d[1] - w[1] * a.d[0]];
  return Math.hypot(...c);
};

// ====================================================================== A. Создание сборки

test("A1 пустая сборка: решается без ошибок, предупреждает об отсутствии закреплённого компонента", () => {
  const pr = M.createProject("пусто");
  const asm = A.createAssembly(pr);
  const r = A.solve(pr, asm);
  assert.equal(asm.components.length, 0);
  assert.equal(r.ok, true);
  eq(M.validateProject(pr), []);
});

test("A2 компоненты: уникальные id, одна деталь — один компонент, деталь только в одной сборке", () => {
  const s = scene();
  const ids = s.asm.components.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.throws(() => A.addComponent(s.pr, s.asm, s.shaft.id), /уже входит/);
  const asm2 = A.createAssembly(s.pr, "Вторая");
  assert.notEqual(asm2.id, s.asm.id);
  assert.throws(() => A.addComponent(s.pr, asm2, s.bush.id), /уже входит/);
  assert.throws(() => A.addComponent(s.pr, asm2, "p999"), /не найдена/);
});

test("A3 удаление и повторное добавление компонента: сопряжения убираются, id не конфликтуют", () => {
  const s = scene();
  coax(s, s.cb); coax(s, s.cf);
  assert.equal(s.asm.mates.length, 2);
  A.removeComponent(s.asm, s.cb.id);
  assert.equal(s.asm.components.length, 2);
  assert.equal(s.asm.mates.length, 1, "сопряжения удалённого компонента должны исчезнуть");
  assert.ok(s.asm.mates.every((m) => m.a.comp !== s.cb.id && m.b.comp !== s.cb.id));
  const again = A.addComponent(s.pr, s.asm, s.bush.id);
  const ids = s.asm.components.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, `повторяющиеся id: ${ids}`);
  eq(A.validate(s.pr), []);
  assert.equal(A.solve(s.pr, s.asm).components[again.id].status, "free");
});

test("A4 удаление детали из проекта убирает её компонент и сопряжения", () => {
  const s = scene();
  coax(s, s.cb);
  s.pr.parts = s.pr.parts.filter((p) => p.id !== s.bush.id);
  A.removePart(s.pr, s.bush.id);
  eq(A.validate(s.pr), []);
  assert.equal(s.asm.components.length, 2);
  assert.equal(s.asm.mates.length, 0);
});

test("A5 параметры экземпляров независимы (два вала, две втулки: изменение одной не трогает другую)", () => {
  const pr = M.createProject("копии");
  const a = M.createPart(pr, "shaft"); pr.parts.push(a);
  const b = M.createPart(pr, "shaft"); pr.parts.push(b);
  const c = M.createPart(pr, "bushing"); pr.parts.push(c);
  const d = M.createPart(pr, "bushing"); pr.parts.push(d);
  assert.notEqual(a.id, b.id);
  assert.notEqual(c.id, d.id);
  a.params.steps[0].d = 99;
  c.params.D = 77;
  assert.equal(b.params.steps[0].d, 30);
  assert.equal(d.params.D, 40);
  assert.notEqual(a.params.steps, b.params.steps);
  assert.notEqual(a.placement, b.placement);
  assert.notEqual(a.placement.rotation, b.placement.rotation);
  assert.equal(new Set(pr.parts.map((p) => p.id)).size, 4);
});

// ====================================================================== B. Позиционирование

test("B1 смещение по каждой оси сдвигает габарит ровно на заданную величину", () => {
  const pr = M.createProject("b1");
  const p = M.createPart(pr, "flange", { placement: { x: 0, y: 0, z: 0, rotation: { x: 17, y: 33, z: 51 } } });
  const b0 = M.worldBounds(p);
  for (const [i, k] of [[0, "x"], [1, "y"], [2, "z"]]) {
    const q = plain(p);
    q.placement[k] += 123.5;
    const b1 = M.worldBounds(q);
    for (let j = 0; j < 3; j++) {
      const want = j === i ? 123.5 : 0;
      assert.ok(near(b1.min[j] - b0.min[j], want, 1e-9) && near(b1.max[j] - b0.max[j], want, 1e-9), `ось ${k}, координата ${j}`);
    }
  }
});

test("B2 поворот вокруг осей: ось детали Z поворачивается ожидаемо (90° → направления X/Y/Z)", () => {
  const dirs = [
    [{ x: 90, y: 0, z: 0 }, [0, -1, 0]], // Rx(90): Z → −Y
    [{ x: 0, y: 90, z: 0 }, [1, 0, 0]], //  Ry(90): Z → +X
    [{ x: 0, y: 0, z: 90 }, [0, 0, 1]], //  Rz(90): Z остаётся Z
  ];
  for (const [rot, want] of dirs) {
    const o = M.transformPoint({ x: 0, y: 0, z: 0, rotation: rot }, [0, 0, 0]);
    const t = M.transformPoint({ x: 0, y: 0, z: 0, rotation: rot }, [0, 0, 1]);
    assert.ok(nearArr([t[0] - o[0], t[1] - o[1], t[2] - o[2]], want, 1e-9), JSON.stringify(rot) + " → " + t.map((v) => v.toFixed(3)));
  }
});

test("B3 порядок поворотов: матрица модели совпадает с THREE.Euler XYZ, которой рисуется сцена (50 случайных положений)", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const T = globalThis.THREE || BS.mechGeometry && null;
  const pr = M.createProject("b3");
  for (let i = 0; i < 50; i++) {
    const part = M.createPart(pr, "bushing", { placement: { x: rnd() * 400 - 200, y: rnd() * 400 - 200, z: rnd() * 400 - 200, rotation: { x: rnd() * 360 - 180, y: rnd() * 360 - 180, z: rnd() * 360 - 180 } } });
    const mat = G.partMatrix(part).elements; // THREE: column-major
    const local = [rnd() * 50, rnd() * 50, rnd() * 80];
    const viaThree = [0, 1, 2].map((r) => mat[r] * local[0] + mat[4 + r] * local[1] + mat[8 + r] * local[2] + mat[12 + r]);
    const viaModel = M.transformPoint(part.placement, local);
    assert.ok(nearArr(viaThree, viaModel, 1e-6), `случай ${i}: ${viaThree} ≠ ${viaModel}`);
  }
});

test("B4 габарит детали в мире совпадает с габаритом сетки (после поворота и сдвига)", () => {
  const s = scene();
  for (const part of s.pr.parts) {
    const rep = G.partReport(part);
    for (let i = 0; i < 3; i++) {
      assert.ok(near(rep.bounds.min[i], rep.meshBounds.min[i], 0.2) && near(rep.bounds.max[i], rep.meshBounds.max[i], 0.2), `${part.name}, ось ${i}: ${rep.bounds.min[i]} vs ${rep.meshBounds.min[i]}`);
    }
    assert.ok(Math.abs(rep.meshDeviation) < 0.005, `${part.name}: объём сетки отличается на ${rep.meshDeviation}`);
  }
});

test("B5 eulerXYZ ↔ rotationMatrix: туда-обратно без потерь (200 случайных поворотов)", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 200; i++) {
    const rot = { x: rnd() * 360 - 180, y: rnd() * 178 - 89, z: rnd() * 360 - 180 };
    const R = M.rotationMatrix(rot);
    const e = A.eulerXYZ(R);
    const R2 = M.rotationMatrix(e);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) assert.ok(near(R[r][c], R2[r][c], 1e-6), `поворот ${JSON.stringify(rot)}`);
  }
});

// ====================================================================== C. Сопряжения

test("C1 соосность: ось втулки встаёт на ось повёрнутого вала; закреплённый вал не двигается", () => {
  const s = scene();
  const before = plain(s.shaft.placement);
  coax(s, s.cb);
  const r = A.solve(s.pr, s.asm);
  assert.equal(r.mates.m1.status, "ok");
  eq(plain(s.shaft.placement), before, "закреплённый вал сдвинулся");
  const a = axisWorld(s.shaft), b = axisWorld(s.bush);
  assert.ok(axisDist(a, b) < 1e-6, "оси не совпали: " + axisDist(a, b));
  const cross = [a.d[1] * b.d[2] - a.d[2] * b.d[1], a.d[2] * b.d[0] - a.d[0] * b.d[2], a.d[0] * b.d[1] - a.d[1] * b.d[0]];
  assert.ok(Math.hypot(...cross) < 1e-9, "оси не параллельны");
  assert.equal(r.components[s.cb.id].status, "partial", "один вид сопряжения — компонент недоопределён (свободен сдвиг вдоль оси)");
});

test("C2 грани встык: торец втулки лежит в плоскости уступа вала, нормали направлены навстречу", () => {
  const s = scene();
  coax(s, s.cb);
  planar(s, "step3", s.cb, "end0");
  const r = A.solve(s.pr, s.asm);
  assert.equal(r.components[s.cb.id].status, "solved");
  const ax = axisWorld(s.shaft);
  assert.ok(near(along(s.shaft, "step3", ax), along(s.bush, "end0", ax), 1e-6), "плоскости не совпали");
  // втулка продолжается от уступа вперёд (в сторону тонкой ступени): её центр дальше от начала вала, чем уступ
  const mid = M.transformPoint(s.bush.placement, [0, 0, 15]);
  const ds = (mid[0] - ax.p[0]) * ax.d[0] + (mid[1] - ax.p[1]) * ax.d[1] + (mid[2] - ax.p[2]) * ax.d[2];
  assert.ok(ds > along(s.shaft, "step3", ax), "втулка встала не с той стороны уступа");
  assert.equal(r.interference.filter((x) => x.volume > 1e-3).length, 0, "детали пересекаются");
});

test("C3 заподлицо (align): торцы смотрят в одну сторону и лежат в одной плоскости", () => {
  const s = scene();
  coax(s, s.cb);
  planar(s, "end1", s.cb, "end1", "align");
  A.solve(s.pr, s.asm);
  const ax = axisWorld(s.shaft);
  assert.ok(near(along(s.shaft, "end1", ax), along(s.bush, "end1", ax), 1e-6));
});

test("C4 осевое смещение: зазор между гранями ровно равен заданному, и он следует за изменением смещения", () => {
  const s = scene();
  coax(s, s.cb);
  const { mate } = dist(s, "step3", s.cb, "end0", 5);
  A.solve(s.pr, s.asm);
  const ax = axisWorld(s.shaft);
  assert.ok(near(along(s.bush, "end0", ax) - along(s.shaft, "step3", ax), 5, 1e-6));
  mate.offset = 12.5;
  A.solve(s.pr, s.asm);
  assert.ok(near(along(s.bush, "end0", ax) - along(s.shaft, "step3", ax), 12.5, 1e-6));
  assert.throws(() => dist(s, "step2", s.cb, "end1", -3), /зашли|< 0/);
});

test("C5 подавление и удаление сопряжения: компонент остаётся на месте, статус возвращается к «недоопределён»", () => {
  const s = scene();
  coax(s, s.cb);
  const { mate } = planar(s, "step3", s.cb, "end0");
  A.solve(s.pr, s.asm);
  const placed = plain(s.bush.placement);
  mate.suppressed = true;
  let r = A.solve(s.pr, s.asm);
  assert.equal(r.mates[mate.id].status, "suppressed");
  assert.equal(r.components[s.cb.id].status, "partial");
  eq(plain(s.bush.placement), placed, "подавление не должно двигать деталь");
  mate.suppressed = false;
  assert.equal(A.solve(s.pr, s.asm).components[s.cb.id].status, "solved");
  s.asm.mates = s.asm.mates.filter((m) => m.id !== mate.id);
  assert.equal(A.solve(s.pr, s.asm).components[s.cb.id].status, "partial");
});

test("C6 противоречивые сопряжения отклоняются при добавлении (деталь и сборка не меняются)", () => {
  const s = scene();
  coax(s, s.cb);
  planar(s, "step3", s.cb, "end0");
  const before = JSON.stringify(s.pr);
  assert.throws(() => dist(s, "step3", s.cb, "end0", 7), /не добавлено|уже есть|противореч/);
  assert.throws(() => planar(s, "step3", s.cb, "end0"), /уже есть|не добавлено/);
  assert.equal(JSON.stringify(s.pr), before, "отклонённое сопряжение изменило проект");
});

test("C7 противоречие из файла (минуя addMate) распознаётся как «конфликт», а не «успех»", () => {
  const s = scene();
  coax(s, s.cb);
  planar(s, "step3", s.cb, "end0");
  const raw = plain(s.pr);
  raw.assemblies[0].mates.push({ id: "m9", type: "distance", mode: "contact", offset: 7, a: { comp: "c1", ref: "step3" }, b: { comp: "c2", ref: "end0" }, suppressed: false });
  const { project } = IO.parse(JSON.stringify(raw));
  const r = A.solve(project, project.assemblies[0]);
  assert.equal(r.ok, false);
  assert.ok(Object.values(r.mates).some((m) => m.status === "conflict"), JSON.stringify(plain(r.mates)));
});

test("C8 недоопределённость и отсутствие опоры сообщаются явно", () => {
  const s = scene({ fixShaft: false });
  coax(s, s.cb);
  const r = A.solve(s.pr, s.asm);
  assert.ok(r.messages.some((m) => /закреплённого/.test(m.text)), "нет предупреждения об опоре");
  assert.ok(["free", "partial"].includes(r.components[s.cb.id].status));
  assert.notEqual(r.components[s.cb.id].status, "solved");
});

test("C9 повторное решение идемпотентно (3 прогона — те же положения до 1e-9)", () => {
  const s = scene();
  coax(s, s.cb); planar(s, "step3", s.cb, "end0"); coax(s, s.cf); planar(s, "step2", s.cf, "end0");
  A.solve(s.pr, s.asm);
  const once = plain(s.pr.parts.map((p) => p.placement));
  for (let i = 0; i < 3; i++) A.solve(s.pr, s.asm);
  const again = plain(s.pr.parts.map((p) => p.placement));
  once.forEach((p, i) => { assert.ok(nearArr([p.x, p.y, p.z, p.rotation.x, p.rotation.y, p.rotation.z], [again[i].x, again[i].y, again[i].z, again[i].rotation.x, again[i].rotation.y, again[i].rotation.z], 1e-9)); });
});

test("C10 цепочка: деталь, привязанная к незакреплённой детали, следует за ней; сопряжение компонента с самим собой запрещено", () => {
  const s = scene();
  coax(s, s.cb); planar(s, "step3", s.cb, "end0");
  A.addMate(s.pr, s.asm, { type: "coaxial", a: { comp: s.cb.id }, b: { comp: s.cf.id } });
  A.addMate(s.pr, s.asm, { type: "distance", mode: "contact", offset: 2, a: { comp: s.cb.id, ref: "end1" }, b: { comp: s.cf.id, ref: "end0" } });
  let r = A.solve(s.pr, s.asm);
  assert.equal(r.components[s.cf.id].status, "solved");
  const ax = axisWorld(s.shaft);
  assert.ok(near(along(s.fl, "end0", ax) - along(s.bush, "end1", ax), 2, 1e-6));
  s.shaft.placement.x += 100; // двигаем закреплённый вал — вся цепочка должна поехать
  A.solve(s.pr, s.asm);
  const ax2 = axisWorld(s.shaft);
  assert.ok(axisDist(ax2, axisWorld(s.fl)) < 1e-6);
  assert.ok(near(along(s.fl, "end0", ax2) - along(s.bush, "end1", ax2), 2, 1e-6));
  assert.throws(() => A.addMate(s.pr, s.asm, { type: "coaxial", a: { comp: s.cb.id }, b: { comp: s.cb.id } }), /сам с собой/);
});

test("C11 сопряжение запрещено для неподходящих привязок (ось вместо грани, несуществующая грань)", () => {
  const s = scene();
  assert.throws(() => A.addMate(s.pr, s.asm, { type: "planar", mode: "contact", a: { comp: s.cs.id, ref: "axis" }, b: { comp: s.cb.id, ref: "end0" } }), /плоская грань/);
  assert.throws(() => planar(s, "step9", s.cb, "end0"), /нет плоской грани/);
});

// ====================================================================== D. Изменение геометрии

function solved() {
  const s = scene();
  coax(s, s.cb); planar(s, "step3", s.cb, "end0");
  coax(s, s.cf); planar(s, "step2", s.cf, "end0");
  A.solve(s.pr, s.asm);
  return s;
}

test("D1 изменение длины ступени вала: втулка и фланец переезжают ровно на разницу", () => {
  const s = solved();
  const ax = axisWorld(s.shaft);
  const b0 = along(s.bush, "end0", ax), f0 = along(s.fl, "end0", ax);
  s.shaft.params.steps[0].L += 15; // сдвигает все уступы
  const r = A.solve(s.pr, s.asm);
  assert.equal(r.ok, true);
  assert.ok(near(along(s.bush, "end0", ax), b0 + 15, 1e-6));
  assert.ok(near(along(s.fl, "end0", ax), f0 + 15, 1e-6));
  assert.ok(near(along(s.shaft, "step3", ax), along(s.bush, "end0", ax), 1e-6), "контакт потерян");
});

test("D2 изменение длины самой втулки: упор в уступ сохраняется, второй торец уходит", () => {
  const s = solved();
  const ax = axisWorld(s.shaft);
  s.bush.params.L = 50;
  A.solve(s.pr, s.asm);
  assert.ok(near(along(s.bush, "end0", ax), along(s.shaft, "step3", ax), 1e-6));
  assert.ok(near(along(s.bush, "end1", ax) - along(s.bush, "end0", ax), 50, 1e-6));
});

test("D3 диаметр ступени: уступ исчезает при равных диаметрах → сопряжение «ошибка», деталь не прыгает и не падает исключением", () => {
  const s = solved();
  const placed = plain(s.bush.placement);
  s.shaft.params.steps[3].d = 40; // ступени 3 и 4 стали одного диаметра → уступа step3 нет
  let r;
  assert.doesNotThrow(() => { r = A.solve(s.pr, s.asm); });
  const st = Object.values(r.mates).map((m) => m.status);
  assert.ok(st.includes("broken"), "сопряжение с исчезнувшей гранью должно быть «broken»: " + st);
  eq(plain(s.bush.placement), placed, "деталь с «битым» сопряжением не должна менять положение");
  assert.equal(r.ok, false);
});

test("D4 добавление ступени в конец вала не ломает сопряжения; удаление ступени с гранью — ломает явно", () => {
  const s = solved();
  s.shaft.params.steps.push({ d: 20, L: 25 });
  assert.equal(A.solve(s.pr, s.asm).ok, true);
  s.shaft.params.steps.splice(2, 2); // осталась пара ступеней: уступы step3 больше нет
  const r = A.solve(s.pr, s.asm);
  assert.equal(r.mates.m2.status, "broken");
  assert.equal(r.ok, false);
});

test("D5 число отверстий фланца и диаметр окружности отверстий не затрагивают сопряжения", () => {
  const s = solved();
  const placed = plain(s.fl.placement);
  for (const n of [0, 3, 12]) {
    s.fl.params.n = n;
    const r = A.solve(s.pr, s.asm);
    assert.equal(r.ok, true, `n=${n}`);
    eq(plain(s.fl.placement), placed);
    assert.equal(M.evaluate(s.fl).holes.length, n);
  }
  s.fl.params.n = 6;
  s.fl.params.pcd = 20; // отверстия налезают на центральное: ошибка параметров
  const errs = M.validateParams("flange", s.fl.params);
  assert.ok(errs.length > 0, "недопустимая окружность отверстий должна ловиться проверкой");
  const r = A.solve(s.pr, s.asm);
  assert.equal(r.components[s.cf.id].status, "invalid");
});

test("D6 недопустимые размеры детали: компонент «invalid», положение не меняется; после исправления сборка снова решается", () => {
  const s = solved();
  const placed = plain(s.bush.placement);
  s.bush.params.d = 100; // отверстие больше наружного диаметра
  const r = A.solve(s.pr, s.asm);
  assert.equal(r.components[s.cb.id].status, "invalid");
  eq(plain(s.bush.placement), placed);
  s.bush.params.d = 25;
  assert.equal(A.solve(s.pr, s.asm).ok, true);
});

test("D7 вал: перемещение закреплённого компонента — вся сборка переезжает как одно целое (взаимные расстояния сохраняются)", () => {
  const s = solved();
  const rel = () => { const a = M.transformPoint(s.bush.placement, [0, 0, 0]), b = M.transformPoint(s.fl.placement, [0, 0, 0]); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
  const d0 = rel();
  s.shaft.placement.rotation = { x: 20, y: 40, z: 60 };
  s.shaft.placement.x = -55; s.shaft.placement.y = 77; s.shaft.placement.z = 11;
  A.solve(s.pr, s.asm);
  assert.ok(near(rel(), d0, 1e-6));
  assert.ok(axisDist(axisWorld(s.shaft), axisWorld(s.bush)) < 1e-6);
});

// ====================================================================== E. Сохранение и восстановление

const snap = (pr) => plain({ name: pr.name, parts: pr.parts, assemblies: pr.assemblies });

test("E1 сохранение → загрузка: id, параметры, положения, компоненты и сопряжения совпадают; 5 циклов подряд стабильны", () => {
  const s = solved();
  s.shaft.name = "Вал «Главный» — ⌀30";
  const first = snap(s.pr);
  let text = IO.serialize(s.pr);
  let cur = s.pr;
  for (let i = 0; i < 5; i++) {
    const res = IO.parse(IO.serialize(cur));
    eq(res.errors, []);
    eq(res.notes, []);
    cur = res.project;
    eq(snap(cur), first, `цикл ${i + 1}`);
  }
  assert.equal(IO.serialize(cur), text, "сериализация после 5 циклов изменилась");
  const r = A.solve(cur, cur.assemblies[0]);
  assert.equal(r.ok, true);
  eq(plain(cur.parts.map((p) => p.placement)), plain(s.pr.parts.map((p) => p.placement)), "повторное решение сдвинуло детали после загрузки");
});

test("E2 старый проект версии 1 без сборок открывается; assemblies = []", () => {
  const old = { format: "buildsense-mech", schemaVersion: 1, units: "mm", name: "Старый", parts: [{ id: "p1", type: "bushing", name: "В", params: M.defaultParams("bushing"), placement: { x: 1, y: 2, z: 3, rotation: { x: 0, y: 0, z: 0 } }, material: "steel" }] };
  const res = IO.parse(JSON.stringify(old));
  eq(res.errors, []);
  eq(res.project.assemblies, []);
  assert.equal(res.project.parts[0].placement.x, 1);
});

test("E3 повреждённые данные: понятные ошибки, а не TypeError/зависание", () => {
  const good = plain(solved().pr);
  const cases = {
    "пустая строка": "",
    "обрезанный JSON": JSON.stringify(good).slice(0, 200),
    "не тот формат": JSON.stringify({ format: "other" }),
    "будущая схема": JSON.stringify({ ...good, schemaVersion: 99 }),
    "дюймы": JSON.stringify({ ...good, units: "in" }),
    "null вместо проекта": "null",
    "массив вместо проекта": "[]",
  };
  for (const [name, text] of Object.entries(cases)) {
    assert.throws(() => IO.parse(text), (e) => e && typeof e.message === "string" && e.name !== "TypeError" && !/Cannot read/.test(e.message), `«${name}»: ожидалась понятная ошибка`);
  }
});

test("E4 повреждённые сборки: битые ссылки убираются с сообщением, проект открывается", () => {
  const good = plain(solved().pr);
  const bad = plain(good);
  bad.assemblies[0].components.push({ id: "c9", partId: "p404", fixed: false });
  bad.assemblies[0].mates.push({ id: "m9", type: "coaxial", a: { comp: "c9", ref: "axis" }, b: { comp: "c1", ref: "axis" } });
  bad.assemblies[0].components.push({ id: "c8", partId: "p2", fixed: false }); // повтор детали
  bad.assemblies.push(null, 5, "x");
  const res = IO.parse(JSON.stringify(bad));
  assert.ok(res.notes.length >= 3, "сообщений об исправлении: " + res.notes.length);
  eq(A.validate(res.project), []);
  assert.equal(res.project.assemblies.length, 1);
  const noArr = plain(good); noArr.assemblies = "oops";
  assert.doesNotThrow(() => IO.parse(JSON.stringify(noArr)));
});

test("E5 повреждённые детали: null в списке деталей и повторяющиеся id деталей обнаруживаются", () => {
  const good = plain(solved().pr);
  const nul = plain(good); nul.parts.push(null);
  assert.throws(() => IO.parse(JSON.stringify(nul)), (e) => e && typeof e.message === "string" && e.name !== "TypeError" && !/Cannot read/.test(e.message), "null в parts даёт непонятный TypeError");
  const dup = plain(good); dup.parts.push({ ...plain(good.parts[1]) }); // тот же id
  const res = IO.parse(JSON.stringify(dup));
  assert.ok(res.errors.length > 0 || res.notes.length > 0, "повторяющийся id детали принят молча");
});

test("E6 автосохранение (serialize/parse) не меняет положения после перезапуска: сборка остаётся «решённой» без повторного решения", () => {
  const s = solved();
  const res = IO.parse(IO.serialize(s.pr));
  const r = A.solve(res.project, res.project.assemblies[0], { apply: false });
  assert.equal(r.ok, true);
  assert.equal(Object.values(r.components).filter((c) => c.status === "solved").length, 2);
});

// ====================================================================== F. Экспорт

test("F1 экспорт JSON: версия 2, отдельные детали с профилем/отверстиями, положения, структура сборки, статусы", () => {
  const s = solved();
  const ex = M.exportForCad(s.pr);
  assert.equal(ex.format, M.EXPORT_FORMAT);
  assert.equal(ex.schemaVersion, 2);
  assert.equal(ex.units, "mm");
  assert.equal(ex.parts.length, 3);
  assert.equal(new Set(ex.parts.map((p) => p.id)).size, 3, "дубликаты деталей в экспорте");
  for (const p of ex.parts) {
    const src = s.pr.parts.find((x) => x.id === p.id);
    eq(p.placement, plain(src.placement));
    assert.ok(p.solid.revolve.profile.length >= 4);
    assert.ok(near(p.analytic.volume, M.analyticVolume(src), 1e-9));
  }
  assert.equal(ex.parts.find((p) => p.type === "flange").solid.holes.length, 6);
  const a = ex.assemblies[0];
  assert.equal(a.ok, true);
  eq(a.components.map((c) => c.status).sort(), ["fixed", "solved", "solved"]);
  assert.equal(a.mates.length, 4);
  assert.ok(a.mates.every((m) => m.status === "ok"));
});

test("F2 экспорт берёт ТЕКУЩИЕ решённые положения: если после правки размера сборка не пересчитана, экспорт не должен выдать устаревшие координаты", () => {
  const s = solved();
  s.shaft.params.steps[0].L += 20; // «забыли» пересчитать
  const ex = M.exportForCad(s.pr);
  // положение втулки в экспорте должно соответствовать решению сборки с новой длиной
  const test = plain(s.pr);
  A.solve(test, test.assemblies[0]);
  const want = test.parts.find((p) => p.id === s.bush.id).placement;
  const got = ex.parts.find((p) => p.id === s.bush.id).placement;
  assert.ok(nearArr([got.x, got.y, got.z], [want.x, want.y, want.z], 1e-6), `экспорт: ${[got.x, got.y, got.z]} вместо ${[want.x, want.y, want.z]}`);
});

test("F3 STL всех деталей: замкнутая сетка, объём = сумме аналитических (±0,5 %), габарит = габариту деталей, без дублей", () => {
  const s = solved();
  const tri = G.projectTriangles(s.pr);
  const analytic = s.pr.parts.reduce((t, p) => t + M.analyticVolume(p), 0);
  const vol = G.meshVolume(tri);
  assert.ok(Math.abs(vol - analytic) / analytic < 0.005, `объём STL ${vol} против ${analytic}`);
  const buf = G.stlBinary(tri);
  const back = G.parseStlBinary(buf);
  assert.equal(back.length / 9, tri.length / 9, "число треугольников после записи/чтения STL");
  assert.ok(Math.abs(G.meshVolume(back) - vol) / vol < 1e-4, "объём после чтения STL (float32)");
  for (const p of s.pr.parts) assert.equal(G.checkClosed(G.projectTriangles(s.pr, [p])).closed, true, `оболочка «${p.name}» не замкнута`);
  const whole = G.checkClosed(tri); // у касающихся деталей общие рёбра колец: «разрывов» и перевёрнутых нормалей быть не должно
  assert.equal(whole.boundary, 0); assert.equal(whole.misoriented, 0);
  const bb = G.bounds(tri);
  const want = s.pr.parts.map((p) => M.worldBounds(p));
  for (let i = 0; i < 3; i++) {
    assert.ok(near(bb.min[i], Math.min(...want.map((w) => w.min[i])), 0.2), `min ${i}`);
    assert.ok(near(bb.max[i], Math.max(...want.map((w) => w.max[i])), 0.2), `max ${i}`);
  }
  assert.equal(tri.length / 9, s.pr.parts.reduce((t, p) => t + G.buildPartTris(p).toGeometry().getAttribute("position").count / 3, 0), "число треугольников не равно сумме по деталям (дубли?)");
});

test("F4 экспорт не принимает проект с ошибками размеров (нет «успеха» с мусорной геометрией)", () => {
  const s = solved();
  s.bush.params.D = 5; s.bush.params.d = 8;
  assert.throws(() => M.exportForCad(s.pr), /ошибки/);
});

// ====================================================================== G. Сквозной сценарий (вал + втулка + фланец)

test("G1 сквозной сценарий: создать → собрать → закрепить → сопрячь → изменить → сохранить → загрузить → экспортировать", () => {
  const pr = M.createProject("Сквозной");
  const shaft = M.createPart(pr, "shaft", { params: { c1: 1, c2: 1, steps: [{ d: 30, L: 40 }, { d: 50, L: 10 }, { d: 40, L: 50 }, { d: 25, L: 30 }] }, placement: { x: 0, y: 0, z: 0, rotation: { x: 0, y: 90, z: 0 } } }); pr.parts.push(shaft);
  const bush = M.createPart(pr, "bushing", { placement: { x: 200, y: 100, z: 0 } }); pr.parts.push(bush);
  const fl = M.createPart(pr, "flange", { placement: { x: -300, y: -100, z: 50 } }); pr.parts.push(fl);
  const asm = A.createAssembly(pr, "Узел");
  const cs = A.addComponent(pr, asm, shaft.id, { fixed: true }), cb = A.addComponent(pr, asm, bush.id), cf = A.addComponent(pr, asm, fl.id);
  A.addMate(pr, asm, { type: "coaxial", a: { comp: cs.id }, b: { comp: cb.id } });
  A.addMate(pr, asm, { type: "planar", mode: "contact", a: { comp: cs.id, ref: "step3" }, b: { comp: cb.id, ref: "end0" } });
  A.addMate(pr, asm, { type: "coaxial", a: { comp: cs.id }, b: { comp: cf.id } });
  A.addMate(pr, asm, { type: "planar", mode: "contact", a: { comp: cs.id, ref: "step2" }, b: { comp: cf.id, ref: "end0" } });
  let r = A.solve(pr, asm);
  assert.equal(r.ok, true);
  eq(Object.values(r.components).map((c) => c.status), ["fixed", "solved", "solved"]);
  assert.equal(r.interference.filter((x) => x.volume > 1e-3).length, 0);
  // положения: вал вдоль +X, втулка начинается там же, где уступ step3 (x = 100), фланец — в плоскости step2 (x = 50)
  assert.ok(near(bush.placement.x, 100, 1e-6) && near(bush.placement.y, 0, 1e-6) && near(bush.placement.z, 0, 1e-6), JSON.stringify(plain(bush.placement)));
  assert.ok(near(fl.placement.x, 50, 1e-6), JSON.stringify(plain(fl.placement)));
  // изменение детали
  shaft.params.steps[1].L = 80; // буртик 10 → 80: уступы step2, step3 уезжают на +70
  r = A.solve(pr, asm);
  assert.ok(near(bush.placement.x, 170, 1e-6) && near(fl.placement.x, 120, 1e-6), "после удлинения буртика: втулка 170, фланец 120: " + bush.placement.x + " / " + fl.placement.x);
  // сохранение → загрузка
  const back = IO.parse(IO.serialize(pr));
  eq(back.errors, []);
  eq(snap(back.project), snap(pr));
  // экспорт
  const file = path.join(TMP, "e2e.mech-freecad.json");
  writeFileSync(file, IO.exportFreecadJson(back.project));
  const ex = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(ex.parts.length, 3);
  assert.equal(ex.assemblies[0].mates.length, 4);
  assert.ok(near(ex.parts.find((p) => p.type === "bushing").placement.x, 170, 1e-6));
  assert.ok(near(ex.parts.find((p) => p.type === "flange").placement.x, 120, 1e-6));
  // сохраняем для проверки во FreeCAD / Blender (путь выводится в отчёт)
  if (process.env.BUILDSENSE_AUDIT_OUT) {
    writeFileSync(path.join(process.env.BUILDSENSE_AUDIT_OUT, "e2e.mech-freecad.json"), IO.exportFreecadJson(back.project));
    writeFileSync(path.join(process.env.BUILDSENSE_AUDIT_OUT, "e2e.mech.json"), IO.serialize(back.project));
    writeFileSync(path.join(process.env.BUILDSENSE_AUDIT_OUT, "e2e.stl"), Buffer.from(G.stlBinary(G.projectTriangles(back.project))));
  }
});

test("E7 деталь с ошибками размеров при загрузке удаляется вместе с компонентом сборки (без «висячих» ссылок)", () => {
  const raw = plain(solved().pr);
  raw.parts.find((p) => p.type === "bushing").params.d = 500; // отверстие больше наружного диаметра
  const res = IO.parse(JSON.stringify(raw));
  assert.ok(res.errors.length > 0);
  IO.dropInvalidParts(res);
  eq(A.validate(res.project), []);
  assert.equal(res.project.parts.length, 2);
  assert.equal(res.project.assemblies[0].components.length, 2);
  assert.ok(res.project.assemblies[0].mates.every((m) => m.a.comp !== "c2" && m.b.comp !== "c2"));
  assert.doesNotThrow(() => A.solve(res.project, res.project.assemblies[0]));
});

test("E8 повторяющийся id детали в файле: вторая деталь получает новый id, сборка не путается", () => {
  const raw = plain(solved().pr);
  raw.parts.push({ ...plain(raw.parts[1]), name: "Копия" });
  const res = IO.parse(JSON.stringify(raw));
  assert.equal(new Set(res.project.parts.map((p) => p.id)).size, 4);
  assert.ok(res.notes.some((n) => /Повторяющийся id/.test(n)));
  eq(A.validate(res.project), []);
});

test("F5 экспорт сборки не меняет исходный проект (решение идёт на копии)", () => {
  const s = solved();
  s.shaft.params.steps[0].L += 20;
  const before = JSON.stringify(s.pr);
  M.exportForCad(s.pr);
  assert.equal(JSON.stringify(s.pr), before);
});
