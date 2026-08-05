/* global React, NXR10 */
// Nexus Round 10 — Pricing traceability
// Progressive commercial traceability, applied at the hardest node.
//
// This file is PRESENTATION ONLY. Every number and every trace node comes from
// app/r10/data.js, which computes the chain rather than storing it. That split
// is the "contract, not component" argument made concrete: the same contract
// could be delivered as a side panel or a PDF readout without touching data.js.

const { useState } = React;
const D = () => window.NXR10;

const money = (v, dp = 2) => "$" + v.toFixed(dp);
const pctS = (p) => (p * 100).toFixed(Math.abs(p * 100 % 1) < 0.001 ? 0 : 1) + "%";

const KIND_LABEL = {
  sum: "sum", markup: "cost × markup", allocation: "allocation", rate: "rate",
  adjustment: "adjustment", resolution: "resolution", origin: "origin",
  override: "human act", "flagged-out": "not in chain",
};

// Does this node have anywhere further to go?
const expandable = (n) => (n.operands && n.operands.length > 0) || !!n.origin || !!n.candidates || !!n.chosen;

function valueOf(n) {
  if (n.unit === "markup" || n.unit === "adjustment" || n.unit === "rate") return pctS(n.value);
  if (n.unit && n.unit !== "per unit") return "$" + n.value.toLocaleString();
  return money(n.value, 4);
}

// ─── Terminal: a human act ───────────────────────────────
// Two grades of terminal. Actor + timestamp exist for every commercial mutation;
// a source document exists only for packaging (vendor + free-text note). The thin
// grade is NOT rendered as deficient — "who set this and when" is a complete answer
// to the stopping rule. It simply has nothing further to offer. See notes §11.1.
function Origin({ origin, stop }) {
  const sourced = !!origin.vendor;
  const stopLine = stop || (sourced
    ? "end of chain · entered from a supplier source"
    : "end of chain · a person set this figure; no source document is recorded");
  return (
    <div className={"r10-origin" + (sourced ? " sourced" : "")}>
      <span className="seal">✎</span>
      <div className="body">
        <div className="who">{origin.actor}</div>
        <div className="when">{origin.when}</div>
        {origin.vendor && <span className="doc">{origin.vendor}</span>}
        {origin.note && <div className="onote">{origin.note}</div>}
        <span className="stop">{stopLine}</span>
      </div>
    </div>
  );
}

// ─── Resolution: a choice, with its losing candidates ────
function Resolution({ node }) {
  const cands = node.candidates;
  if (!cands) {
    return (
      <div>
        <div className="r10-res">
          <div className="r10-res-row won">
            <span className="mark">●</span>
            <span className="lvl">{node.chosen.level}</span>
            <span className="pv">{pctS(node.chosen.pct)}</span>
          </div>
        </div>
        {node.chosen.origin && <Origin origin={node.chosen.origin} stop="end of chain · a firm setting is a human decision" />}
      </div>
    );
  }
  let won = false;
  return (
    <div>
      <div className="r10-res">
        {cands.map((c, i) => {
          const isWinner = !won && c.available && c.pct != null;
          if (isWinner) won = true;
          const cls = isWinner ? "won" : c.available && c.pct != null ? "" : "absent";
          return (
            <div className={"r10-res-row " + cls} key={i}>
              <span className="mark">{isWinner ? "●" : c.available ? "○" : "✕"}</span>
              <span className="lvl">{c.level}</span>
              <span className="pv">{c.pct != null ? pctS(c.pct) : "not set"}</span>
              {c.absent_note && <span className="why">{c.absent_note}</span>}
            </div>
          );
        })}
      </div>
      {node.chosen && node.chosen.origin && (
        <Origin origin={node.chosen.origin} stop="end of chain · a firm setting is a human decision" />
      )}
    </div>
  );
}

// ─── Reconciliation assertion ────────────────────────────
// The property R6's fixture could not have asserted: operands reproduce parent.
function Recon({ node }) {
  if (!node.operands.length) return null;
  // A blend is a weighted mean, so its operands average to the parent rather than
  // summing to it. Same assertion, different operation — load-bearing item 5 applies
  // to every arithmetic node kind, not only sums.
  const isBlend = node.kind === "blend";
  if (node.kind !== "sum" && !isBlend) return null;
  const total = node.operands.reduce((a, o) => a + o.value, 0);
  const derived = isBlend ? total / node.operands.length : total;
  const ok = Math.abs(derived - node.value) < 1e-9;
  return (
    <div className="r10-recon">
      {ok ? <span>✓</span> : <span className="x">✕</span>}
      <span>
        {node.operands.length} operands {isBlend ? "average" : "sum"} to {money(derived, 4)}
        {ok ? " — reconciles exactly" : ` — does NOT reconcile with ${money(node.value, 4)}`}
      </span>
    </div>
  );
}

// ─── One level of the trace ──────────────────────────────
function Level({ node, depth, path, openPath, onToggle }) {
  const isOpenChild = (k) => openPath[depth + 1] === k;
  const openChild = node.operands.find(o => isOpenChild(o.key));

  return (
    <div className="r10-level">
      <div className="r10-lhead">
        <span className="depth">{depth === 0 ? "the number" : "level " + depth}</span>
        <span className="what">{node.label}</span>
        <span className="val">
          {valueOf(node)} <span className="unit">{node.unit}</span>
        </span>
      </div>

      {/* THE OPERATION — why the number is what it is */}
      {node.op && (
        <div className="r10-op">
          <span className="eq">=</span>
          <span className="expr">{node.op}</span>
          <span className="kindtag">{KIND_LABEL[node.kind] || node.kind}</span>
        </div>
      )}

      {node.note && <p className={"r10-note" + (node.note.startsWith("⚠") ? " warn" : "")}>{node.note}</p>}

      {node.kind === "flagged-out" && (
        <div className="r10-flagged">
          <strong>Not part of this price.</strong> {node.note}
        </div>
      )}

      {(node.candidates || node.chosen) && <Resolution node={node} />}

      {node.origin && !node.candidates && !node.chosen && <Origin origin={node.origin} />}

      {node.operands.length > 0 && (
        <div>
          <div className="r10-operands">
            {node.operands.map(o => {
              const can = expandable(o);
              const open = isOpenChild(o.key);
              return (
                <button key={o.key}
                  className={"r10-operand" + (can ? "" : " leaf")}
                  onClick={can ? () => onToggle(depth + 1, open ? null : o.key) : undefined}>
                  <span className="chev">{can ? (open ? "▾" : "▸") : "·"}</span>
                  <span className="oname">{o.label}</span>
                  {!can && <span className="otag">flat</span>}
                  <span className="oval">{valueOf(o)}</span>
                </button>
              );
            })}
          </div>
          <Recon node={node} />
        </div>
      )}

      {openChild && (
        <div className={"r10-nest d" + Math.min(depth + 1, 4)}>
          <Level node={openChild} depth={depth + 1} path={path.concat(openChild.key)}
            openPath={openPath} onToggle={onToggle} />
        </div>
      )}
    </div>
  );
}

// ─── The trace panel ─────────────────────────────────────
function Trace({ sku, tier, result, onClose }) {
  // openPath[d] = key of the operand opened at depth d. One chain at a time.
  const [openPath, setOpenPath] = useState({});
  const toggle = (depth, key) => setOpenPath(prev => {
    const next = {};
    for (const d of Object.keys(prev)) if (Number(d) < depth) next[d] = prev[d];
    if (key) next[depth] = key;
    return next;
  });

  const root = result.root;
  const isOverride = root.kind === "override";

  return (
    <div className="r10-trace">
      <div className="r10-anchor">
        <span className="q">
          Why is <em>{sku.code} · {tier.label}</em> {money(result.sell, 4)}?
        </span>
        <span className="meta">
          {tier.qty.toLocaleString()} units · cost {money(result.totalCost, 4)} · margin {pctS(result.margin)}
        </span>
        <span className="acts">
          <button className="btn ghost sm" onClick={() => setOpenPath({})}>Collapse chain</button>
          <button className="btn ghost sm" onClick={onClose}>✕ Close</button>
        </span>
      </div>

      <div className="r10-levels">
        {isOverride ? (
          <div>
            <div className="r10-override">
              <div className="lead">This price was set by a person, not calculated.</div>
              <div className="sub">
                {money(root.value, 2)} was entered directly. It replaces the computed chain entirely — tier and
                global adjustments no longer affect this cell, and revenue, margin, the customer preview, the PDF
                and NetSuite all use this figure.
              </div>
              <div className="nochain"><span>⊘</span> no arithmetic above this point</div>
            </div>
            <Origin origin={root.origin} stop="end of chain · the price is this because someone decided it" />
            <div className="r10-superseded">
              <span className="cap">superseded — what the chain would have produced</span>
              <Level node={root.superseded} depth={0} path={[]} openPath={openPath} onToggle={toggle} />
            </div>
          </div>
        ) : (
          <Level node={root} depth={0} path={[]} openPath={openPath} onToggle={toggle} />
        )}
      </div>
    </div>
  );
}

// ─── The pricing grid ────────────────────────────────────
function PricingGrid({ flags }) {
  const { skus, tiers, compute, marginClass } = D();
  const [open, setOpen] = useState({ sku: "s1", tier: 1 });

  return (
    <div className="r10-grid">
      <div className="r10-row head">
        <div className="r10-hcell"><div className="colhead">Product</div></div>
        {tiers.map(t => (
          <div className="r10-hcell tier" key={t.id}>
            <div className="tlab">{t.label}{t.recommended && <span className="rec"> ★</span>}</div>
            <div className="tqty">{t.qty.toLocaleString()} units</div>
          </div>
        ))}
      </div>

      {skus.map(sku => {
        const results = tiers.map((_, ti) => compute(sku, ti, flags));
        const isOpenRow = open && open.sku === sku.id;
        return (
          <div key={sku.id} style={{ display: "contents" }}>
            <div className="r10-row">
              <div className="r10-skucell">
                <div className="name">{sku.name}</div>
                <div className="meta"><span className="code">{sku.code}</span> · {sku.pack}</div>
              </div>
              {tiers.map((t, ti) => {
                const r = results[ti];
                const isOpen = isOpenRow && open.tier === ti;
                return (
                  <button key={t.id} className={"r10-cell" + (isOpen ? " open" : "")}
                    onClick={() => setOpen(isOpen ? null : { sku: sku.id, tier: ti })}>
                    <span className="price">{money(r.sell, 2)}</span>
                    <span className={"margin " + marginClass(r.margin)}>{pctS(r.margin)} margin</span>
                    {r.overridden && <span className="ovtag">set by PM</span>}
                    <span className="why">{isOpen ? "tracing ▾" : "why? ▸"}</span>
                  </button>
                );
              })}
            </div>
            {isOpenRow && (
              <div className="r10-row" style={{ display: "block" }}>
                <Trace sku={sku} tier={tiers[open.tier]} result={results[open.tier]}
                  onClose={() => setOpen(null)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Host ────────────────────────────────────────────────
function PricingTracePage({ tweaks, setTweak }) {
  const { project } = D();
  const flags = {
    allocate_service_fees_to_cost: tweaks.allocate !== false,
    customer_ships_raws: !!tweaks.shipsRaws,
  };

  return (
    <div className="r10-shell">
      <div className="r10-topbar">
        <div className="r10-crumb">
          <span className="dim">{project.client} · {project.deal} · {project.scenario} · </span>
          <strong>Pricing</strong>
          <span className="dim"> · {project.quote_number}</span>
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

      <div className="r10-body">
        <h1 className="r10-h1">Pricing — <em>every number can say why</em></h1>
        <p className="r10-sub">
          Per-unit sell price by tier. The price and its margin are on the face of the grid, because that is what
          the routine decision needs. Anything further is one click away and never leaves this page.
        </p>

        <PricingGrid flags={flags} />

        <div className="r10-dn">
          <div className="dn-eyebrow">DN · operation, not breakdown</div>
          Each level shows <strong>how</strong> its number was produced, then its operands — never operands alone.
          That distinction is the whole design: a list of children answers "what is this made of", but the operator
          asked "why is it what it is", and the answer lives in the operations — markup, allocation, rate,
          resolution. Expand <code>GLW-30 · T2 → Production</code> to reach the hardest node, where one aggregate
          markup covers filling, assembly and allocated services together. Expand <code>GLW-50 · T2</code> to see a
          chain that terminates in a person instead of arithmetic.
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PricingTracePage, PricingGrid, Trace, Level, Origin, Resolution });
