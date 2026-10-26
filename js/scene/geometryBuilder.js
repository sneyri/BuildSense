// Генерация 3D-геометрии Three.js по данным модели проекта.
// Каждый элемент проекта превращается в THREE.Group с userData.elementId.
import * as THREE from "three";
import { materialColor } from "../model/catalog.js";
import { DEG, roofRise, wallLocalToWorld } from "../model/placement.js";

const EDGE_COLOR = 0x2b3440;
const HOLE_EPS = 0.002; // отверстие не должно касаться контура стены (ограничение триангуляции)

// Перестановка осей x→y, y→z, z→x: профиль, нарисованный в плоскости XY
// и выдавленный по Z, становится профилем в плоскости YZ, выдавленным по X.
const AXES_XY_TO_YZ = new THREE.Matrix4().set(
  0, 0, 1, 0,
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 0, 1
);

/** Строит 3D-объекты для всех элементов проекта. */
export function buildProjectObjects(project) {
  const objects = [];
  for (const el of project.elements) {
    try {
      const obj = buildElementObject(el, project);
      if (obj) objects.push(obj);
    } catch (err) {
      console.warn(`Не удалось построить геометрию элемента ${el.id}:`, err);
    }
  }
  return objects;
}

export function buildElementObject(el, project) {
  switch (el.type) {
    case "wall": return buildWall(el, project);
    case "floor":
    case "foundation": return buildFloor(el);
    case "roof": return buildRoof(el);
    case "window": return buildWindow(el, project);
    case "door": return buildDoor(el, project);
    default: return null;
  }
}

function makeGroup(el) {
  const group = new THREE.Group();
  group.name = el.id;
  group.userData.elementId = el.id;
  group.userData.elementType = el.type;
  return group;
}

function surface(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
}

function addMesh(group, geometry, material, { edges = true, shadows = true } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  group.add(mesh);
  if (edges) {
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 25),
      new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.35 })
    );
    group.add(lines);
  }
  return mesh;
}

/** Брус с углом в начале координат: x ∈ [0,a], y ∈ [0,b], z ∈ [0,c]. */
function cornerBox(a, b, c) {
  return new THREE.BoxGeometry(a, b, c).translate(a / 2, b / 2, c / 2);
}

function placeLikeWall(group, el) {
  group.position.set(el.position.x, el.position.y, el.position.z);
  group.rotation.z = (el.rotation || 0) * DEG;
}

// ---------------------------------------------------------------- стена

function buildWall(el, project) {
  const { length: L, thickness: t, height: H } = el.size;
  const group = makeGroup(el);

  // Профиль стены (u — вдоль, w — вверх) с отверстиями под окна и двери
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(L, 0);
  shape.lineTo(L, H);
  shape.lineTo(0, H);
  shape.closePath();

  const rects = [];
  for (const o of project.elements.filter((e) => e.hostId === el.id)) {
    const u0 = Math.max(HOLE_EPS, o.position.offset);
    const u1 = Math.min(L - HOLE_EPS, o.position.offset + o.size.width);
    const w0 = Math.max(HOLE_EPS, o.position.elevation);
    const w1 = Math.min(H - HOLE_EPS, o.position.elevation + o.size.height);
    if (u1 - u0 >= 0.01 && w1 - w0 >= 0.01) rects.push({ u0, u1, w0, w1 });
  }
  // Пересекающиеся отверстия ломают триангуляцию — объединяем их в общий прямоугольник
  for (const { u0, u1, w0, w1 } of mergeOverlapping(rects)) {
    const hole = new THREE.Path();
    hole.moveTo(u0, w0);
    hole.lineTo(u0, w1);
    hole.lineTo(u1, w1);
    hole.lineTo(u1, w0);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  // Профиль лежит в плоскости XY и выдавлен по Z; переводим в (u, v, w) стены:
  // поворот на 90° вокруг X даёт (x, -z, y), затем сдвиг на толщину.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, t, 0);

  addMesh(group, geometry, surface(materialColor(el.material)));
  placeLikeWall(group, el);
  return group;
}

function mergeOverlapping(rects) {
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

// ---------------------------------------------------------------- пол

function buildFloor(el) {
  const { length, width, thickness } = el.size;
  const group = makeGroup(el);
  addMesh(group, cornerBox(length, width, thickness), surface(materialColor(el.material)));
  placeLikeWall(group, el);
  return group;
}

// ---------------------------------------------------------------- крыша

function buildRoof(el) {
  const { length, width } = el.size;
  const group = makeGroup(el);
  const material = surface(materialColor(el.material), { side: THREE.DoubleSide });

  if (el.params.roofType === "gable") {
    // Треугольная призма: профиль поперёк конька (по Y), конёк вдоль X
    const rise = roofRise(el);
    const tri = new THREE.Shape();
    tri.moveTo(0, 0);
    tri.lineTo(width, 0);
    tri.lineTo(width / 2, rise);
    tri.closePath();
    const geometry = new THREE.ExtrudeGeometry(tri, { depth: length, bevelEnabled: false });
    geometry.applyMatrix4(AXES_XY_TO_YZ);
    addMesh(group, geometry, material);
  } else {
    addMesh(group, cornerBox(length, width, el.params.thickness), material);
  }
  placeLikeWall(group, el);
  return group;
}

// ---------------------------------------------------------------- проёмы

/** Группа проёма в системе координат стены-основы: начало — низ проёма на наружной грани. */
function openingGroup(el, project) {
  const host = project.elements.find((e) => e.id === el.hostId);
  if (!host) return null;
  const group = makeGroup(el);
  const origin = wallLocalToWorld(host, el.position.offset, 0, el.position.elevation);
  group.position.set(origin.x, origin.y, origin.z);
  group.rotation.z = (host.rotation || 0) * DEG;
  return { group, host };
}

function buildWindow(el, project) {
  const res = openingGroup(el, project);
  if (!res) return null;
  const { group, host } = res;
  const { width: w, height: h } = el.size;
  const t = host.size.thickness;
  const frameDepth = Math.min(0.08, t);
  const bar = Math.min(0.06, w / 6, h / 6);

  // Рама: прямоугольник с вырезом
  const outer = new THREE.Shape();
  outer.moveTo(0, 0); outer.lineTo(w, 0); outer.lineTo(w, h); outer.lineTo(0, h); outer.closePath();
  const inner = new THREE.Path();
  inner.moveTo(bar, bar); inner.lineTo(bar, h - bar); inner.lineTo(w - bar, h - bar); inner.lineTo(w - bar, bar); inner.closePath();
  outer.holes.push(inner);
  const frame = new THREE.ExtrudeGeometry(outer, { depth: frameDepth, bevelEnabled: false });
  frame.rotateX(Math.PI / 2);
  frame.translate(0, (t + frameDepth) / 2, 0);
  addMesh(group, frame, surface(materialColor(el.material)));

  // Стекло
  const glass = cornerBox(w - 2 * bar, 0.01, h - 2 * bar).translate(bar, t / 2 - 0.005, bar);
  addMesh(group, glass, surface(0x7fb6e0, { transparent: true, opacity: 0.45, roughness: 0.1 }), { edges: false, shadows: false });

  // Импост посередине
  if (w > 1) {
    const mullion = cornerBox(bar * 0.8, frameDepth, h - 2 * bar).translate(w / 2 - bar * 0.4, (t - frameDepth) / 2, bar);
    addMesh(group, mullion, surface(materialColor(el.material)), { edges: false });
  }
  return group;
}

function buildDoor(el, project) {
  const res = openingGroup(el, project);
  if (!res) return null;
  const { group, host } = res;
  const { width: w, height: h } = el.size;
  const t = host.size.thickness;
  const leafT = Math.min(0.05, t);
  const gap = 0.01;

  const leaf = cornerBox(w - 2 * gap, leafT, h - gap).translate(gap, (t - leafT) / 2, 0);
  addMesh(group, leaf, surface(materialColor(el.material)));

  const handle = cornerBox(0.12, leafT + 0.06, 0.03).translate(w - 0.2, (t - leafT) / 2 - 0.03, Math.min(1.0, h * 0.48));
  addMesh(group, handle, surface(0xd4b04c, { metalness: 0.6, roughness: 0.35 }), { edges: false });
  return group;
}
