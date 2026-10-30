// BuildSense · Машиностроение — «Соединить детали» мышью: классификация выбранной поверхности, варианты соединения,
// предпросмотр и применение. Без DOM и Three.js — тестируется в Node.
//
// Всё строится на существующей модели сборок (mechAssembly.js): выбор двух поверхностей превращается в РЕАЛЬНОЕ
// сопряжение coaxial / planar / distance, его проверяет и решает тот же решатель. Предпросмотр считается на копии проекта
// и данные не меняет; применение атомарно (при ошибке проект остаётся прежним).
//
//   classifyHit(part, localPoint, localNormal)  → { kind: "plane"|"cylinder"|"hole"|"unsupported", ... }
//   proposals(selA, selB)                      → { choices: [...], reason }
//   plan(project, selA, selB, choiceId, opts)  → { ok, error, placements, moverId, work, info }
//   apply(project, selA, selB, choiceId, opts) → { ok, error, mateId }
//   moveRule(project, partId)                  → { mode: "free"|"anchor"|"mated", reason, actions }
//   toggleFixed(project, partId), duplicatePart(project, partId)
(function (BS) {
  "use strict";
  const M = BS.mechModel;
  const A = BS.mechAssembly;
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const fmt = (v) => String(Math.round(v * 100) / 100).replace(".", ",");
  const EPS = 1e-6;

  // ------------------------------------------------------------------ что за поверхность

  /** Простое название вариантов — без инженерного жаргона; техническое имя — в `tech`. */
  const CHOICES = {
    axes: { id: "axes", label: "Совместить оси", sub: "детали встанут на одну линию, как вал в отверстии", tech: "Соосность", type: "coaxial" },
    press: { id: "press", label: "Прижать поверхности", sub: "торец к торцу, без зазора", tech: "Грани встык", type: "planar", mode: "contact" },
    flush: { id: "flush", label: "Выровнять вровень", sub: "поверхности лягут в одну плоскость", tech: "Грани заподлицо", type: "planar", mode: "align" },
    gap: { id: "gap", label: "Оставить зазор", sub: "торцы на заданном расстоянии", tech: "Осевое смещение", type: "distance", mode: "contact" },
  };

  /**
   * Классифицировать попадание луча в деталь. Координаты — в системе детали (ось вращения Z).
   * Плоская грань определяется по реальной геометрии (нормаль вдоль оси и совпадение z с гранью из A.faces),
   * цилиндр — по радиальной нормали и радиусу из профиля, отверстие под болт — по списку отверстий фланца.
   */
  function classifyHit(part, p, n) {
    const faces = A.faces(part);
    const ev = M.evaluate(part);
    const nz = n[2];
    const r = Math.hypot(p[0], p[1]);
    if (Math.abs(nz) > 0.98) {
      const face = faces.filter((f) => Math.abs(f.z - p[2]) < 0.02 && Math.sign(f.n) === Math.sign(nz)).sort((a, b) => Math.abs(a.z - p[2]) - Math.abs(b.z - p[2]))[0];
      if (!face) {
        return { kind: "unsupported", reason: "Эта плоскость не годится для соединения (например, дно отверстия или фаска). Выберите торец или уступ детали." };
      }
      return { kind: "plane", partId: part.id, ref: face.id, label: face.label, z: face.z, n: face.n, rIn: face.rIn, rOut: face.rOut, point: [0, 0, face.z], plain: plainFaceName(part, face) };
    }
    if (Math.abs(nz) < 0.2) {
      for (const h of ev.holes) {
        if (Math.abs(Math.hypot(p[0] - h.x, p[1] - h.y) - h.d / 2) < 0.1) {
          return { kind: "hole", reason: "Это отверстие под болт: соединение по таким отверстиям пока не поддерживается. Выберите центральное отверстие, наружную поверхность или торец." };
        }
      }
      const sketch = ev.features.find((f) => f.kind === "sketch").profile;
      const edges = [];
      for (let i = 0; i < sketch.length; i++) {
        const a = sketch[i], b = sketch[(i + 1) % sketch.length];
        if (Math.abs(a[0] - b[0]) < EPS && a[0] > EPS) edges.push({ r: a[0], z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) });
      }
      const score = (e) => Math.abs(e.r - r) + (p[2] >= e.z0 - 0.5 && p[2] <= e.z1 + 0.5 ? 0 : 1000);
      const best = edges.sort((a, b) => score(a) - score(b))[0];
      if (best && Math.abs(best.r - r) < Math.max(0.15, best.r * 0.02) && p[2] >= best.z0 - 0.5 && p[2] <= best.z1 + 0.5) {
        const outward = (n[0] * p[0] + n[1] * p[1]) / (r || 1) > 0;
        const d = fmt(best.r * 2);
        return { kind: "cylinder", partId: part.id, ref: "axis", r: best.r, z0: best.z0, z1: best.z1, outward, label: outward ? `Цилиндр ⌀${d} (снаружи)` : `Отверстие ⌀${d}`, plain: outward ? `Цилиндр ⌀${d}` : `Отверстие ⌀${d}`, point: [0, 0, p[2]] };
      }
    }
    return { kind: "unsupported", reason: "Эта поверхность (фаска или скругление) не годится для соединения. Выберите торец, цилиндр или отверстие." };
  }

  function plainFaceName(part, face) {
    const l = face.label.toLowerCase();
    if (l.includes("уступ")) return "Уступ " + face.label.replace(/^Уступ\s*/, "").split(" (")[0];
    if (l.includes("торец ступицы")) return "Торец ступицы";
    if (l.includes("торец левый")) return "Левый торец";
    if (l.includes("торец правый")) return "Правый торец";
    if (l.includes("низ диска")) return "Низ диска";
    if (l.includes("верх диска")) return "Верх диска";
    return face.label.split(" (")[0];
  }

  // ------------------------------------------------------------------ какие соединения возможны

  /** Варианты по двум выбранным элементам. Невозможного не предлагает — объясняет, что выбрать иначе. */
  function proposals(a, b) {
    if (!a || !b) return { choices: [], reason: "Выберите поверхности обеих деталей." };
    if (a.partId === b.partId) return { choices: [], reason: "Это одна и та же деталь. Выберите поверхность второй детали." };
    if (a.kind === "cylinder" && b.kind === "cylinder") {
      const ok = (a.outward && !b.outward) || (!a.outward && b.outward);
      const choices = [CHOICES.axes];
      return { choices, note: ok ? null : "Обе поверхности одного типа (обе наружные или обе отверстия) — оси всё равно можно совместить, но детали не будут «вставлены» друг в друга.", reason: null };
    }
    if (a.kind === "plane" && b.kind === "plane") return { choices: [CHOICES.press, CHOICES.gap, CHOICES.flush], reason: null };
    return { choices: [], reason: "Эти поверхности нельзя соединить выбранным способом. Выберите две цилиндрические поверхности (или отверстия) либо два плоских торца." };
  }

  // ------------------------------------------------------------------ план соединения на копии проекта

  function ensureComponent(project, asm, partId, fixed) {
    let cp = A.componentOfPart(project, partId);
    if (cp) return cp;
    const comp = A.addComponent(project, asm, partId, { fixed });
    return { asm, comp };
  }

  /**
   * Выполнить соединение на переданном проекте (создаёт сборку/компоненты при необходимости, добавляет сопряжение, решает).
   * Бросает Error с понятным текстом. Возвращает { mateId, moverId, anchorId, asmId }.
   */
  function run(project, selA, selB, choiceId, opts) {
    const ch = CHOICES[choiceId];
    if (!ch) throw new Error("Неизвестный способ соединения");
    const prop = proposals(selA, selB);
    if (!prop.choices.some((c) => c.id === choiceId)) throw new Error(prop.reason || "Этот способ не подходит для выбранных поверхностей");
    const pA = project.parts.find((p) => p.id === selA.partId), pB = project.parts.find((p) => p.id === selB.partId);
    if (!pA || !pB) throw new Error("Деталь не найдена");
    let ca = A.componentOfPart(project, pA.id), cb = A.componentOfPart(project, pB.id);
    if (ca && cb && ca.asm.id !== cb.asm.id) throw new Error(`«${pA.name}» и «${pB.name}» входят в разные сборки («${ca.asm.name}» и «${cb.asm.name}»). Деталь может быть только в одной сборке — исключите одну из них из своей сборки.`);
    if (ca && cb && ca.comp.fixed && cb.comp.fixed) throw new Error(`Обе детали закреплены на месте. Снимите закрепление с одной из них (клавиша K), чтобы она могла двигаться к другой.`);
    const asm = (ca && ca.asm) || (cb && cb.asm) || A.createAssembly(project);
    // кто едет: закреплённая стоит, незакреплённая подъезжает; если ни одна не закреплена — стоит первая выбранная
    let anchor = pA, mover = pB;
    if (cb && cb.comp.fixed) { anchor = pB; mover = pA; }
    const hasFixed = asm.components.some((c) => c.fixed);
    ca = ensureComponent(project, asm, pA.id, anchor.id === pA.id && !hasFixed);
    cb = ensureComponent(project, asm, pB.id, anchor.id === pB.id && !hasFixed);
    if (!asm.components.some((c) => c.fixed)) { (anchor.id === pA.id ? ca : cb).comp.fixed = true; }
    const compOf = (pid) => (pid === pA.id ? ca.comp : cb.comp);
    const spec = { type: ch.type, a: { comp: ca.comp.id, ref: selA.ref }, b: { comp: cb.comp.id, ref: selB.ref } };
    if (ch.type === "coaxial") spec.orient = opts && opts.flip ? "opposite" : "auto";
    else { spec.mode = ch.mode; if (ch.type === "distance") spec.offset = Number(opts && opts.gap != null ? opts.gap : 5); }
    const { mate, result } = A.addMate(project, asm, spec);
    A.solveAll(project);
    return { mateId: mate.id, moverId: mover.id, anchorId: anchor.id, asmId: asm.id, result, compOf };
  }

  /** Расстояние между двумя выбранными элементами вдоль оси, мм (для подсказки «между поверхностями»). */
  function distanceBetween(project, selA, selB) {
    const pA = project.parts.find((p) => p.id === selA.partId), pB = project.parts.find((p) => p.id === selB.partId);
    if (!pA || !pB) return null;
    const axis = (p) => { const o = M.transformPoint(p.placement, [0, 0, 0]), q = M.transformPoint(p.placement, [0, 0, 1]); return { p: o, d: [q[0] - o[0], q[1] - o[1], q[2] - o[2]] }; };
    const ax = axis(pA), bx = axis(pB);
    if (selA.kind === "plane" && selB.kind === "plane") {
      const fa = A.faces(pA).find((f) => f.id === selA.ref), fb = A.faces(pB).find((f) => f.id === selB.ref);
      if (!fa || !fb) return null;
      const qa = M.transformPoint(pA.placement, [0, 0, fa.z]), qb = M.transformPoint(pB.placement, [0, 0, fb.z]);
      return Math.abs((qb[0] - qa[0]) * ax.d[0] + (qb[1] - qa[1]) * ax.d[1] + (qb[2] - qa[2]) * ax.d[2]);
    }
    if (selA.kind === "cylinder" && selB.kind === "cylinder") {
      const w = [bx.p[0] - ax.p[0], bx.p[1] - ax.p[1], bx.p[2] - ax.p[2]];
      const c = [w[1] * ax.d[2] - w[2] * ax.d[1], w[2] * ax.d[0] - w[0] * ax.d[2], w[0] * ax.d[1] - w[1] * ax.d[0]];
      return Math.hypot(...c);
    }
    return null;
  }

  /** Предпросмотр: данные проекта не меняются. */
  function plan(project, selA, selB, choiceId, opts = {}) {
    const work = plain(project);
    const before = distanceBetween(project, selA, selB);
    let r;
    try {
      r = run(work, selA, selB, choiceId, opts);
    } catch (e) {
      return { ok: false, error: friendly(e.message) };
    }
    const placements = {};
    for (const p of work.parts) {
      const o = project.parts.find((q) => q.id === p.id);
      if (JSON.stringify(o.placement) !== JSON.stringify(p.placement)) placements[p.id] = plain(p.placement);
    }
    const mover = work.parts.find((p) => p.id === r.moverId);
    const st = r.result && r.result.components[r.compOf(r.moverId).id];
    const messages = (r.result && r.result.messages || []).map((m) => m.text);
    const after = distanceBetween(work, selA, selB);
    const interference = (r.result && r.result.interference || []).filter((x) => x.volume > 1e-3);
    return {
      ok: true, work, placements, moverId: r.moverId, anchorId: r.anchorId, mateId: r.mateId,
      moverName: mover.name, status: st && st.status, messages, interference,
      info: { before, after, createsAssembly: !A.componentOfPart(project, selA.partId) && !A.componentOfPart(project, selB.partId) },
    };
  }

  /** Применить на реальном проекте атомарно: сначала пробный прогон, затем перенос результата. */
  function apply(project, selA, selB, choiceId, opts = {}) {
    const trial = plan(project, selA, selB, choiceId, opts);
    if (!trial.ok) return trial;
    // переносим результат в тот же объект проекта и те же объекты деталей (ссылки интерфейса остаются действительными)
    for (const w of trial.work.parts) { const p = project.parts.find((x) => x.id === w.id); if (p) p.placement = w.placement; }
    project.assemblies = trial.work.assemblies;
    return { ok: true, mateId: trial.mateId, moverId: trial.moverId, status: trial.status, messages: trial.messages, interference: trial.interference };
  }

  function friendly(msg) {
    if (/Сопряжение не добавлено/.test(msg)) return `${msg}`;
    return msg;
  }

  // ------------------------------------------------------------------ правила перемещения

  /**
   * Можно ли двигать деталь мышью.
   *  free   — свободна (вне сборки или без сопряжений);
   *  anchor — закреплена: двигать можно, поедет вся сборка;
   *  mated  — положение задано сопряжениями: мышью двигать нельзя (решатель вернул бы деталь на место).
   */
  function moveRule(project, partId) {
    const cp = A.componentOfPart(project, partId);
    const part = project.parts.find((p) => p.id === partId);
    if (!cp) return { mode: "free", reason: null, actions: [] };
    const asm = cp.asm;
    const hasMates = asm.mates.some((m) => !m.suppressed && (m.a.comp === cp.comp.id || m.b.comp === cp.comp.id));
    if (cp.comp.fixed) {
      const n = asm.components.length;
      return { mode: "anchor", reason: n > 1 ? `«${part.name}» закреплена: если её сдвинуть, вместе с ней поедет вся сборка «${asm.name}» (${n} дет.).` : null, actions: [] };
    }
    if (!hasMates) return { mode: "free", reason: null, actions: [] };
    return {
      mode: "mated",
      reason: `«${part.name}» соединена с другими деталями: её положение задают сопряжения сборки «${asm.name}». Если сдвинуть её мышью, правило нарушится.`,
      actions: [
        { id: "suppress", label: "Отключить соединения этой детали" },
        { id: "exclude", label: "Убрать из сборки" },
        { id: "move-anchor", label: "Двигать закреплённую деталь" },
      ],
    };
  }

  /** Выполнить действие из moveRule().actions на проекте. */
  function resolveLock(project, partId, actionId) {
    const cp = A.componentOfPart(project, partId);
    if (!cp) return false;
    if (actionId === "suppress") {
      for (const m of cp.asm.mates) if (m.a.comp === cp.comp.id || m.b.comp === cp.comp.id) m.suppressed = true;
      A.solveAll(project);
      return true;
    }
    if (actionId === "exclude") {
      A.removeComponent(cp.asm, cp.comp.id);
      A.solveAll(project);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ закрепление и дублирование

  /** Закрепить на месте / снять закрепление. Деталь вне сборки попадает в сборку закреплённым компонентом. */
  function toggleFixed(project, partId) {
    const part = project.parts.find((p) => p.id === partId);
    if (!part) throw new Error("Деталь не найдена");
    const cp = A.componentOfPart(project, partId);
    if (!cp) {
      const asm = A.list(project)[0] && !A.assemblyOfPart(project, partId) ? A.list(project)[0] : A.createAssembly(project);
      A.addComponent(project, asm, partId, { fixed: true });
      return { fixed: true, text: `«${part.name}» закреплена на месте.` };
    }
    cp.comp.fixed = !cp.comp.fixed;
    A.solveAll(project);
    return { fixed: cp.comp.fixed, text: cp.comp.fixed ? `«${part.name}» закреплена на месте.` : `Закрепление «${part.name}» снято.` };
  }

  /** Копия детали рядом (сдвиг по X на габарит + 10 мм), с новым id; в сборку не входит. */
  function duplicatePart(project, partId) {
    const src = project.parts.find((p) => p.id === partId);
    if (!src) throw new Error("Деталь не найдена");
    const b = M.worldBounds(src);
    const copy = M.createPart(project, src.type, { name: `${src.name} (копия)`, params: src.params, material: src.material, placement: { ...plain(src.placement), x: src.placement.x + b.size[0] + 10 } });
    project.parts.push(copy);
    return copy;
  }

  BS.mechConnect = { CHOICES, classifyHit, proposals, plan, apply, distanceBetween, moveRule, resolveLock, toggleFixed, duplicatePart };
})(globalThis.BuildSense);
