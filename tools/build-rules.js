// Встраивает правила из data/rules/*.json в js/rules/builtinRules.js.
// Зачем: при открытии index.html двойным щелчком (file://) браузер не даёт читать JSON через fetch,
// поэтому встроенные правила поставляются как обычный скрипт. Источник истины — JSON-файлы.
// Запуск после правки правил: node tools/build-rules.js (тест tests/rules.test.js проверяет синхронность).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(ROOT, "data", "rules");
const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf-8"));
const files = index.files.map((f) => ({ file: f, data: JSON.parse(readFileSync(path.join(dir, f), "utf-8")) }));

export function render(filesData, statuses) {
  return `// СГЕНЕРИРОВАНО tools/build-rules.js из data/rules/*.json — не редактируйте вручную.
(function (BS) {
  "use strict";
  BS.builtinRules = ${JSON.stringify({ verificationStatuses: statuses, files: filesData }, null, 2).replace(/\n/g, "\n  ")};
})(globalThis.BuildSense);
`;
}

writeFileSync(path.join(ROOT, "js", "rules", "builtinRules.js"), render(files, index.verificationStatuses), "utf-8");
console.log(`Встроено файлов: ${files.length}, правил: ${files.reduce((s, f) => s + f.data.rules.length, 0)}`);
