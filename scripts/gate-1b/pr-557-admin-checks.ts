/**
 * #557 checks B and D, driven through the real action layer under the
 * isolated providers.
 *
 * These run in-process rather than over HTTP because a server action is
 * reached by the RSC protocol and an action id, neither of which curl can
 * produce. The UI wiring that calls these actions is covered separately and
 * deterministically by the 14 mounted cases; what is unproven without this
 * file is the SERVER half -- that a save writes a row and an audit entry, that
 * a refusal writes neither, and that a mapped customer then changes what the
 * quote prints.
 */
import { db } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { auditLog, netsuiteCustomerMap } from "@/db/schema";
import {
  listCustomerMappings,
  saveCustomerMapping,
  searchNetsuiteCustomersForMapping,
} from "@/app/actions/netsuite-customer-map";
import { resolveCustomerView } from "@/lib/customer-view-resolver";
import { presentPaymentTerms } from "@/lib/payment-terms-presentation";

const RUN = "local-example";
const UNMAPPED_COMPANY = `validation_hs_company_unmapped_${RUN}`;
const UNMAPPED_QUOTE = "e5129003-958b-40f0-8753-d2a90914363a";

type Verdict = "PASS" | "FAIL" | "BLOCKED";
const out: { id: string; verdict: Verdict; detail: string }[] = [];
function rec(id: string, verdict: Verdict, detail: string) {
  out.push({ id, verdict, detail });
  console.log(`${verdict.padEnd(7)} ${id.padEnd(6)} ${detail}`);
}

async function mappingRow() {
  const [row] = await db
    .select()
    .from(netsuiteCustomerMap)
    .where(eq(netsuiteCustomerMap.hubspotCompanyId, UNMAPPED_COMPANY));
  return row ?? null;
}

async function auditRows(action: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityId, UNMAPPED_COMPANY), eq(auditLog.action, action)))
    .orderBy(desc(auditLog.createdAt));
}

async function termsFor(quoteId: string) {
  const r = await resolveCustomerView({ quoteId, searchParams: {} });
  if (!r.ok) return { kind: "unresolved" as const, detail: r.kind };
  const q = r.view.quote;
  const p = presentPaymentTerms({
    source: q.paymentTermsSource,
    value: q.paymentTerms,
    unresolvedReason: q.paymentTermsUnresolvedReason,
  });
  return {
    kind: p.kind,
    printed: p.kind === "verified" ? p.value : "—",
    reason: p.kind === "unverified" ? p.reason : null,
  };
}

async function main() {
  const scenario = process.env.NEXUS_FAKE_NETSUITE_SCENARIO ?? "success";
  console.log(`scenario=${scenario} identity=${process.env.NEXUS_VALIDATION_IDENTITY}`);

  // ── B1 · the list shows the gap, unmapped first ─────────────────────────
  const list = await listCustomerMappings();
  if (!list.ok) {
    rec("B1", "BLOCKED", `listCustomerMappings refused: ${list.error.message}`);
  } else {
    const rows = list.data.rows;
    const idx = rows.findIndex((r) => r.hubspotCompanyId === UNMAPPED_COMPANY);
    const firstMappedIdx = rows.findIndex((r) => r.netsuiteCustomerId !== null);
    rec(
      "B1",
      idx !== -1 && (firstMappedIdx === -1 || idx < firstMappedIdx) ? "PASS" : "FAIL",
      `${rows.length} companies; unmapped company at index ${idx}, first mapped at ${firstMappedIdx}`,
    );
  }

  // ── B2 · ambiguity surfaced, nothing auto-selected ──────────────────────
  const search = await searchNetsuiteCustomersForMapping("Validation");
  if (!search.ok) {
    rec("B2", "BLOCKED", `search refused: ${search.error.message}`);
  } else if (search.data.state === "unavailable") {
    rec(
      "B2",
      scenario === "search-unavailable" ? "PASS" : "FAIL",
      `state=unavailable detail="${search.data.detail}" — distinct from an empty result`,
    );
  } else {
    rec(
      "B2",
      search.data.candidates.length > 1 ? "PASS" : "FAIL",
      `${search.data.candidates.length} candidates returned for an ambiguous query: ${search.data.candidates
        .map((c) => c.netsuiteCustomerId)
        .join(", ")}`,
    );
  }

  // ── D2/B5 · a save the workflow cannot confirm writes NOTHING ───────────
  if (scenario === "customer-missing") {
    const before = await mappingRow();
    const res = await saveCustomerMapping({
      hubspotCompanyId: UNMAPPED_COMPANY,
      netsuiteCustomerId: "validation_ns_customer_does_not_resolve",
    });
    const after = await mappingRow();
    const refused = !res.ok;
    rec(
      "B5",
      refused && after === null && before === null ? "PASS" : "FAIL",
      refused
        ? `refused: "${res.error.message.slice(0, 90)}" · row written=${after !== null}`
        : "the save was ACCEPTED on a customer that could not be read",
    );
    console.log(JSON.stringify(out));
    process.exit(0);
  }

  // ── D3 · a failed terms READ is transient, not a missing mapping ────────
  if (scenario === "customer-terms-read-fails") {
    const mapped = await termsFor("f6f8a904-5cdd-4e70-8ed7-2cf5a267e6cd");
    rec(
      "D3",
      mapped.kind === "unverified" && mapped.reason === "netsuite_unavailable"
        ? "PASS"
        : "FAIL",
      `mapped quote under an outage -> kind=${mapped.kind} reason=${mapped.reason} (must be netsuite_unavailable, NOT no_lineage)`,
    );
    console.log(JSON.stringify(out));
    process.exit(0);
  }

  // ── B3 · save writes the row and the audit ──────────────────────────────
  const before = await termsFor(UNMAPPED_QUOTE);
  rec(
    "B4a",
    before.kind === "unverified" && before.reason === "no_lineage" ? "PASS" : "FAIL",
    `before mapping: kind=${before.kind} reason=${before.reason} printed="${before.printed}"`,
  );

  const save = await saveCustomerMapping({
    hubspotCompanyId: UNMAPPED_COMPANY,
    netsuiteCustomerId: "validation_ns_customer",
  });
  const row = await mappingRow();
  const created = await auditRows("netsuite_customer_map_created");
  if (!save.ok) {
    rec("B3", "FAIL", `save refused: ${save.error.message}`);
  } else {
    rec(
      "B3",
      row !== null && row.verifiedAt !== null && created.length === 1 ? "PASS" : "FAIL",
      `row=${row !== null} verified_at=${row?.verifiedAt !== null} audit rows=${created.length} · governed terms read back="${save.data.terms}"`,
    );
  }

  // ── B4 · the loop closes: the quote now prints a governed term ──────────
  const after = await termsFor(UNMAPPED_QUOTE);
  rec(
    "B4",
    after.kind === "verified" && after.printed === "Net 30" ? "PASS" : "FAIL",
    `after mapping: kind=${after.kind} printed="${after.printed}" (exact "Net 30")`,
  );

  console.log(JSON.stringify(out));
  process.exit(0);
}

await main();
