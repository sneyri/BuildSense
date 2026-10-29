// BuildSense · Машиностроение — сборки: компоненты и сопряжения (без DOM и Three.js, тестируется в Node).
//
// project.assemblies = [{ id, name, components: [...], mates: [...] }]
// Компонент: { id, partId, fixed } — ссылка на деталь проекта (деталь остаётся независимой и редактируемой;
//   у неё свои params и материал). Деталь входит не больше чем в одну сборку.
// Сопряжение: { id, type, a: { comp, ref }, b: { comp, ref }, mode, orient, offset, suppressed }
//   coaxial  — оси деталей на одной прямой; ref = "axis"; orient: "auto" | "same" | "opposite";
//   planar   — плоские грани в одной плоскости; mode: "contact" (встык, нормали навстречу) | "align" (заподлицо);
//   distance — то же, что planar, но с осевым смещением offset (мм) между гранями вдоль нормали грани A.
//   Закрепление — свойство компонента fixed.
//
// Привязки детали выводятся из её профиля (все детали — тела вращения вокруг локальной оси Z):
//   ось "axis" и плоские грани, перпендикулярные оси, со стабильными id: end0, end1 (торцы), step1… (уступы
//   вала между ступенями), disk (верх диска фланца со ступицей). Если после изменения размеров грань исчезла
//   (например, ступени вала стали одного диаметра), сопряжение помечается «грань не найдена», а не решается.
//
// Решатель конструктивный: от закреплённых компонентов к остальным. Для компонента, связанного с уже
// известными, сначала находится направление оси (соосность и/или грани), затем перенос вдоль свободного
// направления. Положение записывается в part.placement — поэтому сцена, STL и экспорт работают как раньше.
// Недоопределённый компонент сохраняет текущее положение по свободным направлениям, и это сообщается явно.
// Сопряжение, которое не выполняется при найденном положении, — конфликт; успех не изображается.
(function (BS) {
  "use strict";
  const M = BS.mechModel;

  const TOL_LEN = 1e-4; // мм
  const TOL_DIR = 1e-7; // |sin| угла между осями
  const MIN_INTERFERENCE = 1e-3; // мм³

  const MATE_TYPES = {
    coaxial: { label: "Совместить оси", short: "Соосность" },
    planar: { label: "Совместить плоские грани", short: "Грани" },
    distance: { label: "Осевое смещение", short: "Смещение" },
  };
  const STATUS_LABEL = {
    fixed: "закреплён", solved: "положение определено", partial: "недоопределён",
    free: "не связан с закреплёнными", conflict: "конфликт сопряжений", invalid: "деталь с ошибками",
  };

  const fmt = (v) => String(Math.round(v * 1000) / 1000).replace(".", ",");
  const r6 = (v) => { const x = Math.round(v * 1e6) / 1e6; return Object.is(x, -0) ? 0 : x; };
  const num = (v) => typeof v === "number" && Number.isFinite(v);

  // ------------------------------------------------------------------ векторы и повороты

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => mul(a, 1 / (len(a) || 1));
  const matVec = (R, v) => [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
  const matMul = (A, B) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]));

  /** Поворот (Родриг) на угол ang вокруг единичной оси k. */
  function axisAngle(k, ang) {
    const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    const [x, y, z] = k;
    return [
      [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
      [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
      [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ];
  }

  /** Наименьший поворот, переводящий единичный вектор a в b. */
  function rotateOnto(a, b) {
    const c = Math.max(-1, Math.min(1, dot(a, b)));
    const k = cross(a, b);
    if (len(k) < 1e-12) {
      if (c > 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      const p = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      return axisAngle(unit(cross(a, p)), Math.PI);
    }
    return axisAngle(unit(k), Math.acos(c));
  }

  /** Матрица (M = Rx·Ry·Rz, как M.rotationMatrix) → углы Эйлера XYZ, градусы. */
  function eulerXYZ(R) {
    const D = 180 / Math.PI;
    const b = Math.asin(Math.max(-1, Math.min(1, R[0][2])));
    if (Math.abs(R[0][2]) < 1 - 1e-9) return { x: r6(Math.atan2(-R[1][2], R[2][2]) * D), y: r6(b * D), z: r6(Math.atan2(-R[0][1], R[0][0]) * D) };
    return { x: r6(Math.atan2(R[2][1], R[1][1]) * D), y: r6(b * D), z: 0 };
  }

  const poseOf = (part) => ({ R: M.rotationMatrix(part.placement.rotation), t: [part.placement.x, part.placement.y, part.placement.z] });
  const axisOf = (pose) => ({ p: pose.t, d: matVec(pose.R, [0, 0, 1]) });

  // ------------------------------------------------------------------ привязки детали

  /** Плоские грани детали: { id, label, z, n (±1 вдоль оси), rIn, rOut } в локальной системе. */
  function faces(part) {
    const p = part.params;
    const out = [];
    const face = (id, label, z, n) => out.push({ id, label, z, n });
    if (part.type === "bushing") {
      face("end0", "Торец левый (z = 0)", 0, -1);
      face("end1", `Торец правый (z = ${fmt(p.L)})`, p.L, 1);
    } else if (part.type === "shaft") {
      let z = 0;
      face("end0", "Торец левый (z = 0)", 0, -1);
      p.steps.forEach((s, i) => {
        z += s.L;
        const next = p.steps[i + 1];
        if (next && Math.abs(next.d - s.d) > 1e-9) {
          face(`step${i + 1}`, `Уступ ${i + 1}|${i + 2}: ⌀${fmt(s.d)} → ⌀${fmt(next.d)} (z = ${fmt(z)})`, z, s.d > next.d ? 1 : -1);
        }
      });
      face("end1", `Торец правый (z = ${fmt(z)})`, z, 1);
    } else if (part.type === "flange") {
      const hub = p.hubD > 0 && p.hubH > 0;
      face("end0", "Низ диска (z = 0)", 0, -1);
      if (hub) face("disk", `Верх диска у ступицы (z = ${fmt(p.T)})`, p.T, 1);
      face("end1", hub ? `Торец ступицы (z = ${fmt(p.T + p.hubH)})` : `Верх диска (z = ${fmt(p.T)})`, hub ? p.T + p.hubH : p.T, 1);
    }
    // радиальная протяжённость грани — по горизонтальным рёбрам профиля (уже с фасками)
    const prof = M.evaluate(part).profile;
    for (const f of out) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < prof.length; i++) {
        const a = prof[i], b = prof[(i + 1) % prof.length];
        if (Math.abs(a[1] - f.z) < 1e-9 && Math.abs(b[1] - f.z) < 1e-9) {
          lo = Math.min(lo, a[0], b[0]);
          hi = Math.max(hi, a[0], b[0]);
        }
      }
      f.rIn = lo;
      f.rOut = hi;
    }
    return out.filter((f) => f.rOut > f.rIn + 1e-9);
  }

  function refLabel(part, ref) {
    if (ref === "axis") return "ось";
    const f = part && faces(part).find((x) => x.id === ref);
    return f ? f.label : `грань «${ref}»`;
  }

  // ------------------------------------------------------------------ данные

  function list(project) {
    if (!Array.isArray(project.assemblies)) project.assemblies = [];
    return project.assemblies;
  }

  const nextNum = (items, prefix) => {
    let n = 0;
    for (const x of items) { const m = new RegExp(`^${prefix}(\\d+)$`).exec(x.id); if (m) n = Math.max(n, Number(m[1])); }
    return `${prefix}${n + 1}`;
  };

  function createAssembly(project, name) {
    const asm = { id: nextNum(list(project), "A"), name: name || `Сборка ${list(project).length + 1}`, components: [], mates: [] };
    list(project).push(asm);
    return asm;
  }

  function assemblyOfPart(project, partId) {
    return list(project).find((a) => a.components.some((c) => c.partId === partId)) || null;
  }

  function componentOfPart(project, partId) {
    for (const a of list(project)) {
      const c = a.components.find((x) => x.partId === partId);
      if (c) return { asm: a, comp: c };
    }
    return null;
  }

  function addComponent(project, asm, partId, { fixed = false } = {}) {
    const part = project.parts.find((p) => p.id === partId);
    if (!part) throw new Error(`Деталь ${partId} не найдена`);
    const other = assemblyOfPart(project, partId);
    if (other) throw new Error(`«${part.name}» уже входит в сборку «${other.name}». Деталь может входить только в одну сборку`);
    const comp = { id: nextNum(asm.components, "c"), partId, fixed: Boolean(fixed) };
    asm.components.push(comp);
    return comp;
  }

  /** Убрать компонент и все его сопряжения. */
  function removeComponent(asm, compId) {
    asm.components = asm.components.filter((c) => c.id !== compId);
    asm.mates = asm.mates.filter((m) => m.a.comp !== compId && m.b.comp !== compId);
  }

  /** Деталь удалена из проекта — убрать её из сборок. */
  function removePart(project, partId) {
    for (const a of list(project)) for (const c of a.components.filter((x) => x.partId === partId)) removeComponent(a, c.id);
  }

  const partOf = (project, asm, compId) => {
    const c = asm.components.find((x) => x.id === compId);
    return c ? project.parts.find((p) => p.id === c.partId) || null : null;
  };

  function mateLabel(project, asm, m) {
    const pa = partOf(project, asm, m.a.comp), pb = partOf(project, asm, m.b.comp);
    const na = pa ? pa.name : m.a.comp, nb = pb ? pb.name : m.b.comp;
    if (m.type === "coaxial") return `Соосность: ${na} ↔ ${nb}`;
    const kind = m.mode === "align" ? "заподлицо" : "встык";
    if (m.type === "distance") return `Смещение ${fmt(m.offset)} мм (${kind}): ${na} ↔ ${nb}`;
    return `Грани ${kind}: ${na} ↔ ${nb}`;
  }

  // ------------------------------------------------------------------ проверка структуры и сопряжения

  /** Проверка сопряжения без решения: тип, компоненты, привязки, смещение. Возвращает текст ошибки или null. */
  function mateError(project, asm, m) {
    if (!m || typeof m !== "object") return "Сопряжение должно быть объектом";
    if (!MATE_TYPES[m.type]) return `Неизвестный тип сопряжения «${m.type}»`;
    if (!m.a || !m.b) return "У сопряжения должны быть две стороны (a и b)";
    if (m.a.comp === m.b.comp) return "Нельзя сопрягать компонент сам с собой";
    const pa = partOf(project, asm, m.a.comp), pb = partOf(project, asm, m.b.comp);
    if (!pa || !pb) return "Сопряжение ссылается на компонент, которого нет в сборке";
    if (m.type === "coaxial") {
      if (m.a.ref !== "axis" || m.b.ref !== "axis") return "Соосность задаётся только между осями деталей";
      if (!["auto", "same", "opposite"].includes(m.orient || "auto")) return "Направление осей: auto, same или opposite";
    } else {
      for (const [side, part] of [[m.a, pa], [m.b, pb]]) {
        if (side.ref === "axis") return `${MATE_TYPES[m.type].label}: нужна плоская грань, а не ось`;
        if (!faces(part).some((f) => f.id === side.ref)) return `У «${part.name}» нет плоской грани «${side.ref}»`;
      }
      if (!["contact", "align"].includes(m.mode)) return "Режим граней: contact (встык) или align (заподлицо)";
      if (!num(m.offset)) return "Смещение: нужно конечное число, мм";
      if (m.type === "planar" && Math.abs(m.offset) > 1e-12) return "У «грани встык/заподлицо» смещение 0; для зазора используйте «Осевое смещение»";
      if (m.type === "distance" && m.mode === "contact" && m.offset < 0) return `Смещение ${fmt(m.offset)} мм < 0: грани зашли бы друг в друга. Задайте зазор ≥ 0`;
    }
    const same = asm.mates.find((x) => x !== m && x.id !== m.id && x.type === m.type &&
      ((x.a.comp === m.a.comp && x.a.ref === m.a.ref && x.b.comp === m.b.comp && x.b.ref === m.b.ref) ||
       (x.a.comp === m.b.comp && x.a.ref === m.b.ref && x.b.comp === m.a.comp && x.b.ref === m.a.ref)));
    if (same) return `Такое сопряжение уже есть (${same.id})`;
    return null;
  }

  /** Ошибки структуры сборок проекта: [{ partId:null, field, message }]. */
  function validate(project) {
    const errors = [];
    const e = (message) => errors.push({ partId: null, field: "assemblies", message });
    if (project.assemblies === undefined) return errors;
    if (!Array.isArray(project.assemblies)) { e("assemblies: нужен список сборок"); return errors; }
    const used = new Map();
    const ids = new Set();
    for (const a of project.assemblies) {
      if (!a || typeof a.id !== "string" || !Array.isArray(a.components) || !Array.isArray(a.mates)) { e("Сборка: нужны id, components и mates"); continue; }
      if (ids.has(a.id)) e(`Повторяющийся id сборки «${a.id}»`);
      ids.add(a.id);
      const cids = new Set();
      for (const c of a.components) {
        if (!c || typeof c.id !== "string") { e(`${a.name}: компонент без id`); continue; }
        if (cids.has(c.id)) e(`${a.name}: повторяющийся id компонента «${c.id}»`);
        cids.add(c.id);
        if (!project.parts.some((p) => p.id === c.partId)) e(`${a.name}: компонент ${c.id} ссылается на отсутствующую деталь «${c.partId}»`);
        if (used.has(c.partId)) e(`Деталь «${c.partId}» входит в несколько сборок`);
        used.set(c.partId, a.id);
      }
      const mids = new Set();
      for (const m of a.mates) {
        if (m && mids.has(m.id)) e(`${a.name}: повторяющийся id сопряжения «${m.id}»`);
        if (m) mids.add(m.id);
        const parts = m && partOf(project, a, m.a && m.a.comp) && partOf(project, a, m.b && m.b.comp);
        if (!parts) { e(`${a.name}: сопряжение ${m && m.id} ссылается на отсутствующий компонент`); continue; }
        const msg = mateErrorStructural(project, a, m);
        if (msg) e(`${a.name}, ${m.id}: ${msg}`);
      }
    }
    return errors;
  }

  /** Как mateError, но без привязок к граням (грань может исчезнуть после изменения размеров — это не ошибка файла). */
  function mateErrorStructural(project, asm, m) {
    if (!MATE_TYPES[m.type]) return `Неизвестный тип сопряжения «${m.type}»`;
    if (m.a.comp === m.b.comp) return "Нельзя сопрягать компонент сам с собой";
    if (m.type !== "coaxial" && (!["contact", "align"].includes(m.mode) || !num(m.offset))) return "Нужны режим граней и смещение";
    return null;
  }

  /** Привести сборки из файла к модели. Компоненты отсутствующих деталей и их сопряжения убираются (с сообщением). */
  function normalize(raw, project) {
    const notes = [];
    const out = [];
    for (const a of Array.isArray(raw) ? raw : []) {
      if (!a || typeof a !== "object") continue;
      const asm = { id: String(a.id || nextNum(out, "A")), name: typeof a.name === "string" ? a.name : "Сборка", components: [], mates: [] };
      const known = new Set();
      for (const c of Array.isArray(a.components) ? a.components : []) {
        if (!c || !project.parts.some((p) => p.id === c.partId)) { notes.push(`${asm.name}: компонент ${c && c.id} без детали — убран`); continue; }
        if (out.some((x) => x.components.some((y) => y.partId === c.partId)) || asm.components.some((y) => y.partId === c.partId)) {
          notes.push(`${asm.name}: деталь ${c.partId} уже в сборке — повтор убран`);
          continue;
        }
        asm.components.push({ id: String(c.id), partId: c.partId, fixed: Boolean(c.fixed) });
        known.add(String(c.id));
      }
      for (const m of Array.isArray(a.mates) ? a.mates : []) {
        if (!m || !m.a || !m.b || !known.has(m.a.comp) || !known.has(m.b.comp)) { notes.push(`${asm.name}: сопряжение ${m && m.id} без компонента — убрано`); continue; }
        const mate = {
          id: String(m.id), type: m.type, a: { comp: m.a.comp, ref: String(m.a.ref) }, b: { comp: m.b.comp, ref: String(m.b.ref) },
          suppressed: Boolean(m.suppressed),
        };
        if (m.type === "coaxial") mate.orient = ["same", "opposite"].includes(m.orient) ? m.orient : "auto";
        else { mate.mode = m.mode === "align" ? "align" : "contact"; mate.offset = num(m.offset) ? m.offset : 0; }
        asm.mates.push(mate);
      }
      out.push(asm);
    }
    return { assemblies: out, notes };
  }

  // ------------------------------------------------------------------ невязки

  function faceWorld(part, pose, ref) {
    const f = faces(part).find((x) => x.id === ref);
    if (!f) return null;
    const ax = axisOf(pose);
    return { f, q: add(pose.t, mul(ax.d, f.z)), n: mul(ax.d, f.n) };
  }

  /** Невязка сопряжения при заданных положениях: { ok, text }. */
  function residual(project, asm, m, poses) {
    const pa = partOf(project, asm, m.a.comp), pb = partOf(project, asm, m.b.comp);
    const A = poses.get(m.a.comp), B = poses.get(m.b.comp);
    if (m.type === "coaxial") {
      const a = axisOf(A), b = axisOf(B);
      const s = len(cross(a.d, b.d));
      const dist = len(cross(sub(b.p, a.p), a.d));
      if (s > TOL_DIR) return { ok: false, text: `оси не параллельны (угол ${fmt(Math.asin(Math.min(1, s)) * 180 / Math.PI)}°)` };
      if (dist > TOL_LEN) return { ok: false, text: `оси параллельны, но разнесены на ${fmt(dist)} мм` };
      const c = dot(a.d, b.d);
      if (m.orient === "same" && c < 0) return { ok: false, text: "оси направлены навстречу, а задано «в одну сторону»" };
      if (m.orient === "opposite" && c > 0) return { ok: false, text: "оси направлены в одну сторону, а задано «навстречу»" };
      return { ok: true };
    }
    const fa = faceWorld(pa, A, m.a.ref), fb = faceWorld(pb, B, m.b.ref);
    if (!fa || !fb) return { ok: false, text: "грань не найдена" };
    const c = dot(fa.n, fb.n);
    const want = m.mode === "align" ? 1 : -1;
    if (Math.abs(c - want) > 1e-9) return { ok: false, text: m.mode === "align" ? "грани не смотрят в одну сторону" : "грани не обращены друг к другу" };
    const gap = dot(fa.n, sub(fb.q, fa.q));
    const off = m.offset || 0;
    if (Math.abs(gap - off) > TOL_LEN) return { ok: false, text: `расстояние между гранями ${fmt(gap)} мм, нужно ${fmt(off)} мм` };
    return { ok: true };
  }

  // ------------------------------------------------------------------ решатель

  /**
   * Решить сборку. apply = true — записать найденные положения в part.placement.
   * Возвращает { ok, components: {id: {status, text}}, mates: {id: {status, text}}, messages, interference, dof }.
   * Статусы компонента: fixed | solved | partial | free | conflict | invalid; сопряжения: ok | conflict |
   * broken (грань не найдена / ошибка) | unsolved (компоненты не связаны с закреплёнными) | suppressed |
   * nocontact (грани встык: плоскости совмещены, но кольца граней не перекрываются — касания нет).
   */
  function solve(project, asm, { apply = true } = {}) {
    const res = { ok: true, components: {}, mates: {}, messages: [], interference: [], contacts: [] };
    const msg = (severity, text, extra = {}) => res.messages.push({ severity, text, ...extra });
    const comps = asm.components;
    const part = (cid) => partOf(project, asm, cid);
    const poses = new Map();
    const partialBy = new Map(); // компонент → почему недоопределён
    const used = new Set();

    for (const c of comps) {
      const p = part(c.id);
      if (!p || M.validateParams(p.type, p.params).length) {
        res.components[c.id] = { status: "invalid", text: "у детали ошибки в размерах — в сборке не решается" };
      }
    }
    const valid = (cid) => !res.components[cid] || res.components[cid].status !== "invalid";

    const active = [];
    for (const m of asm.mates) {
      if (m.suppressed) { res.mates[m.id] = { status: "suppressed", text: "подавлено" }; continue; }
      if (!valid(m.a.comp) || !valid(m.b.comp)) { res.mates[m.id] = { status: "broken", text: "деталь с ошибками в размерах" }; continue; }
      const e = mateError(project, asm, m);
      if (e) { res.mates[m.id] = { status: "broken", text: e }; continue; }
      active.push(m);
    }

    for (const c of comps) {
      if (c.fixed && valid(c.id)) { poses.set(c.id, poseOf(part(c.id))); res.components[c.id] = { status: "fixed", text: STATUS_LABEL.fixed }; }
    }
    if (!comps.some((c) => c.fixed)) {
      msg("warning", "В сборке нет закреплённого компонента: положение сборки ничем не задано. Закрепите один компонент (обычно вал или корпус).");
    }

    const other = (m, cid) => (m.a.comp === cid ? m.b.comp : m.a.comp);
    const linksTo = (cid) => active.filter((m) => (m.a.comp === cid || m.b.comp === cid) && poses.has(other(m, cid)));
    const score = (cid) => {
      const ms = linksTo(cid);
      if (!ms.length) return 0;
      const full = ms.filter((m) => !partialBy.has(other(m, cid)));
      const has = (arr, f) => arr.some(f);
      const coax = (m) => m.type === "coaxial", axial = (m) => m.type !== "coaxial";
      if (has(full, coax) && has(full, axial)) return 4;
      if (has(ms, coax) && has(ms, axial)) return 3;
      return 1;
    };

    for (;;) {
      let best = null, bestScore = 0;
      for (const c of comps) {
        if (poses.has(c.id) || !valid(c.id)) continue;
        const s = score(c.id);
        if (s > bestScore) { best = c; bestScore = s; }
      }
      if (!best) break;
      solveComponent(best);
    }

    function solveComponent(c) {
      const p = part(c.id);
      const cur = poseOf(p);
      const ms = linksTo(c.id);
      const coax = ms.filter((m) => m.type === "coaxial");
      const axial = ms.filter((m) => m.type !== "coaxial");
      const conflicts = [];

      // 1. направление оси компонента
      let dir = null;
      let lineP = null, lineD = null;
      if (coax.length) {
        const K = poses.get(other(coax[0], c.id));
        const ax = axisOf(K);
        lineP = ax.p;
        lineD = ax.d;
      }
      let viaFace = null;
      if (axial.length) {
        const m = axial[0];
        const meA = m.a.comp === c.id;
        const mine = meA ? m.a : m.b, theirs = meA ? m.b : m.a;
        const fo = faceWorld(part(theirs.comp), poses.get(theirs.comp), theirs.ref);
        const fm = faces(p).find((f) => f.id === mine.ref);
        const sign = m.mode === "align" ? 1 : -1;
        viaFace = mul(fo.n, sign * fm.n); // n_мой = sign·n_их, n_мой = fm.n·d → d = sign·fm.n·n_их
        dir = viaFace;
      }
      if (coax.length) {
        const m = coax[0];
        const orient = m.orient || "auto";
        if (dir) {
          if (len(cross(dir, lineD)) > TOL_DIR) {
            conflicts.push({ m: axial[0], text: "грань не перпендикулярна общей оси: оси и грани задают разные направления" });
            dir = null;
          } else if (orient !== "auto") {
            const want = orient === "same" ? 1 : -1;
            if (Math.sign(dot(dir, lineD)) !== want) {
              conflicts.push({ m: axial[0], text: `при заданном направлении осей («${orient === "same" ? "в одну сторону" : "навстречу"}») эти грани не могут встать ${axial[0].mode === "align" ? "заподлицо" : "встык"}` });
              dir = mul(lineD, want);
            }
          }
        }
        if (!dir) {
          const curD = axisOf(cur).d;
          if (orient === "same") dir = lineD;
          else if (orient === "opposite") dir = mul(lineD, -1);
          else dir = dot(curD, lineD) >= 0 ? lineD : mul(lineD, -1);
        }
      }
      const curD = axisOf(cur).d;
      const R = matMul(rotateOnto(curD, unit(dir)), cur.R);

      // 2. перенос
      let t;
      let dof = null;
      const pose = (tt) => ({ R, t: tt });
      const solveLinear = (base, u, m) => {
        const trial = new Map(poses);
        const f = (s) => {
          trial.set(c.id, pose(add(base, mul(u, s))));
          const fa = faceWorld(part(m.a.comp), trial.get(m.a.comp), m.a.ref), fb = faceWorld(part(m.b.comp), trial.get(m.b.comp), m.b.ref);
          return dot(fa.n, sub(fb.q, fa.q)) - (m.offset || 0);
        };
        const f0 = f(0), f1 = f(1);
        if (Math.abs(f1 - f0) < 1e-12) return Math.abs(f0) < TOL_LEN ? base : null;
        return add(base, mul(u, -f0 / (f1 - f0)));
      };
      if (coax.length) {
        const base = add(lineP, mul(lineD, dot(sub(cur.t, lineP), lineD)));
        if (axial.length && !conflicts.length) {
          t = solveLinear(base, lineD, axial[0]);
          if (!t) { conflicts.push({ m: axial[0], text: "грань параллельна оси — осевое положение ею не задаётся" }); t = base; }
        } else {
          t = base;
          if (!axial.length) dof = "свободно смещение вдоль оси (добавьте сопряжение граней или осевое смещение)";
        }
      } else {
        const fo = faceWorld(part(other(axial[0], c.id)), poses.get(other(axial[0], c.id)), (axial[0].a.comp === c.id ? axial[0].b : axial[0].a).ref);
        t = solveLinear(cur.t, fo.n, axial[0]) || cur.t;
        dof = "свободны смещение в плоскости грани и поворот вокруг её нормали (добавьте соосность)";
      }
      t = t.map(r6);
      poses.set(c.id, pose(t));
      for (const m of [coax[0], axial[0]].filter(Boolean)) used.add(m.id);

      // 3. остальные сопряжения с известными — проверка (избыточные, но согласные — допустимы)
      for (const m of ms) {
        if (conflicts.some((x) => x.m === m)) continue;
        const r = residual(project, asm, m, poses);
        used.add(m.id);
        if (!r.ok) conflicts.push({ m, text: r.text });
      }
      for (const x of conflicts) res.mates[x.m.id] = { status: "conflict", text: x.text };
      const parents = ms.map((m) => other(m, c.id)).filter((id) => partialBy.has(id));
      if (conflicts.length) {
        res.components[c.id] = { status: "conflict", text: `сопряжения противоречат друг другу: ${conflicts.map((x) => x.text).join("; ")}` };
      } else if (dof || parents.length) {
        const why = dof || `зависит от недоопределённого компонента «${part(parents[0]).name}»`;
        partialBy.set(c.id, why);
        res.components[c.id] = { status: "partial", text: why };
      } else {
        res.components[c.id] = { status: "solved", text: "положение определено сопряжениями; поворот вокруг собственной оси не ограничен" };
      }
    }

    // сопряжения между уже известными компонентами, не использованные при решении (например, между двумя
    // закреплёнными) — только проверка
    for (const m of active) {
      if (res.mates[m.id]) continue;
      if (!poses.has(m.a.comp) || !poses.has(m.b.comp)) { res.mates[m.id] = { status: "unsolved", text: "компоненты не связаны с закреплёнными — не решено" }; continue; }
      if (used.has(m.id)) { res.mates[m.id] = { status: "ok", text: "выполнено" }; continue; }
      const r = residual(project, asm, m, poses);
      res.mates[m.id] = r.ok ? { status: "ok", text: "выполнено" } : { status: "conflict", text: r.text };
      if (!r.ok) {
        for (const cid of [m.a.comp, m.b.comp]) {
          const st = res.components[cid];
          if (st && st.status !== "fixed") res.components[cid] = { status: "conflict", text: `сопряжение не выполняется: ${r.text}` };
        }
        if (comps.find((x) => x.id === m.a.comp).fixed && comps.find((x) => x.id === m.b.comp).fixed) {
          msg("error", `${mateLabel(project, asm, m)}: оба компонента закреплены, и сопряжение не выполняется (${r.text}). Снимите закрепление с одного из них.`, { mateIds: [m.id] });
        }
      }
    }
    for (const c of comps) {
      if (!res.components[c.id]) res.components[c.id] = { status: "free", text: asm.mates.some((m) => m.a.comp === c.id || m.b.comp === c.id) ? "сопряжения не связывают его с закреплённым компонентом" : "нет сопряжений" };
    }

    // итоговые сообщения
    for (const c of comps) {
      const st = res.components[c.id];
      const name = part(c.id) ? part(c.id).name : c.id;
      if (st.status === "conflict") msg("error", `${name}: ${st.text}`, { compIds: [c.id] });
      else if (st.status === "partial") msg("warning", `${name}: положение определено не полностью — ${st.text}`, { compIds: [c.id] });
      else if (st.status === "free" && comps.some((x) => x.fixed)) msg("warning", `${name}: ${st.text}; положение не задано`, { compIds: [c.id] });
      else if (st.status === "invalid") msg("error", `${name}: ${st.text}`, { compIds: [c.id] });
    }
    for (const m of asm.mates) {
      const st = res.mates[m.id];
      if (st && st.status === "broken") msg("error", `${mateLabel(project, asm, m)}: ${st.text}`, { mateIds: [m.id] });
    }
    res.ok = !res.messages.some((x) => x.severity === "error");

    if (apply) {
      for (const c of comps) {
        const st = res.components[c.id].status;
        if (!["solved", "partial", "conflict"].includes(st)) continue;
        const ps = poses.get(c.id);
        const p = part(c.id);
        p.placement = { x: r6(ps.t[0]), y: r6(ps.t[1]), z: r6(ps.t[2]), rotation: eulerXYZ(ps.R) };
      }
    }
    checkContacts(project, asm, res, poses);
    checkInterference(project, asm, res, poses);
    return res;
  }

  // ------------------------------------------------------------------ контакт и пересечения

  const collinear = (a, b) => len(cross(a.d, b.d)) < TOL_DIR && len(cross(sub(b.p, a.p), a.d)) < TOL_LEN;

  /** Грани «встык» с нулевым смещением: плоскости совпали, но касаются ли кольца граней на самом деле? */
  function checkContacts(project, asm, res, poses) {
    for (const m of asm.mates) {
      if (m.type === "coaxial" || m.mode !== "contact" || Math.abs(m.offset || 0) > 1e-12) continue;
      if (!res.mates[m.id] || res.mates[m.id].status !== "ok") continue;
      const A = poses.get(m.a.comp), B = poses.get(m.b.comp);
      const pa = partOf(project, asm, m.a.comp), pb = partOf(project, asm, m.b.comp);
      const fa = faces(pa).find((f) => f.id === m.a.ref), fb = faces(pb).find((f) => f.id === m.b.ref);
      if (!collinear(axisOf(A), axisOf(B))) {
        res.contacts.push({ mateId: m.id, checked: false });
        res.messages.push({ severity: "info", text: `${mateLabel(project, asm, m)}: плоскости совмещены; касание колец граней не проверено (оси деталей не совпадают)`, mateIds: [m.id] });
        continue;
      }
      const lo = Math.max(fa.rIn, fb.rIn), hi = Math.min(fa.rOut, fb.rOut);
      res.contacts.push({ mateId: m.id, checked: true, width: Math.max(0, hi - lo) });
      if (hi - lo <= 1e-6) {
        res.mates[m.id] = { status: "nocontact", text: "плоскости совмещены, но грани не касаются — контакта нет" };
        res.messages.push({ severity: "warning", text: `${mateLabel(project, asm, m)}: плоскости совмещены, но кольца граней (r ${fmt(fa.rIn)}…${fmt(fa.rOut)} и ${fmt(fb.rIn)}…${fmt(fb.rOut)} мм) не перекрываются — контакта нет`, mateIds: [m.id] });
      }
    }
  }

  /** Радиальные отрезки сечения профиля (r, s) плоскостью s = const. */
  function sectionAt(poly, s) {
    const xs = [];
    for (let i = 0; i < poly.length; i++) {
      const [r1, s1] = poly[i], [r2, s2] = poly[(i + 1) % poly.length];
      if ((s1 <= s && s2 > s) || (s2 <= s && s1 > s)) xs.push(r1 + ((s - s1) / (s2 - s1)) * (r2 - r1));
    }
    xs.sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
    return out;
  }

  /** Объём общей части двух соосных тел вращения (без отверстий фланца), мм³. */
  function overlapVolume(pa, pb) {
    const ss = [...new Set([...pa, ...pb].map((q) => q[1]))].sort((a, b) => a - b);
    const lo = Math.max(Math.min(...pa.map((q) => q[1])), Math.min(...pb.map((q) => q[1])));
    const hi = Math.min(Math.max(...pa.map((q) => q[1])), Math.max(...pb.map((q) => q[1])));
    if (hi - lo <= 1e-9) return 0;
    let v = 0;
    const N = 24;
    for (let k = 0; k + 1 < ss.length; k++) {
      const s0 = Math.max(ss[k], lo), s1 = Math.min(ss[k + 1], hi);
      if (s1 - s0 <= 1e-12) continue;
      const h = (s1 - s0) / N;
      for (let j = 0; j < N; j++) {
        const s = s0 + (j + 0.5) * h;
        const A = sectionAt(pa, s), B = sectionAt(pb, s);
        for (const [a0, a1] of A) for (const [b0, b1] of B) {
          const r0 = Math.max(a0, b0), r1 = Math.min(a1, b1);
          if (r1 > r0) v += Math.PI * (r1 * r1 - r0 * r0) * h;
        }
      }
    }
    return v;
  }

  function checkInterference(project, asm, res, poses) {
    const ids = asm.components.map((c) => c.id).filter((id) => poses.has(id) && ["fixed", "solved", "partial", "conflict"].includes(res.components[id].status));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const pa = partOf(project, asm, ids[i]), pb = partOf(project, asm, ids[j]);
      const A = poses.get(ids[i]), B = poses.get(ids[j]);
      const ba = M.worldBounds({ ...pa, placement: placementOf(A) }), bb = M.worldBounds({ ...pb, placement: placementOf(B) });
      const boxes = [0, 1, 2].every((k) => ba.min[k] < bb.max[k] - TOL_LEN && bb.min[k] < ba.max[k] - TOL_LEN);
      if (!boxes) continue;
      const axA = axisOf(A), axB = axisOf(B);
      if (!collinear(axA, axB)) {
        res.interference.push({ a: ids[i], b: ids[j], checked: false });
        res.messages.push({ severity: "info", text: `${pa.name} и ${pb.name}: габариты пересекаются; точная проверка для несоосных деталей не выполняется`, compIds: [ids[i], ids[j]] });
        continue;
      }
      const map = (part, pose) => {
        const ax = axisOf(pose);
        const s0 = dot(sub(pose.t, axA.p), axA.d), sg = Math.sign(dot(ax.d, axA.d));
        return M.evaluate(part).profile.map(([r, z]) => [r, s0 + sg * z]);
      };
      const v = overlapVolume(map(pa, A), map(pb, B));
      if (v > MIN_INTERFERENCE) {
        res.interference.push({ a: ids[i], b: ids[j], checked: true, volume: v });
        res.messages.push({ severity: "error", text: `${pa.name} и ${pb.name} пересекаются: общий объём ≈ ${fmt(v)} мм³ (тела вращения, без учёта отверстий). Это не соединение — проверьте размеры и сопряжения.`, compIds: [ids[i], ids[j]] });
        res.ok = false;
      } else {
        res.interference.push({ a: ids[i], b: ids[j], checked: true, volume: 0 });
      }
    }
  }

  const placementOf = (pose) => ({ x: pose.t[0], y: pose.t[1], z: pose.t[2], rotation: eulerXYZ(pose.R) });

  /** Решить все сборки проекта (с записью положений). Map: id сборки → результат. */
  function solveAll(project) {
    const out = new Map();
    for (const a of list(project)) out.set(a.id, solve(project, a));
    return out;
  }

  /**
   * Добавить сопряжение с проверкой: структура, затем пробное решение. Если новое сопряжение оказалось
   * в конфликте или с ошибкой — сборка не меняется, бросается Error с понятным текстом.
   */
  function addMate(project, asm, spec) {
    const m = {
      id: nextNum(asm.mates, "m"), type: spec.type,
      a: { comp: spec.a.comp, ref: spec.type === "coaxial" ? "axis" : spec.a.ref },
      b: { comp: spec.b.comp, ref: spec.type === "coaxial" ? "axis" : spec.b.ref },
      suppressed: false,
    };
    if (m.type === "coaxial") m.orient = spec.orient || "auto";
    else { m.mode = spec.mode || "contact"; m.offset = m.type === "distance" ? Number(spec.offset) : 0; }
    const e = mateError(project, asm, m);
    if (e) throw new Error(e);
    const trial = JSON.parse(JSON.stringify(project));
    const tasm = list(trial).find((x) => x.id === asm.id);
    tasm.mates.push(m);
    const r = solve(trial, tasm);
    const st = r.mates[m.id];
    if (st.status === "conflict" || st.status === "broken") throw new Error(`Сопряжение не добавлено: ${st.text}. Оно противоречит уже заданным — подавите или удалите мешающее сопряжение либо снимите закрепление`);
    asm.mates.push(m);
    return { mate: m, result: r };
  }

  /** Учебная сборка: вал (закреплён) с буртиком, фланец встык к буртику, втулка со смещением от уступа. */
  function createDemoAssemblyProject() {
    const pr = M.createProject("Учебная сборка: вал, фланец, втулка");
    const shaft = M.createPart(pr, "shaft", {
      name: "Вал с буртиком",
      params: { c1: 1, c2: 1, steps: [{ d: 30, L: 40 }, { d: 50, L: 10 }, { d: 40, L: 50 }, { d: 25, L: 40 }] },
      placement: { x: -70, y: 0, z: 80, rotation: { x: 0, y: 90, z: 0 } },
    });
    pr.parts.push(shaft);
    const flange = M.createPart(pr, "flange", { name: "Фланец ⌀140", material: "cast_iron", placement: { x: 0, y: -160, z: 0 } });
    pr.parts.push(flange);
    const bush = M.createPart(pr, "bushing", { name: "Втулка 40×25×30", material: "bronze", placement: { x: 120, y: -160, z: 0 } });
    pr.parts.push(bush);
    const asm = createAssembly(pr, "Узел вала");
    const cs = addComponent(pr, asm, shaft.id, { fixed: true });
    const cf = addComponent(pr, asm, flange.id);
    const cb = addComponent(pr, asm, bush.id);
    addMate(pr, asm, { type: "coaxial", a: { comp: cs.id }, b: { comp: cf.id } });
    addMate(pr, asm, { type: "planar", mode: "contact", a: { comp: cs.id, ref: "step2" }, b: { comp: cf.id, ref: "end0" } });
    addMate(pr, asm, { type: "coaxial", a: { comp: cs.id }, b: { comp: cb.id } });
    addMate(pr, asm, { type: "distance", mode: "contact", offset: 5, a: { comp: cs.id, ref: "step3" }, b: { comp: cb.id, ref: "end0" } });
    solveAll(pr);
    return pr;
  }

  BS.mechAssembly = {
    MATE_TYPES, STATUS_LABEL, faces, refLabel, list, createAssembly, assemblyOfPart, componentOfPart, addComponent,
    removeComponent, removePart, partOf, mateLabel, mateError, validate, normalize, residual, solve, solveAll, addMate,
    overlapVolume, sectionAt, eulerXYZ, rotateOnto, createDemoAssemblyProject,
  };
})(globalThis.BuildSense);
