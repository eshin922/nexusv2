/**
 * Commercial recovery — the edit-time supersession WARNING.
 *
 * ── THIS IS NOT A SECOND INVALIDATION MECHANISM ──────────────────────────
 *
 * BV-005's invalidation already exists and already works: an authorization is
 * bound to one quote version, one tier, and one FINGERPRINT of the commercial
 * state, and the send gate refuses once that fingerprint moves. An
 * economics-changing recovery election moves it like any other lever.
 *
 * So nothing here writes. There is no `invalidatedAt` stamp, no second
 * "supersede" column, no parallel rule. This is a READ that tells the operator
 * BEFORE they commit what the existing mechanism will do AFTER they do —
 * because discovering it at the send gate is discovering it too late to
 * decide differently.
 *
 * ── AND IT IS NOT A SECOND DEFINITION OF "MATERIAL" ──────────────────────
 *
 * The obvious cheap version of this warning is a rule about MODES: "warn when
 * absorbed is involved, because absorbed is the mode that moves money." It
 * would be right nearly always, and being right nearly always is exactly the
 * failure — it is a second definition of material change, sitting next to the
 * real one, free to drift from it. `fingerprintCommercialState` says what
 * material means, once. This compares fingerprints and nothing else.
 *
 * The caller therefore supplies the fingerprints the quote WOULD carry under
 * the proposed election, computed through the same projection the gate reads.
 * That is more work than inspecting a mode, and it is the only version that
 * cannot disagree with the gate.
 *
 * ── WHEN PREDICTION AND MECHANISM DISAGREE, THE MECHANISM WINS ───────────
 *
 * If a projection ever changed such that this warning fired when the gate did
 * not (or vice versa), the gate is still authoritative and this was merely
 * over- or under-cautious. It must never become the thing that decides.
 */

/** Exactly the authorization fields a supersession prediction depends on. */
export type AuthorizationForWarning = {
  tierId: string;
  quoteVersionNumber: number;
  stateFingerprint: string;
  invalidatedAt: Date | string | null;
};

export type SupersededTier = {
  tierId: string;
  authorizedFingerprint: string;
  projectedFingerprint: string;
};

export type SupersessionWarning = {
  /** True when at least one live authorization would stop applying. */
  willSupersede: boolean;
  superseded: SupersededTier[];
};

/**
 * Which live authorizations a proposed election would supersede.
 *
 * `projectedFingerprintByTier` must be computed from the SAME projection the
 * send gate reads, under the proposed election. A tier absent from the map is
 * treated as UNKNOWN and is not reported — silence is better than a warning
 * asserted from data that was never computed.
 */
export function evaluateRecoverySupersession(input: {
  authorizations: readonly AuthorizationForWarning[];
  quoteVersionNumber: number;
  projectedFingerprintByTier: ReadonlyMap<string, string>;
}): SupersessionWarning {
  const superseded: SupersededTier[] = [];

  for (const a of input.authorizations) {
    // Out of scope for this version: nothing to supersede.
    if (a.quoteVersionNumber !== input.quoteVersionNumber) continue;
    // Already withdrawn: warning about it would be telling the operator that
    // something already gone is about to go.
    if (a.invalidatedAt !== null) continue;

    const projected = input.projectedFingerprintByTier.get(a.tierId);
    if (projected === undefined) continue;
    if (projected === a.stateFingerprint) continue;

    superseded.push({
      tierId: a.tierId,
      authorizedFingerprint: a.stateFingerprint,
      projectedFingerprint: projected,
    });
  }

  return { willSupersede: superseded.length > 0, superseded };
}

/**
 * Operator copy for the warning.
 *
 * It names the consequence and who has to act, because "this will invalidate
 * the approval" leaves an operator to work out for themselves that the quote
 * cannot be sent until someone authorizes it again.
 */
export function supersessionMessage(warning: SupersessionWarning): string | null {
  if (!warning.willSupersede) return null;
  const n = warning.superseded.length;
  const tiers = n === 1 ? "one tier's" : `${n} tiers'`;
  return (
    `This changes the quote's economics, so ${tiers} existing below-floor ` +
    `authorization will no longer apply. A commercial approver must authorize ` +
    `again before the quote can be sent.`
  );
}
