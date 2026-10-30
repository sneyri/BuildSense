// Снимает скриншоты README прямо из программы: Chrome в headless-режиме, управление через DevTools-протокол.
// Запуск:  node tools/make-screenshots.mjs [arch|mech|all] [имя-снимка ...]
// Результат: docs/img/*.png. Нужен установленный Chrome или Edge (иначе задайте CHROME_PATH). Сервер не нужен — файл index.html
// открывается по file://, как у пользователя.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "img");
const APP = pathToFileURL(path.join(ROOT, "index.html")).href;
const only = process.argv.slice(3);
const group = process.argv[2] || "all";

const b = await launch();
const shots = [];
const out = (name) => path.join(OUT, `${name}.png`);
const open = async (hash, wait = 2500) => {
  // чистое хранилище: автосохранение браузера иначе подмешивает проект из прошлого кадра
  await b.goto(APP, 600);
  await b.eval("localStorage.clear(), sessionStorage.clear(), true");
  await b.goto("about:blank", 200);
  await b.goto(`${APP}#${hash}`, wait);
  await b.eval(`document.getElementById("splash")?.remove(), true`);
};
/** Дом: закрыть всплывающее окно контура, снять выделение, подогнать план и камеру. */
const tidyArch = () => b.eval(`(() => {
  const p = BuildSense.app.plan;
  if (p) { p._closePopup(); p._tableOpen = false; p._tableSig = ""; p._renderTable(); p.fit(); }
  return true; })()`);
/** Отодвинуть камеру 3D от центра модели в k раз (высокие здания не помещаются в кадр). */
const zoomOut = (k) => b.eval(`(() => {
  const v = BuildSense.app.view, t = v.controls.target;
  v.camera.position.set(t.x + (v.camera.position.x - t.x) * ${k}, t.y + (v.camera.position.y - t.y) * ${k}, t.z + (v.camera.position.z - t.z) * ${k});
  v.controls.update && v.controls.update(); return true; })()`);
const shot = (group_, name, fn) => shots.push({ group: group_, name, fn });

// ---------------------------------------------------------------- архитектура
shot("arch", "arch-plan-3d", async () => { await open("example=twoStorey&wizard=0"); await tidyArch(); });
shot("arch", "arch-plan", async () => { await open("example=twoStorey&wizard=0&archview=plan"); await tidyArch(); });
shot("arch", "arch-wizard", async () => { await open("example=starter"); await tidyArch(); });
shot("arch", "arch-l-house-3d", async () => { await open("example=lHouse&wizard=0&archview=3d&view=iso"); });
shot("arch", "arch-problems", async () => { await open("example=issues&wizard=0&tab=problems"); await tidyArch(); });
shot("arch", "arch-simulation", async () => {
  await open("example=twoStorey&wizard=0&archview=3d");
  await b.eval(`BuildSense.app.select(["wall-2"]), true`);
  await b.click("Симуляция", "button[data-tab]"); await b.click("Запустить", "button");
  await b.sleep(800); await b.eval(`[...document.querySelectorAll(".sim-steps li")].pop()?.click(), true`); await b.sleep(1500);
});
const PROTOS = { estate: "Усадьба", mansion: "Особняк", tower: "Жилая секция", villa: "Вилла", timber: "Бревенчатый дом", mall: "Торговый центр" };
for (const key of Object.keys(PROTOS)) {
  shot("arch", `proto-${key}`, async () => { await open(`example=${key}&wizard=0&archview=3d`, 3500); await zoomOut(key === "tower" ? 1.05 : 1.15); await b.sleep(500); });
}

// ---------------------------------------------------------------- машиностроение
const mech = (hash = "mode=mech") => open(hash, 2800);
const openDemo = async (i) => {
  await b.click("Демо-проекты", "button");
  await b.eval(`[...document.querySelectorAll("button")].filter((e) => e.offsetParent && !e.closest("#mech-ribbon") && e.innerText.trim() === "Открыть")[${i}].click(), true`);
  await b.sleep(1200);
  await b.eval(`BuildSense.mechApp.fitView(), true`); await b.sleep(400);
  await b.mouse(1180, 215);       // пустое место сцены: снять выделение детали
  await b.wheel(760, 480, 260);   // чуть отдалить, чтобы модель не уходила под нижние панели
};
shot("mech", "mech-gallery", async () => { await mech(); await b.click("Демо-проекты", "button"); await b.sleep(600); });
shot("mech", "mech-tutorial", async () => { await mech(); await b.click("Обучение", "button"); await b.sleep(900); });
shot("mech", "mech-engine-edit", async () => { await mech(); await openDemo(1); });
shot("mech", "mech-explode", async () => { await mech(); await openDemo(0); await b.click("Взрывной вид", "button"); await b.click("Разобрать", "button"); await b.sleep(2200); });
shot("mech", "mech-simulation", async () => { await mech(); await openDemo(1); await b.click("Симуляция", "button"); await b.click("Пуск", "button"); await b.sleep(1500); });
shot("mech", "mech-section", async () => { await mech(); await openDemo(1); await b.click("Разрез", "button"); await b.sleep(1000); });
shot("mech", "mech-jack-explode", async () => { await mech(); await openDemo(2); await b.click("Взрывной вид", "button"); await b.click("Разобрать", "button"); await b.sleep(2200); });
shot("mech", "mech-jack-simulation", async () => { await mech(); await openDemo(2); await b.click("Симуляция", "button"); await b.click("Пуск", "button"); await b.sleep(1800); });
shot("mech", "mech-shaft-section", async () => { await mech(); await openDemo(0); await b.click("Разрез", "button"); await b.sleep(1000); });

try {
  for (const s of shots) {
    if ((group !== "all" && s.group !== group) || (only.length && !only.includes(s.name))) continue;
    try { await s.fn(); await b.shot(out(s.name)); console.log("ok ", s.name); } catch (e) { console.log("ERR", s.name, e.message); }
  }
} finally { await b.close(); }
