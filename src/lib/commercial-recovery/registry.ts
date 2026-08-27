/**
 * The governed charge registry.
 *
 * THE FINITE SET. A charge exists here because it is governed, not because a
 * field is numeric. `RecoveryChargeKey` is not arbitrary line-level
 * configurability — it is a closed set of known commercial charges, each
 * carrying its own policy, and adding one is a migration rather than an edit.
 *
 * ── THIS FILE OWNS THE CLASSIFICATION ────────────────────────────────────
 *
 * The `tier_total_cogs | one_time_fee` discriminator previously lived in
 * `VIRTUAL_LINES` inside `production-drilldown.tsx` — a UI component's local
 * constant table. A customer-facing commercial election reading its policy out
 * of presentation code is the wrong direction, so the classification is
 * promoted here and the drilldown consumes it.
 *
 * Nothing about the classification changed in the move. Only its owner did.
 *
 * ── PER-UNIT COGS IS NOT A CHARGE ────────────────────────────────────────
 *
 * Filling/blending, CM assembly, bulk raw and all packaging are the unit
 * price. They are absent from this registry deliberately: that boundary is
 * what stops recovery spreading to every numeric field in the quote.
 *
 * ── `available` AND `refusals` ARE EXHAUSTIVE COMPLEMENTS ────────────────
 *
 * Every mode NOT in `available` MUST carry a refusal reason. A denied mode
 * without a governed reason is a defect, and `assertRegistryCoherent` fails on
 * it rather than letting it reach an operator as a silently missing option.
 *
 * The surface renders denied modes VISIBLY DENIED WITH THE REASON. A hidden
 * option reads as an option that does not exist; a visibly-refused one teaches
 * the policy.
 */

/** The three governed customer-facing modes. Exactly three. */
export const RECOVERY_MODES = ["included", "separate", "absorbed"] as const;
export type RecoveryMode = (typeof RECOVERY_MODES)[number];

export type RecoveryChargeKey =
  | "container_freight"
  | "duty_tariffs"
  | "tooling"
  | "project_setup"
  | "artwork_plate"
  | "rd_formulation"
  | "testing_micros"
  | "other_service"
  | "tooling_artwork_legacy"
  // OD-032 phase 2 — component-owned. See COMPONENT_CHARGE_KEYS below.
  | "print_plates"
  | "samples_proofs";

/**
 * `landed` charges are quote-level: one freight bill, one customs assessment.
 * `one_time` charges are authored per assembly, which is why their legacy
 * resolution reads a PER-ASSEMBLY value rather than a quote-level one.
 */
export type ChargeGrain = "landed" | "one_time";

export type ChargePolicy = {
  key: RecoveryChargeKey;
  /** Operator- and customer-facing. */
  label: string;
  grain: ChargeGrain;
  /**
   * The governed column(s) this charge's amount comes from. Recorded so a
   * reader can trace a charge to its source without grepping, and so a future
   * field split (see `tooling_artwork_legacy`) is visible here.
   */
  source: readonly string[];
  /** Modes an operator may elect. EMPTY means non-elective. */
  available: readonly RecoveryMode[];
  /** Why each unavailable mode is unavailable. Complement of `available`. */
  refusals: Readonly<Partial<Record<RecoveryMode, string>>>;
};

/**
 * -- ONE-TIME FEES ARE A CLASS, NOT SEVEN SEPARATE DECISIONS -------------
 *
 * Business disposition, Edward 2026-08-24:
 *
 *   "All charges governed/classified as One-time fees permit all three
 *    recovery treatments. This is the governing recovery policy for the
 *    class, not a charge-by-charge exception."
 *
 * So `available` is DERIVED from `grain` for every one-time fee rather than
 * written out per charge. A new one-time fee inherits all three
 * automatically, and there is no per-charge field for a future author to
 * narrow -- which is what makes this a class rule rather than seven copies
 * of one decision.
 *
 * -- WHAT THIS SUPERSEDES -----------------------------------------------
 *
 * R&D, Other service and Testing / Micros were non-elective pending a BV-011
 * disposition; Tooling & artwork (legacy) was refused
 * because the combined field spans two governed destinations with different
 * item types.
 *
 * Both refusals read BV-011's SILENCE as a prohibition. BV-011 answers what
 * item type a charge is, and says of itself that it "authorizes no
 * implementation" -- it never refused a recovery treatment. Treating its
 * scope boundary as one turned the absence of a disposition into a policy.
 * This disposition supplies the policy that was actually missing.
 *
 * The legacy field's downstream Accounting / NetSuite classification problem
 * is real and unchanged. It is a question about which OTC line an amount
 * lands on, not about how the customer is charged for it, and the two were
 * conflated.
 *
 * Artwork & plate previously refused `separate` as "Not separately
 * invoiceable" -- a Design Authority (tier 3) policy this tier-1 disposition
 * outranks. Testing / Micros has no assembly-authorable input surface, so it
 * is absent from live quotes and its row does not render; the class rule
 * applies to it uniformly rather than carving it out.
 *
 * -- ABSORBED IS GRANTED HERE AND STILL REFUSED DOWNSTREAM --------------
 *
 * The disposition gates it: "Do not enable Absorbed merely at the UI if that
 * invariant is not already satisfied end-to-end." It is not.
 * `ConstructedCommercial.absorbedCost` is read by nothing, so absorbing would
 * drop the charge's COST along with its revenue and the quote would stop
 * reflecting money DPS still pays.
 *
 * `ABSORB_COST_UNCONSUMED` in `resolve.ts` therefore continues to refuse it --
 * for the whole class, on the invariant, not per charge. Policy permits it;
 * the system does not yet do it, and the refusal says which.
 */
/** A registry entry as authored. One-time fees omit their modes; see above. */
type ChargePolicySpec = Omit<ChargePolicy, "available" | "refusals"> &
  Partial<Pick<ChargePolicy, "available" | "refusals">>;

const CHARGE_SPECS: readonly ChargePolicySpec[] = [
  {
    key: "container_freight",
    label: "Container freight",
    grain: "landed",
    source: ["freight_leg_tiers.total_freight"],
    available: ["included", "separate"],
    refusals: { absorbed: "Policy: freight must be recovered" },
  },
  {
    key: "duty_tariffs",
    label: "Duty & tariffs",
    grain: "landed",
    source: ["freight_legs.customs"],
    available: ["included", "separate"],
    refusals: { absorbed: "Statutory pass-through — cannot be absorbed" },
  },
  {
    key: "tooling",
    label: "Tooling",
    grain: "one_time",
    source: ["assembly_production_inputs.tooling_total"],
  },
  {
    key: "project_setup",
    label: "Project setup",
    grain: "one_time",
    source: ["assembly_production_inputs.setup_fee_total"],
  },
  {
    key: "artwork_plate",
    label: "Artwork & plate",
    grain: "one_time",
    source: ["assembly_production_inputs.artwork_total"],
  },

  {
    key: "rd_formulation",
    label: "R&D",
    grain: "one_time",
    source: ["assembly_production_inputs.rd_total"],
  },
  {
    key: "testing_micros",
    label: "Testing / Micros",
    grain: "one_time",
    source: ["assembly_production_inputs.testing_micros_total"],
  },
  {
    key: "other_service",
    label: "Other service",
    grain: "one_time",
    source: ["assembly_production_inputs.other_service_total"],
  },
  {
    key: "tooling_artwork_legacy",
    label: "Tooling & artwork (legacy)",
    grain: "one_time",
    source: ["assembly_production_inputs.tooling_artwork_total"],
  },

  // ── OD-032 phase 2 · component-owned types ────────────────────────────
  //
  // These source from `quote_charge_instance_tiers` rather than from a
  // production column, which is the whole point: a column can only ever hold
  // one charge per quote, and the design needs two cartons to each cause
  // print plates.
  //
  // They inherit the one-time class rule below — all three modes — because
  // the disposition narrowed nothing for V1. The round trip proposed
  // narrowing Print plates to unit/fee and Artwork to unit/absorbed; that is
  // a change to a banked class rule and was deferred to phase 5, where
  // Recovery is actually touched and the question can be answered with the
  // surface in front of you.
  {
    key: "print_plates",
    label: "Print plates",
    grain: "one_time",
    source: ["quote_charge_instance_tiers.cost_amount"],
  },
  {
    key: "samples_proofs",
    label: "Samples & proofs",
    grain: "one_time",
    source: ["quote_charge_instance_tiers.cost_amount"],
  },
];

/**
 * The V1 component-owned vocabulary — what the later sheet may offer against a
 * packaging component.
 *
 * `tooling` and `artwork_plate` appear here AND remain quote-owned production
 * columns. That is not a contradiction: the type is the same commercial fact
 * either way, and the owner is what differs. A tooling charge caused by a
 * carton is component-owned; one the Item Group authored stays where it is.
 *
 * `artwork_plate` is deliberately NOT renamed. It appears in frozen
 * instructions, which are the record of what Accounting was told. Once
 * `print_plates` exists as its own type, `artwork_plate` on a NEW
 * component-owned charge means only the adaptation-labour half, because the
 * plate-making half has somewhere else to go. Existing rows keep the span they
 * were written with.
 *
 * `project_setup` is ABSENT, and its absence is the rule: engagement-level
 * setup is a different commercial fact and stays quote-owned. `run_setup` is
 * absent too — deferred until Accounting supplies a governed destination, and
 * reachable through `other_service` in the meantime.
 */
export const COMPONENT_CHARGE_KEYS = [
  "print_plates",
  "tooling",
  "artwork_plate",
  "samples_proofs",
  "other_service",
] as const satisfies readonly RecoveryChargeKey[];

export type ComponentChargeKey = (typeof COMPONENT_CHARGE_KEYS)[number];

/** Labels as the component vocabulary names them, per the round trip's §02. */
export const COMPONENT_CHARGE_LABELS: Record<ComponentChargeKey, string> = {
  print_plates: "Print plates",
  tooling: "Tooling & dies",
  artwork_plate: "Artwork & prepress",
  samples_proofs: "Samples & proofs",
  other_service: "Other",
};

/** A type an operator may hang off a packaging component. */
export function isComponentChargeKey(key: string): key is ComponentChargeKey {
  return (COMPONENT_CHARGE_KEYS as readonly string[]).includes(key);
}

/** `other` requires an operator label; every other type may omit one. */
export function labelRequiredFor(key: string): boolean {
  return key === "other_service";
}

export const RECOVERY_CHARGES: readonly ChargePolicy[] = CHARGE_SPECS.map(
  (spec): ChargePolicy =>
    spec.grain === "one_time"
      ? // The class rule. Not `spec.available ?? [...]` -- a fallback would
        // let a future author narrow one charge while the shape still looked
        // right, which is the thing a class rule exists to prevent.
        { ...spec, available: [...RECOVERY_MODES], refusals: {} }
      : { ...spec, available: spec.available ?? [], refusals: spec.refusals ?? {} },
);

/**
 * The governed one-time-charge COLUMN, by charge.
 *
 * ── WHY THIS LIVES HERE AND NOT AT EITHER CONSUMER ──────────────────────
 *
 * Two layers need to turn a fee column into a charge identity: the cost engine,
 * to emit that charge's economics, and the projection, to decide which customer
 * line an amount belongs to. A copy in each is two answers to one question, and
 * they would agree right up until a column was added to one of them.
 *
 * It is COMPLETE — all seven columns, including `testingMicrosTotal`, which the
 * projection does not currently emit a line for (only a Direct Service leaf
 * writes it, and it is not assembly-authorable). That asymmetry is a fact about
 * what the projection RENDERS, not about what the charge IS, so the identity
 * map carries it and the projection's own list stays the narrower thing it
 * already was.
 */
export const OTC_COLUMN_TO_CHARGE: Readonly<Record<string, RecoveryChargeKey>> = {
  setupFeeTotal: "project_setup",
  toolingArtworkTotal: "tooling_artwork_legacy",
  toolingTotal: "tooling",
  artworkTotal: "artwork_plate",
  rdTotal: "rd_formulation",
  testingMicrosTotal: "testing_micros",
  otherServiceTotal: "other_service",
};

const BY_KEY = new Map(RECOVERY_CHARGES.map((c) => [c.key, c]));

export function chargePolicy(key: RecoveryChargeKey): ChargePolicy {
  const c = BY_KEY.get(key);
  if (!c) throw new Error(`Unknown recovery charge: ${key}`);
  return c;
}

/** Whether an operator may elect this mode on this charge. */
export function isModeAvailable(
  key: RecoveryChargeKey,
  mode: RecoveryMode,
): boolean {
  return chargePolicy(key).available.includes(mode);
}

/**
 * The governed reason a mode is denied, or `null` if it is available.
 *
 * Returning the reason rather than a boolean is what lets the surface render
 * the denial WITH its explanation instead of hiding the option.
 */
export function refusalReason(
  key: RecoveryChargeKey,
  mode: RecoveryMode,
): string | null {
  const c = chargePolicy(key);
  if (c.available.includes(mode)) return null;
  return c.refusals[mode] ?? null;
}

/**
 * Registry coherence, asserted rather than assumed.
 *
 * `available` and `refusals` must be exhaustive complements: every mode is
 * either electable or refused with a stated reason, and never both. A denied
 * mode with no reason is the specific defect this catches — it would reach an
 * operator as an option that is simply missing, with nothing saying why.
 */
export function assertRegistryCoherent(): void {
  for (const c of RECOVERY_CHARGES) {
    for (const mode of RECOVERY_MODES) {
      const availableHere = c.available.includes(mode);
      const reason = c.refusals[mode];
      if (availableHere && reason !== undefined) {
        throw new Error(
          `${c.key}: '${mode}' is available AND carries a refusal reason`,
        );
      }
      if (!availableHere && (reason === undefined || reason.trim() === "")) {
        throw new Error(
          `${c.key}: '${mode}' is denied with no governed reason`,
        );
      }
    }
  }
}
