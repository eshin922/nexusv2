/* global React, NXR2 */

// ─── Data-source map ──────────────────────────────────
// Per the brief: every UI element traced to (existing | named slice | backlog | wishful).
// Color-coded so it's grepable on screen.

const SRC = {
  EX:  { label: "EXISTING",   tone: "var(--ink-2)",   bg: "var(--paper-3)" },
  S91: { label: "SLICE 9.1",  tone: "var(--accent)",  bg: "var(--accent-soft)" },
  S92: { label: "SLICE 9.2",  tone: "var(--accent)",  bg: "var(--accent-soft)" },
  S93: { label: "SLICE 9.3",  tone: "var(--accent)",  bg: "var(--accent-soft)" },
  S94: { label: "SLICE 9.4",  tone: "var(--accent)",  bg: "var(--accent-soft)" },
  S95: { label: "SLICE 9.5",  tone: "var(--accent)",  bg: "var(--accent-soft)" },
  BL:  { label: "BACKLOG",    tone: "var(--warn)",    bg: "var(--warn-soft)" },
  WI:  { label: "WISHFUL",    tone: "var(--wishful)", bg: "var(--paper-3)" },
};

function Tag({ k, note }) {
  const s = SRC[k];
  return (
    <span style={{
      fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.08em",
      padding: "2px 6px", borderRadius: 3,
      background: s.bg, color: s.tone, border: `1px solid ${s.tone}`,
      whiteSpace: "nowrap",
    }} title={note || ""}>{s.label}</span>
  );
}

function Row({ ui, src, field, note }) {
  return (
    <tr>
      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--rule)", verticalAlign: "top", width: "32%" }}>
        <div style={{ fontSize: 13, color: "var(--ink)" }}>{ui}</div>
      </td>
      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--rule)", verticalAlign: "top", width: "12%" }}>
        <Tag k={src} />
      </td>
      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--rule)", verticalAlign: "top", width: "30%" }}>
        <code style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--accent-ink)" }}>{field}</code>
      </td>
      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--rule)", verticalAlign: "top", color: "var(--ink-3)", fontSize: 11.5, lineHeight: 1.5 }}>
        {note}
      </td>
    </tr>
  );
}

function Group({ title, count, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
        <h3 style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 400, letterSpacing: "-0.01em", margin: 0, color: "var(--ink)" }}>
          {title}
        </h3>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{count} elements</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid var(--rule)", borderRadius: 6, overflow: "hidden" }}>
        <thead>
          <tr style={{ background: "var(--paper-2)" }}>
            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 9.5, fontFamily: "var(--mono)", letterSpacing: "0.08em", color: "var(--ink-4)", textTransform: "uppercase", fontWeight: 500 }}>UI element</th>
            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 9.5, fontFamily: "var(--mono)", letterSpacing: "0.08em", color: "var(--ink-4)", textTransform: "uppercase", fontWeight: 500 }}>Source</th>
            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 9.5, fontFamily: "var(--mono)", letterSpacing: "0.08em", color: "var(--ink-4)", textTransform: "uppercase", fontWeight: 500 }}>Schema field / origin</th>
            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 9.5, fontFamily: "var(--mono)", letterSpacing: "0.08em", color: "var(--ink-4)", textTransform: "uppercase", fontWeight: 500 }}>Note</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function DataMap() {
  return (
    <div className="page" style={{ maxWidth: 1100 }} data-screen-label="Data-source map">
      <div className="page-head">
        <div>
          <p className="eyebrow">Round 2 deliverable · data provenance</p>
          <h1 className="page-title">Where every <em>pixel's</em> data comes from</h1>
          <p className="page-sub">
            Every visible field maps back to either schema you've already built, a named upcoming slice (9.1–9.5),
            something in the backlog, or — flagged honestly — pure design wishfulness. If it's not on this list, I drew it from nothing and you should ask.
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="card" style={{ padding: "14px 18px", marginBottom: 20 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Legend</p>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
          <div className="row gap-2"><Tag k="EX" /><span style={{ fontSize: 12, color: "var(--ink-3)" }}>schema/code already shipped</span></div>
          <div className="row gap-2"><Tag k="S91" /><span style={{ fontSize: 12, color: "var(--ink-3)" }}>scoped slice you'll build</span></div>
          <div className="row gap-2"><Tag k="BL" /><span style={{ fontSize: 12, color: "var(--ink-3)" }}>in the backlog, not committed to a slice</span></div>
          <div className="row gap-2"><Tag k="WI" /><span style={{ fontSize: 12, color: "var(--ink-3)" }}>design assumption — needs your sign-off</span></div>
        </div>
      </div>

      {/* COST BUILD */}
      <Group title="Cost Build · screen" count="22">
        <Row ui="SKU label, name, pack" src="EX" field="quote_skus.label, .name, .pack" note="Schema as you've defined it." />
        <Row ui="Tier label, quantity" src="EX" field="quote_tiers.label, .quantity" note="Schema." />
        <Row ui="Tier · client target price chip" src="S91" field="quote_tiers.client_target_price_per_unit" note="Defined in 9.1, displayed here as small caption under each tier card." />
        <Row ui="Cost groups (Pkg / Prod / Frt)" src="EX" field="packaging_inputs / production_inputs / freight_inputs" note="Three tables → three groups. Direct mapping." />
        <Row ui="Per-row markup % chip" src="EX" field="<table>_inputs.markup_pct + .markup_pct_source" note="Override dot fired off markup_pct_source === 'override'." />
        <Row ui="'+5%' override marker (•)" src="EX" field="markup_pct_source = 'override'" note="Visible signal for the overridden case (vs category default). Tooltip hints at the source field." />
        <Row ui="Allocated-fee meta line ('$5,250 ÷ 25k')" src="WI" field="(none — display-only string in mock)" note="Real implementation needs an allocation_source field on production_inputs OR a sibling table. Flagged: I'm displaying provenance the schema doesn't capture yet." />
        <Row ui="Owner badge ('owned by Purchasing')" src="BL" field="users.role + (assignment rule, TBD)" note="Backlog: who-owns-which-cost-group. Maps cleanly to user roles you have." />
        <Row ui="Cost cell value + empty 'awaiting input'" src="EX" field="<table>_inputs.unit_cost (NULL = empty)" note="NULL is the empty signal. Already in the schema." />
        <Row ui="Freight 'bundled vs pass-through' meta line" src="EX" field="freight_inputs.freight_treatment" note="One of two enums per CLAUDE.md." />
        <Row ui="Internal zone — duty + tariff" src="EX" field="quote_skus.duty_pct, .tariff_pct" note="Live on the SKU per CLAUDE.md ('NEVER customer-facing'). Visual ribbon enforces the never-leak rule." />
        <Row ui="Internal zone — CBM" src="EX" field="freight_inputs.sku_total_cbm" note="Internal-only field; allocates container costs. Same zone." />
        <Row ui="Internal zone — landed freight w/ markup" src="EX" field="lib/costing.ts → freight roll-up" note="Computed per the documented formula: (containerFrt + duty + tariff) × (1 + markup)." />
        <Row ui="Cost stack (Pkg|Prod|Frt|Customs|Markup|Adj)" src="EX" field="all of the above, summed" note="Visualization of contribution → required sell. Pure presentation; no new fields." />
        <Row ui="Required sell · per unit" src="EX" field="lib/costing.ts → required_sell" note="Documented formula." />
        <Row ui="Margin verdict + range" src="EX" field="firm_settings.target_margin_pct, .floor_margin_pct" note="Versioned firm settings; threshold colors keyed to those." />
        <Row ui="Tier comparison rail (mini margin meters)" src="EX" field="tierMath() over each tier_id" note="Per-tier compute already implied by your tier-math. UI synthesis." />
        <Row ui="'Live · 2 here' presence chip" src="BL" field="(realtime presence — backlog)" note="Marked BACKLOG in the UI as a chip. Design assumes it ships eventually; flow works without it." />
        <Row ui="'Demo · focus aluminum collar' button" src="WI" field="(deep-link semantics — design intent only)" note="Stands in for: '/quote/Q.../build?focus=pkg-row-id'. URL contract not specified yet — flagged wishful." />
        <Row ui="'Fresh' dot on rows updated since last visit" src="BL" field="audit_log.updated_at + viewer.last_seen_at" note="Backlog: per-row 'changed since X' diff. Not in any named slice." />
        <Row ui="'Read-only' badge for non-owner roles" src="BL" field="users.role + write-permission rule" note="Backlog: role-based field permissions. Design degrades gracefully if everyone can edit everything." />
        <Row ui="Day 1 / Day 4 / Day 6 stage helper text" src="WI" field="(none — design narrative)" note="The states are real (NULL counts in the data drive them); the helper sentence is design copy I picked." />
      </Group>

      {/* COSTING SHEET */}
      <Group title="Costing Sheet · screen" count="20">
        <Row ui="Blended margin · big number" src="EX" field="avg(margin) over (sku × tier) cells" note="Computed from existing fields." />
        <Row ui="Quote target override chip" src="S92" field="quotes.target_margin_pct (NULL → fall back to firm_settings)" note="9.2 line item. Surfaced as a chip when set; absent when null." />
        <Row ui="Global price adjustment slider" src="EX" field="quotes.global_price_adj_pct" note="Already in the schema." />
        <Row ui="System suggestion ('+8.5%') + Apply button" src="WI" field="(optimization — design only)" note="Computed live in the prototype by sweeping GPA. The suggestion math itself isn't a backlog item — proposing it as one." />
        <Row ui="Per-tier override slider + ↺ inherit" src="S92" field="quote_tiers.tier_price_adj_pct (NULL → inherit)" note="9.2 line item; UI exposes the NULL semantic via the inherit button." />
        <Row ui="Per-cell sell override (the 'OVR' badge)" src="S93" field="quote_sku_tiers.sell_price_override (NULL = computed)" note="9.3 — but pushed back: NOT a global mode toggle, a per-cell escape hatch. See notes." />
        <Row ui="↺ Revert override button" src="S93" field="setting sell_price_override = NULL" note="Same field, NULL signals 'use computed'." />
        <Row ui="Two-axis verdict pill (margin · client)" src="S94" field="margin_pct vs floor + sell vs client_target_price_per_unit" note="9.4 calls for client benchmarking; this surfaces both axes side-by-side." />
        <Row ui="'COMPETITIVE / OVER CLIENT TARGET / NO TARGET'" src="S94" field="derived from client_target_price_per_unit comparison" note="Three states; NO TARGET when the field is NULL on that tier." />
        <Row ui="'→ match target' inline action" src="S94" field="writes sell_price_override = client_target_price_per_unit" note="Composes 9.3 + 9.4. Cheap to ship once both lands." />
        <Row ui="'gap: $0.42' caption" src="S94" field="sell - client_target_price_per_unit" note="Pure derivation." />
        <Row ui="Lines requiring review · panel" src="S95" field="quote_warnings (filtered to severity='high')" note="9.5 explicitly defines this table. UI groups + sorts." />
        <Row ui="Warning row metadata (quote, tier, message)" src="S95" field="quote_warnings.* (sku/tier/message/severity)" note="Direct field mapping." />
        <Row ui="'Most headroom' card" src="EX" field="argmax(margin) over cells" note="Derived presentation." />
        <Row ui="'Headroom: 3.2pp above target' caption" src="EX" field="margin - target_margin_pct" note="Pure derivation." />
        <Row ui="Per-SKU breakdown card · margin number" src="EX" field="lib/costing.ts → margin_pct per (sku, tier)" note="Existing computation." />
        <Row ui="All-tiers sparkline (4 mini meters)" src="EX" field="tierMath() across all 4 tiers" note="Just visualization." />
        <Row ui="'UNDERPRICED' SKU badge" src="EX" field="margin &lt; floor_margin_pct" note="Threshold from firm_settings." />
        <Row ui="Mark Accepted (locked w/ admin override)" src="BL" field="quotes.status enum + acceptance gate rule" note="The schema for accepted/sent statuses isn't in the slices I've seen. Marked BACKLOG. UI shows the gated state regardless." />
        <Row ui="Preview customer quote button" src="BL" field="(routes to customer-view — Round 3)" note="Out of round-2 scope; affordance present." />
      </Group>

      {/* SHELL / CHROME */}
      <Group title="Shell · chrome" count="6">
        <Row ui="Sidebar nav" src="EX" field="(routing only — no DB)" note="Pure UI." />
        <Row ui="Breadcrumbs" src="EX" field="projects.client + quotes.version_number" note="Already in schema." />
        <Row ui="Top-bar presence chip" src="BL" field="realtime presence" note="Same as Cost Build presence — flagged backlog in chip itself." />
        <Row ui="⌘K affordance" src="BL" field="(global search — no slice yet)" note="Sketched as a button only; full search is a separate effort." />
        <Row ui="User avatar bottom of sidebar" src="EX" field="users.name, .initials, .role" note="Schema." />
        <Row ui="Tweaks panel (theme, scenario, viewer)" src="WI" field="(prototype-only)" note="Demo controls — not part of the product." />
      </Group>

      {/* THE HONEST FOOTER */}
      <div className="card" style={{ padding: "16px 20px", marginTop: 32, borderLeft: "3px solid var(--wishful)" }}>
        <p className="eyebrow" style={{ marginBottom: 6, color: "var(--wishful)" }}>The honest count</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 8 }}>
          {[
            { k: "EX", n: 27, sub: "of 48 elements" },
            { k: "S91", n: 11, sub: "across slices 9.1–9.5" },
            { k: "BL", n: 7, sub: "named & ready to scope" },
            { k: "WI", n: 3, sub: "design-only · need sign-off" },
          ].map(c => (
            <div key={c.k}>
              <Tag k={c.k} />
              <div style={{ fontFamily: "var(--display)", fontSize: 32, marginTop: 8, letterSpacing: "-0.02em" }}>{c.n}</div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)", marginTop: 2 }}>{c.sub}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 14, lineHeight: 1.55 }}>
          Three wishful elements: the allocated-fee provenance string, the deep-link URL contract, and the system-suggested GPA computation.
          Of those, the GPA suggestion is the one I'd actually push to scope — it's a one-day add and changes how the costing sheet feels.
        </p>
      </div>
    </div>
  );
}

window.DataMap = DataMap;
