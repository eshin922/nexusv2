/* global React, LIBM */
// ─────────────────────────────────────────────────────────────────────
// Library modal redesign — components
// Table-row dense layout · persistent attach bar · subtle refresh ·
// tertiary usage caption · status rail + tint · two empty shapes.
// ─────────────────────────────────────────────────────────────────────

const { useState: useStateLib } = React;

const TYPE_FILTERS = [
  { id: "all", label: "All types" },
  { id: "pp", label: "Primary" },
  { id: "sp", label: "Secondary" },
  { id: "tertiary", label: "Tertiary" },
  { id: "soft", label: "Soft goods" },
];

// ── Scenario switcher strip ────────────────────────────────────────
function StateStrip({ stateKey, onChange, theme, onTheme }) {
  const order = window.LIBM.state_order;
  const states = window.LIBM.states;
  const byCluster = {};
  for (const k of order) {
    const c = states[k].cluster;
    if (!byCluster[c]) byCluster[c] = { label: c, items: [] };
    byCluster[c].items.push([k, states[k]]);
  }
  return (
    <div className="lib-strip">
      <span className="lbl">State</span>
      {Object.values(byCluster).map(g => (
        <React.Fragment key={g.label}>
          <span className="group-label">│ {g.label}</span>
          {g.items.map(([key, st]) => (
            <button key={key} className={stateKey === key ? "active" : ""} onClick={() => onChange(key)} title={st.label}>
              {st.label.match(/^[①-㊱]/)?.[0] || st.label.slice(0, 2)}
            </button>
          ))}
        </React.Fragment>
      ))}
      <span className="right">
        <a href="docs/cd-library-modal-designer-notes.md">Designer notes</a>
        <a href="docs/cd-library-modal-data-source-map.md">Data-source map</a>
        <button className="theme-tog" onClick={onTheme}>{theme === "dark" ? "☾ Dark" : "☀ Light"}</button>
      </span>
    </div>
  );
}

// ── Attach-target bar (persistent, prominent) ──────────────────────
function TargetBar({ selectedAsy, onSelect }) {
  const [open, setOpen] = useStateLib(false);
  const asys = window.LIBM.quote.asys;
  const sel = asys.find(a => a.id === selectedAsy) || asys[0];
  return (
    <div className="lib-target-bar">
      <span className="eyebrow">Attaching to</span>
      <div style={{ position: "relative", justifySelf: "flex-start" }}>
        <div className="lib-target-select" onClick={() => setOpen(o => !o)}>
          <span className="asy-icon">◈</span>
          <span className="asy-body">
            <span className="name">{sel.name}</span>
            <span className="meta">{sel.id} · {sel.leaf_count} components</span>
          </span>
          <span className="chevron">▾</span>
        </div>
        {open && (
          <div className="lib-target-menu">
            <div className="header">Assemblies in {window.LIBM.quote.qid}</div>
            {asys.map(a => (
              <div key={a.id} className={"item " + (a.id === sel.id ? "active" : "")}
                   onClick={() => { onSelect(a.id); setOpen(false); }}>
                <span className="asy-icon" style={{ width: 24, height: 24, fontSize: 12 }}>◈</span>
                <span>
                  <span className="name">{a.name}</span>
                  <span className="meta" style={{ display: "block" }}>{a.id} · {a.leaf_count} components</span>
                </span>
                {a.id === sel.id && <span className="check">✓</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <span className="target-hint">Components you attach land here</span>
    </div>
  );
}

// ── Pull-progress band ─────────────────────────────────────────────
function PullBand({ pulling }) {
  const pct = Math.round((pulling.done / pulling.total) * 100);
  return (
    <div className="lib-pull-band">
      <div className="spin" />
      <div className="track-wrap">
        <div className="lab"><strong>Refreshing catalog from HubSpot…</strong> existing components stay usable</div>
        <div className="track"><div className="fill" style={{ width: pct + "%" }} /></div>
      </div>
      <div className="count">{pulling.done.toLocaleString()} / {pulling.total.toLocaleString()} · {pct}%</div>
    </div>
  );
}

// ── A single result row ────────────────────────────────────────────
function LibRow({ leaf }) {
  const type = window.LIBM.types[leaf.type];
  return (
    <div className={"lib-row " + leaf.readiness}>
      <span className="rail" />
      <div className="name-cell">
        <span className="icon">◦</span>
        <span className="text">
          <span className="name">{leaf.name}</span>
          <span className="sub">
            <span className={"src " + leaf.source}>{leaf.source}</span>
            <span>SKU {leaf.sku}</span>
            <span className="usage">· {leaf.used_asys} ASYs · {leaf.used_scenarios} scenarios</span>
          </span>
        </span>
      </div>
      <span className="type-cell">{type?.label || "—"}</span>
      <span className="status-cell">
        <span className={"status-pill " + leaf.readiness}>
          <span className="dot" />
          {leaf.readiness}
        </span>
      </span>
      <span className="action-cell">
        {leaf.readiness === "attached"
          ? <span className="lib-attached-mark">✓ Attached</span>
          : leaf.readiness === "archived"
            ? <button className="lib-restore-btn">Restore</button>
            : <button className="lib-attach-btn">Attach</button>}
      </span>
    </div>
  );
}

// ── Empty states ───────────────────────────────────────────────────
function EmptyZero({ query, canCreate, onClear }) {
  return (
    <div className="lib-empty">
      <div className="glyph">∅</div>
      <h3>No components match</h3>
      <p>Nothing in the library matches <span className="q">{query}</span>. Adjust the search, or create it as a new product.</p>
      <div className="cta-row">
        <button className="lib-empty-cta primary" disabled={!canCreate}>+ Create new product →</button>
        <button className="lib-empty-cta secondary" onClick={onClear}>Clear search</button>
      </div>
      {!canCreate && <div className="perm-note">You don't have permission to create new products. Ask an admin.</div>}
    </div>
  );
}

function EmptyLibrary({ canCreate }) {
  return (
    <div className="lib-empty">
      <div className="glyph">⊹</div>
      <h3>Your library is empty</h3>
      <p>No reusable components yet. Create your first one, or pull your existing catalog from HubSpot to get started.</p>
      <div className="cta-row">
        <button className="lib-empty-cta primary" disabled={!canCreate}>+ Create new product →</button>
        <button className="lib-empty-cta secondary" disabled={!canCreate}>↗ Refresh from HubSpot</button>
      </div>
      {!canCreate && <div className="perm-note">You don't have permission to create new products. Ask an admin.</div>}
    </div>
  );
}

// ── The modal ──────────────────────────────────────────────────────
function LibraryModal({ stateKey }) {
  const st = window.LIBM.states[stateKey];
  const [selectedAsy, setSelectedAsy] = useStateLib(st.selected_asy);
  const [typeFilter, setTypeFilter] = useStateLib(st.type_filter);
  React.useEffect(() => { setSelectedAsy(st.selected_asy); setTypeFilter(st.type_filter); }, [stateKey]);

  const rows = (st.rows || []).filter(r => typeFilter === "all" || r.type === typeFilter);
  const isPulling = !!st.pulling;
  const showLibraryEmpty = st.library_truly_empty;
  const showZero = !showLibraryEmpty && rows.length === 0;
  const attachedCount = (st.rows || []).filter(r => r.readiness === "attached").length;

  return (
    <div className="a1v2-modal-backdrop">
      <div className="a1v2-modal lib-modal">

        {/* Header */}
        <div className="lib-head">
          <div className="title-wrap">
            <h2>Library <em>· components</em></h2>
            <span className="sub">{window.LIBM.quote.client} · {window.LIBM.quote.qid}</span>
          </div>
          <div className="head-actions">
            <button className="lib-refresh" disabled={!st.canCreate || isPulling}>
              <span className="glyph">↗</span>
              {isPulling ? "Refreshing…" : "Refresh from HubSpot"}
            </button>
            <button className="lib-close">✕</button>
          </div>
        </div>

        {/* Pull band (between header and target bar — doesn't disrupt filter row) */}
        {isPulling && <PullBand pulling={st.pulling} />}

        {/* Persistent attach-target bar */}
        <TargetBar selectedAsy={selectedAsy} onSelect={setSelectedAsy} />

        {/* Filter row — single, light */}
        {!showLibraryEmpty && (
          <div className="lib-filters">
            <div className="lib-search">
              <span className="glyph">⌕</span>
              <input placeholder="Search by name, SKU, or factory" defaultValue={st.query} />
            </div>
            <div className="lib-seg">
              {TYPE_FILTERS.map(t => (
                <button key={t.id} className={typeFilter === t.id ? "active" : ""} onClick={() => setTypeFilter(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <span className="lib-result-count">
              {rows.length} of {window.LIBM.total_catalog.toLocaleString()}
            </span>
          </div>
        )}

        {/* Results */}
        {showLibraryEmpty ? (
          <EmptyLibrary canCreate={st.canCreate} />
        ) : showZero ? (
          <EmptyZero query={st.query} canCreate={st.canCreate} onClear={() => setTypeFilter("all")} />
        ) : (
          <>
            <div className="lib-results">
              <div className="lib-table-head">
                <span className="h rail" />
                <span className="h name">Component</span>
                <span className="h">Type</span>
                <span className="h">Status</span>
                <span className="h action">Action</span>
              </div>
              {rows.map(r => <LibRow key={r.id} leaf={r} />)}
            </div>
            <div className="lib-foot">
              <span className="meta">
                {attachedCount} already attached to this quote · {rows.length} shown
              </span>
              <div className="actions">
                <button className="lib-btn" disabled={!st.canCreate}>+ Create new product</button>
                <button className="lib-btn primary">Done</button>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

window.LIBM.App = LibraryModal;
window.LIBM.StateStrip = StateStrip;
