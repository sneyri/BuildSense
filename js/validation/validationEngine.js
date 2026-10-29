// Движок автоматических проверок. Запускается после каждого изменения модели.
//
// Категории:
//   geometry  — геометрические ошибки (размеры, координаты, пересечения, разрывы, проёмы, лестницы, крыша);
//   structure — предварительные конструктивные проверки. Это эвристики: результат формулируется как
//               «потенциальная проблема» / «требуется инженерная проверка», а не как доказанное нарушение;
//   norms     — нормативные и пользовательские правила из реестра (см. rules/).
// Уровни: error (красный), warning (оранжевый), info (синий), pass (зелёный).
(function (BS) {
  "use strict";
  const G = BS.geometry;
  const S = BS.shapes;
  const U = BS.util;
  const fmt = U.fmt;

  const CATEGORIES = { geometry: "Геометрия", structure: "Конструкция", norms: "Нормы и правила" };
  const SEVERITY = { error: "Ошибка", warning: "Предупреждение", info: "Информация", pass: "Пройдено" };

  const isOpening = (el) => (BS.types.get(el.type) || {}).shape === "opening";
  const typeOf = (el) => BS.types.get(el.type) || {};

  // ---------------------------------------------------------------- проверки

  const CHECKS = [
    {
      id: "GEO-SIZE", category: "geometry", title: "Размеры элементов", pass: "Все размеры положительные",
      explanation: "Размер элемента должен быть положительным числом. Проверьте значения в панели свойств или в JSON-файле.",
      run(ctx, add) {
        for (const el of ctx.els) {
          for (const [k, v] of Object.entries(el.size || {})) {
            if (!Number.isFinite(v) || v <= 0) {
              add({ severity: "error", title: `${el.name}: некорректный размер «${k}» = ${v}`, elementIds: [el.id],
                description: "Нулевой, отрицательный или нечисловой размер — элемент не может быть построен." });
            }
          }
        }
      },
    },
    {
      id: "GEO-COORD", category: "geometry", title: "Координаты", pass: "Координаты корректны",
      explanation: "Координаты должны быть числами в разумных пределах (не дальше 1 км от начала координат).",
      run(ctx, add) {
        for (const el of ctx.els) {
          for (const [k, v] of Object.entries(el.position || {})) {
            if (!Number.isFinite(v) || Math.abs(v) > 1000) {
              add({ severity: "error", title: `${el.name}: некорректная координата ${k} = ${v}`, elementIds: [el.id],
                description: "Координата не число или слишком далеко от участка." });
            }
          }
        }
      },
    },
    {
      id: "GEO-SITE", category: "geometry", title: "Границы участка", pass: "Все элементы в пределах участка",
      explanation: "Участок задан в настройках проекта (начало, длина, ширина, предельная высота). Перенесите элемент внутрь или измените границы.",
      run(ctx, add) {
        const s = ctx.project.settings.site;
        if (!s) return;
        for (const el of ctx.solid) {
          const b = S.bounds(el, ctx.project);
          if (!b) continue;
          const out = b.min.x < s.x - 0.01 || b.min.y < s.y - 0.01 || b.max.x > s.x + s.length + 0.01 || b.max.y > s.y + s.width + 0.01;
          if (out) add({ severity: "warning", title: `${el.name}: за границей участка`, elementIds: [el.id], description: "Элемент выходит за допустимую область проекта." });
          if (b.max.z > s.maxHeight + 0.01) add({ severity: "warning", title: `${el.name}: выше ${fmt(s.maxHeight)} м`, elementIds: [el.id], description: "Элемент выше предельной высоты, заданной для участка." });
        }
      },
    },
    {
      id: "GEO-OVERLAP", category: "geometry", title: "Пересечения объектов", pass: "Недопустимых пересечений нет",
      explanation: "Допустимые пересечения не считаются ошибкой: стены на фундаменте, проёмы в стенах, перемычки и колонны в стенах, концы балок в опорах, плиты, заходящие в стены, лестница сквозь перекрытие. Остальные пересечения стоит устранить.",
      run(ctx, add) {
        const list = ctx.solid;
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            if (overlapAllowed(a, b)) continue;
            const zOverlap = Math.min(S.top(a, ctx.project), S.top(b, ctx.project)) - Math.max(S.bottom(a, ctx.project), S.bottom(b, ctx.project));
            if (zOverlap <= 0.01) continue;
            const area = G.overlapArea(ctx.fp(a), ctx.fp(b));
            const vol = area * zOverlap;
            if (vol > 0.003) {
              add({ severity: "warning", title: `${a.name} пересекается с «${b.name}»`, elementIds: [a.id, b.id],
                description: `Объём пересечения ≈ ${fmt(vol, 3)} м³. Сдвиньте элемент так, чтобы он только примыкал.` });
            }
          }
        }
      },
    },
    {
      id: "GEO-OPENINGS", category: "geometry", title: "Проёмы в стенах", pass: "Все проёмы внутри своих стен",
      explanation: "Окно или дверь должны целиком помещаться в своей стене и не накладываться друг на друга.",
      run(ctx, add) {
        for (const o of ctx.els.filter(isOpening)) {
          const h = ctx.byId.get(o.hostId);
          if (!h || h.type !== "wall") {
            add({ severity: "error", title: `${o.name}: стена-основа «${o.hostId}» не найдена`, elementIds: [o.id], description: "Проём не привязан к стене." });
            continue;
          }
          const p = o.position, s = o.size;
          if (p.offset < -1e-6 || p.offset + s.width > h.size.length + 1e-6 || p.elevation < -1e-6 || p.elevation + s.height > h.size.height + 1e-6) {
            add({ severity: "error", title: `${o.name}: выходит за границы стены «${h.name}»`, elementIds: [o.id, h.id], description: "Проём больше стены или сдвинут за её край." });
          }
        }
        for (const w of ctx.solid.filter((e) => e.type === "wall")) {
          const ops = ctx.els.filter((e) => e.hostId === w.id);
          for (let i = 0; i < ops.length; i++) {
            for (let j = i + 1; j < ops.length; j++) {
              const a = ops[i], b = ops[j];
              const ou = a.position.offset < b.position.offset + b.size.width - 1e-6 && b.position.offset < a.position.offset + a.size.width - 1e-6;
              const ow = a.position.elevation < b.position.elevation + b.size.height - 1e-6 && b.position.elevation < a.position.elevation + a.size.height - 1e-6;
              if (ou && ow) add({ severity: "error", title: `${a.name} и ${b.name} накладываются`, elementIds: [a.id, b.id], description: `Проёмы пересекаются в стене «${w.name}».` });
            }
          }
        }
      },
    },
    {
      id: "GEO-CONNECT", category: "geometry", title: "Стыковка с опорами и стенами", pass: "Элементы стыкуются без зазоров",
      explanation: "Низ стены или колонны должен совпадать с верхом опоры, а торцы наружных стен — примыкать к соседним стенам. Кнопка «Исправить» опускает элемент на опору.",
      run(ctx, add) {
        for (const el of ctx.gravity.filter((e) => e.type !== "roof")) {
          const info = ctx.support(el);
          if (info.share === 0 && info.gap !== null && info.gap > BS.support.LEVEL_TOL) {
            add({ severity: "error", title: `${el.name}: зазор ${fmt(info.gap)} м до опоры`, elementIds: [el.id],
              description: "Элемент висит над основанием — нагрузка не передаётся.",
              fix: { label: "Опустить на опору", action: { type: "set-z", elementId: el.id, z: info.below } } });
          }
        }
        const walls = ctx.solid.filter((e) => e.type === "wall");
        for (const w of walls.filter((e) => e.category === "exterior")) {
          const links = walls.filter((o) => o.id !== w.id && o.category === "exterior" && sameStorey(ctx, w, o) &&
            G.polygonDistance(ctx.fp(w), ctx.fp(o)) <= 0.02);
          [0, w.size.length].forEach((u, i) => {
            const seg = [G.localToWorld(w, u, 0, 0), G.localToWorld(w, u, w.size.thickness, 0)].map((p) => ({ x: p.x, y: p.y }));
            if (!links.some((o) => G.polygonDistance(seg, ctx.fp(o)) <= 0.02)) {
              add({ severity: "warning", title: `${w.name}: ${i ? "конец" : "начало"} стены ни к чему не примыкает`, elementIds: [w.id],
                description: "Контур наружных стен не замкнут — разрыв в углу дома." });
            }
          });
        }
        // Зазор между верхом стен этажа и перекрытием над ним
        for (const slab of ctx.els.filter((e) => e.type === "slab" && e.category !== "ground")) {
          const z = S.bottom(slab, ctx.project);
          const under = walls.filter((w) => w.category !== "partition" && G.overlapArea(grow(ctx.fp(slab), 0.03), ctx.fp(w)) > 0.0005 && S.top(w, ctx.project) < z - 0.02 && S.top(w, ctx.project) > z - 0.6);
          for (const w of under) {
            add({ severity: "warning", title: `${w.name}: зазор ${fmt(z - S.top(w, ctx.project))} м до перекрытия`, elementIds: [w.id, slab.id],
              description: "Верх стены не доходит до перекрытия над ней." });
          }
        }
      },
    },
    {
      id: "GEO-WALLS", category: "geometry", title: "Стыки стен", pass: "Стены стыкуются без щелей, выступов и взаимных пересечений",
      explanation: "В углу одна стена доходит до угла, вторая упирается в её грань (стык допустим, в том числе с небольшим нахлёстом в непрямом углу). Ошибка — две стены друг в друге или пересекающие друг друга. Щель в углу или стена, выступающая за грань соседней, — признак неточного построения: перестройте стены по контуру плана.",
      run(ctx, add) {
        const walls = ctx.solid.filter((e) => e.type === "wall");
        const C = BS.contour;
        for (let i = 0; i < walls.length; i++) {
          for (let j = i + 1; j < walls.length; j++) {
            const a = walls[i], b = walls[j];
            if (!sameStorey(ctx, a, b)) continue;
            const fa = ctx.fp(a), fb = ctx.fp(b);
            const corner = C ? C.findCorner(a, b) : null;
            if (corner) {
              const res = cornerCheck(ctx, a, b, corner);
              if (res.gap > 0.002) {
                add({ severity: "warning", title: `Щель в углу между «${a.name}» и «${b.name}»`, elementIds: [a.id, b.id],
                  description: `Угол стен не заполнен: ≈ ${fmt(res.gap, 3)} м² на плане. Постройте стены по контуру плана или удлините одну из стен до угла.` });
              }
              for (const [w, d] of res.overhang) {
                add({ severity: "warning", title: `${w.name}: выступает за угол на ${fmt(d)} м`, elementIds: [a.id, b.id],
                  description: "Торец стены выходит за наружную грань соседней стены. Укоротите стену до угла." });
              }
              continue;
            }
            const area = G.overlapArea(fa, fb);
            if (area < 0.0005) continue;
            if (tJoint(a, b, ctx) || tJoint(b, a, ctx)) continue;
            add({ severity: "error", title: `Стены «${a.name}» и «${b.name}» входят друг в друга`, elementIds: [a.id, b.id],
              description: `Площадь наложения на плане ≈ ${fmt(area, 3)} м². Это не угловой и не Т-образный стык: удалите лишнюю стену или сдвиньте её.` });
          }
        }
      },
    },
    {
      id: "GEO-LEVELS", category: "geometry", title: "Совпадение отметок", pass: "Низ стен совпадает с верхом опор, перекрытия — с верхом стен",
      explanation: "Низ стены должен совпадать с верхом фундамента или перекрытия под ней (а не уходить внутрь него), стена не должна выходить за край опоры, перекрытие над этажом должно лежать на верхе стен и совпадать с отметкой пола следующего этажа.",
      run(ctx, add) {
        const project = ctx.project;
        const carriers = ctx.solid.filter((e) => BS.types.isFoundation(e) || e.type === "slab");
        for (const w of ctx.solid.filter((e) => e.type === "wall")) {
          const z = S.bottom(w, project);
          const fw = ctx.fp(w);
          const areaW = Math.abs(G.polygonArea(fw));
          // Низ стены внутри фундамента или плиты
          for (const c of carriers) {
            const top = S.top(c, project), bot = S.bottom(c, project);
            if (!(top > z + BS.support.LEVEL_TOL && bot < z - BS.support.LEVEL_TOL)) continue;
            if (G.overlapArea(fw, ctx.fp(c)) < 0.3 * areaW) continue;
            add({ severity: "warning", title: `${w.name}: низ на ${fmt(top - z)} м ниже верха «${c.name}»`, elementIds: [w.id, c.id],
              description: `Низ стены ${fmt(z)} м, верх опоры ${fmt(top)} м. Стена должна стоять на верхе опоры.`,
              fix: { label: "Поставить на верх опоры", action: { type: "set-z", elementId: w.id, z: top } } });
            break;
          }
          // Стена выходит за край опоры, на которой стоит
          // Опоры — все фундаменты и плиты с верхом на отметке низа стены (в углах стена лежит и на соседней ленте)
          const sup = carriers.filter((x) => Math.abs(S.top(x, project) - z) <= BS.support.LEVEL_TOL && G.overlapArea(fw, ctx.fp(x)) > 1e-6);
          if (!sup.length) continue;
          const covered = coveredArea(fw, sup.map((x) => ctx.fp(x)));
          const out = areaW - covered;
          if (out > 0.01 && out > 0.02 * areaW) {
            add({ severity: "warning", title: `${w.name}: выходит за край «${sup[0].name}»`, elementIds: [w.id, ...sup.map((x) => x.id)],
              description: `Часть стены (≈ ${fmt(out, 2)} м² на плане, ${Math.round((out / areaW) * 100)} %) не опирается на ${BS.types.isFoundation(sup[0]) ? "фундамент" : "перекрытие"}. Сдвиньте стену внутрь или расширьте опору.` });
          }
        }
        // Перекрытие над этажом: на верхе стен и на отметке следующего этажа
        for (const slab of ctx.solid.filter((e) => e.type === "slab" && e.category !== "ground")) {
          const zb = S.bottom(slab, project);
          const sunk = ctx.solid.filter((w) => w.type === "wall" && w.category !== "partition" && S.top(w, project) > zb + 0.02 &&
            S.bottom(w, project) < zb - 0.02 && G.overlapArea(ctx.fp(slab), ctx.fp(w)) > 0.3 * Math.abs(G.polygonArea(ctx.fp(w))));
          for (const w of sunk) {
            add({ severity: "warning", title: `${slab.name}: ниже верха стены «${w.name}» на ${fmt(S.top(w, project) - zb)} м`, elementIds: [slab.id, w.id],
              description: `Низ перекрытия ${fmt(zb)} м, верх стены ${fmt(S.top(w, project))} м. Перекрытие должно лежать на верхе стен этажа.` });
          }
          const lv = BS.project.level(project, slab.levelId);
          const top = S.top(slab, project);
          if (lv && lv.elevation > 0.5 && Math.abs(top - lv.elevation) > 0.05 && Math.abs(lv.elevation - zb) > 0.05) {
            add({ severity: "warning", title: `${slab.name}: верх ${fmt(top)} м, а пол «${lv.name}» — ${fmt(lv.elevation)} м`, elementIds: [slab.id],
              description: "Отметка верха перекрытия не совпадает с отметкой этажа, к которому оно относится. Измените отметку этажа в настройках или толщину перекрытия." });
          }
        }
      },
    },
    {
      id: "GEO-STAIRS", category: "geometry", title: "Лестницы", pass: "Лестницы доходят до следующего этажа",
      explanation: "Верх лестницы должен совпадать с полом следующего этажа (его отметкой).",
      run(ctx, add) {
        for (const st of ctx.els.filter((e) => e.type === "stairs")) {
          const lv = BS.project.level(ctx.project, st.levelId);
          const above = ctx.project.levels.filter((l) => l.elevation > lv.elevation + 0.01).sort((a, b) => a.elevation - b.elevation)[0];
          const top = S.top(st, ctx.project);
          if (!above) {
            add({ severity: "info", title: `${st.name}: над этажом нет следующего этажа`, elementIds: [st.id], description: "Лестница ведёт на чердак или крышу — проверьте, так ли задумано." });
          } else if (Math.abs(top - above.elevation) > 0.05) {
            add({ severity: "warning", title: `${st.name}: не доходит до ${above.name.toLowerCase()}`, elementIds: [st.id],
              description: `Верх лестницы ${fmt(top)} м, пол следующего этажа ${fmt(above.elevation)} м (разница ${fmt(above.elevation - top)} м).` });
          }
        }
      },
    },
    {
      id: "GEO-ROOF", category: "geometry", title: "Покрытие крышей", pass: "Крыша покрывает здание",
      explanation: "Крыша должна перекрывать наружные стены верхнего этажа. Увеличьте её размеры или свесы.",
      run(ctx, add) {
        const top = BS.project.topLevel(ctx.project);
        const walls = ctx.solid.filter((e) => e.type === "wall" && e.category === "exterior" && e.levelId === top.id);
        const roofs = ctx.solid.filter((e) => e.type === "roof");
        if (walls.length && !roofs.length) {
          add({ severity: "info", title: "В проекте нет крыши", elementIds: [], description: "Добавьте крышу на шаге «Крыша» или инструментом «Крыша»." });
          return;
        }
        if (!roofs.length) return;
        const uncovered = walls.filter((w) => ctx.fp(w).some((c) => !roofs.some((r) => G.pointInConvex(c, ctx.fp(r), 0.01))));
        if (uncovered.length) {
          add({ severity: "warning", title: "Крыша не покрывает все наружные стены", elementIds: [...uncovered.map((w) => w.id), ...roofs.map((r) => r.id)],
            description: `За пределами крыши: ${uncovered.map((w) => w.name).join(", ")}.` });
        }
      },
    },

    // ---------------------------------------------------------------- конструкция
    {
      id: "STR-FOUNDATION", category: "structure", title: "Наличие фундамента", pass: "Фундамент есть",
      explanation: "Стены передают нагрузку на фундамент. Без фундамента модель не имеет опоры на грунт.",
      run(ctx, add) {
        if (ctx.els.some((e) => e.type === "wall") && !ctx.els.some((e) => BS.types.isFoundation(e))) {
          add({ severity: "error", title: "В проекте нет фундамента", elementIds: [],
            description: "Потенциальная проблема: стенам не на что передать нагрузку.",
            fix: { label: "Добавить плиту под стенами", action: { type: "add-foundation" } } });
        }
      },
    },
    {
      id: "STR-SUPPORT", category: "structure", title: "Опоры под элементами", pass: "Все элементы на опорах",
      explanation: "Каждый опирающийся элемент должен стоять на фундаменте, перекрытии, стене или балке. Частичное опирание означает консольный свес.",
      run(ctx, add) {
        for (const el of ctx.gravity.filter((e) => !["roof", "beam", "truss"].includes(e.type))) {
          const info = ctx.support(el);
          if (info.share === 0 && (info.gap === null || info.gap <= BS.support.LEVEL_TOL)) {
            add({ severity: BS.types.isBearing(el) ? "error" : "warning", title: `${el.name}: нет опоры`, elementIds: [el.id],
              description: "Потенциальная проблема: под элементом нет ни фундамента, ни перекрытия, ни стены." });
          } else if (info.share > 0 && info.share < 0.95 && !info.areal && el.type !== "beam" && el.type !== "truss") {
            add({ severity: "warning", title: `${el.name}: опирается частично (~${Math.round(info.share * 100)} %)`, elementIds: [el.id],
              description: "Часть элемента свисает за край опоры. Требуется инженерная проверка консоли." });
          }
        }
      },
    },
    {
      id: "STR-BEAMS", category: "structure", title: "Балки и фермы", pass: "Балки опираются обоими концами в пределах пролёта",
      explanation: "Балка должна опираться обоими концами. Предельный пролёт и отношение пролёта к высоте сечения задаются в учебном профиле (настройки проекта).",
      run(ctx, add) {
        const pr = ctx.project.settings.profile;
        for (const b of ctx.els.filter((e) => e.type === "beam" || e.type === "truss")) {
          const info = ctx.support(b);
          if (!info.ends[0] || !info.ends[1]) {
            add({ severity: "error", title: `${b.name}: ${!info.ends[0] && !info.ends[1] ? "концы не опираются" : "один конец без опоры"}`, elementIds: [b.id],
              description: "Потенциальная проблема: консольная балка. Поставьте колонну или стену под конец." });
          }
          if (b.size.length > pr.maxBeamSpan) {
            add({ severity: "warning", title: `${b.name}: пролёт ${fmt(b.size.length)} м больше учебного предела ${fmt(pr.maxBeamSpan)} м`, elementIds: [b.id],
              description: "Требуется инженерная проверка: длинный пролёт. Добавьте промежуточную опору или проверьте расчётом." });
          }
          if (b.type === "beam" && b.size.length / b.size.height > pr.maxBeamSpanToDepth) {
            add({ severity: "warning", title: `${b.name}: пролёт/высота = ${fmt(b.size.length / b.size.height, 1)}`, elementIds: [b.id],
              description: `Учебный предел — ${pr.maxBeamSpanToDepth}. Сечение может быть недостаточным — проверьте в разделе «Расчёт».` });
          }
        }
      },
    },
    {
      id: "STR-PROFILE", category: "structure", title: "Учебный профиль сечений", pass: "Сечения соответствуют учебному профилю",
      explanation: "Минимальные размеры задаёт пользователь в учебном профиле. Это не нормы, а ориентиры для учебного проекта.",
      run(ctx, add) {
        const pr = ctx.project.settings.profile;
        const lim = { exterior: pr.minExteriorWall, interior: pr.minInteriorWall, partition: pr.minPartition };
        for (const el of ctx.els) {
          let actual = null, min = null, what = "";
          if (el.type === "wall") { actual = el.size.thickness; min = lim[el.category]; what = "толщина стены"; }
          if (el.type === "column") { actual = Math.min(el.size.length, el.size.width); min = pr.minColumn; what = "сечение колонны"; }
          if (el.type === "round_column") { actual = el.size.diameter; min = pr.minColumn; what = "диаметр колонны"; }
          if (el.type === "slab") { actual = el.size.height; min = pr.minSlab; what = "толщина перекрытия"; }
          if (min !== null && actual < min - 1e-9) {
            add({ severity: "warning", title: `${el.name}: ${what} ${fmt(actual)} м < ${fmt(min)} м`, elementIds: [el.id],
              description: "Несоответствие учебному профилю (пользовательское ограничение, не норма)." });
          }
        }
      },
    },
    {
      id: "STR-SLABS", category: "structure", title: "Опирание перекрытий", pass: "Перекрытия опираются на стены или балки",
      explanation: "Междуэтажное перекрытие должно лежать минимум на двух несущих элементах. Предельный пролёт задаётся в учебном профиле.",
      run(ctx, add) {
        const pr = ctx.project.settings.profile;
        for (const s of ctx.els.filter((e) => e.type === "slab" && e.category !== "ground")) {
          const info = ctx.support(s);
          const bearing = info.supports.filter((x) => BS.types.isBearing(x));
          if (bearing.length < 2 && !bearing.some((x) => BS.types.isFoundation(x))) {
            add({ severity: "error", title: `${s.name}: нет ожидаемой опоры`, elementIds: [s.id],
              description: `Потенциальная проблема: перекрытие опирается на ${bearing.length} несущих элемента (нужно не меньше двух).` });
          }
          const span = Math.min(s.size.length, s.size.width);
          if (span > pr.maxSlabSpan && bearing.length <= 4) {
            add({ severity: "warning", title: `${s.name}: пролёт ${fmt(span)} м больше учебного предела ${fmt(pr.maxSlabSpan)} м`, elementIds: [s.id],
              description: "Требуется инженерная проверка: добавьте промежуточную стену или балку." });
          }
        }
      },
    },
    {
      id: "STR-SLENDER", category: "structure", title: "Гибкость стен", pass: "Гибкость стен в пределах учебного профиля",
      explanation: "Гибкость — отношение высоты стены к толщине (h/t). Отдельно стоящая стена без связей с другими менее устойчива.",
      run(ctx, add) {
        const pr = ctx.project.settings.profile;
        const walls = ctx.solid.filter((e) => e.type === "wall");
        for (const w of walls) {
          const lam = w.size.height / w.size.thickness;
          const links = walls.filter((o) => o.id !== w.id && sameStorey(ctx, w, o) && G.polygonDistance(ctx.fp(w), ctx.fp(o)) <= 0.02);
          if (!links.length && lam > pr.freeWallSlenderness) {
            add({ severity: "warning", title: `${w.name}: отдельно стоящая стена, h/t = ${fmt(lam, 1)}`, elementIds: [w.id],
              description: "Потенциальная проблема устойчивости: стена не связана ни с одной другой. Примкните её к стене, увеличьте толщину или уберите." });
          } else if (lam > pr.maxSlenderness) {
            const t = Math.ceil((w.size.height / pr.maxSlenderness) * 100) / 100;
            add({ severity: "warning", title: `${w.name}: гибкость h/t = ${fmt(lam, 1)} > ${pr.maxSlenderness}`, elementIds: [w.id],
              description: "Стена тонкая для своей высоты (учебное ограничение).",
              fix: { label: `Толщина ${fmt(t)} м`, action: { type: "set-size", elementId: w.id, size: { thickness: t } } } });
          }
        }
      },
    },
    {
      id: "STR-LOADPATH", category: "structure", title: "Цепочка передачи нагрузки", pass: "Нагрузка от всех несущих элементов доходит до фундамента",
      explanation: "Нагрузка должна передаваться по несущим элементам вниз до фундамента. Опора на ненесущий элемент (перегородку, террасу, мебель) — разрыв цепочки.",
      run(ctx, add) {
        const onPath = ctx.loadPath();
        for (const el of ctx.gravity.filter((e) => BS.types.isBearing(e))) {
          const info = ctx.support(el);
          if (!info.supports.length || onPath.has(el.id)) continue;
          // Если опора сама несущая, но без пути к фундаменту, первопричина уже отмечена у неё
          if (info.supports.some((s) => BS.types.isBearing(s) && !BS.types.isFoundation(s))) continue;
          add({ severity: "warning", title: `${el.name}: разрыв цепочки передачи нагрузки`, elementIds: [el.id, ...info.supports.map((s) => s.id)],
            description: `Опирается на ${info.supports.map((s) => `«${s.name}»`).join(", ")}, но нагрузка дальше не доходит до фундамента. Требуется инженерная проверка.` });
        }
      },
    },
    {
      id: "STR-LEVELS", category: "structure", title: "Связь между этажами", pass: "Этажи связаны перекрытиями",
      explanation: "Этаж выше первого должен опираться на перекрытие, лежащее на стенах нижнего этажа.",
      run(ctx, add) {
        const levels = ctx.project.levels.slice().sort((a, b) => a.elevation - b.elevation);
        for (const lv of levels.slice(1)) {
          const has = ctx.els.some((e) => e.levelId === lv.id && e.type !== "room");
          if (!has) continue;
          const slab = ctx.els.find((e) => e.type === "slab" && Math.abs(S.top(e, ctx.project) - lv.elevation) <= 0.05);
          if (!slab) {
            add({ severity: "warning", title: `${lv.name}: нет перекрытия на отметке ${fmt(lv.elevation)} м`, elementIds: ctx.els.filter((e) => e.levelId === lv.id).map((e) => e.id).slice(0, 20),
              description: "Отсутствует связь между этажами: элементам этажа не на что опереться." });
          }
        }
      },
    },
    {
      id: "STR-ROOF", category: "structure", title: "Опирание крыши", pass: "Крыша лежит на стенах",
      explanation: "Низ крыши должен лежать на верхе наружных стен (или на балках/фермах).",
      run(ctx, add) {
        const top = BS.project.topLevel(ctx.project);
        const walls = ctx.solid.filter((e) => e.type === "wall" && e.category === "exterior" && e.levelId === top.id);
        if (!walls.length) return;
        const tops = walls.map((w) => S.top(w, ctx.project)).sort((a, b) => a - b);
        const wallTop = tops[Math.floor(tops.length / 2)]; // медиана: одна приподнятая стена не меняет ответ
        for (const r of ctx.els.filter((e) => e.type === "roof")) {
          if (ctx.support(r).supports.length) continue;
          add({ severity: "error", title: `${r.name}: не опирается на стены`, elementIds: [r.id],
            description: `Низ крыши ${fmt(r.position.z)} м, верх наружных стен ${fmt(wallTop)} м.`,
            fix: { label: "Положить крышу на стены", action: { type: "set-z", elementId: r.id, z: wallTop } } });
        }
      },
    },
    {
      id: "STR-ATTACHED", category: "structure", title: "Крепление навесных элементов", pass: "Навесные элементы прикреплены",
      explanation: "Балкон, карниз, светильник, розетка и выключатель должны примыкать к стене или перекрытию.",
      run(ctx, add) {
        for (const el of ctx.els.filter((e) => typeOf(e).support === "attached")) {
          if (!BS.support.attachedTo(ctx.project, el).length) {
            add({ severity: BS.types.isBearing(el) ? "error" : "warning", title: `${el.name}: ни к чему не прикреплён`, elementIds: [el.id],
              description: "Навесной элемент не касается стены или перекрытия." });
          }
        }
      },
    },
    {
      id: "STR-OPENINGS", category: "structure", title: "Простенки и перемычки", pass: "Простенки и перемычки в порядке",
      explanation: "Узкие простенки и большие проёмы ослабляют несущую стену; над проёмом в несущей стене нужна перемычка.",
      run(ctx, add) {
        for (const w of ctx.solid.filter((e) => e.type === "wall" && BS.types.isBearing(e))) {
          const ops = ctx.els.filter((o) => o.hostId === w.id).sort((a, b) => a.position.offset - b.position.offset);
          let used = 0;
          ops.forEach((o, i) => {
            used += o.size.width;
            const left = o.position.offset, right = w.size.length - o.position.offset - o.size.width;
            for (const [gap, where] of [[left, "в начале"], [right, "в конце"]]) {
              if (gap > 0.001 && gap < 0.25) {
                add({ severity: "warning", title: `${o.name}: узкий простенок ${fmt(gap)} м ${where} стены`, elementIds: [o.id, w.id],
                  description: "Узкий простенок у края несущей стены (ориентир — не менее 0,25 м)." });
              }
            }
            const next = ops[i + 1];
            if (next) {
              const between = next.position.offset - o.position.offset - o.size.width;
              if (between >= 0 && between < 0.25) {
                add({ severity: "warning", title: `${o.name} и ${next.name}: простенок ${fmt(between)} м`, elementIds: [o.id, next.id], description: "Очень узкий простенок между проёмами." });
              }
            }
            const top = w.position.z + o.position.elevation + o.size.height;
            const hasLintel = ctx.els.some((l) => l.type === "lintel" && l.params && l.params.hostWallId === w.id &&
              Math.abs(l.position.z - top) < 0.05);
            if (o.size.width >= 1.0 && !hasLintel) {
              add({ severity: "info", title: `${o.name}: нет перемычки над проёмом`, elementIds: [o.id],
                description: "Над проёмом в несущей стене обычно устраивают перемычку.",
                fix: { label: "Перемычки над проёмами стены", action: { type: "add-lintels", elementId: w.id } } });
            }
          });
          if (used / w.size.length > 0.6) {
            add({ severity: "warning", title: `${w.name}: проёмы занимают ${Math.round((used / w.size.length) * 100)} % длины`, elementIds: [w.id],
              description: "Несущая стена сильно ослаблена проёмами (учебный ориентир — не более 60 %)." });
          }
        }
      },
    },
  ];

  /** Площадь части многоугольника poly, покрытой хотя бы одним из covers (точно для двух слоёв). */
  function coveredArea(poly, covers) {
    let sum = 0;
    for (const c of covers) sum += G.overlapArea(poly, c);
    const parts = (q) => (G.isConvex(q) ? [q] : G.triangulate(q));
    for (let i = 0; i < covers.length; i++) {
      for (let j = i + 1; j < covers.length; j++) {
        for (const pa of parts(covers[i])) {
          for (const pb of parts(covers[j])) {
            const both = G.clipPolygon(pa, pb);
            if (both.length >= 3) sum -= G.overlapArea(poly, both);
          }
        }
      }
    }
    return Math.min(sum, Math.abs(G.polygonArea(poly)));
  }

  /** Угол двух стен: незаполненная часть угла и выступы торцов за грань соседа. */
  function cornerCheck(ctx, a, b, corner) {
    const faces = (w) => {
      const ax = G.axes(w);
      const p = w.position, t = w.size.thickness;
      return [0, t].map((v) => ({ p: { x: p.x + ax.vx * v, y: p.y + ax.vy * v }, d: { x: ax.ux, y: ax.uy } }));
    };
    const fa = faces(a), fb = faces(b);
    const X = (f, g) => G.lineIntersection(f.p, { x: f.p.x + f.d.x, y: f.p.y + f.d.y }, g.p, { x: g.p.x + g.d.x, y: g.p.y + g.d.y });
    const quad = [X(fa[0], fb[0]), X(fa[0], fb[1]), X(fa[1], fb[1]), X(fa[1], fb[0])];
    if (G.polygonArea(quad) < 0) quad.reverse();
    const pa = ctx.fp(a), pb = ctx.fp(b);
    const both = G.clipPolygon(pa, pb);
    const covered = G.overlapArea(quad, pa) + G.overlapArea(quad, pb) - (both.length >= 3 ? G.overlapArea(quad, both) : 0);
    const gap = Math.max(0, Math.abs(G.polygonArea(quad)) - covered);
    const overhang = [];
    for (const [w, end] of [[a, corner.endA], [b, corner.endB]]) {
      const us = quad.map((q) => G.worldToLocal(w, q.x, q.y).u);
      const d = end === "end" ? w.size.length - Math.max(...us) : Math.min(...us);
      if (d > 0.01) overhang.push([w, d]);
    }
    return { gap, overhang };
  }

  /** Т-стык: торец стены a упирается в стену b (заходит не глубже её толщины). */
  function tJoint(a, b, ctx) {
    const poly = G.clipPolygon(ctx.fp(a), ctx.fp(b));
    if (poly.length < 3) return true;
    const us = poly.map((p) => G.worldToLocal(a, p.x, p.y).u);
    const u0 = Math.min(...us), u1 = Math.max(...us);
    const atEnd = u0 <= 0.02 || u1 >= a.size.length - 0.02;
    const ra = (a.rotation || 0) * G.DEG, rb = (b.rotation || 0) * G.DEG;
    const cross = Math.abs(Math.sin(ra - rb));
    return atEnd && cross > 0.3 && u1 - u0 <= b.size.thickness / Math.max(cross, 0.3) + 0.02;
  }

  function sameStorey(ctx, a, b) {
    const z0 = Math.max(S.bottom(a, ctx.project), S.bottom(b, ctx.project));
    const z1 = Math.min(S.top(a, ctx.project), S.top(b, ctx.project));
    return z1 - z0 > 0.02;
  }

  function grow(poly, d) {
    if (!poly.length) return poly;
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    return poly.map((p) => {
      const len = Math.hypot(p.x - cx, p.y - cy) || 1;
      return { x: p.x + ((p.x - cx) / len) * d * Math.SQRT2, y: p.y + ((p.y - cy) / len) * d * Math.SQRT2 };
    });
  }

  function overlapAllowed(a, b) {
    const pair = (x, y) => (a.type === x && b.type === y) || (a.type === y && b.type === x);
    const isF = BS.types.isFoundation;
    if (isF(a) && isF(b)) return true;
    if (pair("wall", "wall")) return true; // стыки и наложения стен разбирает проверка GEO-WALLS
    if (pair("lintel", "wall") || pair("column", "wall") || pair("round_column", "wall")) return true;
    if (pair("slab", "wall") || pair("stairs", "slab") || pair("stairs", "landing") || pair("chimney", "roof") || pair("chimney", "slab")) return true;
    for (const beam of ["beam", "truss"]) {
      for (const other of ["wall", "column", "round_column", "beam", "truss", "roof"]) if (pair(beam, other)) return true;
    }
    if (pair("balcony", "wall") || pair("decor", "wall") || pair("railing", "balcony") || pair("railing", "stairs")) return true;
    return false;
  }

  /** Множество id несущих элементов, нагрузка от которых доходит до фундамента. */
  function computeLoadPath(ctx) {
    const on = new Set(ctx.els.filter((e) => BS.types.isFoundation(e)).map((e) => e.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const el of ctx.gravity) {
        if (on.has(el.id) || !BS.types.isBearing(el)) continue;
        const sup = ctx.support(el).supports;
        if (sup.some((s) => on.has(s.id))) {
          on.add(el.id);
          changed = true;
        }
      }
    }
    return on;
  }

  function makeContext(project) {
    const els = project.elements;
    const byId = new Map(els.map((e) => [e.id, e]));
    const fpCache = new Map();
    const supCache = new Map();
    const validSize = (e) => Object.values(e.size || {}).every((v) => Number.isFinite(v) && v > 0) &&
      Object.values(e.position || {}).every(Number.isFinite);
    const solid = els.filter((e) => validSize(e) && !isOpening(e) && !typeOf(e).nonSolid);
    const ctx = {
      project, els, byId, solid,
      gravity: solid.filter((e) => typeOf(e).support === "gravity"),
      fp(el) {
        if (!fpCache.has(el.id)) fpCache.set(el.id, S.footprint(el, project));
        return fpCache.get(el.id);
      },
      support(el) {
        if (!supCache.has(el.id)) supCache.set(el.id, BS.support.supportInfo(project, el));
        return supCache.get(el.id);
      },
      loadPath() {
        if (!ctx._path) ctx._path = computeLoadPath(ctx);
        return ctx._path;
      },
    };
    return ctx;
  }

  // ---------------------------------------------------------------- запуск

  /**
   * Полная проверка проекта.
   * @returns {{ issues: Array, summary: object, norms: object, ruleErrors: string[] }}
   * issue: { id, checkId, category, severity, title, description, explanation, elementIds, fix? }
   */
  function validate(project, options = {}) {
    const ctx = makeContext(project);
    const issues = [];
    for (const check of CHECKS) {
      const found = [];
      try {
        check.run(ctx, (it) => found.push(it));
      } catch (err) {
        found.push({ severity: "info", title: `Проверка «${check.title}» не выполнена: ${err.message}`, elementIds: [] });
      }
      found.forEach((it, i) => issues.push({ id: `${check.id}#${i}`, checkId: check.id, category: check.category, explanation: check.explanation, ...it }));
      if (!found.some((f) => f.severity !== "pass")) {
        issues.push({ id: `${check.id}#ok`, checkId: check.id, category: check.category, severity: "pass", title: check.pass, description: check.title, explanation: check.explanation, elementIds: [] });
      }
    }

    // Нормативные и пользовательские правила
    const { rules, errors: ruleErrors } = options.rules ? { rules: options.rules, errors: [] } : BS.ruleRegistry.all(project);
    const norms = BS.checker.checkModel(BS.metrics.collect(project), rules);
    norms.results.forEach((r, i) => {
      const official = r.rule.verification.status === "verified";
      const userRule = r.rule.verification.status === "user";
      const severity = r.status === "PASS" ? "pass" : r.status === "FAIL" ? (official ? "error" : "warning") : "info";
      const prefix = userRule ? "Учебное ограничение: " : "";
      issues.push({
        id: `NORM-${r.ruleId}#${i}`, checkId: `NORM-${r.ruleId}`, category: "norms", severity,
        title: `${prefix}${r.rule.title || r.rule.id}${r.elementName ? ` — ${r.elementName}` : ""}`,
        description: `${r.rule.document.id}${r.rule.clause && r.rule.clause !== "—" ? `, п. ${r.rule.clause}` : ""}. ${r.reason ? r.reason + "." : ""}`,
        explanation: r.rule.requirement,
        elementIds: r.elementId ? [r.elementId] : [],
        norm: r,
      });
    });

    const summary = { error: 0, warning: 0, info: 0, pass: 0 };
    for (const it of issues) summary[it.severity]++;
    return { issues, summary, norms, ruleErrors };
  }

  /** Самая серьёзная проблема по каждому элементу — для подсветки в 3D. */
  function severityByElement(issues) {
    const rank = { error: 2, warning: 1 };
    const map = new Map();
    for (const it of issues) {
      if (!rank[it.severity]) continue;
      for (const id of it.elementIds || []) {
        const prev = map.get(id);
        if (!prev || rank[it.severity] > rank[prev]) map.set(id, it.severity);
      }
    }
    return map;
  }

  /** Исправления из подсказок. Возвращает текст для строки состояния. */
  function applyFix(project, action) {
    const P = BS.project;
    if (action.type === "set-z") {
      const el = P.find(project, action.elementId);
      P.updateElement(project, el.id, { position: { z: U.round(action.z, 3) } });
      return `${el.name}: низ перенесён на отметку ${fmt(action.z)} м`;
    }
    if (action.type === "set-size") {
      P.updateElement(project, action.elementId, { size: action.size });
      return "Размер изменён";
    }
    if (action.type === "add-lintels") {
      const created = P.addLintels(project, action.elementId);
      return `Добавлено перемычек: ${created.length}`;
    }
    if (action.type === "add-foundation") {
      const walls = project.elements.filter((e) => e.type === "wall");
      const b = G.bbox2(walls.flatMap((w) => S.footprint(w, project)));
      const el = P.addRect(project, "slab_foundation", { x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY });
      el.name = "Фундаментная плита";
      return `Добавлена фундаментная плита ${fmt(b.maxX - b.minX)} × ${fmt(b.maxY - b.minY)} м`;
    }
    throw new Error(`Неизвестное исправление: ${action.type}`);
  }

  BS.validation = { CATEGORIES, SEVERITY, CHECKS, validate, severityByElement, applyFix, overlapAllowed };
})(globalThis.BuildSense);
