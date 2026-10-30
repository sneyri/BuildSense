// Генератор файлов машиностроения: примеры и встроенный исходник макроса FreeCAD.
//   node tests/mech_build.mjs
// Пишет examples/mech/demo.mech.json, examples/mech/demo.mech-freecad.json, examples/mech/assembly.mech.json,
// examples/mech/assembly.mech-freecad.json, js/mech/mechMacroSource.js.
import vm from "node:vm";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MECH_FILES = ["vendor/three/three.min.js", "js/core/namespace.js", "js/mech/mechModel.js", "js/mech/mechAssembly.js", "js/mech/mechConnect.js", "js/mech/mechKinematics.js", "js/mech/mechMechanism.js", "js/mech/mechCoach.js", "js/mech/mechLessons.js", "js/mech/mechExplode.js", "js/mech/mechDemos.js", "js/mech/mechGeometry.js", "js/mech/mechIO.js"];

export function loadMech(files = MECH_FILES) {
  const ctx = vm.createContext({ console });
  for (const f of files) {
    const file = path.join(ROOT, f);
    vm.runInContext(readFileSync(file, "utf-8"), ctx, { filename: file });
  }
  return ctx.BuildSense;
}

/** Крайние варианты для проверки макроса: без фасок, одна ступень, фланец без ступицы, повороты. */
export function variantsProject(BS) {
  const M = BS.mechModel;
  const pr = M.createProject("Варианты для проверки");
  pr.parts.push(M.createPart(pr, "bushing", { name: "Втулка без фасок", params: { D: 20, d: 10, L: 15, c: 0, ci: 0 } }));
  pr.parts.push(M.createPart(pr, "shaft", { name: "Вал одна ступень", params: { steps: [{ d: 12, L: 50 }], c1: 1.5, c2: 0.5 }, placement: { x: 40, y: 0, z: 0, rotation: { x: 90, y: 0, z: 30 } } }));
  pr.parts.push(M.createPart(pr, "shaft", { name: "Вал с равными ступенями", params: { steps: [{ d: 20, L: 10 }, { d: 20, L: 15 }, { d: 30, L: 5 }, { d: 16, L: 25 }], c1: 0, c2: 2 }, placement: { x: 80, y: 0, z: 0, rotation: { x: 0, y: 0, z: 0 } } }));
  pr.parts.push(M.createPart(pr, "flange", { name: "Фланец без ступицы", params: { D: 100, T: 10, d: 30, hubD: 0, hubH: 0, n: 4, pcd: 75, holeD: 11 }, placement: { x: 0, y: 120, z: 0, rotation: { x: 15, y: 25, z: 45 } } }));
  pr.parts.push(M.createPart(pr, "flange", { name: "Шайба (без отверстий)", params: { D: 30, T: 3, d: 13, hubD: 0, hubH: 0, n: 0, pcd: 0, holeD: 5 }, placement: { x: 150, y: 120, z: 0, rotation: { x: 0, y: 0, z: 0 } } }));
  // плоские детали (выдавливание) и новые тела вращения
  pr.parts.push(M.createPart(pr, "link", { name: "Шатун", placement: { x: 0, y: 260, z: 0, rotation: { x: 20, y: -35, z: 70 } } }));
  pr.parts.push(M.createPart(pr, "link", { name: "Щека (разные проушины, без отверстий)", params: { C: 30, D1: 50, d1: 0, D2: 34, d2: 0, T: 10 }, placement: { x: 160, y: 260, z: 0, rotation: { x: 0, y: 0, z: 0 } } }));
  pr.parts.push(M.createPart(pr, "block", { name: "Корпус опоры", placement: { x: 300, y: 260, z: 0, rotation: { x: 90, y: 0, z: 15 } } }));
  pr.parts.push(M.createPart(pr, "block", { name: "Плита без отверстия", params: { W: 120, H: 60, hb: 30, T: 8, d: 0 }, placement: { x: 0, y: 420, z: 0, rotation: { x: 0, y: 0, z: 0 } } }));
  pr.parts.push(M.createPart(pr, "piston", { name: "Поршень", placement: { x: 200, y: 420, z: 0, rotation: { x: 0, y: 45, z: 0 } } }));
  pr.parts.push(M.createPart(pr, "screw", { name: "Винт с условной резьбой", params: { d: 20, P: 4, Lt: 62, D: 30, Lh: 10, dn: 12, Ln: 15 }, placement: { x: 320, y: 420, z: 0, rotation: { x: 0, y: 0, z: 0 } } }));
  return pr;
}

/** Сборка с намеренным пересечением (две втулки заходят друг в друга на 2 мм) — сверка объёма с FreeCAD. */
export function interferenceProject(BS) {
  const M = BS.mechModel, A = BS.mechAssembly;
  const pr = A.createDemoAssemblyProject();
  pr.name = "Пересечение для проверки";
  const asm = pr.assemblies[0];
  pr.parts[0].params.steps[1].L = 20;
  const b2 = M.createPart(pr, "bushing", { name: "Втулка 2" });
  pr.parts.push(b2);
  const c4 = A.addComponent(pr, asm, b2.id);
  A.addMate(pr, asm, { type: "coaxial", a: { comp: "c1" }, b: { comp: c4.id } });
  A.addMate(pr, asm, { type: "planar", mode: "contact", a: { comp: "c1", ref: "end1" }, b: { comp: c4.id, ref: "end0" } });
  asm.mates.find((m) => m.id === "m4").offset = 12;
  A.solveAll(pr);
  return pr;
}

/** Экспорт сборки с пересечением + ожидаемый объём пересечения по решателю. */
export function interferenceExport(BS) {
  const pr = interferenceProject(BS);
  const asm = pr.assemblies[0];
  const r = BS.mechAssembly.solve(pr, asm, { apply: false });
  const ex = BS.mechModel.exportForCad(pr);
  const partOf = (cid) => asm.components.find((c) => c.id === cid).partId;
  ex.expectedInterference = r.interference.filter((i) => i.volume > 0).map((i) => ({ a: partOf(i.a), b: partOf(i.b), volume: i.volume }));
  return ex;
}

export function macroSourceJs() {
  const src = readFileSync(path.join(ROOT, "freecad/import_parts.FCMacro"), "utf-8");
  return (
    "// СГЕНЕРИРОВАНО tests/mech_build.mjs из freecad/import_parts.FCMacro — не редактируйте вручную.\n" +
    "(function (BS) {\n  \"use strict\";\n" +
    `  BS.mechMacro = { fileName: "import_parts.FCMacro", source: ${JSON.stringify(src)} };\n` +
    "})(globalThis.BuildSense);\n"
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const BS = loadMech();
  const demo = BS.mechModel.createDemoProject();
  writeFileSync(path.join(ROOT, "examples/mech/demo.mech.json"), BS.mechIO.serialize(demo) + "\n");
  writeFileSync(path.join(ROOT, "examples/mech/demo.mech-freecad.json"), BS.mechIO.exportFreecadJson(demo) + "\n");
  const asm = BS.mechAssembly.createDemoAssemblyProject();
  writeFileSync(path.join(ROOT, "examples/mech/assembly.mech.json"), BS.mechIO.serialize(asm) + "\n");
  writeFileSync(path.join(ROOT, "examples/mech/assembly.mech-freecad.json"), BS.mechIO.exportFreecadJson(asm) + "\n");
  writeFileSync(path.join(ROOT, "js/mech/mechMacroSource.js"), macroSourceJs());
  for (const d of BS.mechDemos.DEMOS) {
    // демонстрационные проекты (исходное положение, без кадров симуляции и разборки) и их экспорт для FreeCAD
    const pr = d.create();
    writeFileSync(path.join(ROOT, `examples/mech/showcase-${d.id}.mech.json`), BS.mechIO.serialize(pr) + "\n");
    writeFileSync(path.join(ROOT, `examples/mech/showcase-${d.id}.mech-freecad.json`), BS.mechIO.exportFreecadJson(pr) + "\n");
  }
  writeFileSync(path.join(ROOT, "tests/mech_variants.freecad.json"), BS.mechIO.exportFreecadJson(variantsProject(BS)) + "\n");
  writeFileSync(path.join(ROOT, "tests/mech_interference.freecad.json"), JSON.stringify(interferenceExport(BS), null, 2) + "\n");
  if (process.argv[2]) {
    // node tests/mech_build.mjs <out.stl> — двоичный STL демо-проекта (для проверки в FreeCAD/Blender)
    const G = BS.mechGeometry;
    writeFileSync(process.argv[2], Buffer.from(G.stlBinary(G.projectTriangles(demo))));
    console.log("STL:", process.argv[2]);
  }
  console.log("ok: examples/mech/demo.*, examples/mech/assembly.*, js/mech/mechMacroSource.js, tests/mech_variants.freecad.json");
}
