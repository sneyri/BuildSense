// Генерирует примеры в папке examples/ из той же модели, что и веб-приложение.
// Запуск: node tools/make-examples.js
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyHouseDimensions, createBasicHouseProject, updateElement } from "../js/model/project.js";
import { serializeProject } from "../js/io/projectIO.js";
import { buildFreecadExport } from "../js/export/freecadExport.js";
import { collectParameters } from "../js/model/metrics.js";
import { checkModel } from "../js/rules/checker.js";
import { loadRulesFromDisk } from "../tests/helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "examples");
const FIXED_DATE = "2026-10-26T12:00:00.000Z"; // стабильные файлы примеров

const { rules } = await loadRulesFromDisk();
await mkdir(OUT, { recursive: true });

// 1. Базовый дом 10 × 8 м — проходит все сверенные правила
const ok = createBasicHouseProject("Демо-дом 10×8");

// 2. Дом с нарушениями: холодный подрайон IА, низкий потолок, узкая дверь, крутая крыша
const bad = createBasicHouseProject("Демо-дом с замечаниями");
bad.settings.climateRegion = "1A";
bad.house.wallHeight = 2.7;
bad.house.roofSlope = 50;
applyHouseDimensions(bad);
const door = bad.elements.find((e) => e.type === "door");
updateElement(bad, door.id, { size: { width: 0.7 } });

for (const [slug, project] of [["demo-house", ok], ["demo-house-issues", bad]]) {
  project.createdAt = project.updatedAt = FIXED_DATE;
  const report = checkModel(collectParameters(project), rules);
  const { data } = buildFreecadExport(project, { checkSummary: report.summary });
  data.exportedAt = FIXED_DATE;
  await writeFile(path.join(OUT, `${slug}.project.json`), serializeProject(project) + "\n", "utf-8");
  await writeFile(path.join(OUT, `${slug}.freecad.json`), JSON.stringify(data, null, 2) + "\n", "utf-8");
  console.log(`${slug}: PASS ${report.summary.PASS}, FAIL ${report.summary.FAIL}, NOT VERIFIED ${report.summary["NOT VERIFIED"]}`);
}
