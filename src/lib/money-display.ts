/**
 * The one governed money-display path.
 *
 * ── THE RULE (business disposition, 2026-08-17) ───────────────────────────
 *
 *   - Unit prices: 2 decimal places.
 *   - Extended amounts, line totals, service fees, turnkey totals and grand
 *     totals: 2 decimal places.
 *   - Trailing cents are preserved. `$100.50`, never `$101`.
 *   - The same underlying monetary value displayed on Pricing and on the
 *     customer PDF must round IDENTICALLY.
 *   - Rounding is decimal-correct, so a binary representation such as
 *     `2.8349999999999999645` cannot make two surfaces disagree.
 *   - Precision is explicit at the call site or in a semantic formatter. It is
 *     never inferred from magnitude.
 *
 * **Display authority only.** Nothing here touches stored values, engine
 * arithmetic, extended economics or reconciliation. `roundMoney` exists to
 * decide a GLYPH; it must not be used to compute one.
 *
 * ── THE TWO DEFECTS THIS REPLACES (ROUND-1) ───────────────────────────────
 *
 * **1 · Two instruments, not two policies.** Pricing formatted through
 * `Intl.NumberFormat`, which rounds the DECIMAL value, so an exact half goes
 * up. The customer PDF formatted through `toFixed`, which rounds the IEEE-754
 * DOUBLE — and `2.8350` is stored as `2.8349999999999999645`, below the half.
 * The witnessed cell showed `$2.84` on Pricing and `$2.83` on the PDF.
 *
 * Measured before the repair: of the 20,000 exact-half thousandths under $200,
 * **9,600 disagreed** — not a rare edge, about half of them. That is why the
 * repair is a shared path and not a patched cell.
 *
 * **2 · Precision inferred from magnitude.** The PDF's `money()` switched to
 * 0 dp at `Math.abs(n) >= 100` while Pricing held 2 dp at every magnitude, so
 * `$100.50` printed to the customer as `$101`. Fifty cents, silently, on the
 * document the customer keeps.
 *
 * ── WHY PRE-ROUNDING FIXES BOTH ───────────────────────────────────────────
 *
 * Once a value has been rounded decimal-correctly to its display precision,
 * `Intl.NumberFormat` and `toFixed` produce the same glyph — there is nothing
 * left for them to disagree about. Verified exhaustively across every
 * thousandth under $200: 0 disagreements. Callers therefore cannot reintroduce
 * the divergence by choosing a different formatter downstream, which is a
 * stronger guarantee than everyone agreeing to call the same one.
 */

/** Display precisions in use. 4 dp is the Cost Stack ladder; see `ladderAmount`. */
export type MoneyPrecision = 2 | 4;

/** Null-ish and non-finite values render as an em dash on every surface. */
const NO_VALUE = "—";

/**
 * Round to `dp`, half away from zero, on the DECIMAL value.
 *
 * `Number.prototype.toPrecision(15)` is the correction. 15 significant digits
 * is the width at which a double round-trips unambiguously, so re-reading the
 * value there discards the representation noise while preserving every digit
 * an operator could have entered. It is applied TWICE — once to the value and
 * once to the scaled product — because the multiplication introduces its own
 * noise: `0.145 * 100` is `14.499999999999998224`, which rounds DOWN to 14 and
 * gives `$0.14` for a value whose exact half should give `$0.15`.
 *
 * `Math.round` alone is not enough either: it rounds half toward +Infinity, so
 * `-2.835` would give `-2.83`. Splitting the sign off makes it symmetric.
 */
export function roundMoney(value: number, dp: MoneyPrecision): number {
  if (!Number.isFinite(value)) return value;
  const corrected = Number(value.toPrecision(15));
  const scale = 10 ** dp;
  const scaled = Number((corrected * scale).toPrecision(15));
  return (Math.sign(scaled) * Math.round(Math.abs(scaled))) / scale;
}

/**
 * Format at an EXPLICIT precision. There is no default and no magnitude
 * branch — the caller states what it is showing, or uses a semantic formatter
 * below that states it for them.
 */
export function formatMoney(
  value: number | null | undefined,
  dp: MoneyPrecision,
): string {
  if (value == null || !Number.isFinite(value)) return NO_VALUE;
  const rounded = roundMoney(value, dp);
  const digits = Math.abs(rounded).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  // `rounded < 0` rather than `value < 0`: a value that rounds to zero must not
  // render as "-$0.00", which reads as a real negative amount.
  return (rounded < 0 ? "-$" : "$") + digits;
}

/** A per-unit price. 2 dp. */
export const unitPrice = (value: number | null | undefined): string =>
  formatMoney(value, 2);

/**
 * An extended amount — line total, service fee, turnkey total, grand total,
 * order value. 2 dp, at EVERY magnitude. The magnitude branch this replaces is
 * defect 2 above.
 */
export const extendedAmount = (value: number | null | undefined): string =>
  formatMoney(value, 2);

/**
 * The Cost Stack price ladder. 4 dp.
 *
 * Not a cosmetic preference: the ladder's rows are read as a running total, and
 * at 2 dp a $0.0035 surgical lift displays as `+$0.00` — the visible column
 * stops adding up while the reconciliation strip, reading the underlying
 * values, still says it does.
 */
export const ladderAmount = (value: number | null | undefined): string =>
  formatMoney(value, 4);
