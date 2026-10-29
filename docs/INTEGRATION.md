# Интеграционный контракт: два режима BuildSense

Приложение — обычные скрипты в пространстве имён `BuildSense` (см. `js/core/namespace.js`), работает по `file://`
без сборки. Three.js r147 — `vendor/three`. Зависимости не добавляются.

## Режимы

`<body data-mode="arch">` или `data-mode="mech"`. Переключение — `js/ui/shell.js` (`BS.shell.setMode(mode)`),
событие `BS.events.emit("mode", mode)`. После показа скрытой области shell вызывает `BS.events.emit("layout")` —
модули вызывают свои `resize()`.

## DOM-контракт (index.html)

Архитектура (существующие id сохраняются, их использует `js/app.js`): `#viewport`, `#palette`, `#levels`, `#tree`,
`#visibility`, `#props`, `#problems`, `#problems-count`, `#sim`, `#rules`, `#settings`, `#tool-hint`, `#sim-banner`,
`#wizard`, `#view-error`, `#tools`, `#grid-step`, `#project-name`, `#file-input`, `#rules-input`, `#new-menu`,
`#status-text`, `#status-info`, атрибуты `data-action`, `data-view`, `data-toggle`, `data-tab`, `data-pane`, `data-new`.

Новое для архитектуры:
- `#plan-view` — контейнер 2D-плана (рядом с `#viewport` внутри `.workarea`);
- `#plan-tools` — пустой контейнер панели команд плана (заполняет `js/plan/planEditor.js`);
- кнопки `[data-archview="plan|3d|split"]` — переключение вида; shell только показывает/скрывает контейнеры,
  пишет `body.dataset.archview` и шлёт `BS.events.emit("archview", v)` + `"layout"`.

Машиностроение (`#mech-root`, скрыт в режиме arch): `#mech-commands`, `#mech-tree`, `#mech-viewport`, `#mech-props`.
Заполняет `js/mech/mechApp.js`.

Строка состояния общая: `BS.events.emit("status", { text, kind })`, kind: `null | "error" | "warn" | "ok"`.

## API модулей

- `new BS.PlanEditor(container, toolsContainer, api)` — `api = { getProject, getLevelId, getSelected, edit(label, fn),
  select(ids, additive), setStatus(text, kind) }`; методы `render()`, `resize()`, `destroy()`.
- `BS.mechApp.mount({ viewport, tree, props, commands })`, `BS.mechApp.resize()`, `BS.mechApp.isMounted()`.

## Скрипты (порядок в index.html)

После `js/editor/history.js` и `examples/examples.js`: `js/mech/mechModel.js`, `js/mech/mechAssembly.js`, `js/mech/mechGeometry.js`,
`js/mech/mechIO.js`. После `js/scene/dimensions.js`: `js/plan/planEditor.js`. После `js/ui/wizard.js`:
`js/mech/mechApp.js`, `js/ui/shell.js`, затем `js/app.js`. Стили: `css/app.css`, `css/plan.css`, `css/mech.css`.

## CSS

Токены объявлены в `css/app.css` и не переименовываются: `--bg --panel --panel-2 --panel-3 --line --text --muted
--accent --accent-soft --err --err-bg --warn --warn-bg --ok --ok-bg --info --info-bg --viewport --radius --font --mono`.
`plan.css` и `mech.css` используют только токены; базовые кнопки, поля и `.field` стилизует `app.css`.

## Владение файлами

| Агент | Файлы |
|---|---|
| Архитектура | `js/objects/*`, `js/scene/*`, `js/materials/*`, `js/validation/*`, `js/rules/*`, `js/editor/*`, `js/io/*`, `js/plan/*`, `js/app.js`, `js/ui/properties.js`, `js/ui/palette.js`, `js/ui/wizard.js`, `freecad/import_house.FCMacro`, `examples/*` (кроме `examples/mech`), `tools/*.js`, `tests/*` (кроме `tests/mech*`), `css/plan.css`, `docs/JSON_FORMAT.md`, `docs/CHECKS.md` |
| Машиностроение | `js/mech/*`, `css/mech.css`, `freecad/import_parts.FCMacro`, `tools/blender/*`, `tests/mech*`, `examples/mech/*`, `docs/MECH.md` |
| Интерфейс | `index.html`, `css/app.css`, `js/ui/shell.js`, `js/ui/icons.js`, `js/ui/dom.js`, `js/ui/tree.js`, `js/ui/problems.js`, `js/ui/simulationPanel.js`, `js/ui/rulesPanel.js`, `js/ui/settingsPanel.js`, `README.md`, `TUTORIAL.md` |

Чужой файл не правится; нужное изменение — в отчёте координатору.
