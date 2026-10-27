// Модель проекта: создание объектов, опирание, привязки, этажи, копирование, история.
import test from "node:test";
import assert from "node:assert/strict";
import { loadBS, plain } from "./loader.js";

const BS = loadBS();
// Объекты из контекста vm принадлежат другому «миру» JS — сравниваем их как обычные данные
const deepEqual = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const P = BS.project;

test("стартовый дом: обязательные поля у всех элементов, уникальные id", () => {
  const p = P.createStarterProject();
  const ids = new Set();
  for (const e of p.elements) {
    assert.ok(e.id && !ids.has(e.id), "уникальный id");
    ids.add(e.id);
    assert.ok(BS.types.get(e.type), `${e.id}: тип из реестра`);
    assert.ok(e.material && e.size && e.position && e.levelId, `${e.id}: материал, размеры, координаты, этаж`);
  }
  const count = (t) => p.elements.filter((e) => e.type === t).length;
  assert.equal(count("slab_foundation"), 1);
  assert.equal(count("wall"), 5);
  assert.equal(count("roof"), 1);
  assert.ok(count("window") >= 4 && count("door") === 2);
});

test("реестр типов: у каждого типа есть группа, форма, размеры, поля и материалы", () => {
  for (const [id, t] of Object.entries(BS.types.TYPES)) {
    assert.ok(BS.types.GROUPS[t.group], `${id}: группа`);
    assert.ok(t.shape && t.size && t.fields && t.materials.length, `${id}: описание`);
    for (const m of t.materials) assert.ok(BS.materials.MATERIALS[m], `${id}: материал ${m}`);
  }
  assert.ok(Object.keys(BS.types.TYPES).length >= 30);
});

test("наружные стены по контуру фундамента: углы встык, стены на фундаменте", () => {
  const p = P.createProject();
  P.addRect(p, "slab_foundation", { x: 0, y: 0 }, { x: 10, y: 8 });
  const walls = P.wallsAroundFoundation(p, { thickness: 0.4 });
  deepEqual(walls.map((w) => w.size.length), [10, 7.6, 9.6, 7.2]);
  for (const w of walls) {
    assert.equal(w.position.z, 0);
    assert.equal(BS.support.supportInfo(p, w).share, 1);
  }
});

test("перегородка рисуется по оси, садится на пол и подрезается встык", () => {
  const p = P.createStarterProject();
  const w = P.addWallByPoints(p, { x: 3, y: 0 }, { x: 3, y: 8 }, { category: "partition" });
  assert.equal(w.position.z, 0.2, "на полу 0,2 м");
  assert.equal(w.size.height, 2.6, "до верха наружных стен");
  assert.equal(w.size.length, 7.2, "подрезана между внутренними гранями");
});

test("привязки: угол, грань с осью, сетка", () => {
  const p = P.createStarterProject();
  const s1 = BS.snapping.snapPoint(p, { x: 10.1, y: 7.9 }, {});
  assert.equal(s1.kind, "corner");
  const s2 = BS.snapping.snapPoint(p, { x: 9.5, y: 4.02 }, { from: { x: 4, y: 4 } });
  assert.equal(s2.kind, "edge");
  assert.ok(Math.abs(s2.x - 9.6) < 1e-9 && Math.abs(s2.y - 4) < 1e-9, "по оси Y = 4 до внутренней грани x = 9,6");
  const s3 = BS.snapping.snapPoint(p, { x: 4.04, y: 4.96 }, {});
  deepEqual([s3.kind, s3.x, s3.y], ["grid", 4, 5]);
});

test("перемещение: элемент снова садится на основание", () => {
  const p = P.createStarterProject();
  const col = P.placeAt(p, "column", { x: 20, y: 20 });
  assert.equal(col.position.z, 0, "без основания — на уровне этажа");
  P.moveElement(p, col.id, -15, -16); // в дом, на пол
  assert.equal(col.position.z, 0.2);
});

test("этажи: перекрытие, копия стен, крыша поднимается, лестница доходит до этажа", () => {
  const p = P.createStarterProject();
  const { level, created } = P.addLevel(p, { copyWalls: true });
  assert.equal(level.elevation, 3.0);
  assert.ok(created.some((e) => e.type === "slab" && e.category === "floor"));
  assert.equal(created.filter((e) => e.type === "wall").length, 4);
  assert.ok(!created.some((e) => e.type === "door"), "двери на второй этаж не копируются");
  const roof = p.elements.find((e) => e.type === "roof");
  assert.equal(roof.position.z, 5.8);
  const st = P.placeAt(p, "stairs", { x: 7.5, y: 4 });
  assert.equal(BS.shapes.top(st, p), 3.0);
});

test("дублирование и копирование на этаж сохраняют проёмы стены", () => {
  const p = P.createStarterProject();
  const wall = p.elements.find((e) => e.shell === "south");
  const n0 = P.hosted(p, wall.id).length;
  const copies = P.duplicate(p, [wall.id], { x: 0, y: -5, z: 0 });
  const copy = copies.find((c) => c.type === "wall");
  assert.equal(P.hosted(p, copy.id).length, n0);
});

test("значения ограничиваются допустимым диапазоном", () => {
  const p = P.createStarterProject();
  const win = p.elements.find((e) => e.type === "window");
  const notes = P.updateElement(p, win.id, { size: { width: 99 } });
  assert.ok(notes.length);
  assert.ok(win.size.width <= 6);
});

test("отмена и повтор восстанавливают проект", () => {
  const h = BS.history.createHistory();
  const p = P.createStarterProject();
  const before = plain(p);
  h.push(p, "удаление");
  P.removeElements(p, [p.elements.find((e) => e.type === "wall").id]);
  const undone = h.undo(p);
  deepEqual(plain(undone.project.elements), before.elements);
  const redone = h.redo(undone.project);
  assert.equal(redone.project.elements.length, p.elements.length);
});
