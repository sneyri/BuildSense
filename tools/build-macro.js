// Встраивает текст freecad/import_house.FCMacro в js/io/macroSource.js.
// Зачем: при открытии index.html с диска (file://) браузер не всегда скачивает файл по ссылке,
// поэтому кнопка «Скачать макрос» отдаёт встроенный текст через Blob.
// Запуск после правки макроса: node tools/build-macro.js (тест tests/io.test.js проверяет синхронность).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(ROOT, "freecad", "import_house.FCMacro"), "utf-8");

writeFileSync(path.join(ROOT, "js", "io", "macroSource.js"), `// СГЕНЕРИРОВАНО tools/build-macro.js из freecad/import_house.FCMacro — не редактируйте вручную.
(function (BS) {
  "use strict";
  BS.freecadMacro = { fileName: "import_house.FCMacro", source: ${JSON.stringify(source)} };
})(globalThis.BuildSense);
`, "utf-8");
console.log(`Макрос встроен: ${source.length} символов`);
