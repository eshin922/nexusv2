"use client";

import { useTransition } from "react";
import { setRawsMode } from "@/app/actions/bulk-raw";

// Slice RI.4 — Bulk Raw drill-down per R6 source
// (`docs/design-prototypes/dist/source/round-6/bulk-raw-drawer.jsx`).
//
// Composition:
//   1. Raws-mode banner (.r6-raws-mode) — three radio cards: DPS / CM /
//      Customer. Acts as the mode-declaration zone per R6 + Bulk Raw
//      correction.
//   2. When mode = cm_sources / customer_supplies → r6-empty-drawer
//      with explanation.
//   3. When mode = dps_sources + no categories → r6-empty-drawer CTA.
//   4. When mode = dps_sources + categories present → drawer toolbar
//      + per-category cards (.r6-raw-cat) with ingredient table
//      (.r6-raw-ing-head / .r6-raw-ing) below.

type BulkRawCategory = {
  id: string;
  quoteId: string;
  name: string;
  markupPct: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type BulkRawIngredient = {
  id: string;
  categoryId: string;
  name: string;
  nativeUnit: "kg" | "L" | "mL" | "oz" | "g" | "lb";
  costPerNativeUnit: string | null;
  usagePerFilledUnit: string | null;
  perFilledUnitCost: string | null;
  htsCode: string | null;
  supplierId: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

const RAWS_MODE_OPTIONS: Array<{
  key: "dps_sources" | "cm_sources" | "customer_supplies";
  label: string;
  desc: string;
  consequence: string;
}> = [
  {
    key: "cm_sources",
    label: "CM sources raws",
    desc: "Contract manufacturer sources the bulk raws. Raws cost enters via Production's bulk-raw-cost field.",
    consequence: "→ raws folded into Production",
  },
  {
    key: "dps_sources",
    label: "DPS sources raws",
    desc: "DPS purchases the bulk raws. Ingredients enter here in native units (kg / L / mL); per-unit cost is computed.",
    consequence: "→ RAW row visible in cost stack",
  },
  {
    key: "customer_supplies",
    label: "Customer supplies raws",
    desc: "Customer ships raws to DPS. Production covers labor + overhead only. Raws excluded from landed cost.",
    consequence: "→ raws excluded from landed cost",
  },
];

function fmtNumOrDash(n: string | null, decimals: number): string {
  if (n === null) return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return num.toFixed(decimals);
}

function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function BulkRawDrilldown({
  quoteId,
  rawsMode,
  categories,
  ingredients,
  editable,
}: {
  quoteId: string;
  rawsMode: "cm_sources" | "dps_sources" | "customer_supplies";
  categories: BulkRawCategory[];
  ingredients: BulkRawIngredient[];
  editable: boolean;
}) {
  const ingsByCategory = new Map<string, BulkRawIngredient[]>();
  for (const ing of ingredients) {
    const arr = ingsByCategory.get(ing.categoryId) ?? [];
    arr.push(ing);
    ingsByCategory.set(ing.categoryId, arr);
  }

  return (
    <div>
      <RawsModeBanner
        quoteId={quoteId}
        currentMode={rawsMode}
        disabled={!editable}
      />

      {rawsMode !== "dps_sources" ? (
        <div className="r6-empty-drawer">
          <div className="glyph">∅</div>
          <h4>Raws not tracked in this quote</h4>
          <p>
            {rawsMode === "cm_sources"
              ? "The CM is sourcing raws and billing through their service line. Raw cost contribution to the cost stack is zero — the goo is folded into Production's per-unit price."
              : "Customer is supplying raws to the CM. We don't see the cost; the cost stack RAW row is hidden."}{" "}
            Switch to <em>DPS sources</em> above if that changes.
          </p>
        </div>
      ) : categories.length === 0 ? (
        <div className="r6-empty-drawer">
          <div className="glyph">∅</div>
          <h4>No raw categories yet</h4>
          <p>
            Add the formula's raw categories — oil base, actives, fragrance,
            preservatives — then ingredient sub-lines under each. We bill
            native units (kg / L / mL); per-unit cost is computed from usage
            per filled bottle.
          </p>
          <div className="actions">
            <button
              type="button"
              disabled
              title="CRUD UI ships in RI.4 follow-up · schema is in place"
              className="r6-btn primary"
            >
              + Add raw category
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="r6-drawer-toolbar">
            <div className="lhs">
              <span>
                <strong>{categories.length}</strong> raw categor
                {categories.length === 1 ? "y" : "ies"}
              </span>
              <span>·</span>
              <span>
                {ingredients.length} ingredient
                {ingredients.length === 1 ? "" : "s"}
              </span>
              <span>·</span>
              <span>Native units (kg / L / mL) → per-unit via usage × fill</span>
            </div>
            <div className="rhs">
              <button
                type="button"
                disabled
                title="CRUD UI ships in RI.4 follow-up"
                className="r6-btn sm"
              >
                + Category
              </button>
            </div>
          </div>

          {categories.map((cat) => (
            <RawCategoryCard
              key={cat.id}
              category={cat}
              ingredients={ingsByCategory.get(cat.id) ?? []}
            />
          ))}
        </>
      )}
    </div>
  );
}

function RawsModeBanner({
  quoteId,
  currentMode,
  disabled,
}: {
  quoteId: string;
  currentMode: "cm_sources" | "dps_sources" | "customer_supplies";
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function selectMode(mode: typeof RAWS_MODE_OPTIONS[number]["key"]) {
    if (disabled || pending || mode === currentMode) return;
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("rawsMode", mode);
    startTransition(async () => {
      await setRawsMode(fd);
    });
  }

  return (
    <div className="r6-raws-mode">
      {RAWS_MODE_OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`r6-raws-opt ${currentMode === o.key ? "on" : ""}`}
          onClick={() => selectMode(o.key)}
          disabled={disabled || pending}
        >
          <div className="lab">
            <span className="pip" />
            {o.label}
          </div>
          <div className="desc">{o.desc}</div>
          <div className="consequence">{o.consequence}</div>
        </button>
      ))}
    </div>
  );
}

function RawCategoryCard({
  category,
  ingredients,
}: {
  category: BulkRawCategory;
  ingredients: BulkRawIngredient[];
}) {
  const totalNativeCost = ingredients.reduce((s, i) => {
    const n = Number(i.perFilledUnitCost);
    return Number.isFinite(n) ? s + n : s;
  }, 0);
  const markupPct = category.markupPct ? Number(category.markupPct) * 100 : null;

  return (
    <div className="r6-raw-cat">
      <div className="r6-raw-cat-head">
        <div>
          <div className="name">{category.name}</div>
          <div className="meta">
            <span>
              {ingredients.length} ingredient
              {ingredients.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <span className="markup">
          markup {markupPct !== null ? `${markupPct.toFixed(0)}%` : "inherit"}
        </span>
        <span className="total">
          {totalNativeCost > 0 ? fmtCurr2(totalNativeCost) : "—"} / unit
        </span>
      </div>

      <div className="r6-raw-ing-head">
        <span>Ingredient</span>
        <span className="num">Native unit</span>
        <span className="num">Cost / native</span>
        <span className="num">Usage / filled unit</span>
        <span className="num">Per filled unit</span>
        <span></span>
      </div>

      {ingredients.length === 0 ? (
        <div
          style={{
            padding: "12px 16px",
            color: "var(--ink-4)",
            fontStyle: "italic",
            fontSize: "12.5px",
            textAlign: "center",
          }}
        >
          No ingredients in this category yet.
        </div>
      ) : (
        ingredients.map((ing) => (
          <div key={ing.id} className="r6-raw-ing">
            <div className="name">
              {ing.name}
              {ing.htsCode && <span className="sub">HTS {ing.htsCode}</span>}
            </div>
            <div className="num">{ing.nativeUnit}</div>
            <div className="num">
              ${fmtNumOrDash(ing.costPerNativeUnit, 2)}
              <span className="raw-detail">/ {ing.nativeUnit}</span>
            </div>
            <div className="num">
              {ing.usagePerFilledUnit ?? "—"}
              <span className="raw-detail">{ing.nativeUnit} / fill</span>
            </div>
            <div className="num per-unit">
              ${fmtNumOrDash(ing.perFilledUnitCost, 4)}
            </div>
            <div className="actions">···</div>
          </div>
        ))
      )}
    </div>
  );
}
