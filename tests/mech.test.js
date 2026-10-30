// Машиностроение: модель, валидация, профили, объём, сериализация, STL.
// Собственный загрузчик (tests/mech_build.mjs): ядро + Three.js r147 из vendor в контексте vm (без DOM).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadMech, macroSourceJs, variantsProject, ROOT } from "./mech_build.mjs";

const BS = loadMech();
const M = BS.mechModel;
const G = BS.mechGeometry;
const IO = BS.mechIO;
const plain = (v) => JSON.parse(JSON.stringify(v));
const relErr = (a, b) => Math.abs(a - b) / Math.abs(b);

const part = (type, params, extra = {}) => M.createPart(M.createProject(), type, { params: { ...M.defaultParams(type), ...params }, ...extra });
const fields = (type, params) => plain(M.validateParams(type, { ...M.defaultParams(type), ...params }).map((e) => e.field));

test("параметры по умолчанию корректны, демо-проект без ошибок", () => {
  for (const t of Object.keys(M.TYPES)) assert.deepEqual(plain(M.validateParams(t, M.defaultParams(t))), [], t);
  assert.deepEqual(plain(M.validateProject(M.createDemoProject())), []);
});

test("валидация втулки: d < D, стенка, L > 0, конечные числа, фаски", () => {
  assert.deepEqual(fields("bushing", { d: 40 }), ["d"]);
  assert.deepEqual(fields("bushing", { d: 39 }), ["d"]); // стенка 0,5 мм < 1 мм
  assert.deepEqual(fields("bushing", { L: 0 }), ["L"]);
  assert.deepEqual(fields("bushing", { D: NaN }), ["D"]);
  assert.deepEqual(fields("bushing", { D: Infinity }), ["D"]);
  assert.deepEqual(fields("bushing", { L: "30" }), ["L"]);
  assert.deepEqual(fields("bushing", { c: 5, ci: 3 }), ["c"]); // 8 мм > стенки 7,5 мм
  assert.deepEqual(fields("bushing", { L: 2, c: 1.5, ci: 0 }), ["c"]);
  const e = M.validateParams("bushing", { ...M.defaultParams("bushing"), d: 45 });
  assert.match(e[0].message, /Внутренний диаметр d .*меньше наружного D/);
});

test("валидация вала: ступени, фаски торцов", () => {
  assert.deepEqual(fields("shaft", { steps: [] }), ["steps"]);
  assert.deepEqual(fields("shaft", { steps: [{ d: 20, L: 0 }] }), ["steps.0.L"]);
  assert.deepEqual(fields("shaft", { steps: [{ d: 20, L: 10 }, { d: -1, L: 5 }] }), ["steps.1.d"]);
  assert.deepEqual(fields("shaft", { c1: 15 }), ["c1"]);
  assert.deepEqual(fields("shaft", { steps: [{ d: 20, L: 3 }], c1: 2, c2: 2 }), ["c2"]); // фаски не помещаются на длине
  assert.match(M.validateParams("shaft", { ...M.defaultParams("shaft"), steps: [{ d: 20, L: 0 }] })[0].message, /^Ступень 1: L/);
});

test("валидация фланца: отверстия не пересекаются и не выходят за край, ступица", () => {
  assert.deepEqual(fields("flange", { pcd: 130 }), ["pcd"]); // 65 + 7 > 70 − 1
  assert.deepEqual(fields("flange", { pcd: 80 }), ["pcd"]); // задевают ступицу ⌀70
  assert.deepEqual(fields("flange", { n: 24 }), ["n"]); // хорда 14,4 мм − ⌀14 < 1 мм
  assert.deepEqual(fields("flange", { n: 2.5 }), ["n"]);
  assert.deepEqual(fields("flange", { hubD: 150 }), ["hubD", "pcd"]); // ступица больше диска — и отверстия попадают на неё
  assert.deepEqual(fields("flange", { hubH: 0 }), ["hubH"]);
  assert.deepEqual(fields("flange", { hubD: 0, hubH: 0, pcd: 60 }), []); // без ступицы отверстия ближе к центру
  assert.deepEqual(fields("flange", { hubD: 0, hubH: 0, pcd: 52 }), ["pcd"]); // 26 − 7 < 20 + 1
  assert.deepEqual(fields("flange", { n: 0 }), []);
});

test("профиль вала: ступени, совпадающие диаметры объединяются, фаски 45°", () => {
  assert.deepEqual(plain(M.shaftSketch([{ d: 20, L: 10 }, { d: 30, L: 5 }])), [[0, 0], [10, 0], [10, 10], [15, 10], [15, 15], [0, 15]]);
  assert.deepEqual(plain(M.shaftSketch([{ d: 20, L: 10 }, { d: 20, L: 5 }])), [[0, 0], [10, 0], [10, 15], [0, 15]]);
  const p = part("shaft", { steps: [{ d: 20, L: 10 }], c1: 1, c2: 2 });
  assert.deepEqual(plain(M.evaluate(p).profile), [[0, 0], [9, 0], [10, 1], [10, 8], [8, 10], [0, 10]]);
  const b = part("bushing", { D: 40, d: 20, L: 10, c: 1, ci: 0 });
  assert.deepEqual(plain(M.evaluate(b).profile), [[10, 0], [19, 0], [20, 1], [20, 9], [19, 10], [10, 10]]);
  const kinds = M.features(part("flange", {})).map((f) => f.kind);
  assert.deepEqual(plain(kinds), ["sketch", "revolve", "hole"]);
});

test("объём: формулы из параметров = Папп–Гульдин по профилю; сетка в пределах 0,5 %", () => {
  const cases = [
    part("bushing", {}), part("bushing", { c: 0, ci: 0 }), part("bushing", { D: 12, d: 6, L: 4, c: 1, ci: 1 }),
    part("shaft", {}), part("shaft", { steps: [{ d: 8, L: 100 }], c1: 0.5, c2: 3 }),
    part("flange", {}), part("flange", { hubD: 0, hubH: 0, n: 3, pcd: 70 }), part("flange", { n: 0 }),
  ];
  for (const p of cases) {
    const r = G.partReport(p);
    assert.ok(relErr(r.profileVolume, r.analyticVolume) < 1e-12, `${p.name}: Папп ${r.profileVolume} ≠ ${r.analyticVolume}`);
    assert.ok(r.meshVolume > 0 && Math.abs(r.meshDeviation) < 0.005, `${p.name}: сетка ${r.meshDeviation}`);
    assert.ok(r.meshVolume <= r.analyticVolume, `${p.name}: вписанный многоугольник не может дать больший объём`);
  }
  // проверка формулы вручную: втулка 40/25×30 без фасок
  assert.ok(relErr(M.analyticVolume(part("bushing", { c: 0, ci: 0 })), (Math.PI / 4) * (40 ** 2 - 25 ** 2) * 30) < 1e-12);
  // масса стальной втулки, кг
  const b = part("bushing", { c: 0, ci: 0 });
  assert.ok(relErr(G.partReport(b).mass, (Math.PI / 4) * (40 ** 2 - 25 ** 2) * 30 * 1e-9 * 7850) < 1e-12);
});

test("сетка замкнута, ориентирована, род поверхности верный, габарит = точному", () => {
  const cases = [[part("bushing", {}), 1], [part("shaft", {}), 0], [part("flange", {}), 7], [part("flange", { hubD: 0, hubH: 0, n: 4, pcd: 90 }), 5]];
  for (const [p, genus] of cases) {
    p.placement = { x: 10, y: -20, z: 5, rotation: { x: 30, y: 60, z: -45 } };
    const tri = G.trianglesOf(G.buildPartGeometry(p), G.partMatrix(p));
    const c = G.checkClosed(tri);
    assert.ok(c.closed, `${p.type}: ${JSON.stringify(c)}`);
    assert.equal(c.vertices - c.edges + c.triangles, 2 - 2 * genus, `${p.type}: эйлерова характеристика`);
    const exact = M.worldBounds(p), mesh = G.bounds(tri);
    for (let k = 0; k < 3; k++) {
      assert.ok(mesh.min[k] >= exact.min[k] - 1e-3 && mesh.max[k] <= exact.max[k] + 1e-3, `${p.type}: сетка вне габарита`);
      assert.ok(Math.abs(mesh.size[k] - exact.size[k]) < 0.05, `${p.type}: габарит ${mesh.size[k]} ≠ ${exact.size[k]}`);
    }
  }
});

test("поворот: матрица модели совпадает с THREE.Euler XYZ", () => {
  const p = part("shaft", {}, { placement: { x: 1, y: 2, z: 3, rotation: { x: 10, y: 20, z: 30 } } });
  const m = G.partMatrix(p);
  const e = m.elements; // по столбцам
  const [x, y, z] = [5, -7, 11];
  const v = [0, 1, 2].map((i) => e[i] * x + e[4 + i] * y + e[8 + i] * z + e[12 + i]);
  const w = M.transformPoint(p.placement, [x, y, z]);
  assert.ok(Math.hypot(v[0] - w[0], v[1] - w[1], v[2] - w[2]) < 1e-5); // Matrix4 хранит float64, кватернион — источник погрешности
});

test("STL: ожидаемое число треугольников, двоичный и текстовый, замкнут", () => {
  const seg = G.DEFAULT_SEGMENTS;
  const b = part("bushing", {}); // профиль 8 рёбер → 8 × 2 × seg
  // вал: 10 вершин эскиза + 2 от фасок = 12 рёбер; ребро на оси пропускается, 2 ребра касаются оси
  // (у оси треугольники вырождены и отбрасываются — по seg на ребро), остальные 9 — по 2 × seg
  const s = part("shaft", {});
  const tri = G.projectTriangles({ parts: [b, s] });
  const expected = 8 * 2 * seg + (2 * seg + 9 * 2 * seg);
  assert.equal(tri.length / 9, expected);
  const buf = G.stlBinary(tri);
  assert.equal(buf.byteLength, 84 + 50 * expected);
  assert.equal(new DataView(buf).getUint32(80, true), expected);
  const back = G.parseStlBinary(buf);
  assert.equal(back.length, tri.length);
  assert.ok(G.checkClosed(back).closed);
  const ascii = G.stlAscii(tri, "test");
  assert.equal(ascii.match(/facet normal/g).length, expected);
  assert.ok(ascii.startsWith("solid test") && ascii.trimEnd().endsWith("endsolid test"));
  const vol = G.meshVolume(back);
  assert.ok(relErr(vol, M.analyticVolume(b) + M.analyticVolume(s)) < 0.005);
});

test("сериализация туда и обратно без потерь; чужие форматы отклоняются", () => {
  const p = M.createDemoProject();
  const back = IO.parse(IO.serialize(p));
  assert.deepEqual(plain(back.errors), []);
  assert.deepEqual(plain(back.project), plain(p));
  assert.throws(() => IO.parse("{oops"), /не является корректным JSON/);
  assert.throws(() => IO.parse(JSON.stringify({ format: "buildsense", schemaVersion: 1 })), /ожидался format/);
  assert.throws(() => IO.parse(IO.exportFreecadJson(p)), /файл экспорта для FreeCAD/);
  const bad = plain(p);
  bad.parts[0].params.d = 100;
  const r = IO.parse(JSON.stringify(bad));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].partId, "p1");
  assert.equal(r.errors[0].field, "d");
  assert.throws(() => M.exportForCad(r.project), /ошибки/);
});

test("экспорт для FreeCAD: профиль, отверстия, аналитика", () => {
  const ex = M.exportForCad(M.createDemoProject());
  assert.equal(ex.format, "buildsense-mech-freecad");
  assert.equal(ex.units, "mm");
  const fl = ex.parts.find((x) => x.type === "flange");
  assert.equal(fl.solid.holes.length, 6);
  assert.ok(Math.abs(Math.hypot(fl.solid.holes[1].x, fl.solid.holes[1].y) - 55) < 1e-9);
  for (const x of ex.parts) assert.ok(x.analytic.volume > 0 && x.analytic.mass > 0);
});

test("файлы в репозитории синхронны с кодом (node tests/mech_build.mjs)", () => {
  const read = (f) => readFileSync(path.join(ROOT, f), "utf-8");
  assert.deepEqual(JSON.parse(read("examples/mech/demo.mech.json")), plain(M.createDemoProject()));
  assert.deepEqual(JSON.parse(read("examples/mech/demo.mech-freecad.json")), plain(M.exportForCad(M.createDemoProject())));
  assert.deepEqual(JSON.parse(read("tests/mech_variants.freecad.json")), plain(M.exportForCad(variantsProject(BS))));
  assert.equal(read("js/mech/mechMacroSource.js").replace(/\r\n/g, "\n"), macroSourceJs());
});
