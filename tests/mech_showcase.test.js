// Машиностроение: взрывной вид, кинематика механизмов, симуляция, демонстрационные проекты, новые типы деталей.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadMech, ROOT } from "./mech_build.mjs";

const BS = loadMech();
const M = BS.mechModel, A = BS.mechAssembly, K = BS.mechKinematics, E = BS.mechExplode, D = BS.mechDemos, IO = BS.mechIO, G = BS.mechGeometry;
const plain = (v) => JSON.parse(JSON.stringify(v));
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const byName = (pr, name) => pr.parts.find((p) => p.name === name);

test("новые типы деталей: валидация, объём по формуле = объём сетки, замкнутая сетка, точный габарит", () => {
  const pr = M.createProject();
  for (const t of ["link", "block", "piston", "screw"]) {
    const p = M.createPart(pr, t, { placement: { x: 3, y: -5, z: 7, rotation: { x: 33, y: 12, z: 50 } } });
    assert.deepEqual(plain(M.validateParams(t, p.params)), [], t);
    const r = G.partReport(p);
    assert.ok(Math.abs(r.meshDeviation) < 0.005, `${t}: сетка ${r.meshDeviation}`);
    assert.ok(G.checkClosed(G.projectTriangles({ parts: [p] })).closed, `${t}: замкнутая сетка`);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(r.bounds.min[i] - r.meshBounds.min[i]) < 0.02 && Math.abs(r.bounds.max[i] - r.meshBounds.max[i]) < 0.02, `${t}: габарит`);
  }
  const f = (t, params) => plain(M.validateParams(t, { ...M.defaultParams(t), ...params }).map((e) => e.field));
  assert.ok(f("link", { C: 5 }).includes("C")); // одна проушина внутри другой
  assert.deepEqual(f("link", { d1: 31.5 }), ["d1"]);
  assert.deepEqual(f("block", { hb: 200 }), ["hb"]);
  assert.deepEqual(f("block", { d: 85 }), ["d"]);
  assert.deepEqual(f("piston", { pinZ: 45 }), ["pinZ"]);
  assert.deepEqual(f("screw", { P: 30 }), ["P"]);
  assert.deepEqual(f("screw", { D: 20 }), ["D"]);
  // площадь двух проушин: равные радиусы — стадион π r² + 2 r C
  assert.ok(near(M.stadiumArea(10, 10, 50), Math.PI * 100 + 2 * 10 * 50, 1e-9));
});

test("демо-проекты: собираются без ошибок сборки, сохраняются и открываются без потерь", () => {
  for (const d of D.DEMOS) {
    const pr = d.create();
    assert.deepEqual(plain(M.validateProject(pr)), [], d.id);
    const r = [...A.solveAll(pr).values()][0];
    assert.equal(r.ok, true, `${d.id}: ${r.messages.map((m) => m.text).join("; ")}`);
    assert.ok(Object.values(r.components).every((c) => ["fixed", "solved", "driven"].includes(c.status)), d.id);
    assert.ok(r.interference.every((i) => !i.checked || i.volume === 0), `${d.id}: пересечения`);
    for (const m of pr.mechanisms || []) assert.equal(K.check(pr, m).ok, true, `${d.id}: механизм`);
    const back = IO.parse(IO.serialize(pr));
    assert.deepEqual(plain(back.errors), []);
    assert.deepEqual(plain(back.project), plain(pr), `${d.id}: сериализация`);
    assert.equal(back.project.demo, d.id);
  }
});

test("двигатель: кинематика согласована — длина шатуна постоянна, поршень на оси цилиндра, ход = 2r", () => {
  const pr = D.create("engine");
  const m = K.list(pr)[0];
  const c = K.check(pr, m);
  assert.equal(c.ok, true);
  assert.ok(near(c.stroke, 60, 1e-6));
  const rod = byName(pr, "Шатун"), pis = byName(pr, "Поршень"), cyl = byName(pr, "Цилиндр");
  const xs = [];
  for (let i = 0; i <= 72; i++) {
    const q = (i / 72) * 2 * Math.PI;
    const s = K.poseAt(pr, m, q, c);
    assert.ok(near(s.state.rodLength, 100, 1e-9), "длина шатуна");
    const pp = s.poses.get(pis.id);
    // ось поршня совпадает с осью цилиндра (x = y = 0), поршень только поступательно
    assert.ok(near(pp.t[0], cyl.placement.x, 1e-9) && near(pp.t[1], cyl.placement.y, 1e-9));
    assert.ok(near(pp.R[2][2], 1, 1e-12));
    // нижняя головка шатуна — на шатунной шейке: центр шейки вращается с коленвалом
    const rp = s.poses.get(rod.id);
    const eye1 = [rp.t[0] + rp.R[0][2] * 9, rp.t[1] + rp.R[1][2] * 9, rp.t[2] + rp.R[2][2] * 9];
    const pinC = [0, -30 * Math.sin(q) * -1 * 0, 0]; // плоскость шатуна y = 0
    assert.ok(near(eye1[1], 0, 1e-9), "шатун в своей плоскости");
    assert.ok(near(Math.hypot(eye1[0], eye1[2] - 60), 30, 1e-9), "нижняя головка на радиусе кривошипа");
    void pinC;
    xs.push(pp.t[2]);
  }
  assert.ok(near(Math.max(...xs) - Math.min(...xs), 60, 1e-6), "ход поршня 60 мм");
  // формула x(θ) при e = 0: x = r cos θ + √(l² − r² sin² θ)
  assert.ok(near(K.pistonX(30, 100, 0, Math.PI / 2), Math.sqrt(100 * 100 - 900), 1e-12));
});

test("двигатель: невозможная кинематическая цепь — понятная ошибка, а не анимация", () => {
  const pr = D.create("engine");
  byName(pr, "Шатун").params.C = 25; // шатун короче кривошипа
  const c = K.check(pr, K.list(pr)[0]);
  assert.equal(c.ok, false);
  assert.match(c.errors.join(" "), /шатун слишком короткий/);
  assert.equal(K.poseAt(pr, K.list(pr)[0], 1).ok, false);
  const pr2 = D.create("engine");
  byName(pr2, "Шатун").params.C = 110; // длиннее: поршень упрётся в головку
  assert.match(K.check(pr2, K.list(pr2)[0]).errors.join(" "), /заходит в головку/);
});

test("двигатель: изменение размеров — исходное положение поршня пересчитывается сборкой", () => {
  const pr = D.create("engine");
  byName(pr, "Головка цилиндра").params.T = 14;
  byName(pr, "Шатун").params.C = 95;
  A.solveAll(pr);
  const pis = byName(pr, "Поршень");
  assert.ok(near(pis.placement.z, 60 + 30 + 95 - 20, 1e-6), `${pis.placement.z}`);
  assert.equal(K.check(pr, K.list(pr)[0]).ok, true);
});

test("домкрат: подъём s = P·φ/2π, рукоятка вращается вместе с винтом, площадка не вращается", () => {
  const pr = D.create("screw-jack");
  const m = K.list(pr)[0];
  const screw = byName(pr, "Винт"), pad = byName(pr, "Опорная площадка"), knob = byName(pr, "Ручка рукоятки");
  for (const turns of [0.25, 1, 3.5, 11.9]) {
    const s = K.poseAt(pr, m, turns * 2 * Math.PI);
    assert.ok(near(s.state.lift, 5 * turns, 1e-9));
    assert.ok(near(s.poses.get(screw.id).t[2] - screw.placement.z, 5 * turns, 1e-9));
    assert.ok(near(s.poses.get(pad.id).t[2] - pad.placement.z, 5 * turns, 1e-9));
    assert.deepEqual(plain(s.poses.get(pad.id).R), plain(M.rotationMatrix(pad.placement.rotation)), "площадка не вращается");
    const k = s.poses.get(knob.id).t;
    assert.ok(near(Math.hypot(k[0], k[1]), 140, 1e-9), "ручка на радиусе рукоятки");
  }
  // после хода 60 мм рукоятку крутят обратно: 13 оборотов → 55 мм
  assert.ok(near(K.poseAt(pr, m, 13 * 2 * Math.PI).state.lift, 55, 1e-9));
  // шаг 2,5 мм — тот же ход за вдвое большее число оборотов
  screw.params.P = 2.5;
  A.solveAll(pr);
  assert.ok(near(K.poseAt(pr, m, 2 * 2 * Math.PI).state.lift, 5, 1e-9));
  m.stroke = 200; // винт вышел бы из гайки
  assert.match(K.check(pr, m).errors.join(" "), /меньше половины высоты гайки/);
});

test("симуляция: пуск, пауза, продолжение, смена скорости без скачка, сброс", () => {
  const sim = K.createSimulation({ rpm: 60 }); // 1 об/с
  assert.equal(sim.state, "stopped");
  sim.start(0);
  assert.ok(near(sim.tick(500), Math.PI, 1e-12));
  sim.pause(500);
  assert.ok(near(sim.tick(5000), Math.PI, 1e-12), "на паузе фаза не растёт");
  sim.resume(5000);
  assert.ok(near(sim.tick(5250), 1.5 * Math.PI, 1e-12));
  sim.setSpeed(120, 5250);
  assert.ok(near(sim.phase, 1.5 * Math.PI, 1e-12), "смена скорости не меняет фазу");
  assert.ok(near(sim.tick(5500), 2.5 * Math.PI, 1e-12), "новая скорость — с момента смены");
  sim.stop();
  assert.equal(sim.state, "stopped");
  assert.equal(sim.phase, 0);
  sim.start(10000);
  assert.equal(sim.tick(10000), 0, "после сброса — с нуля");
});

test("взрывной вид: смещения от исходных положений, без накопления; детали не перекрываются вдоль оси", () => {
  for (const d of D.DEMOS) {
    const pr = d.create();
    const before = plain(pr);
    const e1 = E.computeExplode(pr);
    const e2 = E.computeExplode(pr);
    assert.deepEqual(plain([...e1.offsets]), plain([...e2.offsets]), `${d.id}: повторный расчёт даёт то же`);
    assert.deepEqual(plain(pr), before, `${d.id}: проект не меняется`);
    for (const [, v] of E.offsetsAt(e1, 0)) assert.deepEqual(plain(v).map((x) => x + 0), [0, 0, 0]);
    // хотя бы большинство деталей сдвинуто, и разнесённые соосные детали не перекрываются вдоль оси
    const moved = [...e1.offsets.values()].filter((v) => Math.hypot(...v) > 1).length;
    assert.ok(moved >= pr.parts.length - 2, `${d.id}: сдвинуто ${moved} из ${pr.parts.length}`);
    for (const g of e1.groups.filter((x) => x.parts.length > 1)) {
      const u = g.axis;
      const ext = g.parts.map((id) => {
        const p = pr.parts.find((x) => x.id === id), b = M.worldBounds(p), o = e1.offsets.get(id);
        const s = [0, 1, 2].map((i) => [b.min[i] + o[i], b.max[i] + o[i]]);
        const vals = [];
        for (const a of s[0]) for (const bb of s[1]) for (const c of s[2]) vals.push(a * u[0] + bb * u[1] + c * u[2]);
        return [Math.min(...vals), Math.max(...vals)];
      }).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < ext.length; i++) assert.ok(ext[i][0] >= ext[i - 1][1] - 1e-6, `${d.id}: соосные детали разнесены без перекрытия`);
    }
  }
});

test("анимация разборки: easing, пауза, повторный запуск не накапливает", () => {
  const tw = E.createTween({ duration: 1000 });
  tw.to(1, 0);
  assert.equal(tw.value(0), 0);
  assert.ok(near(tw.value(500), 0.5, 1e-12));
  assert.equal(tw.value(1000), 1);
  assert.ok(tw.value(250) < 0.25, "плавный разгон");
  tw.to(1, 2000); // повторное «разобрать» — цель та же, значение не растёт
  assert.equal(tw.value(3000), 1);
  tw.to(0, 3000);
  tw.pause(3500);
  const v = tw.value(3500);
  assert.equal(tw.value(9000), v, "на паузе значение стоит");
  tw.resume(9000);
  assert.equal(tw.value(9500), 0);
  assert.equal(E.easeInOutCubic(0), 0);
  assert.equal(E.easeInOutCubic(1), 1);
});

test("экспорт: без кадров симуляции и смещений разборки; механизм — справкой; старые проекты открываются", () => {
  const pr = D.create("engine");
  const before = IO.exportFreecadJson(pr);
  // «посмотрели» анимацию и разборку — это только расчёт, проект тот же
  for (let i = 0; i < 10; i++) K.poseAt(pr, K.list(pr)[0], i);
  E.offsetsAt(E.computeExplode(pr), 1);
  assert.equal(IO.exportFreecadJson(pr), before);
  const ex = JSON.parse(before);
  assert.equal(ex.schemaVersion, 2);
  assert.equal(ex.mechanisms[0].ok, true);
  assert.equal(ex.parts.find((p) => p.name === "Шатун").solid.extrude.outline.kind, "stadium");
  const v1 = plain(M.createDemoProject());
  v1.schemaVersion = 1;
  delete v1.assemblies;
  assert.deepEqual(plain(IO.parse(JSON.stringify(v1)).errors), []);
});

test("файлы демонстрационных проектов синхронны с кодом (node tests/mech_build.mjs)", () => {
  const read = (f) => JSON.parse(readFileSync(path.join(ROOT, f), "utf-8"));
  for (const d of D.DEMOS) {
    assert.deepEqual(read(`examples/mech/showcase-${d.id}.mech.json`), plain(d.create()), d.id);
    assert.deepEqual(read(`examples/mech/showcase-${d.id}.mech-freecad.json`), plain(M.exportForCad(d.create())), d.id);
  }
});
