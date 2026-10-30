// BuildSense · Машиностроение — «Создать механизм» из собранных деталей (без DOM, тестируется в Node).
//
// Пользователь собирает детали и сопряжения как обычно; эта функция по сопряжениям определяет роли деталей
// (какая — цилиндр, поршень, шатун, коленвал…), записывает механизм в project.mechanisms и проверяет его
// кинематикой (mechKinematics). Ничего не придумывается: если роли определить нельзя, возвращается понятный текст,
// чего не хватает; если проверка механизма не прошла — механизм не создаётся.
//
//   BS.mechMechanism.plan(project, "slider-crank" | "screw")  → { ok, error, spec }
//   BS.mechMechanism.create(project, type)                    → { ok, error, mechanism, check }  (меняет project при успехе)
(function (BS) {
  "use strict";
  const A = BS.mechAssembly;
  const K = BS.mechKinematics;

  const LABEL = { "slider-crank": "Кривошипно-шатунный механизм", screw: "Винтовая пара" };
  const NAME = (p) => `«${p.name}»`;

  /** Сопряжения «Совместить оси» проекта в виде { a: {partId, ref}, b: {partId, ref} }. */
  function axisMates(project) {
    const out = [];
    for (const asm of A.list(project)) {
      const part = (cid) => { const c = asm.components.find((x) => x.id === cid); return c && project.parts.find((p) => p.id === c.partId); };
      for (const m of asm.mates) {
        if (m.type !== "coaxial" || m.suppressed) continue;
        const a = part(m.a.comp), b = part(m.b.comp);
        if (a && b) out.push({ a: { part: a, ref: m.a.ref }, b: { part: b, ref: m.b.ref } });
      }
    }
    return out;
  }
  /** Деталь, соосно соединённая с данной осью (axisRef) данной детали; фильтр по типам. */
  function partOnAxis(mates, part, ref, types) {
    for (const m of mates) {
      for (const [mine, other] of [[m.a, m.b], [m.b, m.a]]) {
        if (mine.part.id === part.id && mine.ref === ref && (!types || types.includes(other.part.type))) return other.part;
      }
    }
    return null;
  }

  function planSliderCrank(project) {
    const parts = project.parts;
    const by = (t) => parts.filter((p) => p.type === t);
    const mates = axisMates(project);
    const pistons = by("piston");
    if (!pistons.length) return { ok: false, error: "Нет поршня: добавьте деталь «Поршень» (вкладка «Вставка»)." };
    const links = by("link");
    if (links.length < 2) return { ok: false, error: "Для двигателя нужны два рычага: щека кривошипа и шатун. Добавьте их на вкладке «Вставка» → «Рычаг»." };
    const bushings = by("bushing");
    if (!bushings.length) return { ok: false, error: "Нет цилиндра: добавьте «Втулку» — она будет цилиндром." };
    // щека: рычаг, у которого обе проушины насажены на оси (коренная шейка — «axis», шатунная — «axis2»)
    let web = null, crank = null, pin = null;
    for (const l of [...links].sort((x, y) => x.params.C - y.params.C)) {
      const c = partOnAxis(mates, l, "axis", ["shaft"]), p = partOnAxis(mates, l, "axis2", ["shaft"]);
      if (c && p && c.id !== p.id) { web = l; crank = c; pin = p; break; }
    }
    if (!web) {
      return { ok: false, error: "Не найдена щека кривошипа: рычаг, у которого одна проушина насажена на коренную шейку (вал), а вторая — на шатунную шейку (второй вал). Соедините их командой «Соединить детали» → «Совместить оси»." };
    }
    const rod = links.filter((l) => l.id !== web.id).sort((x, y) => y.params.C - x.params.C)[0];
    const piston = pistons[0];
    const cylinder = partOnAxis(mates, piston, "axis", ["bushing"]) || bushings[0];
    if (!partOnAxis(mates, piston, "axis", ["bushing"])) {
      return { ok: false, error: `Поршень ${NAME(piston)} не соединён с цилиндром: выберите «Соединить детали» → поверхность поршня → поверхность цилиндра → «Совместить оси».` };
    }
    const rotating = parts.filter((p) => p.id !== crank.id && p.id !== web.id && p.id !== pin.id && partOnAxis(mates, p, "axis", ["shaft"]) && partOnAxis(mates, p, "axis", ["shaft"]).id === crank.id).map((p) => p.id);
    return { ok: true, spec: { type: "slider-crank", crank: crank.id, web: web.id, pin: pin.id, rod: rod.id, piston: piston.id, cylinder: cylinder.id, rotating } };
  }

  function planScrew(project) {
    const mates = axisMates(project);
    const screw = project.parts.find((p) => p.type === "screw");
    if (!screw) return { ok: false, error: "Нет винта: добавьте деталь «Винт» (вкладка «Вставка»)." };
    const nut = partOnAxis(mates, screw, "axis", ["bushing", "flange"]);
    if (!nut) return { ok: false, error: `Винт ${NAME(screw)} не соединён с гайкой: выберите «Соединить детали» → поверхность винта → поверхность гайки (втулки) → «Совместить оси».` };
    const rotating = project.parts.filter((p) => p.type === "link" && (partOnAxis(mates, p, "axis", ["screw"]) || {}).id === screw.id).map((p) => p.id);
    return { ok: true, spec: { type: "screw", screw: screw.id, nut: nut.id, rotating, lifting: [] } };
  }

  function plan(project, type) {
    if (type === "slider-crank") return planSliderCrank(project);
    if (type === "screw") return planScrew(project);
    return { ok: false, error: `Неизвестный тип механизма «${type}»` };
  }

  function create(project, type) {
    const p = plan(project, type);
    if (!p.ok) return p;
    const list = K.list(project);
    const n = list.reduce((m, x) => { const k = /^K(\d+)$/.exec(x.id); return k ? Math.max(m, Number(k[1])) : m; }, 0);
    const mech = { id: `K${n + 1}`, name: LABEL[type], ...p.spec };
    if (type === "screw") {
      // наибольший подъём: берём самый большой, при котором резьба остаётся в гайке (проверяет кинематика)
      const lt = project.parts.find((x) => x.id === mech.screw).params.Lt;
      let ok = null;
      for (let s = Math.floor(lt * 0.5); s >= 5; s -= 5) { mech.stroke = s; const c = K.check(project, mech); if (c.ok) { ok = c; break; } }
      if (!ok) { mech.stroke = Math.max(5, Math.floor(lt * 0.3)); const c = K.check(project, mech); return { ok: false, error: `Механизм не получился: ${c.errors.join("; ")}. Проверьте, что винт входит в гайку.`, check: c }; }
    }
    const trial = JSON.parse(JSON.stringify(project));
    K.list(trial).push(JSON.parse(JSON.stringify(mech)));
    const c = K.check(trial, K.list(trial)[K.list(trial).length - 1]);
    if (!c.ok) return { ok: false, error: `Механизм не получился: ${c.errors.join("; ")}.`, check: c };
    K.list(project).push(mech);
    K.applyRest(project);
    A.solveAll(project);
    return { ok: true, mechanism: mech, check: c };
  }

  BS.mechMechanism = { plan, create, LABEL };
})(globalThis.BuildSense);
