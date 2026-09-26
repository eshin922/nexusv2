"use client";

import type { ReactNode } from "react";
import { TOOLING_CLASSIFICATION_LABELS, type ToolingClassification } from "@/lib/netsuite/component-charge-destination";
import { enumLabel } from "@/lib/enum-labels";
import { HS_PRODUCT_TYPE_OPTIONS } from "@/lib/hubspot-product-options";

export function toolingLabel(value: ToolingClassification | null): string | null {
  return value === null ? null : TOOLING_CLASSIFICATION_LABELS[value];
}

/** Keep governed values readable without rewriting already-authored labels. */
export function costCategoryLabel(value: string | null): string {
  if (value === null) return "inherit";
  const productTypeLabel = HS_PRODUCT_TYPE_OPTIONS.find(
    (option) => option.value === value,
  )?.label;
  if (productTypeLabel) return productTypeLabel;
  return value.includes("_") ? enumLabel(value) : value;
}

/**
 * Presentation primitives shared by the three M2 views.
 *
 * STORED VALUES RENDER AS STORED. A unit cost of `"1.1100"` renders `1.1100`,
 * not `$1.11`: that is what the design's entry cells show, and rounding for
 * display would make two different costs read as the same number on a surface
 * whose purpose is comparison.
 *
 * ABSENT IS NOT ZERO. `null` renders `unpriced` in the muted ramp; `"0"` renders
 * `0`. One is an operator who has not been here, the other is a stated zero.
 */

/** A read-only tier cell — prototype `fld().cells[]`. A span, never an input. */
export function ValueCell({
  stored,
  tierLabel,
  highlighted,
  basis,
}: {
  stored: string | null;
  tierLabel?: string;
  highlighted?: boolean;
  /** The caption under the value — `per unit`, `all tiers`. */
  basis?: string;
}) {
  const empty = stored === null;
  return (
    <span className={`cm2-cell${highlighted ? " cm2-hl" : ""}`}>
      <span
        className={`cm2-value${empty ? " cm2-empty" : ""}`}
        aria-readonly="true"
        title={tierLabel}
      >
        {empty ? "unpriced" : stored}
      </span>
      {basis ? <span className="cm2-basis">{basis}</span> : null}
    </span>
  );
}

/** A cell that carries text rather than a value — `in module`, `—`. */
export function TextCell({
  text,
  highlighted,
}: {
  text: string;
  highlighted?: boolean;
}) {
  return (
    <span className={`cm2-cell${highlighted ? " cm2-hl" : ""}`}>
      <span className="cm2-figure cm2-empty">{text}</span>
    </span>
  );
}

/** An empty grid track. */
export function BlankCell() {
  return <span className="cm2-cell" />;
}

export function Tag({
  tone = "neutral",
  children,
  title,
}: {
  tone?: "neutral" | "accent" | "plain" | "amber" | "green" | "purple";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      className={tone === "neutral" ? "cm2-tag" : `cm2-tag cm2-${tone}`}
      title={title}
    >
      {children}
    </span>
  );
}

/** A read-only field in the By-product card — prototype `edReadOnly()`. */
export function EdField({
  label,
  value,
  hint,
  mono,
  span,
  hintTone,
}: {
  label: string;
  value: string | null;
  hint?: string;
  mono?: boolean;
  span?: boolean;
  hintTone?: "amber";
}) {
  const empty = value === null || value === "";
  return (
    <div className={`cm2-edfield${span ? " cm2-span" : ""}`}>
      <span className="cm2-edlabel">{label}</span>
      <span
        className={`cm2-edvalue${mono ? " cm2-mono" : ""}${empty ? " cm2-empty" : ""}`}
        aria-readonly="true"
      >
        {empty ? "unpriced" : value}
      </span>
      {hint ? (
        <span className={`cm2-edhint${hintTone ? ` cm2-${hintTone}ink` : ""}`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** Four decimals — the stored grain. Formatting, not arithmetic. */
export function fmtUsd4(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export const EMPTY = "—";

/** Costs columns identify the order option by its actual quantity. */
export function tierHead(t: { label: string; qty: number | null }): {
  label: string;
  qty: string | null;
} {
  if (t.qty === null) return { label: t.label.toUpperCase(), qty: null };
  return { label: `${t.qty.toLocaleString("en-US")} units`, qty: null };
}

/** The tier column heading as one element, shared by every grid view. */
export function TierHeadCell({
  tier,
  active,
}: {
  tier: { id: string; label: string; qty: number | null };
  active: boolean;
}) {
  const head = tierHead(tier);
  return (
    <div className={`cm2-tierhead${active ? " cm2-hl" : ""}`}>
      <span className="cm2-tierhead-label">{head.label}</span>
      {head.qty ? <span className="cm2-tierhead-qty">{head.qty}</span> : null}
    </div>
  );
}
