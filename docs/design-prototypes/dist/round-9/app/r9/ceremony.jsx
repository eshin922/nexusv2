/* global React, NXR9 */
// Nexus Round 9 — Acceptance & Sales Order ceremony
// Revises R8 sub-tabs 4 + 5. Sub-tabs 1–3 (Preview, Send, Client Review) are
// UNCHANGED and reused verbatim from app/r8/umbrella.jsx via window.*
//
// Ceremony: ONE customer decision → ONE capture (tab 4, light, HubSpot)
//           → tier CARRIED → ONE order (tab 5 "Sales Order", NetSuite = the lock).

const { useState } = React;
const R9 = () => window.NXR9;

function usd9(n, dec = 0) {
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function short9(s) {
  return new Date(s + (s.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ═══ SUB-TAB 4 · THE CAPTURE ═════════════════════════════
// Transcribe one email that contains both facts. Light, compact, one act.
function AcceptedCapture({ variant, onGo, onVariant, tierId, setTierId }) {
  const { customer, quote, tiers, capture, hubspot, failures, versions } = R9();
  const [source, setSource] = useState(capture.default_source);
  const [note, setNote] = useState(capture.prefill_note);
  const sentV = versions.find(v => v.sent);
  const tier = tiers.find(t => t.id === tierId);

  const pushing = variant === "pushing";
  const recorded = variant === "recorded";
  const error = variant === "error";

  // ── Recorded: resolves IN PLACE. No auto-navigation. ──
  if (recorded) {
    return (
      <div className="r9-wrap">
        <div className="r8-cols r9-single">
          <div>
            <p className="eyebrow">Sub-tab 4 · Acceptance · recorded</p>
            <h1 className="r8-h1">{customer.name} accepted at <em>{tier.label}</em></h1>
            <p className="r8-sub">
              Recorded against {sentV.label} and pushed to HubSpot. Nothing is locked — this can be
              rolled back, and the quote can still be revised.
            </p>

            <div className="r9-handoff">
              <span className="mark">✓</span>
              <div className="txt">
                <h4>Acceptance recorded · HubSpot set to {hubspot.to_stage}</h4>
                <p>
                  {customer.contact} accepted {sentV.label} at <strong>{tier.label}</strong> ({tier.qty.toLocaleString()} units,
                  {" "}{usd9(tier.turnkey)} turnkey). The tier they named carries into Sales Order —
                  you'll review the order and send it there.
                </p>
                <span className="meta">
                  quote.state = accepted · customer_accepted_tier_id = {tier.label} · accepted_tier_id = null · hubspot {hubspot.to_stage} · {usd9(hubspot.amount)}
                </span>
                <div className="acts">
                  <button className="btn sm ghost">View in HubSpot ↗</button>
                </div>
              </div>
            </div>

            <div className="r8-rollback" style={{ marginTop: 14 }}>
              <div className="t">
                <strong>Recorded in error?</strong> Roll back to Send to Client — reverses the HubSpot stage
                and returns the quote to <code>sent</code>. The review log and the tier they named are kept.
              </div>
              <button className="btn" onClick={() => onVariant("capture")}>↺ Roll back to Send to Client</button>
            </div>

            <div className="r8-revise" style={{ marginTop: 12 }}>
              <div className="txt">
                <div className="t">Customer changed their mind?</div>
                <div className="s">Revise rolls the acceptance back first, then reopens the quote as an editable draft — same quote number, v{quote.draft_version + 1}.</div>
              </div>
              <button className="btn sm">↺ Revise quote</button>
            </div>

            <div className="r8-dn">
              <div className="dn-eyebrow">DN · the deliberate handoff</div>
              The app does <strong>not</strong> navigate on its own here. It resolves in place, and the advance bar re-labels to name the tier it will commit. A silent jump into the irreversible tab is indistinguishable from a bug — so crossing the lock threshold is always a button the PM presses, reading exactly what it will do.
            </div>
          </div>
        </div>

        <window.AdvanceBar
          weight="light"
          back={{ label: "Client Review", onClick: () => onGo("review") }}
          mid="quote state · accepted · reversible · nothing in NetSuite yet"
          caption="Next step is the irreversible one"
          label={"Review Sales Order · " + tier.label + " →"}
          onAdvance={() => onGo("tier")}
        />
      </div>
    );
  }

  // ── Capture / pushing / error ──
  return (
    <div className="r9-wrap">
      <div className="r8-cols r9-single">
        <div>
          <p className="eyebrow">Sub-tab 4 · Acceptance</p>
          <h1 className="r8-h1">What did <em>{customer.name}</em> say?</h1>
          <p className="r8-sub">
            Record the acceptance and the tier they named — they arrive together, so you enter them
            together. This closes the deal in HubSpot. It does not commit anything operationally.
          </p>

          {error && (
            <div className="r8-push error" style={{ marginBottom: 14 }}>
              <span className="mark">!</span>
              <div className="txt">
                <div className="t">{failures.hubspot.title}</div>
                <div className="s">{failures.hubspot.code} · {failures.hubspot.detail}</div>
              </div>
              <div className="acts">
                <button className="btn sm" onClick={() => { onVariant("pushing"); setTimeout(() => onVariant("recorded"), 1400); }}>Retry push</button>
                <button className="btn sm ghost">Copy error</button>
              </div>
            </div>
          )}

          <div className="r9-capture">
            <div className="r9-capture-head">
              <span className="t">Acceptance of {quote.quote_number} {sentV.label}</span>
              <span className="s">sent {short9(quote.sent_at)} · the version they saw</span>
            </div>

            <div className="r9-field">
              <span className="lbl">Their words</span>
              <div className="r9-quote">
                {note}
                <span className="r9-quote-src">pulled from {capture.prefill_from} · edit if you're transcribing something else</span>
              </div>
            </div>

            <div className="r9-field">
              <span className="lbl">Tier they named</span>
              <div className="r9-tierchips">
                {tiers.map(t => {
                  const dis = t.status === "below_floor";
                  return (
                    <button key={t.id} className={"r9-chip" + (t.id === tierId ? " on" : "") + (dis ? " disabled" : "")}
                      onClick={dis ? undefined : () => setTierId(t.id)} disabled={dis}>
                      <span className="top">
                        <span className="tl">{t.label}</span>
                        {t.recommended && <span className="star">★</span>}
                        {t.id === R9().tier_intent.tier_id && <span className="named">named</span>}
                      </span>
                      <span className="q">{t.qty.toLocaleString()} units</span>
                      <span className={"m " + t.status}>{t.margin_pct.toFixed(1)}% margin</span>
                    </button>
                  );
                })}
              </div>
              <span className="hint">
                Carried to Sales Order as an intent — you confirm and commit it there. T4 is below floor
                and can't be committed without an admin override.
              </span>
            </div>

            <div className="r9-field">
              <span className="lbl">How it arrived</span>
              <div className="r9-source">
                {capture.source_options.map(o => (
                  <button key={o.id} className={source === o.id ? "on" : ""} onClick={() => setSource(o.id)}>
                    <span className="t">{o.label}</span>
                    <span className="h">{o.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="r9-systems">
            <div className="r9-system pending">
              <div className="k">Now · HubSpot</div>
              <div className="v">Deal moves <strong>{hubspot.from_stage} → {hubspot.to_stage}</strong> at {usd9(hubspot.amount)}. Acceptance is a sales fact — it closes when the customer says yes.</div>
              <span className="badge">fires on record</span>
            </div>
            <div className="r9-system pending">
              <div className="k">Later · NetSuite</div>
              <div className="v">No Sales Order yet. The SO is pushed when you <strong>send the order</strong> from Sales Order — that's the irreversible act.</div>
              <span className="badge">not yet</span>
            </div>
          </div>

          <div className="r8-dn">
            <div className="dn-eyebrow">DN · one decision, one capture</div>
            R8 asked the PM to perform two ceremonies for one customer decision — acceptance with its own orientation panel and confirm, then tier selection with a heavier gate. Customers accept and name a tier in the same breath, so this is now a transcription: their words, the tier, how it arrived. The <em>choice</em> of tier happens here; the <em>commitment</em> still happens at the lock. Separating those two is what lets the ceremony collapse without moving the irreversible act.
          </div>
        </div>
      </div>

      <window.AdvanceBar
        weight="light"
        back={{ label: "Client Review", onClick: () => onGo("review") }}
        mid={error ? "push failed · state unchanged (sent)" : `quote state · sent · recording ${tier.label}`}
        caption="Reversible — rollback and revise both stay available"
        label={pushing ? "Recording…" : `Record acceptance · ${tier.label}`}
        disabled={pushing}
        onAdvance={() => { onVariant("pushing"); setTimeout(() => onVariant("recorded"), 1400); }}
      />
    </div>
  );
}

// ═══ SUB-TAB 5 · SALES ORDER ═════════════════════════════
// ONE LAYOUT, THREE STATES: pending · failed · record.
// The tab is a RECEIPT the PM reads and signs — not a ceremony they perform.
// Every element holds its position across the three states; only the status
// ledger and the header stamp change. That constancy is what makes the tab a
// permanent home for the order rather than a transient confirm screen.

function OrderReceipt({ state, tier }) {
  const { sales_order: so, customer, quote, netsuite, hubspot, tier_intent, so_flags } = R9();
  const placed = state === "record";
  const subtotal = so.lines.reduce((a, l) => a + l.qty * l.unit, 0);
  const oneTime = so.one_time.reduce((a, o) => a + o.amount, 0);
  const total = subtotal + oneTime;
  const units = so.lines.reduce((a, l) => a + l.qty, 0);

  return (
    <div className="r9-so">
      <div className="r9-so-head">
        <div className="who">
          <div className="t">{customer.name}</div>
          <div className="s">
            {tier.label} · {tier.qty.toLocaleString()} units per SKU · {units.toLocaleString()} units total<br />
            against {quote.quote_number} v{quote.sent_version} · accepted {tier_intent.captured_at.split(" ")[0]}
          </div>
        </div>
        <div className="stamp">
          {placed
            ? <div className="n">{netsuite.so_id}</div>
            : <div className="n pending">no order number yet</div>}
          <div className="d">{placed ? "created " + netsuite.pushed_at : "NetSuite Sales Order"}</div>
        </div>
      </div>

      <div className="r9-so-meta">
        <div className="cell">
          <div className="k">NetSuite account</div>
          <div className="v">
            <strong>{so.netsuite_customer.name}</strong><br />
            <span className="mono">{so.netsuite_customer.id}</span>
            {so.netsuite_customer.matched && <span className="ok">✓ matched</span>}
          </div>
        </div>
        <div className="cell">
          <div className="k">Ship to</div>
          <div className="v">{so.ship_to}</div>
        </div>
        <div className="cell">
          <div className="k">Terms</div>
          <div className="v">{so.terms}<br /><span className="mono">{so.incoterms}</span></div>
        </div>
        <div className="cell">
          <div className="k">Requested ship</div>
          <div className="v">{short9(so.requested_ship)}, 2026</div>
        </div>
      </div>

      <div className="r9-so-lines">
        <div className="r9-so-lrow head">
          <span>Item</span><span style={{ textAlign: "right" }}>Qty</span>
          <span style={{ textAlign: "right" }}>Unit</span><span style={{ textAlign: "right" }}>Extended</span>
        </div>
        {so.lines.map(l => (
          <div className="r9-so-lrow" key={l.id}>
            <span className="desc">
              <span className="n">{l.name}</span>
              <span className="m"><span className="code">{l.code}</span> · {l.pack}</span>
            </span>
            <span className="num qty">{l.qty.toLocaleString()}</span>
            <span className="num unit">{usd9(l.unit, 2)}</span>
            <span className="num ext">{usd9(l.qty * l.unit)}</span>
          </div>
        ))}
        {so.one_time.map(o => (
          <div className="r9-so-lrow onetime" key={o.id}>
            <span className="desc">
              <span className="n">{o.label}</span>
              <span className="s">{o.sub}</span>
            </span>
            <span className="num qty">1</span>
            <span className="num unit">—</span>
            <span className="num ext">{usd9(o.amount)}</span>
          </div>
        ))}
      </div>

      <div className="r9-so-totals">
        <div className="r9-so-trow"><span className="k">Product subtotal</span><span className="v">{usd9(subtotal)}</span></div>
        <div className="r9-so-trow"><span className="k">One-time charges</span><span className="v">{usd9(oneTime)}</span></div>
        <div className="r9-so-trow grand"><span className="k">Order total</span><span className="v">{usd9(total)}</span></div>
      </div>

      {so_flags.map(f => (
        <div className={"r9-so-flag " + f.level} key={f.label}>
          <span className="g">{f.level === "bad" ? "✕" : "!"}</span>
          <span><span className="t">{f.label}</span><span className="s">{f.detail}</span></span>
        </div>
      ))}

      <div className="r9-so-status">
        <div className="r9-so-srow done">
          <span className="icon">✓</span>
          <span className="lbl"><strong>HubSpot</strong> — deal set to {hubspot.to_stage} at {usd9(hubspot.amount)}</span>
          <span className="val">done at acceptance</span>
        </div>
        <div className={"r9-so-srow " + (placed ? "done" : state === "failed" ? "fail" : "")}>
          <span className="icon">{placed ? "✓" : state === "failed" ? "!" : "·"}</span>
          <span className="lbl">
            <strong>NetSuite</strong> — Sales Order{" "}
            {placed
              ? <span>{netsuite.so_id} created · {netsuite.status_on_push}</span>
              : state === "failed"
                ? <span>not created — endpoint rejected the order</span>
                : <span>will be created as {netsuite.status_on_push}</span>}
          </span>
          <span className="val">{placed ? "created" : state === "failed" ? "failed" : "not yet"}</span>
        </div>
        <div className={"r9-so-srow " + (placed ? "done" : "")}>
          <span className="icon">{placed ? "✓" : "·"}</span>
          <span className="lbl"><strong>Quote</strong> — {placed ? "locked as the canonical record" : "stays reversible until the order is sent"}</span>
          <span className="val">{placed ? "locked" : "not yet"}</span>
        </div>
      </div>
    </div>
  );
}

// Confirm step. NO typed gate — see docs/r9-designer-notes.md §R9.1-3.
// The receipt carries the weight; the modal states the consequence once.
function SendOrderModal({ tier, total, onClose, onConfirm }) {
  const { customer, netsuite, sales_order: so } = R9();
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="r8-final-head">
          <p className="eyebrow">Send order · irreversible</p>
          <h2>Send this order to NetSuite for <em>{customer.name}</em>?</h2>
        </div>
        <div className="modal-body">
          <div style={{ background: "var(--paper-2)", border: "1px solid var(--rule)", borderRadius: 8, padding: "13px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 500 }}>
                {tier.label} · {so.netsuite_customer.id}
              </span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--ink)" }}>{usd9(total)}</span>
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 5, letterSpacing: "0.03em" }}>
              {so.lines.length} product lines + {so.one_time.length} one-time · {netsuite.status_on_push}
            </div>
          </div>
          <div>
            <p className="eyebrow" style={{ marginBottom: 6 }}>This will</p>
            <ul className="r8-consequences">
              <li><span className="g">→</span><span>Create the <strong>Sales Order</strong> in NetSuite · {netsuite.status_on_push}</span></li>
              <li><span className="g">→</span><span>Set quote state <code>accepted</code> → <strong><code>complete</code></strong></span></li>
              <li><span className="g">🔒</span><span>Make the <strong>entire Quote umbrella read-only</strong></span></li>
              <li><span className="g">🔒</span><span>Disable <strong>Revise</strong> and <strong>roll back acceptance</strong> — both work right up until this click</span></li>
            </ul>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55 }}>
            Cancelling an order after it exists means cancelling it in NetSuite, not here.
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel — keep it reversible</button>
          <button className="r8-adv-btn heavy" onClick={onConfirm}>
            <span className="lock">🔒</span> Send order to NetSuite
          </button>
        </div>
      </div>
    </div>
  );
}

function SalesOrderTab({ variant, onGo, onVariant, tierId, setTierId }) {
  const { tiers, policy, customer, quote, netsuite, hubspot, tier_intent, failures, sales_order: so } = R9();
  const [modal, setModal] = useState(false);
  const [openOverride, setOpenOverride] = useState(false);
  const tier = tiers.find(t => t.id === tierId);
  const named = tiers.find(t => t.id === tier_intent.tier_id);
  const overridden = tierId !== tier_intent.tier_id;
  const blocked = tier.status === "below_floor";
  const pushing = variant === "pushing";
  const failed = variant === "failed";
  const placed = variant === "record";
  const state = placed ? "record" : failed ? "failed" : "pending";

  const subtotal = so.lines.reduce((a, l) => a + l.qty * l.unit, 0);
  const total = subtotal + so.one_time.reduce((a, o) => a + o.amount, 0);

  const heading = placed
    ? <span>Order <em>{netsuite.so_id}</em> is placed</span>
    : failed
      ? <span>The order didn't reach <em>NetSuite</em></span>
      : <span>Send <em>{customer.name}'s</em> order to NetSuite</span>;

  const lede = placed
    ? "This is the canonical record of what was agreed and what was ordered. The quote and every sub-tab are read-only."
    : failed
      ? "Two things are true at once — read both before you retry."
      : "Everything below goes to NetSuite exactly as shown. Read it, then send.";

  return (
    <div className="r9-wrap">
      <div className="r8-cols">
        <div>
          <p className="eyebrow">
            Sub-tab 5 · Sales Order · {placed ? "record" : failed ? "push failed" : "pending"}
          </p>
          <h1 className="r8-h1">{heading}</h1>
          <p className="r8-sub">{lede}</p>

          {failed && (
            <div className="r9-so-split">
              <div className="half held">
                <div className="k"><span>✓</span> still true</div>
                <div className="t">The customer accepted</div>
                <div className="s">
                  {customer.contact} accepted {quote.quote_number} v{quote.sent_version} at {named.label}, and the
                  HubSpot deal is <strong>{hubspot.to_stage}</strong> at {usd9(hubspot.amount)}. Nothing about the
                  acceptance is undone, and you don't need to re-record it.
                </div>
              </div>
              <div className="half lost">
                <div className="k"><span>✕</span> did not happen</div>
                <div className="t">The order was not placed</div>
                <div className="s">
                  No Sales Order exists in NetSuite. The quote is still <code>accepted</code> and still
                  reversible — retry when you're ready.
                </div>
                <div className="err">
                  {failures.netsuite.code} · {failures.netsuite.detail}<br />
                  last attempt {failures.netsuite.at} · {failures.netsuite.attempts} attempt
                </div>
                <div className="acts">
                  <button className="btn sm" onClick={() => setModal(true)}>Retry send</button>
                  <button className="btn sm ghost">Copy error</button>
                </div>
              </div>
            </div>
          )}

          <OrderReceipt state={state} tier={tier} />

          {!placed && (
            <div className="r9-prov" style={{ marginTop: 12 }}>
              <span>◆</span>
              {overridden
                ? <span>Overriding the recorded acceptance — customer named {named.label}, this order is {tier.label}.</span>
                : <span>Tier carried from acceptance — {tier_intent.provenance}. Recorded by {tier_intent.captured_by}, {tier_intent.captured_at}.</span>}
            </div>
          )}

          {!placed && (
            <div className="r9-override">
              <button className="trigger" onClick={() => setOpenOverride(o => !o)}>
                <span className="chev">{openOverride ? "▾" : "▸"}</span>
                Order a different tier than the one they accepted
              </button>
              {openOverride && (
                <div className="panel">
                  <p className="warn-line">
                    {customer.contact} accepted at <strong>{named.label}</strong>. Ordering a different tier
                    contradicts the recorded acceptance — the override is logged to the quote.
                  </p>
                  <div className="r9-tierchips">
                    {tiers.map(t => {
                      const dis = t.status === "below_floor";
                      return (
                        <button key={t.id} className={"r9-chip" + (t.id === tierId ? " on" : "") + (dis ? " disabled" : "")}
                          onClick={dis ? undefined : () => setTierId(t.id)} disabled={dis}>
                          <span className="top">
                            <span className="tl">{t.label}</span>
                            {t.recommended && <span className="star">★</span>}
                            {t.id === tier_intent.tier_id && <span className="named">accepted</span>}
                          </span>
                          <span className="q">{t.qty.toLocaleString()} units</span>
                          <span className={"m " + t.status}>{t.margin_pct.toFixed(1)}% margin</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {blocked && !placed && (
            <div className="r8-card" style={{ marginTop: 14, borderColor: "oklch(from var(--bad) l c h / 0.4)", background: "var(--bad-soft)" }}>
              <p className="eyebrow" style={{ color: "var(--bad)", marginBottom: 6 }}>Order blocked · firm policy gate</p>
              <p style={{ margin: "0 0 11px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                {tier.label} margin is {tier.margin_pct.toFixed(1)}%, below the {policy.floor_pct}% floor.
                Sending requires an admin override, logged to the quote.
              </p>
              <button className="btn bad sm" style={{ borderStyle: "dashed" }}>⚡ Request admin override</button>
            </div>
          )}

          <div className="r8-dn">
            <div className="dn-eyebrow">DN · {placed ? "why the tab is non-optional" : failed ? "holding two facts at once" : "a receipt, not a ceremony"}</div>
            {placed
              ? <span>A completed quote needs a permanent home for the most important facts about itself — order number, what was ordered, what it cost, when it was placed. That's this state, and it's the reason the tab exists independent of the confirm.</span>
              : failed
                ? <span>The screen has to say <em>deal closed</em> and <em>order not placed</em> simultaneously, without reading as total failure. Two halves, one green and one red, sharing a border. This is also why the failure needs a tab rather than a modal — a dismissible surface takes the error away with it, and the PM loses the only place that says what still needs doing.</span>
                : <span>Selection moved to Acceptance, so what's left here isn't a thinner confirm — it's the order itself. The receipt carries the weight the typed gate used to: the PM reads real lines, real totals, the account it lands under, and a status ledger that says "not yet" three times.</span>}
          </div>
        </div>

        <div className="r8-side">
          {!placed && (
            <div className="r8-card">
              <p className="eyebrow" style={{ marginBottom: 10 }}>All tiers · compliance</p>
              {tiers.map(t => (
                <div key={t.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10,
                  padding: "7px 0", borderTop: "1px solid var(--rule)", opacity: t.id === tierId ? 1 : 0.62,
                }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-2)", letterSpacing: "0.03em" }}>
                    {t.label} · {t.qty.toLocaleString()}
                  </span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>
                    <span style={{ color: "var(--ink-3)" }}>{usd9(t.turnkey)} · </span>
                    <span style={{ color: t.status === "good" ? "var(--good)" : t.status === "below_target" ? "var(--warn)" : "var(--bad)" }}>
                      {t.margin_pct.toFixed(1)}%
                    </span>
                  </span>
                </div>
              ))}
              <p className="mono" style={{ fontSize: 9.5, color: "var(--ink-4)", letterSpacing: "0.04em", marginTop: 9 }}>
                Target {policy.target_pct}% · floor {policy.floor_pct}% · read-only, from Pricing
              </p>
            </div>
          )}

          {!placed && (
            <div className="r8-card">
              <p className="eyebrow" style={{ marginBottom: 8 }}>Still reversible — until you send</p>
              <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.7 }}>
                <li>Roll back the acceptance</li>
                <li>Revise into a new version</li>
                <li>Change the ordered tier</li>
              </ul>
              <button className="btn sm ghost" style={{ marginTop: 10, width: "100%" }} onClick={() => onGo("accepted")}>
                ← Back to acceptance
              </button>
            </div>
          )}

          {placed && (
            <div className="r8-card">
              <p className="eyebrow" style={{ marginBottom: 8 }}>What's next</p>
              <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
                <li>Production schedule from the SO</li>
                <li>Project moves to <code>in-production</code></li>
                <li>Deposit invoice on PO confirmation</li>
              </ul>
            </div>
          )}
          {placed && (
            <div className="r8-card">
              <p className="eyebrow" style={{ marginBottom: 8 }}>If something's wrong</p>
              <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55 }}>
                The order is irreversible in the PM's hands. An admin can unlock the quote with a reason; the
                Sales Order must be cancelled in NetSuite separately.
              </p>
              <button className="btn sm ghost">Request unlock (admin)</button>
            </div>
          )}
        </div>
      </div>

      {placed ? (
        <div className="r8-advance">
          <div className="back"><button className="btn ghost sm" onClick={() => onVariant("pending")}>← Reset prototype to pending</button></div>
          <div className="mid">quote state · complete · umbrella read-only</div>
          <div className="fwd">
            <span className="cap">No advance — this is the end of the lifecycle</span>
            <a className="r8-solink" href={netsuite.link} target="_blank" rel="noreferrer">Open {netsuite.so_id} ↗</a>
          </div>
        </div>
      ) : (
        <window.AdvanceBar
          weight="heavy"
          back={{ label: "Acceptance", onClick: () => onGo("accepted") }}
          mid={pushing ? "sending order…" : tier.label + " · " + usd9(total) + " · " + so.netsuite_customer.id}
          caption={blocked ? "Blocked — below floor, admin override required" : "Irreversible — creates a Sales Order in NetSuite"}
          label={pushing ? "Sending…" : failed ? "Retry — send order to NetSuite" : "Send order to NetSuite"}
          disabled={blocked || pushing}
          onAdvance={() => setModal(true)}
        />
      )}

      {modal && (
        <SendOrderModal tier={tier} total={total} onClose={() => setModal(false)}
          onConfirm={() => { setModal(false); onVariant("pushing"); setTimeout(() => onVariant("record"), 1600); }} />
      )}
    </div>
  );
}

// ═══ Sub-tab strip · R9 label set ════════════════════════
// Identical to R8's SubTabStrip in structure and CSS — three STRING changes:
// tab 4 "Mark Accepted" → "Acceptance" (in data), tab 5 "Tier Selection" →
// "Sales Order" (in data), threshold caption "lock threshold" → "lock".
// CC changes strings in their existing component; no structural or CSS change.
function SubTabStrip9({ activeId, qstate, onGo, feedCount }) {
  const tabs = R9().subtabs;
  const activeIdx = tabs.findIndex(t => t.id === activeId);
  const locked = qstate === "complete";

  const statusFor = (t, i) => {
    if (locked) return "locked";
    if (i === activeIdx) return "current";
    if (i < activeIdx) return "done";
    return "upcoming";
  };
  const subFor = (t, i, st) => {
    if (st === "locked") return "locked";
    if (st === "done") return "done · revisitable";
    if (st === "current") return t.kind === "lock" ? "ready to send" : t.kind === "log" ? "logging" : "in progress";
    return "awaiting " + t.state_req;
  };

  const children = [];
  tabs.forEach((t, i) => {
    if (i === 4) {
      children.push(
        <div className="r8-threshold" key="threshold" aria-hidden="true" title="Everything left of this line is reversible">
          <span className="glyph">🔒</span>
          <span className="cap">lock</span>
        </div>
      );
    }
    const st = statusFor(t, i);
    const clickable = st === "done" || st === "current";
    children.push(
      <button key={t.id} role="tab" aria-selected={st === "current"}
        className={"r8-tab " + st + (t.kind === "log" ? " log" : "")}
        onClick={clickable ? () => onGo(t.id) : undefined} disabled={!clickable}>
        <span className="num">{st === "done" ? "✓" : st === "locked" ? "🔒" : t.n}</span>
        <span className="txt">
          <span className="lab">
            {t.label}
            {t.kind === "log" && feedCount > 0 && <span className="feedcount">{feedCount}</span>}
          </span>
          <span className="sub">{subFor(t, i, st)}</span>
        </span>
      </button>
    );
  });

  return <div className="r8-strip" role="tablist">{children}</div>;
}

// ═══ Shell — reuses R8 tabs 1–3 verbatim ═════════════════
const VARIANTS9 = {
  preview:  [{ id: "default", label: "Default" }],
  send:     [{ id: "ready", label: "① Ready to send" }, { id: "waiting", label: "② Sent · awaiting" }],
  review:   [{ id: "feed", label: "① Feed + mismatch" }, { id: "empty", label: "② Empty" }],
  accepted: [{ id: "capture", label: "① Capture" }, { id: "pushing", label: "② HubSpot pushing" }, { id: "recorded", label: "③ Recorded · handoff" }, { id: "error", label: "④ HubSpot failed" }],
  tier:     [{ id: "pending", label: "① Pending" }, { id: "pushing", label: "② Sending" }, { id: "failed", label: "③ Push failed" }, { id: "record", label: "④ Record · locked" }],
};

function QuoteUmbrellaR9({ tweaks, setTweak }) {
  const tab = tweaks.tab || "accepted";
  const variant = tweaks.variant || VARIANTS9[tab][0].id;
  const narrow = !!tweaks.narrow;
  const [tierId, setTierId] = useState(R9().tier_intent.tier_id);
  const { project, quote, review_events, netsuite, me } = R9();

  const qstate =
    tab === "tier" && variant === "record" ? "complete"
    : tab === "tier" ? "accepted"
    : tab === "accepted" && variant === "recorded" ? "accepted"
    : tab === "preview" || (tab === "send" && variant === "ready") ? "draft"
    : "sent";

  const go = id => setTweak({ tab: id, variant: VARIANTS9[id][0].id });
  const setVariant = v => setTweak("variant", v);

  const armed = qstate === "accepted";
  const complete = qstate === "complete";

  const body = () => {
    if (tab === "preview")  return <window.PreviewTab onGo={go} />;
    if (tab === "send")     return <window.SendTab variant={variant} onGo={go} onVariant={setVariant} />;
    if (tab === "review")   return <window.ReviewTab variant={variant} onGo={go} />;
    if (tab === "accepted") return <AcceptedCapture variant={variant} onGo={go} onVariant={setVariant} tierId={tierId} setTierId={setTierId} />;
    return <SalesOrderTab variant={variant} onGo={go} onVariant={setVariant} tierId={tierId} setTierId={setTierId} />;
  };

  return (
    <div className={"r8-shell" + (narrow ? " narrow" : "")}>
      <div className="r8-topbar">
        <div className="r8-crumb">
          <span className="dim">{project.client} · {project.deal} · {project.scenario} · </span>
          <strong>Quote</strong>
          <span className="dim"> · {quote.quote_number}</span>
        </div>
        <div className="r8-topbar-right">
          <span className="chip" style={{ fontSize: 10.5 }}>state · <strong style={{ marginLeft: 4 }}>{qstate}</strong></span>
          <div className="r8-proto">
            <span>state →</span>
            <div className="state-sub">
              {VARIANTS9[tab].map(v => (
                <button key={v.id} className={variant === v.id ? "active" : ""} onClick={() => setVariant(v.id)}>{v.label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {complete && (
        <div className="r8-locked-ribbon">
          <span className="seal">🔒</span>
          <div className="txt">
            <div className="heading">Complete · {netsuite.so_id} in NetSuite</div>
            <div className="meta">Order placed {netsuite.pushed_at} by {me.name} · canonical record · read-only</div>
          </div>
          <div className="right">
            <a className="r8-solink" href={netsuite.link} target="_blank" rel="noreferrer">Open in NetSuite ↗</a>
          </div>
        </div>
      )}

      <div className={armed ? "r9-armed-strip" : ""}>
        <SubTabStrip9 activeId={tab} qstate={qstate} onGo={go} feedCount={review_events.length} />
      </div>

      {!complete && <window.Legend />}
      {complete && (
        <div className="r8-readonly-note">
          <span>🔒</span> All five sub-tabs are read-only. Revise and rollback are disabled. Unlock requires admin approval.
        </div>
      )}

      <div className={"r8-body" + (narrow ? " narrowpad" : "")}>{body()}</div>
    </div>
  );
}

Object.assign(window, {
  QuoteUmbrellaR9, AcceptedCapture, SalesOrderTab, OrderReceipt, SendOrderModal,
  SubTabStrip9, VARIANTS9,
});
