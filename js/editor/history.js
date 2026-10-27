// Отмена и повтор действий: снимки проекта (JSON) до и после каждого изменения.
// Простой и надёжный способ для моделей до нескольких сотен элементов.
(function (BS) {
  "use strict";

  function createHistory(limit = 100) {
    const undo = [];
    const redo = [];
    return {
      /** Запомнить состояние ДО изменения. */
      push(project, label) {
        undo.push({ label, json: JSON.stringify(project) });
        if (undo.length > limit) undo.shift();
        redo.length = 0;
      },
      canUndo: () => undo.length > 0,
      canRedo: () => redo.length > 0,
      undoLabel: () => (undo.length ? undo[undo.length - 1].label : null),
      redoLabel: () => (redo.length ? redo[redo.length - 1].label : null),
      /** Возвращает предыдущее состояние проекта (или null). */
      undo(current) {
        const prev = undo.pop();
        if (!prev) return null;
        redo.push({ label: prev.label, json: JSON.stringify(current) });
        return { project: JSON.parse(prev.json), label: prev.label };
      },
      redo(current) {
        const next = redo.pop();
        if (!next) return null;
        undo.push({ label: next.label, json: JSON.stringify(current) });
        return { project: JSON.parse(next.json), label: next.label };
      },
      clear() {
        undo.length = 0;
        redo.length = 0;
      },
    };
  }

  BS.history = { createHistory };
})(globalThis.BuildSense);
