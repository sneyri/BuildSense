// BuildSense · учебный чертёж дома (чёрно-белый, лист A3): план выбранного этажа и фасад (вид с юга).
// BS.houseDrawing.render(project, { levelId }) → HTMLCanvasElement; показ и PNG — BS.mechDrawing.openPreview.
// План: стены со штриховкой, проёмы (окна, двери с дугой открывания), лестницы, колонны, названия и площади комнат,
// габаритные размеры и экспликация проёмов. Фасад: уровни этажей, окна, двери, крыша, отметки высот.
// Это учебное оформление «в духе» ЕСКД: масштабы и условные обозначения упрощены.
(function (BS) {
  "use strict";
  const K = () => BS.mechDrawing.kit;
  const S = () => BS.shapes;
  const SCALES = [1 / 400, 1 / 200, 1 / 150, 1 / 100, 1 / 75, 1 / 50, 1 / 40, 1 / 25]; // мм листа на мм модели

  const fmtM = (v) => String(Math.round(v * 1000) / 1000).replace(".", ",");
  const mm = (v) => String(Math.round(v * 1000));

  function houseBox(project, levelId) {
    const walls = project.elements.filter((e) => e.type === "wall" && !e.hostId);
    const list = walls.filter((w) => w.levelId === levelId);
    const use = list.length ? list : walls;
    if (!use.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of use) for (const q of S().footprint(w, project)) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
    return { minX, minY, maxX, maxY };
  }

  function chooseScale(W, D, H) {
    // мм листа на метр модели = 1000·s; план ≤ 185 × 150 мм, фасад ≤ 165 мм по ширине, высота ≤ 150 мм
    let best = SCALES[0];
    for (const s of SCALES) {
      const m = 1000 * s;
      if (W * m <= 175 && D * m <= 150 && H * m <= 150) best = s;
    }
    return best;
  }

  // ------------------------------------------------------------------ план

  function drawPlan(p, project, level, box, m, ox, oy) {
    const c = p.c, k = K();
    const X = (x) => ox + (x - box.minX) * m;
    const Y = (y) => oy + (box.maxY - y) * m;
    const poly = (path, pts) => { pts.forEach((q, i) => (i ? path.lineTo(X(q.x), Y(q.y)) : path.moveTo(X(q.x), Y(q.y)))); path.closePath(); };
    const els = project.elements.filter((e) => e.levelId === level.id && !e.hostId);

    // комнаты: название и площадь
    for (const r of els.filter((e) => e.type === "room")) {
      const ctr = S().center(r, project);
      const name = (r.params && r.params.roomName) || r.name || "Комната";
      p.text(name, X(ctr.x), Y(ctr.y) - 2, { h: 3.2, bg: false });
      p.text(`${fmtM(Math.round(r.size.length * r.size.width * 10) / 10)} м²`, X(ctr.x), Y(ctr.y) + 2.5, { h: 3, bg: false });
    }

    // стены со штриховкой
    const walls = els.filter((e) => e.type === "wall");
    const wallPath = new Path2D();
    for (const w of walls) poly(wallPath, S().footprint(w, project));
    k.hatch(c, wallPath, [ox - 5, oy - 5, ox + (box.maxX - box.minX) * m + 5, oy + (box.maxY - box.minY) * m + 5]);
    c.lineWidth = k.THICK; c.setLineDash([]); c.strokeStyle = "#000";
    for (const w of walls) { const q = new Path2D(); poly(q, S().footprint(w, project)); c.stroke(q); }

    // колонны
    for (const e of els.filter((e) => e.type === "column" || e.type === "round_column")) {
      const q = new Path2D(); poly(q, S().footprint(e, project));
      c.fillStyle = "#000"; c.fill(q);
    }

    // лестницы: контур + ступени
    for (const st of els.filter((e) => e.type === "stairs")) {
      const fp = S().footprint(st, project);
      if (fp.length < 4) continue;
      const q = new Path2D(); poly(q, fp);
      c.fillStyle = "#fff"; c.fill(q); c.lineWidth = k.THICK; c.stroke(q);
      const n = Math.max(2, Math.round((st.params || {}).steps || 8));
      const a = fp[0], b = fp[1], d = fp[3];
      for (let i = 1; i < n; i++) {
        const t = i / n;
        p.line(X(a.x + (b.x - a.x) * t), Y(a.y + (b.y - a.y) * t), X(d.x + (b.x - a.x) * t), Y(d.y + (b.y - a.y) * t), k.THIN);
      }
      const mid = { x: (a.x + b.x + fp[2].x + d.x) / 4, y: (a.y + b.y + fp[2].y + d.y) / 4 };
      const ux = (b.x - a.x), uy = (b.y - a.y), ul = Math.hypot(ux, uy) || 1;
      c.fillStyle = "#000";
      p.line(X(mid.x - (ux / ul) * st.size.length * 0.35), Y(mid.y - (uy / ul) * st.size.length * 0.35), X(mid.x + (ux / ul) * st.size.length * 0.35), Y(mid.y + (uy / ul) * st.size.length * 0.35), k.THIN);
      p.arrow(X(mid.x + (ux / ul) * st.size.length * 0.35), Y(mid.y + (uy / ul) * st.size.length * 0.35), -ux / ul, uy / ul);
    }

    // проёмы
    const spec = [];
    const openings = project.elements.filter((e) => e.hostId && (e.type === "door" || e.type === "window") && walls.some((w) => w.id === e.hostId));
    let nd = 0, nw = 0;
    for (const o of openings) {
      const fp = S().footprint(o, project);
      if (fp.length < 4) continue;
      const q = new Path2D(); poly(q, fp);
      c.fillStyle = "#fff"; c.fill(q);
      const P = fp.map((t) => ({ x: X(t.x), y: Y(t.y) }));
      c.lineWidth = k.THIN + 0.1;
      p.line(P[0].x, P[0].y, P[3].x, P[3].y, k.THICK); p.line(P[1].x, P[1].y, P[2].x, P[2].y, k.THICK);
      const mid = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      let label;
      if (o.type === "window") {
        for (const t of [0.15, 0.5, 0.85]) { const a = mid(P[0], P[3], t), b = mid(P[1], P[2], t); p.line(a.x, a.y, b.x, b.y, t === 0.5 ? k.THIN : k.THIN); }
        label = `О${++nw}`;
        spec.push({ label, w: o.size.width, h: o.size.height, sill: (o.position || {}).elevation || 0 });
      } else {
        // створка перпендикулярно стене, дуга открывания
        const hinge = P[0];
        const uv = { x: P[1].x - P[0].x, y: P[1].y - P[0].y }, vv = { x: P[3].x - P[0].x, y: P[3].y - P[0].y };
        const R = Math.hypot(uv.x, uv.y), vl = Math.hypot(vv.x, vv.y) || 1;
        const leaf = { x: hinge.x + (vv.x / vl) * R, y: hinge.y + (vv.y / vl) * R };
        p.line(hinge.x, hinge.y, leaf.x, leaf.y, k.THICK);
        const a0 = Math.atan2(uv.y, uv.x), a1 = Math.atan2(vv.y, vv.x);
        let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        c.save(); c.lineWidth = k.THIN; c.beginPath(); c.arc(hinge.x, hinge.y, R, a0, a0 + da, da < 0); c.stroke(); c.restore();
        label = `Д${++nd}`;
        spec.push({ label, w: o.size.width, h: o.size.height, sill: 0 });
      }
      const cx = (P[0].x + P[2].x) / 2, cy = (P[0].y + P[2].y) / 2;
      p.text(label, cx, cy - 4.5, { h: 2.6 });
    }

    // габаритные размеры
    const x0 = X(box.minX), x1 = X(box.maxX), yb = Y(box.minY), yt = Y(box.maxY);
    k.dimH(p, x0, x1, yb + 14, yb, mm(box.maxX - box.minX));
    k.dimV(p, x1 + 14, yt, yb, mm(box.maxY - box.minY));
    p.line(x1 + 1, yt, x1 + 16, yt); p.line(x1 + 1, yb, x1 + 16, yb);
    return spec;
  }

  // ------------------------------------------------------------------ фасад

  function drawFacade(p, project, box, m, ox, groundY) {
    const c = p.c, k = K();
    const X = (x) => ox + (x - box.minX) * m;
    const Z = (z) => groundY - z * m;
    const levels = project.levels.slice().sort((a, b) => a.elevation - b.elevation);
    const southTol = 0.6;
    const allWalls = project.elements.filter((e) => e.type === "wall" && !e.hostId);
    const front = allWalls.filter((w) => {
      const b = S().bounds(w, project);
      return b && b.max.y - b.min.y <= (w.size.thickness || 0.3) + 0.05 && b.min.y <= box.minY + southTol + 0.0;
    });
    c.fillStyle = "#fff"; c.strokeStyle = "#000"; c.setLineDash([]);
    let topZ = 0;
    for (const w of front) {
      const b = S().bounds(w, project);
      c.lineWidth = k.THICK;
      c.fillRect(X(b.min.x), Z(b.max.z), (b.max.x - b.min.x) * m, (b.max.z - b.min.z) * m);
      c.strokeRect(X(b.min.x), Z(b.max.z), (b.max.x - b.min.x) * m, (b.max.z - b.min.z) * m);
      topZ = Math.max(topZ, b.max.z);
    }
    for (const o of project.elements.filter((e) => e.hostId && (e.type === "door" || e.type === "window") && front.some((w) => w.id === e.hostId))) {
      const b = S().bounds(o, project);
      if (!b) continue;
      const x = X(b.min.x), w = (b.max.x - b.min.x) * m, y = Z(b.max.z), h = (b.max.z - b.min.z) * m;
      c.lineWidth = k.THICK; c.strokeRect(x, y, w, h);
      c.lineWidth = k.THIN;
      if (o.type === "window") {
        p.line(x + w / 2, y, x + w / 2, y + h, k.THIN); p.line(x, y + h / 2, x + w, y + h / 2, k.THIN);
        p.line(x, y + h, x + w / 2, y, k.THIN, [3, 2]); // косая линия открывания
      } else {
        p.line(x, y + h, x + w, y, k.THIN, [3, 2]); p.line(x, y, x + w, y + h, k.THIN, [3, 2]);
      }
    }

    // крыша
    for (const r of project.elements.filter((e) => e.type === "roof")) {
      const b = S().bounds(r, project);
      if (!b) continue;
      const rise = S().roofRise(r), base = r.position.z, type = (r.params || {}).roofType;
      const alongX = Math.abs(Math.cos(((r.rotation || 0) * Math.PI) / 180)) > 0.7;
      const x0 = X(b.min.x), x1 = X(b.max.x), zb = Z(base);
      c.lineWidth = k.THICK; c.beginPath();
      if (type === "gable" && !alongX) { c.moveTo(x0, zb); c.lineTo((x0 + x1) / 2, Z(base + rise)); c.lineTo(x1, zb); }
      else if (type === "hip" && alongX) { const inset = Math.min((x1 - x0) / 2, (r.size.width / 2) * m); c.moveTo(x0, zb); c.lineTo(x0 + inset, Z(base + rise)); c.lineTo(x1 - inset, Z(base + rise)); c.lineTo(x1, zb); }
      else if (type === "hip") { c.moveTo(x0, zb); c.lineTo((x0 + x1) / 2, Z(base + rise)); c.lineTo(x1, zb); }
      else { c.moveTo(x0, zb); c.lineTo(x0, Z(base + rise)); c.lineTo(x1, Z(base + rise)); c.lineTo(x1, zb); }
      c.closePath(); c.fillStyle = "#fff"; c.fill(); c.stroke();
      topZ = Math.max(topZ, base + rise);
    }
    // земля
    const gx0 = X(box.minX) - 12, gx1 = X(box.maxX) + 12;
    p.line(gx0, groundY, gx1, groundY, k.THICK + 0.3);
    for (let x = gx0; x < gx1; x += 3) p.line(x, groundY, x - 2, groundY + 2, k.THIN);

    // отметки уровней и высотные размеры слева
    const xl = X(box.minX) - 16;
    const marks = levels.map((l) => l.elevation).concat([topZ]);
    const zs = marks.filter((z, i) => marks.findIndex((q) => Math.abs(q - z) < 1e-6) === i).sort((a, b) => a - b);
    for (let i = 0; i + 1 < zs.length; i++) {
      const y1 = Z(zs[i]), y2 = Z(zs[i + 1]);
      p.line(xl - 2, y1, xl + 2, y1, k.THIN); p.line(xl - 2, y2, xl + 2, y2, k.THIN);
      k.dimV(p, xl, y2, y1, mm(zs[i + 1] - zs[i]));
    }
    c.fillStyle = "#000";
    for (const z of zs) {
      const y = Z(z), xr = X(box.maxX) + 8;
      p.line(xr - 6, y, xr + 8, y, k.THIN);
      c.beginPath(); c.moveTo(xr, y); c.lineTo(xr - 1.6, y - 2.6); c.lineTo(xr + 1.6, y - 2.6); c.closePath(); c.fill();
      p.text(`${z >= 0 ? "+" : ""}${z.toFixed(3).replace(".", ",")}`, xr + 10, y - 2, { h: 2.8, align: "left", bg: false });
    }
    return topZ;
  }

  // ------------------------------------------------------------------ сборка листа

  function render(project, opts = {}) {
    const kit = K();
    const level = project.levels.find((l) => l.id === opts.levelId) || project.levels[0];
    const box = houseBox(project, level.id);
    if (!box) throw new Error("На плане нет стен — сначала постройте дом");
    const W = box.maxX - box.minX, D = box.maxY - box.minY;
    const roofTop = Math.max(...project.elements.filter((e) => e.type === "roof").map((r) => r.position.z + S().roofRise(r)), ...project.levels.map((l) => l.elevation + l.height));
    const scale = opts.scale || chooseScale(W, D, roofTop);
    const m = 1000 * scale; // мм листа на метр

    const canvas = document.createElement("canvas");
    canvas.width = BS.mechDrawing.SHEET.w * BS.mechDrawing.PX; canvas.height = BS.mechDrawing.SHEET.h * BS.mechDrawing.PX;
    const ctx = canvas.getContext("2d");
    ctx.scale(BS.mechDrawing.PX, BS.mechDrawing.PX);
    const p = new kit.Pen(ctx);
    let area = 0;
    try {
      const cs = BS.contour ? BS.contour.forLevel(project, level.id) : [];
      if (cs.length) area = Math.abs(BS.geometry.polygonArea(cs[0].points));
    } catch { /* площадь по габаритам ниже */ }
    if (!area) area = W * D;
    kit.drawFrame(p, {
      title: project.name || "Дом", code: `BS.ARH.${String(project.levels.indexOf(level) + 1).padStart(3, "0")}`,
      kind: "План этажа и фасад", extra: level.name,
      massLabel: "Площадь, м²", massText: fmtM(Math.round(area * 10) / 10), scale, project,
      view: `План: ${level.name} · Фасад (вид с юга)`,
      notes: ["1. Размеры на плане и фасаде — в мм.", "2. Отметки высот — в метрах.", "3. Учебное оформление, не рабочий проект."],
    });
    ctx.strokeStyle = "#000"; ctx.fillStyle = "#000";

    const px = kit.FRAME.l + 25, py = 22;
    const spec = drawPlan(p, project, level, box, m, px, py);
    ctx.strokeStyle = "#000"; ctx.fillStyle = "#000";
    p.text("План", px + (W * m) / 2, py - 10, { h: 5, bg: false });
    p.text(`${level.name}, М ${kit.scaleLabel(scale)}`, px + (W * m) / 2, py - 4, { h: 3, bg: false });

    const fx = px + W * m + 60, groundY = py + roofTop * m + 6;
    ctx.strokeStyle = "#000"; ctx.fillStyle = "#000";
    drawFacade(p, project, box, m, fx, groundY);
    ctx.strokeStyle = "#000"; ctx.fillStyle = "#000";
    p.text("Фасад (вид с юга)", fx + (W * m) / 2, 12, { h: 5, bg: false });

    // экспликация проёмов
    if (spec.length) {
      const ex = fx, ey = Math.max(groundY + 20, py + D * m + 36);
      p.text("Экспликация проёмов", ex, ey, { h: 3.6, align: "left", bg: false });
      spec.slice(0, 14).forEach((s, i) => p.text(`${s.label}  ${mm(s.w)}×${mm(s.h)}${s.sill ? `, подоконник ${mm(s.sill)}` : ""}`, ex, ey + 6 + i * 5, { h: 3.1, align: "left", bg: false }));
    }
    return canvas;
  }

  BS.houseDrawing = { render, chooseScale };
})(globalThis.BuildSense);
