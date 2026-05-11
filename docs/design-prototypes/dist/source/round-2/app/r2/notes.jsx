/* global React */

function R2Notes() {
  return (
    <div className="page" style={{ maxWidth: 920 }} data-screen-label="Designer notes · Round 2">
      <div className="page-head">
        <div>
          <p className="eyebrow">Round 2 · designer notes</p>
          <h1 className="page-title">Three pushbacks, the structure I carried <em>forward</em>, and what I almost shipped instead</h1>
          <p className="page-sub">
            Round 2 went deep on Cost Build and Costing Sheet. Everything else (Project, Quote setup, Customer view, Mark Accepted) is explicitly out of scope and waiting for Round 3+.
          </p>
        </div>
      </div>

      <Section eyebrow="Round 2 sign-off" title="Three wishful items confirmed in scope, plus presence committed">
        <p>
          Per CD review, the three items I flagged as wishful in the data-source map are now committed:
        </p>
        <ul>
          <li><strong>System-suggested GPA computation</strong> ships with Slice 9.2. The "system suggests +X% to land blended at target" affordance on the Costing Sheet stops being a prototype trick and becomes part of the slice.</li>
          <li><strong>Deep-link URL contract</strong> ships as part of the redesign or Slice 13.5. The "Demo · focus aluminum collar" button on Cost Build represents the intended behavior — notification emails and audit-log links land in a focused cell.</li>
          <li><strong>Allocated-fee provenance</strong> logged for Slice 13.5. Production_inputs gets an allocation_source field (or sibling table) so the "$5,250 setup ÷ 25k units" caption is data-backed, not display-only.</li>
        </ul>
        <p style={{ marginTop: 14 }}>
          And separately confirmed:
        </p>
        <ul>
          <li><strong>Multi-user presence is committed, not wishful.</strong> The "Live · X here" panel on Project view and the per-section presence chips on Cost Build (e.g. "Wei viewing freight · 4m") are committed product, not visual fiction. Build slice: a per-quote presence channel, throttled to ~5s updates, surfaced as the avatar cluster + per-user current-section indicator. Lives in the redesign-implementation slice, or earlier if the design ships ahead of it.</li>
        </ul>

        <h4>Round 3 scope</h4>
        <p><strong>Customer-facing quote view + Mark-Accepted flow.</strong> Constraint per CD: <strong>Option A — PM-internal preview surface that becomes the PDF.</strong> No hosted customer-facing web surface in this round.</p>
        <p style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 8 }}>
          Reasoning behind the call: today's Excel flow ends in PDF; send-PDF-get-reply is the familiar customer pattern; a hosted link adds auth, telemetry, and link-rot complexity for marginal gain. Reversible — if Slice 17 user testing surfaces real customer demand for a hosted view, we add it then.
        </p>
        <p>Design constraint that follows from Option A:</p>
        <ul>
          <li><strong>The PM previews exactly what the PDF will be.</strong> No interactive elements in the preview surface, no live data feeds, no hover affordances that won't print. Print-preview metaphor, not hosted-page metaphor.</li>
          <li><strong>Mark Accepted is an internal action against the PDF that was sent.</strong> No customer-side interactivity to design — acceptance comes back via email/Slack/HubSpot and the PM logs it.</li>
        </ul>
        <p style={{ marginTop: 14 }}>The four standing structural carries-forward apply:</p>
        <ul>
          <li><strong>NULL-as-empty-signal</strong> across the customer view too — pricing tables show "—" for tiers that don't apply, never $0.00.</li>
          <li><strong>Internal-vs-customer visual grammar</strong> enforced as a guard: if the customs/duty/CBM zone ever renders in the customer-view component tree, that's a build-time bug.</li>
          <li><strong>Helper text, not narration</strong> — the customer view should describe nothing; it should price.</li>
          <li><strong>Verdict-as-room-organizer, flipped</strong> — the customer view's room is the unit price + tier table, not the margin. Same compositional move, different anchor.</li>
        </ul>
      </Section>

      <Section eyebrow="Round 2.5 close-out · multi-tier mechanics" title="Sparkline vocabulary, NULL discipline, and one new feature commitment">
        <p>
          Standalone addendum file (<code>Nexus Round 2.5.html</code>) — kept separate from the Round 2 main file because the sparkline vocabulary and per-row drawer pattern are reusable enough across surfaces that they earn their own home for future reference.
        </p>
        <p style={{ marginTop: 14 }}>What landed:</p>
        <ul>
          <li><strong>Tier-spread sparkline</strong> on every cost row. Four ticks (T1·T2·T3·T4); height encodes value; empty/dashed for NULL; shape-caption underneath (<code>flat</code> / <code>step↓</code> / <code>2/4</code> / <code>no costs</code>). Scannable across a list of 30 packaging lines without opening any of them.</li>
          <li><strong>Per-row drawer</strong> opens inline below the row on click. Four tier cells, tab-traversable, NULL by default. Each empty cell shows <code>↩ same as Tn</code>; the footer has <code>⤓ apply Tn ($x.xx) to all tiers</code> for the common-flat case.</li>
          <li><strong>Two scenario states</strong> demoed via top-bar switcher: ① apply-to-all (60% of packaging lines, no real volume break) and ② supplier-quote-sheet (40%, four genuinely different prices).</li>
        </ul>

        <h4>Three discipline points carried forward</h4>
        <ul>
          <li><strong>NULL = "no cost entered at this tier"</strong> — never "inherit from active tier." Validation engine sees the gap honestly. Materialized writes only.</li>
          <li><strong>Audit log writes only what the PM typed.</strong> Apply-to-all writes four cells (PM's intent is "all four are this"). Empty-cell <code>↩ same as Tn</code> only writes when clicked. NULL cells never appear in the log.</li>
          <li><strong>Sparkline shape is the customer-view bridge.</strong> The same shape that scans here derives the customer-facing tier-pricing table in Round 3. <code>flat</code> → one price. <code>step↓</code> → volume-break table. <code>partial</code> → omit or "quote on request" (Round 3 decides the visual; the data is unambiguous either way).</li>
        </ul>

        <h4>One new feature commitment</h4>
        <p>
          <strong>Mark-as-flat (no volume break) — committed.</strong> The drawer's "⌐ Mark as flat" annotation is a persisted boolean on the SKU/packaging line that survives re-entries. Real use case: some SKUs structurally have no volume break (insert pulp, decals, low-cost commodity components). Small schema cost; prevents the PM from re-confronting the four-tier entry surface every time a supplier re-quotes a flat-priced line. Schema column TBD when implementation begins — likely <code>quote_skus.is_flat_pricing</code> or per-line equivalent. Add to feature commitment list alongside the three from Round 2 sign-off.
        </p>

        <h4>Production behavior confirmed</h4>
        <p>
          <strong>Drawer closed by default per row, opens on click.</strong> The "drawer open on first row" toggle in Tweaks is a demo affordance only — shipped behavior is closed-by-default so PM scans sparklines, clicks the row that needs entry. Sparkline alone carries enough information to decide whether to open.
        </p>

        <h4>Logged as smaller follow-up rounds (not Round 3)</h4>
        <ul>
          <li><strong>Freight <code>tier_alloc</code> allocation surface.</strong> How freight gets allocated across tiers when a single shipment serves multiple tier orders. Adjacent to multi-tier mechanics but distinct enough to deserve its own round (Round 2.6 candidate if urgent).</li>
          <li><strong>Costing-sheet roll-up of partial-state lines.</strong> Engine flags partial-state at the line level today; the visual treatment on the Costing Sheet when N of M packaging lines are partial needs CD input. Not blocking Round 3.</li>
        </ul>

        <p style={{ marginTop: 14, color: "var(--ink-3)", fontSize: 12.5 }}>
          Round 2 + 2.5 closed. Round 3 begins: customer-facing quote view + Mark-Accepted flow, Option A (PM-internal preview becoming the PDF), with the sparkline-as-tier-pricing-source bridge from 2.5.
        </p>
      </Section>

      <Section eyebrow="Three pushbacks" title="The brief is mostly right. Here's where it's not.">
        <Quote n="1">
          <strong>Slice 9.3 is not a global "edit-mode toggle." It's a per-cell escape hatch.</strong>
          <p style={{ marginTop: 8 }}>
            The brief frames <code>sell_price_override</code> as switching the costing sheet into a different mode — type sell prices directly, watch margins move. I think that's a dangerous default.
          </p>
          <p>
            The 80% case is "tune one tier because the customer pushed back on it." A global mode means three actions to fix one cell (enter mode → edit → exit + remember to exit). Worse, when a PM forgets to exit, the next session looks like every cell is overridable, which trains people to ignore the difference between computed and overridden values — exactly the discipline 9.3 is supposed to preserve.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>What I built instead:</strong> the sell price in each per-SKU breakdown card is a click-to-override target. One click → inline editor → Enter writes <code>sell_price_override</code>; the cell badges 'OVR' and a ↺ revert appears. NULL means computed; non-NULL means overridden. Same schema, different surface. The "table mode" never gets its own page.
          </p>
        </Quote>

        <Quote n="2">
          <strong>The "Mark Accepted" gate enforces margin discipline at the wrong moment.</strong>
          <p style={{ marginTop: 8 }}>
            When a PM clicks Mark Accepted, the customer has already verbally agreed and the deal is in motion. Hard-blocking there forces a politically expensive override conversation when the BELOW FLOOR signal has been visible for days.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>What I built instead:</strong> the costing sheet's BELOW FLOOR state already shows the lock — Mark Accepted is visibly disabled with the admin-override path called out, and the lines requiring review are anchored at the top of the sheet so the PM resolves them <em>before</em> sending. By the time a PM is at the acceptance step, the verdict should be ratification, not arbitration. The schema doesn't change; the UI surfaces the gate days earlier.
          </p>
        </Quote>

        <Quote n="3">
          <strong>Role-anchored editing is over-specified for 5–7 users.</strong>
          <p style={{ marginTop: 8 }}>
            The brief asks how Purchasing's view differs from PM's. My honest answer after two rounds: not very. Same screen, same layout, same math. The only difference is which cost group is write-affordable.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>What I built instead:</strong> a single Cost Build page that takes a <code>viewer</code> param. Owned cost-groups stay editable; non-owned groups dim subtly with a "read-only · viewing as Purchasing" caption. No separate IA, no separate route, no separate component tree. (Toggle the Tweaks panel to switch viewer roles — same screen.)
          </p>
        </Quote>
      </Section>

      <Section eyebrow="Three exploratory questions you asked" title="Answers, with the path I'd actually take">
        <h4>1 · Where do new SKUs come from in Cost Build?</h4>
        <p>
          Three entry points, in priority order:
        </p>
        <ul>
          <li><strong>Quote-setup spawn (90% case).</strong> When the PM defines SKUs in setup, every (SKU × tier) cell is created with NULL costs. Cost Build never adds SKUs; it fills them in.</li>
          <li><strong>"+ Add variant" inline on the SKU rail (8% case).</strong> The customer asks for a 75ml version mid-build. One-click duplicate of an existing SKU (carries over packaging templates, NULLs the unit costs) — keeps the PM from bouncing back to setup.</li>
          <li><strong>Bulk-import from a supplier sheet (2% case).</strong> Drag a CSV onto the SKU rail. Defer this; it's a Slice 14+ thing.</li>
        </ul>
        <p>I'd ship the first one as part of 9.x and treat the inline-add as a Round 4 conversation.</p>

        <h4>2 · How do per-tier sell overrides interact with global price adjustment?</h4>
        <p>
          The schema gives us a clean two-level hierarchy:
        </p>
        <ul>
          <li><code>tier_price_adj_pct = NULL</code> → tier inherits <code>quote.global_price_adj_pct</code>.</li>
          <li><code>tier_price_adj_pct &ne; NULL</code> → tier ignores global; uses its own value.</li>
          <li><code>sell_price_override &ne; NULL</code> → cell ignores both adjustments; uses raw override.</li>
        </ul>
        <p>
          This is what the prototype implements — the per-tier slider shows "OVERRIDE active" when set and "inheriting global" otherwise. The "↺ inherit global" button writes NULL, which is the schema-honest way to revert. The cascade is visible: you can see at a glance which tier is doing its own thing.
        </p>

        <h4>3 · What's the right shape of the audit trail for cost changes?</h4>
        <p>
          A row per (cost_input_table, row_id, field, old_value, new_value, user_id, ts). Not a free-text comment log — structured enough that you can answer "show me every margin-affecting change in the last 7 days" with one query.
        </p>
        <p>The diff dot ("fresh") on Cost Build rows is the read surface for the per-row case. A "since last visit" summary on the project page is the aggregated read surface (Round 3+). Don't build a separate "audit log viewer" until someone asks for one.</p>
      </Section>

      <Section eyebrow="The structure that should carry forward" title="What Rounds 3-5 should reuse from this round">
        <Quote unmarked>
          <strong>The internal-vs-customer-visible visual grammar.</strong> The hatched purple "internal · never on customer quote" zone should appear anywhere that customs/duty/CBM math surfaces. Same border treatment, same ribbon. If Customer View ever accidentally renders one of these zones, that's a bug — and the visual difference makes the bug obvious in screenshots, in code review, in QA.
        </Quote>
        <Quote unmarked>
          <strong>NULL is the empty signal, everywhere.</strong> Cost cells, tier overrides, sell prices, client targets, quote target margin — every "absent" state is NULL, never zero, never empty string. The UI treats NULL as a first-class display state ("awaiting input" / "inheriting global" / "no client target"). This needs to hold across Quote setup, Customer view, and the audit log.
        </Quote>
        <Quote unmarked>
          <strong>Verdict-as-room-organizer.</strong> The Costing Sheet's blended margin <em>is</em> the page header. Per-SKU rows orbit it. When we build the customer-facing quote view (Round 3), the verdict role flips — the unit price and tier table become the room. Don't replicate the internal pattern as decoration; let the customer view's hierarchy reflect what the customer cares about.
        </Quote>
        <Quote unmarked>
          <strong>Helper text, not narration.</strong> Every panel that has lead copy ("Start anywhere. Most PMs begin with packaging…") earns its place by reducing a click or a question. If a sentence is just describing what's on screen, cut it. The Cost Build empty-state has one sentence + one CTA; that's the budget.
        </Quote>
      </Section>

      <Section eyebrow="Almost-decisions" title="What I built and threw away">
        <Quote unmarked>
          <strong>A cost-completion progress bar at the top of Cost Build.</strong> "12 of 18 fields filled · 67%". It made the page feel like a survey. Dropped — the cost stack at the bottom + per-group "complete / 2 empty" chips already convey readiness, without gamifying it.
        </Quote>
        <Quote unmarked>
          <strong>A separate "quick edit" drawer for paste-from-supplier-quote workflows.</strong> Same conclusion as last round, restated more strongly: the Cost Build screen <em>is</em> the quick-edit surface. The notification email's "edit Aluminum collar" link should land in the cell, focused, with no chrome to dismiss. The "Demo · focus aluminum collar" button on Cost Build is the proof-of-life for that flow.
        </Quote>
        <Quote unmarked>
          <strong>A radial gauge for blended margin.</strong> Looks great on a dashboard. Reads poorly when you actually need to know "am I above 35%?" The horizontal range with floor + target marks reads in one glance; the big numeric on the costing-sheet header carries the rest.
        </Quote>
        <Quote unmarked>
          <strong>A per-row audit timeline modal.</strong> Click a "fresh" dot → see every change ever made to that row. Felt like a QA tool, not a PM tool. The audit log should exist (see Q3 above); a per-row modal is not how anyone consumes it.
        </Quote>
      </Section>
    </div>
  );
}

function Section({ title, eyebrow, children }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <p className="eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</p>
      <h2 style={{
        fontFamily: "var(--display)", fontSize: 26, fontWeight: 400,
        letterSpacing: "-0.02em", margin: "0 0 14px", color: "var(--ink)"
      }}>{title}</h2>
      <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6 }}>
        {children}
      </div>
    </section>
  );
}

function Quote({ children, n, unmarked }) {
  return (
    <blockquote style={{
      margin: "12px 0",
      padding: "14px 18px 14px 22px",
      borderLeft: `2px solid ${unmarked ? "var(--rule-2)" : "var(--accent)"}`,
      background: "var(--paper-2)",
      borderRadius: "0 8px 8px 0",
      fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6,
      position: "relative",
    }}>
      {n != null && (
        <span style={{
          position: "absolute", left: -14, top: 12,
          width: 24, height: 24, borderRadius: 24,
          background: "var(--accent)", color: "var(--paper)",
          display: "grid", placeItems: "center",
          fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600,
        }}>{n}</span>
      )}
      {children}
    </blockquote>
  );
}

function H4({ children }) { return <h4 style={{
  fontFamily: "var(--display)", fontSize: 18, fontWeight: 500, fontStyle: "italic",
  letterSpacing: "-0.01em", margin: "18px 0 6px", color: "var(--ink)"
}}>{children}</h4>; }

window.R2Notes = R2Notes;
