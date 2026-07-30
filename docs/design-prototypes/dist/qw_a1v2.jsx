/* global React, NXA1V2 */
// Quote Workflow A.1 v2 — ASY/LEAF model with library
// 36 scenarios across 8 groups (A-H)

const { useState: useStateA1V2, useEffect: useEffectA1V2 } = React;

function A1V2App({ scenarioKey, onChangeScenario }) {
  const D = window.NXA1V2;
  const scenario = D.scenarios[scenarioKey];

  return (
    <div className="a1v2-page" data-screen-label={`A.1v2 · ${scenario.label}`}>
      <PageHead scenario={scenario} />
      <DesignerNote scenario={scenario} />
      {renderSurface(scenario, onChangeScenario)}
    </div>
  );
}

function PageHead({ scenario }) {
  const proj = window.NXA1V2.project;
  return (
    <div className="a1v2-head">
      <div>
        <div className="eyebrow">
          {proj.client}<span className="sep">·</span>{proj.scenario}<span className="sep">·</span>v{proj.version}
        </div>
        <h1>{scenario.group} <em>· {scenario.label.replace(/^[①-㊱]\s+/, "")}</em></h1>
        {scenario.description && <p className="scenario-desc">{scenario.description}</p>}
      </div>
    </div>
  );
}

function DesignerNote({ scenario }) {
  const dn = {
    tree: <>The Setup &gt; SKUs page is a <strong>tree</strong>: ASYs as parent rows, nested LEAFs as children. ASY rollup completeness aggregates leaf states. Leaf context menus gain <code>Edit specs</code>; ASY menus do <em>not</em>.</>,
    spec_entry: <>Spec entry is <strong>per-leaf, type-aware</strong>. The leaf's <code>product_type</code> drives which field schema renders. PP and SP are worked examples; Soft goods + Tertiary packaging render as placeholders (Edward provides field lists iteratively).</>,
    add_modal: <>Add Product modal has an <strong>ASY/LEAF mode toggle</strong>. ASY = commercial fields, no specs. LEAF = identity + type + step-2 specs (or defer). LEAFs are globally reusable across all scenarios.</>,
    library: <>LEAFs are <strong>library items</strong>, globally reusable. Cross-scenario reference count surfaces to PMs. Cascade warning fires on edits to widely-referenced leaves. Replenishment workflow: version-stamp pill per leaf in active quotes shows <code>unchanged · changed · new</code> against the prior reference quote.</>,
    addendum: <>PDF addendum renders <strong>per-LEAF, grouped by ASY</strong>. Each ASY block contains its leaf sub-blocks; each leaf renders its type-specific field set. Empty fields render <code>--</code>; placeholders render type-aware stub messages.</>,
    requote: <>Spec change cascade: <strong>unsent quotes auto-update</strong> to current leaf versions; <strong>sent quotes pin</strong> at send time. Out-of-sync indicator surfaces when current leaf version differs from pinned. Re-quote duplicates with current versions + predecessor link.</>,
    export: <>Audit log export — CSV download with <code>caused_by_audit_id</code> cascade chain. Per-quote from Completed sub-tab; per-leaf from leaf context menu on the SKUs page. Field-level events make the audit trail granular.</>,
    soft_gate: <>Soft gate at Preview Quote · non-blocking. Surfaces leaves with incomplete specs per their type-aware completeness rule. PM may proceed; addendum renders incomplete fields as <code>--</code>.</>,
  };
  return (
    <div className="a1v2-dn">
      <span className="lbl">DN · A.1 v2</span>
      {dn[scenario.surface] || dn.tree}
    </div>
  );
}

function renderSurface(scenario, onChangeScenario) {
  switch (scenario.surface) {
    case "tree":       return <TreeView scenario={scenario} onChangeScenario={onChangeScenario} />;
    case "spec_entry": return <SpecEntry scenario={scenario} />;
    case "add_modal":  return <AddProductModal scenario={scenario} />;
    case "library":    return <LibrarySurface scenario={scenario} />;
    case "addendum":   return <AddendumSurface scenario={scenario} />;
    case "requote":    return <RequoteSurface scenario={scenario} />;
    case "export":     return <ExportSurface scenario={scenario} />;
    case "soft_gate":  return <SoftGateSurface scenario={scenario} />;
    default: return <div>Unknown surface</div>;
  }
}

// Helper — compute leaf completeness from its current spec values + product type
function computeLeafCompleteness(leaf) {
  const D = window.NXA1V2;
  if (!leaf.product_type_id) return { state: "no_type", filled: 0, total: 0 };
  const type = D.product_types[leaf.product_type_id];
  if (type.placeholder) {
    // Placeholders use the fixture's spec_completeness directly
    return { state: leaf.spec_completeness, filled: 0, total: 0, placeholder: true };
  }
  const total = type.field_schema?.length || 0;
  const filled = (type.field_schema || []).filter(f => leaf.spec_values?.[f.key]?.trim()).length;
  let state = "empty";
  if (filled === total && total > 0) state = "complete";
  else if (filled > 0) state = "partial";
  return { state, filled, total };
}

function CompletenessChip({ state, filled, total, placeholder }) {
  const copy = {
    complete: "✓ Complete",
    partial: placeholder ? "⚠ Fields pending" : `⚠ ${total - filled} fields pending`,
    empty: "— No specs entered",
    no_type: "⚠ No type set",
  };
  return (
    <span className={`a1v2-chip ${state}`}>
      {state === "complete" && <span className="dot" />}
      {copy[state]}
    </span>
  );
}

function computeAsyRollup(asy) {
  const D = window.NXA1V2;
  if (asy.leaves.length === 0) return { state: "empty", copy: "— No leaves" };
  const completions = asy.leaves.map(al => {
    const leaf = D.leaves[al.leaf_id];
    return computeLeafCompleteness(leaf);
  });
  const allComplete = completions.every(c => c.state === "complete");
  const anyNoType = completions.some(c => c.state === "no_type");
  if (allComplete) return { state: "good", copy: `✓ All ${completions.length} leaves complete` };
  if (anyNoType) return { state: "warn", copy: `⚠ ${completions.filter(c => c.state === "no_type").length} of ${completions.length} leaves untyped` };
  const partials = completions.filter(c => c.state !== "complete").length;
  return { state: "warn", copy: `⚠ ${partials} of ${completions.length} leaves pending` };
}

// ─── GROUP A · TREE VIEW ─────────────────────────────────────────

function TreeView({ scenario, onChangeScenario }) {
  const D = window.NXA1V2;
  // Highlight specific row based on scenario
  const openContext = scenario.open_context;
  const [contextOpen, setContextOpen] = useStateA1V2(openContext);

  useEffectA1V2(() => {
    setContextOpen(openContext);
  }, [openContext]);

  // Count rollups
  const counts = D.assemblies.reduce((acc, asy) => {
    const rollup = computeAsyRollup(asy);
    if (rollup.state === "good") acc.good++;
    else if (rollup.state === "warn") acc.warn++;
    else acc.empty++;
    return acc;
  }, { good: 0, warn: 0, empty: 0 });

  const totalLeaves = D.assemblies.reduce((s, a) => s + a.leaves.length, 0);
  const completeLeaves = D.assemblies.reduce((s, a) => {
    return s + a.leaves.filter(al => computeLeafCompleteness(D.leaves[al.leaf_id]).state === "complete").length;
  }, 0);

  return (
    <div className="a1v2-card">
      <div className="a1v2-card-head">
        <h3>SKUs <em>· cost-stack tree</em></h3>
        <div className="actions">
          <button className="a1v2-btn ghost sm">↗ Pull from HubSpot</button>
          <button className="a1v2-btn primary sm">+ Add product</button>
        </div>
      </div>
      <div className="a1v2-tree-summary">
        <span className="pip complete" /> <strong>{counts.good}</strong> ASY all-complete
        <span style={{ color: "var(--ink-4)" }}>·</span>
        <span className="pip partial" /> <strong>{counts.warn}</strong> partial
        <span style={{ color: "var(--ink-4)" }}>·</span>
        <span className="pip empty" /> <strong>{counts.empty}</strong> empty
        <span className="right">{completeLeaves} of {totalLeaves} leaves have complete specs</span>
      </div>
      <div className="a1v2-tree">
        {D.assemblies.map(asy => (
          <AsyRow
            key={asy.id}
            asy={asy}
            contextOpen={contextOpen}
            onToggleContext={setContextOpen}
            highlight={scenario.highlight}
          />
        ))}
      </div>
      <div className="a1v2-library-affordance">
        <button className="a1v2-btn ghost sm">+ Add leaf from library →</button>
        <span className="meta">browse globally-reusable components</span>
      </div>
    </div>
  );
}

function AsyRow({ asy, contextOpen, onToggleContext, highlight }) {
  const D = window.NXA1V2;
  const rollup = computeAsyRollup(asy);
  const productType = D.product_types[asy.product_type_id];
  const showContext = contextOpen === asy.id;
  return (
    <>
      <div className={`a1v2-asy-row ${asy.leaves.length > 0 ? "expanded" : ""}`}>
        <span className="twirl">▾</span>
        <span className="sku-pill">{asy.sku}</span>
        <div className="name-cell">
          <div className="name">{asy.name}</div>
          <div className="meta">
            <span>{asy.pack_label}</span>
            <span className="sep">·</span>
            <span className="type-tag">{productType?.name || "—"}</span>
          </div>
        </div>
        <span className="leaf-count">{asy.leaves.length} leaves</span>
        <CompletenessChip
          state={rollup.state === "good" ? "complete" : (rollup.state === "warn" ? "partial" : "empty")}
          filled={0} total={asy.leaves.length}
        />
        <div style={{ position: "relative" }}>
          <button className="context-trigger" onClick={() => onToggleContext(showContext ? null : asy.id)}>⋯</button>
          {showContext && <AsyContextMenu />}
        </div>
      </div>
      <div className="a1v2-leaves">
        {asy.leaves.map(al => {
          const leaf = D.leaves[al.leaf_id];
          return <LeafRow key={al.leaf_id} leaf={leaf} qty={al.qty} contextOpen={contextOpen} onToggleContext={onToggleContext} />;
        })}
      </div>
    </>
  );
}

function LeafRow({ leaf, qty, contextOpen, onToggleContext }) {
  const D = window.NXA1V2;
  const completeness = computeLeafCompleteness(leaf);
  const productType = leaf.product_type_id ? D.product_types[leaf.product_type_id] : null;
  const showContext = contextOpen === leaf.id;
  const refCount = leaf.references?.length || 0;
  const otherRefs = refCount - 1;
  return (
    <div className="a1v2-leaf-row">
      <span className="leaf-icon">◦</span>
      <span className="leaf-sku">{leaf.sku}</span>
      <div className="leaf-name-cell">
        <div className="name">{leaf.name}</div>
        <div className="meta">qty {qty < 1 ? qty.toFixed(4) : qty} · ${leaf.unit_cost.toFixed(2)} cost</div>
      </div>
      <span className={`type-tag leaf-type ${!productType ? "untyped" : ""}`}>
        {productType ? productType.name : "untyped"}
      </span>
      <span className="leaf-refs">
        {otherRefs > 0 ? `+ ${otherRefs} other ASY${otherRefs === 1 ? "" : "s"}` : "this scenario only"}
      </span>
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
        <CompletenessChip state={completeness.state} filled={completeness.filled} total={completeness.total} placeholder={completeness.placeholder} />
        <button className="context-trigger" onClick={() => onToggleContext(showContext ? null : leaf.id)}>⋯</button>
        {showContext && <LeafContextMenu />}
      </div>
    </div>
  );
}

function AsyContextMenu() {
  return (
    <div className="a1v2-context-menu">
      <div className="header">ASY actions</div>
      <div className="item">Edit product</div>
      <div className="item">Duplicate ASY</div>
      <div className="item">Move position</div>
      <div className="sep" />
      <div className="item disabled" title="Specs live on leaves, not ASYs">
        Edit specs <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 9, color: "var(--ink-4)" }}>leaves only</span>
      </div>
      <div className="sep" />
      <div className="item bad">Delete ASY · cascade</div>
    </div>
  );
}

function LeafContextMenu() {
  return (
    <div className="a1v2-context-menu">
      <div className="header">Leaf actions</div>
      <div className="item accent">Edit specs</div>
      <div className="sep" />
      <div className="item">Move up</div>
      <div className="item">Move down</div>
      <div className="item">Assign to parent ASY</div>
      <div className="item">View library record</div>
      <div className="sep" />
      <div className="item bad">Delete from this ASY <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 9, color: "var(--ink-4)" }}>library leaf stays</span></div>
    </div>
  );
}

// ─── GROUP B · SPEC ENTRY ────────────────────────────────────────

function SpecEntry({ scenario }) {
  const D = window.NXA1V2;
  const leaf = D.leaves[scenario.leaf_id];
  const productType = leaf.product_type_id ? D.product_types[leaf.product_type_id] : null;
  const completeness = computeLeafCompleteness(leaf);
  const readOnly = scenario.readonly;

  return (
    <>
      {readOnly && (
        <div className="a1v2-rls-banner">
          <span className="glyph">🔒</span>
          <div>
            <strong>Read-only view.</strong> Your role doesn't have <code>spec_edit</code> permission. Spec values render but inputs are disabled.
          </div>
        </div>
      )}
      <div className="a1v2-card">
        <div className="a1v2-leaf-header">
          <span className="icon">◦</span>
          <div>
            <div className="name">{leaf.name}</div>
            <div className="meta">
              <span>SKU {leaf.sku}</span>
              <span className="sep">·</span>
              <span>v{leaf.current_version}</span>
              <span className="sep">·</span>
              <span>${leaf.unit_cost.toFixed(2)} unit cost</span>
              <span className="sep">·</span>
              <span>Referenced by {leaf.references?.length || 0} ASY{leaf.references?.length === 1 ? "" : "s"}</span>
              {leaf.fsc_claim && <><span className="sep">·</span><span>FSC {leaf.fsc_status}</span></>}
            </div>
          </div>
          <div className="right">
            <CompletenessChip state={completeness.state} filled={completeness.filled} total={completeness.total} placeholder={completeness.placeholder} />
            {productType && <span style={{
              fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.04, color: "var(--accent-ink)",
              background: "oklch(from var(--accent) l c h / 0.10)",
              padding: "3px 8px", borderRadius: 4, textTransform: "uppercase",
            }}>
              {productType.name}
            </span>}
          </div>
        </div>
        <div className="a1v2-card-body">
          {!productType && <TypePicker leaf={leaf} />}
          {productType?.placeholder && <PlaceholderPanel productType={productType} />}
          {productType?.field_schema && (
            <SpecPanel
              title={productType.name}
              fields={productType.field_schema}
              spec={leaf.spec_values}
              readOnly={readOnly}
              filled={completeness.filled}
              total={completeness.total}
            />
          )}
        </div>
      </div>

      {productType?.id === "leaf_pp" && leaf.id === "leaf_glass_dropper_30" && !readOnly && (
        <VersionHistoryCard />
      )}
    </>
  );
}

function TypePicker({ leaf }) {
  const D = window.NXA1V2;
  const leafTypes = Object.values(D.product_types).filter(t => t.scope === "leaf" && !t.hidden);
  return (
    <div className="a1v2-type-picker">
      <div className="glyph">∅</div>
      <h4>Set product type first</h4>
      <p>
        This leaf has no Product Type — pick one to render its spec schema. Type drives which fields appear.
      </p>
      <div className="options">
        {leafTypes.map(t => (
          <div key={t.id} className={`option ${t.placeholder ? "placeholder" : ""}`}>
            <div className="lab">{t.name}</div>
            <div className="desc">
              {t.placeholder ? "fields TBD" : `${t.field_schema.length} fields`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaceholderPanel({ productType }) {
  return (
    <div className="a1v2-placeholder-panel">
      <h4>{productType.name} specs <span className="type-name">fields TBD</span></h4>
      <p>
        Field schema for <strong>{productType.name}</strong> is pending. Edward provides field lists iteratively per type.
        Once defined, this leaf's spec entry renders the configured field set in the same panel pattern as PP/SP.
      </p>
      <div className="stub">design pattern · type-aware rendering · field count TBD</div>
    </div>
  );
}

function SpecPanel({ title, fields, spec, readOnly, filled, total }) {
  return (
    <div className="a1v2-spec-panel">
      <div className="panel-head">
        <h4>{title}</h4>
        <span className="meta">{filled} of {total} fields</span>
      </div>
      <div className="a1v2-spec-grid">
        {fields.map(f => (
          <div key={f.key} className={`a1v2-spec-cell ${f.wide ? "wide" : ""}`}>
            <span className="lbl">{f.label}</span>
            {f.key.includes("additional") || f.key.includes("description") || f.key.includes("packout") ? (
              <textarea defaultValue={spec?.[f.key] || ""} disabled={readOnly} placeholder="—" />
            ) : (
              <input defaultValue={spec?.[f.key] || ""} disabled={readOnly} placeholder="—" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function VersionHistoryCard() {
  const D = window.NXA1V2;
  return (
    <div className="a1v2-card">
      <div className="a1v2-card-head">
        <h3>Version history <em>· this leaf</em></h3>
        <div className="actions">
          <span className="meta">{D.leaf_glass_dropper_history.length} versions · pinned by {
            D.leaf_glass_dropper_history.reduce((s, r) => s + (r.pinned_by_quotes?.length || 0), 0)
          } quotes total</span>
          <button className="a1v2-btn ghost sm">↓ Export leaf audit</button>
        </div>
      </div>
      <div className="a1v2-card-body" style={{ paddingTop: 6 }}>
        <div className="a1v2-version-timeline">
          {D.leaf_glass_dropper_history.map(row => (
            <div key={row.v} className="a1v2-version-row">
              <span className="v">v{row.v}</span>
              <span className="ts">{row.ts}</span>
              <div className="action">
                <span className="actor">{row.actor}</span>
                <span>{row.action}</span>
              </div>
              <div className="pinned">
                {row.pinned_by_quotes?.length > 0
                  ? <>Pinned by <strong>{row.pinned_by_quotes.join(", ")}</strong></>
                  : "Unpinned"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── GROUP C · ADD PRODUCT MODAL ─────────────────────────────────

function AddProductModal({ scenario }) {
  const D = window.NXA1V2;
  const [mode, setMode] = useStateA1V2(scenario.mode || "asy");
  const [leafType, setLeafType] = useStateA1V2(scenario.leaf_type || null);

  useEffectA1V2(() => {
    setMode(scenario.mode);
    setLeafType(scenario.leaf_type || null);
  }, [scenario.label]);

  const advanced = scenario.advanced;
  const defer = scenario.defer;
  const showScopeCopy = scenario.show_scope_copy;

  if (advanced) return <AddProductStep2 leafType={leafType} />;

  return (
    <div className="a1v2-modal-backdrop">
      <div className="a1v2-modal">
        <div className="a1v2-modal-head">
          <h2>{mode === "asy" ? "Add product · ASY" : "Add product · LEAF"}</h2>
          {mode === "leaf" && showScopeCopy && (
            <span className="sub lib-scope">↗ Creating a globally reusable library item · available across all scenarios</span>
          )}
          {mode === "asy" && (
            <p className="sub">Creates a new product/SKU in this scenario. Leaves get attached separately.</p>
          )}
          {mode === "leaf" && !showScopeCopy && (
            <p className="sub">Creates a reusable component. Add to the active ASY or save to library for later use.</p>
          )}
          <div className="a1v2-mode-toggle">
            <button className={mode === "asy" ? "active" : ""} onClick={() => setMode("asy")}>
              <span className="lab">ASY</span>
              <span className="desc">Quotable product · commercial fields</span>
            </button>
            <button className={mode === "leaf" ? "active" : ""} onClick={() => setMode("leaf")}>
              <span className="lab">LEAF</span>
              <span className="desc">Reusable component · type + specs</span>
            </button>
          </div>
        </div>
        <div className="a1v2-modal-body">
          {mode === "asy" ? <AsyModalFields /> : <LeafModalFields leafType={leafType} onPickType={setLeafType} />}
        </div>
        <div className="a1v2-modal-foot">
          {mode === "leaf" && <span className="left">⌥ Specs entered next step · or defer</span>}
          {mode === "asy" && <span className="left">⌥ Leaves added separately via the tree</span>}
          <button className="a1v2-btn ghost">Cancel</button>
          {mode === "asy" && <button className="a1v2-btn primary">Add product</button>}
          {mode === "leaf" && !leafType && (
            <button className="a1v2-btn primary" disabled style={{ opacity: 0.5 }}>Pick a Product Type</button>
          )}
          {mode === "leaf" && leafType && !defer && (
            <button className="a1v2-btn primary">Continue to specs →</button>
          )}
          {mode === "leaf" && defer && (
            <button className="a1v2-btn primary">Add leaf · specs empty</button>
          )}
        </div>
      </div>
      {showScopeCopy && <ScopeToast />}
    </div>
  );
}

function AsyModalFields() {
  return (
    <>
      <div className="field">
        <span className="lbl req">Product name</span>
        <input placeholder="e.g., Hydra-Glow Vitamin C Serum 30ml" />
      </div>
      <div className="row-pair">
        <div className="field">
          <span className="lbl req">ASY Product Type</span>
          <select defaultValue="asy_skincare">
            <option value="asy_skincare">Skincare</option>
            <option value="asy_supplement">Supplement</option>
            <option value="asy_body">Body care</option>
          </select>
        </div>
        <div className="field">
          <span className="lbl">SKU</span>
          <input placeholder="auto-generated if blank" />
        </div>
      </div>
      <div className="field">
        <span className="lbl">Description</span>
        <textarea placeholder="One-line product descriptor for the quote" style={{ minHeight: 50, resize: "vertical", fontFamily: "inherit" }} />
      </div>
      <div className="row-triple">
        <div className="field">
          <span className="lbl req">Unit price</span>
          <input placeholder="$0.00" />
        </div>
        <div className="field">
          <span className="lbl">Unit cost</span>
          <input placeholder="$0.00" />
        </div>
        <div className="field">
          <span className="lbl">Markup %</span>
          <input placeholder="30" />
        </div>
      </div>
      <div className="row-pair">
        <div className="field">
          <span className="lbl">Tax schedule</span>
          <select>
            <option>Default (US — wholesale)</option>
            <option>EU VAT</option>
          </select>
        </div>
        <div className="field">
          <span className="lbl">Owner</span>
          <select>
            <option>Maya Okafor</option>
            <option>Tomás Beck</option>
          </select>
        </div>
      </div>
    </>
  );
}

function LeafModalFields({ leafType, onPickType }) {
  const D = window.NXA1V2;
  const leafTypes = Object.values(D.product_types).filter(t => t.scope === "leaf" && !t.hidden);
  const selectedType = leafType ? D.product_types[leafType] : null;
  return (
    <>
      <div className="field">
        <span className="lbl req">Leaf name</span>
        <input placeholder="e.g., 30ml Glass Dropper Bottle · Type III soda-lime" />
      </div>
      <div className="row-pair">
        <div className="field">
          <span className="lbl req">Leaf Product Type</span>
          <select value={leafType || ""} onChange={e => onPickType(e.target.value || null)}>
            <option value="">— Pick a type —</option>
            {leafTypes.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}{t.placeholder ? " · fields TBD" : ` · ${t.field_schema.length} fields`}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="lbl">SKU</span>
          <input placeholder="Supplier SKU or internal ref" />
        </div>
      </div>
      <div className="row-pair">
        <div className="field">
          <span className="lbl">Unit cost</span>
          <input placeholder="$0.00" />
        </div>
        <div className="field">
          <span className="lbl">Owner</span>
          <select>
            <option>Maya Okafor</option>
            <option>Tomás Beck</option>
          </select>
        </div>
      </div>
      <div className="field">
        <span className="lbl">URL · supplier reference</span>
        <input placeholder="https://..." />
      </div>
      {selectedType && (
        <div style={{
          padding: "10px 14px", background: "var(--paper-2)",
          border: "1px solid var(--rule)", borderRadius: 6, fontSize: 11.5, color: "var(--ink-3)",
          lineHeight: 1.45,
        }}>
          <strong style={{ color: "var(--ink) " }}>Next step:</strong> {selectedType.placeholder
            ? <>The <code style={{ fontFamily: "var(--mono)" }}>{selectedType.name}</code> field schema is pending Edward's input. Ship the leaf empty for now; populate when fields land.</>
            : <>Continue to specs renders the <code style={{ fontFamily: "var(--mono)" }}>{selectedType.name}</code> field set ({selectedType.field_schema.length} fields).</>
          }
        </div>
      )}
    </>
  );
}

function AddProductStep2({ leafType }) {
  const D = window.NXA1V2;
  const t = D.product_types[leafType];
  return (
    <div className="a1v2-card">
      <div className="a1v2-leaf-header">
        <span className="icon">◦</span>
        <div>
          <div className="name">New leaf · spec entry</div>
          <div className="meta">
            <span>Modal closed · canonical Edit specs surface</span>
            <span className="sep">·</span>
            <span>v0 · not yet pinned</span>
          </div>
        </div>
        <div className="right">
          <CompletenessChip state="empty" filled={0} total={t.field_schema?.length || 0} placeholder={t.placeholder} />
          <span style={{
            fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.04, color: "var(--accent-ink)",
            background: "oklch(from var(--accent) l c h / 0.10)",
            padding: "3px 8px", borderRadius: 4, textTransform: "uppercase",
          }}>
            {t.name}
          </span>
        </div>
      </div>
      <div className="a1v2-card-body">
        {t.placeholder
          ? <PlaceholderPanel productType={t} />
          : <SpecPanel title={t.name} fields={t.field_schema} spec={{}} readOnly={false} filled={0} total={t.field_schema.length} />
        }
      </div>
    </div>
  );
}

function ScopeToast() {
  return (
    <div className="a1v2-toast" style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 200,
      maxWidth: 360, marginBottom: 0,
    }}>
      <span className="glyph">✓</span>
      <div className="body">
        <strong>New leaf added to library.</strong>
        <span className="lib-meta">Used in: Lumen & Co. · Primary scenario · GLW-30</span>
      </div>
    </div>
  );
}

// ─── GROUP D · LIBRARY ───────────────────────────────────────────

function LibrarySurface({ scenario }) {
  const action = scenario.action;
  if (action === "browse" || action === "search") return <LibraryBrowse mode={action} />;
  if (action === "refs") return <LeafReferences leaf_id={scenario.leaf_id} />;
  if (action === "cascade") return <CascadeWarningDemo leaf_id={scenario.leaf_id} />;
  if (action === "replenishment_unchanged") return <ReplenishmentSurface mode="unchanged" />;
  if (action === "replenishment_changed") return <ReplenishmentSurface mode="changed" />;
  return null;
}

function LibraryBrowse({ mode }) {
  const D = window.NXA1V2;
  return (
    <div className="a1v2-card">
      <div className="a1v2-card-head">
        <h3>Library · reusable leaves <em>· {mode === "search" ? "search results" : "browse"}</em></h3>
        <div className="actions">
          <button className="a1v2-btn ghost sm">+ Create new leaf</button>
          <button className="a1v2-btn ghost sm">↻ Refresh</button>
        </div>
      </div>
      <div className="a1v2-library-browse">
        <div className="a1v2-library-search">
          <input placeholder="Search by name, SKU, or factory" defaultValue={mode === "search" ? "dropper" : ""} />
          <select defaultValue="">
            <option value="">All types</option>
            <option value="leaf_pp">Primary packaging</option>
            <option value="leaf_sp">Secondary packaging</option>
            <option value="leaf_soft">Soft goods</option>
            <option value="leaf_tertiary">Tertiary packaging</option>
          </select>
          <select defaultValue="all">
            <option value="all">All scenarios</option>
            <option>This scenario only</option>
            <option>Used elsewhere</option>
          </select>
          <button className="a1v2-btn sm">Filter</button>
          <button className="a1v2-btn ghost sm">Clear</button>
        </div>
        <div className="a1v2-library-results">
          {D.library_browse.map(row => {
            const leaf = D.leaves[row.leaf_id];
            if (!leaf && !row._virtual) return null;
            const v = row._virtual;
            const name = leaf?.name || v?.name;
            const sku = leaf?.sku || v?.sku;
            const productType = leaf ? D.product_types[leaf.product_type_id] : null;
            const typeName = productType?.name || v?.type || "—";
            const inScenario = !!leaf && leaf.references?.some(r => r.scenario === D.project.scenario);
            return (
              <div key={row.leaf_id} className={`a1v2-library-row ${inScenario ? "in-scenario" : ""}`}>
                <span className="icon">◦</span>
                <div className="name-cell">
                  <div className="name">{name}</div>
                  <div className="sku">SKU {sku}</div>
                </div>
                <span className="type-tag">{typeName}</span>
                <span className="refs-cell">
                  <strong>{row.refs}</strong> ASY{row.refs === 1 ? "" : "s"} · {row.scenarios} scenario{row.scenarios === 1 ? "" : "s"}
                </span>
                {inScenario
                  ? <span className="already-in">✓ in scenario</span>
                  : <button className="a1v2-btn sm">+ Add to GLW-30</button>}
                <button className="a1v2-btn ghost sm">View</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LeafReferences({ leaf_id }) {
  const D = window.NXA1V2;
  const leaf = D.leaves[leaf_id];
  const refs = leaf.references || [];
  return (
    <div className="a1v2-card">
      <div className="a1v2-leaf-header">
        <span className="icon">◦</span>
        <div>
          <div className="name">{leaf.name}</div>
          <div className="meta">
            <span>SKU {leaf.sku}</span>
            <span className="sep">·</span>
            <span>v{leaf.current_version}</span>
            <span className="sep">·</span>
            <span style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
              Used in {refs.length} ASY{refs.length === 1 ? "" : "s"} across {new Set(refs.map(r => r.scenario)).size} scenario{new Set(refs.map(r => r.scenario)).size === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="right">
          <CompletenessChip state="complete" filled={11} total={11} />
        </div>
      </div>
      <div className="a1v2-card-body">
        <h4 style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.12, textTransform: "uppercase", color: "var(--ink-4)", margin: "0 0 10px", fontWeight: 500 }}>
          Reference list · all ASYs using this leaf
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {refs.map((r, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12,
              padding: "10px 12px", background: "var(--paper-2)", border: "1px solid var(--rule)",
              borderRadius: 6, fontSize: 12.5,
            }}>
              <span style={{ color: "var(--ink-3)" }}>{r.scenario}</span>
              <span style={{ fontFamily: "var(--mono)", color: "var(--accent-ink)", letterSpacing: 0.04 }}>{r.assembly}</span>
              <a href="#" style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent-ink)" }}>View ASY →</a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CascadeWarningDemo({ leaf_id }) {
  const D = window.NXA1V2;
  const leaf = D.leaves[leaf_id];
  const refs = leaf.references || [];
  return (
    <>
      <div className="a1v2-cascade-warning">
        <span className="glyph">⚠</span>
        <div className="body">
          <span>
            <strong>This leaf is used in {refs.length} ASY{refs.length === 1 ? "" : "s"} across {new Set(refs.map(r => r.scenario)).size} scenario{new Set(refs.map(r => r.scenario)).size === 1 ? "" : "s"}.</strong>
            Editing specs will affect referencing quotes per their state: <strong>sent quotes stay pinned</strong> to v{leaf.current_version}; <strong>unsent quotes update</strong> to the new version.
          </span>
          <div className="ref-list">
            {refs.map((r, i) => {
              const isSent = i === 0;
              return (
                <div key={i} className="ref-row">
                  <span className="scenario">{r.scenario}</span>
                  <span className="asy">{r.assembly}</span>
                  <span className={`status ${isSent ? "sent" : "draft"}`}>
                    {isSent ? "sent · stays pinned" : "draft · will update"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="a1v2-card">
        <div className="a1v2-card-head">
          <h3>Edit specs · {leaf.name}</h3>
          <div className="actions">
            <button className="a1v2-btn ghost sm">Cancel</button>
            <button className="a1v2-btn primary sm">Save · cascade to {refs.filter((_, i) => i > 0).length} draft{refs.length - 1 === 1 ? "" : "s"}</button>
          </div>
        </div>
        <div className="a1v2-card-body">
          <SpecPanel
            title="Secondary packaging"
            fields={D.product_types.leaf_sp.field_schema}
            spec={leaf.spec_values}
            readOnly={false}
            filled={11} total={11}
          />
        </div>
      </div>
    </>
  );
}

function ReplenishmentSurface({ mode }) {
  const D = window.NXA1V2;
  const asy = D.assemblies[0]; // GLW-30
  return (
    <div className="a1v2-card">
      <div className="a1v2-card-head">
        <h3>{asy.sku} <em>· replenishment view</em></h3>
        <div className="actions">
          <span className="meta">Prior quote: <strong style={{ color: "var(--ink)" }}>{D.prior_quote_ref}</strong></span>
        </div>
      </div>
      <div className="a1v2-card-body">
        <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "0 0 14px", lineHeight: 1.55 }}>
          Each leaf shows a version-stamp pill comparing against <strong style={{ color: "var(--ink) " }}>{D.prior_quote_ref}</strong>'s pinned versions.
          {mode === "unchanged"
            ? " All leaves unchanged — confidence that the new quote represents the same physical components."
            : " One leaf has changed — PM reviews the diff before sending."}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {asy.leaves.slice(0, 3).map(al => {
            const leaf = D.leaves[al.leaf_id];
            const priorV = D.prior_quote_pins[al.leaf_id];
            const isChanged = mode === "changed" && al.leaf_id === "leaf_folding_carton_glw";
            const stamp = priorV
              ? (isChanged
                  ? <span className="a1v2-version-stamp changed">v{leaf.current_version} · changed since {D.prior_quote_ref} (was v{priorV})</span>
                  : <span className="a1v2-version-stamp unchanged">v{leaf.current_version} · unchanged since {D.prior_quote_ref}</span>)
              : <span className="a1v2-version-stamp new">v{leaf.current_version} · new since {D.prior_quote_ref}</span>;
            return (
              <div key={al.leaf_id} style={{
                display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 12,
                padding: "10px 14px", background: "var(--paper-2)", border: "1px solid var(--rule)",
                borderRadius: 6, alignItems: "center",
              }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink-4)" }}>◦</span>
                <div>
                  <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{leaf.name}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-4)", letterSpacing: 0.04, marginTop: 2 }}>
                    SKU {leaf.sku}
                  </div>
                </div>
                {stamp}
                {isChanged && <button className="a1v2-btn ghost sm">View diff</button>}
                {!isChanged && <span style={{ width: 80 }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── GROUP E · ADDENDUM ──────────────────────────────────────────

function AddendumSurface({ scenario }) {
  const D = window.NXA1V2;
  const [addendumOn, setAddendumOn] = useStateA1V2(!!scenario.addendum);

  useEffectA1V2(() => { setAddendumOn(!!scenario.addendum); }, [scenario.label]);

  const allEmpty = scenario.all_empty;
  const totalLeaves = D.assemblies.reduce((s, a) => s + a.leaves.length, 0);

  return (
    <div className="a1v2-pdf-shell">
      <div className="a1v2-pdf-toolbar">
        <span>Customer view · US Letter (8.5″ × 11″) · matches the rendered PDF</span>
        <div className="right">
          <div className={`a1v2-addendum-toggle ${addendumOn ? "on" : ""}`} onClick={() => setAddendumOn(!addendumOn)}>
            <span className="tog" />
            <span className="lab">Include spec addendum</span>
            <span className="meta">
              {addendumOn && !allEmpty && `· ${totalLeaves} leaves across ${D.assemblies.length} ASYs`}
              {addendumOn && allEmpty && `· all empty — will suppress`}
              {!addendumOn && "· pricing-only PDF"}
            </span>
          </div>
          <a href="#">↓ Download</a>
        </div>
      </div>
      <div className="a1v2-pdf-pages">
        <PricingPage addendumOn={addendumOn} allEmpty={allEmpty} totalLeaves={totalLeaves} />
        {addendumOn && !allEmpty && D.assemblies.map((asy, i) => (
          <AddendumPage key={asy.id} asy={asy} page={i + 2} totalPages={D.assemblies.length + 1} highlight={scenario.focus_asy === asy.id} />
        ))}
        {addendumOn && allEmpty && (
          <div style={{
            padding: "32px 24px", background: "var(--paper-2)", border: "1px dashed var(--rule-2)",
            borderRadius: 12, textAlign: "center", maxWidth: 480,
          }}>
            <div style={{ fontFamily: "var(--display)", fontStyle: "italic", fontSize: 24, color: "var(--ink-4)" }}>∅</div>
            <h4 style={{ fontFamily: "var(--display)", fontWeight: 500, fontSize: 16, margin: "8px 0 6px" }}>
              No spec data — addendum suppressed
            </h4>
            <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: 0, lineHeight: 1.5 }}>
              All leaves in this quote have empty specs. The addendum toggle is ON but the PDF won't include it. Toggle off to remove the pages from preview, or enter leaf specs on Setup first.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PricingPage({ addendumOn, allEmpty, totalLeaves }) {
  const D = window.NXA1V2;
  return (
    <div className="a1v2-pdf-paper">
      <div style={{
        paddingBottom: 18, borderBottom: "2px solid var(--ink)", marginBottom: 22,
        display: "grid", gridTemplateColumns: "1fr auto", gap: 18,
      }}>
        <div>
          <div style={{ fontFamily: "var(--display)", fontWeight: 500, fontSize: 22, color: "var(--ink)" }}>
            Davies Pharma Solutions
          </div>
          <div style={{ fontFamily: "var(--ui)", fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
            Contract manufacturing · Beauty + wellness · Established 2014
          </div>
        </div>
        <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)", letterSpacing: 0.06, textTransform: "uppercase" }}>
          Quotation
          <div style={{ fontFamily: "var(--display)", fontWeight: 500, fontSize: 18, color: "var(--ink)", letterSpacing: -0.005, textTransform: "none", marginTop: 4 }}>
            DPS-2418
          </div>
          <div style={{ marginTop: 6, color: "var(--ink-4)" }}>Issued · May 18, 2026</div>
        </div>
      </div>
      <h3 style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.12, textTransform: "uppercase", color: "var(--ink-4)", margin: "0 0 10px", fontWeight: 500 }}>
        Pricing · per unit
      </h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--ui)", fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: "var(--paper-2)" }}>
            <th style={{ textAlign: "left", padding: "8px 10px", fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: 0.08, textTransform: "uppercase", color: "var(--ink-4)", fontWeight: 500 }}>Product</th>
            {D.tiers.map(t => (
              <th key={t.id} style={{ textAlign: "right", padding: "8px 10px", fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: 0.08, textTransform: "uppercase", color: "var(--ink-4)", fontWeight: 500 }}>
                {t.recommended && <span style={{ color: "var(--accent-ink)" }}>★ </span>}{t.id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {D.assemblies.map(asy => (
            <tr key={asy.id}>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--rule)" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", letterSpacing: 0.04 }}>{asy.sku}</span>
                <span style={{ display: "block", color: "var(--ink)", fontWeight: 500 }}>{asy.name}</span>
              </td>
              {D.tiers.map(t => (
                <td key={t.id} style={{ textAlign: "right", padding: "10px", borderBottom: "1px solid var(--rule)", fontFamily: "var(--mono)" }}>
                  ${asy.unit_price.toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pdf-pagenum">
        Page 1 of {addendumOn && !allEmpty ? D.assemblies.length + 1 : 1}
        {addendumOn && !allEmpty && " · spec addendum follows ↓"}
      </div>
    </div>
  );
}

function AddendumPage({ asy, page, totalPages, highlight }) {
  const D = window.NXA1V2;
  return (
    <div className="a1v2-pdf-paper" style={highlight ? { boxShadow: "0 1px 0 var(--rule), 0 4px 16px oklch(from var(--accent) l c h / 0.25)" } : {}}>
      <div className="a1v2-addendum-header">
        <div>
          <h2 className="title">Product specifications</h2>
          <div style={{ fontFamily: "var(--ui)", fontSize: 11.5, color: "var(--ink-3)" }}>
            Leaf specs pinned at send · for {D.project.client}
          </div>
        </div>
        <div className="meta">Quotation · DPS-2418</div>
      </div>
      <div className="a1v2-addendum-asy">
        <div className="asy-head">
          <span className="sku">{asy.sku}</span>
          <span className="name">{asy.name}</span>
          <span className="meta">{asy.leaves.length} LEAF{asy.leaves.length === 1 ? "" : "s"}</span>
        </div>
        {asy.leaves.map(al => {
          const leaf = D.leaves[al.leaf_id];
          const type = leaf.product_type_id ? D.product_types[leaf.product_type_id] : null;
          if (!type) return (
            <div key={al.leaf_id} className="a1v2-leaf-block placeholder">
              <div className="leaf-block-head">
                <span className="name">{leaf.name}</span>
                <span className="type-tag" style={{ color: "var(--bad)", background: "var(--bad-soft)" }}>untyped</span>
                <span className="version-stamp">v{leaf.current_version}</span>
              </div>
              <div className="placeholder-msg">No Product Type set · specs cannot render</div>
            </div>
          );
          if (type.placeholder) return (
            <div key={al.leaf_id} className="a1v2-leaf-block placeholder">
              <div className="leaf-block-head">
                <span className="name">{leaf.name}</span>
                <span className="type-tag">{type.name}</span>
                <span className="version-stamp">v{leaf.current_version}</span>
              </div>
              <div className="placeholder-msg">{type.name} · fields TBD · pending schema</div>
            </div>
          );
          return (
            <div key={al.leaf_id} className="a1v2-leaf-block">
              <div className="leaf-block-head">
                <span className="name">{leaf.name}</span>
                <span className="type-tag">{type.name}</span>
                <span className="version-stamp">v{leaf.current_version}</span>
              </div>
              <div className="pp-sp-grid" style={type.field_schema.length > 8 ? {} : { gridTemplateColumns: "1fr" }}>
                <div className="section">
                  <h5>{type.name}</h5>
                  {type.field_schema.map(f => {
                    const v = leaf.spec_values?.[f.key];
                    return (
                      <div key={f.key} className="row">
                        <span className="lbl">{f.label}</span>
                        <span className={`val ${!v ? "empty" : ""}`}>{v || "--"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="pdf-pagenum">Davies Pharma Solutions · DPS-2418 · Page {page} of {totalPages}</div>
    </div>
  );
}

// ─── GROUP F · RE-QUOTE ──────────────────────────────────────────

function RequoteSurface({ scenario }) {
  const D = window.NXA1V2;
  if (scenario.mode === "edit_warning") return <SpecEditCascadeWarning />;
  if (scenario.mode === "out_of_sync") return <OutOfSyncIndicator />;
  if (scenario.mode === "requote_init") return <RequoteInitiated />;
  if (scenario.mode === "superseded") return <SupersededQuoteBanner />;
  return null;
}

function SpecEditCascadeWarning() {
  return <CascadeWarningDemo leaf_id="leaf_folding_carton_glw" />;
}

function OutOfSyncIndicator() {
  return (
    <>
      <div className="a1v2-out-of-sync">
        <span className="glyph">↻</span>
        <div className="body">
          <strong>Specs have changed since this quote was sent.</strong>
          <span>1 leaf updated: <em>30ml Glass Dropper Bottle</em> pinned at v3 · current v4 (Factory 2 backup tooling added). The PDF the customer received remains at v3.</span>
          <span className="meta">audit_id=a_4104 · leaf_delta=1 leaf changed across 1 ASY</span>
        </div>
        <button className="cta">Initiate re-quote →</button>
      </div>
      <div className="a1v2-card">
        <div className="a1v2-card-head">
          <h3>Quote v4 · sent <em>· waiting on customer</em></h3>
          <div className="actions"><span className="meta">DPS-2418 · sent May 17, 16:08</span></div>
        </div>
        <div className="a1v2-card-body">
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0, lineHeight: 1.5 }}>
            The out-of-sync callout above is the new A.1 v2 affordance — it surfaces when any LEAF on this quote has had its specs change since send.
            Pinned <code style={{ fontFamily: "var(--mono)" }}>leaf_spec_version_id</code> values remain intact (the customer-facing PDF stays accurate to what they received).
          </p>
        </div>
      </div>
    </>
  );
}

function RequoteInitiated() {
  return (
    <>
      <div className="a1v2-card">
        <div className="a1v2-card-head">
          <h3>Re-quote · new quote <em>· current leaf versions</em></h3>
          <div className="actions">
            <button className="a1v2-btn ghost sm">Cancel re-quote</button>
            <button className="a1v2-btn primary sm">Open in Quote umbrella →</button>
          </div>
        </div>
        <div className="a1v2-card-body">
          <div style={{
            display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, padding: "8px 0",
            fontSize: 13,
          }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.08, color: "var(--ink-4)", textTransform: "uppercase" }}>Quote ID</span>
            <span>
              <span style={{ fontFamily: "var(--mono)", color: "var(--accent-ink)", letterSpacing: 0.04 }}>DPS-2418-A</span>
              <span style={{ color: "var(--ink-4)", margin: "0 8px" }}>↩</span>
              <span style={{ fontFamily: "var(--mono)", color: "var(--ink-3)" }}>predecessor DPS-2418</span>
            </span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.08, color: "var(--ink-4)", textTransform: "uppercase" }}>Leaf versions</span>
            <span>4 leaves auto-pinned to current versions · 1 changed since predecessor (<span style={{ fontFamily: "var(--mono)", color: "var(--warn)" }}>leaf_glass_dropper_30 v3 → v4</span>)</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.08, color: "var(--ink-4)", textTransform: "uppercase" }}>Pricing</span>
            <span style={{ color: "var(--warn)" }}>Carried forward · may need update · spec change</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.08, color: "var(--ink-4)", textTransform: "uppercase" }}>ASYs</span>
            <span>4 ASYs · same as predecessor (GLW-30, GLW-50, RPL-200, CAP-60)</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.08, color: "var(--ink-4)", textTransform: "uppercase" }}>Audit trail</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
              action=requote.created · caused_by=leaf_spec_version_pin(leaf_glass_dropper_30,v4)
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

function SupersededQuoteBanner() {
  return (
    <>
      <div className="a1v2-superseded">
        <span className="glyph">⊘</span>
        <div className="body">
          <strong>This quote was superseded.</strong> Re-quoted as <span className="new-qid">DPS-2418-A</span> on May 18 — current leaf versions. The customer received this version (DPS-2418) on May 17.
        </div>
        <a href="#">View new quote →</a>
      </div>
      <div className="a1v2-card">
        <div className="a1v2-card-head">
          <h3>Quote v4 · superseded <em>· audit-only</em></h3>
          <div className="actions"><span className="meta">DPS-2418 · superseded by DPS-2418-A</span></div>
        </div>
        <div className="a1v2-card-body">
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0, lineHeight: 1.5 }}>
            This quote stays in audit history with its pinned <code style={{ fontFamily: "var(--mono)" }}>leaf_spec_version_id</code> values intact. No automatic cancellation —
            if the customer accepts this version (the original), it's still valid. Quote umbrella surfaces are read-only beyond this point.
          </p>
        </div>
      </div>
    </>
  );
}

// ─── GROUP G · AUDIT EXPORT ──────────────────────────────────────

function ExportSurface({ scenario }) {
  if (scenario.mode === "csv") return <CsvPreview />;
  return <AuditExportModal mode={scenario.mode} />;
}

function AuditExportModal({ mode }) {
  const isQuote = mode === "quote";
  return (
    <div className="a1v2-modal-backdrop">
      <div className="a1v2-modal">
        <div className="a1v2-modal-head">
          <h2>{isQuote ? "Export DPS-2418 audit log" : "Export leaf audit log · 30ml Glass Dropper"}</h2>
          <p className="sub">
            {isQuote
              ? "CSV download with full audit trail for this quote. Includes leaf spec changes, ASY edits, push events, state transitions."
              : "CSV download with field-level events for this library leaf. Includes spec edits, version pins by quote, attach/detach events."}
          </p>
        </div>
        <div className="a1v2-modal-body">
          <div className="row-pair">
            <div className="field">
              <span className="lbl">Date range — from</span>
              <input defaultValue="2026-02-01" />
            </div>
            <div className="field">
              <span className="lbl">to</span>
              <input defaultValue="2026-05-18" />
            </div>
          </div>
          <div className="field">
            <span className="lbl">Include event types</span>
            <div style={{
              padding: "10px 12px", background: "var(--paper-2)",
              border: "1px solid var(--rule)", borderRadius: 6,
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-2)" }}>
                <input type="checkbox" defaultChecked /> Leaf spec field edits
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-2)" }}>
                <input type="checkbox" defaultChecked /> Version pins (system events)
              </label>
              {isQuote && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-2)" }}>
                  <input type="checkbox" defaultChecked /> Quote state transitions
                </label>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-2)" }}>
                <input type="checkbox" defaultChecked /> Assembly-leaf attach/detach
              </label>
              {isQuote && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-2)" }}>
                  <input type="checkbox" defaultChecked /> HubSpot/NetSuite push events
                </label>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-2)" }}>
                <input type="checkbox" /> User-only events (exclude system actions)
              </label>
            </div>
          </div>
          <div className="field">
            <span className="lbl">Filename</span>
            <input defaultValue={isQuote ? "audit-DPS-2418-2026-05-18.csv" : "audit-leaf-glass-dropper-30-2026-05-18.csv"} />
          </div>
        </div>
        <div className="a1v2-modal-foot">
          <span className="left">{isQuote ? "67 events across 3 versions" : "12 events across 4 spec versions"}</span>
          <button className="a1v2-btn ghost">Cancel</button>
          <button className="a1v2-btn primary">↓ Download CSV</button>
        </div>
      </div>
    </div>
  );
}

function CsvPreview() {
  const D = window.NXA1V2;
  return (
    <div className="a1v2-card">
      <div className="a1v2-card-head">
        <h3>audit-leaf-glass-dropper-30-2026-05-18.csv <em>· preview</em></h3>
        <div className="actions">
          <span className="meta">4 of 12 rows shown · full export contains all 12</span>
          <button className="a1v2-btn ghost sm">↓ Download full CSV</button>
        </div>
      </div>
      <div className="a1v2-card-body">
        <div className="a1v2-csv-preview">
          <table>
            <thead>
              <tr>
                <th>timestamp</th>
                <th>actor</th>
                <th>action</th>
                <th>target</th>
                <th>diff_json</th>
                <th>audit_id</th>
                <th>caused_by</th>
              </tr>
            </thead>
            <tbody>
              {D.audit_log_sample.map(r => (
                <tr key={r.audit_id}>
                  <td>{r.ts}</td>
                  <td><span className="actor-type">{r.actor_type}</span>{r.actor_name}</td>
                  <td>{r.action}</td>
                  <td>{r.target_type}:{r.target_id}</td>
                  <td className="diff">{r.diff}</td>
                  <td>{r.audit_id}</td>
                  <td>{r.caused_by || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 12, fontSize: 11.5, color: "var(--ink-3)", fontFamily: "var(--mono)", letterSpacing: 0.04 }}>
          <strong style={{ color: "var(--ink)" }}>caused_by_audit_id</strong> chains cascade events. A field-edit on a leaf triggers a version-pin event when the next quote sends; the export shows the chain so auditors can trace causation across multi-event mutations.
        </p>
      </div>
    </div>
  );
}

// ─── GROUP H · SOFT GATE ─────────────────────────────────────────

function SoftGateSurface({ scenario }) {
  const D = window.NXA1V2;
  // Collect leaves across all ASYs that have non-complete specs
  const incompleteLeaves = [];
  D.assemblies.forEach(asy => {
    asy.leaves.forEach(al => {
      const leaf = D.leaves[al.leaf_id];
      const c = computeLeafCompleteness(leaf);
      if (c.state !== "complete") {
        incompleteLeaves.push({ asy, leaf, completeness: c });
      }
    });
  });

  return (
    <>
      <div className="a1v2-soft-gate">
        <span className="glyph">⚠</span>
        <div className="body">
          <strong>{incompleteLeaves.length} leaves have incomplete specifications.</strong>
          <span>Spec addendum will render missing fields as <code style={{ fontFamily: "var(--mono)" }}>--</code> for those leaves. PM may proceed — informational only, send is not blocked.</span>
          <div className="per-leaf">
            {incompleteLeaves.map(({ asy, leaf, completeness }) => (
              <div key={leaf.id} className="item">
                <span className="asy">{asy.sku}</span>
                <span className="leaf">{leaf.name.split("·")[0].trim()}</span>
                <span className="status">
                  {completeness.state === "no_type" && "untyped · pick a type"}
                  {completeness.state === "empty" && "no specs entered"}
                  {completeness.state === "partial" && completeness.placeholder && "fields TBD (placeholder)"}
                  {completeness.state === "partial" && !completeness.placeholder &&
                    `${completeness.total - completeness.filled} fields pending`}
                </span>
                <a href="#">Edit on Setup →</a>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="a1v2-card">
        <div className="a1v2-card-head">
          <h3>Preview Quote <em>· customer-facing artifact review</em></h3>
          <div className="actions">
            <button className="a1v2-btn ghost sm">← Back to Pricing</button>
            <button className="a1v2-btn primary sm">Looks good · advance to Send</button>
          </div>
        </div>
        <div className="a1v2-card-body">
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0, lineHeight: 1.5 }}>
            Phase A's Preview surface renders here normally — the soft gate above is the new A.1 v2 affordance, sitting alongside the existing customer-info-gap and pricing-warning callouts.
            The "Looks good · advance to Send" CTA is enabled — soft gate is informational, not blocking.
          </p>
        </div>
      </div>
    </>
  );
}

window.NXA1V2App = A1V2App;
