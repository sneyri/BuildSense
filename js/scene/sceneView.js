// 3D-сцена: рендерер, камера, управление, свет и выбор элементов мышью.
// Сцена ничего не знает о структуре проекта — она только показывает
// объекты, которые ей передаёт geometryBuilder.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Ось Z направлена вверх, как в FreeCAD: координаты модели совпадают с координатами сцены.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const SELECT_EMISSIVE = new THREE.Color(0x2f6fff);
const ISSUE_EMISSIVE = { error: new THREE.Color(0xff1a1a), warning: new THREE.Color(0xff9900) };
const NO_EMISSIVE = new THREE.Color(0x000000);

export class SceneView {
  /**
   * @param {HTMLElement} container
   * @param {{ onPick?: (elementId: string | null) => void }} [options]
   */
  constructor(container, options = {}) {
    this.container = container;
    this.onPick = options.onPick || (() => {});
    this.selectedId = null;
    this.hiddenTypes = new Set();
    this.issues = new Map(); // elementId → "error" | "warning"
    this.pickEnabled = true;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdfe7ee);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(18, -20, 14);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495; // не опускать камеру под землю
    this.controls.minDistance = 1;
    this.controls.maxDistance = 400;

    this._addEnvironment();

    this.modelGroup = new THREE.Group();
    this.modelGroup.name = "model";
    this.scene.add(this.modelGroup);

    // Слой для предпросмотра инструментов (не входит в модель и не пересобирается)
    this.overlay = new THREE.Group();
    this.overlay.name = "overlay";
    this.scene.add(this.overlay);

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._downPos = null;
    this._bindPicking();

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    this.resize();

    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  _addEnvironment() {
    const hemi = new THREE.HemisphereLight(0xf4f8ff, 0x8a8f78, 1.1);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-14, -22, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -30; s.right = 30; s.top = 30; s.bottom = -30; s.near = 1; s.far = 100;
    sun.shadow.bias = -0.0005;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      // Полупрозрачная земля: фундамент ниже отметки 0 остаётся виден
      new THREE.MeshStandardMaterial({ color: 0xc9d6c2, roughness: 1, transparent: true, opacity: 0.72, depthWrite: false })
    );
    ground.position.z = -0.01;
    ground.receiveShadow = true;
    ground.name = "ground";
    this.scene.add(ground);

    // GridHelper лежит в плоскости XZ — поворачиваем его в плоскость XY.
    const grid = new THREE.GridHelper(100, 100, 0x8fa39a, 0xb3c2b8);
    grid.rotation.x = Math.PI / 2;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(1.5); // X — красная, Y — зелёная, Z — синяя
    axes.position.z = 0.005;
    this.scene.add(axes);
  }

  _bindPicking() {
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      this._downPos = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener("pointerup", (e) => {
      if (!this._downPos || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - this._downPos.x, e.clientY - this._downPos.y);
      this._downPos = null;
      if (moved > 4 || !this.pickEnabled) return; // это было вращение камеры, а не клик
      this.onPick(this.pick(e.clientX, e.clientY));
    });
  }

  /** Возвращает id элемента под курсором или null. */
  pick(clientX, clientY) {
    return this.pickDetailed(clientX, clientY)?.elementId ?? null;
  }

  /** Элемент под курсором с точкой попадания: { elementId, point } или null. */
  pickDetailed(clientX, clientY, { types = null } = {}) {
    this._setRay(clientX, clientY);
    const hits = this._raycaster.intersectObjects(this.modelGroup.children, true);
    for (const hit of hits) {
      if (hit.object.isLineSegments) continue;
      let obj = hit.object;
      while (obj && !obj.userData.elementId) obj = obj.parent;
      if (!obj || !obj.visible) continue; // скрытые объекты Raycaster не пропускает сам
      if (types && !types.includes(obj.userData.elementType)) continue;
      return { elementId: obj.userData.elementId, elementType: obj.userData.elementType, point: hit.point.clone() };
    }
    return null;
  }

  /** Точка пересечения луча из-под курсора с плоскостью (по умолчанию — горизонтальной на отметке z). */
  pointOnPlane(clientX, clientY, plane = null, z = 0) {
    this._setRay(clientX, clientY);
    const pl = plane || new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
    return this._raycaster.ray.intersectPlane(pl, new THREE.Vector3());
  }

  _setRay(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
  }

  /** Экранные координаты (px внутри области просмотра) для мировой точки. */
  toScreen(point) {
    const v = point.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height, visible: v.z < 1 };
  }

  /** Объект элемента в сцене (для предпросмотра перетаскивания). */
  objectOf(elementId) {
    return this.modelGroup.children.find((o) => o.userData.elementId === elementId) || null;
  }

  setIssues(map) {
    this.issues = map;
    this._applySelection();
  }

  /** Показать или скрыть все элементы данного типа (например, крыши). */
  setTypeVisible(type, visible) {
    if (visible) this.hiddenTypes.delete(type);
    else this.hiddenTypes.add(type);
    for (const obj of this.modelGroup.children) {
      obj.visible = !this.hiddenTypes.has(obj.userData.elementType);
    }
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Заменяет содержимое модели на новые объекты (старые освобождаются). */
  setObjects(objects) {
    for (const child of [...this.modelGroup.children]) {
      this.modelGroup.remove(child);
      disposeObject(child);
    }
    for (const obj of objects) {
      obj.visible = !this.hiddenTypes.has(obj.userData.elementType);
      this.modelGroup.add(obj);
    }
    this._applySelection();
  }

  setSelected(elementId) {
    this.selectedId = elementId;
    this._applySelection();
  }

  _applySelection() {
    this.modelGroup.traverse((obj) => {
      if (!obj.isMesh || !obj.material || !obj.material.emissive) return;
      let owner = obj;
      while (owner && !owner.userData.elementId) owner = owner.parent;
      const id = owner && owner.userData.elementId;
      const selected = id && id === this.selectedId;
      const issue = id && this.issues.get(id);
      if (selected) {
        obj.material.emissive.copy(SELECT_EMISSIVE);
        obj.material.emissiveIntensity = 0.45;
      } else if (issue) {
        obj.material.emissive.copy(ISSUE_EMISSIVE[issue]);
        obj.material.emissiveIntensity = issue === "error" ? 0.45 : 0.3;
      } else {
        obj.material.emissive.copy(NO_EMISSIVE);
        obj.material.emissiveIntensity = 0;
      }
    });
  }

  /** Габариты модели (Box3) или null для пустой сцены. */
  modelBounds() {
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    return box.isEmpty() ? null : box;
  }

  /**
   * Ставит камеру в стандартный вид.
   * @param {"iso"|"top"|"front"|"fit"} view
   */
  setView(view) {
    const box = this.modelBounds() || new THREE.Box3(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 3));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 2);
    const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.05;

    let dir;
    if (view === "top") dir = new THREE.Vector3(0, -0.001, 1);
    else if (view === "front") dir = new THREE.Vector3(0, -1, 0.12);
    else if (view === "fit") dir = this.camera.position.clone().sub(this.controls.target);
    else dir = new THREE.Vector3(0.9, -1.1, 0.8);
    dir.normalize();

    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.05, dist / 200);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();

    // Тени покрывают всю модель
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).add(new THREE.Vector3(-0.45, -0.7, 1).multiplyScalar(radius * 3));
    const s = this.sun.shadow.camera;
    s.left = -radius * 1.6; s.right = radius * 1.6; s.top = radius * 1.6; s.bottom = -radius * 1.6;
    s.far = radius * 8;
    s.updateProjectionMatrix();
  }
}

function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      list.forEach((m) => m.dispose());
    }
  });
}
