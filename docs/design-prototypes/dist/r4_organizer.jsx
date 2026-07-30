// Deal organizer — three states.
// Verdict-as-room-organizer: we picked "what's my move" + project list as
// twin rooms, NOT a kanban. PMs need to act AND scan; a single inbox loses
// scan. A pure table loses the cross-project urgency signal that's the
// most-valuable thing this surface can do that Excel can't.

const Organizer = ({ state, onOpenProject }) => {
  const D = window.NXR4;
  const isHealthy = state === "healthy";
  const isSparse = state === "sparse";
  const isEmpty = state === "empty";

  const projects = isSparse
    ? D.projects.filter(p => ["P-2418","P-2401","P-2419"].includes(p.id))
    : isHealthy ? D.projects : [];

  const signals = isSparse ? D.cross_project_signals.slice(0,2) : D.cross_project_signals;

  return (
    <div className="r4-page" data-screen-label="A · Deal organizer">
      <div className="r4-page-head">
        <div>
          <h1>My deals <em style={{ fontSize: 22 }}>· {projects.length} active</em></h1>
          <p className="sub">Tuesday morning. Last login Friday at 5:14pm. Maya's day starts here.</p>
        </div>
        <div className="row gap-2">
          <button style={btnStyle("subtle")}>Import from HubSpot</button>
          <button style={btnStyle("primary")}>+ New project</button>
        </div>
      </div>

      {!isEmpty && signals.length > 0 && (
        <section className="r4-inbox" aria-label="What's my move across all projects">
          <div className="r4-inbox-head">
            <div className="lhs">
              <h3>What's my move</h3>
              <span className="count">{signals.length} {signals.length === 1 ? "signal" : "signals"} from {new Set(signals.map(s => s.project_id)).size} projects</span>
            </div>
            <div className="filters">
              <button className="active">All</button>
              <button>Now</button>
              <button>Today</button>
              <button>Review</button>
            </div>
          </div>
          {signals.map((s, i) => (
            <div key={i} className="r4-signal" onClick={() => onOpenProject(s.project_id)}>
              <div className={`urgency ${s.urgency}`}>
                <span className="dot" />
                {s.urgency === "now" ? "Now" : s.urgency === "today" ? "Today" : s.urgency === "this_week" ? "This wk" : "Review"}
              </div>
              <div className="text">
                <span className="project">{s.project}</span>
                <span className="detail">{s.detail}</span>
              </div>
              <div className="age">{s.age}</div>
              <div className="open">Open →</div>
            </div>
          ))}
        </section>
      )}

      {isEmpty ? (
        <div className="r4-empty">
          <div className="glyph">∅</div>
          <h2>No deals yet</h2>
          <p>Nexus pulls deals from HubSpot. Connect your account or import a deal manually to start quoting.</p>
          <div className="actions">
            <button style={btnStyle("primary")}>Import from HubSpot</button>
            <button style={btnStyle("subtle")}>+ New project manually</button>
          </div>
        </div>
      ) : (
        <React.Fragment>
          <div className="r4-filterbar">
            <button className="r4-filter active">All stages <span className="v">▾</span></button>
            <button className="r4-filter">Client <span className="v">▾</span></button>
            <button className="r4-filter">PM <span className="v">all</span></button>
            <button className="r4-filter">Sales rep <span className="v">▾</span></button>
            <button className="r4-filter">Status <span className="v">▾</span></button>
            <button className="r4-filter">Has lines to review</button>
            <span className="sort">↓ Last activity</span>
          </div>

          <div className="r4-list">
            <div className="r4-list-head">
              <div>Deal · Client</div>
              <div>Stage</div>
              <div>Latest quote</div>
              <div>Margin</div>
              <div>Next action</div>
              <div style={{ textAlign: "right" }}>Activity</div>
            </div>
            {projects.map(p => <ProjectRow key={p.id} p={p} onOpen={() => onOpenProject(p.id)} />)}
          </div>
        </React.Fragment>
      )}
    </div>
  );
};

const ProjectRow = ({ p, onOpen }) => {
  const lq = p.latest_quote;
  const stageClass = p.hubspot_stage === "Closed-Won" ? "closed-won" : p.hubspot_stage === "Closed-Lost" ? "closed-lost" : p.hubspot_stage === "Negotiation" ? "negotiation" : "";
  const marginClass = lq.margin_state === "good" ? "good" : lq.margin_state === "below_target" ? "warn" : lq.margin_state === "below_floor" ? "bad" : "dim";
  const marginNum = lq.blended_margin == null ? "—" : `${lq.blended_margin}%`;
  const amount = lq.amount == null ? "—" : `$${(lq.amount/1000).toFixed(1)}k`;

  return (
    <div className={`r4-row ${p.project_status === "accepted" ? "accepted" : ""}`} onClick={onOpen}>
      <div className="col-deal">
        <span className="deal-name">{p.client}</span>
        <span className="deal-meta">
          <span>{p.deal_name}</span>
          {p.scenarios_active > 1 && <React.Fragment><span className="dot">·</span><span>{p.scenarios_active} scenarios</span></React.Fragment>}
          {p.lines_requiring_review > 0 && <span className="r4-lrr">!{p.lines_requiring_review} review</span>}
        </span>
      </div>
      <div className="col-stage">
        <span className={`stage-pill ${stageClass}`}>{p.hubspot_stage}</span>
      </div>
      <div className="col-quote">
        <span className="amount">{amount}</span>
        <span className="v">v{lq.v} · {lq.status}</span>
      </div>
      <div className="col-margin">
        <span className={`num ${marginClass}`}>{marginNum}</span>
        <span className="lbl">{lq.tier ? `${lq.tier} blended` : "incomplete"}</span>
      </div>
      <div className={`col-next ${!p.next_action ? "empty" : ""}`}>
        {p.next_action ? (
          <React.Fragment>
            <span className={`pip ${p.next_action.kind === "override_pending" ? "now" : p.next_action.kind === "supplier_quote" || p.next_action.kind === "customer_silent" ? "today" : p.next_action.kind === "stage_drift" ? "review" : "fresh_setup"}`} />
            <span>{p.next_action.text}</span>
          </React.Fragment>
        ) : <span>—</span>}
      </div>
      <div className="col-act">{p.last_activity}</div>
    </div>
  );
};

function btnStyle(kind) {
  if (kind === "primary") return {
    background: "var(--accent)", color: "var(--paper)", padding: "8px 14px",
    border: "1px solid var(--accent)", borderRadius: 6, fontSize: 12.5, fontWeight: 500
  };
  return {
    background: "var(--paper-2)", color: "var(--ink-2)", padding: "8px 14px",
    border: "1px solid var(--rule)", borderRadius: 6, fontSize: 12.5, fontWeight: 500
  };
}

window.NXOrganizer = Organizer;
window.NXBtnStyle = btnStyle;
