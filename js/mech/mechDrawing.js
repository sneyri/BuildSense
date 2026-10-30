// BuildSense · Машиностроение — учебный чертёж детали (чёрно-белый, лист A3) на Canvas 2D.
// BS.mechDrawing.render(part, { project }) → HTMLCanvasElement (10 px на мм листа);
// BS.mechDrawing.toBlob(canvas) → Promise<Blob PNG>.
// Виды: полный разрез по оси (штриховка 45°) и вид слева (окружности, отверстия, осевые линии);
// размеры: диаметры, длины по ступеням, габарит, фаски, отверстия, окружность центров; основная надпись.
// Это учебное оформление «в духе» ЕСКД, а не нормоконтроль: допуски, шероховатость и посадки не рассчитываются.
(function (BS) {
  "use strict";
  const M = BS.mechModel;

  const PX = 10; // пикселей на мм листа
  const SHEET = { w: 420, h: 297 };
  const FRAME = { l: 20, t: 5, r: 5, b: 5 };
  const THICK = 0.6, THIN = 0.25;
  const TEXT = 3.5;
  const FONT = (h, extra = "") => `${extra} italic ${h}px "ISOCPEUR", "GOST type A", "Segoe UI", Arial, sans-serif`.trim();
  const SCALES = [0.05, 0.1, 0.2, 0.25, 0.4, 0.5, 1, 2, 2.5, 4, 5, 10];
  const fmt = (v) => String(Math.round(v * 100) / 100).replace(".", ",");
  const scaleLabel = (s) => (s >= 1 ? `${fmt(s)}:1` : `1:${fmt(1 / s)}`);

  // ------------------------------------------------------------------ примитивы

  class Pen {
    constructor(ctx) { this.c = ctx; }
    line(x1, y1, x2, y2, w = THIN, dash = null) {
      const c = this.c;
      c.save();
      c.lineWidth = w;
      c.setLineDash(dash || []);
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.restore();
    }
    centerLine(x1, y1, x2, y2) { this.line(x1, y1, x2, y2, THIN, [12, 2, 2, 2]); }
    arrow(x, y, dx, dy) { // острие в (x, y), направление от острия назад — (dx, dy)
      const c = this.c, L = 3, W = 0.5;
      const n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + ux * L - uy * W, y + uy * L + ux * W);
      c.lineTo(x + ux * L + uy * W, y + uy * L - ux * W);
      c.closePath(); c.fill();
    }
    text(s, x, y, { h = TEXT, align = "center", base = "middle", angle = 0, bg = true } = {}) {
      const c = this.c;
      c.save();
      c.translate(x, y);
      if (angle) c.rotate(angle);
      c.font = FONT(h);
      c.textAlign = align; c.textBaseline = base;
      if (bg) {
        const w = c.measureText(s).width;
        const x0 = align === "left" ? 0 : align === "right" ? -w : -w / 2;
        c.fillStyle = "#fff";
        c.fillRect(x0 - 0.5, -h * 0.65, w + 1, h * 1.3);
        c.fillStyle = "#000";
      }
      c.fillText(s, 0, 0);
      c.restore();
    }
  }

  /** Горизонтальный размер от x1 до x2 на уровне y; выносные линии идут от yFrom. */
  function dimH(p, x1, x2, y, yFrom, label) {
    const c = p.c;
    for (const x of [x1, x2]) p.line(x, yFrom + (y > yFrom ? 1 : -1), x, y + (y > yFrom ? 2 : -2));
    p.line(x1, y, x2, y);
    const gap = x2 - x1;
    if (gap > 7) { p.arrow(x1, y, 1, 0); p.arrow(x2, y, -1, 0); } else { p.arrow(x1, y, -1, 0); p.arrow(x2, y, 1, 0); }
    p.text(label, (x1 + x2) / 2, y - 2.2);
    c.beginPath();
  }

  /** Вертикальный размер (диаметр) на x от y1 до y2. Текст на белой подложке. */
  function dimV(p, x, y1, y2, label) {
    p.line(x, y1, x, y2);
    p.arrow(x, y1, 0, 1); p.arrow(x, y2, 0, -1);
    p.text(label, x, (y1 + y2) / 2, { angle: -Math.PI / 2 });
  }

  /** Выноска: линия с полкой и текстом. */
  function leader(p, x, y, tx, ty, label, align = "left") {
    p.line(x, y, tx, ty);
    p.line(tx, ty, tx + (align === "left" ? 18 : -18), ty);
    p.text(label, tx + (align === "left" ? 1 : -1), ty - 2.2, { align });
    p.c.beginPath();
    p.c.arc(x, y, 0.5, 0, Math.PI * 2); p.c.fill();
  }

  // ------------------------------------------------------------------ геометрия вида

  function distinct(values, tol = 1e-6) {
    const out = [];
    for (const v of values.slice().sort((a, b) => a - b)) if (!out.length || Math.abs(v - out[out.length - 1]) > tol) out.push(v);
    return out;
  }

  /** Заливка штриховкой 45° внутри текущего пути (evenodd). */
  function hatch(c, path, bbox) {
    c.save();
    c.clip(path, "evenodd");
    c.lineWidth = THIN;
    c.beginPath();
    const [x0, y0, x1, y1] = bbox;
    const step = 2.2;
    for (let k = x0 - (y1 - y0); k < x1; k += step) { c.moveTo(k, y1); c.lineTo(k + (y1 - y0), y0); }
    c.stroke();
    c.restore();
  }

  function drawMainView(p, part, ev, sk, ox, cy, s) {
    const c = p.c;
    const X = (z) => ox + z * s;
    const R = Math.max(...ev.profile.map((q) => q[0]));
    const L = Math.max(...ev.profile.map((q) => q[1]));
    const upper = ev.profile.map(([r, z]) => [X(z), cy - r * s]);
    const lower = ev.profile.map(([r, z]) => [X(z), cy + r * s]);

    const holesCut = []; // отверстия, попавшие в плоскость разреза (угол 0° — сверху, 180° — снизу при чётном n)
    for (const h of ev.holes) {
      if (Math.abs(h.y) > 1e-6) continue;
      holesCut.push({ side: h.x > 0 ? "up" : "down", r0: Math.abs(h.x) - h.d / 2, r1: Math.abs(h.x) + h.d / 2, z0: h.z0, z1: h.z1 });
    }
    const poly = (path, pts) => { pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y))); path.closePath(); };
    const rect = (path, side, hl) => {
      const sg = side === "up" ? -1 : 1;
      const pts = [[X(hl.z0), cy + sg * hl.r0 * s], [X(hl.z1), cy + sg * hl.r0 * s], [X(hl.z1), cy + sg * hl.r1 * s], [X(hl.z0), cy + sg * hl.r1 * s]];
      poly(path, pts);
    };
    const path = new Path2D();
    poly(path, upper); poly(path, lower);
    for (const hl of holesCut) rect(path, hl.side, hl);
    hatch(c, path, [X(0) - 2, cy - R * s - 2, X(L) + 2, cy + R * s + 2]);

    // контур: рёбра на оси (r = 0) не обводим
    c.lineWidth = THICK; c.setLineDash([]); c.lineJoin = "round";
    for (const pts of [upper, lower]) {
      for (let i = 0; i < ev.profile.length; i++) {
        const a = ev.profile[i], b = ev.profile[(i + 1) % ev.profile.length];
        if (a[0] < 1e-9 && b[0] < 1e-9) continue;
        c.beginPath(); c.moveTo(...pts[i]); c.lineTo(...pts[(i + 1) % pts.length]); c.stroke();
      }
    }
    for (const hl of holesCut) { const q = new Path2D(); rect(q, hl.side, hl); c.stroke(q); }
    // торцевая линия через ось у сплошных ступеней
    for (let i = 0; i < ev.profile.length; i++) {
      const a = ev.profile[i], b = ev.profile[(i + 1) % ev.profile.length];
      if (a[0] < 1e-9 && b[0] > 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) p.line(X(a[1]), cy - b[0] * s, X(a[1]), cy + b[0] * s, THICK);
      if (b[0] < 1e-9 && a[0] > 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) p.line(X(a[1]), cy - a[0] * s, X(a[1]), cy + a[0] * s, THICK);
    }
    p.centerLine(X(0) - 6, cy, X(L) + 6, cy);
    return { X, R, L };
  }

  /** Размеры главного вида. */
  function dimensionMain(p, part, ev, sk, geo, cy, s) {
    const { X, R, L } = geo;
    const zs = distinct(sk.map((q) => q[1]).concat([0, L]));
    const y0 = cy + R * s;
    // цепочка длин ступеней + общий габарит
    let row = 10;
    if (zs.length > 2) {
      for (let i = 0; i + 1 < zs.length; i++) if (zs[i + 1] - zs[i] > 0.01) dimH(p, X(zs[i]), X(zs[i + 1]), y0 + row, y0, fmt(zs[i + 1] - zs[i]));
      row += 9;
    }
    dimH(p, X(0), X(L), y0 + row, y0, fmt(L));

    // диаметры: рёбра, параллельные оси
    const placed = [];
    const edges = [];
    for (let i = 0; i < sk.length; i++) {
      const a = sk[i], b = sk[(i + 1) % sk.length];
      if (Math.abs(a[0] - b[0]) < 1e-9 && a[0] > 1e-9 && Math.abs(a[1] - b[1]) > 1e-9) edges.push({ r: a[0], z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) });
    }
    edges.sort((e1, e2) => (e1.z1 - e1.z0) - (e2.z1 - e2.z0));
    for (const e of edges) {
      const xa = X(e.z0) + 2.5, xb = X(e.z1) - 2.5;
      let x = null;
      for (const f of [0.5, 0.25, 0.75, 0.15, 0.85, 0.35, 0.65]) {
        const cand = xa + (xb - xa) * f;
        if (xb > xa && placed.every((q) => Math.abs(q - cand) > 11)) { x = cand; break; }
      }
      if (x === null) x = (xa + xb) / 2;
      placed.push(x);
      dimV(p, x, cy - e.r * s, cy + e.r * s, `⌀${fmt(e.r * 2)}`);
    }

    // фаски
    const ch = ev.features.filter((f) => f.kind === "chamfer");
    let k = 0;
    for (const f of ch) {
      const v = f.vertices[0];
      const P = sk[v];
      if (!P) continue;
      const x = X(P[1]), y = cy - P[0] * s;
      const right = P[1] > L / 2;
      leader(p, x, y, x + (right ? 14 : -14), cy - R * s - 12 - k * 8, `${fmt(f.size)}×45°`, right ? "left" : "right");
      k++;
    }
  }

  function drawSideView(p, part, ev, sk, cx, cy, s) {
    const c = p.c;
    const R = Math.max(...sk.map((q) => q[0]));
    const radii = distinct(sk.map((q) => q[0]).filter((r) => r > 1e-9));
    const endR = distinct(sk.filter((q) => Math.abs(q[1]) < 1e-9 && q[0] > 1e-9).map((q) => q[0]));
    const circle = (r, w, dash) => { c.save(); c.lineWidth = w; c.setLineDash(dash || []); c.beginPath(); c.arc(cx, cy, r * s, 0, Math.PI * 2); c.stroke(); c.restore(); };
    for (const r of radii) {
      const visible = Math.abs(r - R) < 1e-9 || endR.some((e) => Math.abs(e - r) < 1e-9);
      circle(r, visible ? THICK : THIN, visible ? null : [3, 1.5]);
    }
    const holes = ev.holes;
    const pcd = holes.length ? Math.hypot(holes[0].x, holes[0].y) * 2 : 0;
    if (holes.length) {
      p.c.save(); p.c.lineWidth = THIN; p.c.setLineDash([12, 2, 2, 2]);
      p.c.beginPath(); p.c.arc(cx, cy, (pcd / 2) * s, 0, Math.PI * 2); p.c.stroke(); p.c.restore();
      for (const h of holes) {
        const hx = cx + h.x * s, hy = cy - h.y * s;
        c.save(); c.lineWidth = THICK; c.beginPath(); c.arc(hx, hy, (h.d / 2) * s, 0, Math.PI * 2); c.stroke(); c.restore();
        const a = Math.atan2(-h.y, h.x), e = (h.d / 2) * s + 3;
        p.centerLine(hx - Math.cos(a) * e, hy - Math.sin(a) * e, hx + Math.cos(a) * e, hy + Math.sin(a) * e);
        p.centerLine(hx + Math.sin(a) * e, hy - Math.cos(a) * e, hx - Math.sin(a) * e, hy + Math.cos(a) * e);
      }
    }
    p.centerLine(cx - R * s - 6, cy, cx + R * s + 6, cy);
    p.centerLine(cx, cy - R * s - 6, cx, cy + R * s + 6);

    // размеры: наружный диаметр и (для сплошных/полых) внутренний — по диагонали
    const mk = (r, ang, label) => {
      const dx = Math.cos(ang), dy = -Math.sin(ang);
      const x1 = cx - dx * r * s, y1 = cy - dy * r * s, x2 = cx + dx * r * s, y2 = cy + dy * r * s;
      p.line(x1, y1, x2, y2);
      p.arrow(x1, y1, dx, dy); p.arrow(x2, y2, -dx, -dy);
      p.text(label, cx + dx * r * s * 0.45, cy + dy * r * s * 0.45, { angle: -ang > 0 ? 0 : 0 });
    };
    if (radii.length) mk(R, Math.PI * 0.25, `⌀${fmt(R * 2)}`);
    const bore = radii.filter((r) => r < R - 1e-9 && sk.some((q) => q[0] === r && Math.abs(q[1]) < 1e-9))[0];
    if (bore && !holes.length) mk(bore, Math.PI * 0.75, `⌀${fmt(bore * 2)}`);
    if (holes.length) {
      const h = holes[0];
      const hx = cx + h.x * s, hy = cy - h.y * s;
      leader(p, hx + Math.cos(Math.PI / 4) * (h.d / 2) * s, hy - Math.sin(Math.PI / 4) * (h.d / 2) * s, cx + R * s + 12, cy - R * s - 6, `${holes.length} отв. ⌀${fmt(h.d)}`);
      const a = Math.PI * 0.8;
      leader(p, cx + Math.cos(a) * (pcd / 2) * s, cy - Math.sin(a) * (pcd / 2) * s, cx - R * s - 12, cy + R * s + 8, `⌀${fmt(pcd)}`, "right");
    }
    return R;
  }

  // ------------------------------------------------------------------ рамка и штамп

  function drawSheet(p, part, project, scale, view) {
    const mass = M.massKg(M.analyticVolume(part), M.density(part));
    drawFrame(p, {
      title: part.name || "Деталь",
      code: `BS.${(part.type || "part").slice(0, 3).toUpperCase()}.${String(part.id || "1").replace(/\D+/g, "").padStart(3, "0") || "001"}`,
      kind: "Деталь",
      extra: (M.MATERIALS[part.material] || M.MATERIALS.steel).label,
      massLabel: "Масса, кг",
      massText: mass >= 10 ? mass.toFixed(1).replace(".", ",") : mass.toFixed(3).replace(".", ","),
      scale, project, view,
      notes: ["1. Размеры для справок — в мм.", "2. Острые кромки притупить.", "3. Неуказанные отклонения — IT14/2."],
      roughness: true,
    });
  }

  /** Рамка A3 и основная надпись; поля f: title, code, kind, extra, massLabel, massText, scale, project, view, notes, roughness. */
  function drawFrame(p, f) {
    const c = p.c;
    c.fillStyle = "#fff"; c.fillRect(0, 0, SHEET.w, SHEET.h);
    c.strokeStyle = "#000"; c.fillStyle = "#000";
    c.lineWidth = 0.25; c.strokeRect(0.5, 0.5, SHEET.w - 1, SHEET.h - 1);
    const x0 = FRAME.l, y0 = FRAME.t, x1 = SHEET.w - FRAME.r, y1 = SHEET.h - FRAME.b;
    c.lineWidth = THICK + 0.3; c.strokeRect(x0, y0, x1 - x0, y1 - y0);

    // основная надпись 185 × 55
    const W = 185, H = 55, bx = x1 - W, by = y1 - H;
    c.lineWidth = THICK; c.strokeRect(bx, by, W, H);
    const L = (xa, ya, xb, yb, w = THIN + 0.1) => p.line(bx + xa, by + ya, bx + xb, by + yb, w);
    L(0, 15, 65, 15); L(0, 30, 65, 30); L(0, 40, 65, 40);
    L(65, 0, 65, H, THICK);
    L(65, 30, W, 30, THICK);
    L(120, 30, 120, H); L(150, 30, 150, H); L(165, 30, 165, H);
    L(120, 42, W, 42);
    L(35, 0, 35, 55); L(50, 0, 50, 55);
    const T = (s, x, y, o = {}) => p.text(s, bx + x, by + y, { bg: false, ...o });
    T(f.title, 92.5, 8, { h: f.title.length > 22 ? 4.5 : 6 });
    T(f.code, 92.5, 22, { h: 5 });
    T(f.kind, 92.5, 36, { h: 3.5 });
    T(f.extra || "", 92.5, 48, { h: 3.5 });
    T(f.massLabel || "", 135, 36, { h: 3 }); T(f.massText || "", 135, 47, { h: 4.5 });
    T("Масштаб", 157.5, 36, { h: 3 }); T(scaleLabel(f.scale), 157.5, 47, { h: 4.5 });
    T("Лист", 175, 36, { h: 3 }); T("1", 175, 47, { h: 4.5 });
    T("Разраб.", 8, 5, { h: 3 }); T("Пров.", 8, 20, { h: 3 }); T("Н.контр.", 8, 35, { h: 3 }); T("Утв.", 8, 47, { h: 3 });
    T("BuildSense", 150, 8, { h: 5 }); T("Учебная САПР", 150, 15, { h: 3 });
    T(new Date().toLocaleDateString("ru-RU"), 42, 8, { h: 3 });
    T(f.project && f.project.name ? f.project.name : "", 152.5, 22, { h: 3 });

    if (f.notes && f.notes.length) {
      p.text("Технические требования", x0 + 6, y1 - 38, { h: 4, align: "left", bg: false });
      f.notes.slice(0, 3).forEach((n, i) => p.text(n, x0 + 6, y1 - 31 + i * 6, { h: 3.5, align: "left", bg: false }));
    }
    if (f.roughness) p.text("Ra 6,3 (√)", x1 - 14, y0 + 8, { h: 4.5, bg: false });
    if (f.view) p.text(f.view, x0 + 6, y0 + 7, { h: 3, align: "left", bg: false });
  }

  // ------------------------------------------------------------------ сборка чертежа

  function chooseScale(L, D) {
    // главный вид + вид слева в одну строку: (L + D)·s ≤ ширина листа за вычетом размеров и зазоров; высота D·s ≤ 135
    let best = SCALES[0];
    for (const s of SCALES) if ((L + D) * s <= 215 && D * s <= 135) best = s;
    return best;
  }

  function render(part, opts = {}) {
    const ev = M.evaluate(part);
    const sk = ev.features.find((f) => f.kind === "sketch").profile;
    const L = Math.max(...sk.map((q) => q[1])), R = Math.max(...sk.map((q) => q[0]));
    const scale = opts.scale || chooseScale(L, R * 2);

    const canvas = document.createElement("canvas");
    canvas.width = SHEET.w * PX; canvas.height = SHEET.h * PX;
    const ctx = canvas.getContext("2d");
    ctx.scale(PX, PX);
    ctx.lineCap = "butt";
    const p = new Pen(ctx);
    ctx.strokeStyle = "#000"; ctx.fillStyle = "#000";
    drawSheet(p, part, opts.project, scale, "Вид спереди (разрез) · Вид слева");

    const cy = 110; // ось обоих видов
    const ox = FRAME.l + 30;
    ctx.strokeStyle = "#000"; ctx.fillStyle = "#000";
    const geo = drawMainView(p, part, ev, sk, ox, cy, scale);
    ctx.strokeStyle = "#000"; ctx.fillStyle = "#000";
    dimensionMain(p, part, ev, sk, geo, cy, scale);
    const sideCx = ox + L * scale + 75 + R * scale;
    ctx.strokeStyle = "#000"; ctx.fillStyle = "#000";
    drawSideView(p, part, ev, sk, sideCx, cy, scale);
    return canvas;
  }

  function toBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Не удалось сформировать PNG"))), "image/png"));
  }

  /** Окно предпросмотра чертежа с кнопками «Скачать PNG» / «Закрыть» (общее для деталей и дома). */
  function openPreview(canvas, { title, fileName, onStatus }) {
    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
    const dlg = mk("div", "drawing-dialog");
    dlg.setAttribute("role", "dialog");
    const box = mk("div", "drawing-box"), head = mk("div", "drawing-head");
    const note = mk("span", "drawing-note", `Лист A3, ${canvas.width} × ${canvas.height} px`);
    const save = mk("button", "primary", "Скачать PNG");
    const close = mk("button", "", "Закрыть");
    const onKey = (e) => { if (e.key === "Escape") closeAll(); };
    const closeAll = () => { dlg.remove(); document.removeEventListener("keydown", onKey); };
    save.type = close.type = "button";
    save.addEventListener("click", async () => {
      try {
        const url = URL.createObjectURL(await toBlob(canvas));
        const a = document.createElement("a");
        a.href = url; a.download = fileName; a.style.display = "none";
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        if (onStatus) onStatus(`Чертёж сохранён: ${fileName}`, "ok");
      } catch (e) { if (onStatus) onStatus(e.message, "error"); }
    });
    close.addEventListener("click", closeAll);
    head.append(mk("strong", "", title), note, save, close);
    const scroll = mk("div", "drawing-scroll");
    canvas.className = "drawing-canvas";
    scroll.append(canvas);
    box.append(head, scroll); dlg.append(box);
    dlg.addEventListener("click", (e) => { if (e.target === dlg) closeAll(); });
    document.addEventListener("keydown", onKey);
    document.body.append(dlg);
  }

  BS.mechDrawing = { render, toBlob, SHEET, PX, chooseScale, openPreview, kit: { Pen, dimH, dimV, leader, hatch, drawFrame, SCALES, scaleLabel, fmt, THICK, THIN, FRAME, FONT } };
})(globalThis.BuildSense);
