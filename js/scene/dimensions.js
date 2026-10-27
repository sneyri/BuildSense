// Отображение габаритов: размерные линии по локальным осям выбранного элемента
// и (по переключателю «Габариты») общие размеры здания. Подписи — HTML поверх сцены.
(function (BS) {
  "use strict";
  const T = THREE;
  const G = BS.geometry;
  const S = BS.shapes;
  const fmt = BS.util.fmt;

  class Dimensions {
    constructor(view) {
      this.view = view;
      this.group = new T.Group();
      view.overlay.add(this.group);
      this.labels = [];
      view.frameCallbacks.add(() => this._updateLabels());
    }

    clear() {
      for (const c of [...this.group.children]) {
        this.group.remove(c);
        c.geometry.dispose();
        c.material.dispose();
      }
      for (const l of this.labels) l.node.remove();
      this.labels = [];
    }

    /** ids — выбранные элементы; overall — показать габариты всего здания. */
    show(project, ids, overall) {
      this.clear();
      for (const id of ids || []) {
        const el = project.elements.find((e) => e.id === id);
        if (el) this._element(project, el);
      }
      if (overall) this._overall(project);
    }

    _line(a, b, color = 0xffd60a) {
      const geo = new T.BufferGeometry().setFromPoints([new T.Vector3(a.x, a.y, a.z), new T.Vector3(b.x, b.y, b.z)]);
      const line = new T.Line(geo, new T.LineBasicMaterial({ color, depthTest: false, transparent: true }));
      line.renderOrder = 20;
      this.group.add(line);
    }

    _dim(a, b, text, offset) {
      const o = offset || { x: 0, y: 0, z: 0 };
      const A = { x: a.x + o.x, y: a.y + o.y, z: a.z + o.z }, B = { x: b.x + o.x, y: b.y + o.y, z: b.z + o.z };
      this._line(A, B);
      this._line(a, A);
      this._line(b, B);
      const node = document.createElement("div");
      node.className = "dim-label";
      node.textContent = text;
      this.view.container.append(node);
      this.labels.push({ node, at: new T.Vector3((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2) });
    }

    _element(project, el) {
      const t = BS.types.get(el.type) || {};
      const s = el.size;
      if (t.shape === "opening") {
        const host = project.elements.find((w) => w.id === el.hostId);
        if (!host) return;
        const p = (u, w) => G.localToWorld(host, u, 0, w);
        const { offset: off, elevation: ev } = el.position;
        const out = { x: -G.axes(host).vx * 0.3, y: -G.axes(host).vy * 0.3, z: 0 };
        this._dim(p(off, ev), p(off + s.width, ev), `${fmt(s.width)} м`, out);
        this._dim(p(off + s.width, ev), p(off + s.width, ev + s.height), `${fmt(s.height)} м`, out);
        return;
      }
      if (t.shape === "cylinder") {
        const c = el.position;
        this._dim({ x: c.x - s.diameter / 2, y: c.y, z: c.z }, { x: c.x + s.diameter / 2, y: c.y, z: c.z }, `⌀ ${fmt(s.diameter)} м`, { x: 0, y: -0.4, z: 0 });
        this._dim({ x: c.x + s.diameter / 2, y: c.y, z: c.z }, { x: c.x + s.diameter / 2, y: c.y, z: c.z + s.height }, `${fmt(s.height)} м`, { x: 0.3, y: 0, z: 0 });
        return;
      }
      const ps = S.planSize(el);
      if (!ps) return;
      const z0 = S.bottom(el, project), h = S.elementHeight(el);
      const ax = G.axes(el);
      const off = 0.4;
      const P = (u, v, w) => G.localToWorld(el, u, v, w);
      this._dim(P(0, 0, 0), P(ps[0], 0, 0), `${fmt(ps[0])} м`, { x: -ax.vx * off, y: -ax.vy * off, z: 0 });
      this._dim(P(ps[0], 0, 0), P(ps[0], ps[1], 0), `${fmt(ps[1])} м`, { x: ax.ux * off, y: ax.uy * off, z: 0 });
      if (h > 0.02) {
        const base = P(0, 0, 0);
        this._dim(base, { ...base, z: z0 + h }, `${fmt(h)} м`, { x: -ax.ux * off - ax.vx * off, y: -ax.uy * off - ax.vy * off, z: 0 });
      }
    }

    _overall(project) {
      const solids = project.elements.filter((e) => {
        const t = BS.types.get(e.type) || {};
        return !t.nonSolid && t.shape !== "opening" && Object.values(e.size).every((v) => Number.isFinite(v) && v > 0);
      });
      if (!solids.length) return;
      const pts = solids.flatMap((e) => S.footprint(e, project));
      const b = G.bbox2(pts);
      const top = Math.max(...solids.map((e) => S.top(e, project)));
      const z = 0;
      this._dim({ x: b.minX, y: b.minY, z }, { x: b.maxX, y: b.minY, z }, `${fmt(b.maxX - b.minX)} м`, { x: 0, y: -1.2, z: 0 });
      this._dim({ x: b.maxX, y: b.minY, z }, { x: b.maxX, y: b.maxY, z }, `${fmt(b.maxY - b.minY)} м`, { x: 1.2, y: 0, z: 0 });
      this._dim({ x: b.minX, y: b.minY, z }, { x: b.minX, y: b.minY, z: top }, `H = ${fmt(top)} м`, { x: -1.2, y: -1.2, z: 0 });
    }

    _updateLabels() {
      for (const l of this.labels) {
        const s = this.view.toScreen(l.at);
        l.node.hidden = !s.visible;
        l.node.style.left = `${s.x}px`;
        l.node.style.top = `${s.y}px`;
      }
    }
  }

  BS.Dimensions = Dimensions;
})(globalThis.BuildSense);
