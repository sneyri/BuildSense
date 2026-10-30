// BuildSense · Машиностроение — управление 3D-сценой мышью: манипуляторы перемещения/вращения, режим «Соединить детали»,
// подсветка поверхностей, предпросмотр, панель действий. Логика соединения — в mechConnect.js (без DOM), здесь только
// мышь, Three.js и интерфейс; все изменения идут через существующие edit()/историю mechApp и решатель сборок.
//
//   const ix = BS.mechInteract.create({ T, renderer, scene, camera, controls, host, api });
//   ix.setTool("select"|"connect"), ix.setGizmo("move"|"rotate"), ix.toggleSnap(), ix.update() — каждый кадр
//   ix.connect() / ix.cancel() / ix.confirm() — для горячих клавиш; ix.state() — для тестов и отладки.
// api: { project(), meshes(), selectedId(), select(id), commit(prevJson, label), syncMeshes(), setPreview(map|null),
//        edit(label, fn), status(text, kind), renderAll() }
(function (BS) {
  "use strict";
  const C = BS.mechConnect;
  const A = BS.mechAssembly;
  const M = BS.mechModel;
  const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const COLOR = { x: 0xe5534b, y: 0x3fb950, z: 0x4c8dff, a: 0x4c8dff, b: 0xff9f1a, ok: 0x3fb950, bad: 0xe5534b };
  const SNAP_KEY = "buildsense.mech.snap";

  function create({ T, renderer, scene, camera, controls, host, api }) {
    const dom = renderer.domElement;
    const ray = new T.Raycaster();
    const S = {
      tool: "select", gizmo: "move", snap: true,
      drag: null, hover: null,
      conn: { a: null, b: null, choice: null, gap: 5, flip: false, plan: null, error: null },
    };
    try { S.snap = localStorage.getItem(SNAP_KEY) !== "off"; } catch { /* не критично */ }

    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const btn = (label, title, onclick, cls = "") => { const b = el("button", cls, label); b.type = "button"; b.title = title; b.addEventListener("click", onclick); return b; };

    // ================================================================== сцена: манипулятор, подсветка, маркер
    const gizmoGroup = new T.Group();
    const hlGroup = new T.Group();
    const marker = new T.Mesh(new T.SphereGeometry(1, 16, 12), new T.MeshBasicMaterial({ color: 0xffd166, depthTest: false }));
    marker.renderOrder = 30; marker.visible = false;
    gizmoGroup.visible = false;
    scene.add(gizmoGroup, hlGroup, marker);
    const pickables = [];

    function buildGizmo(mode) {
      gizmoGroup.clear();
      pickables.length = 0;
      for (const ax of ["x", "y", "z"]) {
        const mat = new T.MeshBasicMaterial({ color: COLOR[ax], depthTest: false, transparent: true, opacity: 0.95 });
        const dir = new T.Vector3(...AX[ax]);
        const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
        if (mode === "move") {
          const shaft = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.8, 10).translate(0, 0.4, 0), mat);
          const head = new T.Mesh(new T.ConeGeometry(0.11, 0.26, 16).translate(0, 0.93, 0), mat);
          const hit = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 1.1, 8).translate(0, 0.62, 0), new T.MeshBasicMaterial({ visible: false }));
          for (const m of [shaft, head, hit]) { m.quaternion.copy(q); m.renderOrder = 20; m.userData.axis = ax; gizmoGroup.add(m); }
          pickables.push(hit, shaft, head);
        } else {
          const ring = new T.Mesh(new T.TorusGeometry(0.85, 0.028, 8, 64), mat);
          ring.quaternion.copy(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), dir));
          const hit = new T.Mesh(new T.TorusGeometry(0.85, 0.11, 8, 48), new T.MeshBasicMaterial({ visible: false }));
          hit.quaternion.copy(ring.quaternion);
          for (const m of [ring, hit]) { m.renderOrder = 20; m.userData.axis = ax; gizmoGroup.add(m); }
          pickables.push(hit, ring);
        }
      }
    }
    buildGizmo("move");

    function partCenter(part) {
      const b = M.worldBounds(part);
      return new T.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    }

    /** Размер манипулятора постоянен на экране (≈ 90 px). */
    function placeGizmo() {
      const id = api.selectedId();
      const part = id && api.project().parts.find((p) => p.id === id);
      const visible = Boolean(part) && S.tool === "select" && S.gizmo !== "none";
      gizmoGroup.visible = visible;
      if (!visible) return;
      const c = partCenter(part);
      gizmoGroup.position.copy(c);
      const dist = camera.isPerspectiveCamera ? camera.position.distanceTo(c) : (camera.top - camera.bottom) / camera.zoom * 1.8;
      const k = camera.isPerspectiveCamera ? 2 * Math.tan((camera.fov * Math.PI) / 360) * dist * (90 / Math.max(1, renderer.domElement.clientHeight)) : 90 / Math.max(1, renderer.domElement.clientHeight) * dist;
      gizmoGroup.scale.setScalar(k);
    }

    function setMouse(e) {
      const r = dom.getBoundingClientRect();
      ray.setFromCamera(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    }
    const partHit = () => ray.intersectObjects([...api.meshes().values()].map((m) => m.mesh), false)[0] || null;

    // ================================================================== панели интерфейса
    const strip = el("div", "ix-strip");
    const tools = {};
    const mk = (id, label, key, title, run) => { const b = btn(`${label}`, `${title} (${key})`, run, "ix-tool"); b.dataset.tool = id; const k = el("kbd", "", key); b.append(k); tools[id] = b; strip.append(b); return b; };
    mk("select", "Выбрать", "V", "Выбор детали", () => setTool("select"));
    mk("move", "Переместить", "G", "Стрелки перемещения по осям", () => { setTool("select"); setGizmo("move"); });
    mk("rotate", "Повернуть", "R", "Дуги вращения вокруг осей", () => { setTool("select"); setGizmo("rotate"); });
    mk("connect", "Соединить детали", "J", "Выбрать поверхности двух деталей и соединить", () => connect());
    mk("fix", "Закрепить на месте", "K", "Закрепить / снять закрепление выбранной детали", () => api.toggleFixed());
    mk("snap", "Привязки", "X", "Включить / выключить привязки", () => toggleSnap());
    host.append(strip);

    const tip = el("div", "ix-tip"); tip.hidden = true; host.append(tip);
    const bar = el("div", "ix-bar"); bar.hidden = true; host.append(bar); // «деталь заблокирована сопряжениями» + действия
    const panel = el("aside", "ix-panel"); panel.hidden = true; host.append(panel);

    function refreshStrip() {
      const on = { select: S.tool === "select" && S.gizmo === "none", move: S.tool === "select" && S.gizmo === "move", rotate: S.tool === "select" && S.gizmo === "rotate", connect: S.tool === "connect", snap: S.snap, fix: false };
      const id = api.selectedId();
      const cp = id && A.componentOfPart(api.project(), id);
      on.fix = Boolean(cp && cp.comp.fixed);
      for (const [k, b] of Object.entries(tools)) { b.classList.toggle("on", Boolean(on[k])); b.setAttribute("aria-pressed", String(Boolean(on[k]))); }
      tools.fix.disabled = !id;
      dom.style.cursor = S.tool === "connect" ? "crosshair" : "";
      BS.events.emit("mech:ui"); // для визуального обучения
    }

    function setTool(t) {
      if (S.tool === t) return;
      if (S.tool === "connect") resetConnect(true);
      S.tool = t;
      if (t === "select" && S.gizmo === "none") S.gizmo = "move";
      if (t === "connect") {
        resetConnect(false);
        BS.hints && BS.hints.once("mech.connect", "Выберите поверхность первой детали, затем поверхность второй — BuildSense предложит способ соединения и покажет, как детали встанут.");
        api.status("Соединить детали: наведите мышь на торец, цилиндр или отверстие первой детали и щёлкните.");
      }
      renderPanel();
      refreshStrip();
    }
    function setGizmo(g) {
      S.gizmo = g;
      buildGizmo(g === "rotate" ? "rotate" : "move");
      if (g === "select") S.gizmo = "none";
      refreshStrip();
    }
    function toggleSnap() {
      S.snap = !S.snap;
      try { localStorage.setItem(SNAP_KEY, S.snap ? "on" : "off"); } catch { /* не критично */ }
      refreshStrip();
      api.status(S.snap ? "Привязки включены: маркеры центров и осей, шаг перемещения 1 мм, поворот 5°" : "Привязки выключены: точное перемещение без округления");
    }

    // ================================================================== блокировка: деталь держат сопряжения
    function showLock(part, rule) {
      bar.replaceChildren(el("span", "ix-bar-text", rule.reason));
      for (const a of rule.actions) {
        bar.append(btn(a.label, a.label, () => {
          bar.hidden = true;
          if (a.id === "move-anchor") {
            const cp = A.componentOfPart(api.project(), part.id);
            const anchor = cp && cp.asm.components.find((c) => c.fixed);
            const p = anchor && api.project().parts.find((x) => x.id === anchor.partId);
            if (p) { api.select(p.id); api.status(`Выбрана закреплённая «${p.name}»: потяните её — вместе с ней поедет вся сборка.`); }
            else api.status("В этой сборке нет закреплённой детали. Закрепите одну деталь (K) или отключите соединения.", "warn");
            return;
          }
          api.edit(a.label, (pr) => C.resolveLock(pr, part.id, a.id));
          api.status(a.id === "suppress" ? `Соединения «${part.name}» отключены: деталь можно двигать. Включить обратно можно в её сопряжениях.` : `«${part.name}» убрана из сборки.`, "ok");
        }, a.id === "suppress" ? "primary" : ""));
      }
      bar.append(btn("Закрыть", "Закрыть", () => { bar.hidden = true; }, "ghost"));
      bar.hidden = false;
      api.status(rule.reason, "warn");
    }

    // ================================================================== перетаскивание манипулятора
    function axisParam(axisDir, origin) { // положение на оси под лучом (ближайшая точка двух прямых)
      const d1 = ray.ray.direction, p1 = ray.ray.origin, d2 = axisDir, p2 = origin;
      const w = new T.Vector3().subVectors(p1, p2);
      const a = d1.dot(d1), b = d1.dot(d2), c = d2.dot(d2), d = d1.dot(w), e = d2.dot(w);
      const den = a * c - b * b;
      return Math.abs(den) < 1e-9 ? 0 : (a * e - b * d) / den;
    }

    function startGizmoDrag(e, hit) {
      const part = api.project().parts.find((p) => p.id === api.selectedId());
      if (!part) return false;
      const rule = C.moveRule(api.project(), part.id);
      if (rule.mode === "mated") { showLock(part, rule); return true; }
      if (rule.reason) api.status(rule.reason, "warn");
      const ax = hit.object.userData.axis;
      const center = partCenter(part);
      const dir = new T.Vector3(...AX[ax]);
      const d = { ax, dir, part, snapshot: JSON.stringify(api.project()), origin: JSON.parse(JSON.stringify(part.placement)), center: center.clone(), moved: false, mode: S.gizmo === "rotate" ? "rotate" : "move", sx: e.clientX, sy: e.clientY };
      if (d.mode === "move") d.t0 = axisParam(dir, center);
      else {
        const plane = new T.Plane().setFromNormalAndCoplanarPoint(dir, center);
        const p = ray.ray.intersectPlane(plane, new T.Vector3());
        d.plane = plane;
        d.v0 = p ? p.clone().sub(center) : new T.Vector3(1, 0, 0);
        d.R0 = M.rotationMatrix(part.placement.rotation);
      }
      S.drag = d;
      try { dom.setPointerCapture(e.pointerId); } catch { /* синтетическое событие */ }
      return true;
    }

    function dragMove(e) {
      const d = S.drag;
      if (!d || (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3)) return;
      setMouse(e);
      const pl = d.part.placement;
      let text;
      if (d.mode === "move") {
        let delta = axisParam(d.dir, d.center) - d.t0;
        if (S.snap) delta = Math.round(delta);
        pl.x = d.origin.x + AX[d.ax][0] * delta; pl.y = d.origin.y + AX[d.ax][1] * delta; pl.z = d.origin.z + AX[d.ax][2] * delta;
        text = `${d.ax.toUpperCase()}: ${delta >= 0 ? "+" : ""}${fmt(delta)} мм → X ${fmt(pl.x)} · Y ${fmt(pl.y)} · Z ${fmt(pl.z)}`;
      } else {
        const p = ray.ray.intersectPlane(d.plane, new T.Vector3());
        if (!p) return;
        const v = p.sub(d.center);
        let ang = Math.atan2(new T.Vector3().crossVectors(d.v0, v).dot(d.dir), d.v0.dot(v));
        let deg = (ang * 180) / Math.PI;
        if (S.snap) deg = Math.round(deg / 5) * 5;
        ang = (deg * Math.PI) / 180;
        // новая ориентация = поворот вокруг мировой оси · старая; положение — вокруг центра габарита
        const k = AX[d.ax], c = Math.cos(ang), s = Math.sin(ang);
        const Rw = [
          [c + k[0] * k[0] * (1 - c), k[0] * k[1] * (1 - c) - k[2] * s, k[0] * k[2] * (1 - c) + k[1] * s],
          [k[1] * k[0] * (1 - c) + k[2] * s, c + k[1] * k[1] * (1 - c), k[1] * k[2] * (1 - c) - k[0] * s],
          [k[2] * k[0] * (1 - c) - k[1] * s, k[2] * k[1] * (1 - c) + k[0] * s, c + k[2] * k[2] * (1 - c)],
        ];
        const mm = (X, Y) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => X[i][0] * Y[0][j] + X[i][1] * Y[1][j] + X[i][2] * Y[2][j]));
        const R1 = mm(Rw, d.R0);
        const e1 = A.eulerXYZ(R1);
        const o = [d.origin.x - d.center.x, d.origin.y - d.center.y, d.origin.z - d.center.z];
        pl.x = d.center.x + Rw[0][0] * o[0] + Rw[0][1] * o[1] + Rw[0][2] * o[2];
        pl.y = d.center.y + Rw[1][0] * o[0] + Rw[1][1] * o[1] + Rw[1][2] * o[2];
        pl.z = d.center.z + Rw[2][0] * o[0] + Rw[2][1] * o[1] + Rw[2][2] * o[2];
        pl.rotation = e1;
        text = `Поворот вокруг ${d.ax.toUpperCase()}: ${fmt(deg)}°`;
      }
      d.moved = true;
      api.syncMeshes();
      showTip(e, text);
    }

    function endDrag(e, commit) {
      const d = S.drag;
      if (!d) return;
      S.drag = null;
      try { dom.releasePointerCapture(e.pointerId); } catch { /* не захвачен */ }
      tip.hidden = true;
      if (!d.moved) return;
      if (commit) {
        api.commit(d.snapshot, d.mode === "move" ? `Переместить: ${d.part.name}` : `Повернуть: ${d.part.name}`);
        api.status(`${d.part.name}: готово. Ctrl+Z — отменить.`, "ok");
      } else {
        api.restore(d.snapshot);
        api.status("Операция отменена, деталь вернулась на место.");
      }
    }

    function showTip(e, text) {
      const r = host.getBoundingClientRect();
      tip.textContent = text;
      tip.hidden = false;
      tip.style.left = `${Math.min(e.clientX - r.left + 16, r.width - 240)}px`;
      tip.style.top = `${Math.max(8, e.clientY - r.top - 34)}px`;
    }

    // ================================================================== режим «Соединить детали»
    const fmt = (v, d = 2) => String(Math.round(v * 10 ** d) / 10 ** d).replace(".", ",");

    function classify(hit) {
      const part = api.project().parts.find((p) => p.id === hit.object.userData.partId);
      if (!part) return null;
      const lp = hit.object.worldToLocal(hit.point.clone());
      const ln = hit.face.normal.clone();
      const c = C.classifyHit(part, [lp.x, lp.y, lp.z], [ln.x, ln.y, ln.z]);
      return { part, cls: c, local: lp };
    }

    function clearHl() { hlGroup.clear(); marker.visible = false; }

    /** Подсветить поверхность: плоскость — кольцо, цилиндр — оболочка + ось. Цвет: первая деталь синяя, вторая оранжевая. */
    function drawHl(part, cls, color, opacity = 0.5) {
      const g = new T.Group();
      g.matrixAutoUpdate = false;
      g.matrix.copy(BS.mechGeometry.partMatrix(part));
      const mat = new T.MeshBasicMaterial({ color, transparent: true, opacity, side: T.DoubleSide, depthTest: false });
      if (cls.kind === "plane") {
        const ring = new T.Mesh(new T.RingGeometry(Math.max(cls.rIn, 0.01), cls.rOut, 64), mat);
        ring.position.z = cls.z;
        ring.renderOrder = 25;
        g.add(ring);
        g.add(arrow(T, [0, 0, cls.z], [0, 0, cls.n], Math.max(cls.rOut * 0.6, 8), color));
      } else if (cls.kind === "cylinder") {
        const h = Math.max(cls.z1 - cls.z0, 0.01);
        const cyl = new T.Mesh(new T.CylinderGeometry(cls.r, cls.r, h, 48, 1, true).rotateX(Math.PI / 2).translate(0, 0, cls.z0 + h / 2), mat);
        cyl.renderOrder = 25;
        g.add(cyl);
        const axis = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, cls.z0 - 6), new T.Vector3(0, 0, cls.z1 + 6)]), new T.LineDashedMaterial({ color, dashSize: 3, gapSize: 2, depthTest: false }));
        axis.computeLineDistances(); axis.renderOrder = 26;
        g.add(axis);
      }
      hlGroup.add(g);
    }

    function snapMarker(part, cls, lp) {
      if (!S.snap) { marker.visible = false; return null; }
      let pt, name;
      if (cls.kind === "plane") { pt = new T.Vector3(0, 0, cls.z); name = "центр торца"; }
      else if (cls.kind === "cylinder") { pt = new T.Vector3(0, 0, lp.z); name = "ось цилиндра"; }
      else return null;
      const w = pt.applyMatrix4(BS.mechGeometry.partMatrix(part));
      marker.position.copy(w);
      marker.scale.setScalar(Math.max(1.2, camera.position.distanceTo(w) * 0.012));
      marker.visible = true;
      return name;
    }

    function connHover(e) {
      setMouse(e);
      const hit = partHit();
      clearHl();
      redrawChosen();
      if (!hit) { tip.hidden = true; return; }
      const info = classify(hit);
      if (!info) return;
      const { part, cls } = info;
      const sideB = S.conn.a && !S.conn.b;
      const color = sideB ? COLOR.b : COLOR.a;
      if (cls.kind === "plane" || cls.kind === "cylinder") {
        drawHl(part, cls, color, 0.35);
        const snapName = snapMarker(part, cls, info.local);
        showTip(e, `${part.name}: ${cls.plain || cls.label}${snapName ? ` · привязка: ${snapName}` : ""}`);
      } else {
        showTip(e, cls.reason || "Эту поверхность выбрать нельзя");
      }
    }

    function redrawChosen() {
      const proj = api.project();
      for (const [sel, color] of [[S.conn.a, COLOR.a], [S.conn.b, COLOR.b]]) {
        if (!sel) continue;
        const part = proj.parts.find((p) => p.id === sel.partId);
        if (part) drawHl(part, sel, color, 0.55);
      }
    }

    function connClick(e) {
      setMouse(e);
      const hit = partHit();
      if (!hit) { api.status("Щёлкните по детали — по торцу, цилиндру или отверстию.", "warn"); return; }
      const info = classify(hit);
      if (!info) return;
      const { part, cls } = info;
      if (cls.kind !== "plane" && cls.kind !== "cylinder") {
        S.conn.error = cls.reason || "Эту поверхность выбрать нельзя. Выберите торец, цилиндр или отверстие.";
        api.status(S.conn.error, "warn");
        renderPanel();
        return;
      }
      S.conn.error = null;
      if (!S.conn.a || S.conn.b) {
        S.conn = { a: { ...cls, partName: part.name }, b: null, choice: null, gap: 5, flip: false, plan: null, error: null };
        api.setPreview(null);
        api.select(part.id);
        api.status(`Первая деталь: «${part.name}», ${cls.plain || cls.label}. Теперь щёлкните поверхность второй детали.`);
      } else {
        if (cls.partId === S.conn.a.partId) { S.conn.error = "Это та же деталь. Выберите поверхность второй детали."; renderPanel(); return; }
        S.conn.b = { ...cls, partName: part.name };
        const prop = C.proposals(S.conn.a, S.conn.b);
        if (!prop.choices.length) { S.conn.error = prop.reason; S.conn.b = null; api.status(prop.reason, "warn"); }
        else { S.conn.choice = prop.choices[0].id; recompute(); }
      }
      clearHl(); redrawChosen();
      renderPanel();
    }

    function recompute() {
      const c = S.conn;
      if (!c.a || !c.b || !c.choice) { c.plan = null; api.setPreview(null); return; }
      c.plan = C.plan(api.project(), c.a, c.b, c.choice, { gap: c.gap, flip: c.flip });
      c.error = c.plan.ok ? null : c.plan.error;
      api.setPreview(c.plan.ok ? c.plan.placements : null, c.plan.ok ? c.plan.moverId : null);
      if (c.plan.ok) api.status(`Предпросмотр: «${c.plan.moverName}» встанет так, как показано. Нажмите «Применить» (Enter) или «Отмена» (Esc).`);
      else api.status(c.error, "warn");
    }

    function resetConnect(leave) {
      S.conn = { a: null, b: null, choice: null, gap: 5, flip: false, plan: null, error: null };
      api.setPreview(null);
      clearHl();
      tip.hidden = true;
      if (!leave) renderPanel();
    }

    function confirm() {
      if (S.tool !== "connect") return false;
      const c = S.conn;
      if (!c.plan || !c.plan.ok) { api.status(c.error || "Сначала выберите поверхности двух деталей.", "warn"); return true; }
      const trial = C.plan(api.project(), c.a, c.b, c.choice, { gap: c.gap, flip: c.flip });
      if (!trial.ok) { c.error = trial.error; renderPanel(); api.status(trial.error, "warn"); return true; }
      let res;
      api.setPreview(null);
      api.edit(`Соединить: ${c.a.partName} ↔ ${c.b.partName}`, (pr) => { res = C.apply(pr, c.a, c.b, c.choice, { gap: c.gap, flip: c.flip }); });
      if (!res || !res.ok) { api.status((res && res.error) || "Не удалось соединить", "error"); return true; }
      const name = trial.moverName;
      let text, kind = "ok";
      if (res.status === "solved") text = `Готово: «${name}» соединена и стоит на месте. Решатель подтвердил положение.`;
      else if (res.status === "partial") { text = `Соединено частично: «${name}» ещё может двигаться вдоль оси. Добавьте ещё одно соединение, например «Прижать поверхности».`; kind = "warn"; }
      else { text = `Соединение добавлено, статус детали: ${res.status}. Проверьте сборку.`; kind = "warn"; }
      if (res.interference && res.interference.length) {
        const m = (res.messages || []).find((x) => /пересека/.test(x));
        text += ` Внимание: ${m || "детали пересекаются — проверьте размеры и выбранные поверхности"}`;
        kind = "warn";
      }
      api.status(text, kind);
      resetConnect(false);
      return true;
    }

    function cancel() {
      if (S.drag) { endDrag({ pointerId: 0 }, false); return true; }
      if (S.tool === "connect") {
        const had = Boolean(S.conn.a);
        if (had) { resetConnect(false); api.status("Выбор сброшен."); } else { setTool("select"); api.status("Режим «Соединить детали» закрыт."); }
        return true;
      }
      if (!bar.hidden) { bar.hidden = true; return true; }
      return false;
    }

    function renderPanel() {
      if (S.tool !== "connect") { panel.hidden = true; return; }
      const c = S.conn;
      const rows = [el("div", "ix-ph", "Соединить детали")];
      const step = !c.a ? "Шаг 1 из 2: щёлкните поверхность первой детали (торец, цилиндр или отверстие)."
        : !c.b ? "Шаг 2 из 2: щёлкните поверхность второй детали." : "Выберите способ и проверьте предпросмотр.";
      rows.push(el("p", "ix-step", step));
      const chip = (n, sel, cls) => { const d = el("div", `ix-chip ${cls}`); d.append(el("b", "", n), ` ${sel ? `${sel.partName}: ${sel.plain || sel.label}` : "—"}`); return d; };
      rows.push(chip("1", c.a, "a"), chip("2", c.b, "b"));
      if (c.a && c.b) {
        const prop = C.proposals(c.a, c.b);
        const list = el("div", "ix-choices");
        for (const ch of prop.choices) {
          const lab = el("label", "ix-choice");
          const r = el("input"); r.type = "radio"; r.name = "ix-choice"; r.checked = c.choice === ch.id;
          r.addEventListener("change", () => { c.choice = ch.id; recompute(); renderPanel(); });
          const t = el("span", "", ""); t.append(el("b", "", ch.label), el("small", "", ch.sub));
          t.title = `Техническое название: ${ch.tech}`;
          lab.append(r, t); list.append(lab);
        }
        rows.push(list);
        if (c.choice === "gap") {
          const f = el("label", "ix-field"); f.append("Зазор, мм ");
          const i = el("input"); i.type = "number"; i.step = "0.5"; i.value = String(c.gap);
          i.addEventListener("input", () => { const v = Number(i.value.replace(",", ".")); if (Number.isFinite(v) && v >= 0) { c.gap = v; recompute(); refreshInfo(); } });
          f.append(i); rows.push(f);
        }
        if (c.choice === "axes") {
          const f = el("label", "ix-field"); const cb = el("input"); cb.type = "checkbox"; cb.checked = c.flip;
          cb.addEventListener("change", () => { c.flip = cb.checked; recompute(); renderPanel(); });
          f.append(cb, " Развернуть деталь другой стороной"); rows.push(f);
        }
        if (prop.note) rows.push(el("p", "ix-note", prop.note));
      }
      const info = el("div", "ix-info"); info.id = "ix-info"; rows.push(info);
      const err = el("div", "ix-err"); err.setAttribute("role", "alert"); err.textContent = c.error || ""; rows.push(err);
      const act = el("div", "ix-actions");
      const ok = btn("Применить", "Применить соединение (Enter)", () => confirm(), "primary"); ok.disabled = !(c.plan && c.plan.ok);
      act.append(ok, btn("Сбросить выбор", "Выбрать поверхности заново", () => { resetConnect(false); }), btn("Отмена", "Закрыть режим (Esc)", () => setTool("select"), "ghost"));
      rows.push(act);
      panel.replaceChildren(...rows);
      panel.hidden = false;
      refreshInfo();
    }

    function refreshInfo() {
      const n = panel.querySelector("#ix-info");
      const p = S.conn.plan;
      if (!n) return;
      if (!p || !p.ok) { n.textContent = ""; return; }
      const parts = [];
      if (p.info.before != null) parts.push(`Сейчас между выбранными элементами: ${fmt(p.info.before, 1)} мм`);
      if (p.info.after != null) parts.push(`после соединения: ${fmt(p.info.after, 2)} мм`);
      let t = parts.join(" → ");
      t += `${t ? "\n" : ""}Поедет «${p.moverName}»; «${A.partOf ? (api.project().parts.find((x) => x.id === p.anchorId) || {}).name : ""}» остаётся на месте.`;
      if (p.info.createsAssembly) t += "\nБудет создана новая сборка, первая деталь станет закреплённой.";
      if (p.status === "partial") t += "\nДеталь будет определена не полностью: она сможет двигаться вдоль оси.";
      if (p.interference && p.interference.length) t += "\nВнимание: детали будут пересекаться.";
      n.textContent = t;
    }

    // ================================================================== события мыши
    dom.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      setMouse(e);
      if (S.tool === "connect") {
        S.connDown = { x: e.clientX, y: e.clientY };
        // нажатие на деталь — это выбор поверхности, камера при этом не вращается (иначе при движении мыши сцена уезжает);
        // вращать можно, зажав левую кнопку на пустом месте, а также правой/средней кнопкой и колесом
        if (partHit()) e.stopImmediatePropagation();
        return;
      }
      if (gizmoGroup.visible) {
        const hit = ray.intersectObjects(pickables, false)[0];
        if (hit) { e.stopImmediatePropagation(); startGizmoDrag(e, hit); }
      }
    }, true);
    dom.addEventListener("pointermove", (e) => {
      if (S.drag) { dragMove(e); return; }
      if (S.tool === "connect") { connHover(e); return; }
      if (gizmoGroup.visible && !(e.buttons & 1)) {
        setMouse(e);
        dom.style.cursor = ray.intersectObjects(pickables, false)[0] ? "grab" : "";
      }
    });
    dom.addEventListener("pointerup", (e) => {
      if (S.drag) { endDrag(e, true); e.stopImmediatePropagation(); return; }
      if (S.tool === "connect" && S.connDown && e.button === 0) {
        const moved = Math.hypot(e.clientX - S.connDown.x, e.clientY - S.connDown.y);
        S.connDown = null;
        if (moved < 5) { e.stopImmediatePropagation(); connClick(e); }
      }
    }, true);
    dom.addEventListener("pointerleave", () => { if (S.tool === "connect") { clearHl(); redrawChosen(); tip.hidden = true; } });

    refreshStrip();
    return {
      setTool, setGizmo, toggleSnap, confirm, cancel,
      connect: () => (S.tool === "connect" ? setTool("select") : setTool("connect")),
      update() { placeGizmo(); },
      refresh() { refreshStrip(); if (S.tool === "connect") renderPanel(); },
      hideLock() { bar.hidden = true; },
      showLock,
      /**
       * Где на экране видна поверхность детали нужного вида (для подсветки в обучении): сканируем сетку лучей по габариту детали
       * и берём попадание, которое классифицируется как want = { kind: "plane"|"cylinder", ref? }. Нет видимой — null.
       */
      surfaceRect(partId, want) {
        const rec = api.meshes().get(partId);
        const part = api.project().parts.find((p) => p.id === partId);
        if (!rec || !part) return null;
        const box = new T.Box3().setFromObject(rec.mesh);
        const r = dom.getBoundingClientRect();
        const corners = [];
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new T.Vector3(x, y, z).project(camera));
        const xs = corners.map((v) => v.x), ys = corners.map((v) => v.y);
        const x0 = Math.max(-1, Math.min(...xs)), x1 = Math.min(1, Math.max(...xs)), y0 = Math.max(-1, Math.min(...ys)), y1 = Math.min(1, Math.max(...ys));
        if (!(x1 > x0 && y1 > y0)) return null;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        let best = null;
        const N = 14;
        for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
          const nx = x0 + ((x1 - x0) * i) / N, ny = y0 + ((y1 - y0) * j) / N;
          ray.setFromCamera(new T.Vector2(nx, ny), camera);
          const hit = ray.intersectObjects([...api.meshes().values()].map((m) => m.mesh), false)[0];
          if (!hit || hit.object.userData.partId !== partId) continue;
          const lp = hit.object.worldToLocal(hit.point.clone());
          const ln = hit.face.normal;
          const cls = C.classifyHit(part, [lp.x, lp.y, lp.z], [ln.x, ln.y, ln.z]);
          if (cls.kind !== want.kind || (want.ref && cls.ref !== want.ref)) continue;
          const d = Math.hypot(nx - cx, ny - cy);
          if (!best || d < best.d) best = { d, nx, ny };
        }
        if (!best) return null;
        const px = r.left + ((best.nx + 1) / 2) * r.width, py = r.top + ((1 - best.ny) / 2) * r.height;
        return { x: px - 22, y: py - 22, w: 44, h: 44 };
      },
      /** Экранные координаты (CSS px) середины стрелки/дуги оси — для автотестов в браузере. */
      gizmoPoint: (ax) => { const g = gizmoGroup; const k = g.scale.x; const d = S.gizmo === "rotate" ? new T.Vector3(...AX[ax === "x" ? "y" : ax === "y" ? "z" : "x"]).multiplyScalar(0.85 * k) : new T.Vector3(...AX[ax]).multiplyScalar(0.6 * k); const v = g.position.clone().add(d).project(camera); const r = dom.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
      snapEnabled: () => S.snap,
      state: () => ({ tool: S.tool, gizmo: S.gizmo, snap: S.snap, conn: S.conn, dragging: Boolean(S.drag), gizmoVisible: gizmoGroup.visible }),
      // для автотестов в браузере: клик по поверхности без мыши
      _pick: (cls) => { // имитировать выбор уже классифицированной поверхности
        const part = api.project().parts.find((p) => p.id === cls.partId);
        if (!S.conn.a || S.conn.b) { S.conn = { a: { ...cls, partName: part.name }, b: null, choice: null, gap: 5, flip: false, plan: null, error: null }; }
        else { S.conn.b = { ...cls, partName: part.name }; const pr = C.proposals(S.conn.a, S.conn.b); if (pr.choices.length) { S.conn.choice = pr.choices[0].id; recompute(); } else S.conn.error = pr.reason; }
        renderPanel();
      },
    };
  }

  function arrow(T, from, dir, len, color) {
    const g = new T.Group();
    const d = new T.Vector3(...dir).normalize();
    const mat = new T.MeshBasicMaterial({ color, depthTest: false });
    const shaft = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, len, 8).translate(0, len / 2, 0), mat);
    const head = new T.Mesh(new T.ConeGeometry(1.2, 3.5, 12).translate(0, len + 1.7, 0), mat);
    for (const m of [shaft, head]) { m.renderOrder = 27; g.add(m); }
    g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d);
    g.position.set(...from);
    return g;
  }

  BS.mechInteract = { create };
})(globalThis.BuildSense);
