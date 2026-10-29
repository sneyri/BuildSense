# Форматы данных BuildSense

Все форматы — JSON в кодировке UTF-8. Схемы версионируются полем `schemaVersion`.

## 1. Проект — `*.buildsense.json` (`format: "buildsense-project"`, `schemaVersion: 2`)

Единицы — **метры и градусы**, ось Z направлена вверх (как во FreeCAD).

```json
{
  "format": "buildsense-project",
  "schemaVersion": 2,
  "name": "Мой дом",
  "units": "m",
  "createdAt": "2026-10-27T12:00:00.000Z",
  "updatedAt": "2026-10-27T12:00:00.000Z",
  "settings": {
    "climateRegion": "2V",
    "housingFund": "private",
    "grid": 0.1,
    "snap": true,
    "site": { "x": -10, "y": -10, "length": 40, "width": 40, "maxHeight": 30 },
    "profile": { "minExteriorWall": 0.3, "minInteriorWall": 0.2, "minPartition": 0.08, "minColumn": 0.2, "minSlab": 0.12,
                 "maxBeamSpan": 6, "maxBeamSpanToDepth": 20, "maxSlabSpan": 7, "maxSlenderness": 25, "freeWallSlenderness": 12 },
    "loads": { "liveLoad": 2.0, "slabCapacity": 8.0, "lineLoad": 5, "deflectionLimit": 250 }
  },
  "house": { "length": 10, "width": 8, "wallHeight": 2.8, "wallThickness": 0.4, "slabThickness": 0.2,
             "foundationThickness": 0.4, "roofType": "gable", "roofSlope": 30, "roofOverhang": 0.4 },
  "levels": [ { "id": "L1", "name": "Этаж 1", "elevation": 0, "height": 2.8 } ],
  "elements": [ ... ],
  "customRules": [ ... ]
}
```

| Поле | Назначение |
|------|------------|
| `settings.climateRegion` | климатический подрайон по СП 131.13330: `1A`=IА, `1B`=IБ, `1V`=IВ, `1G`=IГ, `1D`=IД, `2A`…`2G`, `3A`…`3V`, `4A`…`4G` |
| `settings.housingFund` | `private` или `public` (государственный/муниципальный) — влияет на применимость правил п. 6.1 |
| `settings.site` | границы участка: начало (x, y), размеры, предельная высота |
| `settings.profile` | **учебный профиль** — пользовательские ограничения для конструктивных проверок (не нормы) |
| `settings.loads` | пользовательские нагрузки для симуляции и расчётов: кПа, кН/м; `deflectionLimit` — n в пределе прогиба L/n |
| `house` | параметры для мастера (габариты, толщины, крыша) |
| `levels[]` | этажи: `elevation` — отметка, с которой начинаются стены этажа; `height` — высота стен этажа |
| `customRules[]` | пользовательские правила проекта (формат как у правил, см. раздел 3) |

### Элемент

```json
{
  "id": "wall-1",
  "type": "wall",
  "name": "Стена южная",
  "category": "exterior",
  "material": "brick",
  "levelId": "L1",
  "position": { "x": 0, "y": 0, "z": 0 },
  "rotation": 0,
  "size": { "length": 10, "thickness": 0.4, "height": 2.8 },
  "params": {}
}
```

| Поле | Описание |
|------|----------|
| `id` | уникальный идентификатор `<тип>-<номер>` |
| `type` | тип из реестра `js/objects/types.js` (35 типов) |
| `category` | подтип, если у типа есть категории (стена: `exterior`, `interior`, `partition`; перекрытие: `ground`, `floor`, `attic`; дверь: `entrance`, `interior`) |
| `material` | ключ из `js/materials/materials.js` |
| `levelId` | этаж |
| `position`, `rotation` | точка привязки и поворот вокруг Z, градусы |
| `size` | размеры (по форме, см. таблицу) |
| `params` | параметры формы и связи (`roofType`, `slope`, `steps`, `roomType`, `hostWallId` у перемычки…) |
| `hostId` | только у окон и дверей: стена-основа |
| `shell` | необязательно: элемент стартового дома (мастер может перестроить) |

**Точка привязки и размеры по форме (`shape` в реестре):**

| Форма | Типы | `position` | `size` |
|-------|------|-----------|--------|
| `box` | плиты, ленточный фундамент, опоры, колонна, балка, перемычка, площадка, терраса, дымоход, декор | угол бруса (u=0, v=0, низ) | `length` (вдоль оси u), `width` (v), `height` |
| `wall` | стена | угол стены на наружной грани | `length`, `thickness`, `height` |
| `cylinder` | круглая опора, свая, круглая колонна | центр основания | `diameter`, `height` |
| `opening` | окно, дверь | `offset` — от начала стены, `elevation` — от низа стены | `width`, `height` |
| `roof` | крыша | угол с учётом свеса (низ) | `length`, `width`; `params.roofType`: `flat`/`shed`/`gable`/`hip`, `slope`, `thickness` |
| `stairs` | лестница | угол | `length` (марш), `width`, `height` (подъём); `params.steps` |
| `truss` | ферма | угол | `length` (пролёт), `width` (сечение), `height`; `params.panels` |
| `railing`, `balcony`, `zone`, `fixture` | перила, балкон, комната, сантехника, светильник, мебель | угол | `length`, `width`, `height` |
| `pipe` | труба | начало оси (горизонтальная) или центр основания (`params.vertical`) | `length`, `diameter` |

Локальные оси: u — вдоль длины, v — поперёк (для стены — по толщине внутрь дома), w — вверх.
Мировая точка: `x = position.x + u·cos(rot) − v·sin(rot)`, `y = position.y + u·sin(rot) + v·cos(rot)`, `z = position.z + w`.

**Загрузка.** Неизвестные типы пропускаются с предупреждением; нечисловые размеры — ошибка загрузки;
нулевые/отрицательные размеры **не исправляются молча**: их показывает проверка `GEO-SIZE`.
Проекты прежнего формата `freecad-checker-project` (версия 1) автоматически преобразуются.

## 2. Экспорт для FreeCAD — `*.freecad.json` (`format: "buildsense-freecad-export"`, `schemaVersion: 2`)

Все длины — **в миллиметрах**, координаты мировые.

```json
{
  "format": "buildsense-freecad-export",
  "schemaVersion": 2,
  "units": "mm",
  "generator": "BuildSense 1.0.0",
  "project": { "name": "…", "climateRegion": "2V", "housingFund": "private" },
  "levels": [ { "id": "L1", "name": "Этаж 1", "elevation": 0, "height": 2800 } ],
  "elements": [
    {
      "id": "wall-1", "type": "wall", "typeLabel": "Стена", "shape": "wall", "ifcType": "Wall",
      "name": "Стена южная", "category": "exterior", "levelId": "L1",
      "material": "brick", "materialLabel": "Кирпич", "color": "#b4643c", "density": 1800,
      "params": {},
      "relations": { "hostId": null, "hosted": ["door-1", "window-1"], "supports": ["slab_foundation-1"] },
      "placement": { "x": 0, "y": 0, "z": 0, "rotationZ": 0 },
      "size": { "length": 10000, "thickness": 400, "height": 2800 }
    }
  ]
}
```

- `relations.supports` — на чём элемент стоит (граф передачи нагрузки), `hosted` — проёмы стены, `hostId` — стена проёма или перемычки.
- У проёмов дополнительно: `hostId`, `position` (`offset`, `elevation`, мм), `hostThickness`, `placement` (угол проёма на наружной грани),
  `void` — вырез в стене (выходит за грани на 50 мм), `panel` — условное заполнение.
- У крыши `size.rise` — высота подъёма.
- Элементы с некорректными размерами не экспортируются и перечисляются в предупреждениях.

## 3. Правила — `data/rules/*.json`

`data/rules/index.json` перечисляет файлы. Каждый файл: `{ "document": {...}, "rules": [ ... ] }`.

```json
{
  "id": "SP55-6.2-HEIGHT-OTHER",
  "document": { "id": "СП 55.13330.2016", "title": "Дома жилые одноквартирные…" },
  "clause": "6.2",
  "title": "Высота комнат и кухни — остальные климатические районы",
  "requirement": "Текст требования",
  "parameter": "room.clearHeight",
  "operator": ">=",
  "value": 2.5,
  "unit": "m",
  "applicability": {
    "description": "Все климатические подрайоны, кроме IА, IБ, IГ, IД",
    "elementType": null,
    "conditions": [ { "parameter": "project.climateRegion", "operator": "not_in", "value": ["1A", "1B", "1G", "1D"] } ]
  },
  "modelAssumptions": "Как модель вычисляет параметр",
  "source": { "title": "Изменение № 2 к СП 55.13330.2016, п. 6.2", "url": "https://…", "accessed": "2026-10-26" },
  "verification": { "status": "verified", "checkedOn": "2026-10-26", "note": "…" }
}
```

| Поле | Значения |
|------|----------|
| `operator` | `>=`, `>`, `<=`, `<`, `==`, `!=`, `between` (`value: [min, max]`), `in`, `not_in` (`value` — список) |
| `unit` | `m`, `cm`, `mm`, `m2`, `deg`, `ratio`, `%`, `count` (переводятся автоматически) |
| `applicability.elementType` | если задан — правило проверяется для каждого элемента этого типа |
| `verification.status` | `verified` — сверено с текстом документа (PASS/FAIL); `user` — учебное ограничение (PASS/FAIL с пометкой); `unverified`, `demo` — всегда NOT VERIFIED |

Доступные параметры и их единицы — `PARAMETERS` в `js/validation/metrics.js` (и в выпадающем списке вкладки «Правила»).

**Встроенная копия.** Чтобы правила работали при открытии `index.html` без сервера, они встроены в
`js/rules/builtinRules.js`. После правки JSON выполните `node tools/build-rules.js` (тест следит за синхронностью).
Пользовательские правила можно добавить без программирования: вкладка «Правила» → форма или «Импорт правил (JSON)».
