// Project detail — multiple parallel scenarios.
// Verdict-as-room: the Next-action card is the room organizer. Scenario
// cards are stacked, each with its own version chain + draft-after-send
// banner. Scenarios are ALSO in the inner rail; this page repeats them
// because the rail is a switcher and the page is the workspace. Both
// patterns surface the same data — repetition is intentional.

const ProjectDetail = ({ state, onOpenCopy, onOpenNewScenarioModal }) => {
  const D = window.NXR4;
  const p = D.project_detail;

  // States: active (default), single, accepted
  const scenarios = state === "single"
    ? [p.scenarios[0]].map(s => ({...s, versions: [{...s.versions[0], v:1, status: "draft", blended_margin: null, margin_state: "incomplete", amount: null, note: "Empty draft · enter SKU shapes to start"}], draft_after_send: null}))
    : state === "accepted"
      ? p.scenarios.map((s, i) => i === 0
          ? {...s, versions: [{...s.versions[0], status: "accepted", note: "Accepted by Lumen & Co. at Tier 2 · 50,000 units"}].concat(s.versions.slice(1)), draft_after_send: null }
          : {...s, status: "dropped", drop_reason: "accept_sibling"})
      : p.scenarios;

  const nextAction = state === "accepted"
    ? null
    : state === "single"
      ? { kind: "fresh", headline: "New project · enter your SKU shapes to begin", detail: "5 SKUs imported from HubSpot. Open Setup to confirm units, packs and tier counts.", cta: "Open Setup", target_scenario: "sc_primary" }
      : p.next_action;

  return (
    <div data-screen-label="B · Project detail">
      <div className="r4-top">
        <div className="crumbs">
          <span>My deals</span>
          <span className="sep">/</span>
          <span className="here" style={{ fontStyle: "italic", fontFamily: "var(--display)", fontSize: 14 }}>{p.client}</span>
        </div>
        <div className="right">
          <span className="presence">
            <span className="dot" /> WC <span style={{ color: "var(--ink-4)" }}>· freight</span>
          </span>
          <button style={window.NXBtnStyle("subtle")}>Refresh from HubSpot</button>
        </div>
      </div>

      <div className="r4-page" style={{ paddingTop: 20 }}>
        <div className="r4-pd-header">
          <div className="lhs">
            <h1>{p.client}</h1>
            <p className="deal">{p.deal_name}</p>
            <div className="meta">
              <span><span className="label">PM</span> <span className="value">{p.pm}</span></span>
              <span><span className="label">SALES</span> <span className="value">{p.sales_rep}</span></span>
              <span><span className="label">STAGE</span> <span className="value">{p.hubspot_stage}</span></span>
              <span><span className="label">SYNCED</span> <span className="value">{p.hubspot_synced_at} ago</span></span>
            </div>
          </div>
          <div className="rhs">
            <div style={{ display: "flex", gap: 6 }}>
              <button style={window.NXBtnStyle("subtle")} onClick={() => onOpenCopy("within")}>Copy scenario</button>
              <button style={window.NXBtnStyle("subtle")} onClick={() => onOpenCopy("cross")}>Copy from another project</button>
              <button style={window.NXBtnStyle("primary")} onClick={onOpenNewScenarioModal}>+ New scenario</button>
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-4)", letterSpacing: "0.06em" }}>
              CREATED APR 22 · 9 DAYS IN
            </div>
          </div>
        </div>

        {nextAction && state !== "accepted" && (
          <div className={`r4-next-action ${nextAction.kind === "override_pending" ? "bad" : ""}`}>
            <div>
              <div className="eyebrow">Your move</div>
              <h3 className="head">{nextAction.headline}</h3>
              <p className="detail">{nextAction.detail}</p>
            </div>
            <button style={{ ...window.NXBtnStyle(nextAction.kind === "override_pending" ? "subtle" : "primary"), padding: "10px 18px" }}>
              {nextAction.cta} →
            </button>
          </div>
        )}

        {state === "accepted" && (
          <div className="r4-next-action" style={{ background: "oklch(from var(--good) l c h / 0.06)", borderColor: "oklch(from var(--good) l c h / 0.30)", borderLeftColor: "var(--good)" }}>
            <div>
              <div className="eyebrow" style={{ color: "var(--good)" }}>Closed-won</div>
              <h3 className="head">Lumen & Co. accepted Primary v3 at Tier 2 · 50,000 units</h3>
              <p className="detail">$163,750 · 22.8% blended margin · accepted Apr 30. Aggressive and Pass-through scenarios auto-dropped.</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={window.NXBtnStyle("subtle")}>View snapshot</button>
              <button style={window.NXBtnStyle("primary")}>Final PDF</button>
            </div>
          </div>
        )}

        <div className="r4-pd-grid">
          <div>
            <div className="r4-scenarios-head">
              <h2>Scenarios <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 12, fontWeight: 400 }}>· {scenarios.filter(s => s.status === "active" || s.status === "accepted").length} active, {scenarios.filter(s => s.status === "dropped").length} dropped</span></h2>
            </div>

            {scenarios.map(sc => <ScenarioCard key={sc.id} sc={sc} onOpenCopy={onOpenCopy} state={state} />)}

            {state === "single" && (
              <div className="r4-dn">
                <span className="lbl">Designer note</span>
                Single-scenario state: no need for the multi-tab feel; the Next-action
                card carries the room. New Scenario is one click away when negotiation
                splits.
              </div>
            )}
          </div>

          <aside>
            <div className="r4-activity">
              <h3>Activity <span className="meta">last 24h</span></h3>
              {(state === "accepted"
                ? [{ts:"32m",text:"Accepted Primary v3 · Tier 2 · 50,000",who:"MO"},
                   {ts:"32m",text:"Aggressive auto-dropped · drop_reason=accept_sibling",who:"sys"},
                   {ts:"32m",text:"Pass-through auto-dropped · drop_reason=accept_sibling",who:"sys"},
                   {ts:"32m",text:"Snapshot quote_snapshots.id=qs_1428",who:"sys"}]
                : p.activity).map((a, i) => (
                <div key={i} className="r4-act-item">
                  <div className="ts">{a.ts}</div>
                  <div><span className="who">{a.who}</span>{a.text}</div>
                </div>
              ))}
            </div>

            {state !== "accepted" && (
              <div style={{ marginTop: 14, padding: 14, background: "var(--paper-2)", border: "1px solid var(--rule)", borderRadius: 10 }}>
                <h3 style={{ fontFamily: "var(--display)", fontWeight: 500, fontSize: 14, margin: "0 0 8px" }}>Lineage</h3>
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                  Aggressive forked from Primary v2 · Apr 28<br />
                  No cross-project source
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
};

const ScenarioCard = ({ sc, onOpenCopy, state }) => {
  const v = sc.versions[0];
  const marginClass = v.margin_state === "good" ? "good" : v.margin_state === "below_target" ? "warn" : v.margin_state === "below_floor" ? "bad" : "";
  const statusChip = sc.status === "accepted" ? "accepted" : sc.status === "dropped" ? "dropped" : "active";

  return (
    <div className={`r4-sc-card ${sc.status === "dropped" ? "dropped" : ""} ${sc.recommended && state !== "accepted" ? "recommended" : ""}`}>
      <div className="r4-sc-card-head">
        <div className="lhs">
          <span className={`label ${sc.status === "dropped" ? "dropped" : ""}`}>{sc.label}</span>
          <span className={`status-chip ${statusChip}`}>{sc.status === "accepted" ? "Accepted" : sc.status === "dropped" ? `Dropped · ${sc.drop_reason || ""}` : "Active"}</span>
          {sc.recommended && state !== "accepted" && <span className="recommended">★ Primary</span>}
        </div>
        {v.blended_margin != null ? (
          <div className={`margin-mini ${marginClass}`}>
            {v.blended_margin}%
            <span className="lbl">{v.tier} blended</span>
          </div>
        ) : (
          <div className="margin-mini" style={{ color: "var(--ink-4)", fontStyle: "italic", fontFamily: "var(--display)", fontSize: 14 }}>
            draft
            <span className="lbl">in progress</span>
          </div>
        )}
        <div className="actions">
          {sc.status !== "dropped" && state !== "accepted" && (
            <React.Fragment>
              <button style={window.NXBtnStyle("subtle")}>Open</button>
              <button style={window.NXBtnStyle("subtle")}>+ New version</button>
            </React.Fragment>
          )}
          {sc.status === "dropped" && <button style={window.NXBtnStyle("subtle")}>Restore</button>}
        </div>
      </div>

      {sc.draft_after_send && state !== "accepted" && (
        <div className="r4-draft-banner">
          <div className="icon">✎</div>
          <div className="text">
            <strong>Draft v{sc.draft_after_send.v} · {sc.draft_after_send.edits} edits</strong> since v{v.v} sent.
            Mark Accepted will lock against v{v.v} (sent), not v{sc.draft_after_send.v}.
            <span style={{ color: "var(--ink-3)" }}> · Margin {sc.draft_after_send.blended_margin}%</span>
          </div>
          <button style={window.NXBtnStyle("subtle")}>Resume draft</button>
        </div>
      )}

      <div className="r4-versions">
        {sc.versions.map(v => (
          <div key={v.v} className={`r4-version ${v.status}`}>
            <div className="v-glyph">
              <div className="num">v{v.v}</div>
            </div>
            <div className="v-info">
              <span className={`status ${v.status}`}>
                {v.status} {v.sent_at_label && `· ${v.sent_at_label}`}
              </span>
              <span className="note">{v.note}</span>
            </div>
            <div className={`v-margin ${v.margin_state === "good" ? "good" : v.margin_state === "below_target" ? "warn" : v.margin_state === "below_floor" ? "bad" : ""}`}>
              {v.blended_margin != null ? `${v.blended_margin}%` : "—"}
            </div>
            <div className="v-amount">{v.amount != null ? `$${(v.amount/1000).toFixed(1)}k` : "—"}</div>
            <div className="v-when">{v.tier || "—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

window.NXProjectDetail = ProjectDetail;
