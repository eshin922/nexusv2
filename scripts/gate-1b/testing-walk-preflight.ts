/**
 * Testing Direct Service walk — pre-flight. READ ONLY.
 *
 * Establishes what the walk has to CREATE versus what it can reuse, and proves
 * the new lifecycle guard fires against real rows rather than only against
 * fixtures.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { leaves, quoteLeaves, quotes } from "@/db/schema";
import { assertDraft } from "@/lib/action-result";

const LINEAGE = "d9dc519a-9965-4dd2-8b4a-f48cf2bf5a7a";

// ── 1 · is there a testing_micros service leaf in the library at all? ────
console.log("── library service leaves ────────────────────────────");
const svcLeaves = await db
  .select({
    id: leaves.id,
    sku: leaves.sku,
    name: leaves.name,
    identity: leaves.serviceIdentity,
    archived: leaves.archived,
  })
  .from(leaves)
  .where(eq(leaves.commercialKind, "service"));
if (svcLeaves.length === 0) console.log("none — the walk must create one");
else
  console.table(
    svcLeaves.map((l) => ({
      sku: l.sku,
      name: (l.name ?? "").slice(0, 30),
      identity: l.identity,
      archived: l.archived,
    })),
  );

const testing = svcLeaves.filter((l) => l.identity === "testing_micros");
console.log(
  testing.length > 0
    ? `\ntesting_micros leaf EXISTS (${testing.map((t) => t.sku).join(", ")}) — reusable`
    : "\nNO testing_micros leaf — the walk must create one via Add Product (service)",
);

// ── 2 · is one already attached to a lineage quote? ──────────────────────
console.log("\n── testing_micros attachments on the lineage ─────────");
const attached = await db
  .select({
    quoteId: quotes.id,
    label: quotes.scenarioLabel,
    status: quotes.status,
    quoteLeafId: quoteLeaves.id,
    sku: leaves.sku,
    identity: leaves.serviceIdentity,
  })
  .from(quoteLeaves)
  .innerJoin(leaves, eq(leaves.id, quoteLeaves.leafId))
  .innerJoin(quotes, eq(quotes.id, quoteLeaves.quoteId))
  .where(and(eq(quotes.projectId, LINEAGE), eq(leaves.commercialKind, "service")));
if (attached.length === 0) console.log("none");
else
  console.table(
    attached.map((a) => ({
      quote: (a.label ?? "").slice(0, 30),
      status: a.status,
      sku: a.sku,
      identity: a.identity,
      quoteLeafId: a.quoteLeafId.slice(0, 8),
    })),
  );

// ── 3 · the guard, against REAL rows ─────────────────────────────────────
//
// The unit tests exercise `assertDraft` on synthetic statuses. This runs the
// same governing function against the actual lineage quotes, so the invariant
// is shown to hold for the rows the walk will use rather than for a fixture.
console.log("\n── assertDraft against real lineage quotes ───────────");
const lineageQuotes = await db
  .select({ id: quotes.id, label: quotes.scenarioLabel, status: quotes.status })
  .from(quotes)
  .where(eq(quotes.projectId, LINEAGE));
for (const q of lineageQuotes) {
  let verdict: string;
  try {
    assertDraft(q);
    verdict = "PASSES — cost is authorable";
  } catch (e) {
    verdict = `REFUSES — ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`;
  }
  console.log(`  ${(q.label ?? "").slice(0, 34).padEnd(36)} ${q.status.padEnd(10)} ${verdict}`);
}

process.exit(0);
