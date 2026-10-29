// Демонстрационная симуляция: детерминированность, сценарии, неизменность проекта.
import test from "node:test";
import assert from "node:assert/strict";
import { loadBS, plain } from "./loader.js";

const BS = loadBS();
// Объекты из контекста vm принадлежат другому «миру» JS — сравниваем их как обычные данные
const deepEqual = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const P = BS.project;
const SIM = BS.simulation;

test("граф нагрузки: стены на фундаменте, крыша на стенах, проёмы в стенах", () => {
  const p = P.createStarterProject();
  const g = BS.loadGraph.build(p);
  const wall = p.elements.find((e) => e.shell === "south");
  assert.ok(g.get(wall.id).supports.has("slab_foundation-1"));
  const roof = p.elements.find((e) => e.type === "roof");
  assert.ok(g.get(roof.id).supports.size >= 4);
  const win = p.elements.find((e) => e.hostId === wall.id);
  assert.ok(g.get(win.id).supports.has(wall.id));
});

test("отказ стены: отказывают её проёмы и перемычки, крыша повреждена; модель не меняется", () => {
  const p = P.createStarterProject();
  const before = JSON.stringify(plain(p));
  const wall = p.elements.find((e) => e.shell === "east");
  const r = SIM.run(p, "remove_support", { targetId: wall.id });
  assert.ok(r.ok);
  assert.ok(r.failed.includes(wall.id));
  for (const o of p.elements.filter((e) => e.hostId === wall.id)) assert.ok(r.failed.includes(o.id), o.id);
  assert.ok(r.damaged.includes(p.elements.find((e) => e.type === "roof").id));
  assert.equal(JSON.stringify(plain(p)), before, "проект не изменился");
  assert.equal(r.steps[0].title, "Исходное состояние");
  assert.ok(r.steps[r.steps.length - 1].final);
  assert.match(r.disclaimer, /не является инженерным расчётом/);
});

test("детерминированность: повторный запуск даёт тот же результат", () => {
  const p = P.createStarterProject();
  const a = SIM.run(p, "cascade", { targetId: "wall-1", threshold: 0.4 });
  const b = SIM.run(p, "cascade", { targetId: "wall-1", threshold: 0.4 });
  deepEqual(plain(a.steps), plain(b.steps));
});

test("отказ фундамента обрушает всё, что на нём стоит", () => {
  const p = P.createStarterProject();
  const r = SIM.run(p, "remove_support", { targetId: "slab_foundation-1" });
  const solid = p.elements.filter((e) => !BS.types.get(e.type).nonSolid);
  assert.equal(r.failed.length, solid.length);
});

test("перегрузка перекрытия: формула нагрузки и порог несущей способности", () => {
  const p = P.createStarterProject();
  const slab = p.elements.find((e) => e.type === "slab");
  const ok = SIM.run(p, "slab_overload", { targetId: slab.id, load: 2 });
  assert.equal(ok.failed.length, 0); // 2 + 4,9 = 6,9 кПа ≤ 8 кПа
  const bad = SIM.run(p, "slab_overload", { targetId: slab.id, load: 5 });
  assert.ok(bad.failed.includes(slab.id)); // 9,9 кПа > 8 кПа
  // Перегородка стоит на этом полу — она тоже теряет опору
  assert.ok(bad.failed.includes(p.elements.find((e) => e.category === "partition").id));
});

test("потеря устойчивости: без выбора берётся самая гибкая стена, она опрокидывается", () => {
  const p = P.createStarterProject();
  const r = SIM.run(p, "wall_buckling", {});
  const id = r.failed[0];
  assert.equal(P.find(p, id).category, "partition");
  const last = r.steps[r.steps.length - 1];
  assert.ok(last.motions[id].angle > 1, "опрокидывание ~75°");
});

test("боковое воздействие: отдельно стоящая тонкая стена опрокидывается, связанные — нет", () => {
  const p = P.createStarterProject();
  const free = P.addWallByPoints(p, { x: 20, y: 0 }, { x: 24, y: 0 }, { category: "partition", thickness: 0.1 });
  const r = SIM.run(p, "lateral", { intensity: 1, direction: 90 });
  assert.ok(r.failed.includes(free.id));
  assert.ok(!r.failed.includes(p.elements.find((e) => e.shell === "south").id));
  const weak = SIM.run(p, "lateral", { intensity: 0.1 });
  assert.equal(weak.failed.length, 0);
});

test("ненесущий элемент нельзя «отключить» как опору", () => {
  const p = P.createStarterProject();
  const r = SIM.run(p, "remove_support", { targetId: p.elements.find((e) => e.type === "window").id });
  assert.equal(r.ok, false);
});
