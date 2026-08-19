/**
 * Does the SEND gate refuse a quote that has no Item Group? READ ONLY.
 *
 * `sendQuote`'s second sanity gate counts rows in `assemblies` — the Item Group
 * table — and refuses with "Quote needs at least one SKU before it can be
 * sent." The message says SKU; the query says Item Group.
 *
 * If that reading is right, TWO shapes cannot be sent:
 *   · a quote of only Direct Services  (the CERT-303 fixture)
 *   · a quote of only Direct Products  (Accounting UAT matrix case 1)
 *
 * That is a strong claim, so it is falsified rather than asserted: if ANY quote
 * has ever reached `sent` with zero assemblies, the reading is wrong.
 */
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { assemblies, quoteLeaves, quotes } from "@/db/schema";

// ── the falsifier ────────────────────────────────────────────────────────
const sentQuotes = await db
  .select({ id: quotes.id, label: quotes.scenarioLabel, status: quotes.status })
  .from(quotes)
  .where(inArray(quotes.status, ["sent", "accepted", "complete"]));

const asmCounts = await db
  .select({ quoteId: assemblies.quoteId, n: sql<number>`count(*)::int` })
  .from(assemblies)
  .groupBy(assemblies.quoteId);
const asmByQuote = new Map(asmCounts.map((r) => [r.quoteId, r.n] as const));

// The FIRST version of this falsifier asked only for "sent with zero
// assemblies" and found four — which looked like a refutation. All four also
// had ZERO quote_leaves: April-2026 rows from the pre-ASY/LEAF era, when
// structure lived in the `quote_skus` tables Slice 11.5.1 dropped, and three
// carry no `sent_at` at all. They were sent under different code against a
// different model, so they say nothing about this gate.
//
// The predicate that actually tests the reading is a CURRENT-model quote:
// structure present (leaves > 0) but no Item Group (assemblies = 0). If one of
// those has ever been sent, the reading is wrong.
const leafCounts = await db
  .select({ quoteId: quoteLeaves.quoteId, n: sql<number>`count(*)::int` })
  .from(quoteLeaves)
  .groupBy(quoteLeaves.quoteId);
const leavesByQuote = new Map(leafCounts.map((r) => [r.quoteId, r.n] as const));

const legacyEmpty = sentQuotes.filter(
  (q) => (asmByQuote.get(q.id) ?? 0) === 0 && (leavesByQuote.get(q.id) ?? 0) === 0,
);
const sentWithoutAssembly = sentQuotes.filter(
  (q) => (asmByQuote.get(q.id) ?? 0) === 0 && (leavesByQuote.get(q.id) ?? 0) > 0,
);
console.log(
  `legacy pre-ASY/LEAF rows excluded (0 leaves AND 0 assemblies): ${legacyEmpty.length}`,
);

console.log("── FALSIFIER · quotes that reached sent+ with ZERO Item Groups ──");
console.log(`sent/accepted/complete quotes examined: ${sentQuotes.length}`);
if (sentWithoutAssembly.length === 0) {
  console.log(
    "none — no quote has EVER been sent without an Item Group.\n" +
      "The reading stands: the gate refuses any quote with no assembly.",
  );
} else {
  console.log(
    `${sentWithoutAssembly.length} FOUND — the reading is WRONG, these were sent:`,
  );
  console.table(
    sentWithoutAssembly.map((q) => ({ label: q.label, status: q.status, id: q.id.slice(0, 8) })),
  );
}

// ── what CERT-303 actually holds ─────────────────────────────────────────
const CERT303 = "430b5ce4-975b-4262-8247-aee668f287a8";
const [asm] = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(assemblies)
  .where(eq(assemblies.quoteId, CERT303));
const [lf] = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(quoteLeaves)
  .where(eq(quoteLeaves.quoteId, CERT303));

console.log("\n── CERT-303 (the pure Direct Service fixture) ───────");
console.log(`  assemblies (what the gate counts): ${asm?.n ?? 0}`);
console.log(`  quote_leaves (what "SKU" suggests): ${lf?.n ?? 0}`);
console.log(
  (asm?.n ?? 0) === 0
    ? "  -> SEND WILL REFUSE: \"Quote needs at least one SKU before it can be sent.\""
    : "  -> SEND will pass the SKU gate",
);

// ── the same gate against a Direct-Product-only quote ────────────────────
console.log("\n── who else this refuses ────────────────────────────");
console.log(
  "A quote of only DIRECT PRODUCTS also has zero assemblies, so it is refused\n" +
    "by the identical condition — that is Accounting UAT matrix case 1, and it\n" +
    "is not a service-specific problem.",
);

process.exit(0);
