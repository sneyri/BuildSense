// 2D-план → фундамент → стены: контур, угловые стыки, перестройка, геометрические проверки, миграция схемы.
import test from "node:test";
import assert from "node:assert/strict";
import { loadBS, plain } from "./loader.js";

const BS = loadBS();
const P = BS.project;
const C = BS.contour;
const G = BS.geometry;
const S = BS.shapes;
const run = (p) => BS.validation.validate(p);
const bad = (r) => r.issues.filter((i) => i.severity === "error" || i.severity === "warning");
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const L_SHAPE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 8 }, { x: 0, y: 8 }];
const OBTUSE = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 10, y: 2 }, { x: 10, y: 6 }, { x: 8, y: 8 }, { x: 0, y: 8 }];

/** Стены контура закрывают полосу между контуром и его смещением внутрь: без щелей и без выхода наружу. */
function ringReport(project, contour) {
  const walls = C.linked(project, contour.id, C.GEN.wall);
  const fps = walls.map((w) => S.footprint(w, project));
  let overlap = 0;
  for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) overlap += G.overlapArea(fps[i], fps[j]);
  const sum = fps.reduce((s, f) => s + Math.abs(G.polygonArea(f)), 0);
  const inside = fps.reduce((s, f) => s + G.overlapArea(f, contour.points), 0);
  const th = contour.points.map((p) => walls.find((w) => w.params.edgeFrom === p.id).size.thickness);
  const ring = Math.abs(G.polygonArea(contour.points)) - Math.abs(G.polygonArea(C.offsetPolygon(contour.points, th)));
  return { union: sum - overlap, ring, overlap, outside: sum - inside, walls };
}

function house(points, opts = {}) {
  const p = P.createProject("Тест");
  const c = C.addContour(p, points);
  C.foundationFromContour(p, c.id, { type: opts.foundation || "slab", thickness: 0.4, width: 0.6, depth: 1.2 });
  C.wallsFromContour(p, c.id, { thickness: opts.thickness || 0.4, height: 2.8 });
  return { p, c };
}

test("контур: обход против часовой стрелки, id вершин, отказ для самопересечения и малой площади", () => {
  const p = P.createProject();
  const c = C.addContour(p, L_SHAPE.slice().reverse());
  assert.ok(G.polygonArea(c.points) > 0, "обход приведён к положительному");
  assert.equal(c.points.length, 6);
  assert.equal(new Set(c.points.map((q) => q.id)).size, 6);
  assert.throws(() => C.addContour(p, [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }]), /самопересекается/);
  assert.throws(() => C.addContour(p, [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }]), /Площадь/);
});

test("Г-образный дом: стены по контуру без щелей, нахлёстов и выступов (в том числе вогнутый угол)", () => {
  const { p, c } = house(L_SHAPE);
  const r = ringReport(p, c);
  assert.equal(r.walls.length, 6);
  assert.ok(near(r.union, r.ring, 1e-6), `площадь стен ${r.union} = площади полосы ${r.ring}`);
  assert.ok(r.overlap < 1e-9, "углы встык, без нахлёста");
  assert.ok(Math.abs(r.outside) < 1e-9, "ничего не выходит за контур");
  for (const w of r.walls) assert.equal(S.bottom(w, p), 0, "стены стоят на верхе фундамента");
  assert.deepStrictEqual(plain(bad(run(p)).map((i) => i.title)), []);
});

test("тупые углы (135°) и разная толщина стен: без щелей и выступов наружу", () => {
  const { p, c } = house(OBTUSE);
  const r = ringReport(p, c);
  assert.ok(near(r.union, r.ring, 1e-3) && Math.abs(r.outside) < 1e-9);
  assert.deepStrictEqual(plain(bad(run(p)).map((i) => i.title)), [], "нахлёст в непрямом углу — допустимый стык");
  // Одна стена толще: соседи перестраиваются через applyElementPatch
  const w = r.walls[1];
  P.updateElement(p, w.id, { size: { thickness: 0.6 } });
  C.applyElementPatch(p, w, { size: { thickness: 0.6 } });
  const r2 = ringReport(p, c);
  // Стык прямоугольными телами в тупом углу стен разной толщины оставляет у внутренней грани
  // треугольник порядка 10 см² — меньше порога проверки (0,002 м²); наружу стены не выходят
  assert.ok(near(r2.union, r2.ring, 2e-3) && Math.abs(r2.outside) < 1e-9, "после смены толщины углы снова закрыты");
  assert.deepStrictEqual(plain(bad(run(p)).map((i) => i.title)), []);
});

test("Т-образный дом на ленточном фундаменте: ленты под осью стен, стены на верхе лент", () => {
  const T = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 9 }, { x: 4, y: 9 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  const { p, c } = house(T, { foundation: "strip", thickness: 0.38 });
  const strips = C.linked(p, c.id, C.GEN.strip);
  assert.equal(strips.length, 8);
  for (const s of strips) assert.equal(S.top(s, p), 0);
  for (const w of C.linked(p, c.id, C.GEN.wall)) {
    assert.equal(S.bottom(w, p), 0);
    assert.equal(BS.support.supportInfo(p, w).share, 1, `${w.name} целиком на ленте`);
  }
  assert.deepStrictEqual(plain(bad(run(p)).map((i) => i.title)), []);
});

test("пол по внутреннему контуру и перекрытие на верхе стен", () => {
  const { p, c } = house(L_SHAPE);
  const floor = C.slabFromContour(p, c.id, { kind: "ground", thickness: 0.2 }).created[0];
  assert.ok(S.isPrism(floor), "Г-образный пол — многоугольная плита");
  assert.ok(near(Math.abs(G.polygonArea(floor.params.points)), Math.abs(G.polygonArea(C.offsetPolygon(c.points, c.points.map(() => 0.4)))), 1e-6));
  assert.equal(floor.position.z, 0);
  const top = C.slabFromContour(p, c.id, { kind: "floor", thickness: 0.2 }).created[0];
  assert.equal(top.position.z, 2.8, "перекрытие на верхе стен");
  assert.deepStrictEqual(plain(bad(run(p)).map((i) => i.title)), []);
});

test("перестройка при перемещении вершины: проёмы остаются на месте; слишком широкий проём — отказ с понятной ошибкой", () => {
  const { p, c } = house(L_SHAPE);
  const south = C.linked(p, c.id, C.GEN.wall)[0];
  const win = P.placeOpening(p, "window", south.id, 2);
  const before = G.localToWorld(south, win.position.offset, 0, 0);
  const pts = c.points.map((q) => ({ ...q }));
  pts[1].x = 12; pts[2].x = 12; // восточная часть шире
  C.setPoints(p, c.id, pts);
  const after = G.localToWorld(south, win.position.offset, 0, 0);
  assert.ok(near(before.x, after.x) && near(before.y, after.y), "окно не сдвинулось");
  assert.ok(near(ringReport(p, c).union, ringReport(p, c).ring, 1e-6));
  // Ребро 3 (x 12 → 6, y = 4) с широким окном сокращаем так, что окно не помещается
  const wall3 = C.linked(p, c.id, C.GEN.wall).find((w) => w.params.edgeFrom === c.points[2].id);
  P.placeOpening(p, "window", wall3.id, 0.5, { size: { width: 5 } });
  const snapshot = JSON.stringify(p);
  const shrink = c.points.map((q) => ({ ...q }));
  shrink[1].x = 9; shrink[2].x = 9;
  assert.throws(() => C.setPoints(p, c.id, shrink), /не помещается/);
  void snapshot; // откат делает edit() в app.js (снимок до изменения)
});

test("удаление вершины удаляет стену её ребра, добавление — создаёт новую", () => {
  const { p, c } = house(L_SHAPE);
  const pts = c.points.map((q) => ({ ...q }));
  pts.splice(1, 0, { x: 5, y: 0 }); // новая вершина на южном ребре
  C.setPoints(p, c.id, pts);
  assert.equal(C.linked(p, c.id, C.GEN.wall).length, 7);
  C.setPoints(p, c.id, C.get(p, c.id).points.filter((_, i) => i !== 1));
  assert.equal(C.linked(p, c.id, C.GEN.wall).length, 6);
  assert.deepStrictEqual(plain(bad(run(p)).map((i) => i.title)), []);
});

test("стены, нарисованные мышью: Г-стыки в вогнутом и выпуклом углу без щели и выступа (обход в обе стороны)", () => {
  for (const pts of [L_SHAPE, L_SHAPE.slice().reverse()]) {
    const p = P.createProject();
    const c = C.addContour(p, L_SHAPE);
    C.foundationFromContour(p, c.id, { type: "slab" });
    for (let i = 0; i < pts.length; i++) P.addWallByPoints(p, pts[i], pts[(i + 1) % pts.length], { category: "exterior", thickness: 0.4 });
    const walls = p.elements.filter((e) => e.type === "wall");
    const fps = walls.map((w) => S.footprint(w, p));
    const sum = fps.reduce((s, f) => s + Math.abs(G.polygonArea(f)), 0);
    const ring = Math.abs(G.polygonArea(c.points)) - Math.abs(G.polygonArea(C.offsetPolygon(c.points, c.points.map(() => 0.4))));
    assert.ok(near(sum, ring, 1e-6), `стены закрывают углы: ${sum} = ${ring}`);
    assert.deepStrictEqual(plain(bad(run(p)).map((i) => i.title)), []);
  }
});

test("Г-стык двух перегородок по оси: угол заполнен (раньше оставался вырез t/2)", () => {
  const p = P.createProject();
  P.addRect(p, "slab_foundation", { x: -2, y: -2 }, { x: 8, y: 8 });
  const a = P.addWallByPoints(p, { x: 0, y: 0 }, { x: 5, y: 0 }, { category: "interior", thickness: 0.25 });
  const b = P.addWallByPoints(p, { x: 5, y: 0 }, { x: 5, y: 5 }, { category: "interior", thickness: 0.25 });
  const corner = C.findCorner(b, a);
  assert.ok(corner, "угол найден");
  const r = run(p);
  assert.ok(!r.issues.some((i) => i.checkId === "GEO-WALLS" && i.severity !== "pass"), "нет щели и выступа");
});

test("проверки геометрии: щель в углу, стены друг в друге, выход за фундамент, низ ниже верха опоры, перекрытие ниже верха стен", () => {
  // Щель в вогнутом углу — так стены строились раньше (по наружной грани без стыковки)
  const p = P.createProject();
  const c = C.addContour(p, L_SHAPE);
  C.foundationFromContour(p, c.id, { type: "slab" });
  P.addElement(p, "wall", { category: "exterior", position: { x: 10, y: 4, z: 0 }, rotation: 180, size: { length: 4, thickness: 0.4, height: 2.8 } });
  P.addElement(p, "wall", { category: "exterior", position: { x: 6, y: 4, z: 0 }, rotation: 90, size: { length: 4, thickness: 0.4, height: 2.8 } });
  assert.ok(run(p).issues.some((i) => i.checkId === "GEO-WALLS" && /Щель/.test(i.title)));

  const q = house(L_SHAPE).p;
  const w0 = q.elements.find((e) => e.type === "wall");
  const twin = P.addElement(q, "wall", { category: "exterior", position: { x: 2, y: 0.1, z: 0 }, size: { length: 5, thickness: 0.4, height: 2.8 } });
  assert.ok(run(q).issues.some((i) => i.checkId === "GEO-WALLS" && i.severity === "error" && i.elementIds.includes(twin.id) && i.elementIds.includes(w0.id)));
  P.removeElements(q, [twin.id]);

  P.updateElement(q, w0.id, { position: { y: -0.2 } }); // наружу на полтолщины
  assert.ok(run(q).issues.some((i) => i.checkId === "GEO-LEVELS" && i.elementIds.includes(w0.id) && /выходит за край/.test(i.title)));
  P.updateElement(q, w0.id, { position: { y: 0, z: -0.15 } });
  const sunk = run(q).issues.find((i) => i.checkId === "GEO-LEVELS" && /ниже верха/.test(i.title));
  assert.ok(sunk && sunk.fix, "низ стены внутри фундамента — с исправлением");
  BS.validation.applyFix(q, sunk.fix.action);
  assert.equal(w0.position.z, 0);

  const slab = P.addElement(q, "slab", { category: "floor", position: { x: 0, y: 0, z: 2.5 }, size: { length: 10, width: 8, height: 0.2 } });
  assert.ok(run(q).issues.some((i) => i.checkId === "GEO-LEVELS" && i.elementIds.includes(slab.id)));
});

test("стартовый дом построен по контуру; этаж копирует контур, крыша поднимается", () => {
  const p = P.createStarterProject();
  assert.equal(p.plan.contours.length, 1);
  assert.equal(C.linked(p, "C1", C.GEN.wall).length, 4);
  P.addLevel(p);
  assert.equal(p.plan.contours.length, 2);
  const roof = p.elements.find((e) => e.type === "roof");
  assert.equal(roof.position.z, 5.8);
  assert.equal(run(p).summary.error, 0);
});

test("схема 2 → 3: старый проект без плана открывается; план сохраняется и загружается", () => {
  const p = P.createStarterProject();
  const v2 = plain(p);
  v2.schemaVersion = 2;
  delete v2.plan;
  for (const e of v2.elements) { if (e.params) { delete e.params.contourId; delete e.params.generatedBy; delete e.params.edgeFrom; delete e.params.edgeStart; } }
  const { project, warnings } = BS.projectIO.fromData(v2);
  assert.equal(project.schemaVersion, 3);
  assert.deepStrictEqual(plain(project.plan), { contours: [] });
  assert.deepStrictEqual(plain(warnings), []);
  assert.equal(run(project).summary.error, 0);
  // Стены старого проекта по фундаменту — контур создаётся из плиты
  const q = P.createProject();
  P.addRect(q, "slab_foundation", { x: 0, y: 0 }, { x: 10, y: 8 });
  P.wallsAroundFoundation(q, { thickness: 0.4 });
  assert.equal(q.plan.contours.length, 1);
  const back = BS.projectIO.parse(BS.projectIO.serialize(q)).project;
  assert.deepStrictEqual(plain(back.plan), plain(q.plan));
  // Повреждённый контур пропускается с замечанием
  const broken = plain(q);
  broken.plan.contours.push({ id: "X", points: [{ x: 0 }] });
  assert.ok(BS.projectIO.fromData(broken).warnings.some((w) => /Контур/.test(w)));
});

test("экспорт FreeCAD (схема 3): многоугольная плита с контуром в мм", () => {
  const ex = BS.projectIO.fromData(plain(BS.examples.lHouse)).project;
  const { data, warnings } = BS.freecadExport.build(ex);
  assert.deepStrictEqual(plain(warnings), []);
  assert.equal(data.schemaVersion, 3);
  const f = data.elements.find((e) => e.type === "slab_foundation");
  assert.equal(f.shape, "prism");
  assert.equal(f.outline.length, 6);
  assert.deepStrictEqual(plain(f.outline[1]), { x: 12000, y: 0 });
  assert.equal(f.size.height, 400);
  assert.ok(!("points" in f.params));
  assert.equal(data.plan.contours.length, 2);
  // Прямоугольный фундамент остаётся брусом (совместимость с версией 2)
  const st = BS.freecadExport.build(P.createStarterProject()).data;
  assert.equal(st.elements.find((e) => e.type === "slab_foundation").shape, "box");
  assert.equal(run(ex).summary.error, 0);
  assert.equal(run(ex).summary.warning, 0);
});

test("сантехника, электрика и мебель скрыты из сценария, но типы остаются", () => {
  assert.ok(BS.types.GROUPS.engineering.hidden && BS.types.GROUPS.furniture.hidden);
  assert.ok(BS.types.get("bed") && BS.types.get("toilet") && BS.types.get("pipe"), "старые файлы открываются");
  const hiddenTypes = new Set(Object.values(BS.types.TYPES).filter((t) => BS.types.GROUPS[t.group].hidden).map((t) => t.id));
  for (const key of ["starter", "twoStorey", "issues", "lHouse"]) {
    const p = BS.examples[key];
    assert.ok(!p.elements.some((e) => hiddenTypes.has(e.type)), `${key}: без мебели и инженерии`);
  }
  assert.ok(!P.createStarterProject().elements.some((e) => hiddenTypes.has(e.type)));
  assert.ok(!Object.keys(BS.types.visibleGroups()).includes("furniture"));
});

test("материалы: у каждого есть вид для 3D (цвет, шероховатость, металличность); id прежних сохранены", () => {
  for (const id of ["concrete", "brick", "aerated", "timber", "steel", "metal_tile", "soft_tile", "membrane", "pvc", "wood_door", "ceramic", "fabric", "plastic", "zone", "glass"]) {
    assert.ok(BS.materials.MATERIALS[id], id);
  }
  for (const [id, m] of Object.entries(BS.materials.MATERIALS)) {
    assert.match(m.color, /^#[0-9a-f]{6}$/i, id);
    assert.ok(m.roughness >= 0 && m.roughness <= 1 && m.metalness >= 0 && m.metalness <= 1, id);
  }
  for (const id of ["brick", "aerated", "timber", "metal_tile", "concrete"]) assert.ok(BS.materials.look(id).texture, `${id}: процедурная текстура`);
});

test("копия стены контура не связана с контуром и не удаляется при перестройке", () => {
  const { p, c } = house(L_SHAPE);
  const w = C.linked(p, c.id, C.GEN.wall)[0];
  const [copy] = P.duplicate(p, [w.id], { x: 0, y: -3, z: 0 });
  assert.equal(copy.params.contourId, undefined);
  C.rebuild(p, c.id);
  assert.ok(P.find(p, copy.id), "копия на месте");
  assert.equal(C.linked(p, c.id, C.GEN.wall).length, 6);
});

test("крыша по контуру: Г, Т, П — основной объём и крылья до конька; косой контур — по габариту с пояснением", () => {
  const T = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 9 }, { x: 4, y: 9 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  const PI = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 9 }, { x: 8, y: 9 }, { x: 8, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 9 }, { x: 0, y: 9 }];
  for (const [pts, parts, notch] of [[L_SHAPE, 2, { x: 8, y: 6 }], [T, 2, { x: 2, y: 7 }], [PI, 3, { x: 6, y: 7 }]]) {
    const { p, c } = house(pts);
    assert.deepStrictEqual(plain(C.roofFromContour(p, c.id, { overhang: 0.4 }).notes), []);
    const roofs = C.linked(p, c.id, C.GEN.roof);
    assert.equal(roofs.length, parts);
    assert.ok(!roofs.some((r) => G.pointInConvex(notch, S.footprint(r, p))), "над вырезом контура крыши нет");
    for (const r of roofs) assert.equal(r.position.z, 2.8, "крыша на верхе стен");
    assert.deepStrictEqual(plain(bad(run(p)).map((i) => i.title)), []);
  }
  // Т: крыло над ножкой заходит до конька основного объёма (y = 2) и не выходит за свесы
  const { p, c } = house(T);
  C.roofFromContour(p, c.id, { overhang: 0.4 });
  const wing = C.linked(p, c.id, C.GEN.roof).find((r) => r.params.part === 1);
  const fp = S.footprint(wing, p), b = G.bbox2(fp);
  assert.ok(near(b.minY, 2, 1e-6) && near(b.maxY, 9.4, 1e-6) && near(b.minX, 3.6, 1e-6) && near(b.maxX, 8.4, 1e-6));
  // перенос вершины перестраивает части крыши, число частей сохраняется
  C.setPoints(p, c.id, c.points.map((q) => (q.y === 9 ? { ...q, y: 10 } : q)));
  assert.ok(near(G.bbox2(S.footprint(wing, p)).maxY, 10.4, 1e-6));
  const { p: q, c: o } = house(OBTUSE);
  assert.match(C.roofFromContour(q, o.id, {}).notes.join(" "), /по габариту/);
  assert.equal(C.linked(q, o.id, C.GEN.roof).length, 1);
});
