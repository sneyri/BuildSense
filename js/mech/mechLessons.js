// BuildSense · Машиностроение — содержание визуальных уроков (данные + проверки; без DOM).
// Урок выполняется движком js/mech/mechCoach.js. Шаг: target(c) — что подсветить на экране, done(c) — что считать
// выполненным (проверяется по настоящему проекту), auto(c) — «Сделать за меня» (те же операции, что делает человек).
// В тестах (Node) c.ui нет: проверки, зависящие от интерфейса, считаются выполненными, а auto() работает с проектом.
(function (BS) {
  "use strict";
  const place = (...a) => BS.mechDemos.place(...a); // mechDemos подключается позже: берём в момент вызова
  const X = [1, 0, 0], Z = [0, 0, 1], nY = [0, -1, 0];
  const near = (a, b, t = 0.6) => Math.abs(a - b) <= t;
  /** Проверка, зависящая от интерфейса: без интерфейса (тесты) — считается выполненной. */
  const ui = (c, fn) => (c.ui ? Boolean(fn(c.ui)) : true);

  // ------------------------------------------------------------------ общие шаги

  const addPartStep = (id, type, button, title, text, nth, count = nth + 1, role = "") => ({
    id, title, text,
    target: (c) => c.ui.ribbon(button),
    done: (c) => c.parts(type).length >= count,
    auto: (c) => { while (c.parts(type).length < count) c.addPart(type); },
  });

  const newProjectStep = {
    id: "new", title: "Начнём с чистого листа",
    text: ["Нажмите подсвеченную кнопку **«Новый проект»** — текущая работа не пропадёт: её можно вернуть кнопкой «Отменить»."],
    target: (c) => c.ui.ribbon("Новый проект"),
    done: (c) => c.parts().length === 0,
    auto: (c) => c.newProject(),
  };

  /** Выбрать деталь в дереве, затем нажать «Закрепить на месте». */
  const fixStep = (id, title, text, role) => ({
    id, title, text,
    target: (c) => {
      const p = role(c);
      if (!p) return null;
      return c.ui.selectedId() === p.id ? c.ui.tool("fix") : c.ui.treeRow(p.id);
    },
    items: (c) => { const p = role(c); return p ? [{ text: `«${p.name}» выбрана`, done: !c.ui || c.ui.selectedId() === p.id }, { text: "Закреплена на месте", done: c.isFixed(p.id) }] : []; },
    done: (c) => Boolean(role(c)) && c.isFixed(role(c).id),
    auto: (c) => c.ensureFixed(role(c).id),
  });

  // ------------------------------------------------------------------ урок 1: одноцилиндровый двигатель

  const cyl = (c) => c.nth("bushing", 0);
  const pis = (c) => c.nth("piston", 0);
  const rod = (c) => c.nth("link", 0);
  const web = (c) => c.nth("link", 1);
  const jl = (c) => c.nth("shaft", 0);
  const pin = (c) => c.nth("shaft", 1);

  const engine = {
    id: "engine",
    title: "Одноцилиндровый двигатель",
    about: "Соберёте двигатель, как у мотоцикла: цилиндр, поршень, шатун и коленчатый вал. Около 25 минут.",
    steps: [
      {
        id: "intro", info: true, title: "Что мы соберём",
        text: [
          "В одноцилиндровом двигателе **поршень** ходит вверх-вниз в **цилиндре**, а **шатун** превращает это движение во вращение **коленчатого вала**.",
          "Я буду подсвечивать, куда нажать, и сам проверять, что получилось. Если застрянете — кнопка **«Сделать за меня»** выполнит шаг.",
          "Подсветка не блокирует мышь: можно в любой момент действовать самому.",
        ],
      },
      newProjectStep,
      addPartStep("cyl-add", "bushing", "Втулка", "1. Добавим цилиндр",
        ["Цилиндр — это труба, внутри которой ходит поршень. В программе его роль сыграет деталь **«Втулка»**.",
          "Откройте вкладку **«Вставка»** (подсвечена) и нажмите **«Втулка»**."], 0),
      {
        id: "cyl-size", title: "Размеры цилиндра",
        text: ["Справа в блоке **«Размеры»** введите: **D = 66** (наружный диаметр), **d = 50** (отверстие — по нему пойдёт поршень), **L = 70** (длина).",
          "После каждого числа нажимайте **Tab** — деталь на экране сразу изменится."],
        target: (c) => c.ui.section("Размеры"),
        items: (c) => { const p = cyl(c); return [["D", 66, "Наружный диаметр D"], ["d", 50, "Отверстие d"], ["L", 70, "Длина L"]].map(([k, v, t]) => ({ text: `${t} = ${v}`, done: Boolean(p) && near(p.params[k], v) })); },
        done: (c) => { const p = cyl(c); return Boolean(p) && near(p.params.D, 66) && near(p.params.d, 50) && near(p.params.L, 70); },
        auto: (c) => c.setParams(cyl(c).id, { D: 66, d: 50, L: 70, c: 1, ci: 0 }),
        select: (c) => cyl(c) && cyl(c).id,
      },
      addPartStep("pis-add", "piston", "Поршень", "2. Добавим поршень",
        ["**Поршень** — деталь, которая ходит внутри цилиндра. Нажмите **«Поршень»** на вкладке «Вставка».",
          "Его диаметр (50 мм) уже подходит к отверстию цилиндра (d = 50)."], 0),
      addPartStep("rod-add", "link", "Рычаг", "3. Добавим шатун",
        ["**Шатун** соединяет поршень с коленвалом. В программе это деталь **«Рычаг»** (плоская пластина с двумя отверстиями).",
          "Нажмите **«Рычаг»**. Расстояние между его отверстиями C = 100 мм — это длина шатуна."], 0),
      addPartStep("web-add", "link", "Рычаг", "4. Добавим щёку кривошипа",
        ["**Щека** — короткий рычаг коленвала: она отводит шатунную шейку от оси вращения. Нажмите **«Рычаг»** ещё раз — это будет второй рычаг."], 0, 2),
      {
        id: "web-size", title: "Радиус кривошипа",
        text: ["У щеки расстояние между отверстиями **C** — это **радиус кривошипа**: поршень будет ходить на **2 × C**.",
          "Выберите вторую деталь «Рычаг» (она выбрана) и введите **C = 30**. Тогда ход поршня составит 60 мм."],
        target: (c) => c.ui.field("Межосевое расстояние C"),
        items: (c) => [{ text: "C = 30 мм", done: Boolean(web(c)) && near(web(c).params.C, 30) }],
        done: (c) => Boolean(web(c)) && near(web(c).params.C, 30),
        auto: (c) => c.setParams(web(c).id, { C: 30, D1: 50, d1: 0, D2: 34, d2: 0, T: 10 }),
        select: (c) => web(c) && web(c).id,
      },
      addPartStep("jl-add", "shaft", "Вал", "5. Добавим коренную шейку",
        ["**Коренная шейка** — часть коленвала, которая вращается на опорах. Нажмите **«Вал»**."], 0),
      addPartStep("pin-add", "shaft", "Вал", "6. Добавим шатунную шейку",
        ["**Шатунная шейка** — палец, на который надевается шатун. Нажмите **«Вал»** ещё раз."], 0, 2),
      {
        id: "sizes", title: "Подгоним размеры валов",
        text: ["Новые валы слишком длинные. У коренной шейки сделаем 2 ступени (⌀20 и ⌀24), у шатунной — одну (⌀16 × 24).",
          "Вручную это делается в блоке **«Ступени вала»** (справа). Сейчас проще нажать **«Сделать за меня»**."],
        target: (c) => c.ui.section("Ступени вала"),
        items: (c) => [{ text: "Коренная шейка: 2 ступени", done: Boolean(jl(c)) && jl(c).params.steps.length === 2 }, { text: "Шатунная шейка: 1 ступень ⌀16", done: Boolean(pin(c)) && pin(c).params.steps.length === 1 && near(pin(c).params.steps[0].d, 16) }],
        done: (c) => Boolean(jl(c)) && jl(c).params.steps.length === 2 && Boolean(pin(c)) && pin(c).params.steps.length === 1,
        auto: (c) => {
          c.setParams(jl(c).id, { c1: 1, c2: 0, steps: [{ d: 20, L: 20 }, { d: 24, L: 44 }] });
          c.setParams(pin(c).id, { c1: 0, c2: 0, steps: [{ d: 16, L: 24 }] });
        },
        select: (c) => pin(c) && pin(c).id,
      },
      {
        id: "place", title: "Расставим детали рядом с местами",
        text: ["Сейчас все детали лежат в ряд. Положение каждой задаётся числами в блоке **«Положение»** (X, Y, Z и повороты) — это можно ввести и руками.",
          "Нажмите **«Сделать за меня»**: цилиндр и коренная шейка встанут на места, а поршень, щека и шатунная шейка — **рядом**. Вы сами их соедините."],
        target: (c) => c.ui.section("Положение"),
        done: (c) => Boolean(cyl(c)) && near(cyl(c).placement.z, 152, 0.5) && Boolean(pis(c)) && near(pis(c).placement.x, 60, 0.5),
        auto: (c) => {
          c.place(jl(c).id, place([0, 86, 60], X, nY));
          c.place(cyl(c).id, place([0, 0, 152], X, Z));
          c.place(web(c).id, place([70, 22, 60], Z, nY));
          c.place(pin(c).id, place([70, 12, 90], X, nY));
          c.place(pis(c).id, place([60, 0, 200], X, Z));
          c.place(rod(c).id, place([0, 9, 90], Z, nY));
          const names = [[cyl(c), "Цилиндр"], [pis(c), "Поршень"], [rod(c), "Шатун"], [web(c), "Щека кривошипа"], [jl(c), "Коренная шейка"], [pin(c), "Шатунная шейка"]];
          for (const [p, n] of names) c.rename(p.id, n);
          if (c.ui) c.ui.fit();
        },
        select: (c) => cyl(c) && cyl(c).id,
      },
      fixStep("fix-cyl", "7. Закрепим цилиндр",
        ["Корпус двигателя не должен двигаться: **цилиндр закрепим на месте**. Это «стол», от которого всё отсчитывается.",
          "Щёлкните **«Цилиндр»** в списке слева, затем нажмите **«Закрепить на месте»**."], cyl),
      fixStep("fix-jl", "8. Закрепим коренную шейку",
        ["Ось коленвала тоже неподвижна (вращаться будет, но не уезжать). Выберите **«Коренная шейка»** и нажмите **«Закрепить на месте»**."], jl),
      {
        id: "tool", title: "9. Режим «Соединить детали»",
        text: ["Теперь соединим **поршень с цилиндром**: ось поршня должна совпасть с осью цилиндра.",
          "Нажмите **«Соединить детали»** (или клавишу **J**). Курсор станет крестиком."],
        target: (c) => c.ui.tool("connect"),
        done: (c) => ui(c, (u) => u.tool() === "connect"),
        auto: (c) => c.ui && c.ui.setTool("connect"),
      },
      {
        id: "pick-pis", title: "10. Щёлкните по поршню",
        text: ["Наведите курсор на **поршень** (он стоит рядом с цилиндром) и щёлкните по его боковой поверхности — поверхность подсветится синим.",
          "Это «первая деталь»."],
        target: (c) => c.ui.surface(pis(c).id, { kind: "cylinder" }),
        done: (c) => ui(c, (u) => u.conn().a && u.conn().a.partId === pis(c).id),
        auto: (c) => c.ui && c.ui.pick(c.surface(pis(c).id, { kind: "cylinder" })),
      },
      {
        id: "pick-cyl", title: "11. Щёлкните по цилиндру",
        text: ["Теперь щёлкните по **цилиндру**. Программа предложит **«Совместить оси»** и покажет оранжевым, куда встанет поршень."],
        target: (c) => c.ui.surface(cyl(c).id, { kind: "cylinder" }),
        done: (c) => ui(c, (u) => u.conn().b && u.conn().b.partId === cyl(c).id && u.conn().plan && u.conn().plan.ok),
        auto: (c) => c.ui && c.ui.pick(c.surface(cyl(c).id, { kind: "cylinder" })),
      },
      {
        id: "apply", title: "12. Подтвердите соединение",
        text: ["Слева внизу — панель с вариантом **«Совместить оси»** и расстоянием «было → станет». Нажмите **«Применить»** (или Enter).",
          "Поршень въедет в цилиндр. Соединение — настоящее правило: если сдвинуть цилиндр, поршень поедет за ним."],
        target: (c) => c.ui.connectApply(),
        done: (c) => c.hasMate(pis(c).id, cyl(c).id, "coaxial"),
        auto: (c) => { if (c.ui && c.ui.conn().plan && c.ui.conn().plan.ok) c.ui.confirm(); else c.connect(c.surface(pis(c).id, { kind: "cylinder" }), c.surface(cyl(c).id, { kind: "cylinder" }), "axes"); },
      },
      {
        id: "rest", title: "13. Остальные соединения — такие же",
        text: ["Щеку надо насадить на коренную шейку, а шатунную шейку — на второе отверстие щеки: **«Совместить оси»** и **«Прижать поверхности»**, как вы только что делали.",
          "Это ещё четыре соединения. Нажмите **«Сделать за меня»** — программа выполнит их сама, а вы увидите, как детали встают на места."],
        target: () => null,
        done: (c) => c.hasMate(web(c).id, jl(c).id, "coaxial") && c.hasMate(web(c).id, pin(c).id, "coaxial"),
        auto: (c) => {
          const J = jl(c), W = web(c), P = pin(c);
          if (c.ui) c.ui.setTool("select");
          if (!c.hasMate(W.id, J.id, "coaxial")) c.connect(c.surface(J.id, { kind: "cylinder" }), cylOfWeb(c, W, "axis"), "axes");
          if (!c.hasMate(W.id, J.id, "planar")) c.connect(c.surface(J.id, { kind: "plane", ref: "end1" }), c.surface(W.id, { kind: "plane", ref: "end0" }), "press");
          if (!c.hasMate(W.id, P.id, "coaxial")) c.connect(cylOfWeb(c, W, "axis2"), c.surface(P.id, { kind: "cylinder" }), "axes");
          if (!c.hasMate(W.id, P.id, "planar")) c.connect(c.surface(W.id, { kind: "plane", ref: "end1" }), c.surface(P.id, { kind: "plane", ref: "end0" }), "press");
          if (c.ui) c.ui.fit();
        },
      },
      {
        id: "mech", title: "14. Объявим механизм",
        text: ["Детали собраны, но программа ещё не знает, что это **двигатель**. Нажмите **«Кривошипно-шатунный»** на вкладке «Вставка» (группа «Механизм»).",
          "Программа сама определит роли деталей по соединениям (цилиндр, поршень, шатун, коленвал) и проверит, что механизм может проворачиваться."],
        target: (c) => c.ui.ribbon("Кривошипно-шатунный"),
        done: (c) => c.mechanisms().some((m) => m.type === "slider-crank"),
        auto: (c) => c.createMechanism("slider-crank"),
      },
      {
        id: "sim", title: "15. Запустим двигатель",
        text: ["Внизу на панели просмотра нажмите **«Симуляция»**, затем **«Пуск»**. Поршень начнёт ходить, коленвал вращаться.",
          "Это кинематика: показывает, как движутся детали, но не считает силы и нагрузку."],
        target: (c) => (c.ui.viewerMode() === "sim" ? c.ui.viewerButton("Пуск") || c.ui.viewerButton("Продолжить") : c.ui.viewerButton("Симуляция")),
        done: (c) => ui(c, (u) => u.viewerState().sim === "running"),
        auto: (c) => { if (c.ui) { c.ui.viewerClick("Симуляция"); c.ui.viewerClick("Пуск"); } },
      },
      {
        id: "explode", title: "16. Разберём на части",
        text: ["Нажмите **«Взрывной вид»** — детали плавно разъедутся, и станет видно устройство двигателя. Повторное нажатие или «Восстановить сборку» вернёт всё обратно."],
        target: (c) => c.ui.viewerButton("Взрывной вид"),
        done: (c) => ui(c, (u) => u.viewerState().mode === "explode"),
        auto: (c) => c.ui && c.ui.viewerClick("Взрывной вид"),
      },
      {
        id: "end", info: true, title: "Двигатель собран!",
        text: ["Вы создали настоящую параметрическую сборку: измените радиус кривошипа C у щеки или длину шатуна — механизм пересчитается.",
          "Проект можно сохранить (**Сохранить**), выгрузить для FreeCAD (**Вывод**) или сделать чертёж детали.",
          "Дальше — урок **«Винтовая пара»**."],
      },
    ],
  };

  /** Поверхность проушины щеки (link): ось axis или axis2 — через классификацию «цилиндра» нужного радиуса. */
  function cylOfWeb(c, W, ref) {
    const p = c.part(W.id);
    const eye = ref === "axis" ? { r: p.params.D1 / 2, cx: 0 } : { r: p.params.D2 / 2, cx: p.params.C };
    return { kind: "cylinder", partId: p.id, ref, r: eye.r, outward: true, z0: 0, z1: p.params.T, label: `Проушина ⌀${eye.r * 2}`, plain: `Проушина ⌀${eye.r * 2}`, point: [eye.cx, 0, p.params.T / 2] };
  }

  // ------------------------------------------------------------------ урок 2: винтовая пара

  const nut = (c) => c.nth("bushing", 0);
  const screw = (c) => c.nth("screw", 0);

  const screwLesson = {
    id: "screw",
    title: "Винтовая пара",
    about: "Винт и гайка — основа домкрата и тисков. Соберёте пару и увидите, как вращение превращается в подъём. Около 12 минут.",
    steps: [
      {
        id: "intro", info: true, title: "Как работает винт",
        text: ["Когда винт вращается в неподвижной **гайке**, он ещё и **поднимается**: за один оборот — на величину **шага резьбы P**.",
          "Так устроены домкрат, тиски и струбцина. Соберём такую пару."],
      },
      newProjectStep,
      addPartStep("nut-add", "bushing", "Втулка", "1. Добавим гайку",
        ["**Гайка** — деталь с резьбовым отверстием. В программе её роль сыграет **«Втулка»**. Нажмите **«Втулка»** на вкладке «Вставка»."], 0),
      {
        id: "nut-size", title: "Размеры гайки",
        text: ["Введите справа: **D = 50**, **d = 24** (под винт ⌀24), **L = 40**. После каждого числа — **Tab**."],
        target: (c) => c.ui.section("Размеры"),
        items: (c) => { const p = nut(c); return [["D", 50], ["d", 24], ["L", 40]].map(([k, v]) => ({ text: `${k} = ${v}`, done: Boolean(p) && near(p.params[k], v) })); },
        done: (c) => { const p = nut(c); return Boolean(p) && near(p.params.D, 50) && near(p.params.d, 24) && near(p.params.L, 40); },
        auto: (c) => c.setParams(nut(c).id, { D: 50, d: 24, L: 40, c: 1, ci: 0.5 }),
        select: (c) => nut(c) && nut(c).id,
      },
      addPartStep("screw-add", "screw", "Винт", "2. Добавим винт",
        ["Нажмите **«Винт»** на вкладке «Вставка». Он уже ⌀24 с шагом резьбы **P = 5 мм**: за оборот поднимется на 5 мм."], 0),
      {
        id: "place", title: "Расставим рядом",
        text: ["Гайку поставим на высоте 40 мм, а винт — рядом. Нажмите **«Сделать за меня»** — позже вы сами соедините их."],
        target: (c) => c.ui.section("Положение"),
        done: (c) => Boolean(nut(c)) && near(nut(c).placement.z, 40, 0.5) && Boolean(screw(c)) && near(screw(c).placement.x, 90, 0.5),
        auto: (c) => { c.place(nut(c).id, { x: 0, y: 0, z: 40 }); c.place(screw(c).id, { x: 90, y: 0, z: 0 }); c.rename(nut(c).id, "Гайка"); c.rename(screw(c).id, "Винт"); if (c.ui) c.ui.fit(); },
        select: (c) => nut(c) && nut(c).id,
      },
      fixStep("fix-nut", "3. Закрепим гайку",
        ["Гайка неподвижна (она в корпусе домкрата). Выберите **«Гайка»** в списке слева и нажмите **«Закрепить на месте»**."], nut),
      {
        id: "tool", title: "4. Режим «Соединить детали»",
        text: ["Нажмите **«Соединить детали»** (или **J**)."],
        target: (c) => c.ui.tool("connect"),
        done: (c) => ui(c, (u) => u.tool() === "connect"),
        auto: (c) => c.ui && c.ui.setTool("connect"),
      },
      {
        id: "pick-screw", title: "5. Щёлкните по винту",
        text: ["Щёлкните по **резьбовой части винта** (боковая поверхность)."],
        target: (c) => c.ui.surface(screw(c).id, { kind: "cylinder" }),
        done: (c) => ui(c, (u) => u.conn().a && u.conn().a.partId === screw(c).id),
        auto: (c) => c.ui && c.ui.pick(c.surface(screw(c).id, { kind: "cylinder" })),
      },
      {
        id: "pick-nut", title: "6. Щёлкните по гайке",
        text: ["Теперь щёлкните по **гайке**. Предложение: **«Совместить оси»** — винт встанет точно в центр гайки."],
        target: (c) => c.ui.surface(nut(c).id, { kind: "cylinder" }),
        done: (c) => ui(c, (u) => u.conn().b && u.conn().b.partId === nut(c).id && u.conn().plan && u.conn().plan.ok),
        auto: (c) => c.ui && c.ui.pick(c.surface(nut(c).id, { kind: "cylinder" })),
      },
      {
        id: "apply", title: "7. Подтвердите",
        text: ["Нажмите **«Применить»** (или Enter) — винт встанет в гайку."],
        target: (c) => c.ui.connectApply(),
        done: (c) => c.hasMate(screw(c).id, nut(c).id, "coaxial"),
        auto: (c) => { if (c.ui && c.ui.conn().plan && c.ui.conn().plan.ok) c.ui.confirm(); else c.connect(c.surface(screw(c).id, { kind: "cylinder" }), c.surface(nut(c).id, { kind: "cylinder" }), "axes"); },
      },
      {
        id: "gap", title: "8. Поднимем винт: «Оставить зазор»",
        text: ["Винт в гайке ещё может скользить вдоль оси. Зададим положение: между **верхом гайки** и **нижней стороной головки винта** — зазор **30 мм**.",
          "Это делается тем же инструментом: выбираете две плоскости и способ **«Оставить зазор»**. Нажмите **«Сделать за меня»**, чтобы увидеть результат."],
        target: () => null,
        done: (c) => c.hasMate(screw(c).id, nut(c).id, "distance"),
        auto: (c) => {
          if (c.ui) c.ui.setTool("select");
          c.connect(c.surface(nut(c).id, { kind: "plane", ref: "end1" }), c.surface(screw(c).id, { kind: "plane", ref: "head0" }), "gap", { gap: 30 });
          if (c.ui) c.ui.fit();
        },
      },
      {
        id: "mech", title: "9. Объявим механизм",
        text: ["Нажмите **«Винтовая пара»** на вкладке «Вставка» (группа «Механизм»). Программа найдёт винт и гайку и посчитает, на сколько можно поднять винт."],
        target: (c) => c.ui.ribbon("Винтовая пара"),
        done: (c) => c.mechanisms().some((m) => m.type === "screw"),
        auto: (c) => c.createMechanism("screw"),
      },
      {
        id: "sim", title: "10. Закрутим винт",
        text: ["На панели просмотра нажмите **«Симуляция»**, затем **«Пуск»**: винт вращается и поднимается на 5 мм за оборот."],
        target: (c) => (c.ui.viewerMode() === "sim" ? c.ui.viewerButton("Пуск") || c.ui.viewerButton("Продолжить") : c.ui.viewerButton("Симуляция")),
        done: (c) => ui(c, (u) => u.viewerState().sim === "running"),
        auto: (c) => { if (c.ui) { c.ui.viewerClick("Симуляция"); c.ui.viewerClick("Пуск"); } },
      },
      {
        id: "end", info: true, title: "Винтовая пара работает!",
        text: ["Попробуйте изменить **шаг P** у винта (блок «Размеры») и снова запустить симуляцию — подъём за оборот изменится.",
          "Чтобы собрать домкрат целиком, откройте **«Демо-проекты» → «Винтовой домкрат»** и посмотрите, как соединены остальные детали."],
      },
    ],
  };

  BS.mechLessons = { LESSONS: [engine, screwLesson], engine, screw: screwLesson };
})(globalThis.BuildSense);
