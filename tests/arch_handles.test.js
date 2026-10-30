// Архитектура: ручки концов стены меняют настоящие размеры (position / rotation / size.length), проёмы остаются на месте.
import test from "node:test";
import assert from "node:assert/strict";
import { loadBS, plain } from "./loader.js";

const BS = loadBS();
const P = BS.project;
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

function house() {
  const p = P.createProject("Ручки");
  const w = P.addWallByPoints(p, { x: 0, y: 0 }, { x: 6, y: 0 }, { category: "partition" });
  const win = P.placeOpening(p, "window", w.id, 2.0);
  return { p, w, win };
}

test("конец стены: длина и направление меняются в настоящих параметрах, второй конец остаётся на месте", () => {
  const { p, w } = house();
  const before = P.wallEnds(w);
  P.moveWallEnd(p, w.id, "end", { x: 8, y: 0 });
  const now = P.wallEnds(P.find(p, w.id));
  assert.ok(near(P.find(p, w.id).size.length, 8, 1e-3), "длина " + P.find(p, w.id).size.length);
  assert.ok(near(now.a.x, before.a.x, 1e-3) && near(now.a.y, before.a.y, 1e-3), "начало сместилось");
  assert.ok(near(now.b.x, 8, 1e-3) && near(now.b.y, 0, 1e-3));
  P.moveWallEnd(p, w.id, "end", { x: before.a.x, y: before.a.y + 4 }); // поворот на 90°
  const w2 = P.find(p, w.id);
  assert.ok(near(w2.size.length, 4, 1e-3));
  assert.ok(near(w2.rotation, 90, 1e-3), "rotation " + w2.rotation);
});

test("начало стены: сдвиг начала сохраняет конец, а проём остаётся на том же месте в мире", () => {
  const { p, w, win } = house();
  const worldBefore = BS.geometry.localToWorld(P.find(p, w.id), win.position.offset, 0, 0);
  const endBefore = P.wallEnds(P.find(p, w.id)).b;
  P.moveWallEnd(p, w.id, "start", { x: -1, y: 0 });
  const w2 = P.find(p, w.id);
  const e2 = P.wallEnds(w2);
  assert.ok(near(e2.b.x, endBefore.x, 1e-3) && near(e2.b.y, endBefore.y, 1e-3), "конец сместился");
  assert.ok(near(w2.size.length, 7, 1e-3));
  const worldAfter = BS.geometry.localToWorld(w2, P.find(p, win.id).position.offset, 0, 0);
  assert.ok(near(worldAfter.x, worldBefore.x, 1e-3) && near(worldAfter.y, worldBefore.y, 1e-3), `проём уехал: ${worldBefore.x} → ${worldAfter.x}`);
});

test("проём, оказавшийся за новым концом, ограничивается длиной стены с пояснением (не исчезает и не вылетает за стену)", () => {
  const { p, w, win } = house();
  const notes = P.moveWallEnd(p, w.id, "end", { x: 1.5, y: 0 });
  const o = P.find(p, win.id), wall = P.find(p, w.id);
  assert.ok(o.position.offset >= 0 && o.position.offset + o.size.width <= wall.size.length + 1e-6, "проём вне стены");
  assert.ok(notes.length >= 1, "нет пояснения об ограничении");
});

test("слишком короткая стена и стена из контура — понятные отказы, данные не меняются", () => {
  const { p, w } = house();
  const snap = JSON.stringify(plain(p.elements));
  assert.throws(() => P.moveWallEnd(p, w.id, "end", { x: 0.02, y: 0 }), /слишком короткая/);
  assert.equal(JSON.stringify(plain(p.elements)), snap);
  const wall = P.find(p, w.id);
  wall.params = { ...(wall.params || {}), contourId: "C1" };
  assert.throws(() => P.moveWallEnd(p, w.id, "end", { x: 9, y: 0 }), /контур/);
  assert.throws(() => P.moveWallEnd(p, "nope", "end", { x: 1, y: 1 }), /не стена|не найден/);
});

test("результат ручки сохраняется и загружается (JSON), экспорт видит новые размеры", () => {
  const { p, w } = house();
  P.moveWallEnd(p, w.id, "end", { x: 7.25, y: 1 });
  const text = BS.projectIO.serialize ? BS.projectIO.serialize(p) : JSON.stringify(p);
  const back = BS.projectIO.parse ? BS.projectIO.parse(text) : { project: JSON.parse(text) };
  const proj = back.project || back;
  const w2 = proj.elements.find((e) => e.id === w.id);
  assert.ok(near(w2.size.length, P.find(p, w.id).size.length, 1e-9));
  assert.ok(near(w2.rotation, P.find(p, w.id).rotation, 1e-9));
});
