// Построение 3D-геометрии Three.js по данным модели. Каждый элемент — THREE.Group с userData.elementId.
// Локальные оси группы совпадают с осями элемента (u — X, v — Y, w — Z), поэтому детали строятся
// в координатах элемента и не зависят от его поворота.
(function (BS) {
  "use strict";
  const T = THREE;
  const DEG = Math.PI / 180;
  const EDGE = 0x0b0f14;

  function mat(color, extra = {}) {
    return new T.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...extra });
  }

  // ---------------------------------------------------------------- материалы и процедурные текстуры

  const textureCache = new Map();

  /**
   * Процедурная текстура (CanvasTexture 256 x 256), рисуется кодом и кешируется по виду и цвету.
   * Повторяется каждые look.tile метров (UV задаются в метрах, см. worldUV).
   */
  function proceduralTexture(kind, color) {
    const key = kind + "|" + color;
    if (textureCache.has(key)) return textureCache.get(key);
    if (typeof document === "undefined") return null;
    const N = 256;
    const cv = document.createElement("canvas");
    cv.width = cv.height = N;
    const g = cv.getContext("2d");
    const base = new T.Color(color);
    const css = (k, j = 0) => {
      const c = base.clone().multiplyScalar(k);
      c.r = Math.min(1, c.r + j); c.g = Math.min(1, c.g + j); c.b = Math.min(1, c.b + j);
      return "#" + c.getHexString();
    };
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.fillStyle = css(1);
    g.fillRect(0, 0, N, N);
    if (kind === "brick" || kind === "block") {
      // Кирпич 250 x 65 мм со швом 10 мм (на 1 м: 4 по длине, 13 рядов); газоблок 625 x 250 мм
      const rows = kind === "brick" ? 13 : 5, cols = kind === "brick" ? 4 : 2;
      const rh = N / rows, cw = N / cols, joint = kind === "brick" ? 2 : 1.5;
      g.fillStyle = kind === "brick" ? "#d9d2c5" : css(0.82);
      g.fillRect(0, 0, N, N);
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? cw / 2 : 0;
        for (let c = -1; c <= cols; c++) {
          g.fillStyle = css(0.86 + rnd() * 0.24);
          g.fillRect(c * cw + off + joint / 2, r * rh + joint / 2, cw - joint, rh - joint);
        }
      }
    } else if (kind === "wood") {
      const boards = 6, bh = N / boards;
      for (let b = 0; b < boards; b++) {
        g.fillStyle = css(0.88 + rnd() * 0.2);
        g.fillRect(0, b * bh, N, bh - 1.5);
        g.strokeStyle = css(0.72);
        g.lineWidth = 1;
        for (let k = 0; k < 5; k++) {
          const y = b * bh + rnd() * bh;
          g.beginPath();
          g.moveTo(0, y);
          for (let x = 0; x <= N; x += 16) g.lineTo(x, y + Math.sin(x / 23 + k) * 1.6);
          g.stroke();
        }
        g.fillStyle = css(0.6);
        g.fillRect(0, (b + 1) * bh - 1.5, N, 1.5);
      }
    } else if (kind === "tile") {
      const rows = 8, cols = 6, rh = N / rows, cw = N / cols;
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? cw / 2 : 0;
        for (let c = -1; c <= cols; c++) {
          const x = c * cw + off, y = r * rh;
          const grd = g.createLinearGradient(0, y, 0, y + rh);
          const k = 0.9 + rnd() * 0.15;
          grd.addColorStop(0, css(k * 1.08));
          grd.addColorStop(1, css(k * 0.7));
          g.fillStyle = grd;
          g.beginPath();
          g.moveTo(x + 1, y);
          g.lineTo(x + cw - 1, y);
          g.lineTo(x + cw - 1, y + rh * 0.75);
          g.quadraticCurveTo(x + cw / 2, y + rh + 2, x + 1, y + rh * 0.75);
          g.closePath();
          g.fill();
        }
      }
    } else if (kind === "metal") {
      for (let x = 0; x < N; x += 32) {
        const grd = g.createLinearGradient(x, 0, x + 32, 0);
        grd.addColorStop(0, css(0.8)); grd.addColorStop(0.5, css(1.12)); grd.addColorStop(1, css(0.8));
        g.fillStyle = grd;
        g.fillRect(x, 0, 32, N);
      }
    } else {
      // Бетон: мелкий шум и следы щитов опалубки
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = css(0.8 + rnd() * 0.35);
        g.fillRect(rnd() * N, rnd() * N, 1 + rnd() * 2, 1 + rnd() * 2);
      }
      g.strokeStyle = css(0.85);
      g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, N - 1, N - 1);
    }
    const tex = new T.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    if (T.sRGBEncoding) tex.encoding = T.sRGBEncoding;
    tex.anisotropy = 4;
    tex.userData.shared = true; // не освобождается при перестройке сцены (кеш)
    textureCache.set(key, tex);
    return tex;
  }

  /** Материал по id материала проекта: цвет, шероховатость, металличность, процедурная текстура. */
  function lookMat(materialId, extra = {}) {
    const lk = BS.materials.look(materialId);
    const params = { color: lk.color, roughness: lk.roughness, metalness: lk.metalness, ...extra };
    const tex = lk.texture ? proceduralTexture(lk.texture, lk.color) : null;
    if (tex) {
      params.map = tex;
      params.color = 0xffffff;
    }
    const m = new T.MeshStandardMaterial(params);
    m.userData.tile = lk.tile;
    return m;
  }

  /**
   * UV в метрах по доминирующей нормали (кубическая проекция): кладка и доски не растягиваются
   * по граням разного размера. Вызывать после всех преобразований геометрии в осях элемента.
   */
  function worldUV(geo, tile = 1) {
    const pos = geo.attributes.position;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
      let u, v;
      if (az >= ax && az >= ay) { u = x; v = y; } else if (ax >= ay) { u = y; v = z; } else { u = x; v = z; }
      uv[i * 2] = u / tile;
      uv[i * 2 + 1] = v / tile;
    }
    geo.setAttribute("uv", new T.BufferAttribute(uv, 2));
    return geo;
  }

  /** Тело элемента из его материала (с текстурой и UV в метрах). */
  function addSolid(group, geometry, el, extra = {}, opts = {}) {
    const m = lookMat(el.material, extra);
    if (m.map) worldUV(geometry, m.userData.tile);
    return add(group, geometry, m, opts);
  }

  function shade(hex, k) {
    const c = new T.Color(hex);
    c.multiplyScalar(k);
    return c;
  }

  /** Брус с углом в начале координат: x ∈ [0,a], y ∈ [0,b], z ∈ [0,c]. */
  function box(a, b, c, x = 0, y = 0, z = 0) {
    return new T.BoxGeometry(Math.max(a, 1e-4), Math.max(b, 1e-4), Math.max(c, 1e-4)).translate(x + a / 2, y + b / 2, z + c / 2);
  }

  function add(group, geometry, material, { edges = true, shadow = true } = {}) {
    const mesh = new T.Mesh(geometry, material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    group.add(mesh);
    if (edges) {
      const line = new T.LineSegments(new T.EdgesGeometry(geometry, 25), new T.LineBasicMaterial({ color: EDGE, transparent: true, opacity: 0.45 }));
      line.userData.isEdge = true;
      group.add(line);
    }
    return mesh;
  }

  function makeGroup(el) {
    const g = new T.Group();
    g.name = el.id;
    g.userData.elementId = el.id;
    g.userData.elementType = el.type;
    g.userData.group = (BS.types.get(el.type) || {}).group;
    return g;
  }

  function place(group, el) {
    group.position.set(el.position.x, el.position.y, el.position.z);
    group.rotation.z = (el.rotation || 0) * DEG;
  }

  /** Все элементы проекта; ошибки отдельных элементов не прерывают построение. */
  function buildAll(project) {
    const out = [];
    const failed = [];
    for (const el of project.elements) {
      try {
        const sizeOk = Object.values(el.size || {}).every((v) => Number.isFinite(v) && v > 0);
        const posOk = Object.values(el.position || {}).every(Number.isFinite);
        if (!sizeOk || !posOk) { failed.push(el.id); continue; }
        const obj = build(el, project);
        if (obj) out.push(obj);
      } catch (err) {
        failed.push(el.id);
        console.warn(`Не удалось построить ${el.id}:`, err);
      }
    }
    return { objects: out, failed };
  }

  function build(el, project) {
    const t = BS.types.get(el.type);
    if (!t) return null;
    const color = BS.materials.color(el.material);
    const g = makeGroup(el);
    const s = el.size;
    switch (t.shape) {
      case "box":
        if (BS.shapes.isPrism(el)) buildPrism(g, el);
        else addSolid(g, box(s.length, s.width, s.height), el);
        place(g, el);
        break;
      case "wall":
        buildWall(g, el, project, color);
        place(g, el);
        break;
      case "cylinder": {
        const geo = new T.CylinderGeometry(s.diameter / 2, s.diameter / 2, s.height, 28).rotateX(Math.PI / 2).translate(0, 0, s.height / 2);
        addSolid(g, geo, el);
        g.position.set(el.position.x, el.position.y, el.position.z);
        break;
      }
      case "opening":
        if (!buildOpening(g, el, project, color)) return null;
        break;
      case "roof":
        buildRoof(g, el, color);
        place(g, el);
        break;
      case "stairs":
        buildStairs(g, el, color);
        place(g, el);
        break;
      case "truss":
        buildTruss(g, el, color);
        place(g, el);
        break;
      case "railing":
        buildRailing(g, s.length, s.width, s.height, color, 0, 0, 0);
        place(g, el);
        break;
      case "balcony":
        add(g, box(s.length, s.width, s.height), mat(color));
        buildRailing(g, s.length, 0.05, 1.0, 0x8a9099, 0, s.width - 0.05, s.height);
        buildRailing(g, s.width - 0.05, 0.05, 1.0, 0x8a9099, 0, 0, s.height, true);
        buildRailing(g, s.width - 0.05, 0.05, 1.0, 0x8a9099, s.length - 0.05, 0, s.height, true);
        place(g, el);
        break;
      case "pipe":
        buildPipe(g, el, color);
        break;
      case "zone":
        buildZone(g, el);
        place(g, el);
        break;
      case "fixture":
        buildFixture(g, el, t.recipe, color);
        place(g, el);
        break;
      default:
        return null;
    }
    return g;
  }

  // ---------------------------------------------------------------- стена с проёмами

  function buildWall(g, el, project, color) {
    const { length: L, thickness: t, height: H } = el.size;
    const shape = new T.Shape();
    shape.moveTo(0, 0); shape.lineTo(L, 0); shape.lineTo(L, H); shape.lineTo(0, H); shape.closePath();
    const eps = 0.002;
    const rects = project.elements.filter((o) => o.hostId === el.id).map((o) => ({
      u0: Math.max(eps, o.position.offset), u1: Math.min(L - eps, o.position.offset + o.size.width),
      w0: Math.max(eps, o.position.elevation), w1: Math.min(H - eps, o.position.elevation + o.size.height),
    })).filter((r) => r.u1 - r.u0 > 0.01 && r.w1 - r.w0 > 0.01);
    for (const r of mergeRects(rects)) {
      const hole = new T.Path();
      hole.moveTo(r.u0, r.w0); hole.lineTo(r.u0, r.w1); hole.lineTo(r.u1, r.w1); hole.lineTo(r.u1, r.w0); hole.closePath();
      shape.holes.push(hole);
    }
    const geo = new T.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // (u, w, z) → (u, −z, w)
    geo.translate(0, t, 0);
    addSolid(g, geo, el);
  }

  /** Многоугольная плита (фундамент/перекрытие по контуру): контур params.points, выдавливание на size.height. */
  function buildPrism(g, el) {
    const pts = el.params.points;
    const shape = new T.Shape();
    shape.moveTo(pts[0].x, pts[0].y);
    for (const q of pts.slice(1)) shape.lineTo(q.x, q.y);
    shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, { depth: el.size.height, bevelEnabled: false });
    addSolid(g, geo, el);
  }

  function mergeRects(rects) {
    const list = rects.map((r) => ({ ...r }));
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (a.u0 <= b.u1 && b.u0 <= a.u1 && a.w0 <= b.w1 && b.w0 <= a.w1) {
            list[i] = { u0: Math.min(a.u0, b.u0), u1: Math.max(a.u1, b.u1), w0: Math.min(a.w0, b.w0), w1: Math.max(a.w1, b.w1) };
            list.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
    return list;
  }

  // ---------------------------------------------------------------- проёмы

  function buildOpening(g, el, project, color) {
    const host = project.elements.find((w) => w.id === el.hostId);
    if (!host) return false;
    const o = BS.geometry.localToWorld(host, el.position.offset, 0, el.position.elevation);
    g.position.set(o.x, o.y, o.z);
    g.rotation.z = (host.rotation || 0) * DEG;
    const { width: w, height: h } = el.size;
    const t = host.size.thickness;
    if (el.type === "door") {
      const leafT = Math.min(0.05, t);
      add(g, box(w - 0.02, leafT, h - 0.01, 0.01, (t - leafT) / 2, 0), mat(color));
      add(g, box(0.12, leafT + 0.06, 0.03, w - 0.2, (t - leafT) / 2 - 0.03, Math.min(1.0, h * 0.48)), mat(0xd4b04c, { metalness: 0.6, roughness: 0.35 }), { edges: false });
      return true;
    }
    const fd = Math.min(0.08, t);
    const bar = Math.min(0.06, w / 6, h / 6);
    const outer = new T.Shape();
    outer.moveTo(0, 0); outer.lineTo(w, 0); outer.lineTo(w, h); outer.lineTo(0, h); outer.closePath();
    const inner = new T.Path();
    inner.moveTo(bar, bar); inner.lineTo(bar, h - bar); inner.lineTo(w - bar, h - bar); inner.lineTo(w - bar, bar); inner.closePath();
    outer.holes.push(inner);
    const frame = new T.ExtrudeGeometry(outer, { depth: fd, bevelEnabled: false });
    frame.rotateX(Math.PI / 2);
    frame.translate(0, (t + fd) / 2, 0);
    add(g, frame, mat(color));
    add(g, box(w - 2 * bar, 0.01, h - 2 * bar, bar, t / 2 - 0.005, bar), mat(0x7fb6e0, { transparent: true, opacity: 0.4, roughness: 0.1 }), { edges: false, shadow: false });
    return true;
  }

  // ---------------------------------------------------------------- крыша

  function buildRoof(g, el, color) {
    const { length: L, width: W } = el.size;
    const p = el.params;
    const m = lookMat(el.material, { side: T.DoubleSide });
    const uvRoof = (geo) => (m.map ? worldUV(geo, m.userData.tile) : geo);
    const rise = BS.shapes.roofRise(el);
    if (p.roofType === "flat") {
      add(g, uvRoof(box(L, W, p.thickness)), m);
      return;
    }
    if (p.roofType === "hip") {
      add(g, uvRoof(hipGeometry(L, W, rise)), m);
      return;
    }
    // Профиль поперёк ската в плоскости (v, w), выдавливается вдоль u
    const tri = new T.Shape();
    tri.moveTo(0, 0);
    tri.lineTo(W, 0);
    if (p.roofType === "shed") tri.lineTo(0, rise);
    else tri.lineTo(W / 2, rise);
    tri.closePath();
    const geo = new T.ExtrudeGeometry(tri, { depth: L, bevelEnabled: false });
    geo.applyMatrix4(new T.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1)); // x→y, y→z, z→x
    geo.computeVertexNormals();
    add(g, uvRoof(geo), m);
  }

  /** Вальмовая крыша: прямоугольное основание a × b, конёк вдоль длинной стороны. */
  function hipGeometry(L, W, h) {
    const swap = W > L;
    const a = swap ? W : L, b = swap ? L : W;
    const r = Math.max(0, a - b);
    const A = [0, 0, 0], B = [a, 0, 0], C = [a, b, 0], D = [0, b, 0];
    const R1 = [b / 2, b / 2, h], R2 = [b / 2 + r, b / 2, h];
    const tris = [A, B, R2, A, R2, R1, B, C, R2, C, D, R1, C, R1, R2, D, A, R1, A, C, B, A, D, C];
    const pos = new Float32Array(tris.length * 3);
    tris.forEach((v, i) => {
      let [x, y, z] = v;
      if (swap) [x, y] = [L - y, x];
      pos.set([x, y, z], i * 3);
    });
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  // ---------------------------------------------------------------- лестница, ферма, перила, труба

  function buildStairs(g, el, color) {
    const { length: L, width: W, height: H } = el.size;
    const n = Math.max(1, Math.round(el.params.steps || 1));
    const run = L / n, rise = H / n;
    const m = lookMat(el.material);
    for (let i = 0; i < n; i++) {
      const geo = box(run, W, rise * (i + 1), i * run, 0, 0);
      if (m.map) worldUV(geo, m.userData.tile);
      add(g, geo, m, { edges: i % 2 === 0 });
    }
  }

  function member(g, p, q, b, m, v) {
    const du = q[0] - p[0], dw = q[1] - p[1];
    const len = Math.hypot(du, dw);
    if (len < 1e-3) return;
    const geo = new T.BoxGeometry(len, b, b);
    geo.rotateY(-Math.atan2(dw, du));
    geo.translate((p[0] + q[0]) / 2, v, (p[1] + q[1]) / 2);
    add(g, geo, m, { edges: false });
  }

  function buildTruss(g, el, color) {
    const { length: L, width: b, height: H } = el.size;
    const n = Math.max(2, Math.round(el.params.panels || 4));
    const m = mat(color);
    const topAt = (x) => H * (1 - Math.abs((2 * x) / L - 1));
    const v = b / 2;
    member(g, [0, b / 2], [L, b / 2], b, m, v);
    member(g, [0, b / 2], [L / 2, H], b, m, v);
    member(g, [L / 2, H], [L, b / 2], b, m, v);
    for (let i = 1; i < n; i++) {
      const x = (i * L) / n;
      member(g, [x, b / 2], [x, topAt(x)], b * 0.8, m, v);
      const xn = ((i + (x < L / 2 ? -1 : 1)) * L) / n;
      member(g, [x, b / 2], [xn, topAt(xn)], b * 0.8, m, v);
    }
  }

  function buildRailing(g, length, t, h, color, x0, y0, z0, alongY = false) {
    const m = mat(color, { metalness: 0.4 });
    const posts = Math.max(2, Math.ceil(length / 1.0) + 1);
    const at = (s, ww, hh, zz, l) => (alongY ? box(ww, l, hh, x0, y0 + s, zz) : box(l, ww, hh, x0 + s, y0, zz));
    for (let i = 0; i < posts; i++) add(g, at((i * (length - t)) / (posts - 1), t, h, z0, t), m, { edges: false });
    add(g, at(0, t, t, z0 + h - t, length), m, { edges: false });
    add(g, at(0, t * 0.6, t * 0.6, z0 + h / 2, length), m, { edges: false });
  }

  function buildPipe(g, el, color) {
    const { length: L, diameter: d } = el.size;
    const geo = new T.CylinderGeometry(d / 2, d / 2, L, 16);
    if (el.params.vertical) {
      geo.rotateX(Math.PI / 2).translate(0, 0, L / 2);
      g.position.set(el.position.x, el.position.y, el.position.z);
    } else {
      geo.rotateZ(-Math.PI / 2).translate(L / 2, 0, 0);
      place(g, el);
    }
    add(g, geo, mat(color, { metalness: 0.5, roughness: 0.4 }), { edges: false });
  }

  // ---------------------------------------------------------------- комната-зона

  function buildZone(g, el) {
    const { length: L, width: W, height: H } = el.size;
    const geo = box(L, W, H);
    const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.08, depthWrite: false }));
    mesh.userData.zone = true;
    g.add(mesh);
    const line = new T.LineSegments(new T.EdgesGeometry(geo), new T.LineBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.6 }));
    line.userData.isEdge = true;
    g.add(line);
    const name = (el.params && el.params.roomName) || el.name;
    const sprite = textSprite(`${name}\n${BS.util.fmt(L * W, 1)} м²`);
    sprite.position.set(L / 2, W / 2, Math.min(H, 1.2));
    g.add(sprite);
  }

  function textSprite(text) {
    const lines = text.split("\n");
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 64 * lines.length + 24;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(10,14,20,0.75)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e3f6ff";
    ctx.font = "bold 44px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    lines.forEach((l, i) => ctx.fillText(l, 256, 58 + i * 64));
    const tex = new T.CanvasTexture(canvas);
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true }));
    sprite.scale.set(2.2, (2.2 * canvas.height) / canvas.width, 1);
    sprite.renderOrder = 5;
    sprite.userData.label = true;
    return sprite;
  }

  // ---------------------------------------------------------------- условные модели

  function buildFixture(g, el, recipe, color) {
    const { length: a, width: b, height: h } = el.size;
    const m = mat(color);
    const m2 = mat(shade(color, 0.75));
    const leg = Math.min(0.05, a / 10, b / 10);
    const legs = (topZ) => {
      for (const [x, y] of [[0, 0], [a - leg, 0], [0, b - leg], [a - leg, b - leg]]) add(g, box(leg, leg, topZ, x, y, 0), m2, { edges: false });
    };
    switch (recipe) {
      case "toilet":
        add(g, box(a * 0.7, b * 0.6, h * 0.5, a * 0.15, b * 0.35, 0), m);
        add(g, box(a, b * 0.22, h, 0, 0, 0), m);
        break;
      case "sink":
        add(g, box(a * 0.3, b * 0.3, h * 0.85, a * 0.35, b * 0.2, 0), m2);
        add(g, box(a, b, h * 0.15, 0, 0, h * 0.85), m);
        break;
      case "bathtub":
        add(g, box(a, b, h), m);
        add(g, box(a - 0.12, b - 0.12, 0.02, 0.06, 0.06, h - 0.1), mat(0x7fb6e0, { roughness: 0.2 }), { edges: false });
        break;
      case "light":
        add(g, box(0.04, 0.04, h * 0.6, a / 2 - 0.02, b / 2 - 0.02, h * 0.4), m2, { edges: false });
        add(g, new T.CylinderGeometry(a / 2, a / 2, h * 0.4, 20).rotateX(Math.PI / 2).translate(a / 2, b / 2, h * 0.2),
          mat(0xfff3c4, { emissive: 0xffd36b, emissiveIntensity: 0.8 }), { edges: false });
        break;
      case "socket":
      case "switch":
        add(g, box(a, b, h), m);
        add(g, box(a * 0.5, 0.005, h * 0.5, a * 0.25, -0.004, h * 0.25), m2, { edges: false });
        break;
      case "bed":
        add(g, box(a, b, h * 0.6), m2);
        add(g, box(a - 0.1, b - 0.06, h * 0.4, 0.05, 0.03, h * 0.6), m);
        add(g, box(0.08, b, h * 1.8, 0, 0, 0), m2);
        break;
      case "table":
        legs(h - 0.04);
        add(g, box(a, b, 0.04, 0, 0, h - 0.04), m2);
        break;
      case "chair":
        legs(h * 0.5);
        add(g, box(a, b, 0.05, 0, 0, h * 0.5), m);
        add(g, box(a, 0.05, h * 0.5, 0, b - 0.05, h * 0.5), m);
        break;
      case "sofa":
        add(g, box(a, b, h * 0.5), m);
        add(g, box(a, b * 0.25, h * 0.5, 0, b * 0.75, h * 0.5), m2);
        add(g, box(0.15, b, h * 0.75, 0, 0, 0), m2);
        add(g, box(0.15, b, h * 0.75, a - 0.15, 0, 0), m2);
        break;
      case "wardrobe":
        add(g, box(a, b, h), m);
        add(g, box(0.01, 0.01, h * 0.9, a / 2, -0.005, h * 0.05), m2, { edges: false });
        break;
      default:
        add(g, box(a, b, h), m);
    }
  }

  BS.meshBuilder = { buildAll, build, proceduralTexture, lookMat, worldUV };
})(globalThis.BuildSense);
