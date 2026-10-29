// Показ демонстрационной симуляции в 3D: пошаговое движение элементов, цвета отказа/повреждения,
// «призрак» исходной модели для сравнения «до / после». Данные проекта не меняются: сброс
// просто возвращает исходное положение 3D-объектов.
(function (BS) {
  "use strict";
  const T = THREE;

  class SimPlayer {
    constructor(view) {
      this.view = view;
      this.result = null;
      this.index = -1;
      this.anim = null;
      this.ghost = null;
      this.original = new Map();
      view.frameCallbacks.add(() => this._tick());
    }

    get active() {
      return Boolean(this.result);
    }

    load(result) {
      this.reset();
      this.result = result;
      this.original.clear();
      for (const o of this.view.modelGroup.children) {
        this.original.set(o.userData.elementId, { p: o.position.clone(), q: o.quaternion.clone() });
      }
      this.index = -1;
    }

    /** Переход к шагу i с анимацией. */
    showStep(i, duration = 900) {
      if (!this.result) return;
      const steps = this.result.steps;
      this.index = Math.max(0, Math.min(steps.length - 1, i));
      const step = steps[this.index];
      const states = new Map();
      for (const id of step.highlight || []) states.set(id, "impact");
      for (const id of step.damaged || []) states.set(id, "damaged");
      for (const id of step.failed || []) states.set(id, "failed");
      this.view.setSimStates(states);
      const targets = new Map();
      for (const o of this.view.modelGroup.children) {
        const id = o.userData.elementId;
        let m = step.motions[id];
        if (m && m.follow && step.motions[m.follow]) m = step.motions[m.follow];
        targets.set(id, m || null);
      }
      const from = new Map(this.view.modelGroup.children.map((o) => [o.userData.elementId, { p: o.position.clone(), q: o.quaternion.clone() }]));
      this.anim = { start: performance.now(), duration, from, targets, sway: step.impact && step.impact.type === "lateral" && !step.final && this.index === 1 ? step.impact : null };
    }

    _target(id, m) {
      const orig = this.original.get(id);
      if (!orig) return null;
      if (!m) return { p: orig.p.clone(), q: orig.q.clone() };
      const axis = new T.Vector3(m.axis.x, m.axis.y, m.axis.z).normalize();
      const rq = new T.Quaternion().setFromAxisAngle(axis, m.angle);
      const pivot = new T.Vector3(m.pivot.x, m.pivot.y, m.pivot.z);
      const p = orig.p.clone().sub(pivot).applyQuaternion(rq).add(pivot);
      p.z += m.dz;
      return { p, q: rq.clone().multiply(orig.q) };
    }

    _tick() {
      const a = this.anim;
      if (!a) return;
      const k = Math.min(1, (performance.now() - a.start) / a.duration);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      for (const o of this.view.modelGroup.children) {
        const id = o.userData.elementId;
        const f = a.from.get(id);
        const t = this._target(id, a.targets.get(id));
        if (!f || !t) continue;
        o.position.lerpVectors(f.p, t.p, e);
        o.quaternion.slerpQuaternions(f.q, t.q, e);
        if (a.sway) {
          // Наглядная раскачка: смещение пропорционально высоте точки привязки (не расчёт!)
          const amp = 0.04 * a.sway.intensity * Math.sin(k * Math.PI * 3) * (1 - k);
          const d = (a.sway.direction * Math.PI) / 180;
          o.position.x += Math.cos(d) * amp * Math.max(0, o.position.z + 1);
          o.position.y += Math.sin(d) * amp * Math.max(0, o.position.z + 1);
        }
      }
      if (k >= 1) this.anim = null;
    }

    /** «Призрак» исходной модели: прозрачная копия поверх текущего состояния. */
    setGhost(on) {
      if (this.ghost) {
        this.view.overlay.remove(this.ghost);
        BS.sceneUtil.disposeTree(this.ghost);
        this.ghost = null;
      }
      if (!on || !this.result) return;
      const g = new T.Group();
      const mat = new T.MeshBasicMaterial({ color: 0x7fd1ff, transparent: true, opacity: 0.16, depthWrite: false });
      for (const o of this.view.modelGroup.children) {
        const orig = this.original.get(o.userData.elementId);
        if (!orig || !o.visible) continue;
        const copy = new T.Group();
        copy.position.copy(orig.p);
        copy.quaternion.copy(orig.q);
        o.children.forEach((c) => {
          if (c.isMesh && !c.userData.zone) copy.add(new T.Mesh(c.geometry.clone(), mat.clone()));
        });
        g.add(copy);
      }
      this.ghost = g;
      this.view.overlay.add(g);
    }

    /** Полный сброс: исходные положения, без подсветки и призрака. */
    reset() {
      this.anim = null;
      for (const o of this.view.modelGroup.children) {
        const orig = this.original.get(o.userData.elementId);
        if (orig) { o.position.copy(orig.p); o.quaternion.copy(orig.q); }
      }
      this.setGhost(false);
      this.view.setSimStates(new Map());
      this.result = null;
      this.index = -1;
    }
  }

  BS.SimPlayer = SimPlayer;
})(globalThis.BuildSense);
