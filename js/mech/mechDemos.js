// BuildSense · Машиностроение — демонстрационные проекты (без DOM, тестируется в Node).
// Каждый проект собирается из обычных параметрических деталей, сборки с сопряжениями и (для двигателя и домкрата)
// механизма js/mech/mechKinematics.js. После открытия это обычный проект: детали редактируются, сборка пересчитывается.
// Это учебные модели, а не сертифицированные конструкции и не производственные чертежи.
//
// BS.mechDemos.DEMOS = [{ id, title, desc, features, create() }]; BS.mechDemos.create(id).
(function (BS) {
  "use strict";
  const M = BS.mechModel;
  const A = BS.mechAssembly;

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  /** Положение по началу координат детали и направлениям её локальных осей X и Z в мире. */
  function place(o, x, z) {
    const y = cross(z, x);
    const R = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
    return { x: o[0], y: o[1], z: o[2], rotation: A.eulerXYZ(R) };
  }
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1], nY = [0, -1, 0];

  function part(pr, type, name, params, placement, material = "steel") {
    const p = M.createPart(pr, type, { name, params: { ...M.defaultParams(type), ...params }, placement, material });
    pr.parts.push(p);
    return p;
  }

  /** Сборка: компоненты по деталям, затем сопряжения (каждое проверяется решателем при добавлении). */
  function assemble(pr, name, parts, fixed, mates) {
    const asm = A.createAssembly(pr, name);
    const comp = new Map();
    for (const p of parts) comp.set(p, A.addComponent(pr, asm, p.id, { fixed: fixed.includes(p) }).id);
    for (const [type, a, aref, b, bref, extra] of mates) {
      A.addMate(pr, asm, { type, a: { comp: comp.get(a), ref: aref }, b: { comp: comp.get(b), ref: bref }, mode: "contact", ...(extra || {}) });
    }
    return asm;
  }

  // ------------------------------------------------------------------ A. вал на подшипниковых опорах

  function shaftSupports() {
    const pr = M.createProject("Демо A: вал на подшипниковых опорах");
    pr.demo = "shaft-supports";
    const base = part(pr, "block", "Основание (плита)", { W: 320, H: 90, hb: 45, T: 12, d: 0 }, place([140, 0, 0], X, Z), "cast_iron");
    const blk = (n, x) => part(pr, "block", `Корпус опоры ${n}`, { W: 80, H: 72, hb: 48, T: 30, d: 32 }, place([x, 0, 60], Y, X), "cast_iron");
    const b1 = blk(1, 60), b2 = blk(2, 210);
    const bush = (n, x) => part(pr, "bushing", `Вкладыш подшипника ${n}`, { D: 32, d: 25, L: 30, c: 0.5, ci: 0.5 }, place([x, 0, 60], Y, X), "bronze");
    const w1 = bush(1, 60), w2 = bush(2, 210);
    const shaft = part(pr, "shaft", "Вал", { c1: 1, c2: 1, steps: [{ d: 20, L: 40 }, { d: 25, L: 240 }] }, place([0, 0, 60], Y, X));
    const ring = (n, x) => part(pr, "bushing", `Установочное кольцо ${n}`, { D: 40, d: 25, L: 12, c: 1, ci: 0 }, place([x, 0, 60], Y, X));
    const r1 = ring(1, 48), r2 = ring(2, 240);
    const cpl = part(pr, "flange", "Полумуфта", { D: 90, T: 12, d: 20, hubD: 40, hubH: 16, n: 4, pcd: 66, holeD: 9 }, place([12, 0, 60], Y, X));
    assemble(pr, "Узел вала на двух опорах", [base, b1, b2, w1, w2, shaft, r1, r2, cpl], [base, b1, b2], [
      ["coaxial", b1, "axis", b2, "axis"], // обе опоры закреплены: соосность — проверка, а не решение
      ["coaxial", b1, "axis", w1, "axis"], ["planar", b1, "end0", w1, "end0", { mode: "align" }],
      ["coaxial", b2, "axis", w2, "axis"], ["planar", b2, "end0", w2, "end0", { mode: "align" }],
      ["coaxial", w1, "axis", shaft, "axis"], ["distance", b1, "end0", shaft, "end0", { mode: "align", offset: 60 }],
      ["coaxial", shaft, "axis", r1, "axis"], ["planar", b1, "end0", r1, "end1"],
      ["coaxial", shaft, "axis", r2, "axis"], ["planar", b2, "end1", r2, "end0"],
      ["coaxial", shaft, "axis", cpl, "axis"], ["planar", shaft, "step1", cpl, "end1"],
    ]);
    A.solveAll(pr);
    return pr;
  }

  // ------------------------------------------------------------------ B. одноцилиндровый двигатель

  function engine() {
    const pr = M.createProject("Демо B: одноцилиндровый двигатель");
    pr.demo = "engine";
    // ось коленвала — вдоль −Y на высоте 60; ось цилиндра — +Z; радиус кривошипа 30, шатун 100
    const jl = part(pr, "shaft", "Коренная шейка (передняя)", { c1: 1, c2: 0, steps: [{ d: 20, L: 20 }, { d: 24, L: 44 }] }, place([0, 86, 60], X, nY));
    const w1 = part(pr, "link", "Щека кривошипа 1", { C: 30, D1: 50, d1: 0, D2: 34, d2: 0, T: 10 }, place([0, 22, 60], Z, nY));
    const pin = part(pr, "shaft", "Шатунная шейка", { c1: 0, c2: 0, steps: [{ d: 16, L: 24 }] }, place([0, 12, 90], X, nY));
    const w2 = part(pr, "link", "Щека кривошипа 2", { C: 30, D1: 50, d1: 0, D2: 34, d2: 0, T: 10 }, place([0, -12, 60], Z, nY));
    const jr = part(pr, "shaft", "Коренная шейка (задняя)", { c1: 0, c2: 1, steps: [{ d: 24, L: 44 }, { d: 20, L: 30 }] }, place([0, -22, 60], X, nY));
    const fly = part(pr, "flange", "Маховик", { D: 120, T: 12, d: 20, hubD: 36, hubH: 10, n: 6, pcd: 90, holeD: 12 }, place([0, -66, 60], X, nY), "cast_iron");
    const wall = (n, y) => part(pr, "block", `Стенка картера ${n}`, { W: 100, H: 152, hb: 60, T: 10, d: 24 }, place([0, y, 60], X, nY), "aluminum");
    const wl = wall("передняя", 34), wr = wall("задняя", -24);
    const cyl = part(pr, "bushing", "Цилиндр", { D: 66, d: 50, L: 70, c: 1, ci: 0 }, place([0, 0, 152], X, Z), "cast_iron");
    const head = part(pr, "flange", "Головка цилиндра", { D: 80, T: 12, d: 10, hubD: 0, hubH: 0, n: 4, pcd: 58, holeD: 6.6 }, place([0, 0, 222], X, Z), "aluminum");
    const pis = part(pr, "piston", "Поршень", { D: 50, H: 50, t: 8, w: 5, pinZ: 20 }, place([0, 0, 170], X, Z), "aluminum");
    const ppin = part(pr, "shaft", "Поршневой палец", { c1: 0.5, c2: 0.5, steps: [{ d: 10, L: 38 }] }, place([0, 19, 190], X, nY));
    const rod = part(pr, "link", "Шатун", { C: 100, D1: 32, d1: 16, D2: 20, d2: 10, T: 18 }, place([0, 9, 90], Z, nY));
    assemble(pr, "Двигатель", [jl, w1, pin, w2, jr, fly, wl, wr, cyl, head, pis, ppin, rod], [jl, cyl], [
      ["coaxial", jl, "axis", w1, "axis"], ["planar", jl, "end1", w1, "end0"],
      ["coaxial", w1, "axis2", pin, "axis"], ["planar", w1, "end1", pin, "end0"],
      ["coaxial", pin, "axis", w2, "axis2"], ["planar", pin, "end1", w2, "end0"],
      ["coaxial", w2, "axis", jr, "axis"], ["planar", w2, "end1", jr, "end0"],
      ["coaxial", jr, "axis", fly, "axis"], ["planar", jr, "step1", fly, "end0"],
      ["coaxial", jl, "axis", wl, "axis"], ["distance", w1, "end0", wl, "end1", { offset: 2 }],
      ["coaxial", jr, "axis", wr, "axis"], ["distance", w2, "end1", wr, "end0", { offset: 2 }],
      ["coaxial", cyl, "axis", head, "axis"], ["planar", cyl, "end1", head, "end0"],
    ]);
    pr.mechanisms = [{
      id: "K1", type: "slider-crank", name: "Кривошипно-шатунный механизм",
      crank: jl.id, web: w1.id, pin: pin.id, rod: rod.id, piston: pis.id, pistonPin: ppin.id, cylinder: cyl.id, head: head.id,
      rotating: [w2.id, jr.id, fly.id],
    }];
    A.solveAll(pr);
    return pr;
  }

  // ------------------------------------------------------------------ C. винтовой домкрат

  function screwJack() {
    const pr = M.createProject("Демо C: винтовой домкрат");
    pr.demo = "screw-jack";
    const base = part(pr, "flange", "Основание", { D: 160, T: 15, d: 24, hubD: 70, hubH: 60, n: 4, pcd: 130, holeD: 12 }, place([0, 0, 0], X, Z), "cast_iron");
    const nut = part(pr, "bushing", "Гайка", { D: 50, d: 24, L: 40, c: 1, ci: 0.5 }, place([0, 0, 75], X, Z), "bronze");
    const screw = part(pr, "screw", "Винт", { d: 24, P: 5, Lt: 130, D: 40, Lh: 16, dn: 16, Ln: 22 }, place([0, 0, 15], X, Z));
    const lever = part(pr, "link", "Рукоятка (рычаг)", { C: 140, D1: 36, d1: 16, D2: 24, d2: 10, T: 10 }, place([0, 0, 161], X, Z));
    const knob = part(pr, "shaft", "Ручка рукоятки", { c1: 0, c2: 1, steps: [{ d: 10, L: 10 }, { d: 18, L: 35 }] }, place([140, 0, 161], X, Z), "polyamide");
    const pad = part(pr, "flange", "Опорная площадка", { D: 80, T: 12, d: 16, hubD: 0, hubH: 0, n: 0, pcd: 0, holeD: 5 }, place([0, 0, 171], X, Z));
    assemble(pr, "Домкрат", [base, nut, screw, lever, knob, pad], [base], [
      ["coaxial", base, "axis", nut, "axis"], ["planar", base, "end1", nut, "end0"],
      ["coaxial", nut, "axis", screw, "axis"], ["distance", nut, "end1", screw, "head0", { offset: 30 }],
      ["coaxial", screw, "axis", lever, "axis"], ["planar", screw, "head1", lever, "end0"],
      ["coaxial", lever, "axis2", knob, "axis"], ["planar", lever, "end1", knob, "step1"],
      ["coaxial", screw, "axis", pad, "axis"], ["planar", lever, "end1", pad, "end0"],
    ]);
    pr.mechanisms = [{ id: "K1", type: "screw", name: "Винтовая пара", screw: screw.id, nut: nut.id, rotating: [lever.id, knob.id], lifting: [pad.id], stroke: 60 }];
    A.solveAll(pr);
    return pr;
  }

  const DEMOS = [
    {
      id: "shaft-supports", title: "Вал на подшипниковых опорах", create: shaftSupports,
      desc: "Вал в двух корпусах опор с бронзовыми вкладышами, установочные кольца держат вал вдоль оси, на конце — полумуфта.",
      features: ["Сборка: 13 сопряжений", "Взрывной вид вдоль оси вала", "Разрез: вкладыш внутри корпуса", "Проверка соосности двух закреплённых опор"],
    },
    {
      id: "engine", title: "Одноцилиндровый двигатель", create: engine,
      desc: "Коленвал из шеек и щёк, шатун, поршень с пальцем, цилиндр с головкой, маховик и стенки картера.",
      features: ["Кинематика кривошипно-шатунного механизма", "Ход поршня 60 мм, шатун 100 мм", "Разрез: поршень в цилиндре", "Взрывной вид"],
    },
    {
      id: "screw-jack", title: "Винтовой домкрат", create: screwJack,
      desc: "Винт в бронзовой гайке поднимает опорную площадку; винт вращают рукояткой.",
      features: ["Винтовая пара: подъём s = P·φ/2π", "Ход 60 мм при шаге 5 мм (12 оборотов)", "Взрывной вид", "Меняйте шаг винта и смотрите на скорость подъёма"],
    },
  ];

  function create(id) {
    const d = DEMOS.find((x) => x.id === id);
    if (!d) throw new Error(`Нет демонстрационного проекта «${id}»`);
    return d.create();
  }

  BS.mechDemos = { DEMOS, create, place };
})(globalThis.BuildSense);
