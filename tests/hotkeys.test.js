// Менеджер горячих клавиш (js/ui/hotkeys.js): сочетания, область действия по режиму, ввод текста, диалоги, переназначение.
// Модуль без обязательного DOM — выполняется в Node (vm); реальные действия приложения проверяются в браузере.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./loader.js";

function load() {
  const ctx = vm.createContext({ console });
  for (const f of ["js/core/namespace.js", "js/ui/hotkeys.js"]) vm.runInContext(readFileSync(path.join(ROOT, f), "utf-8"), ctx, { filename: f });
  return ctx.BuildSense.hotkeys;
}
const ev = (code, o = {}) => ({ code, key: o.key || (code.startsWith("Key") ? code.slice(3).toLowerCase() : code), ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, target: { tagName: "DIV" }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; this.prevented = true; }, ...o });

function setup() {
  const H = load();
  const log = [];
  const reg = (id, group, keys, extra = {}) => H.register({ id, group, label: id, keys, run: () => { log.push(id); }, ...extra });
  reg("mech.move", "mech", ["KeyG"]); reg("arch.move", "arch", ["KeyG"]);
  reg("mech.connect", "mech", ["KeyJ"]);
  reg("undo", "common", ["Ctrl+KeyZ"]); reg("redo", "common", ["Ctrl+KeyY", "Ctrl+Shift+KeyZ"]);
  reg("save", "common", ["Ctrl+KeyS"]); reg("dup", "common", ["Ctrl+KeyD"]);
  reg("del", "common", ["Delete"], { enabled: () => state.sel });
  reg("esc", "common", ["Escape"]);
  const state = { sel: true };
  return { H, log, state };
}

test("клавиши работают по коду, а не по раскладке (русская «п» = KeyG)", () => {
  const { H, log } = setup();
  assert.equal(H.dispatch(ev("KeyG", { key: "п" }), { mode: "mech" }), true);
  assert.deepEqual(log, ["mech.move"]);
});

test("режимы: G — перемещение в машиностроении и в архитектуре (разные действия), J только в машиностроении", () => {
  const { H, log } = setup();
  H.dispatch(ev("KeyG"), { mode: "arch" });
  H.dispatch(ev("KeyG"), { mode: "mech" });
  H.dispatch(ev("KeyJ"), { mode: "arch" });
  H.dispatch(ev("KeyJ"), { mode: "mech" });
  assert.deepEqual(log, ["arch.move", "mech.move", "mech.connect"]);
});

test("Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Ctrl+S, Ctrl+D, Delete, Escape — в обоих режимах; preventDefault вызывается", () => {
  for (const mode of ["mech", "arch"]) {
    const { H, log } = setup();
    const e1 = ev("KeyZ", { ctrlKey: true }), e2 = ev("KeyY", { ctrlKey: true }), e3 = ev("KeyZ", { ctrlKey: true, shiftKey: true });
    for (const e of [e1, e2, e3, ev("KeyS", { ctrlKey: true }), ev("KeyD", { ctrlKey: true }), ev("Delete"), ev("Escape")]) assert.equal(H.dispatch(e, { mode }), true, `${mode}: ${e.code}`);
    assert.deepEqual(log, ["undo", "redo", "redo", "save", "dup", "del", "esc"]);
    assert.equal(e1.prevented, true, "Ctrl+Z не должен доходить до браузера");
  }
});

test("Meta (Cmd) работает как Ctrl; голая Z без Ctrl не вызывает отмену", () => {
  const { H, log } = setup();
  assert.equal(H.dispatch(ev("KeyZ", { metaKey: true }), { mode: "mech" }), true);
  assert.equal(H.dispatch(ev("KeyZ"), { mode: "mech" }), false);
  assert.deepEqual(log, ["undo"]);
});

test("ввод текста не перехватывается: INPUT, TEXTAREA, SELECT, contenteditable", () => {
  const { H, log } = setup();
  for (const target of [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }]) {
    for (const e of [ev("KeyG", { target }), ev("Delete", { target }), ev("KeyZ", { target, ctrlKey: true }), ev("Escape", { target })]) assert.equal(H.dispatch(e, { mode: "mech" }), false);
  }
  assert.deepEqual(log, []);
});

test("событие, уже обработанное локально (холст плана), не обрабатывается повторно — нет двойного срабатывания", () => {
  const { H, log } = setup();
  const e = ev("Delete"); e.defaultPrevented = true;
  assert.equal(H.dispatch(e, { mode: "arch" }), false);
  assert.deepEqual(log, []);
});

test("открытый диалог блокирует всё, кроме Escape и «?»", () => {
  const { H, log } = setup();
  assert.equal(H.dispatch(ev("KeyG"), { mode: "mech", dialogOpen: true }), false);
  assert.equal(H.dispatch(ev("Escape"), { mode: "mech", dialogOpen: true }), true);
  assert.deepEqual(log, ["esc"]);
});

test("enabled() запрещает действие (Delete без выделения ничего не делает и не отменяет событие)", () => {
  const { H, log, state } = setup();
  state.sel = false;
  const e = ev("Delete");
  assert.equal(H.dispatch(e, { mode: "mech" }), false);
  assert.equal(e.prevented, undefined);
  assert.deepEqual(log, []);
});

test("«?» и F1 открывают справку; справка есть в обоих режимах", () => {
  const H = load();
  assert.ok(H.resolve("?", "mech") && H.resolve("?", "arch"));
  assert.ok(H.resolve("F1", "arch"));
  assert.equal(H.combo({ key: "?", code: "Slash", shiftKey: true }), "?");
});

test("справка показывает ровно зарегистрированные действия режима (не статичный список)", () => {
  const { H } = setup();
  const mech = H.list("mech").map((x) => x.id), arch = H.list("arch").map((x) => x.id);
  assert.ok(mech.includes("mech.connect") && !arch.includes("mech.connect"));
  assert.ok(arch.includes("arch.move") && !mech.includes("arch.move"));
  H.unregister("mech.connect");
  assert.ok(!H.list("mech").some((x) => x.id === "mech.connect"));
});

test("переназначение: работает, отклоняет конфликт и Escape, сбрасывается", () => {
  const { H, log } = setup();
  assert.deepEqual(plain(H.remap("mech.connect", "KeyL")), { ok: true });
  assert.equal(H.dispatch(ev("KeyJ"), { mode: "mech" }), false);
  assert.equal(H.dispatch(ev("KeyL"), { mode: "mech" }), true);
  const clash = H.remap("mech.connect", "KeyG");
  assert.equal(clash.ok, false);
  assert.match(clash.error, /занято/);
  assert.equal(H.remap("mech.connect", "Escape").ok, false);
  H.resetAll();
  assert.equal(H.dispatch(ev("KeyJ"), { mode: "mech" }), true);
  assert.deepEqual(log, ["mech.connect", "mech.connect"]);
});
const plain = (v) => JSON.parse(JSON.stringify(v));
