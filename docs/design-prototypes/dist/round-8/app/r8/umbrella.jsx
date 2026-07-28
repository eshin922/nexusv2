/* global React, NXR8 */
// Nexus Round 8 — Quote umbrella (5-sub-tab reversible lifecycle)
// Pattern 30 prototype. Sub-tabs: Preview · Send · Client Review · Mark Accepted · Tier Selection.
// Design canon: everything is reversible until the NetSuite SO push (Tier Selection → Complete).
// The visual asymmetry between light advances and the one heavy advance IS the design.

const { useState } = React;
const R8 = () => window.NXR8;

function usd(n, dec = 0) {
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function shortDate(s) {
  return new Date(s + (s.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ═══ 2.1 · Sub-tab strip ═════════════════════════════════
// Tab status derives from quote state + strict-sequential order.
// Completed tabs stay reachable (they're reversible) — until Complete locks all.
function SubTabStrip({ activeId, qstate, onGo, feedCount }) {
  const tabs = R8().subtabs;
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
    if (st === "current") return t.kind === "lock" ? "the lock" : t.kind === "log" ? "logging" : "in progress";
    return "awaiting " + t.state_req;
  };

  // Flat keyed array — .r8-tab and .r8-threshold must stay direct flex children
  // of .r8-strip, so no Fragment/wrapper is available here.
  const children = [];
  tabs.forEach((t, i) => {
    if (i === 4) {
      children.push(
        <div className="r8-threshold" key="threshold" aria-hidden="true" title="Everything left of this line is reversible">
          <span className="glyph">🔒</span>
          <span className="cap">lock threshold</span>
        </div>
      );
    }
    const st = statusFor(t, i);
    const clickable = st === "done" || st === "current";
    children.push(
      <button
        key={t.id}
        role="tab"
        aria-selected={st === "current"}
        className={`r8-tab ${st}${t.kind === "log" ? " log" : ""}`}
        onClick={clickable ? () => onGo(t.id) : undefined}
        disabled={!clickable}
      >
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

function Legend() {
  return (
    <div className="r8-legend">
      <span className="item"><span className="rev">↺</span> steps 1–4 are reversible — a sent quote can be revised, an acceptance rolled back</span>
      <span className="item"><span className="irr">🔒</span> step 5 pushes a NetSuite Sales Order — the only irreversible act</span>
    </div>
  );
}

// ═══ 3 · Advance bar ═════════════════════════════════════
function AdvanceBar({ weight = "light", label, caption, mid, back, onAdvance, disabled }) {
  const heavy = weight === "heavy";
  return (
    <div className={"r8-advance" + (heavy ? " heavy" : "")}>
      <div className="back">
        {back && <button className="btn ghost sm" onClick={back.onClick}>← {back.label}</button>}
      </div>
      <div className="mid">{mid}</div>
      <div className="fwd">
        {caption && <span className="cap">{caption}</span>}
        {label && (
          <button className={"r8-adv-btn" + (heavy ? " heavy" : "")} onClick={onAdvance} disabled={disabled}>
            {heavy && <span className="lock">🔒</span>}
            {label}
          </button>
        )}
      </div>
    </div>
  );
}

// ═══ 2.2 · Preview Quote ═════════════════════════════════
function PreviewTab({ onGo }) {
  const { versions, quote, customer } = R8();
  const [sel, setSel] = useState(quote.draft_version);
  const v = versions.find(x => x.v === sel);

  return (
    <div className="r8-wrap">
      <div className="r8-cols">
        <div>
          <p className="eyebrow">Sub-tab 1 · Preview Quote</p>
          <h1 className="r8-h1">Preview what <em>{customer.name}</em> receives</h1>
          <p className="r8-sub">
            The customer PDF, rendered from this quote's data. Pick the version you want to look at —
            drafts and sent versions both preview here.
          </p>

          <div className="r8-card flush">
            <div className="r8-card-head">
              <p className="eyebrow" style={{ margin: 0 }}>Version</p>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)", letterSpacing: "0.04em" }}>
                {quote.quote_number} · 4 versions · same quote number
              </span>
            </div>
            <div className="r8-vpick">
              {[...versions].reverse().map(ver => (
                <button key={ver.v} className={"r8-vrow" + (ver.v === sel ? " active" : "")} onClick={() => setSel(ver.v)}>
                  <span className="vlab">{ver.label}</span>
                  <span>
                    <span className="vnote">{ver.note}</span>
                    <span className="vmeta">{shortDate(ver.created)}{ver.sent ? ` · sent to ${quote.sent_to}` : ""}</span>
                  </span>
                  <span>
                    <span className={"r8-vtag " + ver.status}>{ver.status}</span>
                    <span className="vtotal" style={{ display: "block", marginTop: 4 }}>{usd(ver.total)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="r8-dn">
            <div className="dn-eyebrow">DN · why a picker, not a dropdown</div>
            Four versions with notes and totals is a <em>comparison</em>, not a selection. The rows show what changed and what it costs, so the PM can tell v3-sent from v4-draft at a glance — the same distinction the mismatch banner depends on downstream.
          </div>
        </div>

        <div className="r8-side">
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 10 }}>Previewing {v.label}</p>
            <div className="r8-pdfframe">
              <div className="bar">
                <span>{quote.quote_number} · {v.label}</span>
                <span>{v.sent ? "sent version" : v.status}</span>
              </div>
              <div className="sheet">
                <div className="l t" /><div className="l" /><div className="l s" />
                <div className="l tbl" /><div className="l" /><div className="l s" />
                <div className="cap">Slice 11 · customer PDF render</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn sm">⤓ Download PDF</button>
              <button className="btn sm ghost">Open full preview</button>
            </div>
          </div>
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>Reused, not redesigned</p>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              The PDF itself shipped in Slice 11. This sub-tab supplies the frame: version selection, download, and the advance into Send.
            </p>
          </div>
        </div>
      </div>

      <AdvanceBar
        weight="light"
        mid={`previewing ${v.label} · ${v.status}`}
        caption="Reversible — you can come back and revise"
        label="Continue to Send →"
        onAdvance={() => onGo("send")}
      />
    </div>
  );
}

// ═══ 2.3 · Send to Client ════════════════════════════════
function SendConfirmModal({ onClose, onSend, version }) {
  const { customer, quote } = R8();
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <div className="titles">
            <p className="eyebrow">Send to client</p>
            <h2>Send {quote.quote_number} <em style={{ color: "var(--ink-3)" }}>{version}</em> to {customer.contact}?</h2>
          </div>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
            {customer.contact} ({customer.email}) will receive the {version} PDF. You'll be able to log their
            response in Client Review, and revise the quote if they ask for changes.
          </p>
          <div className="r8-defs">
            <div className="row"><span className="k">to</span><span className="v">{customer.contact} · {customer.email}</span></div>
            <div className="row"><span className="k">attaching</span><span className="v">{quote.quote_number} {version} · customer PDF</span></div>
            <div className="row"><span className="k">quote state</span><span className="v"><code>draft</code> → <code>sent</code></span></div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={onSend}>Send to {customer.contact.split(" ")[0]}</button>
        </div>
      </div>
    </div>
  );
}

function SendTab({ variant, onGo, onVariant }) {
  const { customer, quote, versions } = R8();
  const [modal, setModal] = useState(false);
  const waiting = variant === "waiting";
  const sentV = versions.find(v => v.sent);

  return (
    <div className="r8-wrap">
      <div className="r8-cols">
        <div>
          <p className="eyebrow">Sub-tab 2 · Send to Client</p>
          {waiting ? (
            <div className="r8-wrap">
              <h1 className="r8-h1">Sent — <em>awaiting {customer.contact.split(" ")[0]}</em></h1>
              <p className="r8-sub">
                The quote is with the customer. Nothing further is required of you here; log what comes
                back in Client Review.
              </p>
              <div className="r8-wait">
                <span className="pulse" />
                <div className="txt">
                  <h4>{quote.quote_number} {sentV.label} sent to {customer.email}</h4>
                  <p>
                    Sent {shortDate(quote.sent_at)} · 13 days ago. Valid until {shortDate(quote.valid_until)}.
                    Customer activity gets logged in Client Review — 4 entries so far.
                  </p>
                  <span className="meta">quote.state = sent · sent_version = {quote.sent_version} · sent_at {quote.sent_at}</span>
                  <div className="acts">
                    <button className="btn sm" onClick={() => onGo("review")}>Open Client Review →</button>
                    <button className="btn sm ghost">Re-send PDF</button>
                    <button className="btn sm ghost">⤓ Download sent PDF</button>
                  </div>
                </div>
              </div>

              <div className="r8-revise" style={{ marginTop: 14 }}>
                <div className="txt">
                  <div className="t">Need to change something?</div>
                  <div className="s">Revise returns this quote to editable draft as v{quote.sent_version + 1}. Same quote, same number — nothing is lost.</div>
                </div>
                <button className="btn sm">↺ Revise quote</button>
              </div>

              <div className="r8-dn">
                <div className="dn-eyebrow">DN · the gap this fills</div>
                Before this round there was no "sent, awaiting customer" surface at all — the PM sent a quote and the UI went quiet. The waiting state's job is to say <em>nothing is expected of you right now</em>, and point at the one place where something might be.
              </div>
            </div>
          ) : (
            <div className="r8-wrap">
              <h1 className="r8-h1">Send {quote.quote_number} to <em>{customer.name}</em></h1>
              <p className="r8-sub">
                {customer.contact} receives the customer PDF by email. Sending is reversible — you can revise
                and re-send as a new version at any point before acceptance is finalized.
              </p>
              <div className="r8-card">
                <div className="r8-defs">
                  <div className="row"><span className="k">recipient</span><span className="v">{customer.contact} · {customer.role}</span></div>
                  <div className="row"><span className="k">email</span><span className="v">{customer.email}</span></div>
                  <div className="row"><span className="k">version</span><span className="v">v{quote.draft_version} (draft) · {usd(versions[3].total)}</span></div>
                  <div className="row"><span className="k">valid until</span><span className="v">{shortDate(quote.valid_until)}</span></div>
                </div>
              </div>
              <div className="r8-dn">
                <div className="dn-eyebrow">DN · light by design</div>
                No finalization-grade warning here. Send is reversible, so it gets an ordinary confirm that states what the customer will receive — not a consequence list. Reserving ceremony for the one irreversible act is what makes that ceremony legible.
              </div>
            </div>
          )}
        </div>

        <div className="r8-side">
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>What sending does</p>
            <ol style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
              <li>Emails the PDF to {customer.contact.split(" ")[0]}</li>
              <li>Quote state <code>draft</code> → <code>sent</code></li>
              <li>Stamps <code>sent_version</code> + <code>sent_at</code></li>
              <li>Opens Client Review for logging</li>
              <li>Logs a <code>sent</code> feed entry</li>
            </ol>
            <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
              It does <strong>not</strong> lock anything. Revise stays available.
            </p>
          </div>
        </div>
      </div>

      {waiting ? (
        <AdvanceBar
          weight="light"
          back={{ label: "Preview", onClick: () => onGo("preview") }}
          mid="quote state · sent · awaiting customer"
          caption="Reversible — Mark Accepted can be rolled back"
          label="Mark Accepted →"
          onAdvance={() => onGo("accepted")}
        />
      ) : (
        <AdvanceBar
          weight="light"
          back={{ label: "Preview", onClick: () => onGo("preview") }}
          mid="quote state · draft"
          caption="Reversible — revise and re-send any time"
          label="Send to client"
          onAdvance={() => setModal(true)}
        />
      )}

      {modal && (
        <SendConfirmModal
          version={"v" + quote.draft_version}
          onClose={() => setModal(false)}
          onSend={() => { setModal(false); onVariant("waiting"); }}
        />
      )}
    </div>
  );
}

// ═══ 2.4 · Client Review (the new sub-tab) ═══════════════
function MismatchBanner({ onDismiss }) {
  const { quote } = R8();
  return (
    <div className="r8-mismatch">
      <span className="icon">!</span>
      <div className="txt">
        <h4>You sent <strong>v{quote.sent_version}</strong> on {shortDate(quote.sent_at)} · current draft is <strong>v{quote.draft_version}</strong></h4>
        <p>
          The customer is responding to <strong>v{quote.sent_version}</strong>. Your v{quote.draft_version} edits
          aren't visible to them until you send again. Acceptance records against the version the customer actually saw.
        </p>
        <div className="acts">
          <button className="btn sm">View v{quote.sent_version} (sent)</button>
          <button className="btn sm">Compare v{quote.sent_version} ↔ v{quote.draft_version}</button>
          <button className="btn sm">Send v{quote.draft_version} to customer</button>
          <button className="btn sm ghost" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

function AddEntry({ onAdd }) {
  const { event_types } = R8();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("responded");
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <div className="r8-addentry">
        <button className="trigger" onClick={() => setOpen(true)}>
          <span className="plus">+</span> Log customer activity…
        </button>
      </div>
    );
  }
  return (
    <div className="r8-addentry">
      <div className="form">
        <div className="r8-typepick">
          {event_types.map(t => (
            <button key={t.id} className={type === t.id ? "on" : ""} onClick={() => setType(t.id)}>
              <span className="t">{t.label}</span>
              <span className="h">{t.hint}</span>
            </button>
          ))}
        </div>
        <textarea
          placeholder="What happened? e.g. Beth called — wants the capsule SKU out and T2 pricing held."
          value={note}
          onChange={e => setNote(e.target.value)}
        />
        <div className="formfoot">
          <span className="hint">appended to the log · timestamped · not customer-visible</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost sm" onClick={() => { setOpen(false); setNote(""); }}>Cancel</button>
            <button className="btn primary sm" disabled={!note.trim()}
              onClick={() => { onAdd({ type, note }); setOpen(false); setNote(""); }}>
              Log entry
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewTab({ variant, onGo }) {
  const { review_events, event_types, customer, quote } = R8();
  const empty = variant === "empty";
  const [events, setEvents] = useState(empty ? [] : review_events);
  const [showBanner, setShowBanner] = useState(true);

  const label = id => (event_types.find(t => t.id === id) || { label: id === "sent" ? "Sent" : id }).label;

  const add = ({ type, note }) => setEvents(prev => [
    { id: "ev" + (prev.length + 90), type, note, author: R8().me.name, at: "2026-07-27 14:05" },
    ...prev,
  ]);

  return (
    <div className="r8-wrap">
      <div className="r8-cols">
        <div>
          <p className="eyebrow">Sub-tab 3 · Client Review</p>
          <h1 className="r8-h1">Track what comes back from <em>{customer.name}</em></h1>
          <p className="r8-sub">
            Your log of the review window — not a message thread, and not visible to the customer.
            Note what they said, what you asked, and what they want changed.
          </p>

          {!empty && showBanner && <MismatchBanner onDismiss={() => setShowBanner(false)} />}

          <div className="r8-card flush">
            <div className="r8-card-head">
              <p className="eyebrow" style={{ margin: 0 }}>Activity log</p>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)", letterSpacing: "0.04em" }}>
                {events.length ? `${events.length} entries · append-only` : "append-only"}
              </span>
            </div>

            {events.length === 0 ? (
              <div className="r8-empty">
                <div className="glyph">▤</div>
                <h4>No customer activity logged yet.</h4>
                <p>When {customer.contact.split(" ")[0]} replies, asks something, or requests changes, log it here so the review window has a record.</p>
              </div>
            ) : (
              <div className="r8-feed">
                {events.map(ev => (
                  <div key={ev.id} className={`r8-fitem t-${ev.type}${ev.system ? " system" : ""}`}>
                    <span className="spine"><span className="dot" /></span>
                    <div>
                      <div className="head">
                        <span className={"r8-etype " + ev.type}>{label(ev.type)}</span>
                        <span className="who">{ev.author}</span>
                        <span className="when">{ev.at}</span>
                      </div>
                      <div className="note">{ev.note}</div>
                      {ev.type === "revision_requested" && (
                        <div className="inline-act">
                          <button className="btn sm">↺ Revise quote → v{quote.draft_version}</button>
                          <button className="btn sm ghost">Mark handled</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <AddEntry onAdd={add} />
          </div>

          <div className="r8-dn">
            <div className="dn-eyebrow">DN · a log, not a form</div>
            Hairline timeline, no cards, add-entry collapsed to a single line until used. The moment this surface acquires card chrome and a permanent open form it starts reading as a task to complete rather than a place to jot. Event types are chips, not a select — three today, extensible, and cheap to scan.
          </div>
        </div>

        <div className="r8-side">
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>Revise this quote</p>
            <p style={{ margin: "0 0 11px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              Returns the sent quote to editable draft as <strong>v{quote.draft_version}</strong>. Same quote,
              same number — notes, associations, cost data and this log all carry over.
            </p>
            <button className="btn" style={{ width: "100%" }}>↺ Revise → v{quote.draft_version}</button>
            <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
              The customer sees "revised quote {quote.quote_number}" — the number never changes.
            </p>
          </div>
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>This log is not</p>
            <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.7 }}>
              <li>customer-facing</li>
              <li>a message thread</li>
              <li>a revision manager</li>
            </ul>
          </div>
        </div>
      </div>

      <AdvanceBar
        weight="light"
        back={{ label: "Send", onClick: () => onGo("send") }}
        mid={`quote state · sent · ${events.length} logged ${events.length === 1 ? "entry" : "entries"}`}
        caption="Reversible — acceptance can be rolled back"
        label="Mark Accepted →"
        onAdvance={() => onGo("accepted")}
      />
    </div>
  );
}

// ═══ 2.5 · Mark Accepted ═════════════════════════════════
function AcceptedTab({ variant, onGo, onVariant }) {
  const { customer, quote, hubspot, versions, tiers, customer_signal } = R8();
  const sentV = versions.find(v => v.sent);
  const signalTier = tiers.find(t => t.id === customer_signal.tier_id);

  const pushing = variant === "pushing";
  const confirmed = variant === "confirmed";
  const error = variant === "error";

  return (
    <div className="r8-wrap">
      <div className="r8-cols">
        <div>
          <p className="eyebrow">Sub-tab 4 · Mark Accepted</p>
          <h1 className="r8-h1">
            {confirmed ? <span>Acceptance recorded for <em>{customer.name}</em></span>
                       : <span>Record <em>{customer.name}'s</em> acceptance</span>}
          </h1>
          <p className="r8-sub">
            {confirmed
              ? "Recorded against the sent version and pushed to HubSpot. This is reversible — roll back if it was recorded in error."
              : `You're recording acceptance on ${customer.contact}'s behalf. This is reversible: it can be rolled back to Send to Client, which reverses the HubSpot stage.`}
          </p>

          {pushing && (
            <div className="r8-push">
              <span className="spinner" />
              <div className="txt">
                <div className="t">Pushing to HubSpot…</div>
                <div className="s">deal "{hubspot.deal}" · {hubspot.from_stage} → {hubspot.to_stage}</div>
              </div>
            </div>
          )}
          {confirmed && (
            <div className="r8-push ok">
              <span className="mark">✓</span>
              <div className="txt">
                <div className="t">HubSpot updated · {hubspot.to_stage}</div>
                <div className="s">deal amount {usd(hubspot.amount)} · synced 2m ago · one push, at acceptance</div>
              </div>
              <div className="acts"><button className="btn sm ghost">View in HubSpot ↗</button></div>
            </div>
          )}
          {error && (
            <div className="r8-push error">
              <span className="mark">!</span>
              <div className="txt">
                <div className="t">HubSpot push failed — acceptance not recorded</div>
                <div className="s">403 · integration token rejected · quote.state is still <code>sent</code>. Nothing advanced; retry when the token is refreshed.</div>
              </div>
              <div className="acts">
                <button className="btn sm" onClick={() => onVariant("pushing")}>Retry push</button>
                <button className="btn sm ghost">Copy error</button>
              </div>
            </div>
          )}

          <div className="r8-card" style={{ marginTop: 14 }}>
            <p className="eyebrow" style={{ marginBottom: 10 }}>Recording against</p>
            <div className="r8-defs">
              <div className="row"><span className="k">version</span><span className="v"><strong>{sentV.label}</strong> — the version the customer saw (sent {shortDate(quote.sent_at)})</span></div>
              <div className="row"><span className="k">customer signal</span><span className="v">{signalTier.label} · {customer_signal.confidence} · from {customer_signal.source}</span></div>
              <div className="row"><span className="k">accepted by</span><span className="v">{R8().me.name} (PM proxy)</span></div>
              <div className="row"><span className="k">hubspot</span><span className="v">{hubspot.from_stage} → <code>{hubspot.to_stage}</code></span></div>
            </div>
          </div>

          {confirmed && (
            <div className="r8-rollback" style={{ marginTop: 14 }}>
              <div className="t">
                <strong>Recorded in error?</strong> Roll back to Send to Client — reverses the HubSpot stage
                and returns the quote to <code>sent</code>. The review log is untouched.
              </div>
              <button className="btn" onClick={() => onVariant("ready")}>↺ Roll back to Send to Client</button>
            </div>
          )}

          <div className="r8-dn">
            <div className="dn-eyebrow">DN · reversible, so it says so</div>
            The rollback button is a peer of the advance, not a hidden admin escape. Mark Accepted is the last reversible step, and the surface that most invites a mis-click — so the way back is stated on the surface itself rather than in a help doc.
          </div>
        </div>

        <div className="r8-side">
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>Tier comes next</p>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              Acceptance records <em>that</em> they accepted. Which tier they committed to is Tier
              Selection — the step that finalizes and pushes the Sales Order.
            </p>
          </div>
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>Still reversible here</p>
            <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.7 }}>
              <li>Roll back to <code>sent</code></li>
              <li>HubSpot stage reverses</li>
              <li>Revise into a new version</li>
              <li>Nothing has entered NetSuite</li>
            </ul>
          </div>
        </div>
      </div>

      {confirmed ? (
        <AdvanceBar
          weight="light"
          back={{ label: "Client Review", onClick: () => onGo("review") }}
          mid="quote state · accepted · reversible"
          caption="Next step is the irreversible one"
          label="Continue to Tier Selection →"
          onAdvance={() => onGo("tier")}
        />
      ) : (
        <AdvanceBar
          weight="light"
          back={{ label: "Client Review", onClick: () => onGo("review") }}
          mid={error ? "push failed · state unchanged (sent)" : "quote state · sent"}
          caption="Reversible — rollback available after recording"
          label={pushing ? "Recording…" : "Record acceptance"}
          disabled={pushing}
          onAdvance={() => { onVariant("pushing"); setTimeout(() => onVariant("confirmed"), 1400); }}
        />
      )}
    </div>
  );
}

// ═══ 2.6 · Tier Selection — THE LOCK ═════════════════════
function FinalizationModal({ tier, onClose, onConfirm }) {
  const { customer, quote, netsuite } = R8();
  const [typed, setTyped] = useState("");
  const ok = typed.trim().toUpperCase() === "FINALIZE";
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal lg" onClick={e => e.stopPropagation()}>
        <div className="r8-final-head">
          <p className="eyebrow">Finalize quote · irreversible</p>
          <h2>Push a NetSuite Sales Order for <em>{customer.name} · {quote.quote_number}</em> at {tier.label}</h2>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
            Advancing pushes a NetSuite Sales Order (<strong>{netsuite.status_on_push}</strong>). This finalizes
            the quote — an order enters the operational system and no further changes are possible without
            admin approval.
          </p>
          <div>
            <p className="eyebrow" style={{ marginBottom: 6 }}>This will</p>
            <ul className="r8-consequences">
              <li><span className="g">→</span><span>Create <strong>NetSuite Sales Order</strong> at {tier.label} · {tier.qty.toLocaleString()} units · <strong>{usd(tier.turnkey)}</strong> turnkey</span></li>
              <li><span className="g">→</span><span>Set quote state <code>accepted</code> → <strong><code>complete</code></strong></span></li>
              <li><span className="g">🔒</span><span>Make the <strong>entire Quote umbrella read-only</strong> — Preview, Send, Client Review and Mark Accepted all lock</span></li>
              <li><span className="g">🔒</span><span>Disable <strong>Revise</strong> — no further versions of {quote.quote_number}</span></li>
              <li><span className="g">→</span><span>Store the accepted snapshot as the canonical record</span></li>
            </ul>
          </div>
          <div className="r8-confirmtype">
            <label htmlFor="r8fin">Type <code>FINALIZE</code> to confirm</label>
            <input id="r8fin" value={typed} onChange={e => setTyped(e.target.value)} placeholder="FINALIZE" autoComplete="off" />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel — keep it reversible</button>
          <button className={"r8-adv-btn heavy"} disabled={!ok} onClick={onConfirm}>
            <span className="lock">🔒</span> Finalize · push Sales Order
          </button>
        </div>
      </div>
    </div>
  );
}

function TierTab({ variant, onGo, onVariant }) {
  const { tiers, policy, customer_signal, netsuite, quote, customer } = R8();
  const [sel, setSel] = useState(customer_signal.tier_id);
  const [modal, setModal] = useState(false);
  const tier = tiers.find(t => t.id === sel);
  const blocked = tier.status === "below_floor";
  const pushing = variant === "pushing";
  const error = variant === "error";

  return (
    <div className="r8-wrap">
      <div className="r8-cols">
        <div>
          <p className="eyebrow">Sub-tab 5 · Tier Selection · the lock</p>
          <h1 className="r8-h1">Which tier did <em>{customer.name}</em> commit to?</h1>
          <p className="r8-sub">
            Read-only compliance summary per tier, from Pricing. Pre-filled with the tier the customer
            signalled — override if they committed to a different one. Advancing from here finalizes the quote.
          </p>

          {error && (
            <div className="r8-push error" style={{ marginBottom: 14 }}>
              <span className="mark">!</span>
              <div className="txt">
                <div className="t">NetSuite push failed — quote NOT finalized</div>
                <div className="s">502 · SuiteTalk endpoint timeout after 30s. No Sales Order was created; quote.state is still <code>accepted</code> and remains reversible. Safe to retry.</div>
              </div>
              <div className="acts">
                <button className="btn sm" onClick={() => setModal(true)}>Retry push</button>
                <button className="btn sm ghost">Copy error</button>
              </div>
            </div>
          )}

          <div className="r8-signal">
            <span>◆</span>
            <span>Pre-filled from the customer's recorded signal — {customer_signal.confidence} in {customer_signal.source}. You can override.</span>
          </div>

          {tiers.map(t => {
            const dis = t.status === "below_floor";
            return (
              <button key={t.id} className={"r8-tier" + (t.id === sel ? " on" : "") + (dis ? " disabled" : "")}
                onClick={dis ? undefined : () => setSel(t.id)} disabled={dis}>
                <span className="radio" />
                <span>
                  <span className="tname">{t.label}{t.recommended && <span className="star">★</span>}</span>
                  <span className="tqty">{t.qty.toLocaleString()} units</span>
                </span>
                <span>
                  <span className="tnum">{usd(t.unit_price, 2)}<span className="u">/u</span></span>
                  <span className="tcap">unit price</span>
                </span>
                <span>
                  <span className="tnum">{usd(t.turnkey)}</span>
                  <span className="tcap">turnkey</span>
                </span>
                <span>
                  <span className={"tmargin " + t.status}>{t.margin_pct.toFixed(1)}%</span>
                  <span className="tcap">margin</span>
                  {dis && <span className="blockchip">below floor · blocked</span>}
                </span>
              </button>
            );
          })}

          <p className="mono" style={{ fontSize: 10, color: "var(--ink-4)", letterSpacing: "0.04em", marginTop: 10 }}>
            Target {policy.target_pct}% · floor {policy.floor_pct}% · T4 is below floor and cannot be finalized without admin override.
          </p>

          {blocked && (
            <div className="r8-card" style={{ marginTop: 14, borderColor: "oklch(from var(--bad) l c h / 0.4)", background: "var(--bad-soft)" }}>
              <p className="eyebrow" style={{ color: "var(--bad)", marginBottom: 6 }}>Advance blocked · firm policy gate</p>
              <p style={{ margin: "0 0 11px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                {tier.label} margin is {tier.margin_pct.toFixed(1)}%, below the {policy.floor_pct}% floor.
                Finalizing requires an admin override, logged to the quote.
              </p>
              <button className="btn bad sm" style={{ borderStyle: "dashed" }}>⚡ Request admin override</button>
            </div>
          )}

          <div className="r8-dn">
            <div className="dn-eyebrow">DN · why this one is heavy</div>
            Dark slab, lock glyph, typed confirmation, and a consequence list that names the Sales Order. Every other advance in this umbrella is a plain button with a one-line caption. That contrast is doing the teaching: the PM learns which step is the point of no return by how different it feels, not by reading a warning they'd skim.
          </div>
        </div>

        <div className="r8-side">
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>Selected</p>
            <div style={{ fontFamily: "var(--display)", fontSize: 21, fontWeight: 500, letterSpacing: "-0.015em" }}>
              {tier.label} · {tier.qty.toLocaleString()} units
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4, letterSpacing: "0.03em" }}>
              {usd(tier.unit_price, 2)}/unit · {usd(tier.turnkey)} turnkey · {tier.margin_pct.toFixed(1)}% margin
            </div>
          </div>
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>After finalizing</p>
            <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.7 }}>
              <li>NetSuite SO · {netsuite.status_on_push}</li>
              <li>Quote state <code>complete</code></li>
              <li>Umbrella becomes read-only</li>
              <li>Revise disabled</li>
              <li>Unlock needs admin approval</li>
            </ul>
          </div>
        </div>
      </div>

      <AdvanceBar
        weight="heavy"
        back={{ label: "Mark Accepted", onClick: () => onGo("accepted") }}
        mid={pushing ? "pushing Sales Order…" : `selected ${tier.label} · ${usd(tier.turnkey)} turnkey`}
        caption={blocked ? "Blocked — below floor, admin override required" : "Irreversible — pushes a NetSuite Sales Order"}
        label={pushing ? "Finalizing…" : "Finalize & push Sales Order"}
        disabled={blocked || pushing}
        onAdvance={() => setModal(true)}
      />

      {modal && (
        <FinalizationModal
          tier={tier}
          onClose={() => setModal(false)}
          onConfirm={() => { setModal(false); onVariant("pushing"); setTimeout(() => onVariant("complete"), 1600); }}
        />
      )}
    </div>
  );
}

// ═══ 3 · Post-Complete locked umbrella (Pattern 52) ══════
function CompleteTab({ onVariant }) {
  const { netsuite, customer, quote, tiers, customer_signal, hubspot } = R8();
  const tier = tiers.find(t => t.id === customer_signal.tier_id);
  return (
    <div className="r8-wrap">
      <div className="r8-cols">
        <div>
          <p className="eyebrow">Sub-tab 5 · Tier Selection · complete</p>
          <h1 className="r8-h1">{quote.quote_number} is the <em>canonical record</em></h1>
          <p className="r8-sub">
            The Sales Order is in NetSuite. This quote and every sub-tab in the umbrella are read-only —
            what you see is what was agreed.
          </p>

          <div className="r8-push ok">
            <span className="mark">✓</span>
            <div className="txt">
              <div className="t">NetSuite Sales Order {netsuite.so_id} · {netsuite.status_on_push}</div>
              <div className="s">pushed {netsuite.pushed_at} · {tier.label} · {tier.qty.toLocaleString()} units · {usd(tier.turnkey)}</div>
            </div>
            <div className="acts">
              <a className="r8-solink" href={netsuite.link} target="_blank" rel="noreferrer">Open {netsuite.so_id} ↗</a>
            </div>
          </div>

          <div className="r8-card" style={{ marginTop: 14 }}>
            <p className="eyebrow" style={{ marginBottom: 10 }}>Final record</p>
            <div className="r8-defs">
              <div className="row"><span className="k">accepted tier</span><span className="v">{tier.label} · {tier.qty.toLocaleString()} units · {usd(tier.unit_price, 2)}/unit</span></div>
              <div className="row"><span className="k">turnkey total</span><span className="v">{usd(tier.turnkey)}</span></div>
              <div className="row"><span className="k">accepted version</span><span className="v">v{quote.sent_version} (sent {shortDate(quote.sent_at)})</span></div>
              <div className="row"><span className="k">finalized by</span><span className="v">{R8().me.name} · {netsuite.pushed_at}</span></div>
              <div className="row"><span className="k">netsuite so</span><span className="v"><code>{netsuite.so_id}</code> · {netsuite.status_on_push}</span></div>
              <div className="row"><span className="k">hubspot</span><span className="v"><code>{hubspot.to_stage}</code> · {usd(hubspot.amount)}</span></div>
              <div className="row"><span className="k">review log</span><span className="v">4 entries · retained, read-only</span></div>
            </div>
          </div>

          <div className="r8-dn">
            <div className="dn-eyebrow">DN · tone after the lock</div>
            "Here is the record," not "you can no longer edit this." The ribbon leads with the SO number and the link out to NetSuite; read-only is communicated by the absence of affordances plus one quiet line, not by disabled buttons everywhere.
          </div>
        </div>

        <div className="r8-side">
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>What's next</p>
            <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
              <li>Production schedule from the SO</li>
              <li>Project moves to <code>in-production</code></li>
              <li>Deposit invoice on PO confirmation</li>
            </ul>
          </div>
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>If something's wrong</p>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55 }}>
              Finalization is irreversible in the PM's hands. An admin can unlock with a reason; the SO must
              be cancelled in NetSuite separately.
            </p>
            <button className="btn sm ghost">Request unlock (admin)</button>
          </div>
        </div>
      </div>

      <div className="r8-advance">
        <div className="back"><button className="btn ghost sm" onClick={() => onVariant("select")}>← Reset prototype to Tier Selection</button></div>
        <div className="mid">quote state · complete · umbrella read-only</div>
        <div className="fwd">
          <span className="cap">No advance — this is the end of the lifecycle</span>
          <button className="btn sm">⤓ Final PDF</button>
        </div>
      </div>
    </div>
  );
}

// ═══ Host ════════════════════════════════════════════════
const VARIANTS = {
  preview:  [{ id: "default", label: "Default" }],
  send:     [{ id: "ready", label: "① Ready to send" }, { id: "waiting", label: "② Sent · awaiting" }],
  review:   [{ id: "feed", label: "① Feed + mismatch" }, { id: "empty", label: "② Empty" }],
  accepted: [{ id: "ready", label: "① Ready" }, { id: "pushing", label: "② HubSpot pushing" }, { id: "confirmed", label: "③ Confirmed" }, { id: "error", label: "④ Push failed" }],
  tier:     [{ id: "select", label: "① Select tier" }, { id: "pushing", label: "② Pushing SO" }, { id: "error", label: "③ Push failed" }, { id: "complete", label: "④ Complete · locked" }],
};

function QuoteUmbrella({ tweaks, setTweak }) {
  const tab = tweaks.tab || "review";
  const variant = tweaks.variant || VARIANTS[tab][0].id;
  const narrow = !!tweaks.narrow;
  const { project, quote, review_events } = R8();

  const qstate =
    tab === "tier" && variant === "complete" ? "complete"
    : tab === "tier" ? "accepted"
    : tab === "accepted" && variant === "confirmed" ? "accepted"
    : tab === "preview" || (tab === "send" && variant === "ready") ? "draft"
    : "sent";

  const go = id => setTweak({ tab: id, variant: VARIANTS[id][0].id });
  const setVariant = v => setTweak("variant", v);

  const body = () => {
    if (tab === "preview")  return <PreviewTab onGo={go} />;
    if (tab === "send")     return <SendTab variant={variant} onGo={go} onVariant={setVariant} />;
    if (tab === "review")   return <ReviewTab variant={variant} onGo={go} />;
    if (tab === "accepted") return <AcceptedTab variant={variant} onGo={go} onVariant={setVariant} />;
    if (variant === "complete") return <CompleteTab onVariant={setVariant} />;
    return <TierTab variant={variant} onGo={go} onVariant={setVariant} />;
  };

  const complete = qstate === "complete";

  return (
    <div className={"r8-shell" + (narrow ? " narrow" : "")}>
      <div className="r8-topbar">
        <div className="r8-crumb">
          <span className="dim">{project.client} · {project.deal} · {project.scenario} · </span>
          <strong>Quote</strong>
          <span className="dim"> · {quote.quote_number}</span>
        </div>
        <div className="r8-topbar-right">
          <span className="chip" style={{ fontSize: 10.5 }}>
            state · <strong style={{ marginLeft: 4 }}>{qstate}</strong>
          </span>
          <div className="r8-proto">
            <span>state →</span>
            <div className="state-sub">
              {VARIANTS[tab].map(v => (
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
            <div className="heading">Complete · {R8().netsuite.so_id} in NetSuite</div>
            <div className="meta">Finalized {R8().netsuite.pushed_at} by {R8().me.name} · canonical record · read-only</div>
          </div>
          <div className="right">
            <a className="r8-solink" href={R8().netsuite.link} target="_blank" rel="noreferrer">Open in NetSuite ↗</a>
          </div>
        </div>
      )}

      <SubTabStrip activeId={tab} qstate={qstate} onGo={go} feedCount={review_events.length} />
      {!complete && <Legend />}
      {complete && (
        <div className="r8-readonly-note">
          <span>🔒</span> All five sub-tabs are read-only. Revise is disabled. Unlock requires admin approval.
        </div>
      )}

      <div className={"r8-body" + (narrow ? " narrowpad" : "")}>{body()}</div>
    </div>
  );
}

Object.assign(window, {
  QuoteUmbrella, SubTabStrip, AdvanceBar,
  PreviewTab, SendTab, ReviewTab, AcceptedTab, TierTab, CompleteTab,
  MismatchBanner, FinalizationModal,
});
