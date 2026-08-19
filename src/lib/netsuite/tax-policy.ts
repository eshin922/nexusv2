/**
 * Governed tax policy — every Sales Order Nexus creates is NON-TAXABLE.
 *
 * This is a settled business rule, not a configurable preference: Nexus states
 * the commercial terms, and tax determination happens downstream of it. The
 * rule therefore lives in code, as a constant, rather than in an admin-mutable
 * setting that could silently make an order taxable again.
 *
 * ── WHY THIS EXISTS (measured, 2026-08-19) ───────────────────────────────
 *
 * SO2716 came back carrying $1,030.50 of tax. The cause was measured rather
 * than inferred, and it is the CUSTOMER: NetSuite customer 388800 carries
 * `taxable: true`, so NetSuite derived `CA_CA` at 6% per line. It is NOT the
 * item masters — tax schedules 2, 2 and 1 all produced the same `CA_CA` code,
 * so the code comes from the customer and nexus, not the item.
 *
 * Nexus sent no tax code at all. `buildSalesOrderPayload` emitted one only when
 * `firm_settings.netsuite_default_tax_code_id` was set, and it was NULL by a
 * 2026-07-28 disposition that deliberately delegated tax to NetSuite's engine.
 * That disposition is what this file overturns.
 *
 * ── WHICH LEVER (measured, not assumed) ──────────────────────────────────
 *
 * The full Sales Order header key set was enumerated. `taxDetails`,
 * `taxDetailsOverride` and `taxRegOverride` are ABSENT — so this account is on
 * LEGACY tax, not SuiteTax. `taxItem`, `isTaxable`, `taxRate` and `nexus` are
 * absent too: **there is no header-level tax control on the SO REST schema.**
 *
 * Per-line `taxCode` is the only lever the payload has. Hence enforcement is
 * per line, in two places — see `planTaxEnforcement` below for the second.
 *
 * ── WHY `-8` ─────────────────────────────────────────────────────────────
 *
 * `-8` "-Not Taxable-" is a real code in this account, evidenced rather than
 * guessed: NetSuite itself applied it to the Item Group header and EndGroup
 * lines of SO2716 while making every priced line `CA_CA`.
 *
 * ── WHAT THIS DOES NOT TOUCH ─────────────────────────────────────────────
 *
 * Tax sits OUTSIDE the frozen commercial statement, and SO2716 proves it:
 * subtotal $17,175.00 equalled the frozen commercial total exactly, with the
 * $1,030.50 of tax on top. So nothing here can move quantity, rate, amount, the
 * accepted total, or REG-4 — and the tests assert that rather than trusting it.
 */

/**
 * NetSuite's "-Not Taxable-" tax code.
 *
 * A string because every other NetSuite reference id in this codebase is a
 * string, and the REST API accepts `{ id: "-8" }`.
 */
export const NON_TAXABLE_TAX_CODE_ID = "-8";

/** A line as read back from the Sales Order, in the fields this decision needs. */
export type TaxEnforcementLine = {
  /** The address `patchSalesOrderLine` uses. NOT an array position. */
  line: number;
  taxCodeId: string | null;
};

export type TaxEnforcementPlan = {
  /** Addresses whose tax code must be corrected. */
  patch: number[];
  /** Already non-taxable — recorded so "nothing to do" is legible from "not run". */
  alreadyNonTaxable: number[];
  /**
   * Lines whose tax code could not be READ.
   *
   * Deliberately separate from `alreadyNonTaxable`: an unreadable code and a
   * correct one are different facts, and folding them together would report a
   * taxable line as compliant. These are patched — the governed rule is that
   * every line is non-taxable, so acting on an unknown is the safe direction.
   */
  indeterminate: number[];
};

/**
 * Which lines still need their tax code corrected after NetSuite has built the
 * order.
 *
 * ── THE CASE THIS EXISTS FOR ─────────────────────────────────────────────
 *
 * Item Group MEMBER lines are created by NetSuite's group EXPANSION, not by
 * Nexus. On SO2716 the group header and EndGroup were `-8` while the member
 * between them was `CA_CA` — the header around it was compliant and the line
 * carrying the money was not.
 *
 * Nexus never emits those member lines, so no change to the CREATE payload can
 * reach them. They exist only after expansion, and the only way to touch them
 * is a PATCH against the address NetSuite assigned. That is why enforcement is
 * per line AND post-create, rather than one or the other.
 *
 * Pure on purpose: the provider round-trip is the caller's, so the decision
 * itself is unit-testable without a sandbox.
 */
export function planTaxEnforcement({
  lines,
}: {
  lines: ReadonlyArray<TaxEnforcementLine>;
}): TaxEnforcementPlan {
  const patch: number[] = [];
  const alreadyNonTaxable: number[] = [];
  const indeterminate: number[] = [];

  for (const line of lines) {
    if (line.taxCodeId === null) {
      indeterminate.push(line.line);
      patch.push(line.line);
      continue;
    }
    if (line.taxCodeId === NON_TAXABLE_TAX_CODE_ID) {
      alreadyNonTaxable.push(line.line);
      continue;
    }
    patch.push(line.line);
  }

  return { patch, alreadyNonTaxable, indeterminate };
}

export type TaxEnforcementResult = {
  patched: number[];
  alreadyNonTaxable: number[];
  /** Addresses still not non-taxable on the verifying re-read. Empty = compliant. */
  residual: number[];
  failures: Array<{ line: number; message: string }>;
};

/**
 * Make every line on the order non-taxable, then PROVE it by re-reading.
 *
 * The re-read is the point. Patching and reporting success would assert
 * compliance from the fact that no call threw, which is the weaker claim — a
 * PATCH that NetSuite accepts and then overrides from the customer's tax
 * configuration would report clean while leaving the order taxable. The only
 * evidence that settles it is the order's own state afterwards, so `residual`
 * comes from a fresh read and not from what was sent.
 *
 * Provider calls are injected, so the whole contract is unit-testable.
 */
export async function enforceNonTaxableLines({
  readLines,
  patchLine,
}: {
  readLines: () => Promise<ReadonlyArray<TaxEnforcementLine>>;
  patchLine: (line: number, taxCodeId: string) => Promise<void>;
}): Promise<TaxEnforcementResult> {
  const plan = planTaxEnforcement({ lines: await readLines() });
  const failures: Array<{ line: number; message: string }> = [];
  const patched: number[] = [];

  for (const address of plan.patch) {
    try {
      await patchLine(address, NON_TAXABLE_TAX_CODE_ID);
      patched.push(address);
    } catch (e) {
      failures.push({
        line: address,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Verify against provider state, not against what was sent.
  const after = await readLines();
  const residual = after
    .filter((l) => l.taxCodeId !== NON_TAXABLE_TAX_CODE_ID)
    .map((l) => l.line);

  return {
    patched,
    alreadyNonTaxable: plan.alreadyNonTaxable,
    residual,
    failures,
  };
}
