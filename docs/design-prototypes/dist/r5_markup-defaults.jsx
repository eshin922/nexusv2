// Round 5 — Markup defaults page.
// One screen, two states (browse + inline-edit). Inline editing is the right
// metaphor here: each category is a single number; opening a modal would be
// theatre. The propagation rule is the load-bearing UX commitment — drafts
// adopt new defaults; sent quotes are frozen. We name that on the page so
// no one has to ask.

const MarkupDefaults = ({ state, editCategory, onToggle }) => {
  const D = window.NXR5;
  const isEdit = state === "edit";
  const editingIdx = isEdit ? D.markup_defaults.findIndex(m => m.category === editCategory) : -1;

  return (
    <div className="r5-page">
      <div className="r5-page-head">
        <div className="eyebrow">Admin · Markup defaults</div>
        <h1>Default <em>markups</em> by category</h1>
        <p className="sub">
          When a costing line gets a category, it inherits that category's default markup. PMs can override
          on the line itself. These numbers are the firm's starting point — set once, drift rarely.
        </p>
      </div>

      <div className="r5-md-rule">
        <div className="icon">!</div>
        <div>
          <strong>How changes propagate.</strong> Editing a default updates <strong>draft quotes</strong> only,
          recomputing affected line items in place. <strong>Sent quotes are frozen</strong> at the markup that
          was in force when they were sent — re-sending a v2 picks up new defaults, the original v1 record stays
          intact. Audit log captures every change with before/after.
        </div>
      </div>

      <div className="r5-md-table">
        <div className="r5-md-table-head">
          <div>Category</div>
          <div style={{ textAlign: "right" }}>Default markup</div>
          <div>In use</div>
          <div>Last edited</div>
          <div></div>
        </div>

        {D.markup_defaults.map((m, i) => {
          const editing = i === editingIdx;
          return (
            <React.Fragment key={m.category}>
              <div className={`r5-md-row ${editing ? "editing" : ""} ${m.unused ? "unused" : ""}`}>
                <div className="name">
                  {m.category}
                  {m.unused && <span className="unused-chip">unused</span>}
                </div>
                <div className="markup" style={{ textAlign: "right" }}>
                  {editing ? (
                    <div className="r5-md-edit">
                      <span></span>
                      <input defaultValue="42.0" autoFocus />
                      <span className="pct">%</span>
                    </div>
                  ) : (
                    <React.Fragment>{(m.default_markup_pct * 100).toFixed(0)}<span className="pct">%</span></React.Fragment>
                  )}
                </div>
                <div className="lic">
                  {m.line_item_count > 0 ? (
                    <React.Fragment>{m.line_item_count} line items</React.Fragment>
                  ) : (
                    <span className="zero">0 — never used</span>
                  )}
                </div>
                <div className="last">
                  {m.edited_label}
                  <span className="by">{m.last_edited_by.split(" ").map(w => w[0]).join("")}</span>
                </div>
                <div className="actions">
                  {editing ? (
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      <button className="cancel" onClick={onToggle}>Cancel</button>
                      <button className="save">Save</button>
                    </div>
                  ) : (
                    <button onClick={onToggle}>Edit</button>
                  )}
                </div>
              </div>
              {editing && (
                <div className="r5-md-edit-help" style={{ margin: "0 22px 14px", padding: "12px 14px", background: "var(--paper-3)", borderRadius: 6, fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                  <strong>Saving 40% → 42%</strong> will recompute markup on <strong>{m.line_item_count} line items</strong> across <strong>11 draft quotes</strong>. Sent quotes are not affected.
                  <div className="impact">
                    Estimated blended-margin shift on those drafts: <strong style={{ color: "var(--ink-2)" }}>+0.6 to +1.4 pts</strong> · 2 may move into ≥ target band.
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}

        <div className="r5-md-foot">
          <span>{D.markup_defaults.length} categories · {D.markup_defaults.filter(m => !m.unused).length} in use</span>
          <a href="#" style={{ color: "var(--accent-ink)", letterSpacing: 0.04 }}>+ NEW CATEGORY</a>
        </div>
      </div>

      <div className="r5-dn">
        <span className="lbl">Designer note</span>
        Inline editing, no modal. The whole row is the form: row turns into the editor, name stays put for
        anchoring. We considered grouping into "Materials / Operations / Services / Other" — the FR-15
        categories almost cluster that way — but introducing a layer over 14 rows that fit on one screen is
        gratuitous. Re-evaluate when the count crosses 25.
      </div>
    </div>
  );
};

window.NXMarkupDefaults = MarkupDefaults;
