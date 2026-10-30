// Мини-иллюстрации и пояснения к пунктам выпадающих списков и меню.
//   BS.thumbs[имя] — SVG 48×36 (цвета — токены темы, поэтому подходят любой теме);
//   BS.optionInfo.get(select, option) — { thumb | color, desc, tag } для пункта: сначала по data-info списка + значение, затем просто по значению.
//   Элементы с [data-thumb="имя"] получают иллюстрацию автоматически (меню «Новый проект»).
// Описания — простыми словами и без нормативных чисел: это подсказка, что выбираете, а не справочник.
(function (BS) {
  "use strict";
  const S = (inner) => `<svg viewBox="0 0 48 36" width="48" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
  const F = "fill=\"var(--accent-soft)\"";      // мягкая заливка акцентом
  const W = "fill=\"var(--panel-3)\"";          // заливка «материалом»
  const A = "stroke=\"var(--accent)\"";         // акцентная линия
  const body = `<rect x="12" y="17" width="24" height="14" ${W}/>`;
  const window_ = `<rect x="18" y="21" width="5" height="5" ${A}/>`;
  const house = (roof, extra = "") => S(`${body}${roof}${window_}<rect x="28" y="23" width="4" height="8" ${A}/>${extra}<path d="M4 31h40" stroke-opacity=".5"/>`);

  const thumbs = {
    // форма крыши
    gable: house(`<path d="M8 17 24 6l16 11z" ${F} ${A}/>`),
    hip: house(`<path d="M8 17l7-8h18l7 8z" ${F} ${A}/>`),
    shed: house(`<path d="M8 17V13l32-6v10z" ${F} ${A}/>`),
    flat: house(`<rect x="8" y="14" width="32" height="3" ${F} ${A}/>`),
    // фундамент
    slab: S(`<rect x="14" y="8" width="20" height="14" ${W}/><rect x="6" y="22" width="36" height="7" ${F} ${A}/><path d="M4 29h40" stroke-opacity=".5"/>`),
    strip: S(`<rect x="13" y="8" width="22" height="14" ${W}/><rect x="11" y="22" width="7" height="9" ${F} ${A}/><rect x="30" y="22" width="7" height="9" ${F} ${A}/><path d="M4 31h40" stroke-opacity=".5"/>`),
    // пол / перекрытие
    ground: S(`<rect x="6" y="8" width="5" height="18" ${W}/><rect x="37" y="8" width="5" height="18" ${W}/><rect x="11" y="22" width="26" height="4" ${F} ${A}/><path d="M4 26h40" stroke-opacity=".5"/>`),
    floor: S(`<rect x="6" y="20" width="5" height="12" ${W}/><rect x="37" y="20" width="5" height="12" ${W}/><rect x="6" y="14" width="36" height="5" ${F} ${A}/><rect x="6" y="4" width="5" height="9" ${W} stroke-opacity=".5"/><rect x="37" y="4" width="5" height="9" ${W} stroke-opacity=".5"/>`),
    attic: S(`<path d="M6 12 24 3l18 9" stroke-opacity=".6"/><rect x="6" y="14" width="36" height="4" ${F} ${A}/><rect x="6" y="18" width="5" height="13" ${W}/><rect x="37" y="18" width="5" height="13" ${W}/>`),
    // категории стен
    exterior: S(`<rect x="8" y="6" width="32" height="24" ${W}/><rect x="14" y="12" width="20" height="12" fill="none" stroke-dasharray="2 2" stroke-opacity=".5"/><path d="M8 6h32v4H8z" ${F} ${A}/>`),
    interior: S(`<rect x="6" y="6" width="36" height="24" fill="none" stroke-opacity=".5"/><rect x="21" y="6" width="6" height="24" ${F} ${A}/>`),
    partition: S(`<rect x="6" y="6" width="36" height="24" fill="none" stroke-opacity=".5"/><rect x="22.5" y="6" width="3" height="24" ${W}/>`),
    // проекты («Новый проект»)
    starter: house(`<path d="M8 17 24 6l16 11z" ${F} ${A}/>`),
    empty: S(`<rect x="8" y="6" width="32" height="24" rx="2" stroke-dasharray="3 3" stroke-opacity=".6"/><path d="M24 14v8M20 18h8" ${A}/>`),
    "example-l": S(`<path d="M8 8h18v10h14v14H8z" ${W}/><path d="M8 8h18v10h14" ${A}/><path d="M14 14h6M14 24h20" stroke-opacity=".4"/>`),
    "example-two": S(`<rect x="12" y="15" width="24" height="16" ${W}/><path d="M12 23h24" stroke-opacity=".5"/><path d="M8 15 24 5l16 10z" ${F} ${A}/><rect x="17" y="18" width="4" height="3" ${A}/><rect x="27" y="18" width="4" height="3" ${A}/><rect x="17" y="26" width="4" height="3" ${A}/><path d="M4 31h40" stroke-opacity=".5"/>`),
    "example-issues": S(`${body}<path d="M8 17 24 6l16 11z" ${F} ${A}/><path d="M24 20v6" stroke="var(--err)" stroke-width="2"/><circle cx="24" cy="29" r="1" fill="var(--err)" stroke="none"/><path d="M4 31h40" stroke-opacity=".5"/>`),
    // сценарии симуляции
    remove_support: S(`<rect x="6" y="6" width="36" height="5" ${F} ${A}/><rect x="9" y="11" width="5" height="20" ${W}/><rect x="34" y="11" width="5" height="20" ${W}/><rect x="21.5" y="11" width="5" height="20" fill="none" stroke="var(--err)" stroke-dasharray="2 2"/>`),
    slab_overload: S(`<rect x="6" y="16" width="36" height="5" ${F} ${A}/><rect x="9" y="21" width="5" height="10" ${W}/><rect x="34" y="21" width="5" height="10" ${W}/><path d="M16 4v8M24 4v8M32 4v8M13 9l3 3 3-3M21 9l3 3 3-3M29 9l3 3 3-3" stroke="var(--warn)"/>`),
    wall_buckling: S(`<path d="M14 31 22 6h6l-4 25z" ${W}/><path d="M34 31 30 6" stroke-dasharray="2 2" stroke-opacity=".5"/><path d="M4 31h40" stroke-opacity=".5"/>`),
    cascade: S(`<rect x="8" y="9" width="4" height="22" ${W}/><rect x="18" y="12" width="4" height="19" ${W} transform="rotate(8 20 31)"/><rect x="29" y="17" width="4" height="14" ${W} transform="rotate(26 31 31)"/><path d="M4 31h40" stroke-opacity=".5"/>`),
    lateral: S(`<rect x="22" y="8" width="8" height="23" ${W}/><path d="M4 16h14M13 11l5 5-5 5" stroke="var(--warn)"/><path d="M4 31h40" stroke-opacity=".5"/>`),
    // сопряжения деталей (вид сбоку)
    coaxial: S(`<rect x="6" y="12" width="14" height="12" ${W}/><rect x="24" y="8" width="18" height="20" ${W}/><path d="M3 18h42" stroke-dasharray="3 2" ${A}/>`),
    contact: S(`<rect x="6" y="10" width="18" height="16" ${W}/><rect x="24" y="14" width="18" height="12" ${W}/><path d="M24 8v20" ${A} stroke-width="2"/>`),
    align: S(`<rect x="6" y="8" width="16" height="22" ${W}/><rect x="26" y="8" width="16" height="14" ${W}/><path d="M3 8h42" stroke-dasharray="3 2" ${A}/>`),
    distance: S(`<rect x="6" y="10" width="12" height="16" ${W}/><rect x="30" y="10" width="12" height="16" ${W}/><path d="M18 18h12M21 15l-3 3 3 3M27 15l3 3-3 3" ${A}/>`),
    // темы оформления: три полосы — фон, панель, акцент
    "theme-dark": S(`<rect x="4" y="4" width="40" height="28" rx="2" fill="#16181b" stroke="#4a515a"/><rect x="4" y="4" width="40" height="6" fill="#24282d" stroke="none"/><rect x="6" y="13" width="10" height="17" fill="#1d2024" stroke="none"/><rect x="19" y="13" width="23" height="3" fill="#4d8fdc" stroke="none"/><rect x="19" y="19" width="16" height="2" fill="#959ca6" stroke="none"/>`),
    "theme-light": S(`<rect x="4" y="4" width="40" height="28" rx="2" fill="#e8eaed" stroke="#b4bac2"/><rect x="4" y="4" width="40" height="6" fill="#ffffff" stroke="none"/><rect x="6" y="13" width="10" height="17" fill="#f6f7f8" stroke="none"/><rect x="19" y="13" width="23" height="3" fill="#1f62c0" stroke="none"/><rect x="19" y="19" width="16" height="2" fill="#5b636e" stroke="none"/>`),
    "theme-tflex": S(`<rect x="4" y="4" width="40" height="28" rx="2" fill="#dfe5ec" stroke="#9fabbb"/><rect x="4" y="4" width="40" height="6" fill="#f2f5f9" stroke="none"/><rect x="6" y="13" width="10" height="17" fill="#ffffff" stroke="none"/><rect x="19" y="13" width="23" height="3" fill="#1b6ac9" stroke="none"/><rect x="19" y="19" width="16" height="2" fill="#566274" stroke="none"/>`),
    "theme-blueprint": S(`<rect x="4" y="4" width="40" height="28" rx="2" fill="#0b2a5b" stroke="#7fa6e6"/><rect x="4" y="4" width="40" height="6" fill="#134085" stroke="none"/><rect x="6" y="13" width="10" height="17" fill="#0f3470" stroke="none"/><rect x="19" y="13" width="23" height="3" fill="#ffffff" stroke="none"/><rect x="19" y="19" width="16" height="2" fill="#b3c9ee" stroke="none"/>`),
  };

  // ------------------------------------------------------------ пояснения (по значению пункта; «контекст:значение» важнее)
  const D = {
    // форма крыши
    gable: ["gable", "Два ската сходятся в коньке — самая привычная форма дома."],
    hip: ["hip", "Четыре ската: торцы тоже наклонены, треугольных фронтонов нет."],
    shed: ["shed", "Один скат: одна сторона дома выше другой."],
    flat: ["flat", "Почти без уклона — как плита сверху дома."],
    // фундамент и перекрытия
    slab: ["slab", "Сплошная плита под всем домом."],
    strip: ["strip", "Полосы только под стенами, внутри — пусто."],
    ground: ["ground", "Пол первого этажа: плита внутри стен, на фундаменте."],
    floor: ["floor", "Плита поверх стен этажа — на неё встаёт следующий этаж."],
    attic: ["attic", "Плита над верхним этажом, под крышей."],
    // категории стен
    "wall.category:exterior": ["exterior", "Стена по периметру дома. Держит перекрытия и крышу."],
    "wall.category:interior": ["interior", "Стена внутри дома, которая тоже держит перекрытия."],
    "wall.category:partition": ["partition", "Лёгкая стенка между комнатами. Ничего не держит."],
    "door.category:entrance": [null, "Входная дверь — ведёт наружу."],
    "door.category:interior": [null, "Межкомнатная дверь — между помещениями."],
    // жилищный фонд
    private: [null, "Дом в частной собственности."],
    public: [null, "Дом государственного или муниципального жилого фонда."],
    // сценарии симуляции
    remove_support: ["remove_support", "Выбранная опора перестаёт работать. Видно, что держалось на ней."],
    slab_overload: ["slab_overload", "На перекрытие кладётся нагрузка больше обычной."],
    wall_buckling: ["wall_buckling", "Тонкая высокая стена теряет устойчивость."],
    cascade: ["cascade", "Одна опора отказывает и тянет за собой соседние."],
    lateral: ["lateral", "Боковая сила, например ветер: падают самые неустойчивые элементы."],
    // новый проект
    starter: ["starter", "Небольшой дом: фундамент, стены, окна, двери, крыша. Готовая основа, которую можно менять."],
    empty: ["empty", "Чистый лист. Рисуйте контур и стройте дом с нуля."],
    "example-l": ["example-l", "Г-образный дом из двух частей, с крышей над каждой."],
    "example-two": ["example-two", "Двухэтажный дом с лестницей, камином и террасой."],
    "example-issues": ["example-issues", "Дом с намеренными ошибками. Найдите их на вкладке «Проблемы»."],
    // сопряжения
    coaxial: ["coaxial", null], contact: ["contact", null], align: ["align", null], distance: ["distance", null],
    // шаг сетки
    "grid:0.05": [null, "Мелкий шаг: для точной подгонки."],
    "grid:0.1": [null, "Удобно для большинства построений."],
    "grid:0.25": [null, "Средний шаг для стен и проёмов."],
    "grid:0.5": [null, "Крупный шаг для больших планов."],
    "grid:1": [null, "Самый грубый — для быстрых набросков."],
    // темы
    "theme:dark": ["theme-dark", "Тёмный фон, мягкий для глаз при долгой работе."],
    "theme:light": ["theme-light", "Светлый фон — привычен для работы днём и для печати."],
    "theme:tflex": ["theme-tflex", "Светлые панели и синие акценты, как в САПР."],
    "theme:blueprint": ["theme-blueprint", "Белые линии на синем, как классическая синька."],
  };

  // материалы здания: цветной квадрат из самой модели и короткое «для чего»
  const MATERIAL_DESC = {
    concrete: "Прочный и тяжёлый: фундаменты, перекрытия, колонны.",
    brick: "Классическая кладка для стен.",
    aerated: "Лёгкий тёплый блок для стен.",
    timber: "Деревянный брус: стены, балки, каркас.",
    steel: "Металл: балки, колонны, фермы.",
    glass: "Окна и остекление.",
    metal_tile: "Кровля из металла с рисунком под черепицу.",
    soft_tile: "Мягкая кровля из гибких листов.",
    membrane: "Рулонная кровля для плоских крыш.",
    pvc: "Пластиковый профиль для окон.",
    wood_door: "Дерево для дверей.",
    ceramic: "Керамика: сантехника, плитка.",
    fabric: "Мебель и текстиль.",
    plastic: "Пластик.",
    zone: "Условная зона без материала (помещение).",
    ceramic_block: "Пустотелый керамический блок для стен.",
    silicate_brick: "Светлый силикатный кирпич для стен.",
    log: "Бревно или клеёный брус для деревянного дома.",
    clay_tile: "Классическая черепица из обожжённой глины.",
    profiled_sheet: "Профилированный металлический лист для кровли.",
  };

  function get(sel, opt) {
    const info = sel.dataset.info ? sel.dataset.info + ":" : "";
    const d = D[info + opt.value] || D[opt.value];
    const out = { thumb: opt.dataset.thumb || (d && d[0]) || null, desc: opt.dataset.desc || (d && d[1]) || "", tag: opt.dataset.tag || "", color: opt.dataset.color || "" };
    const m = BS.materials && BS.materials.MATERIALS && BS.materials.MATERIALS[opt.value];
    if (!out.thumb && !out.color && m && /материал|material/i.test((sel.closest("label") || {}).textContent + (sel.getAttribute("aria-label") || ""))) {
      out.color = m.color;
      out.desc = out.desc || MATERIAL_DESC[opt.value] || "";
    }
    return out;
  }

  /** Подставить иллюстрации в [data-thumb]. */
  function apply(root = document) {
    root.querySelectorAll("[data-thumb]").forEach((n) => { if (!n.firstChild && thumbs[n.dataset.thumb]) n.innerHTML = thumbs[n.dataset.thumb]; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => apply()); else apply();

  BS.thumbs = thumbs;
  BS.optionInfo = { get, apply, DESC: D };
})(globalThis.BuildSense || (globalThis.BuildSense = {}));
