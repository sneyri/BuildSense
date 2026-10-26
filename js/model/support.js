// Опирание: на что ставится элемент. Стены и полы «садятся» на верх фундамента
// или пола под ними — пользователю не нужно вводить отметку Z вручную.
import { elementTop, footprintContains } from "./placement.js";

export const SUPPORT_TYPES = ["foundation", "floor"];
export const LEVEL_TOL = 0.02; // м: допуск совпадения отметок

/**
 * Верх самого высокого основания (фундамент/пол) в точке плана, не выше below.
 * Возвращает { z, element } или null, если под точкой ничего нет.
 */
export function supportAt(project, x, y, { below = Infinity, types = SUPPORT_TYPES, excludeIds = [], tol = 0.001 } = {}) {
  let best = null;
  for (const el of project.elements) {
    if (!types.includes(el.type) || excludeIds.includes(el.id)) continue;
    if (!footprintContains(el, x, y, tol)) continue;
    const top = elementTop(el);
    if (top > below + LEVEL_TOL) continue;
    if (!best || top > best.z) best = { z: top, element: el };
  }
  return best;
}

/** Отметка установки по нескольким точкам: максимум найденных оснований (или fallback — по умолчанию 0, земля). */
export function supportLevel(project, points, options = {}) {
  let z = null;
  for (const p of points) {
    const s = supportAt(project, p.x, p.y, options);
    if (s && (z === null || s.z > z)) z = s.z;
  }
  return z ?? options.fallback ?? 0;
}
