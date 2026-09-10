/**
 * #557 — the customer ARTIFACT projection, and the Send gate.
 *
 * A3 asserts what the PDF is built FROM. The HTTP check already establishes
 * the route returns a real `application/pdf`, but react-pdf compresses its
 * text streams, so grepping the bytes for a term would be a check that cannot
 * report the failure it excludes. The projection is where the value is
 * decided, and it is the seam the first pass of this work missed entirely.
 */
// FIRST: refuses before `@/db` is evaluated and a pool is opened.
import "./require-isolated.ts";
import { resolveCustomerView } from "@/lib/customer-view-resolver";
import { customerViewToCpdf } from "@/lib/customer-view-to-cpdf";
import { resolveGovernedPaymentTerms, unresolvedTermsMessage } from "@/lib/netsuite/customer-terms";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { projects, quotes } from "@/db/schema";

const FIRM_DEFAULT = "Validation Net 30";
const CASES = [
  { id: "mapped", quote: "f6f8a904-5cdd-4e70-8ed7-2cf5a267e6cd", expect: "Net 30" },
  { id: "unmapped", quote: "e5129003-958b-40f0-8753-d2a90914363a", expect: "" },
  { id: "alt", quote: "6b744fb8-94e5-477d-8379-ee3e2218e71e", expect: "Net 60" },
];

const out: { id: string; category: string; verdict: string; detail: string }[] = [];
function rec(id: string, verdict: string, detail: string) {
  out.push({ id, category: "projection", verdict, detail });
  console.log(`${verdict.padEnd(7)} ${id.padEnd(6)} ${detail}`);
}

for (const c of CASES) {
  const r = await resolveCustomerView({ quoteId: c.quote, searchParams: {} });
  if (!r.ok) {
    rec(`A3p:${c.id}`, "BLOCKED", `resolve failed: ${r.kind}`);
    continue;
  }
  const { data: doc } = customerViewToCpdf(r.view, {
    todayIso: "2026-09-09",
  });
  // `payment_terms` lives on the projected QUOTE, not at the top level.
  // Reading it from the root returned "" for every case -- including the
  // unmapped one, whose PASS was therefore vacuous. A check that reports the
  // same value for every input is not measuring the input.
  const printed = doc.quote.payment_terms ?? "";
  const ok = printed === c.expect && !printed.includes(FIRM_DEFAULT);
  rec(
    `A3p:${c.id}`,
    ok ? "PASS" : "FAIL",
    `PDF projection payment_terms="${printed}" (exact "${c.expect}") · firm default present=${printed.includes(FIRM_DEFAULT)}`,
  );
}

// ── D4 · Send fails closed on an unresolved term ────────────────────────────
// Asserted at the gate's own predicate against REAL fixture lineage rather
// than by driving the form: `sendQuote` evaluates exactly this and throws when
// it is not `governed`, and a FormData round trip would add nothing to what is
// being established here.
const [proj] = await db
  .select({ dealId: projects.hubspotDealId })
  .from(quotes)
  .innerJoin(projects, eq(projects.id, quotes.projectId))
  .where(eq(quotes.id, "e5129003-958b-40f0-8753-d2a90914363a"));

const gate = await resolveGovernedPaymentTerms(proj?.dealId ?? null);
const blocked = gate.status !== "governed";
const message = unresolvedTermsMessage(gate) ?? "";
rec(
  "D4",
  blocked && /could not be verified/i.test(message) && /not authority/i.test(message)
    ? "PASS"
    : "FAIL",
  `unmapped quote at the Send gate -> status=${gate.status}; operator sentence="${message.slice(0, 96)}"`,
);

// A gate that always exits 0 is a report, not a gate. BLOCKED counts as
// failure here for the same reason a failed read is not a passing read: the
// check did not establish its claim, and "could not tell" must never be
// indistinguishable from "told us it was fine".
const failCount = out.filter((r) => r.verdict === "FAIL").length;
const blockedCount = out.filter((r) => r.verdict === "BLOCKED").length;
console.log(
  `\nPASS ${out.length - failCount - blockedCount}  FAIL ${failCount}  BLOCKED ${blockedCount}`,
);
process.exit(failCount + blockedCount > 0 ? 1 : 0);
