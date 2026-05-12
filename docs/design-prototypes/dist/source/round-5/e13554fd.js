// Round 5 — Audit log.
// One feed, three states (all / filtered-by-entity / row-expanded-with-diff).
// The feed is the truth of the system; everything else is a view onto it.
//
// Design commitments:
// - Diffs ARE expandable rows, not modals. Auditors scan; expansion is for
//   the rare deep look. We do not paginate by clicking through detail pages.
// - The verb chip carries the action's color; the rest of the row is neutral.
//   Color saturates only the thing that matters.
// - Entity hyperlinks land on that entity's page (in another tab) — they're
//   navigation, not summons-to-modal.

const AuditLog = ({ state, expandedId, onExpand }) => {
  const D = window.NXR5;
  const filtered = state === "filtered" ? D.audit_log.filter(e => e.entity_label.includes("Lumen")) : D.audit_log;

  // Group by relative day for the day separators
  const groups = [];
  let currentLabel = null;
  filtered.forEach(e => {
    const dayLabel =
      e.ts.includes("h ago") ? "Today · Apr 30" :
      e.ts.startsWith("yesterday") ? "Yesterday · Apr 29" :
      e.ts === "2d ago" ? "2 days ago · Apr 28" :
      e.ts === "Apr 28" ? "Apr 28" :
      e.ts === "Apr 26" ? "Apr 26" :
      e.ts === "Apr 22" ? "Apr 22" :
      e.ts === "Apr 1" ? "Apr 1 — firm policy change" :
      e.ts === "Mar 18" ? "Mar 18" : e.ts;
    if (dayLabel !== currentLabel) {
      groups.push({ label: dayLabel, entries: [] });
      currentLabel = dayLabel;
    }
    groups[groups.length - 1].entries.push(e);
  });

  const fmtVal = (v, key) => {
    if (v === null || v === undefined) return "null";
    const isPct = typeof key === "string" && /(_pct|margin)$/i.test(key);
    if (isPct && typeof v === "number") return `${(v * 100).toFixed(1)}%`;
    if (typeof v === "string" && v.length > 30) return v.slice(0, 28) + "…";
    return String(v);
  };

  return (
    <div className="r5-page">
      <div className="r5-page-head">
        <div className="eyebrow">Admin · Audit log</div>
        <h1>Audit <em>log</em></h1>
        <p className="sub">
          Append-only forensic record of every state change in the system. Filter by user, entity, action, or
          date; expand any row for the structured diff. Entity links open the live record.
        </p>
      </div>

      {/* Filter bar */}
      <div className="r5-al-filters">
        <div className="r5-al-search">
          <span className="icon">⌕</span>
          <input placeholder="Search summary, entity, user…" defaultValue={state === "filtered" ? "Lumen" : ""} />
        </div>
        <button className={`r5-al-filter ${state === "filtered" ? "active" : ""}`}>
          Entity <span className="v">project</span> {state === "filtered" && <span className="x">×</span>}
        </button>
        <button className="r5-al-filter">User <span className="v">any</span></button>
        <button className="r5-al-filter">Action <span className="v">any</span></button>
        <button className="r5-al-filter">Date <span className="v">last 30d</span></button>
      </div>

      {state === "filtered" && (
        <div className="r5-al-active-bar">
          <span className="lbl">Filtered</span>
          <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
            All activity touching <strong style={{ fontFamily: "var(--display)", fontStyle: "italic", fontWeight: 500, color: "var(--ink)" }}>Lumen & Co.</strong> (project P-2418) — 6 entries across 8 days
          </span>
          <a className="clear">Clear filter</a>
        </div>
      )}

      <div className="r5-al-bar">
        <span>{filtered.length} entries · oldest {filtered[filtered.length - 1].ts}</span>
        <a className="copy-link">EXPORT CSV · COPY DEEP-LINK</a>
      </div>

      <div className="r5-al-feed">
        {groups.map((g, gi) => (
          <React.Fragment key={gi}>
            <div className="r5-al-day">{g.label}</div>
            {g.entries.map(e => {
              const expanded = e.id === expandedId;
              return (
                <div key={e.id} className={`r5-al-row ${expanded ? "expanded" : ""}`} onClick={() => onExpand(expanded ? null : e.id)}>
                  <div className="ts">{e.ts}</div>
                  <div className="avatar">{e.user.initials}</div>
                  <div className="body">
                    <div className="verb">
                      <span className="who">{e.user.name}</span>
                      <span className={`action ${e.action}`}>{e.action.replace(/_/g, " ")}</span>
                      <span className="entity">{e.entity_label}</span>
                    </div>
                    <div className="summary">{e.summary}</div>
                    <div className="meta">
                      <span>{e.ts_full || e.ts}</span>
                      <span>·</span>
                      <span>{e.entity_type}</span>
                      <span>·</span>
                      <span>{e.diff_fields} field{e.diff_fields !== 1 ? "s" : ""} changed</span>
                      {e.cascade && <span className="cascade-chip">cascade · {e.cascade_count.sku_rows} rows × {e.cascade_count.input_rows / e.cascade_count.sku_rows} tiers re-derived</span>}
                      {e.copy_source && <span style={{ color: "var(--accent-ink)" }}>· copied from {e.copy_source}</span>}
                    </div>

                    {expanded && (
                      <div className="r5-al-diff">
                        {e.cascade && (
                          <div className="cascade-summary">
                            <div><strong>Cascade</strong> — 1 input change touched <strong>{e.cascade_count.quotes}</strong> quote · <strong>{e.cascade_count.sku_rows}</strong> SKU rows · <strong>{e.cascade_count.input_rows}</strong> input rows</div>
                          </div>
                        )}
                        {Object.entries(e.diff).map(([k, v]) => (
                          <div className="field" key={k}>
                            <div className="key">{k}</div>
                            <div className="val">
                              <span className="from">{fmtVal(v.from, k)}</span>
                              <span className="arrow">→</span>
                              <span className="to">{fmtVal(v.to, k)}</span>
                            </div>
                          </div>
                        ))}
                        {e.cell_ref && (
                          <div className="field">
                            <div className="key">cell_ref</div>
                            <div className="val" style={{ fontFamily: "var(--mono)", color: "var(--ink-2)" }}>
                              sku={e.cell_ref.sku} · tier={e.cell_ref.tier}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="expand">{expanded ? "− COLLAPSE" : "+ DIFF"}</div>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      <div className="r5-dn">
        <span className="lbl">Designer note</span>
        We surface cascades as a single entry on the source change with a chip
        ("cascade · 4 rows × 4 tiers re-derived"), not 16 separate rows for each derived value.
        The 16 derived facts ARE in the database, queryable; the log is for human scanning, and 16 entries
        for one paste-the-supplier-quote action drowns the signal. The chip + cascade summary in the diff
        gives auditors the rope to pull on without making the feed unreadable.
      </div>
    </div>
  );
};

window.NXAuditLog = AuditLog;
