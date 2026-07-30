// Section summary row — the always-visible header for each section.
// Drill-down opens INLINE (not a side drawer). The row itself is a one-line
// summary: name, status, owner, mini-stack of per-tier rollup, open CTA.

function SectionRow({ section, open, onToggle, tiers, total, status, owner, lineCount, sublabel }) {
  const activeTier = tiers.find((t) => t.active) || tiers[0];

  return (
    <div className={`r6-section ${open ? "open" : ""}`} data-screen-label={`Section ${section}`}>
      <div className="r6-section-row" onClick={onToggle}>
        <span className="chev">›</span>

        <div className="head">
          <div className="name">{section}</div>
          {sublabel && <div className="meta">{sublabel}</div>}
        </div>

        <span className={`status-chip ${status}`}>
          {status === "complete" && <span style={{ fontSize: "9px" }}>●</span>}
          {status === "in_progress" && <span style={{ fontSize: "9px" }}>◐</span>}
          {status === "empty" && <span style={{ fontSize: "9px", color: "var(--ink-4)" }}>○</span>}
          {status.replace("_", " ")}
        </span>

        <div className="owner">
          <span className="av">{owner.split(" ").map((s) => s[0]).join("").slice(0, 2)}</span>
          {owner}
          {lineCount != null && <span style={{ marginLeft: 6, color: "var(--ink-4)" }}>· {lineCount} lines</span>}
        </div>

        <div className="mini-stack">
          {tiers.map((t) => (
            <div key={t.id} className={`tier-mini ${t.active ? "active" : ""}`}>
              <span className="lbl">{t.label}</span>
              <span className={`val ${t.value == null ? "empty" : ""}`}>
                {t.value == null ? "—" : `$${t.value.toFixed(2)}`}
              </span>
            </div>
          ))}
        </div>

        <div className="open-cta">{open ? "Close ↑" : "Open ↓"}</div>
      </div>

      {open && <div className="r6-drawer">{/* children injected below */}</div>}
    </div>
  );
}

// Wrapper that lets callers compose a section + their drawer body.
function Section({ section, open, onToggle, tiers, status, owner, lineCount, sublabel, deposit, children }) {
  return (
    <div className={`r6-section ${open ? "open" : ""}`} data-screen-label={`Section ${section}`}>
      <div className="r6-section-row" onClick={onToggle}>
        <span className="chev">›</span>

        <div className="head">
          <div className="name">{section}</div>
          {sublabel && <div className="meta">{sublabel}</div>}
          {deposit && (
            <div style={{ marginTop: 4, display: "flex", gap: 6 }}>
              {deposit.outstanding_total > 0 ? (
                <span className="r6-deposit-chip outstanding">
                  ${deposit.outstanding_total.toLocaleString()} deposit due
                </span>
              ) : deposit.invoiced && deposit.paid_pct >= 1.0 ? (
                <span className="r6-deposit-chip invoiced">
                  Deposit paid · {deposit.invoice_id}
                </span>
              ) : deposit.invoiced ? (
                <span className="r6-deposit-chip">
                  Deposit invoiced · {deposit.invoice_id}
                </span>
              ) : (
                <span className="r6-deposit-chip">
                  Deposit {(deposit.pct * 100).toFixed(0)}% — not yet invoiced
                </span>
              )}
            </div>
          )}
        </div>

        <span className={`status-chip ${status}`}>
          {status === "complete" && <span style={{ fontSize: "9px" }}>●</span>}
          {status === "in_progress" && <span style={{ fontSize: "9px" }}>◐</span>}
          {status === "empty" && <span style={{ fontSize: "9px", color: "var(--ink-4)" }}>○</span>}
          {status.replace("_", " ")}
        </span>

        <div className="owner">
          <span className="av">{owner.split(" ").map((s) => s[0]).join("").slice(0, 2)}</span>
          {owner}
          {lineCount != null && <span style={{ marginLeft: 6, color: "var(--ink-4)" }}>· {lineCount} {lineCount === 1 ? "line" : "lines"}</span>}
        </div>

        <div className="mini-stack">
          {tiers.map((t) => (
            <div key={t.id} className={`tier-mini ${t.active ? "active" : ""}`}>
              <span className="lbl">{t.label}</span>
              <span className={`val ${t.value == null ? "empty" : ""}`}>
                {t.value == null ? "—" : `$${t.value.toFixed(2)}`}
              </span>
            </div>
          ))}
        </div>

        <div className="open-cta">{open ? "Close ↑" : "Open ↓"}</div>
      </div>

      {open && <div className="r6-drawer">{children}</div>}
    </div>
  );
}

window.NXR6Section = Section;
