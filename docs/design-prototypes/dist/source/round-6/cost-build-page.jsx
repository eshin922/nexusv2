// Cost Build — main page composition.
// Single page with cost stack on top and three section rows below
// (Packaging, Production, Freight). Section drill-down opens INLINE.

const { useState: useStateBuild } = React;

function CostBuildPage({ state, openSection, onOpenSection, prodToggles, onProdToggle, freightTreatments, onFreightTreatment, rawsMode, onRawsMode }) {
  const D = window.NXR6;
  const D1 = window.NXR6_1;

  // Pick the right slice of fixtures for this state
  const stackData = D.cost_stack[state];
  const pkgData = D.packaging[state];
  const prodDataRaw = D.production[state];
  const frtDataRaw = D.freight[state];
  const rawData = D1.bulk_raw[state];
  const formulaYield = D1.formula_yield[state];
  const deposits = D1.deposits[state] || {};
  const effectiveRawsMode = rawsMode || D1.raws_mode_default[state];

  // Per-tier RAW total (T2 baseline)
  const rawTotalT2 = effectiveRawsMode === "dps_sources" && rawData.categories.length > 0
    ? rawData.categories.reduce((s, cat) => s + cat.ingredients.reduce((a, i) => a + i.native_cost * i.usage_per_filled_unit * (1 + cat.markup_pct), 0), 0)
    : null;

  // Apply tweakable production overrides + freight overrides
  const prodData = {
    ...prodDataRaw,
    customer_ships_raws: prodToggles.customer_ships_raws ?? prodDataRaw.customer_ships_raws,
    allocate_service_fees_to_unit_cost: prodToggles.allocate_service_fees_to_unit_cost ?? prodDataRaw.allocate_service_fees_to_unit_cost,
  };
  const frtData = {
    ...frtDataRaw,
    lines: frtDataRaw.lines.map((l) => ({
      ...l,
      treatment: freightTreatments[l.id] || l.treatment,
    })),
  };

  // Build mini-stack rows for each section header
  const headerTiers = stackData.tiers.map((t) => ({
    id: t.id, label: t.label, units: t.units, active: t.active,
  }));

  // Bulk Raw mini-stack — per-tier raw total with volume break
  const rawRowTiers = headerTiers.map((t) => {
    if (effectiveRawsMode !== "dps_sources" || rawTotalT2 == null) return { ...t, value: null };
    const tierIdx = ["T1", "T2", "T3", "T4"].indexOf(t.id);
    const scale = [1.04, 1.0, 0.95, 0.92][tierIdx] ?? 1.0;
    return { ...t, value: rawTotalT2 * scale };
  });

  const pkgRowTiers = headerTiers.map((t) => {
    const v = pkgData.lines.length > 0
      ? pkgData.lines.reduce((s, l) => s + (l[t.id.toLowerCase()] || 0), 0)
      : null;
    const allMissing = pkgData.lines.length === 0 || pkgData.lines.every((l) => l[t.id.toLowerCase()] == null);
    return { ...t, value: allMissing ? null : v };
  });
  const prodRowTiers = headerTiers.map((t) => {
    const v = prodData.lines.length > 0
      ? prodData.lines.reduce((s, l) => s + (l[t.id.toLowerCase()] || 0), 0)
      : null;
    const allMissing = prodData.lines.length === 0 || prodData.lines.every((l) => l[t.id.toLowerCase()] == null);
    return { ...t, value: allMissing ? null : v };
  });
  const frtRowTiers = headerTiers.map((t) => {
    const sum = frtData.lines.reduce((s, l) => {
      const td = l.tiers.find((tl) => tl.id === t.id);
      return s + (td && td.per_unit != null ? td.per_unit : 0);
    }, 0);
    const allMissing = frtData.lines.length === 0 || frtData.lines.every((l) => {
      const td = l.tiers.find((tl) => tl.id === t.id);
      return !td || td.per_unit == null;
    });
    return { ...t, value: allMissing ? null : sum };
  });

  return (
    <div className="r6-page">
      <div className="r6-page-head">
        <div>
          <h1>Cost build <em>· {D.scenario.label} v{D.scenario.version}</em></h1>
          <p className="sub">
            Three sections — Packaging, Production, Freight — feeding one cost stack across {stackData.tiers.length} {stackData.tiers.length === 1 ? "tier" : "tiers"}. Drill in to edit; the stack updates live.
          </p>
          <div className="meta">
            <span className="live" />
            <span>Synced to HubSpot · {D.project.hubspot_synced_at}</span>
            <span>·</span>
            <span>{D.project.hubspot_stage}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn">View as customer →</button>
          <button className="btn primary">Save draft</button>
        </div>
      </div>

      {/* SKU + scenario context */}
      <div className="r6-context">
        <span className="anchor-pill">
          <span className="star">★</span>
          <span>{D.scenario.sku.code}</span>
          <span className="code">— anchor SKU</span>
        </span>
        <span className="ctx-name">{D.scenario.sku.name}</span>
        <span className="ctx-meta">
          {stackData.tiers.length} {stackData.tiers.length === 1 ? "tier" : "tiers"} · {D.scenario.sku.units_total.toLocaleString()} units total committed
        </span>
        <span className="ctx-spacer" />
        <button className="ctx-action">↗ Other SKUs in this scenario (2)</button>
        <button className="ctx-action">⌥ Switch scenario</button>
      </div>

      {/* Designer note about the redesign */}
      {state === "inProgress" && (
        <div className="r6-dn">
          <span className="lbl">DN</span>
          The legacy IA had concept tabs (Packaging Setup, Cost Setup, Production Setup, Freight Calc) and a dual cost-stack widget. This collapses to one page with three sections + one cost-stack header. Drill-down replaces tabs; multi-tier becomes the primary spatial axis. See designer notes for tradeoffs.
        </div>
      )}

      {/* Cost stack header */}
      <window.NXR6CostStack
        tiers={stackData.tiers}
        activeTierId={stackData.tiers.find((t) => t.active)?.id}
        onPickTier={() => {}}
        rawsMode={effectiveRawsMode}
        rawTotalT2={rawTotalT2}
      />

      {/* Four sections */}
      <div className="r6-sections">
        <window.NXR6Section
          section="Packaging"
          open={openSection === "packaging"}
          onToggle={() => onOpenSection(openSection === "packaging" ? null : "packaging")}
          tiers={pkgRowTiers}
          status={pkgData.status === "empty" ? "empty" : pkgData.status}
          owner={pkgData.owner}
          lineCount={pkgData.lines.length}
          deposit={deposits.packaging}
          sublabel={pkgData.lines.length > 0
            ? `${pkgData.lines.filter((l) => l.inventory_eligible).length} inventory-eligible · ${new Set(pkgData.lines.map((l) => l.supplier)).size} suppliers`
            : "Bottle, dropper, label, carton — markup defaults from category"}
        >
          <window.NXR6Packaging data={pkgData} tiers={headerTiers} />
        </window.NXR6Section>

        <window.NXR6Section
          section="Production"
          open={openSection === "production"}
          onToggle={() => onOpenSection(openSection === "production" ? null : "production")}
          tiers={prodRowTiers}
          status={prodData.status === "empty" ? "empty" : prodData.status}
          owner={prodData.owner}
          lineCount={prodData.lines.length}
          deposit={deposits.production}
          sublabel={
            prodData.lines.length > 0
              ? `${prodData.allocate_service_fees_to_unit_cost ? "fees amortized" : "fees billed separately"}${prodData.yield_locked ? " · run locked" : ""}`
              : "Filling, assembly, NRE — service fees & per-unit price"
          }
        >
          <window.NXR6Production data={prodData} tiers={headerTiers} onToggle={onProdToggle} formulaYield={formulaYield} />
        </window.NXR6Section>

        <window.NXR6Section
          section="Bulk Raw"
          open={openSection === "bulk_raw"}
          onToggle={() => onOpenSection(openSection === "bulk_raw" ? null : "bulk_raw")}
          tiers={rawRowTiers}
          status={
            effectiveRawsMode !== "dps_sources"
              ? "complete"
              : rawData.status === "empty"
              ? "empty"
              : rawData.status
          }
          owner={rawData.owner}
          lineCount={rawData.categories.length}
          deposit={effectiveRawsMode === "dps_sources" ? deposits.bulk_raw : null}
          sublabel={
            effectiveRawsMode === "cm_sources"
              ? "CM sources raws — folded into Production"
              : effectiveRawsMode === "customer_supplies"
              ? "Customer supplies raws — no cost contribution"
              : rawData.categories.length > 0
              ? `${rawData.categories.length} categories · ${rawData.categories.reduce((s, c) => s + c.ingredients.length, 0)} ingredients · native units`
              : "Oil base, actives, fragrance, preservatives — billed in kg / L / mL"
          }
        >
          <window.NXR6BulkRaw
            data={rawData}
            rawsMode={effectiveRawsMode}
            onChangeMode={onRawsMode}
            deposit={deposits.bulk_raw}
          />
        </window.NXR6Section>

        <window.NXR6Section
          section="Freight"
          open={openSection === "freight"}
          onToggle={() => onOpenSection(openSection === "freight" ? null : "freight")}
          tiers={frtRowTiers}
          status={frtData.status === "empty" ? "empty" : (frtData.lines.length > 0 ? "complete" : "in_progress")}
          owner={frtData.owner}
          lineCount={frtData.lines.length}
          sublabel={
            frtData.lines.length > 0
              ? `${frtData.lines.length} line${frtData.lines.length === 1 ? "" : "s"} · ${frtData.lines.filter((l) => l.treatment === "bundled").length} bundled, ${frtData.lines.filter((l) => l.treatment === "pass_through").length} passthrough · customs on DDP`
              : "Inbound, outbound, customs — per-line treatment"
          }
        >
          <window.NXR6Freight data={frtData} tiers={headerTiers} onChangeTreatment={onFreightTreatment} />
        </window.NXR6Section>
      </div>
    </div>
  );
}

window.NXR6Page = CostBuildPage;
