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
  | "tooling_artwork_legacy";

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

function BV011_PENDING(destination: string): string {
  return (
    `Recovery policy not yet dispositioned. BV-011 classifies this charge ` +
    `(${destination}) but does not authorize customer-facing recovery ` +
    `treatment (BV-011 §3).`
  );
}

const BV011_NO_SURFACE =
  "Recovery policy not yet dispositioned (BV-011 §3). No input surface " +
  "exists for this field today (BV-011 §4.1).";

const BV011_SPLIT_REQUIRED =
  "Legacy combined field spans two governed destinations with different item " +
  "types — OTC - Tooling (Inventory) and OTC - Artwork (Non-inventory), " +
  "BV-011 §4.2. A single election cannot be applied coherently until the " +
  "field is split.";

/**
 * Refusal strings for the five Design-Authority charges are VERBATIM from the
 * authority rather than paraphrased. The four BV-011 charges carry reasons
 * that cite the governing clause, because "not yet decided" is only a useful
 * refusal if it says who has not decided it.
 */
export const RECOVERY_CHARGES: readonly ChargePolicy[] = [
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
    available: ["included", "separate", "absorbed"],
    refusals: {},
  },
  {
    key: "project_setup",
    label: "Project setup",
    grain: "one_time",
    source: ["assembly_production_inputs.setup_fee_total"],
    available: ["included", "separate", "absorbed"],
    refusals: {},
  },
  {
    key: "artwork_plate",
    label: "Artwork & plate",
    grain: "one_time",
    source: ["assembly_production_inputs.artwork_total"],
    available: ["included", "absorbed"],
    refusals: { separate: "Not separately invoiceable" },
  },

  // ── BV-011 charges — classified, but recovery policy NOT dispositioned ──
  //
  // BV-011 answers WHAT ITEM TYPE. It does not answer HOW A CHARGE IS
  // RECOVERED FROM THE CUSTOMER, and it says so itself: it "authorizes no
  // implementation", and its §3 scope boundary excludes "any change to
  // customer-facing presentation (Quote surface, customer PDF)" by name —
  // which is precisely what a recovery election is.
  //
  // So these are NON-ELECTIVE with governed refusals, rather than absent from
  // the registry or assigned a guessed mode set. They stay visible, and they
  // keep today's behaviour exactly: resolution falls through to the
  // per-assembly `allocate_service_fees_to_cost` value.
  {
    key: "rd_formulation",
    label: "R&D / Formulation",
    grain: "one_time",
    source: ["assembly_production_inputs.rd_total"],
    available: [],
    refusals: {
      included: BV011_PENDING("OTC - Formulation"),
      separate: BV011_PENDING("OTC - Formulation"),
      absorbed: BV011_PENDING("OTC - Formulation"),
    },
  },
  {
    key: "testing_micros",
    label: "Testing / Micros",
    grain: "one_time",
    source: ["assembly_production_inputs.testing_micros_total"],
    available: [],
    refusals: {
      included: BV011_NO_SURFACE,
      separate: BV011_NO_SURFACE,
      absorbed: BV011_NO_SURFACE,
    },
  },
  {
    key: "other_service",
    label: "Other service",
    grain: "one_time",
    source: ["assembly_production_inputs.other_service_total"],
    available: [],
    refusals: {
      included: BV011_PENDING("OTC - Other Service"),
      separate: BV011_PENDING("OTC - Other Service"),
      absorbed: BV011_PENDING("OTC - Other Service"),
    },
  },
  {
    // The strongest refusal in the registry, and the only one that is not
    // merely "undecided". This single persisted field spans TWO governed
    // destinations with DIFFERENT item types, so one election cannot be
    // applied to it coherently at all. The reason names the migration that
    // would change that, rather than deferring to an unnamed future.
    key: "tooling_artwork_legacy",
    label: "Tooling / artwork (legacy)",
    grain: "one_time",
    source: ["assembly_production_inputs.tooling_artwork_total"],
    available: [],
    refusals: {
      included: BV011_SPLIT_REQUIRED,
      separate: BV011_SPLIT_REQUIRED,
      absorbed: BV011_SPLIT_REQUIRED,
    },
  },
] as const;

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
