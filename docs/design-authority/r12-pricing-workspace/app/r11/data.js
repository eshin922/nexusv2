// Nexus Round 11 — the composed Pricing page
// ═══════════════════════════════════════════════════════════════════════════
// ADDENDUM to app/r10/data.js. R10's compute() is the contract and is used
// unchanged; this file adds the QUOTE-LEVEL projections the page needs.
//
// The central claim, made literal in code: the cost stack is trace level 1.
// sectionsOf() reaches into the very node objects R10 built — it does not
// recompute anything — so the horizontal and vertical views cannot disagree.
//
// One new node kind falls out of blending across SKUs: `blend`, a weighted
// mean. See docs/r11-designer-notes.md §3.
// ═══════════════════════════════════════════════════════════════════════════

window.NXR11 = (function () {
  const R = () => window.NXR10;

  // client_target_price_per_unit — classifies competitiveness only.
  // Never alters a price (see r10 data-source map, "not sourced from here").
  const benchmarks = {
    s1: { vals: [4.35, 3.72, 3.15, 2.74], src: { actor: "Maya Okafor", when: "2026-06-12", doc: "Lumen RFQ + competitor teardown", note: "Beth's stated landed target, adjusted for their margin." } },
    s2: { vals: [7.10, 6.40, 5.70, 5.15], src: { actor: "Maya Okafor", when: "2026-06-12", doc: "Lumen RFQ + competitor teardown", note: "50 ml benchmark from their incumbent." } },
    s3: { vals: [3.05, 2.62, 2.25, 1.98], src: { actor: "Maya Okafor", when: "2026-06-12", doc: "Lumen RFQ + competitor teardown", note: "Body-care benchmark, less firm." } },
  };

  // ── Reach into R10's own nodes. No recomputation. ────────
  // Walks down through however many wrappers sit above the section sum —
  // override, surgical lift, price adjustment — rather than assuming a fixed
  // depth. Adding a fourth lever proved the fixed-depth version brittle.
  function sectionsOf(result) {
    let n = result.root;
    if (n.kind === "override") n = n.superseded;
    while (n.kind === "adjustment" && n.operands.length) n = n.operands[0];
    const computed = result.root.kind === "override" ? result.root.superseded : result.root;
    return { computed, sellBefore: n, sections: n.operands, adjNode: computed.operands[1] };
  }

  // ── Quote-level rollup at one tier ───────────────────────
  function quoteAtTier(ti, flags) {
    const R10 = R();
    const tier = R10.tiers[ti];
    const rows = R10.skus.map(sku => {
      const r = R10.compute(sku, ti, flags);
      const s = sectionsOf(r);
      return { sku, r, sections: s.sections, sellBefore: s.sellBefore, adjNode: s.adjNode, computed: s.computed };
    });
    const units = tier.qty;
    const totalUnits = rows.length * units;
    const wmean = fn => rows.reduce((a, x) => a + fn(x) * units, 0) / totalUnits;

    // Blended section nodes — the cost-stack rows.
    const blended = rows[0].sections.map((proto, i) => {
      const parts = rows.map(x => x.sections[i]);
      const val = parts.reduce((a, p) => a + p.value * units, 0) / totalUnits;
      return R10.node({
        key: "blend-" + i,
        kind: "blend",
        label: proto.label,
        value: val,
        op: parts.map(p => R10.m4(p.value) + " × " + units.toLocaleString()).join("  +  ")
             + "   ÷   " + totalUnits.toLocaleString() + " units",
        operands: parts.map((p, j) => Object.assign({}, p, {
          key: rows[j].sku.id + ":" + p.key,
          label: rows[j].sku.code + " · " + p.label,
        })),
        note: "Weighted mean across " + rows.length + " SKUs at " + tier.label + ". Blending is linear, so these rows still sum to sell before adjustment.",
      });
    });

    const sellBefore = blended.reduce((a, b) => a + b.value, 0);
    const computedSell = wmean(x => x.r.computedSell);
    const sell = wmean(x => x.r.sell);
    const cost = wmean(x => x.r.totalCost);
    const overrides = rows.filter(x => x.r.overridden);
    const lifts = rows.filter(x => x.r.lifted);
    const liftedSell = wmean(x => x.r.overridden ? x.r.computedSell : x.r.sell);

    return {
      tier, ti, rows, blended, units, totalUnits,
      sellBefore,
      adjDelta: computedSell - sellBefore,
      adjPct: rows[0].adjNode.value,
      adjNode: rows[0].adjNode,
      liftDelta: liftedSell - computedSell,
      lifts,
      overrideDelta: sell - liftedSell,
      overrides,
      sell, cost,
      margin: sell === 0 ? 0 : (sell - cost) / sell,
      worstMargin: Math.min.apply(null, rows.map(x => x.r.margin)),
      worstSku: rows.reduce((w, x) => (x.r.margin < w.r.margin ? x : w), rows[0]).sku,
      benchmark: rows.reduce((a, x) => a + benchmarks[x.sku.id].vals[ti] * units, 0) / totalUnits,
    };
  }

  // ── Preview Changes ──────────────────────────────────────
  // The finding: A = tier ?? global — replaces, never stacks. So a global lift
  // reaches NO tier that carries its own adjustment, and no cell carrying a PM
  // override. Both reasons are already in the resolution node; this just reads them.
  //
  // `reason` is NULL unless there is a genuine one. A row that doesn't move because
  // nothing was changed is not "held" — it is simply unchanged, and reporting it as a
  // hold would be a reasonless warning. See designer notes §6a.
  function previewGlobal(newPct, flags) {
    const R10 = R();
    const cur = R10.firm.global_price_adj_pct.pct;
    const noop = Math.abs(newPct - cur) < 1e-9;
    const tiers = R10.tiers.map((t, ti) => {
      const tierAdj = R10.tier_price_adj[t.id];
      const rows = R10.skus.map(sku => {
        const before = R10.compute(sku, ti, flags);
        R10.firm.global_price_adj_pct.pct = newPct;
        const after = R10.compute(sku, ti, flags);
        R10.firm.global_price_adj_pct.pct = cur;
        const delta = after.sell - before.sell;
        const held = Math.abs(delta) < 1e-9;
        return {
          sku, before, after, delta, held,
          reason: !held ? null
            : before.overridden
              ? { kind: "override", text: "carries a PM-set price", who: sku.overrides[t.id].actor, when: sku.overrides[t.id].when.split(" ")[0] }
              : tierAdj
                ? { kind: "tier", text: "is on its own " + R10.pct(tierAdj.pct) + " adjustment", who: tierAdj.set_by, when: tierAdj.when }
                : null,
        };
      });
      const movedRows = rows.filter(r => !r.held);
      return {
        tier: t, ti, tierAdj,
        rows,
        moved: movedRows.length,
        held: rows.filter(r => r.reason),
        before: rows.reduce((a, r) => a + r.before.sell, 0) / rows.length,
        after: rows.reduce((a, r) => a + r.after.sell, 0) / rows.length,
      };
    });
    return { noop, current: cur, newPct, tiers };
  }

  // ── Below-floor cells and the corrective lift they can take ──
  // The lift is an EXCEPTION path, so it is discovered from compliance rather
  // than offered as a standing lever. See designer notes §11.2.
  function breaches(ti, flags) {
    const R10 = R();
    return R10.skus.map(sku => {
      const offer = R10.liftToFloor(sku, ti, flags);
      if (!offer.needed && !offer.blocked) return null;
      return { sku, tier: R10.tiers[ti], ti, offer };
    }).filter(Boolean);
  }

  // ── Path from root to a node key (entry-at-node) ─────────
  function findPath(root, key) {
    const walk = (n, trail) => {
      const t = trail.concat(n);
      if (n.key === key) return t;
      for (const o of (n.operands || [])) {
        const hit = walk(o, t);
        if (hit) return hit;
      }
      return null;
    };
    return walk(root, []);
  }

  return { benchmarks, sectionsOf, quoteAtTier, previewGlobal, breaches, findPath };
})();
