// Мини-обёртка над Chrome DevTools Protocol (без зависимостей, нужен Node 22+ с WebSocket и установленный Chrome/Edge).
// Используется tools/make-screenshots.mjs для съёмки скриншотов прямо из программы.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1600, height = 900, port = 9333 } = {}) {
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error("Не найден Chrome/Edge: задайте CHROME_PATH");
  const profile = mkdtempSync(path.join(os.tmpdir(), "bs-chrome-"));
  const proc = spawn(exe, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    "--force-device-scale-factor=1", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--allow-file-access-from-files", "about:blank",
  ], { stdio: "ignore" });
  let list = null;
  for (let i = 0; i < 60 && !list; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(250); }
  }
  if (!list) throw new Error("Chrome не запустился");
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

  const api = {
    send, sleep,
    async goto(url, wait = 1800) { await send("Page.navigate", { url }); await sleep(wait); },
    async eval(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    /** Нажать на видимую кнопку по тексту (подстрока), в пределах selector. */
    async click(text, selector = "button, [role=menuitem], .menu-item, a") {
      const ok = await api.eval(`(() => {
        const t = ${JSON.stringify(text)};
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.offsetParent !== null && (e.innerText || e.title || "").trim().toLowerCase().includes(t.toLowerCase()));
        if (!els.length) return false; els[0].click(); return true; })()`);
      if (!ok) throw new Error(`Не найдена кнопка «${text}»`);
      await sleep(500);
    },
    /** Щелчок мыши в точке окна (например, по пустому месту сцены — снять выделение). */
    async mouse(x, y) {
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      await sleep(300);
    },
    /** Колесо мыши над точкой окна: dy > 0 — отдалить. */
    async wheel(x, y, dy) { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy }); await sleep(600); },
    async shot(file, { clip } = {}) {
      const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      writeFileSync(file, Buffer.from(r.data, "base64"));
    },
    async close() { try { await send("Browser.close"); } catch { /* уже закрыт */ } ws.close(); proc.kill(); },
  };
  return api;
}
