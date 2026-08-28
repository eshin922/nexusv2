/**
 * A tier label is a NAME, and this is where that is enforced.
 *
 * ── WHAT HAPPENED ───────────────────────────────────────────────────────
 *
 * `updateTier` took `String(formData.get("label")).trim()` straight to the
 * column with no bound of any kind. On 2026-08-28 a 1,366-character paste — a
 * page of engineering prose — landed in one production tier's label, and every
 * consumer did exactly what it should with the value it was given:
 *
 *   Costs      the Tier 2 column heading in the Price Build grid, expanded
 *              vertically until the page geometry broke
 *   Pricing    the tier selector chip and the Pricing Detail column header
 *   Quote      `Goods sell · <label>` in the governed side rail
 *   PDF        the tier heading inside the customer-facing document
 *
 * None of those is a rendering defect. They are four correct consumers of one
 * corrupt authoritative value — which is exactly why the bound belongs here.
 * Truncating at a surface would hide the corruption while leaving the customer
 * document built from it.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────
 *
 * It lived in `actions/quotes.ts` first, which pulls `next/navigation` and so
 * cannot be imported by a unit test. A validator whose correctness cannot be
 * exercised directly is one whose edge cases get asserted through a mock of
 * something else. Pure function, no framework, importable by every writer that
 * ever needs it.
 */
import { ActionGuardError, ERR } from "@/lib/action-result";

/**
 * ── WHY 24 ──────────────────────────────────────────────────────────────
 *
 * Chosen from the production population, not from taste. Read 2026-08-28: 16
 * legitimate distinct labels across 149 rows, the longest SIX characters —
 * `Tier 1`…`Tier 6`, `T1`…`T5`, `5K`, `15K`, `50K`, `5000`, `10000`, `25000`.
 *
 * So the field IS used as free text and must stay that way; only its length is
 * unreasonable. 24 is four times the longest real label — room for `Initial
 * production run` (22) or `First PO · 10k` — while making a pasted paragraph
 * impossible. A tighter bound would break naming nobody has done yet; a looser
 * one admits prose.
 */
export const TIER_LABEL_MAX = 24;

export function assertTierLabel(raw: string): string {
  const label = raw.trim();

  if (label.length === 0) {
    throw new ActionGuardError(ERR.VALIDATION, "A tier needs a label.");
  }

  // ONE LINE. A multi-line label is the shape that expanded a grid column
  // vertically. Checked by CODE POINT rather than by a regex character class:
  // the class form was mangled twice on the way into this file by the tooling
  // that wrote it, silently becoming a range that matched almost nothing. A
  // guard that cannot survive being written down is not a guard.
  //
  // Covers every C0 control and DEL, so a lone carriage return cannot pass a
  // check that only knew about newline — the two arrive from different clients.
  for (let k = 0; k < label.length; k++) {
    const code = label.charCodeAt(k);
    if (code < 0x20 || code === 0x7f) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "A tier label is one line — it cannot contain line breaks.",
      );
    }
  }

  if (label.length > TIER_LABEL_MAX) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `A tier label is at most ${TIER_LABEL_MAX} characters — this one is ` +
        `${label.length}. It names a column on Costs, Pricing, the Quote rail ` +
        `and the customer PDF, so it has to read as a name.`,
    );
  }

  return label;
}
