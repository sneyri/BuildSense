// BuildSense · Машиностроение — «взрывной вид»: расчёт направлений разлёта и плавная анимация (без DOM, тестируется в Node).
//
// computeExplode(project) → { offsets: Map partId → [dx, dy, dz] (полное смещение при степени 1), groups, center }
//   1. Детали группируются по общей оси (соосные): в группе детали раздвигаются ВДОЛЬ оси так, чтобы между
//      соседями остался зазор (вложенные детали — втулка в корпусе — выходят из корпуса целиком).
//      «Опора» группы — деталь у её середины — остаётся на месте, остальные расходятся в обе стороны.
//   2. Остальные группы и одиночные детали отлетают от центра конструкции радиально (направление — от центра
//      к центру группы; если они совпадают — детерминированный запасной вариант).
// Смещения вычисляются заново из исходных положений, поэтому повторный запуск ничего не накапливает.
// Проект НЕ меняется: смещения применяются только к показу (см. js/mech/mechViewer.js).
//
// createTween() — переход степени разборки k от текущего значения к цели с easing (easeInOutCubic),
// с паузой; время передаётся явно (мс).
(function (BS) {
  "use strict";
  const M = BS.mechModel;

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => mul(a, 1 / (len(a) || 1));

  function info(part) {
    const b = M.worldBounds(part);
    const R = M.rotationMatrix(part.placement.rotation);
    const d = [R[0][2], R[1][2], R[2][2]];
    const t = [part.placement.x, part.placement.y, part.placement.z];
    return { part, b, center: [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2), axis: { p: t, d }, volume: Math.abs(M.analyticVolume(part)) || 1 };
  }

  const collinear = (a, b, tolLen) => len(cross(a.d, b.d)) < 1e-4 && len(cross(sub(b.p, a.p), a.d)) < tolLen;

  /** Пределы габарита детали вдоль направления u (по 8 углам габарита). */
  function extent(x, u) {
    let lo = Infinity, hi = -Infinity;
    for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) {
      const c = [[x.b.min[0], x.b.max[0]][i], [x.b.min[1], x.b.max[1]][j], [x.b.min[2], x.b.max[2]][k]];
      const s = dot(c, u);
      lo = Math.min(lo, s); hi = Math.max(hi, s);
    }
    return [lo, hi];
  }

  /** Направления и величины разлёта (при степени 1). opts.anchors — id деталей-опор (закреплённые в сборке). */
  function computeExplode(project, opts = {}) {
    const parts = project.parts.filter((p) => !M.validateParams(p.type, p.params).length);
    const offsets = new Map();
    if (!parts.length) return { offsets, groups: [], center: [0, 0, 0], radius: 0 };
    const anchors = new Set(opts.anchors || []);
    if (!opts.anchors && BS.mechAssembly) for (const a of BS.mechAssembly.list(project)) for (const c of a.components) if (c.fixed) anchors.add(c.partId);
    const xs = parts.map(info);
    const min = [0, 1, 2].map((i) => Math.min(...xs.map((x) => x.b.min[i])));
    const max = [0, 1, 2].map((i) => Math.max(...xs.map((x) => x.b.max[i])));
    const center = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
    const radius = len(sub(max, min)) / 2 || 1;

    // 1. группы соосных деталей (жадно, в порядке проекта — детерминированно)
    const groups = [];
    for (const x of xs) {
      const g = groups.find((gr) => collinear(gr.axis, x.axis, Math.max(0.5, radius * 1e-3)));
      if (g) g.items.push(x); else groups.push({ axis: x.axis, items: [x] });
    }
    for (const g of groups) {
      g.volume = g.items.reduce((s, x) => s + x.volume, 0);
      g.center = mul(g.items.reduce((s, x) => add(s, mul(x.center, x.volume)), [0, 0, 0]), 1 / g.volume);
      for (const x of g.items) offsets.set(x.part.id, [0, 0, 0]);
    }

    // 2. вдоль оси внутри группы: соседи не перекрываются по оси, между ними зазор
    for (const g of groups) {
      if (g.items.length < 2) continue;
      const u = unit(g.axis.d);
      const items = g.items.map((x) => ({ x, ext: extent(x, u) })).sort((a, b) => (a.ext[0] + a.ext[1]) - (b.ext[0] + b.ext[1]));
      const span = Math.max(...items.map((i) => i.ext[1])) - Math.min(...items.map((i) => i.ext[0]));
      const gap = Math.max(15, 0.22 * span);
      // опора — деталь у середины группы: детали расходятся в обе стороны (так разборку лучше видно);
      // при равенстве — закреплённая в сборке, затем самая крупная
      const mid = (Math.min(...items.map((i) => i.ext[0])) + Math.max(...items.map((i) => i.ext[1]))) / 2;
      const score = (i) => Math.abs((i.ext[0] + i.ext[1]) / 2 - mid) - (anchors.has(i.x.part.id) ? 1e-3 * span : 0) - 1e-9 * i.x.volume;
      const ai = items.reduce((best, i, k) => (score(i) < score(items[best]) ? k : best), 0);
      const shift = new Array(items.length).fill(0);
      for (let k = ai + 1; k < items.length; k++) {
        const prevHi = items[k - 1].ext[1] + shift[k - 1];
        shift[k] = Math.max(shift[k - 1], prevHi + gap - items[k].ext[0]);
      }
      for (let k = ai - 1; k >= 0; k--) {
        const nextLo = items[k + 1].ext[0] + shift[k + 1];
        shift[k] = Math.min(shift[k + 1], nextLo - gap - items[k].ext[1]);
      }
      items.forEach((i, k) => offsets.set(i.x.part.id, mul(u, shift[k])));
      g.span = span;
    }

    // 3. группы целиком (кроме главной) и одиночные детали — от центра конструкции
    const main = groups.reduce((a, b) => (b.volume > a.volume ? b : a));
    const fallbacks = [[0, 0, 1], [1, 0, 0], [0, -1, 0], [-1, 0, 0], [0, 1, 0], [0, 0, -1]];
    groups.forEach((g, gi) => {
      if (g === main) return;
      let dir = sub(g.center, main.center);
      if (len(dir) < radius * 0.05) dir = sub(g.center, center);
      if (len(dir) < radius * 0.05) dir = fallbacks[gi % fallbacks.length];
      dir = unit(dir);
      // не вдоль оси главной группы — там уже разлёт; убираем эту составляющую, если остаётся что-то разумное
      const ua = unit(main.axis.d), perp = sub(dir, mul(ua, dot(dir, ua)));
      if (main.items.length > 1 && len(perp) > 0.3) dir = unit(perp);
      const size = Math.max(...g.items.map((x) => len(sub(x.b.max, x.b.min))));
      const mag = 0.45 * radius + 0.5 * size;
      for (const x of g.items) offsets.set(x.part.id, add(offsets.get(x.part.id), mul(dir, mag)));
    });
    return { offsets, groups: groups.map((g) => ({ parts: g.items.map((x) => x.part.id), axis: g.axis.d })), center, radius };
  }

  /** Смещения при степени k (k = 0 — собранное положение). */
  function offsetsAt(explode, k) {
    const out = new Map();
    for (const [id, v] of explode.offsets) out.set(id, mul(v, k));
    return out;
  }

  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  /** Плавный переход степени k: to(target, now), pause(now), resume(now), value(now), done. Длительность — duration мс. */
  function createTween({ duration = 900, value = 0 } = {}) {
    const s = { from: value, to: value, t0: 0, paused: false, pausedAt: 0, duration };
    const progress = (now) => (s.duration <= 0 ? 1 : Math.min(1, Math.max(0, ((s.paused ? s.pausedAt : now) - s.t0) / s.duration)));
    const val = (now) => s.from + (s.to - s.from) * easeInOutCubic(progress(now));
    return {
      to(target, now) { const v = val(now); s.from = v; s.to = target; s.t0 = now; s.paused = false; },
      set(v) { s.from = s.to = v; s.paused = false; },
      pause(now) { if (!s.paused) { s.paused = true; s.pausedAt = now; } },
      resume(now) { if (s.paused) { s.t0 += now - s.pausedAt; s.paused = false; } },
      value: val,
      isDone: (now) => progress(now) >= 1,
      get target() { return s.to; },
      get paused() { return s.paused; },
    };
  }

  BS.mechExplode = { computeExplode, offsetsAt, createTween, easeInOutCubic };
})(globalThis.BuildSense);
