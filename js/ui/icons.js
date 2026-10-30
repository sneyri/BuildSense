// Набор SVG-иконок в едином стиле: сетка 24×24, показ 16×16, линия 1,5 px на экране
// (vector-effect: non-scaling-stroke), скруглённые концы. Используются через data-icon="имя" или BS.icons.svg("имя").
(function (BS) {
  "use strict";
  const P = {
    file: "M6 3h8l4 4v14H6z M14 3v4h4",
    open: "M3 7h6l2 2h10v10H3z",
    save: "M5 3h12l4 4v14H5z M8 3v6h8V3 M8 21v-7h8v7",
    undo: "M9 7L4 12l5 5 M4 12h11a5 5 0 0 1 0 10h-3",
    redo: "M15 7l5 5-5 5 M20 12H9a5 5 0 0 0 0 10h3",
    export: "M12 3v12 M7 10l5 5 5-5 M4 19h16",
    wizard: "M4 20L16 8 M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z M19 11l.7 1.3L21 13l-1.3.7L19 15l-.7-1.3L17 13l1.3-.7z",
    theme: "M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z",
    help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.9 2.1c-.9.6-1.4 1.1-1.4 2.2M12 17h.01",
    cursor: "M5 3l13 8-6 1-3 6z",
    cube: "M12 2l9 5v10l-9 5-9-5V7z M12 12l9-5 M12 12L3 7 M12 12v10",
    plan: "M3 3h18v18H3z M3 12h9 M12 3v18 M12 16h9",
    front: "M4 21V9l8-6 8 6v12z M9 21v-6h6v6",
    fit: "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5",
    ortho: "M4 6h16v12H4z M4 6l4-3h16l-4 3 M20 18l4-3V3",
    ruler: "M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2",
    isolate: "M12 5c5 0 9 7 9 7s-4 7-9 7-9-7-9-7 4-7 9-7z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    magnet: "M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3z M6 7h4 M14 7h4",
    wall: "M3 7h18v10H3z M3 12h18 M9 7v5 M15 12v5",
    slab: "M3 10l9-4 9 4-9 4z M3 10v3l9 4 9-4v-3",
    strip: "M3 15h18v4H3z M5 15V9h3v6 M16 15V9h3v6",
    pad: "M8 4h8v8H8z M5 12h14v6H5z",
    round: "M12 4a6 2 0 1 0 0 .01 M6 4v14a6 2 0 0 0 12 0V4",
    pile: "M10 2h4v16l-2 4-2-4z",
    column: "M8 3h8v18H8z M6 3h12 M6 21h12",
    beam: "M2 9h20v6H2z M6 15v6 M18 15v6",
    truss: "M2 18h20 M2 18L12 6l10 12 M7 12v6 M12 6v12 M17 12v6 M7 18l5-12 M17 18L12 6",
    stairs: "M3 21h4v-4h4v-4h4V9h4V5h2",
    roof: "M2 12L12 4l10 8 M5 10v10h14V10",
    window: "M4 4h16v16H4z M12 4v16 M4 12h16",
    door: "M6 3h12v18H6z M15 12h.01",
    balcony: "M3 12h18v2H3z M4 14v6 M8 14v6 M12 14v6 M16 14v6 M20 14v6 M3 20h18",
    railing: "M3 8h18 M3 14h18 M5 8v12 M10 8v12 M14 8v12 M19 8v12",
    chimney: "M8 3h6v8H8z M3 21l9-10 9 10",
    room: "M4 4h16v16H4z M4 4l16 16",
    decor: "M3 8h18v3H3z M5 11v2h14v-2",
    pipe: "M3 9h12a4 4 0 0 1 4 4v8 M3 15h12v6",
    toilet: "M7 3h6v7H7z M5 10h12c0 5-3 7-6 7v4H9v-4c-3 0-4-3-4-7z",
    sink: "M3 10h18c0 5-4 7-9 7s-9-2-9-7z M12 3v4 M10 3h4",
    bathtub: "M3 11h18v4a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z M5 11V5a2 2 0 0 1 4 0",
    light: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10.5c1 1 1 2 1 3h6c0-1 0-2 1-3A6 6 0 0 0 12 3z",
    socket: "M4 4h16v16H4z M9 10v2 M15 10v2 M9 16h6",
    switch: "M6 3h12v18H6z M10 8h4v8h-4z",
    bed: "M3 18V8 M3 13h18v5 M3 13V11h6v2 M21 18v-5",
    table: "M3 8h18v3H3z M5 11v9 M19 11v9",
    chair: "M7 3v10h10 M7 13v8 M17 13v8 M7 9h10",
    sofa: "M3 11h18v6H3z M5 11V7h14v4 M5 17v3 M19 17v3",
    wardrobe: "M5 3h14v18H5z M12 3v18 M10 12h.01 M14 12h.01",
    plus: "M12 5v14 M5 12h14",
    trash: "M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14",
    copy: "M8 8h12v12H8z M4 16V4h12",
    rotate: "M20 11a8 8 0 1 0-3 6.3 M20 4v7h-7",
    play: "M7 4l13 8-13 8z",
    step: "M5 4l10 8-10 8z M17 4v16",
    back: "M19 4L9 12l10 8z M7 4v16",
    reset: "M4 12a8 8 0 1 0 3-6.2 M4 4v5h5",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    level: "M3 7h18 M3 12h18 M3 17h18",
    calc: "M6 3h12v18H6z M9 7h6 M9 11h.01 M12 11h.01 M15 11h.01 M9 15h.01 M12 15h.01 M15 15h.01",
    check: "M4 12l5 5L20 6",
    code: "M8 7l-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16",
    // режимы и рабочая область
    "mode-arch": "M3 11l9-7 9 7 M5 9.5V20h14V9.5 M10 20v-6h4v6",
    "mode-mech": "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1",
    plan2d: "M3 4h18v16H3z M3 10h7v10 M10 4v3 M14 10h7 M14 10v4",
    split: "M3 4h18v16H3z M12 4v16 M15 9l2.5-1.5L20 9v4l-2.5 1.5L15 13z",
    view3d: "M12 2l9 5v10l-9 5-9-5V7z M12 12l9-5 M12 12L3 7 M12 12v10",
    clean: "M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 9h8v6H8z",
    "panel-left": "M3 4h18v16H3z M9 4v16",
    "panel-right": "M3 4h18v16H3z M15 4v16",
    analysis: "M4 20V10 M10 20V4 M16 20v-7 M3 20h18",
    sim: "M4 20h16 M7 20V9l5-5 5 5v11 M9 13l6 4",
    rules: "M5 4h11l3 3v13H5z M8 10h8 M8 14h8 M8 18h5",
    // план
    grid: "M3 3h18v18H3z M9 3v18 M15 3v18 M3 9h18 M3 15h18",
    "wall-line": "M4 18L18 4 M7 21L21 7 M4 18l3 3 M18 4l3 3",
    rect: "M5 6h14v12H5z M5 6h.01 M19 18h.01",
    dimension: "M4 7v10 M20 7v10 M4 12h16 M7 9l-3 3 3 3 M17 9l3 3-3 3",
    // машиностроение: детали
    bushing: "M12 4a8 3 0 1 0 0 .01 M4 4v14a8 3 0 0 0 16 0V4 M12 3a3 1.1 0 1 0 0 2.2 3 1.1 0 0 0 0-2.2z",
    shaft: "M2 10h5v4H2z M7 8h10v8H7z M17 10h5v4h-5z M10 8v8 M14 8v8",
    flange: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 5h.01 M12 19h.01 M5 12h.01 M19 12h.01",
    part: "M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10",
    sketch: "M4 20l4-1 11-11-3-3L5 16z M14 7l3 3",
    import: "M12 15V3 M7 8l5-5 5 5 M4 19h16",
  };

  function svg(name) {
    const d = P[name] || P.cube;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true" focusable="false"><path d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /** Вставляет иконки во все элементы с data-icon. */
  function apply(root = document) {
    root.querySelectorAll("[data-icon]").forEach((el) => {
      if (el.querySelector("svg")) return;
      el.insertAdjacentHTML("afterbegin", svg(el.dataset.icon));
    });
  }

  BS.icons = { svg, apply, has: (name) => Object.prototype.hasOwnProperty.call(P, name), names: () => Object.keys(P) };
})(globalThis.BuildSense);
