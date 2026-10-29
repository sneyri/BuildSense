// Генератор файлов машиностроения: примеры и встроенный исходник макроса FreeCAD.
//   node tests/mech_build.mjs
// Пишет examples/mech/demo.mech.json, examples/mech/demo.mech-freecad.json, js/mech/mechMacroSource.js.
import vm from "node:vm";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MECH_FILES = ["vendor/three/three.min.js", "js/core/namespace.js", "js/mech/mechModel.js", "js/mech/mechGeometry.js", "js/mech/mechIO.js"];

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
  return pr;
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
  writeFileSync(path.join(ROOT, "js/mech/mechMacroSource.js"), macroSourceJs());
  writeFileSync(path.join(ROOT, "tests/mech_variants.freecad.json"), BS.mechIO.exportFreecadJson(variantsProject(BS)) + "\n");
  if (process.argv[2]) {
    // node tests/mech_build.mjs <out.stl> — двоичный STL демо-проекта (для проверки в FreeCAD/Blender)
    const G = BS.mechGeometry;
    writeFileSync(process.argv[2], Buffer.from(G.stlBinary(G.projectTriangles(demo))));
    console.log("STL:", process.argv[2]);
  }
  console.log("ok: examples/mech/demo.mech.json, examples/mech/demo.mech-freecad.json, js/mech/mechMacroSource.js");
}
