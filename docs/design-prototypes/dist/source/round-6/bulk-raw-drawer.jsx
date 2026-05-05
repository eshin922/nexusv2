// Bulk Raw drawer.
// Three components:
//   1) Raws-mode banner (DPS / CM / Customer) — selecting CM or Customer
//      collapses the rest of the drawer to a "no costs tracked here" state
//      because raws don't contribute to our cost stack in those modes.
//   2) Per-category cards. Each category is a deposit-eligible unit; the
//      ingredient sub-lines are the actual costed items.
//   3) Per-ingredient row: native unit (kg / L / mL), native cost, usage
//      per filled unit, computed per-unit cost. The conversion is the
//      whole point — procurement enters native, the cost stack reads
//      per-unit. We show the math.

function BulkRawDrawer({ data, rawsMode, onChangeMode, deposit }) {
  // Inactive modes
  if (rawsMode === "cm_sources" || rawsMode === "customer_supplies") {
    return (
      <React.Fragment>
        <RawsModeBanner mode={rawsMode} onChange={onChangeMode} />
        <div className="r6-empty-drawer">
          <div className="glyph">∅</div>
          <h4>Raws not tracked in this quote</h4>
          <p>
            {rawsMode === "cm_sources"
              ? "The CM is sourcing raws and billing through their service line. Raw cost contribution to the cost stack is zero — the goo is folded into Production's per-unit price."
              : "Customer is supplying raws to the CM. We don't see the cost; the cost stack RAW row is hidden."}
            {" "}Switch to <em>DPS sources</em> above if that changes.
          </p>
        </div>
      </React.Fragment>
    );
  }

  // Active (DPS sources) — show categories
  if (data.status === "empty" || data.categories.length === 0) {
    return (
      <React.Fragment>
        <RawsModeBanner mode={rawsMode} onChange={onChangeMode} />
        <div className="r6-empty-drawer">
          <div className="glyph">∅</div>
          <h4>No raw categories yet</h4>
          <p>Add the formula's raw categories — oil base, actives, fragrance, preservatives — then ingredient sub-lines under each. We bill native units (kg / L / mL); per-unit cost is computed from usage per filled bottle.</p>
          <div className="actions">
            <button className="btn primary">+ Add raw category</button>
            <button className="btn ghost">Pull from formula library</button>
          </div>
        </div>
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      <RawsModeBanner mode={rawsMode} onChange={onChangeMode} />

      <div className="drawer-toolbar">
        <div className="lhs">
          <span><strong>{data.categories.length}</strong> raw categories</span>
          <span>·</span>
          <span>{data.categories.reduce((s, c) => s + c.ingredients.length, 0)} ingredients</span>
          <span>·</span>
          <span>Native units (kg / L / mL) → per-unit via usage × fill volume</span>
          {deposit && deposit.outstanding_total > 0 && (
            <React.Fragment>
              <span>·</span>
              <span style={{ color: "var(--warn)" }}>${deposit.outstanding_total.toLocaleString()} deposit outstanding</span>
            </React.Fragment>
          )}
        </div>
        <div className="rhs">
          <button className="btn sm">+ Category</button>
        </div>
      </div>

      {data.categories.map((cat) => (
        <RawCategory key={cat.id} category={cat} />
      ))}
    </React.Fragment>
  );
}

function RawsModeBanner({ mode, onChange }) {
  const opts = window.NXR6_1.raws_mode_options;
  return (
    <div className="r6-raws-mode">
      {opts.map((o) => (
        <div
          key={o.key}
          className={`r6-raws-opt ${mode === o.key ? "on" : ""}`}
          onClick={() => onChange && onChange(o.key)}
        >
          <div className="lab">
            <span className="pip" />
            {o.label}
          </div>
          <div className="desc">{o.desc}</div>
          <div className="consequence">→ {o.consequence}</div>
        </div>
      ))}
    </div>
  );
}

function RawCategory({ category }) {
  const totalNativeCost = category.ingredients.reduce((s, i) => s + (i.native_cost * i.usage_per_filled_unit), 0);
  return (
    <div className="r6-raw-cat">
      <div className="r6-raw-cat-head">
        <div>
          <div className="name">{category.name}</div>
          <div className="meta">
            <span>{category.ingredients.length} ingredient{category.ingredients.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <span className="markup">markup {(category.markup_pct * 100).toFixed(0)}%</span>
        <span className="total">${totalNativeCost.toFixed(3)} / unit</span>
      </div>

      <div className="r6-raw-ing-head">
        <span>Ingredient</span>
        <span className="num">Native unit</span>
        <span className="num">Cost / native</span>
        <span className="num">Usage / filled unit</span>
        <span className="num">Per filled unit</span>
        <span></span>
      </div>

      {category.ingredients.map((ing) => {
        const perUnit = ing.native_cost * ing.usage_per_filled_unit;
        return (
          <div key={ing.id} className="r6-raw-ing">
            <div className="name">
              {ing.name}
              {ing.hts_code && <span className="sub">HTS {ing.hts_code}</span>}
              {ing.supplier && <span className="sub">{ing.supplier}</span>}
            </div>
            <div className="num">{ing.native_unit}</div>
            <div className="num">${ing.native_cost.toFixed(2)}<span className="raw-detail">/ {ing.native_unit}</span></div>
            <div className="num">{ing.usage_per_filled_unit}<span className="raw-detail">{ing.native_unit} / fill</span></div>
            <div className="num per-unit">${perUnit.toFixed(4)}</div>
            <div className="actions">···</div>
          </div>
        );
      })}
    </div>
  );
}

window.NXR6BulkRaw = BulkRawDrawer;
