// Визуальные уроки (двигатель, винтовая пара): каждый шаг можно выполнить «Сделать за меня», проверка шага срабатывает по
// настоящему проекту, итог — рабочий механизм (кинематика подтверждает), который сохраняется, загружается и экспортируется.
// Подсветка и клики проверяются отдельно в браузере; здесь — логика уроков без интерфейса.
import test from "node:test";
import assert from "node:assert/strict";
import { loadMech } from "./mech_build.mjs";

const BS = loadMech();
const M = BS.mechModel, A = BS.mechAssembly, K = BS.mechKinematics, IO = BS.mechIO, CH = BS.mechCoach, L = BS.mechLessons, MM = BS.mechMechanism;
const plain = (v) => JSON.parse(JSON.stringify(v));

function headless() {
  const project = M.createProject("Урок");
  const mutate = (label, fn) => { fn(project); A.solveAll(project); };
  const ctx = CH.dataContext(() => project, mutate);
  return { project, ctx };
}
function complete(lesson, ctx) {
  const R = new CH.Runner(lesson, ctx);
  const trace = [];
  while (!R.finished()) {
    const s = R.step;
    if (!s.info && !R.isDone()) {
      const r = R.auto();
      assert.equal(r.ok, true, `шаг «${s.id}»: ${r.error}`);
    }
    assert.equal(R.isDone(), true, `шаг «${s.id}» не считается выполненным после «Сделать за меня»`);
    trace.push(s.id);
    R.next();
  }
  return trace;
}

test("урок «Двигатель»: все шаги выполняются автоматически, получается рабочий кривошипно-шатунный механизм", () => {
  const { project, ctx } = headless();
  const trace = complete(L.engine, ctx);
  assert.ok(trace.length >= 15);
  assert.equal(project.parts.length, 6);
  assert.deepEqual(plain(project.parts.map((p) => p.type).sort()), ["bushing", "link", "link", "piston", "shaft", "shaft"]);
  const mech = project.mechanisms[0];
  assert.equal(mech.type, "slider-crank");
  const c = K.check(project, mech);
  assert.equal(c.ok, true, c.errors.join("; "));
  assert.equal(c.frame.r, 30);
  assert.equal(c.stroke, 60);
  assert.equal(A.validate(project).length, 0);
  // роли определились по сопряжениям
  const name = (id) => project.parts.find((p) => p.id === id).name;
  assert.deepEqual(plain([name(mech.cylinder), name(mech.piston), name(mech.rod), name(mech.web), name(mech.crank), name(mech.pin)]), ["Цилиндр", "Поршень", "Шатун", "Щека кривошипа", "Коренная шейка", "Шатунная шейка"]);
});

test("урок «Двигатель»: результат сохраняется/загружается, экспортируется, поршень в цилиндре без пересечений", () => {
  const { project, ctx } = headless();
  complete(L.engine, ctx);
  const back = IO.parse(IO.serialize(project));
  assert.deepEqual(plain(back.errors), []);
  assert.equal(back.project.mechanisms.length, 1);
  assert.equal(K.check(back.project, back.project.mechanisms[0]).ok, true);
  const ex = M.exportForCad(project);
  assert.equal(ex.parts.length, 6);
  assert.equal(ex.assemblies[0].ok, true);
  const solved = A.solve(plain(project), project.assemblies[0], { apply: false });
  assert.equal(solved.interference.filter((x) => x.volume > 1e-3 && !K.drivenParts(project).has(x.a) && !K.drivenParts(project).has(x.b)).length, 0);
});

test("урок «Двигатель»: шаги проверяют настоящий проект (ручные действия тоже засчитываются, а ошибочные — нет)", () => {
  const { project, ctx } = headless();
  const R = new CH.Runner(L.engine, ctx);
  const goto = (id) => { while (R.step.id !== id) R.next(); };
  goto("cyl-add");
  assert.equal(R.isDone(), false);
  ctx.addPart("bushing");
  assert.equal(R.isDone(), true);
  goto("cyl-size");
  assert.equal(R.isDone(), false);
  assert.ok(R.items().every((i) => !i.done) === false || R.items().length === 3);
  ctx.setParams(ctx.nth("bushing").id, { D: 66, d: 50 });
  assert.equal(R.isDone(), false, "длина L ещё не введена");
  assert.equal(R.items().filter((i) => i.done).length, 2);
  ctx.setParams(ctx.nth("bushing").id, { L: 70 });
  assert.equal(R.isDone(), true);
  assert.throws(() => ctx.setParams(ctx.nth("bushing").id, { d: 99 }), /отверстие|d|меньше/i, "недопустимый размер должен отклоняться понятной ошибкой");
  assert.equal(ctx.nth("bushing").params.d, 50, "отклонённое значение не должно попасть в проект");
});

test("урок «Двигатель»: если шатуна/щеки нет или детали не соединены — «Создать механизм» говорит, чего не хватает", () => {
  const { project, ctx } = headless();
  ctx.addPart("bushing"); ctx.addPart("piston");
  assert.match(MM.plan(project, "slider-crank").error, /два рычага/);
  ctx.addPart("link"); ctx.addPart("link"); ctx.addPart("shaft"); ctx.addPart("shaft");
  assert.match(MM.plan(project, "slider-crank").error, /щека кривошипа|Не найдена щека/);
  assert.equal(MM.create(project, "slider-crank").ok, false);
  assert.equal(project.mechanisms === undefined || project.mechanisms.length === 0, true);
});

test("урок «Винтовая пара»: все шаги выполняются, механизм проходит проверку, подъём 5 мм за оборот", () => {
  const { project, ctx } = headless();
  complete(L.screw, ctx);
  assert.equal(project.parts.length, 2);
  const mech = project.mechanisms[0];
  assert.equal(mech.type, "screw");
  const c = K.check(project, mech);
  assert.equal(c.ok, true, c.errors.join("; "));
  assert.equal(c.frame.lead, 5);
  assert.ok(mech.stroke > 0);
  const back = IO.parse(IO.serialize(project));
  assert.equal(K.check(back.project, back.project.mechanisms[0]).ok, true);
  assert.equal(A.validate(project).length, 0);
});

test("«Сделать за меня» не ломает уже сделанное вручную: повторный вызов не создаёт дубликатов", () => {
  const { project, ctx } = headless();
  complete(L.engine, ctx);
  const R = new CH.Runner(L.engine, ctx);
  for (const s of L.engine.steps) if (s.auto && s.id !== "intro") { R.index = L.engine.steps.indexOf(s); R.auto(); }
  assert.equal(project.parts.length, 6);
  assert.equal(project.mechanisms.length, 1, "механизм продублирован");
  assert.equal(A.list(project).length, 1);
  const ids = project.assemblies[0].mates.map((m) => `${m.type}:${m.a.comp}${m.a.ref}-${m.b.comp}${m.b.ref}`);
  assert.equal(new Set(ids).size, ids.length, "дубликаты сопряжений");
});
