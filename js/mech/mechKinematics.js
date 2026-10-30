// BuildSense · Машиностроение — кинематика механизмов (без DOM и Three.js, тестируется в Node).
//
// project.mechanisms = [{ id, type, name, ... }] — ссылки на детали проекта (partId):
//   "slider-crank" — кривошипно-шатунный механизм: crank (коренная шейка — её локальная ось Z = ось вращения),
//     web (щека: тип «link», межосевое C = радиус кривошипа r), pin (шатунная шейка), rotating (детали, вращающиеся
//     с коленвалом), rod (шатун: тип «link», C = длина l), piston, pistonPin (необязательно), cylinder (ось — линия
//     движения поршня), head (необязательно — для проверки зазора в ВМТ).
//   "screw" — винтовая пара: screw (тип «screw», ход за оборот = шаг P), nut, rotating (винт и то, что вращается с
//     ним), lifting (поднимается без вращения), stroke (наибольший подъём, мм).
//
// Это детерминированная КИНЕМАТИКА, а не физика: силы, массы, трение, инерция не считаются. Положения выводятся
// из геометрии точными формулами:
//   кривошип: B(θ) = O + r(cos θ·e1 + sin θ·e2);  поршень: x(θ) = r cos θ + √(l² − (e − r sin θ)²), C = O + e·e2 + x·e1,
//   где e1 — ось цилиндра, e2 = a × e1, a — ось коленвала, e — дезаксаж (смещение оси цилиндра от оси вала);
//   винт: подъём s = P·ψ/2π при повороте винта на ψ.
// Исходное положение механизма (угол 0° симуляции) — текущее положение кривошипа, заданное сопряжениями сборки;
// applyRest() записывает в проект согласованные с ним положения шатуна и поршня (как решатель сборок). Промежуточные
// положения при симуляции — только временные (poseAt), в проект и экспорт они не попадают.
(function (BS) {
  "use strict";
  const M = BS.mechModel;

  const TOL = 0.01; // мм
  const fmt = (v, d = 2) => String(Math.round(v * 10 ** d) / 10 ** d).replace(".", ",");
  const r6 = (v) => { const x = Math.round(v * 1e6) / 1e6; return Object.is(x, -0) ? 0 : x; };

  // ------------------------------------------------------------------ векторы
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => mul(a, 1 / (len(a) || 1));
  const matVec = (R, v) => [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
  const matMul = (A, B) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]));
  /** Матрица из столбцов (локальные оси X, Y, Z в мировых координатах). */
  const fromCols = (x, y, z) => [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
  const col = (R, j) => [R[0][j], R[1][j], R[2][j]];

  /** Поворот на угол ang вокруг единичной оси k (Родриг). */
  function rot(k, ang) {
    const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    const [x, y, z] = k;
    return [
      [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
      [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
      [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ];
  }

  const poseOf = (part) => ({ R: M.rotationMatrix(part.placement.rotation), t: [part.placement.x, part.placement.y, part.placement.z] });
  const axisZ = (pose) => col(pose.R, 2);
  const centerOf = (part) => { const b = M.worldBounds(part); return [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2); };
  /** Длина детали вдоль собственной оси Z (для пальцев и шеек). */
  function lengthOf(part) {
    const p = part.params;
    if (part.type === "shaft") return p.steps.reduce((s, x) => s + x.L, 0);
    if (part.type === "bushing") return p.L;
    const ev = M.evaluate(part);
    if (ev.extrude) return ev.extrude.height;
    return Math.max(...ev.profile.map((q) => q[1]));
  }
  /** Наибольший диаметр пальца/шейки (вал — первая ступень). */
  const pinDiameter = (part) => (part.type === "shaft" ? part.params.steps[0].d : part.type === "bushing" ? part.params.D : null);
  /** Пределы детали вдоль направления u от точки o (по плоским граням вдоль её оси). */
  function extentAlong(part, o, u) {
    const pose = poseOf(part);
    const fs = BS.mechAssembly ? BS.mechAssembly.faces(part) : [];
    const zs = fs.length ? fs.map((f) => f.z) : [0, lengthOf(part)];
    const vals = zs.map((z) => dot(sub(add(pose.t, mul(axisZ(pose), z)), o), u));
    return [Math.min(...vals), Math.max(...vals)];
  }
  const placementFrom = (R, t) => ({ x: r6(t[0]), y: r6(t[1]), z: r6(t[2]), rotation: BS.mechAssembly.eulerXYZ(R) });

  // ------------------------------------------------------------------ данные

  const TYPES = {
    "slider-crank": { label: "Кривошипно-шатунный механизм", roles: ["crank", "web", "pin", "rod", "piston", "cylinder"], optional: ["pistonPin", "head"] },
    screw: { label: "Винтовая пара", roles: ["screw", "nut"], optional: [] },
  };

  function list(project) {
    if (!Array.isArray(project.mechanisms)) project.mechanisms = [];
    return project.mechanisms;
  }

  /** Детали, положение которых задаёт механизм (решатель сборок их не двигает): Map partId → имя механизма. */
  function drivenParts(project) {
    const out = new Map();
    for (const m of Array.isArray(project.mechanisms) ? project.mechanisms : []) {
      if (m.type === "slider-crank") for (const id of [m.rod, m.piston, m.pistonPin]) if (id) out.set(id, m.name);
    }
    return out;
  }

  function normalize(raw, project) {
    const notes = [];
    const ids = new Set(project.parts.map((p) => p.id));
    const out = [];
    for (const m of Array.isArray(raw) ? raw : []) {
      if (!m || !TYPES[m.type]) { notes.push(`Механизм неизвестного типа «${m && m.type}» пропущен`); continue; }
      const t = TYPES[m.type];
      const missing = t.roles.filter((r) => !ids.has(m[r]));
      if (missing.length) { notes.push(`Механизм «${m.name}»: нет деталей (${missing.join(", ")}) — пропущен`); continue; }
      const x = { id: String(m.id), type: m.type, name: typeof m.name === "string" ? m.name : t.label };
      for (const r of [...t.roles, ...t.optional]) if (ids.has(m[r])) x[r] = m[r];
      for (const k of ["rotating", "lifting"]) if (Array.isArray(m[k])) x[k] = m[k].filter((id) => ids.has(id));
      if (m.type === "screw") x.stroke = Number.isFinite(m.stroke) ? m.stroke : 0;
      out.push(x);
    }
    return { mechanisms: out, notes };
  }

  /** Убрать деталь из механизмов (механизм без обязательной детали удаляется). */
  function removePart(project, partId) {
    project.mechanisms = list(project).filter((m) => !TYPES[m.type].roles.some((r) => m[r] === partId));
    for (const m of project.mechanisms) for (const k of ["rotating", "lifting"]) m[k] = (m[k] || []).filter((id) => id !== partId);
    for (const m of project.mechanisms) for (const r of TYPES[m.type].optional) if (m[r] === partId) delete m[r];
  }

  // ------------------------------------------------------------------ кривошипно-шатунный механизм

  /** Положение поршня вдоль оси цилиндра при угле θ: x(θ) = r cos θ + √(l² − (e − r sin θ)²). */
  function pistonX(r, l, e, th) {
    const q = l * l - (e - r * Math.sin(th)) ** 2;
    return q < 0 ? NaN : r * Math.cos(th) + Math.sqrt(q);
  }

  function checkSliderCrank(project, m) {
    const res = { ok: false, errors: [], warnings: [], notes: [], frame: null };
    const part = (id) => project.parts.find((p) => p.id === id) || null;
    const P = {};
    for (const r of [...TYPES["slider-crank"].roles, ...TYPES["slider-crank"].optional]) P[r] = m[r] ? part(m[r]) : null;
    for (const r of TYPES["slider-crank"].roles) if (!P[r]) res.errors.push(`нет детали «${r}»`);
    if (res.errors.length) return res;
    for (const p of Object.values(P)) if (p && M.validateParams(p.type, p.params).length) res.errors.push(`«${p.name}»: ошибки в размерах`);
    if (P.web.type !== "link") res.errors.push(`щека «${P.web.name}» должна быть типа «Рычаг / шатун» (её межосевое C — радиус кривошипа)`);
    if (P.rod.type !== "link") res.errors.push(`шатун «${P.rod.name}» должен быть типа «Рычаг / шатун» (его межосевое C — длина шатуна)`);
    if (res.errors.length) return res;

    const crank = poseOf(P.crank);
    const a = unit(axisZ(crank));
    const O0 = crank.t;
    const B0 = centerOf(P.pin);
    const aOff = dot(sub(B0, O0), a);
    const O = add(O0, mul(a, aOff)); // центр кривошипа в плоскости шатуна
    const rv = sub(B0, O);
    const r = P.web.params.C, rGeom = len(rv);
    if (len(cross(axisZ(poseOf(P.pin)), a)) > 1e-6) res.errors.push("шатунная шейка не параллельна оси коленвала");
    if (Math.abs(rGeom - r) > TOL) res.errors.push(`шатунная шейка стоит в ${fmt(rGeom)} мм от оси коленвала, а радиус кривошипа (C щеки) — ${fmt(r)} мм: проверьте сопряжения коленвала`);
    const cyl = poseOf(P.cylinder);
    let e1 = unit(axisZ(cyl));
    if (Math.abs(dot(e1, a)) > 1e-6) res.errors.push("ось цилиндра не перпендикулярна оси коленвала — поршень не может двигаться в плоскости шатуна");
    if (res.errors.length) return res;
    if (dot(sub(centerOf(P.cylinder), O), e1) < 0) e1 = mul(e1, -1); // e1 — от коленвала к цилиндру
    const e2 = unit(cross(a, e1));
    const w = sub(cyl.t, O);
    const g = dot(w, a);
    const e = dot(w, e2);
    if (Math.abs(g) > 0.5) res.errors.push(`ось цилиндра смещена на ${fmt(g)} мм вдоль коленвала от плоскости шатуна`);
    const l = P.rod.params.C;
    if (l <= r + Math.abs(e) + 1e-6) res.errors.push(`шатун слишком короткий: длина ${fmt(l)} мм, а нужно больше r + |e| = ${fmt(r + Math.abs(e))} мм — кривошип не сможет провернуться`);
    if (P.cylinder.type === "bushing" && P.piston.params.D > P.cylinder.params.d + 1e-9) res.errors.push(`поршень ⌀${fmt(P.piston.params.D)} шире отверстия цилиндра ⌀${fmt(P.cylinder.params.d)}`);
    if (res.errors.length) return res;

    // ход поршня: численно по углу (при e ≠ 0 мёртвые точки не на 0° и 180°)
    let xmin = Infinity, xmax = -Infinity;
    for (let i = 0; i < 720; i++) {
      const x = pistonX(r, l, e, (i / 720) * 2 * Math.PI);
      xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    }
    const th0 = Math.atan2(dot(rv, e2), dot(rv, e1));
    const pin = P.piston.params.pinZ, top = P.piston.params.H - pin;
    if (P.head) {
      const [hb] = extentAlong(P.head, O, e1);
      const gap = hb - (xmax + top);
      if (gap < -TOL) res.errors.push(`в верхней мёртвой точке поршень заходит в головку на ${fmt(-gap)} мм`);
      else res.notes.push(`зазор между поршнем и головкой в ВМТ — ${fmt(gap)} мм`);
    }
    const [cb] = extentAlong(P.cylinder, O, e1);
    if (xmin + top < cb - TOL) res.warnings.push(`в нижней мёртвой точке днище поршня выходит из цилиндра на ${fmt(cb - xmin - top)} мм`);
    const dRod1 = P.rod.params.d1, dPin = pinDiameter(P.pin);
    if (dRod1 > 0 && dPin && Math.abs(dRod1 - dPin) > TOL) res.warnings.push(`отверстие нижней головки шатуна ⌀${fmt(dRod1)} не равно шатунной шейке ⌀${fmt(dPin)}`);
    if (P.pistonPin) {
      const d2 = P.rod.params.d2, dp = pinDiameter(P.pistonPin);
      if (d2 > 0 && dp && Math.abs(d2 - dp) > TOL) res.warnings.push(`отверстие верхней головки шатуна ⌀${fmt(d2)} не равно пальцу ⌀${fmt(dp)}`);
    }
    if (res.errors.length) return res;
    res.ok = true;
    res.frame = { O, a, e1, e2, r, l, e, th0, aOff };
    res.stroke = xmax - xmin;
    res.notes.unshift(`радиус кривошипа r = ${fmt(r)} мм, шатун l = ${fmt(l)} мм, ход поршня ${fmt(res.stroke)} мм${Math.abs(e) > TOL ? `, дезаксаж ${fmt(e)} мм` : ""}`);
    return res;
  }

  /** Положения шатуна, поршня и пальца при угле кривошипа θ (абсолютном, в базисе e1/e2). */
  function crankChain(project, m, f, th) {
    const part = (id) => project.parts.find((p) => p.id === id);
    const { O, a, e1, e2, r, l, e } = f;
    const B = add(O, add(mul(e1, r * Math.cos(th)), mul(e2, r * Math.sin(th))));
    const x = pistonX(r, l, e, th);
    const C = add(O, add(mul(e2, e), mul(e1, x)));
    const out = new Map();
    const rod = part(m.rod);
    const zr = mul(a, Math.sign(dot(axisZ(poseOf(rod)), a)) || 1);
    const ux = unit(sub(C, B));
    const Rr = fromCols(ux, cross(zr, ux), zr);
    out.set(rod.id, { R: Rr, t: sub(B, mul(zr, rod.params.T / 2)) });
    const pis = part(m.piston);
    const Rp0 = poseOf(pis).R;
    let px = col(Rp0, 0);
    px = sub(px, mul(e1, dot(px, e1)));
    px = len(px) > 1e-6 ? unit(px) : e2;
    out.set(pis.id, { R: fromCols(px, cross(e1, px), e1), t: sub(C, mul(e1, pis.params.pinZ)) });
    if (m.pistonPin) {
      const pp = part(m.pistonPin);
      const zp = mul(a, Math.sign(dot(axisZ(poseOf(pp)), a)) || 1);
      let qx = col(poseOf(pp).R, 0);
      qx = sub(qx, mul(zp, dot(qx, zp)));
      qx = len(qx) > 1e-6 ? unit(qx) : e1;
      out.set(pp.id, { R: fromCols(qx, cross(zp, qx), zp), t: sub(C, mul(zp, lengthOf(pp) / 2)) });
    }
    return { poses: out, B, C, x, rodAngle: Math.atan2(dot(ux, e2), dot(ux, e1)) };
  }

  // ------------------------------------------------------------------ винтовая пара

  function checkScrew(project, m) {
    const res = { ok: false, errors: [], warnings: [], notes: [], frame: null };
    const part = (id) => project.parts.find((p) => p.id === id) || null;
    const sc = part(m.screw), nut = part(m.nut);
    if (!sc || !nut) { res.errors.push("нет винта или гайки"); return res; }
    if (sc.type !== "screw") { res.errors.push(`«${sc.name}» должен быть типа «Винт»: ход за оборот берётся из его шага P`); return res; }
    for (const p of [sc, nut]) if (M.validateParams(p.type, p.params).length) res.errors.push(`«${p.name}»: ошибки в размерах`);
    if (res.errors.length) return res;
    const ps = poseOf(sc), pn = poseOf(nut);
    const u = unit(axisZ(ps));
    const un = axisZ(pn);
    const off = sub(pn.t, ps.t);
    if (len(cross(u, un)) > 1e-6 || len(sub(off, mul(u, dot(off, u)))) > TOL) res.errors.push("винт и гайка не соосны — винтовая пара не работает");
    const lead = sc.params.P;
    if (!(m.stroke > 0)) res.errors.push("наибольший подъём должен быть больше 0 мм");
    if (res.errors.length) return res;
    const [n0, n1] = extentAlong(nut, ps.t, u);
    const engaged = (s) => Math.min(n1, s + sc.params.Lt) - Math.max(n0, s);
    if (engaged(0) <= TOL) res.errors.push("в исходном положении резьба винта не входит в гайку");
    else if (engaged(m.stroke) < (n1 - n0) / 2 - TOL) res.errors.push(`при подъёме на ${fmt(m.stroke)} мм в гайке остаётся ${fmt(Math.max(0, engaged(m.stroke)))} мм резьбы — меньше половины высоты гайки (${fmt((n1 - n0) / 2)} мм)`);
    if (res.errors.length) return res;
    res.ok = true;
    res.frame = { O: ps.t, u, lead };
    res.notes.push(`ход за оборот P = ${fmt(lead)} мм, подъём до ${fmt(m.stroke)} мм — это ${fmt(m.stroke / lead, 1)} оборота винта`);
    return res;
  }

  // ------------------------------------------------------------------ общий интерфейс

  function check(project, m) {
    if (m.type === "slider-crank") return checkSliderCrank(project, m);
    if (m.type === "screw") return checkScrew(project, m);
    return { ok: false, errors: [`неизвестный тип механизма «${m.type}»`], warnings: [], notes: [] };
  }

  /** Записать в проект исходные положения деталей, заданных механизмом (угол 0°). Возвращает Map id → check(). */
  function applyRest(project) {
    const out = new Map();
    for (const m of list(project)) {
      const c = check(project, m);
      out.set(m.id, c);
      if (!c.ok || m.type !== "slider-crank") continue;
      const chain = crankChain(project, m, c.frame, c.frame.th0);
      for (const [id, ps] of chain.poses) project.parts.find((p) => p.id === id).placement = placementFrom(ps.R, ps.t);
    }
    return out;
  }

  /**
   * Временные положения подвижных деталей при фазе q (рад): для кривошипа — угол поворота коленвала от исходного,
   * для винта — угол поворота рукоятки (подъём идёт до stroke и обратно). Проект не меняется.
   * Возвращает { ok, poses: Map partId → { R, t }, state: {…}, text } или { ok:false, errors }.
   */
  function poseAt(project, m, q, checked) {
    const c = checked || check(project, m);
    if (!c.ok) return { ok: false, errors: c.errors };
    const part = (id) => project.parts.find((p) => p.id === id);
    const poses = new Map();
    const turn = (ids, O, k, ang, shift) => {
      const Rq = rot(k, ang);
      for (const id of ids) {
        const p = part(id);
        if (!p) continue;
        const ps = poseOf(p);
        poses.set(id, { R: matMul(Rq, ps.R), t: add(add(O, matVec(Rq, sub(ps.t, O))), shift) });
      }
    };
    if (m.type === "slider-crank") {
      const f = c.frame;
      const rotating = [...new Set([m.crank, m.web, m.pin, ...(m.rotating || [])])];
      turn(rotating, f.O, f.a, q, [0, 0, 0]);
      const th = f.th0 + q;
      const chain = crankChain(project, m, f, th);
      for (const [id, ps] of chain.poses) poses.set(id, ps);
      const x0 = pistonX(f.r, f.l, f.e, f.th0);
      const deg = ((q * 180) / Math.PI) % 360;
      return {
        ok: true, poses,
        state: { angle: (deg + 360) % 360, pistonTravel: x0 - chain.x, rodAngle: (chain.rodAngle * 180) / Math.PI, rodLength: len(sub(chain.C, chain.B)) },
        text: `Коленвал ${fmt((deg + 360) % 360, 0)}° · поршень ${fmt(x0 - chain.x, 1)} мм от исходного положения · шатун отклонён на ${fmt((chain.rodAngle * 180) / Math.PI, 1)}°`,
      };
    }
    const f = c.frame;
    const turns = Math.abs(q) / (2 * Math.PI);
    const N = m.stroke / f.lead, cyc = turns % (2 * N);
    const s = f.lead * (cyc <= N ? cyc : 2 * N - cyc); // вверх до stroke, затем рукоятку крутят обратно
    const psi = (2 * Math.PI * s) / f.lead;
    const rotating = [...new Set([m.screw, ...(m.rotating || [])])];
    turn(rotating, f.O, f.u, psi, mul(f.u, s));
    for (const id of m.lifting || []) {
      const p = part(id);
      if (!p || poses.has(id)) continue;
      const ps = poseOf(p);
      poses.set(id, { R: ps.R, t: add(ps.t, mul(f.u, s)) });
    }
    const up = cyc <= N;
    return {
      ok: true, poses,
      state: { lift: s, screwTurns: psi / (2 * Math.PI), direction: up ? "up" : "down" },
      text: `Винт повёрнут на ${fmt(psi / (2 * Math.PI), 2)} об. · подъём ${fmt(s, 1)} мм (${up ? "вверх" : "вниз"}) · s = P·φ/2π, P = ${fmt(f.lead)} мм`,
    };
  }

  // ------------------------------------------------------------------ симуляция (время → фаза)

  /**
   * Контроллер симуляции: фаза растёт со скоростью rpm (оборотов в минуту) только в состоянии running.
   * Время передаётся явно (now, мс) — поведение воспроизводимо в тестах. Смена скорости не даёт скачка:
   * накопленная фаза сохраняется, меняется только темп.
   */
  function createSimulation({ rpm = 30 } = {}) {
    const s = { state: "stopped", phase: 0, rpm, last: null };
    const advance = (now) => {
      if (s.state === "running" && s.last !== null) s.phase += ((now - s.last) / 60000) * s.rpm * 2 * Math.PI;
      s.last = now;
    };
    return {
      get state() { return s.state; },
      get phase() { return s.phase; },
      get rpm() { return s.rpm; },
      start(now) { if (s.state === "running") return; advance(now); s.state = "running"; s.last = now; },
      pause(now) { if (s.state !== "running") return; advance(now); s.state = "paused"; },
      resume(now) { if (s.state !== "paused") return; s.state = "running"; s.last = now; },
      stop() { s.state = "stopped"; s.phase = 0; s.last = null; },
      setSpeed(value, now) { advance(now); s.rpm = Math.max(0, Number(value) || 0); },
      tick(now) { advance(now); return s.phase; },
    };
  }

  BS.mechKinematics = {
    TYPES, list, drivenParts, normalize, removePart, check, applyRest, poseAt, createSimulation, pistonX, lengthOf,
  };
})(globalThis.BuildSense);
