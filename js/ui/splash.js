// Экран загрузки: показывается, пока грузятся скрипты и строится интерфейс; затем плавно гаснет и убирается из DOM.
// Минимум ~0,5 с, чтобы не мигать на быстрой загрузке, максимум 8 с — на случай сбоя, чтобы не закрывать приложение навсегда.
(function () {
  "use strict";
  const splash = document.getElementById("splash");
  if (!splash) return;
  const MIN_MS = 500, MAX_MS = 8000;
  let done = false;

  function hide() {
    if (done) return;
    done = true;
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 400);
  }

  function ready() {
    const left = Math.max(0, MIN_MS - performance.now());
    // два кадра: интерфейс успел отрисоваться под экраном загрузки
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(hide, left)));
  }

  if (document.readyState === "complete") ready(); else window.addEventListener("load", ready, { once: true });
  setTimeout(hide, MAX_MS);
})();
