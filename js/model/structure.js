// «Подсказки конструктора» — инженерные эвристики для учебного прототипа.
// Это НЕ нормы и НЕ расчёт: они ловят типичные ошибки построения (стена висит в воздухе,
// не связана с другими стенами, крыша не лежит на стенах и т. п.) и подсказывают, что исправить.
// Пороговые значения ниже — условные ориентиры, а не требования СП.
import { OPENING_TYPES } from "./catalog.js";
import {
  elementTop, footprint, footprintContains, overlapArea, polygonDistance, wallLocalToWorld,
} from "./placement.js";
import { LEVEL_TOL } from "./support.js";
import { addRectElement, updateElement } from "./project.js";

export const SEVERITY = { error: "ошибка", warning: "предупреждение", tip: "совет" };

export const HEURISTICS = {
  touch: 0.02,               // м: стены «связаны», если их контуры касаются
  freeWallSlenderness: 12,   // h/t для стены без связей с другими стенами
  maxSlenderness: 25,        // h/t для любой стены
  minPier: 0.25,             // м: минимальный простенок у края стены и между проёмами
  wideOpening: 2.5,          // м: широкий проём в наружной стене
  lintelSpace: 0.15,         // м: место над проёмом под перемычку
  maxOpeningShare: 0.6,      // доля длины стены, занятая проёмами
  minFoundationDepth: 0.5,   // м: заглубление фундамента ниже отметки 0
};

const H = HEURISTICS;

/**
 * Анализ модели. Возвращает список подсказок:
 * { id, elementId|null, severity: "error"|"warning"|"tip", title, message, fix?: { label, action } }
 * fix.action — описание исправления, которое выполняет applyFix().
 */
export function analyzeStructure(project) {
  const out = [];
  const add = (item) => out.push({ id: `${item.code}:${item.elementId || "model"}${item.suffix || ""}`, ...item });
  const walls = project.elements.filter((e) => e.type === "wall");
  const foundations = project.elements.filter((e) => e.type === "foundation");
  const floors = project.elements.filter((e) => e.type === "floor");
  const exterior = walls.filter((w) => w.category === "exterior");

  if (walls.length && !foundations.length) {
    add({
      code: "no-foundation", elementId: null, severity: "error",
      title: "В доме нет фундамента",
      message: "Стены должны передавать нагрузку на фундамент. Добавьте фундаментную плиту под наружные стены.",
      fix: { label: "Добавить фундамент под стены", action: { type: "add-foundation" } },
    });
  }

  for (const wall of walls) {
    checkWallSupport(project, wall, add);
    checkWallConnections(project, wall, walls, add);
    checkOpenings(project, wall, add);
  }
  checkWallOverlaps(walls, add);

  for (const roof of project.elements.filter((e) => e.type === "roof" && e.category === "main")) {
    checkRoof(roof, exterior, add);
  }
  for (const floor of floors) checkFloor(project, floor, walls, foundations, add);
  for (const f of foundations) {
    if (f.category !== "strip" || f.position.z + f.size.thickness > LEVEL_TOL) continue;
    if (-f.position.z < H.minFoundationDepth) {
      add({
        code: "shallow-foundation", elementId: f.id, severity: "tip",
        title: "Неглубокий фундамент",
        message: `Заглубление ${fmt(-f.position.z)} м. Глубину заложения определяют расчётом по СП 22.13330 с учётом промерзания и грунтов.`,
      });
    }
  }
  const order = { error: 0, warning: 1, tip: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ---------------------------------------------------------------- стены

/** Доля длины стены, под которой есть опора на уровне её низа: фундамент, пол или стена ниже. */
export function wallSupport(project, wall) {
  const z = wall.position.z;
  const samples = 11;
  let supported = 0;
  let below = null; // ближайшая опора ниже низа стены (для подсказки «опустить»)
  for (let i = 0; i < samples; i++) {
    const u = (wall.size.length * (i + 0.5)) / samples;
    const p = wallLocalToWorld(wall, u, wall.size.thickness / 2, 0);
    let ok = false;
    for (const s of project.elements) {
      if (s.id === wall.id || !["foundation", "floor", "wall"].includes(s.type)) continue;
      if (!footprintContains(s, p.x, p.y, 0.005)) continue;
      const top = elementTop(s);
      if (Math.abs(top - z) <= LEVEL_TOL) ok = true;
      else if (top < z && (below === null || top > below)) below = top;
    }
    if (ok) supported++;
  }
  return { share: supported / samples, gapTo: below };
}

function checkWallSupport(project, wall, add) {
  const { share, gapTo } = wallSupport(project, wall);
  const z = wall.position.z;
  if (share === 0) {
    const fix = gapTo !== null
      ? { label: `Опустить на основание (−${fmt(z - gapTo)} м)`, action: { type: "set-z", elementId: wall.id, z: gapTo } }
      : null;
    add({
      code: "wall-unsupported", elementId: wall.id, severity: "error",
      title: `${wall.name}: стена ни на что не опирается`,
      message: gapTo !== null
        ? `Между низом стены и основанием под ней зазор ${fmt(z - gapTo)} м — стена «висит в воздухе».`
        : "Под стеной нет ни фундамента, ни пола. Перенесите стену на фундамент или добавьте фундамент под ней.",
      fix,
    });
  } else if (share < 0.95) {
    add({
      code: "wall-partial", elementId: wall.id, severity: "warning",
      title: `${wall.name}: опирается только частично`,
      message: `Опора есть примерно под ${Math.round(share * 100)} % длины стены. Остальная часть консольно свисает — расширьте фундамент или перенесите стену.`,
    });
  }
  if (wall.category === "exterior" && share > 0) {
    const onFoundation = project.elements.some((f) => f.type === "foundation" &&
      Math.abs(elementTop(f) - z) <= LEVEL_TOL &&
      footprintContains(f, ...center2(wall), 0.005));
    const onWall = project.elements.some((w) => w.type === "wall" && w.id !== wall.id &&
      Math.abs(elementTop(w) - z) <= LEVEL_TOL && footprintContains(w, ...center2(wall), 0.005));
    if (!onFoundation && !onWall) {
      add({
        code: "exterior-on-slab", elementId: wall.id, severity: "warning",
        title: `${wall.name}: наружная стена стоит на полу, а не на фундаменте`,
        message: "Наружные (несущие) стены обычно опираются на фундамент или на стену нижнего этажа, а не на плиту пола.",
      });
    }
  }
}

function center2(el) {
  const p = wallLocalToWorld(el, el.size.length / 2, el.size.thickness / 2, 0);
  return [p.x, p.y];
}

function checkWallConnections(project, wall, walls, add) {
  const poly = footprint(wall);
  const sameLevel = walls.filter((w) => w.id !== wall.id &&
    w.position.z < wall.position.z + wall.size.height - LEVEL_TOL &&
    w.position.z + w.size.height > wall.position.z + LEVEL_TOL);
  const links = sameLevel.filter((w) => polygonDistance(poly, footprint(w)) <= H.touch);
  const slender = wall.size.height / wall.size.thickness;

  if (!links.length && slender > H.freeWallSlenderness) {
    add({
      code: "free-wall", elementId: wall.id, severity: "warning",
      title: `${wall.name}: отдельно стоящая стена неустойчива`,
      message: `Стена не связана ни с одной другой стеной, гибкость h/t = ${fmt(slender, 1)}. ` +
        "Примкните её к другой стене (магнит при перетаскивании), увеличьте толщину или уберите стену.",
    });
  } else if (slender > H.maxSlenderness) {
    add({
      code: "slender-wall", elementId: wall.id, severity: "warning",
      title: `${wall.name}: слишком тонкая для своей высоты`,
      message: `Гибкость h/t = ${fmt(slender, 1)} (ориентир — не более ${H.maxSlenderness}). Увеличьте толщину.`,
      fix: { label: `Толщина ${fmt(wall.size.height / H.maxSlenderness + 0.005, 2)} м`, action: { type: "set-thickness", elementId: wall.id, thickness: Math.ceil((wall.size.height / H.maxSlenderness) * 100) / 100 } },
    });
  }

  if (wall.category === "exterior") {
    // Каждый торец наружной стены должен примыкать к другой стене — иначе контур дома не замкнут
    const ends = [0, wall.size.length].map((u) => [
      wallLocalToWorld(wall, u, 0, 0), wallLocalToWorld(wall, u, wall.size.thickness, 0),
    ].map((p) => ({ x: p.x, y: p.y })));
    const exteriorLinks = links.filter((w) => w.category === "exterior");
    ends.forEach((seg, i) => {
      const joined = exteriorLinks.some((w) => polygonDistance(seg, footprint(w)) <= H.touch);
      if (!joined) {
        add({
          code: "open-corner", elementId: wall.id, suffix: `:${i}`, severity: "warning",
          title: `${wall.name}: ${i ? "конец" : "начало"} стены ни к чему не примыкает`,
          message: "Контур наружных стен не замкнут: угол дома без перевязки снижает жёсткость. Подтяните стену к соседней — сработает магнит к углу.",
        });
      }
    });
  }
}

function checkWallOverlaps(walls, add) {
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i], b = walls[j];
      const zOverlap = Math.min(elementTop(a), elementTop(b)) - Math.max(a.position.z, b.position.z);
      if (zOverlap <= LEVEL_TOL) continue;
      const area = overlapArea(footprint(a), footprint(b));
      if (area > 0.005) {
        add({
          code: "wall-overlap", elementId: b.id, suffix: `:${a.id}`, severity: "warning",
          title: `${b.name} пересекается с «${a.name}»`,
          message: `Стены входят друг в друга (≈ ${fmt(area, 2)} м² на плане). Сдвиньте стену так, чтобы она только примыкала.`,
        });
      }
    }
  }
}

function checkOpenings(project, wall, add) {
  const ops = project.elements
    .filter((o) => OPENING_TYPES.includes(o.type) && o.hostId === wall.id)
    .sort((a, b) => a.position.offset - b.position.offset);
  if (!ops.length) return;
  const L = wall.size.length;
  let used = 0;
  ops.forEach((o, i) => {
    used += o.size.width;
    const left = o.position.offset;
    const right = L - (o.position.offset + o.size.width);
    for (const [gap, where] of [[left, "в начале"], [right, "в конце"]]) {
      if (gap > 0.001 && gap < H.minPier && wall.category === "exterior") {
        add({
          code: "narrow-pier", elementId: o.id, suffix: where, severity: "warning",
          title: `${o.name}: узкий простенок у края стены`,
          message: `Простенок ${fmt(gap, 2)} м ${where} стены «${wall.name}» (ориентир — не менее ${H.minPier} м). Угол дома ослаблен — сдвиньте проём.`,
        });
      }
    }
    const next = ops[i + 1];
    if (next) {
      const between = next.position.offset - (o.position.offset + o.size.width);
      if (between >= 0 && between < H.minPier) {
        add({
          code: "narrow-pier-between", elementId: next.id, suffix: o.id, severity: "warning",
          title: `${o.name} и ${next.name}: узкий простенок`,
          message: `Между проёмами ${fmt(between, 2)} м (ориентир — не менее ${H.minPier} м). Раздвиньте проёмы или объедините их.`,
        });
      }
    }
    if (wall.category === "exterior" && o.size.width > H.wideOpening) {
      add({
        code: "wide-opening", elementId: o.id, severity: "tip",
        title: `${o.name}: широкий проём ${fmt(o.size.width, 2)} м`,
        message: "Над широким проёмом в несущей стене нужна усиленная перемычка (подбирается расчётом).",
      });
    }
    const above = wall.size.height - (o.position.elevation + o.size.height);
    if (above < H.lintelSpace) {
      add({
        code: "no-lintel", elementId: o.id, severity: "tip",
        title: `${o.name}: нет места под перемычку`,
        message: `Над проёмом остаётся ${fmt(above, 2)} м стены. Опустите проём или уменьшите его высоту.`,
      });
    }
  });
  if (used / L > H.maxOpeningShare) {
    add({
      code: "weak-wall", elementId: wall.id, severity: "warning",
      title: `${wall.name}: стена сильно ослаблена проёмами`,
      message: `Проёмы занимают ${Math.round((used / L) * 100)} % длины стены (ориентир — не более ${Math.round(H.maxOpeningShare * 100)} %).`,
    });
  }
}

// ---------------------------------------------------------------- крыша и полы

function checkRoof(roof, exterior, add) {
  if (!exterior.length) {
    add({
      code: "roof-no-walls", elementId: roof.id, severity: "error",
      title: "Крыша без стен", message: "Крыше не на что опереться: в модели нет наружных стен.",
    });
    return;
  }
  const top = Math.max(...exterior.map(elementTop));
  const z = roof.position.z;
  if (Math.abs(z - top) > LEVEL_TOL) {
    add({
      code: "roof-gap", elementId: roof.id, severity: "error",
      title: z > top ? "Крыша висит над стенами" : "Крыша врезается в стены",
      message: `Низ крыши на отметке ${fmt(z)} м, верх наружных стен — ${fmt(top)} м.`,
      fix: { label: "Положить крышу на стены", action: { type: "set-z", elementId: roof.id, z: top } },
    });
  }
  const roofPoly = footprint(roof);
  const uncovered = exterior.filter((w) => footprint(w).some((c) => !footprintContains(roof, c.x, c.y, 0.01)));
  if (uncovered.length && roofPoly.length) {
    add({
      code: "roof-cover", elementId: roof.id, severity: "warning",
      title: "Крыша не перекрывает все стены",
      message: `За пределами крыши: ${uncovered.map((w) => w.name).join(", ")}. Увеличьте размеры крыши или свесы.`,
    });
  }
}

function checkFloor(project, floor, walls, foundations, add) {
  const z = floor.position.z;
  if (z <= LEVEL_TOL) {
    const onFoundation = foundations.some((f) => Math.abs(elementTop(f) - z) <= LEVEL_TOL &&
      footprintContains(f, ...floorCenter(floor), 0.01));
    if (!onFoundation && foundations.length) {
      add({
        code: "floor-on-ground", elementId: floor.id, severity: "tip",
        title: `${floor.name}: пол лежит на грунте`,
        message: "Пол первого этажа не опирается на фундаментную плиту. Для пола по грунту нужна подготовка основания.",
      });
    }
    return;
  }
  // Перекрытие: должно лежать на стенах или на основании
  const grown = grow(footprint(floor), 0.05);
  const bearing = walls.filter((w) => elementTop(w) >= z - LEVEL_TOL && w.position.z < z &&
    overlapArea(grown, footprint(w)) > 0.001);
  const onSupport = project.elements.some((s) => ["foundation", "floor"].includes(s.type) && s.id !== floor.id &&
    Math.abs(elementTop(s) - z) <= LEVEL_TOL && footprintContains(s, ...floorCenter(floor), 0.01));
  if (bearing.length < 2 && !onSupport) {
    add({
      code: "slab-unsupported", elementId: floor.id, severity: "error",
      title: `${floor.name}: перекрытие не опирается на стены`,
      message: "Перекрытие должно лежать минимум на двух стенах (или на основании). Подвиньте его к стенам или добавьте стены под ним.",
    });
  }
}

function floorCenter(el) {
  const p = wallLocalToWorld(el, el.size.length / 2, el.size.width / 2, 0);
  return [p.x, p.y];
}

function grow(poly, d) {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map((p) => {
    const len = Math.hypot(p.x - cx, p.y - cy) || 1;
    return { x: p.x + ((p.x - cx) / len) * d * Math.SQRT2, y: p.y + ((p.y - cy) / len) * d * Math.SQRT2 };
  });
}

function fmt(v, digits = 2) {
  return String(Math.round(v * 10 ** digits) / 10 ** digits).replace(".", ",");
}

/** Список id элементов с самой серьёзной подсказкой — для подсветки в 3D. */
export function severityByElement(items) {
  const rank = { error: 2, warning: 1, tip: 0 };
  const map = new Map();
  for (const it of items) {
    if (!it.elementId || it.severity === "tip") continue;
    const prev = map.get(it.elementId);
    if (!prev || rank[it.severity] > rank[prev]) map.set(it.elementId, it.severity);
  }
  return map;
}

/** Выполняет исправление из подсказки. Возвращает текст для строки состояния. */
export function applyFix(project, action) {
  if (action.type === "set-z") {
    const el = project.elements.find((e) => e.id === action.elementId);
    updateElement(project, action.elementId, { position: { ...el.position, z: action.z } });
    return `${el.name}: низ перенесён на отметку ${fmt(action.z)} м`;
  }
  if (action.type === "set-thickness") {
    updateElement(project, action.elementId, { size: { thickness: action.thickness } });
    return `Толщина стены изменена на ${fmt(action.thickness)} м`;
  }
  if (action.type === "add-foundation") {
    const walls = project.elements.filter((e) => e.type === "wall");
    const pts = walls.flatMap(footprint);
    const a = { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) };
    const b = { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) };
    const f = addRectElement(project, "foundation", a, b);
    // Стены, стоявшие на грунте, теперь стоят на верхе фундамента (отметка 0)
    return `Добавлен ${f.name} ${fmt(b.x - a.x)} × ${fmt(b.y - a.y)} м`;
  }
  throw new Error(`Неизвестное исправление: ${action.type}`);
}
