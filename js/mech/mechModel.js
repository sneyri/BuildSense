// BuildSense · Машиностроение — модель проекта деталей (без DOM и Three.js, тестируется в Node).
//
// Проект: { format:"buildsense-mech", schemaVersion:2, units:"mm", name, parts:[...], assemblies:[...] }
//   schemaVersion 2 добавила сборки (js/mech/mechAssembly.js); файлы версии 1 открываются без изменений.
// Деталь: { id, type, name, params, placement:{ x, y, z, rotation:{ x, y, z } }, material }
//   params    — только размеры, введённые пользователем (источник истины);
//   placement — положение локальной системы детали в мм, поворот — углы Эйлера в градусах,
//               порядок как THREE.Euler "XYZ": матрица M = Rx · Ry · Rz;
//   геометрия не хранится, а каждый раз выводится из params через дерево фич (features).
//
// Дерево фич (минимальный «PartDesign»):
//   sketch  — замкнутая полилиния профиля в плоскости RZ (r ≥ 0 — расстояние от оси Z);
//   chamfer — фаска 45° на вершинах эскиза (индексы вершин исходного эскиза);
//   revolve — тело вращения эскиза вокруг оси Z на 360°;
//   hole    — сквозные цилиндрические отверстия (массив по окружности, вдоль оси Z).
// Новые типы деталей описываются тем же набором; новые операции (выдавливание, вырез, скругление,
// сборки) добавляются как новые kind и обрабатываются в evaluate() и в макросе FreeCAD.
(function (BS) {
  "use strict";

  const FORMAT = "buildsense-mech";
  const SCHEMA_VERSION = 2;
  const SUPPORTED_SCHEMAS = [1, 2];
  const EXPORT_FORMAT = "buildsense-mech-freecad";
  /** Экспорт без сборок остаётся версии 1 (его читает и прежний макрос), со сборками — версии 2. */
  const EXPORT_VERSION_PARTS = 1;
  const EXPORT_VERSION_ASSEMBLY = 2;
  /** Учебные ограничения (не нормативные): минимальная стенка и перемычка, мм. */
  const MIN_WALL = 1;
  const MIN_BRIDGE = 1;
  const EPS = 1e-9;

  /** Справочные приближённые плотности, кг/м³ (для оценки массы в учебных целях). */
  const MATERIALS = {
    steel: { label: "Сталь углеродистая", density: 7850, desc: "Универсальная конструкционная сталь: валы, оси, фланцы. Прочная и тяжёлая.", color: 0x9aa4ad },
    cast_iron: { label: "Чугун серый", density: 7200, desc: "Хорошо отливается и гасит вибрации, но хрупкий: корпуса, станины.", color: 0x6f757b },
    aluminum: { label: "Алюминиевый сплав", density: 2700, desc: "Лёгкий и не ржавеет, но мягче стали: корпуса и лёгкие детали.", color: 0xc9d1d9 },
    bronze: { label: "Бронза", density: 8800, desc: "Хорошо скользит и выдерживает трение: втулки, подшипники скольжения.", color: 0xb08d57 },
    brass: { label: "Латунь", density: 8500, desc: "Не ржавеет и легко обрабатывается: фитинги, втулки, мелкие детали.", color: 0xc8a951 },
    polyamide: { label: "Полиамид (капролон)", density: 1150, desc: "Лёгкий пластик: гасит шум, работает без смазки (втулки, шестерни).", color: 0xe8e2c8 },
  };

  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const err = (field, message) => ({ field, message });
  const fmt = (v) => String(Math.round(v * 1000) / 1000).replace(".", ",");

  // ------------------------------------------------------------------ типы деталей

  /** Описание параметра: key, label, unit, min, default, step, integer, hint. */
  const TYPES = {
    bushing: {
      label: "Втулка",
      icon: "round",
      params: [
        { key: "D", label: "Наружный диаметр D", unit: "мм", min: 2, default: 40, step: 1 },
        { key: "d", label: "Внутренний диаметр d", unit: "мм", min: 0.5, default: 25, step: 1 },
        { key: "L", label: "Длина L", unit: "мм", min: 0.5, default: 30, step: 1 },
        { key: "c", label: "Фаска наружная c×45°", unit: "мм", min: 0, default: 1, step: 0.5, hint: "0 — без фаски" },
        { key: "ci", label: "Фаска внутренняя ×45°", unit: "мм", min: 0, default: 0.5, step: 0.5, hint: "0 — без фаски" },
      ],
    },
    shaft: {
      label: "Вал ступенчатый",
      icon: "pipe",
      params: [
        { key: "c1", label: "Фаска левого торца ×45°", unit: "мм", min: 0, default: 1, step: 0.5 },
        { key: "c2", label: "Фаска правого торца ×45°", unit: "мм", min: 0, default: 1, step: 0.5 },
      ],
      stepParams: [
        { key: "d", label: "d", unit: "мм", min: 1, default: 30, step: 1 },
        { key: "L", label: "L", unit: "мм", min: 0.5, default: 40, step: 1 },
      ],
      defaultSteps: [{ d: 30, L: 40 }, { d: 40, L: 60 }, { d: 35, L: 50 }, { d: 25, L: 30 }],
    },
    flange: {
      label: "Фланец",
      icon: "pad",
      params: [
        { key: "D", label: "Наружный диаметр D", unit: "мм", min: 5, default: 140, step: 1 },
        { key: "T", label: "Толщина диска", unit: "мм", min: 0.5, default: 14, step: 1 },
        { key: "d", label: "Центральное отверстие d", unit: "мм", min: 0.5, default: 40, step: 1 },
        { key: "hubD", label: "Ступица: диаметр", unit: "мм", min: 0, default: 70, step: 1, hint: "0 — без ступицы" },
        { key: "hubH", label: "Ступица: высота над диском", unit: "мм", min: 0, default: 16, step: 1, hint: "0 — без ступицы" },
        { key: "n", label: "Число отверстий n", unit: "шт", min: 0, default: 6, step: 1, integer: true, max: 72 },
        { key: "pcd", label: "Диаметр окружности отверстий", unit: "мм", min: 0, default: 110, step: 1 },
        { key: "holeD", label: "Диаметр отверстий", unit: "мм", min: 0.5, default: 14, step: 0.5 },
      ],
    },
    // плоская деталь с двумя проушинами (шатун, щека кривошипа, рычаг): выдавливание по Z на толщину T;
    // проушина 1 — в начале координат (ось "axis"), проушина 2 — в точке (C, 0) (ось "axis2")
    link: {
      label: "Рычаг / шатун",
      icon: "part",
      extrude: true,
      params: [
        { key: "C", label: "Межосевое расстояние C", unit: "мм", min: 1, default: 100, step: 1 },
        { key: "D1", label: "Проушина 1: наружный диаметр", unit: "мм", min: 2, default: 32, step: 1 },
        { key: "d1", label: "Проушина 1: отверстие", unit: "мм", min: 0, default: 16, step: 0.5, hint: "0 — без отверстия" },
        { key: "D2", label: "Проушина 2: наружный диаметр", unit: "мм", min: 2, default: 20, step: 1 },
        { key: "d2", label: "Проушина 2: отверстие", unit: "мм", min: 0, default: 10, step: 0.5, hint: "0 — без отверстия" },
        { key: "T", label: "Толщина T", unit: "мм", min: 0.5, default: 18, step: 1 },
      ],
    },
    // прямоугольная плита с отверстием (корпус подшипника, стенка картера, основание): выдавливание по Z на T;
    // центр отверстия — в начале координат (ось "axis"), плита от −W/2 до W/2 по X и от −hb до H − hb по Y
    block: {
      label: "Корпус / опора",
      icon: "pad",
      extrude: true,
      params: [
        { key: "W", label: "Ширина W", unit: "мм", min: 2, default: 90, step: 1 },
        { key: "H", label: "Высота H", unit: "мм", min: 2, default: 80, step: 1 },
        { key: "hb", label: "Высота оси отверстия от низа", unit: "мм", min: 0, default: 40, step: 1 },
        { key: "T", label: "Толщина T", unit: "мм", min: 0.5, default: 20, step: 1 },
        { key: "d", label: "Отверстие d", unit: "мм", min: 0, default: 30, step: 0.5, hint: "0 — сплошная плита" },
      ],
    },
    piston: {
      label: "Поршень",
      icon: "round",
      params: [
        { key: "D", label: "Диаметр D", unit: "мм", min: 4, default: 50, step: 1 },
        { key: "H", label: "Высота H", unit: "мм", min: 2, default: 50, step: 1 },
        { key: "t", label: "Толщина днища", unit: "мм", min: 0.5, default: 8, step: 0.5 },
        { key: "w", label: "Толщина юбки", unit: "мм", min: 0.5, default: 5, step: 0.5 },
        { key: "pinZ", label: "Ось пальца от низа юбки", unit: "мм", min: 0.5, default: 20, step: 1, hint: "Где шатун крепится к поршню (для кинематики)" },
      ],
    },
    // винт: резьба показана условно — кольцевыми зубьями профиля (тело вращения), а не винтовой линией
    screw: {
      label: "Винт",
      icon: "shaft",
      params: [
        { key: "d", label: "Наружный диаметр резьбы d", unit: "мм", min: 2, default: 24, step: 1 },
        { key: "P", label: "Шаг резьбы P (= ход за оборот)", unit: "мм", min: 0.5, default: 5, step: 0.5 },
        { key: "Lt", label: "Длина резьбы", unit: "мм", min: 1, default: 130, step: 1 },
        { key: "D", label: "Головка: диаметр", unit: "мм", min: 2, default: 40, step: 1 },
        { key: "Lh", label: "Головка: высота", unit: "мм", min: 0.5, default: 16, step: 1 },
        { key: "dn", label: "Шейка: диаметр", unit: "мм", min: 1, default: 16, step: 1 },
        { key: "Ln", label: "Шейка: длина", unit: "мм", min: 0.5, default: 22, step: 1 },
      ],
    },
  };
  /** Глубина условной резьбы винта (доля шага). */
  const THREAD_DEPTH = 0.5;

  function defaultParams(type) {
    const t = TYPES[type];
    if (!t) throw new Error(`Неизвестный тип детали «${type}»`);
    const p = {};
    for (const d of t.params) p[d.key] = d.default;
    if (type === "shaft") p.steps = t.defaultSteps.map((s) => ({ ...s }));
    return p;
  }

  function paramDef(type, field) {
    const t = TYPES[type];
    if (!t) return null;
    const m = /^steps\.(\d+)\.(\w+)$/.exec(field);
    if (m) return (t.stepParams || []).find((d) => d.key === m[2]) || null;
    return t.params.find((d) => d.key === field) || null;
  }

  /** Ярлык поля для сообщений: «Длина L», «Ступень 2: d». */
  function fieldLabel(type, field) {
    const m = /^steps\.(\d+)\.(\w+)$/.exec(field);
    if (m) return `Ступень ${Number(m[1]) + 1}: ${m[2]}`;
    const d = paramDef(type, field);
    return d ? d.label : field;
  }

  // ------------------------------------------------------------------ валидация

  /** Базовая проверка одного числа по описанию параметра. */
  function checkNumber(errors, type, field, value) {
    const def = paramDef(type, field) || {};
    const name = fieldLabel(type, field);
    if (!num(value)) {
      errors.push(err(field, `${name}: нужно конечное число`));
      return false;
    }
    if (def.integer && !Number.isInteger(value)) {
      errors.push(err(field, `${name}: нужно целое число`));
      return false;
    }
    if (def.min !== undefined && value < def.min) {
      errors.push(err(field, `${name}: не меньше ${fmt(def.min)} ${def.unit || ""}`.trim()));
      return false;
    }
    if (def.max !== undefined && value > def.max) {
      errors.push(err(field, `${name}: не больше ${fmt(def.max)} ${def.unit || ""}`.trim()));
      return false;
    }
    return true;
  }

  const VALIDATORS = {
    bushing(p, e) {
      const ok = ["D", "d", "L", "c", "ci"].map((k) => checkNumber(e, "bushing", k, p[k])).every(Boolean);
      if (!ok) return;
      const wall = (p.D - p.d) / 2;
      if (p.d >= p.D) e.push(err("d", `Внутренний диаметр d (${fmt(p.d)}) должен быть меньше наружного D (${fmt(p.D)})`));
      else if (wall < MIN_WALL) e.push(err("d", `Стенка (D − d)/2 = ${fmt(wall)} мм тоньше минимальной ${MIN_WALL} мм`));
      else {
        if (p.c + p.ci > wall - EPS && p.c + p.ci > 0) e.push(err(p.c > 0 ? "c" : "ci", `Фаски (${fmt(p.c)} + ${fmt(p.ci)} мм) не помещаются в стенку ${fmt(wall)} мм`));
        if (2 * p.c > p.L - EPS && p.c > 0) e.push(err("c", `Наружная фаска ${fmt(p.c)} мм слишком велика для длины L = ${fmt(p.L)} мм`));
        if (2 * p.ci > p.L - EPS && p.ci > 0) e.push(err("ci", `Внутренняя фаска ${fmt(p.ci)} мм слишком велика для длины L = ${fmt(p.L)} мм`));
      }
    },
    shaft(p, e) {
      if (!Array.isArray(p.steps) || p.steps.length === 0) {
        e.push(err("steps", "У вала должна быть хотя бы одна ступень"));
        return;
      }
      if (p.steps.length > 30) e.push(err("steps", "Не больше 30 ступеней"));
      let ok = true;
      p.steps.forEach((s, i) => {
        if (!s || typeof s !== "object") { e.push(err(`steps.${i}.d`, `Ступень ${i + 1}: неверные данные`)); ok = false; return; }
        ok = checkNumber(e, "shaft", `steps.${i}.d`, s.d) && ok;
        ok = checkNumber(e, "shaft", `steps.${i}.L`, s.L) && ok;
      });
      ok = checkNumber(e, "shaft", "c1", p.c1) && ok;
      ok = checkNumber(e, "shaft", "c2", p.c2) && ok;
      if (!ok) return;
      const first = p.steps[0];
      const last = p.steps[p.steps.length - 1];
      if (p.c1 > 0 && (p.c1 > first.d / 2 - MIN_WALL + EPS || p.c1 > first.L - EPS))
        e.push(err("c1", `Фаска левого торца ${fmt(p.c1)} мм больше допустимой для ступени 1 (d = ${fmt(first.d)}, L = ${fmt(first.L)})`));
      const lastLen = p.steps.length === 1 ? last.L - p.c1 : last.L;
      if (p.c2 > 0 && (p.c2 > last.d / 2 - MIN_WALL + EPS || p.c2 > lastLen - EPS))
        e.push(err("c2", `Фаска правого торца ${fmt(p.c2)} мм больше допустимой для последней ступени (d = ${fmt(last.d)}, L = ${fmt(last.L)})`));
    },
    flange(p, e) {
      const keys = ["D", "T", "d", "hubD", "hubH", "n", "pcd", "holeD"];
      const ok = keys.map((k) => checkNumber(e, "flange", k, p[k])).every(Boolean);
      if (!ok) return;
      const R = p.D / 2;
      const rb = p.d / 2;
      const hub = p.hubD > 0 && p.hubH > 0;
      if ((p.hubD > 0) !== (p.hubH > 0)) e.push(err(p.hubD > 0 ? "hubH" : "hubD", "Для ступицы нужны и диаметр, и высота (или оба 0)"));
      if (R - rb < MIN_WALL) e.push(err("d", `Центральное отверстие d = ${fmt(p.d)} мм оставляет стенку меньше ${MIN_WALL} мм до края D`));
      if (hub) {
        if (p.hubD >= p.D) e.push(err("hubD", `Диаметр ступицы (${fmt(p.hubD)}) должен быть меньше D (${fmt(p.D)})`));
        if ((p.hubD - p.d) / 2 < MIN_WALL) e.push(err("hubD", `Стенка ступицы (${fmt((p.hubD - p.d) / 2)} мм) тоньше ${MIN_WALL} мм`));
      }
      if (p.n > 0) {
        const rh = p.holeD / 2;
        const rc = p.pcd / 2;
        const inner = hub ? p.hubD / 2 : rb;
        if (rc + rh > R - MIN_BRIDGE + EPS)
          e.push(err("pcd", `Отверстия выходят за край: ${fmt(p.pcd)}/2 + ${fmt(p.holeD)}/2 = ${fmt(rc + rh)} мм, а до края с перемычкой ${MIN_BRIDGE} мм — ${fmt(R - MIN_BRIDGE)} мм`));
        else if (rc - rh < inner + MIN_BRIDGE - EPS)
          e.push(err("pcd", `Отверстия задевают ${hub ? "ступицу" : "центральное отверстие"}: внутренний край ${fmt(rc - rh)} мм, нужно не меньше ${fmt(inner + MIN_BRIDGE)} мм`));
        if (p.n >= 2) {
          const chord = 2 * rc * Math.sin(Math.PI / p.n);
          if (chord - p.holeD < MIN_BRIDGE - EPS)
            e.push(err("n", `Отверстия пересекаются: расстояние между центрами ${fmt(chord)} мм, а диаметр отверстия ${fmt(p.holeD)} мм (перемычка не меньше ${MIN_BRIDGE} мм)`));
        }
      }
    },
  };

  Object.assign(VALIDATORS, {
    link(p, e) {
      if (!["C", "D1", "d1", "D2", "d2", "T"].map((k) => checkNumber(e, "link", k, p[k])).every(Boolean)) return;
      if (p.C <= Math.abs(p.D1 - p.D2) / 2 + EPS) e.push(err("C", `Межосевое ${fmt(p.C)} мм слишком мало: одна проушина целиком внутри другой`));
      if (p.d1 > 0 && p.d1 > p.D1 - 2 * MIN_WALL + EPS) e.push(err("d1", `Отверстие ${fmt(p.d1)} мм оставляет стенку проушины 1 тоньше ${MIN_WALL} мм`));
      if (p.d2 > 0 && p.d2 > p.D2 - 2 * MIN_WALL + EPS) e.push(err("d2", `Отверстие ${fmt(p.d2)} мм оставляет стенку проушины 2 тоньше ${MIN_WALL} мм`));
      if (p.d1 > 0 && p.d2 > 0 && p.C < (p.d1 + p.d2) / 2 + MIN_BRIDGE - EPS) e.push(err("C", `Отверстия проушин пересекаются: перемычка меньше ${MIN_BRIDGE} мм`));
    },
    block(p, e) {
      if (!["W", "H", "hb", "T", "d"].map((k) => checkNumber(e, "block", k, p[k])).every(Boolean)) return;
      if (p.hb > p.H) e.push(err("hb", `Ось отверстия (${fmt(p.hb)} мм) выше плиты (H = ${fmt(p.H)} мм)`));
      else if (p.d > 0) {
        const room = Math.min(p.hb, p.H - p.hb, p.W / 2);
        if (p.d / 2 + MIN_WALL > room + EPS) e.push(err("d", `Отверстие ⌀${fmt(p.d)} не помещается: до ближайшего края ${fmt(room)} мм, нужна стенка ${MIN_WALL} мм`));
      }
    },
    piston(p, e) {
      if (!["D", "H", "t", "w", "pinZ"].map((k) => checkNumber(e, "piston", k, p[k])).every(Boolean)) return;
      if (p.w > p.D / 2 - MIN_WALL + EPS) e.push(err("w", `Юбка ${fmt(p.w)} мм слишком толстая для ⌀${fmt(p.D)}`));
      if (p.t > p.H - MIN_WALL + EPS) e.push(err("t", `Днище ${fmt(p.t)} мм не оставляет юбки при высоте ${fmt(p.H)} мм`));
      else if (p.pinZ > p.H - p.t - EPS) e.push(err("pinZ", `Ось пальца (${fmt(p.pinZ)} мм) должна быть ниже днища (${fmt(p.H - p.t)} мм)`));
    },
    screw(p, e) {
      if (!["d", "P", "Lt", "D", "Lh", "dn", "Ln"].map((k) => checkNumber(e, "screw", k, p[k])).every(Boolean)) return;
      if (p.d / 2 - THREAD_DEPTH * p.P < MIN_WALL) e.push(err("P", `Шаг ${fmt(p.P)} мм слишком велик для ⌀${fmt(p.d)}: впадины резьбы доходят до оси`));
      if (p.Lt < p.P - EPS) e.push(err("Lt", `Длина резьбы меньше одного шага (${fmt(p.P)} мм)`));
      else if (p.Lt / p.P > 400) e.push(err("Lt", "Не больше 400 витков резьбы"));
      if (p.D <= p.d + EPS) e.push(err("D", `Головка (⌀${fmt(p.D)}) должна быть шире резьбы (⌀${fmt(p.d)})`));
      if (p.dn >= p.D - EPS) e.push(err("dn", `Шейка (⌀${fmt(p.dn)}) должна быть уже головки (⌀${fmt(p.D)})`));
    },
  });

  const isExtrude = (type) => Boolean(TYPES[type] && TYPES[type].extrude);

  /** Профиль винта (r, z): условная резьба зубьями, головка, шейка. */
  function screwSketch(p) {
    const R = p.d / 2, r = R - THREAD_DEPTH * p.P;
    const n = Math.floor(p.Lt / p.P + 1e-9);
    const pts = [[0, 0], [r, 0]];
    for (let k = 0; k < n; k++) pts.push([R, k * p.P + p.P / 2], [r, (k + 1) * p.P]);
    if (p.Lt - n * p.P > 1e-9) pts.push([r, p.Lt]);
    const zh = p.Lt + p.Lh, zn = zh + p.Ln;
    pts.push([p.D / 2, p.Lt], [p.D / 2, zh], [p.dn / 2, zh], [p.dn / 2, zn], [0, zn]);
    return pts;
  }

  /** Контур плоской детали в плоскости XY: { kind: "stadium", r1, r2, C } или { kind: "rect", x0, y0, x1, y1 }. */
  function outlineOf(part) {
    const p = part.params;
    if (part.type === "link") return { kind: "stadium", r1: p.D1 / 2, r2: p.D2 / 2, C: p.C };
    return { kind: "rect", x0: -p.W / 2, y0: -p.hb, x1: p.W / 2, y1: p.H - p.hb };
  }

  /** Площадь выпуклой оболочки двух окружностей (r1 в 0, r2 в (C, 0)). */
  function stadiumArea(r1, r2, C) {
    const b = Math.asin((r1 - r2) / C);
    return r1 * r1 * (Math.PI / 2 + b) + r2 * r2 * (Math.PI / 2 - b) + (r1 + r2) * C * Math.cos(b);
  }

  /** Ошибки параметров детали: [{ field, message }]. Пустой массив — параметры корректны. */
  function validateParams(type, params) {
    if (!TYPES[type]) return [err("type", `Неизвестный тип детали «${type}»`)];
    if (!params || typeof params !== "object") return [err("params", "Нет параметров детали")];
    const e = [];
    VALIDATORS[type](params, e);
    return e;
  }

  function validatePart(part) {
    const e = [];
    if (!part || typeof part !== "object") return [err("part", "Деталь должна быть объектом")];
    if (typeof part.id !== "string" || !part.id) e.push(err("id", "У детали нет id"));
    e.push(...validateParams(part.type, part.params));
    const pl = part.placement || {};
    for (const k of ["x", "y", "z"]) if (!num(pl[k])) e.push(err(`placement.${k}`, `Положение ${k.toUpperCase()}: нужно конечное число`));
    const r = pl.rotation || {};
    for (const k of ["x", "y", "z"]) if (!num(r[k])) e.push(err(`rotation.${k}`, `Поворот вокруг ${k.toUpperCase()}: нужно конечное число`));
    if (!MATERIALS[part.material]) e.push(err("material", `Неизвестный материал «${part.material}»`));
    return e;
  }

  function validateProject(project) {
    const errors = [];
    if (!project || typeof project !== "object") return [{ partId: null, field: "project", message: "Проект должен быть объектом" }];
    if (project.format !== FORMAT) errors.push({ partId: null, field: "format", message: `Ожидался формат «${FORMAT}»` });
    if (project.schemaVersion !== SCHEMA_VERSION) errors.push({ partId: null, field: "schemaVersion", message: `Поддерживается версия схемы ${SCHEMA_VERSION}` });
    if (project.units !== "mm") errors.push({ partId: null, field: "units", message: "Единицы проекта — только мм" });
    if (!Array.isArray(project.parts)) {
      errors.push({ partId: null, field: "parts", message: "Нет списка деталей" });
      return errors;
    }
    const ids = new Set();
    for (const part of project.parts) {
      for (const e of validatePart(part)) errors.push({ partId: part && part.id, ...e });
      if (part && ids.has(part.id)) errors.push({ partId: part.id, field: "id", message: `Повторяющийся id «${part.id}»` });
      if (part) ids.add(part.id);
    }
    if (BS.mechAssembly) errors.push(...BS.mechAssembly.validate(project));
    return errors;
  }

  // ------------------------------------------------------------------ дерево фич

  /** Профиль вала из ступеней: от оси по левому торцу, вдоль ступеней, назад к оси. */
  function shaftSketch(steps) {
    const pts = [[0, 0]];
    let z = 0;
    steps.forEach((s, i) => {
      const r = s.d / 2;
      if (i === 0) pts.push([r, 0]);
      else if (Math.abs(r - steps[i - 1].d / 2) > EPS) pts.push([r, z]);
      z += s.L;
      const next = steps[i + 1];
      if (!next || Math.abs(next.d / 2 - r) > EPS) pts.push([r, z]);
    });
    pts.push([0, z]);
    return pts;
  }

  /** Дерево фич детали (параметрическое, ещё не вычисленное). */
  function features(part) {
    const p = part.params;
    switch (part.type) {
      case "bushing": {
        const r = p.d / 2, R = p.D / 2;
        const f = [
          { id: "sketch", kind: "sketch", label: "Эскиз профиля (RZ)", profile: [[r, 0], [R, 0], [R, p.L], [r, p.L]] },
        ];
        if (p.c > 0) f.push({ id: "chamferOuter", kind: "chamfer", label: `Фаска наружная ${fmt(p.c)}×45°`, sketch: "sketch", vertices: [1, 2], size: p.c });
        if (p.ci > 0) f.push({ id: "chamferInner", kind: "chamfer", label: `Фаска внутренняя ${fmt(p.ci)}×45°`, sketch: "sketch", vertices: [0, 3], size: p.ci });
        f.push({ id: "revolve", kind: "revolve", label: "Вращение 360° вокруг Z", sketch: "sketch", angle: 360 });
        return f;
      }
      case "shaft": {
        const prof = shaftSketch(p.steps);
        const f = [{ id: "sketch", kind: "sketch", label: `Эскиз профиля: ${p.steps.length} ступ.`, profile: prof }];
        if (p.c1 > 0) f.push({ id: "chamferStart", kind: "chamfer", label: `Фаска левого торца ${fmt(p.c1)}×45°`, sketch: "sketch", vertices: [1], size: p.c1 });
        if (p.c2 > 0) f.push({ id: "chamferEnd", kind: "chamfer", label: `Фаска правого торца ${fmt(p.c2)}×45°`, sketch: "sketch", vertices: [prof.length - 2], size: p.c2 });
        f.push({ id: "revolve", kind: "revolve", label: "Вращение 360° вокруг Z", sketch: "sketch", angle: 360 });
        return f;
      }
      case "flange": {
        const rb = p.d / 2, R = p.D / 2;
        const hub = p.hubD > 0 && p.hubH > 0;
        const prof = hub
          ? [[rb, 0], [R, 0], [R, p.T], [p.hubD / 2, p.T], [p.hubD / 2, p.T + p.hubH], [rb, p.T + p.hubH]]
          : [[rb, 0], [R, 0], [R, p.T], [rb, p.T]];
        const f = [
          { id: "sketch", kind: "sketch", label: hub ? "Эскиз: диск со ступицей" : "Эскиз: диск", profile: prof },
          { id: "revolve", kind: "revolve", label: "Вращение 360° вокруг Z", sketch: "sketch", angle: 360 },
        ];
        if (p.n > 0) f.push({ id: "holes", kind: "hole", label: `Отверстия ${p.n}×⌀${fmt(p.holeD)} на ⌀${fmt(p.pcd)}`, d: p.holeD, z0: 0, z1: p.T, through: true, pattern: { kind: "polar", n: p.n, pcd: p.pcd, startAngle: 0 } });
        return f;
      }
      case "piston": {
        const R = p.D / 2, ri = R - p.w, zi = p.H - p.t;
        return [
          { id: "sketch", kind: "sketch", label: "Эскиз: днище и юбка", profile: [[0, zi], [ri, zi], [ri, 0], [R, 0], [R, p.H], [0, p.H]] },
          { id: "revolve", kind: "revolve", label: "Вращение 360° вокруг Z", sketch: "sketch", angle: 360 },
        ];
      }
      case "screw":
        return [
          { id: "sketch", kind: "sketch", label: `Эскиз: резьба P${fmt(p.P)} (условно), головка, шейка`, profile: screwSketch(p) },
          { id: "revolve", kind: "revolve", label: "Вращение 360° вокруг Z", sketch: "sketch", angle: 360 },
        ];
      case "link":
      case "block": {
        const o = outlineOf(part);
        const f = [
          { id: "sketch", kind: "sketch", label: o.kind === "stadium" ? `Эскиз: две проушины, C = ${fmt(p.C)}` : `Эскиз: плита ${fmt(p.W)}×${fmt(p.H)}`, outline: o },
          { id: "extrude", kind: "extrude", label: `Выдавливание на ${fmt(p.T)} вдоль Z`, sketch: "sketch", height: p.T },
        ];
        const holes = part.type === "link"
          ? [[0, p.d1], [p.C, p.d2]].filter(([, d]) => d > 0).map(([x, d]) => ({ x, y: 0, d }))
          : (p.d > 0 ? [{ x: 0, y: 0, d: p.d }] : []);
        if (holes.length) f.push({ id: "holes", kind: "hole", label: holes.map((h) => `⌀${fmt(h.d)}`).join(" и ") + " сквозное", z0: 0, z1: p.T, through: true, points: holes });
        return f;
      }
      default:
        throw new Error(`Неизвестный тип детали «${part.type}»`);
    }
  }

  /** Фаски 45° на вершинах замкнутой полилинии (все одновременно, индексы исходного эскиза). */
  function applyChamfers(profile, chamfers) {
    const size = new Map();
    for (const c of chamfers) for (const i of c.vertices) size.set(i, c.size);
    const out = [];
    const n = profile.length;
    for (let i = 0; i < n; i++) {
      const c = size.get(i);
      const P = profile[i];
      if (!c) { out.push([P[0], P[1]]); continue; }
      const A = profile[(i - 1 + n) % n];
      const B = profile[(i + 1) % n];
      const toward = (Q) => {
        const dx = Q[0] - P[0], dy = Q[1] - P[1];
        const len = Math.hypot(dx, dy);
        return [P[0] + (dx / len) * c, P[1] + (dy / len) * c];
      };
      out.push(toward(A), toward(B));
    }
    return out;
  }

  /** Вычислить фичи: итоговый профиль тела вращения и список отверстий (локальные координаты). */
  function evaluate(part) {
    const f = features(part);
    const sketch = f.find((x) => x.kind === "sketch");
    const holes = [];
    if (sketch.outline) {
      // плоская деталь: контур + выдавливание; profile = null (не тело вращения)
      const ex = f.find((x) => x.kind === "extrude");
      for (const h of f.filter((x) => x.kind === "hole")) for (const q of h.points) holes.push({ x: q.x, y: q.y, d: q.d, z0: h.z0, z1: h.z1 });
      return { features: f, profile: null, extrude: { outline: sketch.outline, height: ex.height }, holes };
    }
    const chamfers = f.filter((x) => x.kind === "chamfer");
    const profile = applyChamfers(sketch.profile, chamfers);
    for (const h of f.filter((x) => x.kind === "hole")) {
      const { n, pcd, startAngle } = h.pattern;
      for (let i = 0; i < n; i++) {
        const a = ((startAngle || 0) * Math.PI) / 180 + (2 * Math.PI * i) / n;
        holes.push({ x: (pcd / 2) * Math.cos(a), y: (pcd / 2) * Math.sin(a), d: h.d, z0: h.z0, z1: h.z1 });
      }
    }
    return { features: f, profile, holes };
  }

  // ------------------------------------------------------------------ расчёты

  /** Площадь и статический момент профиля (формула Гаусса) → объём по Паппу–Гульдину. */
  function profileVolume(profile) {
    let A = 0, Sr = 0;
    for (let i = 0; i < profile.length; i++) {
      const [r1, z1] = profile[i];
      const [r2, z2] = profile[(i + 1) % profile.length];
      const cr = r1 * z2 - r2 * z1;
      A += cr;
      Sr += (r1 + r2) * cr;
    }
    A /= 2;
    Sr /= 6; // ∫∫ r dA
    return Math.abs(2 * Math.PI * Sr);
  }

  /** Объём из параметров по формулам (мм³) — независимо от профиля и сетки. */
  function analyticVolume(part) {
    const p = part.params;
    const ring = (c, rc) => 2 * Math.PI * (c * c / 2) * rc; // треугольник фаски, вращённый вокруг оси (Папп)
    switch (part.type) {
      case "bushing": {
        const R = p.D / 2, r = p.d / 2;
        return Math.PI * (R * R - r * r) * p.L - 2 * ring(p.c, R - p.c / 3) - 2 * ring(p.ci, r + p.ci / 3);
      }
      case "shaft": {
        let v = 0;
        for (const s of p.steps) v += (Math.PI * s.d * s.d / 4) * s.L;
        const r1 = p.steps[0].d / 2, r2 = p.steps[p.steps.length - 1].d / 2;
        return v - ring(p.c1, r1 - p.c1 / 3) - ring(p.c2, r2 - p.c2 / 3);
      }
      case "flange": {
        const hub = p.hubD > 0 && p.hubH > 0;
        let v = (Math.PI / 4) * (p.D * p.D - p.d * p.d) * p.T;
        if (hub) v += (Math.PI / 4) * (p.hubD * p.hubD - p.d * p.d) * p.hubH;
        v -= p.n * (Math.PI / 4) * p.holeD * p.holeD * p.T;
        return v;
      }
      case "piston": {
        const R = p.D / 2, ri = R - p.w;
        return Math.PI * (R * R * p.H - ri * ri * (p.H - p.t));
      }
      case "screw": // условная резьба: объём тела вращения по профилю (Папп), головка и шейка — цилиндры
        return profileVolume(screwSketch(p));
      case "link": {
        const hole = (d) => (Math.PI / 4) * d * d;
        return (stadiumArea(p.D1 / 2, p.D2 / 2, p.C) - hole(p.d1) - hole(p.d2)) * p.T;
      }
      case "block":
        return (p.W * p.H - (Math.PI / 4) * p.d * p.d) * p.T;
      default:
        return NaN;
    }
  }

  function density(part) {
    return (MATERIALS[part.material] || MATERIALS.steel).density;
  }

  /** Масса, кг, по объёму в мм³. */
  const massKg = (volumeMm3, rho) => volumeMm3 * 1e-9 * rho;

  // ------------------------------------------------------------------ положение

  const DEG = Math.PI / 180;
  /** Матрица поворота 3×3 (строки) для Эйлера XYZ как в THREE: M = Rx·Ry·Rz. */
  function rotationMatrix(rot) {
    const a = (rot && rot.x || 0) * DEG, b = (rot && rot.y || 0) * DEG, c = (rot && rot.z || 0) * DEG;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
    return [
      [cb * cc, -cb * sc, sb],
      [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
      [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
    ];
  }

  function transformPoint(placement, p) {
    const M = rotationMatrix(placement.rotation);
    return [0, 1, 2].map((i) => M[i][0] * p[0] + M[i][1] * p[1] + M[i][2] * p[2] + [placement.x, placement.y, placement.z][i]);
  }

  /** Точный габарит детали в мировых координатах: огибающая окружностей вершин профиля. */
  function worldBounds(part) {
    const ev = evaluate(part);
    const pl = part.placement;
    const M = rotationMatrix(pl.rotation);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    if (ev.extrude) {
      // контур плоской детали: окружности проушин (оболочка двух окружностей имеет тот же габарит) или углы плиты
      const o = ev.extrude.outline, T = ev.extrude.height;
      const circles = o.kind === "stadium" ? [[0, 0, o.r1], [o.C, 0, o.r2]] : [[o.x0, o.y0, 0], [o.x1, o.y0, 0], [o.x1, o.y1, 0], [o.x0, o.y1, 0]];
      for (const [x, y, r] of circles) for (const z of [0, T]) {
        for (let i = 0; i < 3; i++) {
          const c = M[i][0] * x + M[i][1] * y + M[i][2] * z + [pl.x, pl.y, pl.z][i];
          const ext = r * Math.hypot(M[i][0], M[i][1]);
          min[i] = Math.min(min[i], c - ext);
          max[i] = Math.max(max[i], c + ext);
        }
      }
      return { min, max, size: [0, 1, 2].map((i) => max[i] - min[i]) };
    }
    for (const [r, z] of ev.profile) {
      for (let i = 0; i < 3; i++) {
        const c = M[i][2] * z + [pl.x, pl.y, pl.z][i];
        const ext = r * Math.hypot(M[i][0], M[i][1]);
        min[i] = Math.min(min[i], c - ext);
        max[i] = Math.max(max[i], c + ext);
      }
    }
    return { min, max, size: [0, 1, 2].map((i) => max[i] - min[i]) };
  }

  // ------------------------------------------------------------------ проект

  function createProject(name = "Новый проект") {
    return { format: FORMAT, schemaVersion: SCHEMA_VERSION, units: "mm", name, parts: [], assemblies: [] };
  }

  function nextId(project) {
    let max = 0;
    for (const p of project.parts) {
      const m = /^p(\d+)$/.exec(p.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `p${max + 1}`;
  }

  function createPart(project, type, opts = {}) {
    const t = TYPES[type];
    if (!t) throw new Error(`Неизвестный тип детали «${type}»`);
    const count = project.parts.filter((p) => p.type === type).length + 1;
    return {
      id: opts.id || nextId(project),
      type,
      name: opts.name || `${t.label} ${count}`,
      params: opts.params ? JSON.parse(JSON.stringify(opts.params)) : defaultParams(type),
      placement: {
        x: 0, y: 0, z: 0,
        ...(opts.placement || {}),
        rotation: { x: 0, y: 0, z: 0, ...((opts.placement && opts.placement.rotation) || {}) },
      },
      material: opts.material || "steel",
    };
  }

  /** Демонстрационный проект: втулка, вал (лежит вдоль X), фланец. */
  function createDemoProject() {
    const pr = createProject("Демо: втулка, вал, фланец");
    pr.parts.push(createPart(pr, "bushing", { name: "Втулка 40×25×30", material: "bronze", placement: { x: -120, y: 0, z: 0 } }));
    pr.parts.push(createPart(pr, "shaft", { name: "Вал ступенчатый", placement: { x: -90, y: 120, z: 25, rotation: { x: 0, y: 90, z: 0 } } }));
    pr.parts.push(createPart(pr, "flange", { name: "Фланец ⌀140", material: "cast_iron", placement: { x: 80, y: 0, z: 0 } }));
    return pr;
  }

  /** Привести загруженные данные к проекту; ошибки — по деталям. */
  function normalizeProject(data) {
    if (!data || typeof data !== "object") throw new Error("Файл не содержит проект BuildSense (машиностроение)");
    if (data.format !== FORMAT) throw new Error(`Это не проект деталей: ожидался format «${FORMAT}», получено «${data.format}»`);
    if (!SUPPORTED_SCHEMAS.includes(data.schemaVersion)) throw new Error(`Версия схемы ${data.schemaVersion} не поддерживается (поддерживаются ${SUPPORTED_SCHEMAS.join(", ")})`);
    if (data.units !== "mm") throw new Error("Поддерживаются только миллиметры (units: \"mm\")");
    const pr = createProject(typeof data.name === "string" ? data.name : "Проект");
    const notes = [];
    const seen = new Set();
    for (const raw of Array.isArray(data.parts) ? data.parts : []) {
      if (!raw || typeof raw !== "object") throw new Error("В списке деталей есть пустая или повреждённая запись — файл не открыт");
      let id = raw.id;
      if (id !== undefined && seen.has(id)) {
        id = nextId(pr);
        notes.push(`Повторяющийся id детали «${raw.id}»: «${raw.name || raw.type}» получила новый id ${id}`);
      }
      const part = createPart(pr, raw.type, { id, name: raw.name, params: raw.params, placement: raw.placement, material: raw.material });
      seen.add(part.id);
      pr.parts.push(part);
    }
    if (BS.mechAssembly && Array.isArray(data.assemblies)) {
      const r = BS.mechAssembly.normalize(data.assemblies, pr);
      pr.assemblies = r.assemblies;
      notes.push(...r.notes);
    }
    if (BS.mechKinematics && Array.isArray(data.mechanisms)) {
      const r = BS.mechKinematics.normalize(data.mechanisms, pr);
      if (r.mechanisms.length) pr.mechanisms = r.mechanisms;
      notes.push(...r.notes);
    }
    if (typeof data.demo === "string") pr.demo = data.demo; // какой демонстрационный проект открыт (для «восстановить исходный»)
    return { project: pr, errors: validateProject(pr), notes };
  }

  // ------------------------------------------------------------------ экспорт для FreeCAD/Blender

  function exportForCad(project) {
    const errors = validateProject(project);
    if (errors.length) throw new Error(`Проект содержит ошибки: ${errors[0].message}`);
    const A = BS.mechAssembly;
    // сборки пересчитываются на копии: в экспорт попадают положения, соответствующие сопряжениям и текущим размерам,
    // даже если вызывающий забыл вызвать решатель (иначе в FreeCAD уехали бы устаревшие координаты)
    if (A && Array.isArray(project.assemblies) && project.assemblies.length) {
      project = JSON.parse(JSON.stringify(project));
      A.solveAll(project);
    }
    const asms = A && Array.isArray(project.assemblies) ? project.assemblies : [];
    const out = {
      format: EXPORT_FORMAT,
      schemaVersion: asms.length ? EXPORT_VERSION_ASSEMBLY : EXPORT_VERSION_PARTS,
      units: "mm",
      name: project.name,
      generator: `BuildSense ${BS.version || ""}`.trim(),
      note: "Источник истины — params. profile/holes — вычисленные фичи в локальной системе детали (ось вращения Z).",
      parts: project.parts.map((part) => {
        const ev = evaluate(part);
        const vol = analyticVolume(part);
        const rho = density(part);
        const b = worldBounds(part);
        return {
          id: part.id,
          name: part.name,
          type: part.type,
          params: JSON.parse(JSON.stringify(part.params)),
          material: part.material,
          materialLabel: MATERIALS[part.material].label,
          density: rho,
          placement: JSON.parse(JSON.stringify(part.placement)),
          features: ev.features,
          solid: ev.extrude ? { extrude: ev.extrude, holes: ev.holes } : { revolve: { axis: "Z", profile: ev.profile }, holes: ev.holes },
          analytic: { volume: vol, mass: massKg(vol, rho), bboxMin: b.min, bboxMax: b.max },
        };
      }),
    };
    if (asms.length) {
      // положения деталей уже решены (part.placement); сопряжения и статусы — для справки и проверки в FreeCAD
      out.assemblies = asms.map((asm) => {
        const r = A.solve(JSON.parse(JSON.stringify(project)), asm, { apply: false });
        return {
          id: asm.id,
          name: asm.name,
          ok: r.ok,
          components: asm.components.map((c) => ({ id: c.id, partId: c.partId, fixed: c.fixed, status: r.components[c.id].status, note: r.components[c.id].text })),
          mates: asm.mates.map((m) => ({ ...JSON.parse(JSON.stringify(m)), label: A.mateLabel(project, asm, m), status: r.mates[m.id].status, note: r.mates[m.id].text })),
          messages: r.messages.map((x) => ({ severity: x.severity, text: x.text })),
        };
      });
    }
    const K = BS.mechKinematics;
    if (K && Array.isArray(project.mechanisms) && project.mechanisms.length) {
      // описание механизмов — для справки; положения деталей в parts — исходные (угол 0°), без кадров симуляции
      out.schemaVersion = EXPORT_VERSION_ASSEMBLY;
      out.mechanisms = project.mechanisms.map((m) => {
        const c = K.check(project, m);
        return { ...JSON.parse(JSON.stringify(m)), ok: c.ok, errors: c.errors, notes: c.notes };
      });
    }
    return out;
  }

  BS.mechModel = {
    FORMAT, SCHEMA_VERSION, SUPPORTED_SCHEMAS, EXPORT_FORMAT, EXPORT_VERSION_PARTS, EXPORT_VERSION_ASSEMBLY, MIN_WALL, MIN_BRIDGE, MATERIALS, TYPES,
    defaultParams, paramDef, fieldLabel, validateParams, validatePart, validateProject,
    features, applyChamfers, evaluate, shaftSketch, screwSketch, outlineOf, stadiumArea, isExtrude, THREAD_DEPTH, profileVolume, analyticVolume, density, massKg,
    rotationMatrix, transformPoint, worldBounds,
    createProject, createPart, createDemoProject, nextId, normalizeProject, exportForCad,
  };
})(globalThis.BuildSense);
