/* global React, NXR7B */
// Round 7b — Setup standalone redesign.

const { useState: useStateR7B, useEffect: useEffectR7B } = React;

// ─── Reused: outer + inner rails from R4 (project context active) ──────

function OuterRail() {
  const D = window.NXR7B;
  return (
    <nav className="r4-outer" aria-label="Workspace navigation">
      <div className="r4-outer-mark">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 19V5l16 14V5" />
        </svg>
      </div>
      <div className="r4-outer-section">
        <button className="r4-outer-btn active" title="My deals">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="4" width="18" height="4" rx="1" />
            <rect x="3" y="11" width="18" height="4" rx="1" />
            <rect x="3" y="18" width="18" height="3" rx="1" />
          </svg>
        </button>
      </div>
      <div className="r4-outer-section">
        <span className="r4-outer-label">Pinned</span>
        <div className="r4-recent blue active" title={`${D.project.client}`}>
          {D.project.client.split(/\s/).map(w => w[0]).join("").slice(0,2)}
          <span className="pin">·</span>
        </div>
        <div className="r4-recent amber" title="Beija Flor">BF</div>
      </div>
      <div className="r4-outer-section">
        <span className="r4-outer-label">Recent</span>
        <div className="r4-recent violet" title="Acre">AC</div>
        <div className="r4-recent teal" title="Maren">MA</div>
      </div>
      <div className="r4-outer-foot">
        <div className="r4-outer-avatar">{D.me.initials}</div>
      </div>
    </nav>
  );
}

function InnerRail() {
  const D = window.NXR7B;
  return (
    <aside className="r4-inner">
      <button className="r4-inner-back">← All deals</button>
      <div className="r4-inner-project">
        <div className="client">{D.project.client}</div>
        <div className="deal">{D.project.deal_name}</div>
        <div className="meta">
          <span>{D.project.hubspot_stage.toUpperCase()}</span>
          <span>·</span>
          <span>SYNCED {D.project.hubspot_synced_at}</span>
        </div>
      </div>
      <div className="r4-inner-section">
        <h6>Scenarios <span className="add">+ New</span></h6>
        <div className="r4-scenario active">
          <div className="row">
            <div className="label">{D.scenario.label}</div>
            <div className="v">v{D.scenario.version}</div>
          </div>
          <div className="meta">
            <span className="pip warn" />
            <span>draft after send</span>
          </div>
          <div style={{ marginTop: 6, marginLeft: -6, marginRight: -6 }}>
            <div className="r4-surf active">Setup</div>
            <div className="r4-surf">Cost build</div>
            <div className="r4-surf">Costing sheet</div>
            <div className="r4-surf">Customer view</div>
            <div className="r4-surf">Mark Accepted</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Page head (R7a eyebrow grammar) ───────────────────────────────────

function PageHead() {
  const D = window.NXR7B;
  return (
    <div className="r7b-head">
      <div className="lhs">
        <div className="eyebrow">
          {D.project.client}
          <span className="sep">·</span>
          {D.scenario.label}
          <span className="sep">·</span>
          v{D.scenario.version} draft
        </div>
        <h1>Setup <em>· SKUs, tiers, notes</em></h1>
        <p className="sub">The starting shape of the quote. What you're selling, in what quantities, with what context. Cost goes on the next surface.</p>
      </div>
      <div className="r7b-actions">
        <button className="btn ghost sm">+ Add SKU</button>
        <button className="btn primary">Save draft</button>
      </div>
    </div>
  );
}

// ─── YOUR NEXT MOVE banner (R7a Rule c) ────────────────────────────────

function NextMove() {
  return (
    <div className="r7b-next-move">
      <div className="text">
        <div className="eyebrow">Your next move</div>
        <div className="head">Continue to Cost build <em>→ once SKUs and tiers are settled</em></div>
      </div>
      <button className="cta">Continue to Cost build →</button>
    </div>
  );
}

// ─── SKU table ─────────────────────────────────────────────────────────

function SkuTable({ openSkuId, onOpenSku, skus, onToggleRole, onAddProduct }) {
  return (
    <div className="r7b-card">
      <div className="r7b-card-head">
        <h3>SKUs</h3>
        <div className="actions">
          <span className="meta">{skus.length} SKUs · {skus.filter(s => s.sku_role === "assembly").length} assemblies</span>
        </div>
      </div>

      <div className="r7b-sku-thead">
        <span></span>
        <span>Type</span>
        <span>Product</span>
        <span>Category</span>
        <span className="num">Retail bench</span>
        <span className="num">Components</span>
        <span></span>
      </div>

      {skus.map(sku => (
        <React.Fragment key={sku.id}>
          <div className={`r7b-sku-row ${sku.sku_role} ${openSkuId === sku.id ? "open" : ""}`}>
            <span className="grip" title="Drag to reorder">⠿</span>
            <span className={`r7b-type ${sku.sku_role}`}
                  onClick={() => onToggleRole(sku.id)}
                  title="Click to toggle Leaf ↔ Assembly">
              <span className="glyph">{sku.sku_role === "assembly" ? "▤" : "○"}</span>
              {sku.sku_role === "assembly" ? "ASY" : "LEAF"}
            </span>
            <div className="name">
              <div className="label-pack">
                <span className="lbl">{sku.label}</span>
                <span className="product">{sku.product}</span>
              </div>
              <span className="pack">
                {sku.pack}
                {sku.notes && <span className="indicator has-note" title={sku.notes}>has note</span>}
              </span>
            </div>
            <span className="category">{sku.category}</span>
            <span className="retail">
              ${sku.retail_benchmark.toFixed(2)}
              <span className="sub">retail</span>
            </span>
            <span className={`components ${sku.components.length === 0 ? "empty" : ""}`}
                  onClick={() => sku.sku_role === "assembly" && onOpenSku(openSkuId === sku.id ? null : sku.id)}>
              {sku.sku_role === "assembly"
                ? `${sku.components.length} comp${sku.components.length === 1 ? "" : "s"} ${openSkuId === sku.id ? "▾" : "▸"}`
                : "—"}
            </span>
            <div className="actions">
              <button onClick={() => onOpenSku(openSkuId === sku.id ? null : sku.id)} title="Edit details">⋯</button>
            </div>
          </div>

          {openSkuId === sku.id && (
            <SkuDrawer sku={sku} />
          )}
        </React.Fragment>
      ))}

      <div className="r7b-sku-footer">
        <button className="add-sku primary" onClick={onAddProduct}>+ Add product</button>
        <button className="add-sku">↗ Pull from HubSpot</button>
        <button className="add-sku">📦 Pull from inventory</button>
        <span className="meta">Drag rows to reorder</span>
      </div>
    </div>
  );
}

function SkuDrawer({ sku }) {
  return (
    <div className="r7b-sku-drawer">
      {sku.sku_role === "assembly" && sku.components.length > 0 && (
        <React.Fragment>
          <div className="drawer-title">Nested components — editable</div>
          <div className="r7b-comp-table">
            <div className="r7b-comp-thead">
              <span>Component</span>
              <span>Supplier</span>
              <span>Category</span>
              <span className="num">Unit cost</span>
              <span className="num">Qty</span>
              <span className="num">Markup</span>
              <span></span>
            </div>
            {sku.components.map(c => (
              <div key={c.id} className="r7b-comp-row">
                <input className="input" defaultValue={c.product} />
                <input className="input" defaultValue={c.supplier} />
                <input className="input" defaultValue={c.category} />
                <input className="input num" defaultValue={`$${c.unit_cost.toFixed(2)}`} />
                <input className="input num" defaultValue={c.qty} />
                <input className="input num" defaultValue={`${(c.markup * 100).toFixed(0)}%`} />
                <div className="actions"><button>×</button></div>
              </div>
            ))}
            <div className="r7b-comp-foot">
              <span className="add-line">+ add component line</span>
            </div>
          </div>
        </React.Fragment>
      )}

      {sku.sku_role === "leaf" && (
        <div className="drawer-title" style={{ marginBottom: 12, fontSize: 11, color: "var(--ink-3)", textTransform: "none", letterSpacing: 0, fontFamily: "var(--ui)", fontStyle: "italic" }}>
          Leaf SKU — single-line. Cost goes on Cost build; this drawer is for notes and metadata.
        </div>
      )}

      <div className="r7b-sku-notes">
        <label>Per-SKU notes <span style={{ color: "var(--ink-4)", marginLeft: 6 }}>· internal-only</span></label>
        <textarea
          placeholder="Anything about this SKU — sourcing notes, customer requests, R&D dependencies. Stays internal; not customer-visible."
          defaultValue={sku.notes || ""}
        />
      </div>
    </div>
  );
}

// ─── Tier rail (coupled register with SKU table) ───────────────────────

function TierRail({ tiers, onAddTier, onApplyPreset }) {
  const D = window.NXR7B;
  const isEmpty = tiers.length === 0;

  return (
    <div className="r7b-card">
      <div className="r7b-card-head">
        <h3>Tiers</h3>
        <div className="actions">
          <span className="meta">{tiers.length} tier{tiers.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      {isEmpty ? (
        <div className="r7b-presets">
          <h6>Start with a preset</h6>
          <div className="r7b-presets-grid">
            {D.tier_presets.map(p => (
              <div key={p.id} className="r7b-preset" onClick={() => onApplyPreset(p.id)}>
                <div className="lab">{p.label}</div>
                <div className="desc">{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <React.Fragment>
          <div className="r7b-tier-thead">
            <span>Tier</span>
            <span className="num">Qty</span>
            <span className="num">Price adj</span>
            <span></span>
          </div>

          {tiers.map(t => (
            <div key={t.id} className={`r7b-tier-row ${t.recommended ? "recommended" : ""}`}>
              <div className="label">
                <span className="lab">{t.label}</span>
                {t.recommended && <span className="rec">★ recommended</span>}
              </div>
              <div className="qty">
                <input defaultValue={t.qty.toLocaleString()} />
              </div>
              <div className="adj">
                <input defaultValue={t.price_adj_pct === 0 ? "0%" : `${(t.price_adj_pct * 100).toFixed(0)}%`} />
              </div>
              <div className="actions">
                <button title="Remove tier">×</button>
              </div>
            </div>
          ))}
        </React.Fragment>
      )}

      <div className="r7b-tier-footer">
        <button className="add-tier" onClick={onAddTier}>+ Add tier</button>
      </div>
    </div>
  );
}

// ─── Notes section (Q2 Opt 2: unified bottom, split zones) ─────────────

function NotesSection() {
  const D = window.NXR7B;
  return (
    <div className="r7b-notes">
      <div className="r7b-note-zone internal">
        <div className="r7b-note-zone-head">
          <div className="lhs">
            <h4>Internal notes</h4>
            <span className="audience">PM-only · never customer-visible</span>
          </div>
          <span className="chip">Internal</span>
        </div>
        <div className="r7b-note-zone-body">
          <textarea defaultValue={D.notes.internal} />
          <div className="helper">
            <strong>Audience:</strong> you, other PMs, and admins. Sourcing dependencies, customer phone notes, R&D blockers go here.
          </div>
        </div>
      </div>

      <div className="r7b-note-zone customer">
        <div className="r7b-note-zone-head">
          <div className="lhs">
            <h4>Customer-facing notes</h4>
            <span className="audience">Renders on the Quote PDF</span>
          </div>
          <span className="chip">Customer</span>
        </div>
        <div className="r7b-note-zone-body">
          <textarea defaultValue={D.notes.customer_facing} />
          <div className="helper">
            <strong>Audience:</strong> the customer (renders on the Quote PDF and Mark-Accepted snapshot). Boundary-guard: this text travels with the quote artifact. <a href="#">Preview on Quote →</a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Add-new-product modal (Q4 Opt 1: Nexus-local + writeback toggle) ──

function AddProductModal({ onClose }) {
  const D = window.NXR7B;
  const [writeback, setWriteback] = useStateR7B(true);
  return (
    <div className="r7b-modal-backdrop" onClick={onClose}>
      <div className="r7b-modal" onClick={e => e.stopPropagation()}>
        <div className="r7b-modal-head">
          <h2>Add product</h2>
          <p className="sub">Creates a new SKU on this scenario. If HubSpot writeback is on, the product also gets registered in HubSpot as the canonical record.</p>
        </div>
        <div className="r7b-modal-body">
          <div className="row-pair">
            <div className="field">
              <label>Product name</label>
              <input placeholder="e.g., Hydra-Glow Vitamin C Serum" />
            </div>
            <div className="field">
              <label>Type</label>
              <select defaultValue="leaf">
                <option value="leaf">Leaf · single-line</option>
                <option value="assembly">Assembly · with components</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Pack</label>
            <input placeholder="e.g., 30ml glass dropper bottle" />
          </div>
          <div className="row-pair">
            <div className="field">
              <label>Category</label>
              <select defaultValue={D.sku_categories[0]}>
                {D.sku_categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Units per pack</label>
              <input defaultValue="1" />
            </div>
          </div>

          <div className={`r7b-writeback ${writeback ? "on" : ""}`} onClick={() => setWriteback(!writeback)}>
            <span className="tog" />
            <div className="body">
              <div className="lab">Push to HubSpot</div>
              <div className="desc">Register this product in HubSpot as the canonical record. Other projects can reuse it.</div>
              <div className="consequence">
                {writeback
                  ? "→ writes to HubSpot in background; row appears immediately"
                  : "→ Nexus-local only; never syncs back to HubSpot"}
              </div>
            </div>
          </div>
        </div>
        <div className="r7b-modal-foot">
          <button className="btn ghost sm" onClick={onClose}>Cancel</button>
          <button className="btn primary sm" onClick={onClose}>Add product</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Setup page ───────────────────────────────────────────────────

function SetupPage({ tweaks }) {
  const D = window.NXR7B;
  const [openSkuId, setOpenSkuId] = useStateR7B(tweaks.openSkuId || null);
  const [skus, setSkus] = useStateR7B(D.skus);
  const [modalOpen, setModalOpen] = useStateR7B(false);
  const [tiers, setTiers] = useStateR7B(tweaks.tiersEmpty ? [] : D.tiers);

  // Sync local state when tweaks change (state-strip buttons update tweaks,
  // which arrives as new props; without this, the component renders stale state).
  useEffectR7B(() => {
    setOpenSkuId(tweaks.openSkuId || null);
  }, [tweaks.openSkuId]);

  useEffectR7B(() => {
    setTiers(tweaks.tiersEmpty ? [] : D.tiers);
  }, [tweaks.tiersEmpty]);

  const onToggleRole = (id) => {
    setSkus(prev => prev.map(s => s.id === id
      ? { ...s, sku_role: s.sku_role === "leaf" ? "assembly" : "leaf" }
      : s));
  };

  const onApplyPreset = (presetId) => {
    const presets = {
      pst_3step:   [{ id: "t1", label: "Tier 1", qty: 5000, price_adj_pct: 0, status: "active" },
                    { id: "t2", label: "Tier 2", qty: 10000, price_adj_pct: 0, status: "active", recommended: true },
                    { id: "t3", label: "Tier 3", qty: 25000, price_adj_pct: -0.05, status: "active" }],
      pst_4step:   [{ id: "t1", label: "Tier 1", qty: 5000, price_adj_pct: 0, status: "active" },
                    { id: "t2", label: "Tier 2", qty: 10000, price_adj_pct: 0, status: "active", recommended: true },
                    { id: "t3", label: "Tier 3", qty: 25000, price_adj_pct: -0.05, status: "active" },
                    { id: "t4", label: "Tier 4", qty: 50000, price_adj_pct: -0.08, status: "active" }],
      pst_first:   [{ id: "t1", label: "Tier 1", qty: 10000, price_adj_pct: 0, status: "active", recommended: true }],
      pst_volume:  [{ id: "t1", label: "Tier 1", qty: 10000, price_adj_pct: 0, status: "active" },
                    { id: "t2", label: "Tier 2", qty: 50000, price_adj_pct: -0.08, status: "active", recommended: true },
                    { id: "t3", label: "Tier 3", qty: 100000, price_adj_pct: -0.12, status: "active" }],
    };
    setTiers(presets[presetId] || []);
  };

  return (
    <div className="r7b-page">
      <PageHead />
      <NextMove />

      <div className="r7b-dn">
        <span className="lbl">DN · R7b</span>
        Setup is the <strong>starting shape</strong> of the quote: what we're selling, in what quantities, with what context. Cost goes on Cost build. The SKU and Tier tables are a <strong>coupled pair</strong> — same inline-edit pattern, same register, paired action vocabularies. Notes split into <strong>internal</strong> (PM-only) and <strong>customer-facing</strong> (renders on Quote PDF); per-SKU notes live in the row drawer.
      </div>

      <div className="r7b-grid">
        <SkuTable
          skus={skus}
          openSkuId={openSkuId}
          onOpenSku={setOpenSkuId}
          onToggleRole={onToggleRole}
          onAddProduct={() => setModalOpen(true)}
        />
        <TierRail
          tiers={tiers}
          onAddTier={() => {
            setTiers([...tiers, {
              id: `t${tiers.length + 1}`,
              label: `Tier ${tiers.length + 1}`,
              qty: 0, price_adj_pct: 0, status: "active",
            }]);
          }}
          onApplyPreset={onApplyPreset}
        />
      </div>

      <NotesSection />

      {modalOpen && <AddProductModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}

window.NXR7BPage = SetupPage;
