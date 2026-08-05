/* global React, NXR10, NXR11 */
// R12 — the Pricing page as a WORKING SURFACE.
// Supersedes app/r11/pricing-page.jsx. Everything R11 established holds; what
// changes is that lifts, overrides and the global adjustment now accumulate in a
// session-scoped WORKING state and are written only on Apply.
//
// The engine makes this nearly free: computeQuoteCosting is pure, so the page
// computes TWICE — once against the committed input set, once against the
// working one — and shows the difference. The stack is trace level 1 transposed,
// so a staged input set produces a staged stack from the same node objects: the
// two projections still cannot disagree.
// Nexus Round 11 — the composed Pricing page
// The R10 detail section restored, with the trace as its expansion.
//
// R10's Level / Origin / Resolution / Recon are reused VERBATIM (window.*).
// R10's `Trace` is superseded by `TraceAt` here — same panel, but it enters at
// the node the operator pressed instead of always at the root. See §2 of the notes.

const { useState, Fragment } = React;
const D = () => window.NXR10;
const P = () => window.NXR11;

// Recompute the whole quote against a candidate input set without persisting
// anything. firm/sku values are restored immediately, so nothing leaks.
function computeAgainst(flags, adj, lifts, overrides) {
  const R10 = D();
  const curAdj = R10.firm.global_price_adj_pct.pct;
  const saved = R10.skus.map(s => s.overrides);
  R10.firm.global_price_adj_pct.pct = adj;
  R10.skus.forEach(s => {
    const extra = {};
    Object.keys(overrides || {}).forEach(k => {
      const [skuId, tierId] = k.split(":");
      if (skuId === s.id) extra[tierId] = overrides[k];
    });
    s.overrides = Object.assign({}, s.overrides, extra);
  });
  const out = R10.tiers.map((_, ti) => P().quoteAtTier(ti, Object.assign({}, flags, { lifts })));
  R10.firm.global_price_adj_pct.pct = curAdj;
  R10.skus.forEach((s, i) => { s.overrides = saved[i]; });
  return out;
}

// Colour encodes STATE (is this actionable?); badges encode HISTORY (was it
// corrected?). A lift lands a cell exactly on the floor, so a float-exact
// comparison reported it as still breaching — red on a cell that had just been
// fixed, identical to a genuine breach.                        ← LOAD-BEARING
const EPS = 1e-9;
function marginState(m) {
  const { firm } = D();
  if (m >= firm.target_margin_pct - EPS) return "good";
  if (m >= firm.floor_margin_pct - EPS) return "below_target";
  return "below_floor";
}

const money = (v, dp = 2) => (v < 0 ? "−$" + Math.abs(v).toFixed(dp) : "$" + v.toFixed(dp));

// Correct at every n. Item 17 said data-dependent copy is generated from the
// data; a joiner that only reads at n=2 is the same defect one layer down.
//   1 → "the A"   2 → "the A and the B"   3 → "the A, the B, and the C"
function joinClauses(list) {
  if (list.length === 1) return "the " + list[0];
  if (list.length === 2) return "the " + list[0] + " and the " + list[1];
  return "the " + list.slice(0, -1).join(", the ") + ", and the " + list[list.length - 1];
}
const pctS = p => (p * 100).toFixed(Math.abs(p * 100 % 1) < 0.001 ? 0 : 1) + "%";

// ═══ Trace, entered at a node ════════════════════════════
function TraceAt({ root, targetKey, title, meta, onClose, onReroot, supersededBy, scopeNote }) {
  const [openPath, setOpenPath] = useState({});
  const toggle = (depth, key) => setOpenPath(prev => {
    const next = {};
    for (const d of Object.keys(prev)) if (Number(d) < depth) next[d] = prev[d];
    if (key) next[depth] = key;
    return next;
  });

  const path = P().findPath(root, targetKey) || [root];
  const target = path[path.length - 1];
  const ancestors = path.slice(0, -1);
  const isOverrideRoot = target.kind === "override";

  return (
    <div className="r11-tracewrap">
      <div className="r10-anchor">
        <span className="q">Why is <em>{title}</em> {money(target.value, 4)}?</span>
        {meta && <span className="meta">{meta}</span>}
        <span className="acts">
          <button className="btn ghost sm" onClick={() => setOpenPath({})}>Collapse chain</button>
          <button className="btn ghost sm" onClick={onClose}>✕ Close</button>
        </span>
      </div>

      {/* Levels ABOVE the node pressed — available, collapsed, out of the way. */}
      {ancestors.length > 0 && (
        <div className="r11-crumb">
          <span className="cap">inside</span>
          {ancestors.map((a, i) => (
            <span key={a.key} style={{ display: "contents" }}>
              <button onClick={() => onReroot(a.key)}>
                {a.label} <span className="v">{money(a.value, 4)}</span>
              </button>
              <span className="sep">›</span>
            </span>
          ))}
          <span className="here">{target.label}</span>
        </div>
      )}

      {scopeNote && (
        <div className="r11-noop" style={{ margin: "12px 20px 0" }}>
          <span className="g">↳</span>
          <span>{scopeNote}</span>
        </div>
      )}

      {supersededBy && !isOverrideRoot && (
        <div className="r10-override" style={{ margin: "12px 20px 0" }}>
          <div className="lead">
            The quoted price is {money(supersededBy.value, 2)} — set by a person, not calculated.
          </div>
          <div className="sub">
            {supersededBy.origin.actor} entered it on {supersededBy.origin.when}.{" "}
            <strong>Everything below is the superseded chain</strong> — what the computation would have
            produced ({money(supersededBy.superseded.value, 4)}), not the arithmetic behind the quoted price.
          </div>
          <div className="nochain"><span>⊘</span> the quoted price has no arithmetic above it</div>
        </div>
      )}

      <div className="r10-levels">
        {isOverrideRoot ? (
          <div>
            <div className="r10-override">
              <div className="lead">This price was set by a person, not calculated.</div>
              <div className="sub">
                {money(target.value, 2)} was entered directly. It replaces the computed chain entirely — tier and
                global adjustments no longer affect this cell, and revenue, margin, the customer preview, the PDF
                and NetSuite all use this figure.
              </div>
              <div className="nochain"><span>⊘</span> no arithmetic above this point</div>
            </div>
            <window.Origin origin={target.origin} stop="end of chain · the price is this because someone decided it" />
            <div className="r10-superseded">
              <span className="cap">superseded — what the chain would have produced</span>
              <window.Level node={target.superseded} depth={0} path={[]} openPath={openPath} onToggle={toggle} />
            </div>
          </div>
        ) : (
          <window.Level node={target} depth={0} path={[]} openPath={openPath} onToggle={toggle} />
        )}
      </div>
    </div>
  );
}

// ═══ Global price adjustment + Preview Changes ═══════════
function AdjustmentPanel({ flags, adj, onAdj, committedAdj, lifts, removeAllLifts }) {
  const R10 = D();
  const current = committedAdj != null ? committedAdj : R10.firm.global_price_adj_pct.pct;
  const [draft, setDraft] = useState((current * 100).toFixed(1));
  const [previewing, setPreviewing] = useState(false);
  const newPct = (parseFloat(draft) || 0) / 100;
  const preview = previewing ? P().previewGlobal(newPct, flags) : null;
  return (
    <div className="r11-panel r11-adjbar">
      <div className="r11-phead">
        <span className="t">Global price adjustment</span>
        <span className="s">commercial, whole-quote · applies to every tier without its own</span>
      </div>
      <div className="r11-pbody">
        <div className="r11-adjrow">
          <span className="r11-cur">
            currently <strong>{pctS(current)}</strong><br />
            set by {R10.firm.global_price_adj_pct.set_by}, {R10.firm.global_price_adj_pct.when}
          </span>
          <label className="r11-field">
            <span className="lbl">New %</span>
            <input value={draft} onChange={e => { setDraft(e.target.value); setPreviewing(false); }} />
          </label>
          <button className="btn" onClick={() => setPreviewing(true)}>Preview changes</button>
          <button className="btn primary" onClick={() => { onAdj(newPct); setPreviewing(false); }}>Stage this adjustment</button>
          {Object.keys(lifts || {}).length > 0 && (
            <button className="btn ghost" style={{ marginLeft: "auto" }} onClick={removeAllLifts}>
              {Object.keys(lifts).length === 1 ? "Remove the lift" : "Remove all " + Object.keys(lifts).length + " lifts"}
            </button>
          )}
        </div>

        {preview && preview.noop && (
          <div className="r11-preview">
            <div className="r11-noop">
              <span className="g">=</span>
              <span>
                <strong>No change.</strong> {pctS(preview.current)} is already the global adjustment —
                enter a different figure to see what a lift would reach.
              </span>
            </div>
          </div>
        )}

        {preview && !preview.noop && (
          <div className="r11-preview">
            {preview.tiers.map(p => {
              const moved = p.moved > 0;
              const delta = p.after - p.before;
              return (
                <div key={p.tier.id}>
                  <div className="r11-prow">
                    <span className="tl">{p.tier.label}</span>
                    <span className="desc">
                      {moved
                        ? `${p.moved} of ${p.rows.length} SKUs move`
                        : `no SKU moves`}
                    </span>
                    <span className="mv">
                      {Math.abs(delta) > 1e-9
                        ? <span className="up">{money(p.before, 4)} → {money(p.after, 4)}</span>
                        : <span className="flat">unchanged</span>}
                    </span>
                  </div>
                  {p.held.length > 0 && p.held.map(h => (
                    <div className="r11-held" key={h.sku.id}>
                      <span className="g">⊘</span>
                      <span className="txt">
                        <strong>{p.tier.label} · {h.sku.code}</strong> {h.reason.text} and is <strong>unaffected</strong>
                        {h.reason.kind === "tier" && " — a tier adjustment replaces the global one, it does not stack"}
                        {h.reason.kind === "override" && " — an override replaces the whole computed chain"}.
                        <span className="who">{h.reason.who} · {h.reason.when}</span>
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ Client target — the third threshold ════════════════
// client_target_price_per_unit. Quote-scoped, PER SKU, and present on only a
// small minority of deals. It classifies competitiveness and never alters price.
//
// The dimensional fact that decides the shape: the BENCHMARK is per SKU (it does
// not vary by tier) but the COMPARISON is per cell (each tier prices differently).
// So the benchmark is stated once on the SKU row, and the headroom shows on the
// cells. A column would assert that the benchmark varies across tiers, which it
// does not — and would leave an empty region on the ~95% of quotes that carry no
// target at all.                                              ← LOAD-BEARING
const CLIENT_TARGETS = { s1: 4.15, s3: 2.62 };   // s2 deliberately has none

// ═══ Summary banner ═════════════════════════════════════
// PRESERVED from the production page: scenario context, "Tune price & review",
// the state line, the next-move CTA, the SENDABLE badge, "What you're sending".
// R12 changes exactly one thing about it — the verdict is derived from the same
// compliance evaluation the grid renders, so the two cannot diverge.
//
// The page tells the PM what is TRUE; the banner tells them what to DO. A page
// that answers "are my margins compliant" and never says "so send it" leaves the
// workflow unfinished.                                        ← LOAD-BEARING
function SummaryBanner({ verdict, ev, rollups, onGoToGrid }) {
  const { project, tiers, firm, recommendedIdx } = D();
  const ri = tiers.findIndex(t => t.recommended);
  const rec = rollups[ri];
  const orderValue = rec.sell * rec.totalUnits;
  return (
    <div className="r12-banner">
      <div className="scen">{project.client} · {project.scenario} scenario · {project.quote_number}</div>
      <h1 className="tune">Tune <em>price</em> &amp; review.</h1>
      <p className="state">{verdict.state}</p>

      <div className={"r12-next" + (verdict.sendable ? "" : " blocked")}>
        <div className="l">
          <span className="k">Your next move</span>
          <span className="v">{verdict.move}</span>
        </div>
        {verdict.sendable
          ? <button className="btn primary">Preview quote PDF →</button>
          : <button className="btn primary" onClick={onGoToGrid}>Go to the cells ↓</button>}
      </div>

      <div className={"r12-verdict" + (verdict.sendable ? "" : " blocked")}>
        <span className={"badge" + (verdict.sendable ? "" : " no")}>● {verdict.badge}</span>
        <span className="txt">{verdict.verdict}</span>
      </div>

      <div className="r12-sending">
        <div className="k">What you're sending</div>
        <div className="cols">
          <div className="c">
            <div className="lbl">Scope</div>
            <div className="big">{D().skus.length} <span className="u">SKUs</span></div>
            <div className="sub">{tiers.length} tiers</div>
          </div>
          <div className="c">
            <div className="lbl">Recommended tier</div>
            <div className="big">{tiers[ri].label} <span className="u">· {tiers[ri].qty.toLocaleString()}</span></div>
            <div className="sub">order value at this tier</div>
          </div>
          <div className="c">
            <div className="lbl">Order value · {tiers[ri].label}</div>
            <div className="big">{"$" + Math.round(orderValue).toLocaleString()}</div>
            <div className="sub">across all SKUs</div>
          </div>
          <div className="c">
            <div className="lbl">Blended margin</div>
            <div className={"big " + marginState(rec.margin)}>{pctS(rec.margin)}</div>
            <div className="sub">target {D().pct(firm.target_margin_pct)} · floor {D().pct(firm.floor_margin_pct)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══ ONE compliance evaluation ══════════════════════════
// Every claim either surface makes about compliance comes from here.
function evaluateCells(rollups, flags, lifts, overrides, committedOverrides) {
  const { skus, tiers, liftToFloor } = D();
  const cells = [];
  skus.forEach((sku, si) => tiers.forEach((tier, ti) => {
    const r = rollups[ti].rows[si].r;
    const offer = liftToFloor(sku, ti, flags);
    const key = sku.id + ":" + tier.id;
    const applied = lifts[key];
    const direct = overrides && overrides[key];
    cells.push({
      si, ti, sku, tier, r, offer, key, applied, direct,
      isStaged: !!direct && !(committedOverrides && committedOverrides[key]),
      state: marginState(r.margin),
      outstanding: !!offer.needed && !applied,
      actionable: !!(offer.needed || offer.blocked || applied),
    });
  }));
  const at = (si, ti) => cells.find(c => c.si === si && c.ti === ti);
  const outstanding = cells.filter(c => c.outstanding);
  const belowTarget = cells.filter(c => c.state === "below_target");
  return { cells, at, outstanding, belowTarget };
}

// The verdict the banner shows is derived from that same evaluation.
function verdictFrom(ev, rollups) {
  const { tiers, firm } = D();
  const n = ev.outstanding.length;
  if (n > 0) {
    const byTier = {};
    ev.outstanding.forEach(c => { byTier[c.tier.label] = (byTier[c.tier.label] || 0) + 1; });
    const where = Object.keys(byTier).map(t => byTier[t] + " at " + t).join(", ");
    return {
      sendable: false,
      badge: "NOT SENDABLE",
      verdict: n + " cell" + (n === 1 ? "" : "s") + " below floor — " + where,
      state: "Below the firm margin floor — correct before sending.",
      move: "Clear " + n + " cell" + (n === 1 ? "" : "s") + " below floor ↓",
    };
  }
  if (ev.belowTarget.length > 0) {
    return {
      sendable: true,
      badge: "SENDABLE",
      verdict: "All tiers above floor · " + ev.belowTarget.length + " below target",
      state: "All margins above floor — review and send.",
      move: "Preview quote PDF →",
    };
  }
  return {
    sendable: true, badge: "SENDABLE",
    verdict: "All tiers above target",
    state: "All margins above target — review and send.",
    move: "Preview quote PDF →",
  };
}

// ═══ Compliance — per CELL, not per tier ════════════════
// The blended tier margin is a SYMPTOM; the diagnosis is per-cell and so is the
// action (one SKU, one tier). A per-tier panel showing one exemplar cannot drive
// a per-cell decision — the old "+2 more cells below floor" line was the panel
// admitting exactly that. So the grid IS the compliance surface, and the
// tier-level read survives as a rollup ROW on it rather than a separate panel.
//
// This also absorbs R11's per-SKU breakdown: it was already this grid, sitting
// beneath a summary that could not act. One grid, two jobs — margins and
// composition — instead of two grids.                          ← LOAD-BEARING
function ComplianceGrid({ rollups, ev, flags, lifts, onLift, onOverride, open, onOpen }) {
  const { skus, tiers, firm, pct: fpct } = D();
  const [expanded, setExpanded] = useState(null);
  const [sel, setSel] = useState(null);

  // Reads the shared evaluation — never its own. This is what makes "the banner
  // and the grid cannot disagree" structural rather than a convention.
  const cellState = (si, ti) => ev.at(si, ti);

  return (
    <div className="r11-stack">
      <div className="r11-srow head">
        <div className="r11-slab">
          <span className="colhead">Compliance · margin by cell</span>
          <span className="s">target {fpct(firm.target_margin_pct)} · floor {fpct(firm.floor_margin_pct)}</span>
        </div>
        {tiers.map(t => (
          <div className="r11-scell flat" key={t.id}>
            <span className="sell" style={{ fontSize: 11, letterSpacing: "0.06em" }}>
              {t.label}{t.recommended && <span style={{ color: "oklch(0.56 0.13 72)" }}> ★</span>}
            </span>
            <span className="cost">{t.qty.toLocaleString()} units</span>
          </div>
        ))}
      </div>

      {skus.map((sku, si) => {
        const isX = expanded === sku.id;
        return (
          <div key={sku.id} style={{ display: "contents" }}>
            <div className="r11-brow">
              <button className="r11-bsku" style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                onClick={() => setExpanded(isX ? null : sku.id)}>
                <span className="chev">{isX ? "▾" : "▸"}</span>
                <span>
                  <span className="n">{sku.name}</span>
                  <span className="m">{sku.code} · {sku.pack}</span>
                  {CLIENT_TARGETS[sku.id] != null && (
                    <span className="r12-benchmark">client target {money(CLIENT_TARGETS[sku.id], 2)}</span>
                  )}
                </span>
              </button>
              {tiers.map((t, ti) => {
                const c = cellState(si, ti);
                const cls = marginState(c.r.margin);
                const isSel = sel && sel.si === si && sel.ti === ti;
                return (
                  <button key={t.id}
                    className={"r11-bcell r11-cg" + (c.actionable ? " act" : " inert") + (isSel ? " sel" : "")}
                    onClick={c.actionable ? () => setSel(isSel ? null : { si, ti }) : undefined}>
                    <span className={"cgm " + cls}>{pctS(c.r.margin)}</span>
                    <span className="p" style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{money(c.r.sell, 2)}</span>
                    <Headroom sku={sku} sell={c.r.sell} />
                    {c.r.overridden && <span className="ov">{c.isStaged ? "set · staged" : "PM-set"}</span>}
                    {c.applied && <span className="lifted">lifted {fpct(c.applied.pct)}</span>}
                    {c.outstanding && <span className="needs">needs {fpct(c.offer.pct)}</span>}
                  </button>
                );
              })}
            </div>

            {sel && sel.si === si && (
              <CellAction sel={sel} c={cellState(si, sel.ti)} onLift={onLift} onOverride={onOverride} onClose={() => setSel(null)} />
            )}

            {isX && rollups[0].rows[si].sections.map((proto, i) => (
              <div className="r11-brow r11-sub" key={i}>
                <div className="r11-slab" style={{ paddingLeft: 40 }}>
                  <span className="n" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{proto.label}</span>
                  <span className="s">sell per unit</span>
                </div>
                {rollups.map(q => {
                  const n = q.rows[si].sections[i];
                  const key = sku.id + ":" + n.key;
                  const isOpen = open && open.where === "sku" && open.ti === q.ti && open.key === key && open.skuId === sku.id;
                  return (
                    <button key={q.tier.id} className={"r11-scell" + (isOpen ? " open" : "")}
                      onClick={() => onOpen(isOpen ? null : { where: "sku", ti: q.ti, key, skuId: sku.id, si })}>
                      <span className="sell">{money(n.value, 4)}</span>
                      <span className="why">{isOpen ? "tracing ▾" : "why? ▸"}</span>
                    </button>
                  );
                })}
              </div>
            ))}

            {isX && open && open.where === "sku" && open.skuId === sku.id && (
              <SkuTrace rollups={rollups} open={open} onOpen={onOpen} />
            )}
          </div>
        );
      })}

      {/* Tier-level read — the one fact that is genuinely per-tier, kept as a
          rollup row rather than a panel that has to stand in for the cells. */}
      <div className="r11-brow rule">
        <div className="r11-slab"><span className="n">Blended margin</span><span className="s">the tier-level read</span></div>
        {rollups.map(q => {
          const cls = marginState(q.margin);
          const below = q.rows.filter((r, si) => cellState(si, q.ti).outstanding).length;
          return (
            <div className="r11-scell flat" key={q.tier.id}>
              <span className={"mg " + cls} style={{ fontSize: 15, fontWeight: 600 }}>{pctS(q.margin)}</span>
              <span className="cost">{below ? below + " cell" + (below === 1 ? "" : "s") + " below floor" : "all cells clear the floor"}</span>
            </div>
          );
        })}
      </div>

      {rollups.some(q => q.rows.some((r, si) => cellState(si, q.ti).outstanding)) && (
        <div className="r11-brow">
          <div className="r11-slab"><span className="n" style={{ fontSize: 12, color: "var(--ink-3)" }}>Correct the tier</span></div>
          {rollups.map(q => {
            const need = skus.map((sk, si) => ({ si, c: cellState(si, q.ti) })).filter(x => x.c.outstanding);
            return (
              <div className="r11-scell flat" key={q.tier.id}>
                {need.length ? (
                  <button className="btn sm" style={{ width: "100%" }} onClick={() => need.forEach(({ si, c }) => onLift(c.key, {
                    pct: c.offer.pct, actor: "Maya Okafor", when: "2026-08-01",
                    note: "Corrective lift — the minimum needed to clear the " + fpct(firm.floor_margin_pct)
                      + " firm margin floor on " + skus[si].code + " at " + q.tier.label + ".",
                  }))}>Lift all {need.length} to floor</button>
                ) : <span className="cost">—</span>}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

// Direction is meaningful (over the benchmark is harder to win) but it is NOT a
// policy state, so it gets its own quiet channel rather than the margin colours.
// Absent target → nothing renders. Nothing is blank because the region does not
// exist for that row.
function Headroom({ sku, sell }) {
  const t = CLIENT_TARGETS[sku.id];
  if (t == null) return null;
  const d = t - sell;
  if (Math.abs(d) < 0.005) return <span className="r12-head level">at client target</span>;
  return (
    <span className={"r12-head " + (d > 0 ? "under" : "over")}>
      {d > 0 ? "▼" : "▲"} {money(Math.abs(d), 2)} vs client
    </span>
  );
}

// The action names its target explicitly — SKU and tier — rather than relying on
// adjacency. A PM about to change a quoted price should never have to infer
// which cell they are changing.                                 ← LOAD-BEARING
function CellAction({ sel, c, onLift, onOverride, onClose }) {
  const { skus, tiers, firm, pct: fpct } = D();
  const sku = skus[sel.si], tier = tiers[sel.ti];
  const name = sku.code + " · " + tier.label;
  return (
    <div className="r11-cellaction">
      <div className="head">
        <span className="who">{name}</span>
        <span className="meta">{sku.name} · {tier.qty.toLocaleString()} units · margin {pctS(c.r.margin)}</span>
        <button className="btn ghost sm" onClick={onClose}>✕</button>
      </div>
      {c.offer.blocked === "override" ? (
        <div className="body blocked">
          <p>
            <strong>{name} has a price override</strong> set by {c.offer.ov.actor} on {c.offer.ov.when.split(" ")[0]}.
            A lift would silently overturn a deliberate decision, so it is rejected rather than applied.
            Remove the override first.
          </p>
          <button className="btn sm ghost">Review override →</button>
        </div>
      ) : c.direct ? (
        <div className="body ok">
          <p>
            <strong>{name} is set directly to {money(c.direct.value, 2)}</strong>{c.isStaged ? " (staged)" : ""} — this replaces the computed
            chain rather than layering over it.
          </p>
          <p className="undo-note">
            Removing it is <strong>not</strong> the same undo as removing a lift. A lift peels off and the cell
            returns to its computed price. Remove this and the cell returns to <strong>whatever the chain computes
            now</strong> — which may not be what it showed before the price was set.
          </p>
          <button className="btn sm" onClick={() => onOverride(c.key, null)}>Remove direct price on {name}</button>
        </div>
      ) : c.applied ? (
        <div className="body ok">
          <p>
            <strong>{name} is lifted {fpct(c.applied.pct)}</strong> — now at the {fpct(firm.floor_margin_pct)} floor.
            Independent of the price adjustment; removing it leaves that untouched, and the cell returns to its
            computed price.
          </p>
          <button className="btn sm" onClick={() => onLift(c.key, null)}>Remove lift on {name}</button>
          <DirectPrice name={name} c={c} onOverride={onOverride} />
        </div>
      ) : (
        <div className="body">
          <p>
            <strong>{name} is at {pctS(c.offer.from)}</strong>, below the {fpct(firm.floor_margin_pct)} firm floor.
            A <strong>{fpct(c.offer.pct)}</strong> lift on {name} alone clears it. No other cell is affected.
          </p>
          <button className="btn primary sm" onClick={() => onLift(c.key, {
            pct: c.offer.pct, actor: "Maya Okafor", when: "2026-08-01",
            note: "Corrective lift — the minimum needed to clear the " + fpct(firm.floor_margin_pct)
              + " firm margin floor on " + name + ". Independent of the global and tier adjustments.",
          })}>Lift {name} to floor</button>
          <DirectPrice name={name} c={c} onOverride={onOverride} />
        </div>
      )}
    </div>
  );
}

// The playground lever: set a cell's price outright. Staged like everything else.
function DirectPrice({ name, c, onOverride }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(c.r.sell.toFixed(2));
  if (!open) {
    return <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setOpen(true)}>Set price directly…</button>;
  }
  return (
    <div className="r12-direct">
      <label className="lbl">Price for {name}</label>
      <input value={val} onChange={e => setVal(e.target.value)} />
      <button className="btn sm" onClick={() => onOverride(c.key, parseFloat(val) || 0)}>Set</button>
      <button className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
      <span className="warn">Replaces the computed chain for this cell.</span>
    </div>
  );
}

// ═══ The cost stack — trace level 1, transposed ══════════
// A lift taken in the compliance grid must be visible WHERE IT LANDS, not only
// where it was taken. While anything is staged the stack shows the delta against
// the last applied state — computed from the same node objects, twice.
function CostStack({ rollups, settled, open, onOpen, flags }) {
  const { tiers } = D();
  const secCount = rollups[0].blended.length;

  const delta = (now, was, unit) => {
    if (was == null || Math.abs(now - was) < 1e-9) return null;
    const d = now - was;
    const txt = unit === "pp" ? (Math.abs(d) * 100).toFixed(1) + "pp" : "$" + Math.abs(d).toFixed(4);
    return <span className={"r12-delta " + (d > 0 ? "up" : "down")}>{(d > 0 ? "+" : "−") + txt}</span>;
  };

  const cell = (q, node, key, qi) => {
    const isOpen = open && open.where === "stack" && open.ti === q.ti && open.key === key;
    const was = settled ? settled[q.ti].blended[qi].value : null;
    return (
      <button key={q.tier.id} className={"r11-scell" + (isOpen ? " open" : "")}
        onClick={() => onOpen(isOpen ? null : { where: "stack", ti: q.ti, key })}>
        <span className="sell">{money(node.value, 4)}</span>
        {delta(node.value, was)}
        <span className="why">{isOpen ? "tracing ▾" : "why? ▸"}</span>
      </button>
    );
  };

  return (
    <div className="r11-stack">
      <div className="r11-srow head">
        <div className="r11-slab"><span className="colhead">Cost stack · blended per unit</span></div>
        {rollups.map(q => (
          <div className="r11-scell flat" key={q.tier.id}>
            <span className="sell" style={{ fontSize: 11, letterSpacing: "0.06em" }}>
              {q.tier.label}{q.tier.recommended && <span style={{ color: "oklch(0.56 0.13 72)" }}> ★</span>}
            </span>
            <span className="cost">{q.tier.qty.toLocaleString()} × {q.rows.length} SKU</span>
          </div>
        ))}
      </div>

      {Array.from({ length: secCount }).map((_, i) => (
        <div className="r11-srow" key={i}>
          <div className="r11-slab">
            <span className="n">{rollups[0].blended[i].label}</span>
            <span className="s">sell per unit</span>
          </div>
          {rollups.map(q => cell(q, q.blended[i], "blend-" + i, i))}
        </div>
      ))}

      <div className="r11-srow rule">
        <div className="r11-slab"><span className="n">Sell before adjustment</span></div>
        {rollups.map(q => (
          <div className="r11-scell flat" key={q.tier.id}><span className="sell">{money(q.sellBefore, 4)}</span></div>
        ))}
      </div>

      <div className="r11-srow">
        <div className="r11-slab">
          <span className="n">Price adjustment</span>
          <span className="s">tier ?? global — replaces</span>
        </div>
        {rollups.map(q => (
          <div className="r11-scell flat" key={q.tier.id}>
            <span className="delta pos">+{money(q.adjDelta, 4)}</span>
            <span className="cost">{pctS(q.adjPct)}</span>
          </div>
        ))}
      </div>

      {rollups.some(q => q.lifts.length > 0) && (
        <div className="r11-srow">
          <div className="r11-slab">
            <span className="n">Surgical lifts</span>
            <span className="s">corrective — one cell each</span>
          </div>
          {rollups.map(q => (
            <div className="r11-scell flat" key={q.tier.id}>
              {q.lifts.length
                ? <span style={{ display: "contents" }}>
                    <span className="delta pos">+{money(q.liftDelta, 4)}</span>
                    <span className="cost">{q.lifts.map(l => l.sku.code).join(", ")}</span>
                  </span>
                : <span className="cost">—</span>}
            </div>
          ))}
        </div>
      )}

      {rollups.some(q => q.overrides.length > 0) && (
        <div className="r11-srow">
          <div className="r11-slab">
            <span className="n">PM overrides</span>
            <span className="s">not derived — a human act</span>
          </div>
          {rollups.map(q => (
            <div className="r11-scell flat" key={q.tier.id}>
              {q.overrides.length
                ? <span style={{ display: "contents" }}>
                    <span className="delta neg">{money(q.overrideDelta, 4)}</span>
                    <span className="cost">{q.overrides.map(o => o.sku.code).join(", ")}</span>
                  </span>
                : <span className="cost">—</span>}
            </div>
          ))}
        </div>
      )}

      <div className="r11-srow total rule">
        <div className="r11-slab"><span className="n">Quoted sell</span><span className="s">per unit, blended</span></div>
        {rollups.map(q => (
          <div className="r11-scell flat" key={q.tier.id}>
            <span className="sell">{money(q.sell, 4)}</span>
            {delta(q.sell, settled ? settled[q.ti].sell : null)}
          </div>
        ))}
      </div>

      <div className="r11-srow">
        <div className="r11-slab"><span className="n">Unit cost</span></div>
        {rollups.map(q => (
          <div className="r11-scell flat" key={q.tier.id}><span className="cost" style={{ fontSize: 12 }}>{money(q.cost, 4)}</span></div>
        ))}
      </div>

      <div className="r11-srow">
        <div className="r11-slab"><span className="n">Margin</span></div>
        {rollups.map(q => (
          <div className="r11-scell flat" key={q.tier.id}>
            <span className={"mg " + marginState(q.margin)}>{pctS(q.margin)}</span>
            {delta(q.margin, settled ? settled[q.ti].margin : null, "pp")}
          </div>
        ))}
      </div>

      <ReconStrip rollups={rollups} />
    </div>
  );
}

function ReconStrip({ rollups }) {
  const bad = rollups.filter(q => Math.abs((q.sellBefore + q.adjDelta + q.liftDelta + q.overrideDelta) - q.sell) > 1e-9);
  return (
    <div className="r11-recon">
      <span>{bad.length === 0 ? "✓" : "✕"}</span>
      <span>
        {bad.length === 0
          ? "every column reconciles — sections + adjustment + lifts + overrides = quoted sell, at all four tiers"
          : `${bad.length} column(s) do NOT reconcile`}
      </span>
    </div>
  );
}

function SkuTrace({ rollups, open, onOpen }) {
  const q = rollups[open.ti];
  const row = q.rows[open.si];
  const bare = open.key.split(":").slice(1).join(":");
  const ov = row.r.root.kind === "override" ? row.r.root : null;
  // Both bases are named. A single unlabelled margin over a superseded chain
  // silently mixes the override basis with the computed one.
  const meta = ov
    ? `${q.tier.qty.toLocaleString()} units · quoted ${money(ov.value, 2)} (PM-set) · margin on quoted ${pctS(row.r.margin)}`
    : `${q.tier.qty.toLocaleString()} units · cost ${money(row.r.totalCost, 4)} · margin ${pctS(row.r.margin)}`;
  return (
    <TraceAt
      root={ov ? ov.superseded : row.r.root}
      supersededBy={ov}
      targetKey={bare}
      title={`${row.sku.code} · ${q.tier.label}`}
      meta={meta}
      onClose={() => onOpen(null)}
      onReroot={k => onOpen(Object.assign({}, open, { key: row.sku.id + ":" + k }))}
    />
  );
}

// ═══ Reference ═══════════════════════════════════════════
function Reference({ rollups }) {
  const best = rollups.reduce((b, q) => ((q.benchmark - q.sell) > (b.benchmark - b.sell) ? q : b), rollups[0]);
  return (
    <div className="r11-panel" style={{ marginTop: 16 }}>
      <div className="r11-phead">
        <span className="t">Reference</span>
        <span className="s">client benchmark · classifies only, never alters price</span>
      </div>
      <div className="r11-ref">
        {rollups.map(q => {
          const head = q.benchmark - q.sell;
          return (
            <div className={"r11-refcell" + (q === best ? " best" : "")} key={q.tier.id}>
              <div className="tl">{q.tier.label}</div>
              <div className={"hv" + (head < 0 ? " neg" : "")}>{money(head, 4)}</div>
              <div className="k">headroom per unit</div>
              <div className="bm">
                benchmark {money(q.benchmark, 4)}<br />
                quoted {money(q.sell, 4)}
              </div>
              {q === best && <span className="tag">most headroom</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══ Page ════════════════════════════════════════════════
function PricingWorkspace({ tweaks }) {
  const R10 = D();
  const flags = {
    allocate_service_fees_to_cost: tweaks.allocate !== false,
    customer_ships_raws: !!tweaks.shipsRaws,
  };
  const [open, setOpen] = useState(null);
  const base = { adj: R10.firm.global_price_adj_pct.pct, lifts: {}, overrides: {} };
  const [committed, setCommitted] = useState(base);
  const [working, setWorking] = useState(base);

  const rollups = computeAgainst(flags, working.adj, working.lifts, working.overrides);
  const settled = computeAgainst(flags, committed.adj, committed.lifts, committed.overrides);
  const ev = evaluateCells(rollups, flags, working.lifts, working.overrides, committed.overrides);
  const verdict = verdictFrom(ev, rollups);

  const changes = [];
  Object.keys(working.lifts).forEach(k => { if (!committed.lifts[k]) changes.push({ kind: "lift", key: k, pct: working.lifts[k].pct }); });
  Object.keys(committed.lifts).forEach(k => { if (!working.lifts[k]) changes.push({ kind: "lift-removed", key: k }); });
  Object.keys(working.overrides).forEach(k => { if (!committed.overrides[k]) changes.push({ kind: "override", key: k, value: working.overrides[k].value }); });
  Object.keys(committed.overrides).forEach(k => { if (!working.overrides[k]) changes.push({ kind: "override-removed", key: k }); });
  if (Math.abs(working.adj - committed.adj) > EPS) changes.push({ kind: "adj", from: committed.adj, to: working.adj });
  const dirty = changes.length > 0;

  const onLift = (key, meta) => setWorking(w => {
    const next = Object.assign({}, w.lifts);
    if (meta) next[key] = meta; else delete next[key];
    return Object.assign({}, w, { lifts: next });
  });
  const onOverride = (key, value) => setWorking(w => {
    const next = Object.assign({}, w.overrides);
    if (value != null) next[key] = { value, actor: R10.project ? "Maya Okafor" : "PM", when: "2026-08-01", note: "Price set directly on this cell." };
    else delete next[key];
    return Object.assign({}, w, { overrides: next });
  });
  const onAdj = pct => setWorking(w => Object.assign({}, w, { adj: pct }));
  const removeAllLifts = () => setWorking(w => Object.assign({}, w, { lifts: {} }));
  const apply = () => setCommitted(working);
  const reset = () => setWorking(committed);

  const label = k => {
    const [skuId, tierId] = k.split(":");
    const sku = R10.skus.find(s => s.id === skuId);
    return (sku ? sku.code : skuId) + " · " + tierId.toUpperCase();
  };
  const describe = ch =>
    ch.kind === "lift" ? "Lift " + label(ch.key) + " " + R10.pct(ch.pct)
    : ch.kind === "lift-removed" ? "Remove lift " + label(ch.key)
    : ch.kind === "override" ? "Set " + label(ch.key) + " to " + money(ch.value, 2)
    : ch.kind === "override-removed" ? "Remove direct price " + label(ch.key)
    : "Global adjustment " + R10.pct(ch.from) + " → " + R10.pct(ch.to);

  // Discard ONE staged change: restore that key to its committed value.
  const unstage = ch => setWorking(w => {
    if (ch.kind === "adj") return Object.assign({}, w, { adj: committed.adj });
    const bucket = ch.kind.startsWith("lift") ? "lifts" : "overrides";
    const next = Object.assign({}, w[bucket]);
    if (committed[bucket][ch.key]) next[ch.key] = committed[bucket][ch.key];
    else delete next[ch.key];
    return Object.assign({}, w, { [bucket]: next });
  });

  // After Apply: return to the computed baseline in one act. Safe because every
  // pricing adjustment is an additive layer over a base that does not move.
  const appliedCount = Object.keys(committed.lifts).length + Object.keys(committed.overrides).length
    + (Math.abs(committed.adj - base.adj) > EPS ? 1 : 0);
  const toBaseline = () => { setWorking(base); setCommitted(base); };

  return (
    <div className="r10-shell">
      <div className="r10-topbar">
        <div className="r10-crumb">
          <span className="dim">{R10.project.client} · {R10.project.deal} · {R10.project.scenario} · </span>
          <strong>Pricing</strong>
          <span className="dim"> · {R10.project.quote_number}</span>
        </div>
        <div className="r10-topbar-right">
          <span className={"r10-flag" + (flags.allocate_service_fees_to_cost ? " on" : "")}>
            allocate service fees · {flags.allocate_service_fees_to_cost ? "on" : "off"}
          </span>
          <span className={"r10-flag" + (flags.customer_ships_raws ? " on" : "")}>
            customer ships raws · {flags.customer_ships_raws ? "on" : "off"}
          </span>
        </div>
      </div>

      {dirty && (
        <div className="r12-staging">
          <div className="left">
            <span className="k">Staged · not yet applied</span>
            <span className="v">
              Nothing is written until you apply. Leaving the page discards these.
            </span>
            <div className="chips">
              {changes.map(ch => (
                <span className="r12-chip" key={ch.kind + ch.key}>
                  {describe(ch)}
                  <button onClick={() => unstage(ch)} title="Discard this change">✕</button>
                </span>
              ))}
            </div>
          </div>
          <div className="acts">
            <button className="btn ghost sm" onClick={reset}>Reset all</button>
            <button className="btn primary" onClick={apply}>
              Apply {changes.length} change{changes.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}

      {!dirty && appliedCount > 0 && (
        <div className="r12-staging applied">
          <div className="left">
            <span className="k">Applied</span>
            <span className="v">
              {appliedCount} pricing adjustment{appliedCount === 1 ? "" : "s"} in effect. Each is an additive layer
              over a computed base that has not moved — remove them and the quote returns exactly to where it started.
            </span>
          </div>
          <div className="acts">
            <button className="btn ghost sm" onClick={toBaseline}>Return to computed baseline</button>
          </div>
        </div>
      )}

      <div className="r10-body r11-page">
        <SummaryBanner verdict={verdict} ev={ev} rollups={rollups}
          onGoToGrid={() => { const g = document.querySelector(".r12-gridtop"); if (g) g.scrollIntoView({ behavior: "smooth", block: "start" }); }} />

        <div className="r12-gridtop">
          <p className="r10-sub" style={{ marginBottom: 10 }}>
            Pricing detail — compliance and composition across every tier, always open. Any number can say why it
            is what it is, and the trace opens where you pressed.
          </p>
        </div>

        
        <ComplianceGrid rollups={rollups} ev={ev} flags={flags} lifts={working.lifts}
          onLift={onLift} onOverride={onOverride}
          open={open} onOpen={setOpen} />

        <AdjustmentPanel flags={flags} adj={working.adj} onAdj={onAdj}
          committedAdj={committed.adj} lifts={working.lifts} removeAllLifts={removeAllLifts} />

        <div style={{ marginTop: 16 }}>
          <CostStack rollups={rollups} settled={dirty ? settled : null}
            open={open} onOpen={setOpen} flags={flags} />
        </div>

        {open && open.where === "stack" && (
          <StackTrace rollups={rollups} open={open} onOpen={setOpen} />
        )}


        <div className="r10-dn">
          <div className="dn-eyebrow">DN · one contract, two projections</div>
          The cost-stack rows are <strong>trace level 1, transposed</strong> — the same node objects R10 computed,
          read across tiers instead of down one. Breadth at fixed depth; depth at fixed breadth. Press any stack
          cell and the trace opens <em>at that node</em>, with the levels above it in the breadcrumb rather than in
          your way. Blending across SKUs produced a ninth node kind, <code>blend</code> — a weighted mean, which is
          neither a sum nor a tree, and which the contract absorbed without an exception.
        </div>
      </div>
    </div>
  );
}

function StackTrace({ rollups, open, onOpen }) {
  const q = rollups[open.ti];
  const synthetic = D().node({
    key: "blended-root",
    kind: "sum",
    label: "Sell before adjustment · blended",
    value: q.sellBefore,
    op: q.blended.map(b => D().m4(b.value)).join("  +  "),
    operands: q.blended,
  });
  // Everything the quoted price carries that this chain does not.
  const carries = [pctS(q.adjPct) + " price adjustment"];
  if (q.lifts.length) {
    carries.push(
      (q.lifts.length === 1 ? "one surgical lift" : q.lifts.length + " surgical lifts")
      + " (" + q.lifts.map(l => l.sku.code).join(", ") + ")"
    );
  }
  if (q.overrides.length) {
    carries.push(
      (q.overrides.length === 1 ? "one PM-set cell" : q.overrides.length + " PM-set cells")
      + " (" + q.overrides.map(o => o.sku.code).join(", ") + ")"
    );
  }
  const scope = (
    <span>
      This chain explains <strong>sell before adjustment ({money(q.sellBefore, 4)})</strong>. The quoted
      blended price ({money(q.sell, 4)}) also carries {joinClauses(carries)} —
      {carries.length > 1 ? " those are rows" : " that is a row"} in the stack above.
    </span>
  );
  return (
    <TraceAt
      root={synthetic}
      scopeNote={scope}
      targetKey={open.key}
      title={`${q.tier.label} · blended`}
      meta={`${q.totalUnits.toLocaleString()} units across ${q.rows.length} SKUs · margin on quoted ${pctS(q.margin)}`}
      onClose={() => onOpen(null)}
      onReroot={k => onOpen(Object.assign({}, open, { key: k }))}
    />
  );
}

Object.assign(window, { PricingWorkspace, TraceAt, CostStack, AdjustmentPanel, ComplianceGrid, CellAction, Reference });
