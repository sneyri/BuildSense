// Загрузка модулей BuildSense (обычных скриптов) в Node.js для автотестов.
// Модули без DOM и Three.js выполняются в изолированном контексте vm, как в браузере.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Модули без DOM — в порядке подключения в index.html. */
export const CORE_FILES = [
  "js/core/namespace.js",
  "js/core/geometry.js",
  "js/materials/materials.js",
  "js/objects/types.js",
  "js/objects/shapes.js",
  "js/objects/support.js",
  "js/objects/snapping.js",
  "js/objects/project.js",
  "js/objects/contour.js",
  "js/objects/bimCode.js",
  "js/objects/modules.js",
  "js/rules/builtinRules.js",
  "js/rules/ruleRegistry.js",
  "js/rules/checker.js",
  "js/validation/metrics.js",
  "js/validation/validationEngine.js",
  "js/validation/envelope.js",
  "js/simulation/loadGraph.js",
  "js/simulation/simulation.js",
  "js/calculations/calculations.js",
  "js/io/projectIO.js",
  "js/io/freecadExport.js",
  "js/io/macroSource.js",
  "js/editor/history.js",
  "examples/examples.js",
];

export function loadBS(files = CORE_FILES) {
  const ctx = vm.createContext({ console });
  for (const f of files) {
    const file = path.join(ROOT, f);
    vm.runInContext(readFileSync(file, "utf-8"), ctx, { filename: file });
  }
  return ctx.BuildSense;
}

/** Копия значения из контекста vm в «обычные» объекты Node (для deepEqual). */
export const plain = (v) => JSON.parse(JSON.stringify(v));
