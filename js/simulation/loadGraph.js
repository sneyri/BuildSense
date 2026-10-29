// Граф передачи нагрузки: для каждого элемента — на чём он держится и с каким «весом» опирания.
// Вес опоры — доля контрольных точек элемента, лежащих на этой опоре (для плоскостных элементов —
// поровну между опорами). Граф используется демонстрационной симуляцией.
(function (BS) {
  "use strict";
  const S = BS.shapes;

  /**
   * @returns {Map<string, { el, supports: Map<id, weight>, dependents: Set<id>, grounded: boolean }>}
   */
  function build(project) {
    const nodes = new Map();
    for (const el of project.elements) nodes.set(el.id, { el, supports: new Map(), dependents: new Set(), grounded: false });
    const add = (childId, supportId, w) => {
      const n = nodes.get(childId);
      if (!n || !nodes.has(supportId) || childId === supportId) return;
      n.supports.set(supportId, (n.supports.get(supportId) || 0) + w);
      nodes.get(supportId).dependents.add(childId);
    };

    for (const el of project.elements) {
      const t = BS.types.get(el.type) || {};
      const node = nodes.get(el.id);
      if (t.support === "ground") {
        node.grounded = true;
        continue;
      }
      if (t.shape === "opening") {
        add(el.id, el.hostId, 1);
        continue;
      }
      if (el.params && el.params.hostWallId) {
        add(el.id, el.params.hostWallId, 1);
        continue;
      }
      if (t.support === "attached") {
        const list = BS.support.attachedTo(project, el);
        list.forEach((s) => add(el.id, s.id, 1 / list.length));
        continue;
      }
      if (t.support !== "gravity") continue;
      const info = BS.support.supportInfo(project, el);
      if (info.areal || !info.supports.length) {
        info.supports.forEach((s) => add(el.id, s.id, 1 / info.supports.length));
        continue;
      }
      // Вес по контрольным точкам
      const z = S.bottom(el, project);
      const pts = BS.support.samplePoints(el, project);
      const counts = new Map();
      for (const p of pts) {
        for (const s of info.supports) {
          if (Math.abs(S.top(s, project) - z) <= BS.support.LEVEL_TOL && BS.support.containsPoint(s, project, p.x, p.y, 0.005)) {
            counts.set(s.id, (counts.get(s.id) || 0) + 1);
          }
        }
      }
      for (const [id, c] of counts) add(el.id, id, c / pts.length);
    }
    return nodes;
  }

  /** Доля опирания, оставшаяся у элемента при отказавших опорах failed. */
  function remainingSupport(node, failed) {
    let total = 0, left = 0;
    for (const [id, w] of node.supports) {
      total += w;
      if (!failed.has(id)) left += w;
    }
    return { total, left };
  }

  BS.loadGraph = { build, remainingSupport };
})(globalThis.BuildSense);
