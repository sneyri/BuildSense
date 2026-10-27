// BuildSense — общее пространство имён и утилиты.
// Все модули — обычные скрипты (не ES-модули): так приложение работает при открытии
// index.html двойным щелчком (file://), без сервера. Каждый модуль регистрирует себя в BS.<имя>.
// Модули без DOM и Three.js загружаются и в Node.js для автотестов (tests/loader.js).
(function (root) {
  "use strict";
  const BS = root.BuildSense || (root.BuildSense = {});
  BS.version = "1.0.0";

  const util = {
    clamp(v, min, max) {
      return Math.min(max, Math.max(min, v));
    },
    round(v, digits = 3) {
      const f = 10 ** digits;
      return Math.round(v * f) / f;
    },
    /** Число для показа: десятичная запятая, без лишних нулей. */
    fmt(v, digits = 2) {
      if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
      return String(util.round(Number(v), digits)).replace(".", ",");
    },
    clone(obj) {
      return JSON.parse(JSON.stringify(obj));
    },
    isObject(v) {
      return v !== null && typeof v === "object" && !Array.isArray(v);
    },
    /** Глубокое слияние простых объектов (массивы заменяются целиком). */
    merge(target, patch) {
      for (const [k, v] of Object.entries(patch || {})) {
        if (v === undefined) continue;
        if (util.isObject(v) && util.isObject(target[k])) util.merge(target[k], v);
        else target[k] = util.isObject(v) ? util.clone(v) : v;
      }
      return target;
    },
    nowIso() {
      return new Date().toISOString();
    },
  };
  BS.util = util;

  /** Простая шина событий: BS.events.on("change", fn); BS.events.emit("change", data). */
  const listeners = {};
  BS.events = {
    on(name, fn) {
      (listeners[name] || (listeners[name] = [])).push(fn);
    },
    emit(name, data) {
      for (const fn of listeners[name] || []) fn(data);
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
