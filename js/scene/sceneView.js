// 3D-сцена: рендерер, перспективная и ортографическая камеры, управление мышью, сетка участка,
// выбор объектов, подсветка (выделение, проблемы, симуляция), изоляция и скрытие категорий.
// Сцена не знает структуры проекта — она показывает объекты из meshBuilder.
(function (BS) {
  "use strict";
  const T = THREE;
  (T.Object3D.DEFAULT_UP || T.Object3D.DefaultUp).set(0, 0, 1); // ось Z вверх, как в FreeCAD

  const COLORS = {
    selected: new T.Color(0x3d7dff),
    error: new T.Color(0xff2020),
    warning: new T.Color(0xff9900),
    failed: new T.Color(0xff1a1a),
    damaged: new T.Color(0xffa000),
    impact: new T.Color(0x9b5cff),
    none: new T.Color(0x000000),
  };

  class SceneView {
    constructor(container, { onPick } = {}) {
      this.container = container;
      this.onPick = onPick || (() => {});
      this.pickEnabled = true;
      this.hiddenGroups = new Set();
      this.isolateIds = null;
      this.selectedIds = new Set();
      this.issues = new Map();
      this.simStates = new Map();
      this.frameCallbacks = new Set();

      this.renderer = new T.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;
      container.prepend(this.renderer.domElement);

      this.scene = new T.Scene();
      this.persp = new T.PerspectiveCamera(45, 1, 0.05, 3000);
      this.persp.up.set(0, 0, 1);
      this.ortho = new T.OrthographicCamera(-10, 10, 10, -10, -500, 3000);
      this.ortho.up.set(0, 0, 1);
      this.camera = this.persp;
      this.camera.position.set(18, -22, 16);
      this.controls = this._makeControls(this.camera, new T.Vector3(5, 4, 1));

      this._addEnvironment();
      this.modelGroup = new T.Group();
      this.scene.add(this.modelGroup);
      this.overlay = new T.Group();
      this.scene.add(this.overlay);

      this._raycaster = new T.Raycaster();
      this._pointer = new T.Vector2();
      this._bindPicking();
      new ResizeObserver(() => this.resize()).observe(container);
      this.resize();
      this.setTheme(true);

      const loop = () => {
        this.controls.update();
        for (const cb of this.frameCallbacks) cb();
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    _makeControls(camera, target) {
      if (this.controls) this.controls.dispose();
      const c = new T.OrbitControls(camera, this.renderer.domElement);
      c.enableDamping = true;
      c.dampingFactor = 0.12;
      c.maxPolarAngle = Math.PI * 0.495;
      c.target.copy(target);
      c.screenSpacePanning = true;
      return c;
    }

    _addEnvironment() {
      this.hemi = new T.HemisphereLight(0xf4f8ff, 0x6b705c, 0.75);
      this.hemi.position.set(0, 0, 1);
      this.scene.add(this.hemi);
      const sun = new T.DirectionalLight(0xffffff, 0.75);
      sun.position.set(-14, -22, 30);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0005;
      Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
      this.sun = sun;
      this.scene.add(sun, sun.target);
      this.ground = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshStandardMaterial({ color: 0x55604f, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }));
      this.ground.receiveShadow = true;
      this.ground.position.z = -0.005;
      this.scene.add(this.ground);
      this.setSite({ x: -10, y: -10, length: 40, width: 40 });
      const axes = new T.AxesHelper(1.2);
      axes.position.z = 0.01;
      this.scene.add(axes);
    }

    /** Строительная сетка и земля по границам участка; шаг основной сетки — 1 м. */
    setSite(site) {
      if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); }
      const size = Math.max(site.length, site.width);
      const grid = new T.GridHelper(size, Math.round(size), 0x7d8a99, 0x46505e);
      grid.rotation.x = Math.PI / 2;
      grid.position.set(site.x + size / 2, site.y + size / 2, 0.002);
      grid.material.transparent = true;
      grid.material.opacity = 0.45;
      this.grid = grid;
      this.scene.add(grid);
      this.ground.scale.set(site.length, site.width, 1);
      this.ground.position.set(site.x + site.length / 2, site.y + site.width / 2, -0.005);
    }

    setTheme(dark) {
      this.scene.background = new T.Color(dark ? 0x161b22 : 0xdfe7ee);
      this.ground.material.color.set(dark ? 0x3e4a3d : 0xc9d6c2);
    }

    _bindPicking() {
      const el = this.renderer.domElement;
      let down = null;
      el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
      el.addEventListener("pointerup", (e) => {
        if (!down || down.b !== 0) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        down = null;
        if (moved > 4 || !this.pickEnabled) return;
        this.onPick(this.pick(e.clientX, e.clientY), e);
      });
    }

    _setRay(cx, cy) {
      const r = this.renderer.domElement.getBoundingClientRect();
      this._pointer.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      this._raycaster.setFromCamera(this._pointer, this.camera);
    }

    pick(cx, cy) {
      const hit = this.pickDetailed(cx, cy);
      return hit ? hit.elementId : null;
    }

    /** Элемент под курсором: сначала твёрдые тела, затем комнаты-зоны. */
    pickDetailed(cx, cy, { types = null } = {}) {
      this._setRay(cx, cy);
      const hits = this._raycaster.intersectObjects(this.modelGroup.children, true);
      let zone = null;
      for (const hit of hits) {
        const o = hit.object;
        if (o.isLineSegments || o.isSprite || !o.visible) continue;
        let g = o;
        while (g && !g.userData.elementId) g = g.parent;
        if (!g || !isVisible(g)) continue;
        if (types && !types.includes(g.userData.elementType)) continue;
        const res = { elementId: g.userData.elementId, elementType: g.userData.elementType, point: hit.point.clone() };
        if (o.userData.zone) { if (!zone) zone = res; continue; }
        return res;
      }
      return zone;
    }

    pointOnPlane(cx, cy, plane = null, z = 0) {
      this._setRay(cx, cy);
      return this._raycaster.ray.intersectPlane(plane || new T.Plane(new T.Vector3(0, 0, 1), -z), new T.Vector3());
    }

    toScreen(point) {
      const v = point.clone().project(this.camera);
      const r = this.renderer.domElement.getBoundingClientRect();
      return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, visible: v.z < 1 && v.z > -1 };
    }

    /** Размер одного пикселя экрана в метрах около точки (для допуска привязки). */
    worldPerPixel(point) {
      const h = this.renderer.domElement.clientHeight || 600;
      if (this.camera.isOrthographicCamera) return (this.camera.top - this.camera.bottom) / this.camera.zoom / h;
      const d = this.camera.position.distanceTo(point);
      return (2 * d * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
    }

    resize() {
      const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
      this.renderer.setSize(w, h, false);
      this.persp.aspect = w / h;
      this.persp.updateProjectionMatrix();
      const half = this._orthoHalf || 12;
      Object.assign(this.ortho, { left: -half * (w / h), right: half * (w / h), top: half, bottom: -half });
      this.ortho.updateProjectionMatrix();
    }

    setObjects(objects) {
      for (const child of [...this.modelGroup.children]) {
        this.modelGroup.remove(child);
        disposeTree(child);
      }
      for (const o of objects) this.modelGroup.add(o);
      this._applyVisibility();
      this._applyColors();
    }

    objectOf(id) {
      return this.modelGroup.children.find((o) => o.userData.elementId === id) || null;
    }

    // ---------------------------------------------------------------- подсветка и видимость

    setSelected(ids) {
      this.selectedIds = new Set(ids || []);
      this._applyColors();
      if (this.isolateIds) this._applyVisibility();
    }

    setIssues(map) {
      this.issues = map || new Map();
      this._applyColors();
    }

    /** Состояния симуляции: id → "failed" | "damaged" | "impact". */
    setSimStates(map) {
      this.simStates = map || new Map();
      this._applyColors();
    }

    _applyColors() {
      this.modelGroup.traverse((o) => {
        if (!o.isMesh || !o.material || !o.material.emissive) return;
        let g = o;
        while (g && !g.userData.elementId) g = g.parent;
        const id = g && g.userData.elementId;
        let c = null, k = 0;
        const sim = this.simStates.get(id);
        if (sim) { c = COLORS[sim]; k = sim === "impact" ? 0.6 : 0.55; }
        else if (this.selectedIds.has(id)) { c = COLORS.selected; k = 0.5; }
        else if (this.issues.get(id)) { c = COLORS[this.issues.get(id)]; k = 0.4; }
        if (o.userData.baseEmissive === undefined) {
          o.userData.baseEmissive = o.material.emissive.getHex();
          o.userData.baseIntensity = o.material.emissiveIntensity;
        }
        if (c) { o.material.emissive.copy(c); o.material.emissiveIntensity = k; }
        else { o.material.emissive.setHex(o.userData.baseEmissive); o.material.emissiveIntensity = o.userData.baseIntensity; }
      });
    }

    setGroupVisible(group, visible) {
      if (visible) this.hiddenGroups.delete(group);
      else this.hiddenGroups.add(group);
      this._applyVisibility();
    }

    setIsolate(ids) {
      this.isolateIds = ids && ids.length ? new Set(ids) : null;
      this._applyVisibility();
    }

    _applyVisibility() {
      for (const o of this.modelGroup.children) {
        let v = !this.hiddenGroups.has(o.userData.group);
        if (o.userData.elementType === "roof" && this.hiddenGroups.has("roof")) v = false;
        if (this.isolateIds) v = this.isolateIds.has(o.userData.elementId);
        o.visible = v;
      }
    }

    // ---------------------------------------------------------------- камера

    modelBounds(ids = null) {
      const box = new T.Box3();
      for (const o of this.modelGroup.children) {
        if (ids && !ids.includes(o.userData.elementId)) continue;
        if (!o.visible && !ids) continue;
        box.expandByObject(o);
      }
      return box.isEmpty() ? null : box;
    }

    setOrtho(on) {
      const target = this.controls.target.clone();
      const from = this.camera;
      const to = on ? this.ortho : this.persp;
      if (from === to) return;
      to.position.copy(from.position);
      const dist = from.position.distanceTo(target);
      if (on) {
        this._orthoHalf = dist * Math.tan((this.persp.fov * Math.PI) / 360);
        this.ortho.zoom = 1;
        this.resize();
      }
      this.camera = to;
      this.controls = this._makeControls(to, target);
    }

    /** Стандартные виды: iso, top (план), front, fit. Для «top» включается ортография. */
    setView(view, ids = null) {
      if (view === "top" && !this.camera.isOrthographicCamera) this.setOrtho(true);
      const box = this.modelBounds(ids) || new T.Box3(new T.Vector3(-5, -5, 0), new T.Vector3(5, 5, 3));
      const center = box.getCenter(new T.Vector3());
      const size = box.getSize(new T.Vector3());
      const radius = Math.max(size.length() / 2, ids ? 1 : 3);
      const dist = (radius / Math.sin((this.persp.fov * Math.PI) / 360)) * 1.1;
      let dir;
      if (view === "top") dir = new T.Vector3(0, -0.001, 1);
      else if (view === "front") dir = new T.Vector3(0, -1, 0.15);
      else if (view === "fit" || view === "focus") dir = this.camera.position.clone().sub(this.controls.target);
      else dir = new T.Vector3(0.9, -1.15, 0.85);
      dir.normalize();
      this.controls.target.copy(center);
      this.camera.position.copy(center).addScaledVector(dir, dist);
      if (this.camera.isOrthographicCamera) {
        this._orthoHalf = radius * 1.15;
        this.ortho.zoom = 1;
        this.resize();
      }
      this.persp.near = Math.max(0.02, dist / 300);
      this.persp.far = dist * 40;
      this.persp.updateProjectionMatrix();
      this.sun.target.position.copy(center);
      this.sun.position.copy(center).add(new T.Vector3(-0.45, -0.7, 1).multiplyScalar(Math.max(radius, 8) * 3));
      const s = this.sun.shadow.camera;
      const R = Math.max(radius, 8) * 1.6;
      Object.assign(s, { left: -R, right: R, top: R, bottom: -R, far: R * 6 });
      s.updateProjectionMatrix();
    }

    /** Наводит камеру на элементы и кратко «мигает» ими. */
    focus(ids) {
      const present = ids.filter((id) => this.objectOf(id));
      if (!present.length) return false;
      this.setView("focus", present);
      return true;
    }
  }

  function isVisible(o) {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  function disposeTree(root) {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    });
  }

  BS.SceneView = SceneView;
  BS.sceneUtil = { disposeTree };
})(globalThis.BuildSense);
