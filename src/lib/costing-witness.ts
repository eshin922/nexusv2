/**
 * Read-freshness witnesses — the ordering evidence reconciliation runs on.
 *
 * A WITNESS is `pg_current_snapshot()` as text, `xmin:xmax:xip_list`, taken by
 * the SAME statement that returned the rows it describes. A WRITE ID is
 * `pg_current_xact_id_if_assigned()` as text, returned by the write statement's
 * own `RETURNING`. Both are `xid8` — 64-bit — so both are carried as strings
 * and compared as `BigInt`. `Number()` appears nowhere in this file: it loses
 * exactness above 2^53, and it turns an absent value into `NaN`, which compares
 * false against everything and therefore passes gates rather than failing them.
 *
 * ── WHY A SNAPSHOT AND NOT A NUMBER ──────────────────────────────────────
 *
 * `pg_snapshot_xmax` — the existing `HydrateSnapshot.revision` — advances when
 * a transaction is ASSIGNED AN XID, which is when a writer starts, not when one
 * commits. So two reads taken either side of a commit can report the SAME
 * xmax. Measured on PostgreSQL 16.14 (proof P1):
 *
 *     S1 (before the commit) = 14346:14348:14346
 *     S2 (after  the commit) = 14348:14348:
 *
 * Both report revision 14348. A `<=` comparison cannot tell them apart in
 * either direction: it rejects the fresh read as readily as the stale one. The
 * in-progress list can, exactly.
 *
 * ── THE PRECONDITION, WHICH IS LOAD-BEARING (P1 · F2) ────────────────────
 *
 * A snapshot records which transactions had FINISHED when it was taken. It does
 * NOT record whether they committed. `pg_visible_in_snapshot` returns TRUE for
 * a transaction that rolled back and left nothing behind, and `included` below
 * agrees with it — the two are consistent, and both are silent on the question.
 *
 * So `included` is only meaningful for a write already KNOWN COMMITTED, and the
 * only thing that knows is the client's acknowledgement of its own write.
 * Arming a requirement on an unknown outcome — a timeout, a dropped connection,
 * an optimistic arm at dispatch — would retire it the moment the transaction
 * ENDED, whichever way it ended. See `armWrite` in `costing-store.ts`.
 *
 * Nothing here talks to a database, subscribes to anything, or holds state.
 */

/** A parsed `pg_current_snapshot()`. */
export type Witness = {
  /** The text it was parsed from, for storage and round-tripping. */
  readonly text: string;
  /** Lowest xid still running. Everything below is complete. */
  readonly xmin: bigint;
  /** One past the highest COMPLETED xid. Everything at or above is invisible. */
  readonly xmax: bigint;
  /** Xids running at snapshot time — only those within `[xmin, xmax)`. */
  readonly xip: ReadonlySet<bigint>;
};

/** How one witness's visibility relates to another's. */
export type WitnessOrder =
  | "dominates"
  | "dominated"
  | "identical"
  | "incomparable";

const DIGITS = /^[0-9]+$/;

/**
 * Parse an `xid8` in text form.
 *
 * Strict by intent: anything that is not a bare run of digits is rejected
 * rather than coerced. A malformed id that parsed to something plausible would
 * be compared against real snapshots and answer confidently.
 */
export function parseWriteId(value: unknown): bigint | null {
  if (typeof value !== "string" || !DIGITS.test(value)) return null;
  return BigInt(value);
}

/**
 * Parse `xmin:xmax:xip_list`, or return null.
 *
 * NULL IS THE FAIL-CLOSED ANSWER. Every consumer treats an unparseable witness
 * as proving nothing: it does not dominate, and it does not establish
 * inclusion. A parser that guessed would convert a transport or version problem
 * into a confident wrong ordering decision, which is the failure this whole
 * mechanism exists to prevent.
 */
export function parseWitness(value: unknown): Witness | null {
  if (typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const [minText, maxText, xipText] = parts;
  if (!DIGITS.test(minText) || !DIGITS.test(maxText)) return null;
  const xmin = BigInt(minText);
  const xmax = BigInt(maxText);
  if (xmin > xmax) return null;

  const xip = new Set<bigint>();
  if (xipText.length > 0) {
    for (const entry of xipText.split(",")) {
      if (!DIGITS.test(entry)) return null;
      const xid = BigInt(entry);
      // PostgreSQL documents the list as containing only active xids BETWEEN
      // xmin and xmax. An entry outside that range is not a snapshot this code
      // understands, and the reasoning in `compareWitness` assumes the bound.
      if (xid < xmin || xid >= xmax) return null;
      xip.add(xid);
    }
  }
  return { text: value, xmin, xmax, xip };
}

/**
 * Does this read include that write?
 *
 * **PRECONDITION: `writeId` is a write the caller knows COMMITTED.** For an
 * aborted transaction this returns true once the transaction has ended, exactly
 * as `pg_visible_in_snapshot` does — neither can see commit status. See the
 * file header.
 *
 * Two ways a not-yet-included write is excluded, and a caller or test that
 * knows only the first is incomplete (P1 · F1):
 *
 *   IN RANGE      the xid sits in `[xmin, xmax)` and appears in `xip`.
 *                 Measured: `14346:14348:14346`, held xid 14346.
 *
 *   ABOVE THE BOUND  the xid is at or above `xmax`. It is running, but `xip`
 *                 lists only xids below `xmax`, so the list is EMPTY and the
 *                 `< xmax` clause is the sole exclusion.
 *                 Measured: `14345:14345:` with 14345 held open.
 *
 * The `xid < xmin` clause is therefore a fast path, not the rule; the rule is
 * `below the bound and not running`.
 */
export function included(writeId: bigint, witness: Witness): boolean {
  if (writeId < witness.xmin) return true;
  return writeId < witness.xmax && !witness.xip.has(writeId);
}

/**
 * Compare what two reads could see.
 *
 * `xmax` is non-decreasing in real time, so a strictly greater `xmax` means a
 * strictly later snapshot, and a later snapshot sees a superset of completed
 * transactions. Where `xmax` is EQUAL the bound tells us nothing — both treat
 * everything at or above it as invisible — so the difference is confined to
 * `[xmin, xmax)` and is decided entirely by the in-progress lists.
 *
 * `incomparable` is a real answer, not an error: with equal `xmax` and crossing
 * lists, neither read is provably fresher, and the caller must decline both and
 * re-read rather than guess.
 *
 * One conservative imprecision, stated rather than hidden: if the only xid
 * distinguishing two lists ABORTED, the two reads are visibility-equivalent but
 * compare as `incomparable`. The cost is a redundant re-read, never a wrong
 * decision, and resolving it would mean asking the database about each
 * differing xid — a round trip to save a round trip.
 */
export function compareWitness(b: Witness, a: Witness): WitnessOrder {
  if (b.xmax > a.xmax) return "dominates";
  if (b.xmax < a.xmax) return "dominated";
  const bInA = isSubset(b.xip, a.xip);
  const aInB = isSubset(a.xip, b.xip);
  if (bInA && aInB) return "identical";
  if (bInA) return "dominates";
  if (aInB) return "dominated";
  return "incomparable";
}

/** True only when `b` provably saw everything `a` saw, and strictly more. */
export function dominates(b: Witness, a: Witness): boolean {
  return compareWitness(b, a) === "dominates";
}

function isSubset(a: ReadonlySet<bigint>, b: ReadonlySet<bigint>): boolean {
  if (a.size > b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
