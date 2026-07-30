/* global React, NXR3 */
// Round 3 — Mark-Accepted flow
// 6 states: GOOD, bothGates, overrideRequest, pendingApproval, confirmation, locked
// Plus: sent-vs-draft version mismatch surfacing

const { useState, Fragment } = React;

function fmtUSD(n, dec = 2) {
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// ─── Mini cost-stack legend (reused vibe from Round 2) ───
function MarginVerdict({ snapshot }) {
  const cls = snapshot.verdict === "GOOD" ? "good"
    : snapshot.verdict === "BELOW TARGET" ? "warn"
    : "bad";
  return (
    <div className="macc-verdict">
      <div className={"margin-num " + cls}>{snapshot.blended_margin_pct.toFixed(1)}%</div>
      <div className="margin-meta">
        <div className="lbl">Blended margin · {snapshot.verdict}</div>
        <div className="sub">Target {snapshot.target_pct}% · Floor {snapshot.floor_pct}%</div>
      </div>
    </div>
  );
}

// ─── Tier card (selectable in tier-selection step) ───────
function TierCard({ tier, selected, onSelect, disabled }) {
  return (
    <div className={"tier-card" + (selected ? " selected" : "") + (disabled ? " disabled" : "")}
         onClick={disabled ? undefined : onSelect}>
      <div className="radio" />
      <div>
        <div className="tname">{tier.label}</div>
        <div className="tqty">{tier.qty.toLocaleString()} units</div>
      </div>
      <div>
        <div className="tprice">{fmtUSD(tier.unit_price)}<span style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: 4 }}>/u</span></div>
        <div className="tqty" style={{ textAlign: "right" }}>Total {fmtUSD(tier.total, 0)}</div>
      </div>
      <div>
        <div className={"tmargin " + tier.status}>{tier.margin_pct.toFixed(1)}%</div>
        <div className="tqty" style={{ textAlign: "right" }}>margin</div>
      </div>
    </div>
  );
}

// ─── State 1 + 5: GOOD with tier-selection + confirmation modal ─────
function MarkAcceptedGood() {
  const { quote, costingByScenario, sibling_scenarios, customer } = NXR3;
  const snap = costingByScenario.good;
  const recommended = snap.tier_summary.findIndex(t => t.recommended);
  const [selected, setSelected] = useState(recommended);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showVersionWarn, setShowVersionWarn] = useState(true);

  const tier = snap.tier_summary[selected];

  return (
    <div>
      <div className="macc-header">
        <MarginVerdict snapshot={snap} />
        <div className="macc-cta-cluster">
          <button className="macc-cta-primary accent" onClick={() => setShowConfirm(true)}>
            ✓ Mark accepted · {tier.label}
          </button>
          <span className="macc-cta-secondary">All gates clear · ready to lock</span>
        </div>
      </div>

      <div className="macc-preview-rail">
        <div className="macc-tier-list">
          <p className="eyebrow" style={{ marginBottom: 6 }}>Tier-selection · which tier did the customer accept?</p>
          <h2 style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 500, margin: "0 0 14px", letterSpacing: "-0.015em" }}>
            Pick the tier on <em style={{ color: "var(--ink-3)", fontStyle: "italic" }}>{customer.name}'s</em> reply
          </h2>

          {showVersionWarn && (
            <div className="version-warning">
              <div className="icon">!</div>
              <div className="text">
                <h4>You sent <strong>v3</strong> on Apr 28 · current draft is <strong>v4</strong></h4>
                <p style={{ margin: 0 }}>
                  The customer is responding to <strong>v3</strong>. The tier prices below reflect <strong>v3 (the sent version)</strong>, not the v4 edits in your draft.
                  Mark-accepted will lock against v3 and discard v4 (or save v4 as a sibling scenario — your pick).
                </p>
                <div className="actions">
                  <button className="btn sm">View v3 (sent) preview</button>
                  <button className="btn sm">Compare v3 ↔ v4 changes</button>
                  <button className="btn sm ghost" onClick={() => setShowVersionWarn(false)}>Dismiss</button>
                </div>
              </div>
            </div>
          )}

          {snap.tier_summary.map((t, i) => (
            <TierCard key={t.id} tier={t} selected={i === selected} onSelect={() => setSelected(i)} />
          ))}

          <div className="dn-inline compact" style={{ marginTop: 18 }}>
            <div className="dn-eyebrow">DN · pushback ① outcome</div>
            By the time the PM is here, the verdict is ratification — not arbitration. All four tiers are tunable, all four show margin, the recommended one is starred but not forced. PM picks the one the customer named.
          </div>
        </div>

        <div className="macc-side-rail">
          <p className="eyebrow" style={{ marginBottom: 8 }}>What happens when you click Mark accepted</p>
          <ol style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
            <li>Quote status: <code>sent</code> → <code>accepted</code></li>
            <li>Captures: tier_id, accepted_at, your user_id</li>
            <li>Snapshot json stored (FR-11) — irreversible record</li>
            <li>Other active scenarios auto-dropped (auditable)</li>
            <li>HubSpot writeback fires (async)</li>
            <li>This page becomes read-only</li>
          </ol>

          <div style={{ marginTop: 22, padding: "12px 14px", background: "var(--paper-3)", borderRadius: 6 }}>
            <p className="eyebrow" style={{ marginBottom: 6 }}>Other active scenarios</p>
            {sibling_scenarios.filter(s => s.status === "active").map(s => (
              <div key={s.id} style={{ fontSize: 12, color: "var(--ink-2)", padding: "6px 0", borderTop: "1px solid var(--rule)" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{s.label}</span>
                  <span className="mono" style={{ color: "var(--ink-3)" }}>{s.margin}%</span>
                </div>
                <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", letterSpacing: 0 }}>{s.last_edit}</div>
              </div>
            ))}
            <div className="mono" style={{ fontSize: 10, color: "var(--warn)", marginTop: 8, letterSpacing: 0.04 }}>
              Both will be auto-dropped on accept.
            </div>
          </div>
        </div>
      </div>

      {showConfirm && <AcceptConfirmModal tier={tier} onClose={() => setShowConfirm(false)} sibling_scenarios={sibling_scenarios} customer={customer} quote={quote} />}
    </div>
  );
}

// ─── Confirmation modal (state 5) ────────────────────────
function AcceptConfirmModal({ tier, onClose, sibling_scenarios, customer, quote }) {
  const [step, setStep] = useState("confirm"); // confirm | locking | done
  const activeSiblings = sibling_scenarios.filter(s => s.status === "active");

  if (step === "locking") {
    return (
      <div className="modal-scrim">
        <div className="modal" style={{ maxWidth: 460 }}>
          <div className="modal-body" style={{ alignItems: "center", textAlign: "center", padding: "32px 24px" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", border: "3px solid var(--rule)", borderTopColor: "var(--accent)", margin: "0 auto", animation: "spin 0.8s linear infinite" }} />
            <h2 style={{ fontFamily: "var(--display)", fontSize: 20, margin: "20px 0 4px", fontWeight: 500 }}>Locking quote…</h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>Writing snapshot · firing HubSpot writeback · dropping sibling scenarios</p>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="titles">
            <p className="eyebrow">Confirm acceptance · irreversible</p>
            <h2>Accept <em style={{ color: "var(--ink-3)" }}>{customer.name} · {quote.quote_number}</em> at {tier.label}</h2>
          </div>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ background: "var(--paper-2)", border: "1px solid var(--rule)", borderRadius: 8, padding: "14px 18px" }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 500 }}>{tier.label} · {tier.qty.toLocaleString()} units</div>
              <div className="mono" style={{ fontSize: 14, color: "var(--ink)" }}>{fmtUSD(tier.unit_price)}/u · {fmtUSD(tier.total, 0)} total</div>
            </div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>Margin {tier.margin_pct.toFixed(1)}% · against v3 (sent Apr 28)</div>
          </div>

          <div>
            <p className="eyebrow" style={{ marginBottom: 8 }}>This will:</p>
            <ul style={{ margin: 0, padding: "0 0 0 20px", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.7 }}>
              <li>Lock the quote — no further edits to v3</li>
              <li>Auto-drop {activeSiblings.length} other active scenarios: {activeSiblings.map(s => `"${s.label}"`).join(", ")}</li>
              <li>Save v4 (your draft) as a sibling for reference, status <code>dropped</code></li>
              <li>Fire HubSpot writeback (deal stage → Closed-Won, amount → {fmtUSD(tier.total, 0)})</li>
              <li>Add audit row: <code>accepted</code> by you · <code>accept_source: manual_button</code></li>
            </ul>
          </div>

          <div className="formfield">
            <label>Optional: note for the audit log</label>
            <textarea placeholder="e.g. Customer accepted via email reply on Apr 30 — Priya's signoff cc'd to legal." />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" style={{ background: "var(--accent)", borderColor: "var(--accent)" }} onClick={() => { setStep("locking"); setTimeout(onClose, 1800); }}>
            ✓ Confirm · lock {tier.label}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── State 2 + 3: bothGates firing + admin override request modal ─────
function MarkAcceptedBothGates() {
  const { quote, costingByScenario, customer } = NXR3;
  const snap = costingByScenario.bothGates;
  const [showOverride, setShowOverride] = useState(false);

  return (
    <div>
      <div className="macc-header">
        <MarginVerdict snapshot={snap} />
        <div className="macc-cta-cluster">
          <button className="macc-cta-primary" disabled>
            ⚠ Mark accepted · blocked
          </button>
          <button className="btn bad sm" style={{ borderStyle: "dashed" }} onClick={() => setShowOverride(true)}>
            ⚡ Request admin override
          </button>
        </div>
      </div>

      <div className="macc-preview-rail">
        <div className="macc-tier-list">
          <p className="eyebrow" style={{ marginBottom: 6 }}>Acceptance blocked · two gates firing</p>
          <h2 style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 500, margin: "0 0 14px", letterSpacing: "-0.015em" }}>
            Quote-level <em style={{ color: "var(--bad)", fontStyle: "italic" }}>BELOW FLOOR</em>, plus {snap.warnings_line} line-level UNDERPRICED
          </h2>

          <div style={{ background: "var(--bad-soft)", border: "1px solid oklch(from var(--bad) l c h / 0.4)", borderRadius: 8, padding: "14px 18px", marginBottom: 14 }}>
            <p className="eyebrow" style={{ color: "var(--bad)", marginBottom: 8 }}>Lines requiring review</p>
            {snap.flagged_lines.map((l, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: i > 0 ? "1px solid oklch(from var(--bad) l c h / 0.2)" : "none", fontSize: 12.5 }}>
                <span><strong>{l.sku}</strong> · {l.tier}</span>
                <span className="mono" style={{ color: "var(--bad)" }}>{l.margin}% margin · {l.rule}</span>
              </div>
            ))}
            <div className="mono" style={{ fontSize: 10.5, color: "var(--bad)", marginTop: 10, letterSpacing: 0.04 }}>
              + 1 quote-level: blended margin below floor (22.8% &lt; 25%)
            </div>
          </div>

          <p className="eyebrow" style={{ marginBottom: 6 }}>Two paths forward</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ background: "var(--paper-2)", border: "1px solid var(--rule)", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 500, marginBottom: 6 }}>(a) Tune up</div>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                Open Cost Build → adjust the flagged lines back into range → re-Mark accepted. Roughly 4-6 line edits to lift blended above 25%.
              </p>
              <button className="btn sm" style={{ marginTop: 12 }}>← Back to Cost Build</button>
            </div>
            <div style={{ background: "var(--paper-2)", border: "1px dashed var(--bad)", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 500, marginBottom: 6 }}>(b) Admin override</div>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                Slack DM to @nina (sales-leadership). Reason captured. Approval logs to the quote. Gate unlocks; Mark-accepted enables.
              </p>
              <button className="btn bad sm" style={{ marginTop: 12, borderStyle: "dashed" }} onClick={() => setShowOverride(true)}>⚡ Request override</button>
            </div>
          </div>

          <div className="dn-inline compact" style={{ marginTop: 18 }}>
            <div className="dn-eyebrow">DN · pushback ② outcome</div>
            Gate state has been visible on Costing Sheet from data-entry forward. By the time PM is here, this is recognition not surprise. The override path is a documented exception, not a workaround the PM stumbles into.
          </div>
        </div>

        <div className="macc-side-rail">
          <p className="eyebrow" style={{ marginBottom: 8 }}>Override workflow</p>
          <ol style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
            <li>Request override (button →)</li>
            <li>Slack DM drafts to leadership</li>
            <li>Reason logged to <code>quote_warnings</code></li>
            <li>Out-of-band approval</li>
            <li>Approval logs back via Slack reaction or button click</li>
            <li>Mark-accepted enables · proceeds normally</li>
          </ol>

          <div style={{ marginTop: 18, padding: "12px 14px", background: "var(--warn-soft)", border: "1px solid oklch(from var(--warn) l c h / 0.4)", borderRadius: 6 }}>
            <p className="eyebrow" style={{ color: "var(--warn)", marginBottom: 4 }}>Override is auditable</p>
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              Your reason and the approval thread are logged to the quote permanently. Anyone with quote access can see who overrode, when, and why.
            </p>
          </div>
        </div>
      </div>

      {showOverride && <OverrideModal snap={snap} customer={customer} quote={quote} onClose={() => setShowOverride(false)} />}
    </div>
  );
}

// ─── Override request modal (state 3) ────────────────────
function OverrideModal({ snap, customer, quote, onClose }) {
  const [reason, setReason] = useState("");
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="titles">
            <p className="eyebrow" style={{ color: "var(--bad)" }}>Request admin override · below-floor send</p>
            <h2>Override 2 gates on <em style={{ color: "var(--ink-3)" }}>{customer.name} · {quote.quote_number}</em></h2>
          </div>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ background: "var(--bad-soft)", border: "1px solid oklch(from var(--bad) l c h / 0.4)", borderRadius: 8, padding: "12px 16px" }}>
            <p className="eyebrow" style={{ color: "var(--bad)", marginBottom: 6 }}>Gates being overridden</p>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
              ▸ <strong>Quote-level:</strong> blended margin 22.8% (floor 25%)<br/>
              ▸ <strong>Line-level:</strong> 3 lines below floor — RPL-400 T3, RPL-400 T4, CAP-60 T4
            </div>
          </div>

          <div className="formfield">
            <label>Reason for override · required</label>
            <textarea
              placeholder="e.g. Strategic Q2 win — Lumen referenced as anchor reference for incoming Sephora RFP. Margin recovery planned via T4 PO followups in Q3."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="helper">Logged to <code>quote_warnings.override_reason</code> · permanent record · visible to leadership.</div>
          </div>

          <div className="formfield">
            <label>Slack DM preview</label>
            <div className="slack-preview">
              <div className="slack-head">
                <div className="slack-logo">S</div>
                <div className="slack-to">to <strong>@nina · sales-leadership</strong></div>
              </div>
              <div className="slack-msg">
                <span className="mention">@nina</span> requesting below-floor override on <strong>Lumen & Co. · HG-2418</strong>.{"\n"}
                Blended margin <strong>22.8%</strong> (floor 25%). 3 line-level UNDERPRICED, 1 quote-level BELOW FLOOR.{"\n"}
                {reason ? <>Reason: <em>"{reason}"</em></> : <em style={{ color: "var(--ink-4)" }}>[reason will appear here once you fill it in]</em>}{"\n\n"}
                Approve in thread or click: <span style={{ color: "var(--accent-ink)", textDecoration: "underline" }}>nexus.app/quotes/Q-2418-v3/approve</span>
              </div>
            </div>
            <div className="helper">Review the message before sending. Slack-thread approval logs back to Nexus automatically; a fallback "Mark approved" link in the DM works if Slack-app integration is down.</div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <div className="row gap-2">
            <button className="btn">Save draft (don't send yet)</button>
            <button className="btn bad" style={{ borderStyle: "solid" }} disabled={!reason.trim()} onClick={onClose}>
              ⚡ Send Slack DM · log override request
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── State 4: Pending approval ───────────────────────────
function MarkAcceptedPending() {
  const { quote, costingByScenario, customer } = NXR3;
  const snap = costingByScenario.bothGates;

  return (
    <div>
      <div className="macc-header">
        <MarginVerdict snapshot={snap} />
        <div className="macc-cta-cluster">
          <button className="macc-cta-primary" disabled>
            ⏳ Mark accepted · waiting on override
          </button>
          <span className="macc-cta-secondary">Slack DM sent · 14m ago to @nina</span>
        </div>
      </div>

      <div className="pending-banner" style={{ margin: "16px 32px 0" }}>
        <div className="pulse" />
        <div className="text">
          <strong>Override request pending · sent 14m ago to @nina (sales-leadership).</strong> You'll be notified in Slack and in-app the moment approval lands; this page will refresh.
          <span className="meta">
            quote_warnings.override_status = pending · requested by you · 2026-04-30 14:22 PST
          </span>
        </div>
        <button className="btn sm">Re-send DM</button>
        <button className="btn sm ghost">Cancel request</button>
      </div>

      <div className="macc-preview-rail">
        <div className="macc-tier-list">
          <p className="eyebrow" style={{ marginBottom: 6 }}>What you can do while waiting</p>
          <h2 style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 500, margin: "0 0 14px", letterSpacing: "-0.015em" }}>
            The quote is <em style={{ color: "var(--ink-3)", fontStyle: "italic" }}>frozen</em> for editing until override resolves
          </h2>

          <div style={{ background: "var(--paper-2)", border: "1px solid var(--rule)", borderRadius: 8, padding: "14px 18px", marginBottom: 14 }}>
            <p className="eyebrow" style={{ marginBottom: 8 }}>Cost Build is read-only during approval window</p>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              Editing during a pending override would invalidate the gate state @nina is approving against.
              If you need to tune lines, <strong>cancel the request</strong> first — that sends a "request withdrawn" Slack reply automatically.
            </p>
          </div>

          <p className="eyebrow" style={{ marginBottom: 6 }}>Recent activity</p>
          <div style={{ background: "var(--paper-2)", border: "1px solid var(--rule)", borderRadius: 8, padding: "8px 14px" }}>
            {[
              { who: "you", what: "requested below-floor override (2 gates, reason 64 chars)", when: "14m ago" },
              { who: "system", what: "Slack DM dispatched to @nina · sales-leadership", when: "14m ago" },
              { who: "@nina", what: "viewed Slack DM (read receipt)", when: "11m ago" },
            ].map((e, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr 60px", padding: "6px 0", borderTop: i > 0 ? "1px solid var(--rule)" : "none", fontSize: 12, alignItems: "center" }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)", letterSpacing: 0.04 }}>{e.who}</span>
                <span style={{ color: "var(--ink-2)" }}>{e.what}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)", letterSpacing: 0.04, textAlign: "right" }}>{e.when}</span>
              </div>
            ))}
          </div>

          <div className="dn-inline compact" style={{ marginTop: 18 }}>
            <div className="dn-eyebrow">DN · pending state honesty</div>
            Frozen Cost Build is the design call here, not "still editable but with a warning." Approval is happening against a specific gate state; if PM tunes lines mid-approval, @nina is approving a phantom. Cancel-then-edit is the explicit path.
          </div>
        </div>

        <div className="macc-side-rail">
          <p className="eyebrow" style={{ marginBottom: 8 }}>What approval looks like</p>
          <p style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6, margin: "0 0 12px" }}>
            @nina replies in Slack thread, or clicks the link in the DM. Either path:
          </p>
          <ol style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.7 }}>
            <li>Approval logs to <code>quote_warnings</code></li>
            <li>This page refreshes; banner becomes "Approved by @nina · 2m ago"</li>
            <li>Mark-accepted button enables</li>
            <li>You proceed with tier selection + confirmation as normal</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

// ─── State 6: Locked / accepted ──────────────────────────
function MarkAcceptedLocked() {
  const { quote, customer, costingByScenario } = NXR3;
  const snap = costingByScenario.good;
  const tier = snap.tier_summary.find(t => t.recommended);

  return (
    <div>
      <div className="locked-ribbon">
        <div className="icon">✓</div>
        <div className="text">
          <div className="heading">Accepted Apr 30, 2026 · {tier.label} · {tier.qty.toLocaleString()} units</div>
          <div className="meta">by Maya Okafor · {fmtUSD(tier.total, 0)} total · {tier.margin_pct.toFixed(1)}% margin · v3 (sent Apr 28)</div>
        </div>
        <div className="right">
          <span className="chip good"><span className="dot"/>HubSpot synced 2m ago</span>
          <button className="btn sm">⤓ Final PDF</button>
          <button className="btn sm">View snapshot</button>
        </div>
      </div>

      <div className="macc-header" style={{ borderBottom: "1px solid var(--rule)" }}>
        <MarginVerdict snapshot={snap} />
        <div className="macc-cta-cluster">
          <span className="chip" style={{ fontSize: 11 }}>🔒 Read-only · accepted</span>
          <span className="macc-cta-secondary">Quote locked · all surfaces frozen · canonical record is the snapshot</span>
        </div>
      </div>

      <div style={{ padding: "24px 32px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
          <div>
            <p className="eyebrow" style={{ marginBottom: 8 }}>Accepted tier</p>
            <div className="tier-card selected" style={{ cursor: "default" }}>
              <div className="radio" />
              <div>
                <div className="tname">{tier.label}</div>
                <div className="tqty">{tier.qty.toLocaleString()} units</div>
              </div>
              <div>
                <div className="tprice">{fmtUSD(tier.unit_price)}<span style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: 4 }}>/u</span></div>
                <div className="tqty" style={{ textAlign: "right" }}>Total {fmtUSD(tier.total, 0)}</div>
              </div>
              <div>
                <div className="tmargin good">{tier.margin_pct.toFixed(1)}%</div>
                <div className="tqty" style={{ textAlign: "right" }}>margin</div>
              </div>
            </div>

            <div style={{ background: "var(--paper-2)", border: "1px solid var(--rule)", borderRadius: 8, padding: "14px 18px", marginTop: 18 }}>
              <p className="eyebrow" style={{ marginBottom: 10 }}>Acceptance audit</p>
              {[
                { lbl: "Accepted by",      val: "Maya Okafor (you)" },
                { lbl: "Accepted at",      val: "2026-04-30 15:08 PST" },
                { lbl: "Accept source",    val: "manual_button" },
                { lbl: "Sent version",     val: "v3 (snap-v3-2026-04-28)" },
                { lbl: "Draft v4",         val: "saved as sibling, status: dropped" },
                { lbl: "Other scenarios",  val: "2 auto-dropped (Reduced-tier, Pass-through freight)" },
                { lbl: "HubSpot writeback", val: "Closed-Won · $163,750 · synced 2m ago" },
              ].map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "180px 1fr", padding: "6px 0", borderTop: i > 0 ? "1px solid var(--rule)" : "none", fontSize: 12.5 }}>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", letterSpacing: 0.04 }}>{r.lbl}</span>
                  <span style={{ color: "var(--ink-2)" }}>{r.val}</span>
                </div>
              ))}
            </div>

            <div className="dn-inline compact" style={{ marginTop: 18 }}>
              <div className="dn-eyebrow">DN · post-accept tone</div>
              "This is done; here's the artifact" — not "you can't edit this anymore." Locked-ribbon leads with what was accepted; PDF link is dominant. Read-only is implied by the page state, not narrated as a restriction.
            </div>
          </div>

          <div>
            <p className="eyebrow" style={{ marginBottom: 8 }}>What happens next</p>
            <ul style={{ margin: 0, padding: "0 0 0 20px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
              <li>Generate PO confirmation (next-step action card on Project view)</li>
              <li>Production schedule emails to Tomás (Purchasing) + Jin (Production)</li>
              <li>Project enters <code>in-production</code> stage on the deal organizer (Round 4)</li>
            </ul>

            <div style={{ background: "var(--paper-2)", border: "1px solid var(--rule)", borderRadius: 8, padding: "14px 16px", marginTop: 16 }}>
              <p className="eyebrow" style={{ marginBottom: 6 }}>If something's wrong</p>
              <p style={{ fontSize: 12, color: "var(--ink-2)", margin: "0 0 8px", lineHeight: 1.5 }}>
                Acceptance is locked but not destroyed. To revert: admin can <code>scenario_status: accepted → active</code> with a reason; HubSpot writeback is rolled back. Logged to audit.
              </p>
              <button className="btn sm ghost">Request unlock (admin)</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Mark-Accepted host w/ sub-state switcher ────────────
function MarkAcceptedHost({ subState, setSubState }) {
  const Variant = ({
    good:           MarkAcceptedGood,
    bothGates:      MarkAcceptedBothGates,
    pending:        MarkAcceptedPending,
    locked:         MarkAcceptedLocked,
  })[subState] || MarkAcceptedGood;

  return (
    <div className="macc-stage">
      <div style={{ padding: "10px 24px", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--paper-2)" }}>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: 0.04 }}>
          <span style={{ color: "var(--ink-4)" }}>Costing Sheet · Lumen & Co. · HG-2418 · </span>
          <strong style={{ color: "var(--ink) " }}>Mark accepted</strong>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-4)", letterSpacing: 0.06 }}>prototype state →</span>
          <div className="state-sub">
            <button className={subState === "good" ? "active" : ""} onClick={() => setSubState("good")}>① GOOD</button>
            <button className={subState === "bothGates" ? "active" : ""} onClick={() => setSubState("bothGates")}>② Both gates</button>
            <button className={subState === "pending" ? "active" : ""} onClick={() => setSubState("pending")}>③ Pending approval</button>
            <button className={subState === "locked" ? "active" : ""} onClick={() => setSubState("locked")}>④ Locked</button>
          </div>
        </div>
      </div>
      <Variant />
    </div>
  );
}

Object.assign(window, {
  MarkAcceptedHost, MarkAcceptedGood, MarkAcceptedBothGates, MarkAcceptedPending, MarkAcceptedLocked,
});
