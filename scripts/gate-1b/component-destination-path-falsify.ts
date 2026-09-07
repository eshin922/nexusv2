/**
 * DOES A PERSISTED CLASSIFICATION REACH THE DESTINATION? — the real path.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * The destination model shipped with 17 unit tests and every one of them handed
 * `componentChargeDestination` a classification directly. So all 17 passed
 * while the value could not travel: `readExistingComponentCharges` never
 * selected the column, the bundle field was optional, and
 * `meta.toolingClassification ?? null` turned an absent field into a stated
 * null. Every Tooling charge resolved `needs_classification` regardless of what
 * an operator recorded, and nothing said so.
 *
 * That is the recurring shape in this project: a measurement taken with an
 * instrument that cannot express the failure being excluded. A test that hands
 * the resolver a value never crosses the boundary where the value was lost.
 *
 * So this one starts where the fact actually lives — a row in
 * `quote_charge_instances` — and runs the SAME loader production runs.
 *
 * ── HOW IT PROVES ALL THREE STATES WITHOUT PERSISTING ANY ───────────────
 *
 * `mould_collar` and `cutting_die` are accounting facts. Writing one to a real
 * quote to make a test pass would be inventing an accounting fact nobody
 * authored — the thing this whole workstream refuses to do.
 *
 * So each state is written INSIDE a transaction, read back through the real
 * loader on that same transaction, resolved through the real authority, and the
 * transaction is ROLLED BACK. Nothing persists. This is the technique
 * CLAUDE.md already names: "A structural claim is proven by a transaction that
 * performs it -- rolled back if the state must not persist."
 *
 * The rollback is not assumed. The script re-reads the classification through
 * the global client afterwards and fails if it differs from what it found
 * before -- because a harness that could leave an accounting fact behind is
 * worse than no harness.
 *
 * READ-ONLY IN EFFECT, and it verifies its own read-only-ness.
 *
 * Usage:  component-destination-path-falsify.ts <quoteNumber>
 */
import { db } from "@/db";
import { sql, eq } from "drizzle-orm";

import { quoteChargeInstances } from "@/db/schema";
import { readExistingComponentCharges } from "@/lib/component-charges/read";
import { componentChargeDestination } from "@/lib/netsuite/component-charge-destination";

const quoteNumber = process.argv[2] ?? "DPS-1074";

const [quote] = (await db.execute(sql`
  SELECT id FROM quotes WHERE quote_number = ${quoteNumber}
`)) as unknown as Array<{ id: string }>;

if (!quote) {
  console.log(`UNRESOLVED · no quote numbered ${quoteNumber}`);
  process.exit(2);
}

/** The tooling instance to exercise. Named, so a reader can check it. */
const toolingInstances = (await readExistingComponentCharges(quote.id)).filter(
  (c) => c.chargeKey === "tooling",
);

if (toolingInstances.length !== 1) {
  // Absence is a claim and gets its own outcome. A quote with no tooling charge
  // cannot falsify anything, and reporting that as a pass would be the same
  // error this script exists to catch.
  console.log(
    `INDETERMINATE · expected exactly one tooling instance on ${quoteNumber}, found ${toolingInstances.length}`,
  );
  process.exit(2);
}

const target = toolingInstances[0];
const before = target.toolingClassification;

console.log(`QUOTE ${quoteNumber}`);
console.log(`TOOLING INSTANCE ${target.chargeInstanceId}`);
console.log(`PERSISTED NOW  ${before ?? "NULL"}`);
console.log("");

type Case = {
  persisted: "mould_collar" | "cutting_die" | null;
  expect: string;
};

const CASES: Case[] = [
  // The state O3 is in before the operator acts, and the one that was
  // indistinguishable from "the loader forgot to ask".
  { persisted: null, expect: "unresolved" },
  { persisted: "mould_collar", expect: "otc_mould" },
  // Falsified even though no order exercises it end to end. An arm no test and
  // no order reaches is an arm nobody has checked.
  { persisted: "cutting_die", expect: "otc_dies" },
];

const results: Array<{ persisted: string; got: string; expect: string; ok: boolean }> = [];

await db
  .transaction(async (tx) => {
    for (const c of CASES) {
      await tx
        .update(quoteChargeInstances)
        .set({ toolingClassification: c.persisted })
        .where(eq(quoteChargeInstances.id, target.chargeInstanceId));

      // THE REAL LOADER, on the transaction that holds the written state.
      const meta = await readExistingComponentCharges(quote.id, tx);
      const row = meta.find((m) => m.chargeInstanceId === target.chargeInstanceId);
      if (!row) throw new Error("the loader lost the instance");

      // THE REAL AUTHORITY, fed the loader's own output — not a value this
      // script chose. The seam between them is exactly where the defect was.
      const r = componentChargeDestination({
        chargeKey: row.chargeKey,
        toolingClassification: row.toolingClassification,
      });
      const got = r.kind === "resolved" ? r.destination : "unresolved";

      results.push({
        persisted: c.persisted ?? "NULL",
        got,
        expect: c.expect,
        ok: got === c.expect && row.toolingClassification === c.persisted,
      });
    }

    // Never commits. The states above are accounting facts nobody authored.
    throw new Error("__rollback__");
  })
  .catch((e: unknown) => {
    if (!(e instanceof Error) || e.message !== "__rollback__") throw e;
  });

for (const r of results) {
  console.log(
    `  persisted ${r.persisted.padEnd(13)} -> ${r.got.padEnd(12)} expected ${r.expect.padEnd(12)} ${r.ok ? "OK" : "FAIL"}`,
  );
}

// The rollback, verified rather than trusted.
const after = (await readExistingComponentCharges(quote.id)).find(
  (m) => m.chargeInstanceId === target.chargeInstanceId,
)?.toolingClassification;

const restored = (after ?? null) === (before ?? null);
console.log("");
console.log(`ROLLBACK · persisted classification is ${after ?? "NULL"} · ${restored ? "UNCHANGED" : "CHANGED"}`);

const pass = results.length === CASES.length && results.every((r) => r.ok) && restored;
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
