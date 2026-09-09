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
import { mkdirSync, writeFileSync } from "node:fs";
import { db } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { auditLog, netsuiteCustomerMap, quotes } from "@/db/schema";
import {
  listCustomerMappings,
  saveCustomerMapping,
  searchNetsuiteCustomersForMapping,
} from "@/app/actions/netsuite-customer-map";
import { sendQuote } from "@/app/actions/quotes";
import { resolveCustomerView } from "@/lib/customer-view-resolver";
import { presentPaymentTerms } from "@/lib/payment-terms-presentation";

const RUN = "local-example";
const UNMAPPED_COMPANY = `validation_hs_company_unmapped_${RUN}`;
const UNMAPPED_QUOTE = "e5129003-958b-40f0-8753-d2a90914363a";

type Verdict = "PASS" | "FAIL" | "BLOCKED";
const ART = process.env.CHECK_ARTIFACTS ?? ".artifacts/pr-557";
mkdirSync(ART, { recursive: true });
const out: {
  id: string;
  category: string;
  verdict: Verdict;
  detail: string;
  artifact: string | null;
}[] = [];
function rec(id: string, verdict: Verdict, detail: string, artifact?: string) {
  out.push({ id, category: "server-action", verdict, detail, artifact: artifact ?? null });
  console.log(`${verdict.padEnd(7)} ${id.padEnd(10)} ${detail}${artifact ? `  [${artifact}]` : ""}`);
}
function save(name: string, body: string): string {
  const path = `${ART}/${name}`;
  writeFileSync(path, body);
  return path;
}
function finish(): never {
  const scenario = process.env.NEXUS_FAKE_NETSUITE_SCENARIO ?? "success";
  const who = process.env.NEXUS_VALIDATION_IDENTITY ?? "pm";
  const summary = {
    category: "server-action",
    identity: who,
    scenario,
    pass: out.filter((r) => r.verdict === "PASS").length,
    fail: out.filter((r) => r.verdict === "FAIL").length,
    blocked: out.filter((r) => r.verdict === "BLOCKED").length,
    results: out,
  };
  const sp = save(`summary-actions-${who}-${scenario}.json`, JSON.stringify(summary, null, 2));
  console.log(`\nPASS ${summary.pass}  FAIL ${summary.fail}  BLOCKED ${summary.blocked}  [${sp}]`);
  process.exit(summary.fail + summary.blocked > 0 ? 1 : 0);
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

  // ── PM is refused at the ACTION, and nothing moves ──────────────────────
  //
  // Separate from the page guard: a saved page DOM carries action ids, so the
  // action boundary has to hold on its own. Mutation is asserted by counting
  // rows before and after, because "it returned an error" and "it wrote
  // nothing" are different claims.
  if ((process.env.NEXUS_VALIDATION_IDENTITY ?? "pm") === "pm") {
    const beforeRows = (await db.select().from(netsuiteCustomerMap)).length;
    const beforeAudit = (await db.select().from(auditLog)).length;

    const search = await searchNetsuiteCustomersForMapping("Validation");
    const save1 = await saveCustomerMapping({
      hubspotCompanyId: UNMAPPED_COMPANY,
      netsuiteCustomerId: "validation_ns_customer",
    });
    const list = await listCustomerMappings();

    const afterRows = (await db.select().from(netsuiteCustomerMap)).length;
    const afterAudit = (await db.select().from(auditLog)).length;

    const refusedAll = !search.ok && !save1.ok && !list.ok;
    const unchanged = beforeRows === afterRows && beforeAudit === afterAudit;
    const path = save(
      "pm-action-denial.json",
      JSON.stringify(
        {
          search: search.ok ? "ALLOWED" : search.error,
          save: save1.ok ? "ALLOWED" : save1.error,
          list: list.ok ? "ALLOWED" : list.error,
          mappingRows: { before: beforeRows, after: afterRows },
          auditRows: { before: beforeAudit, after: afterAudit },
        },
        null,
        2,
      ),
    );
    rec(
      "C2",
      refusedAll && unchanged ? "PASS" : "FAIL",
      `PM refused: search=${!search.ok} save=${!save1.ok} list=${!list.ok} · mapping rows ${beforeRows}->${afterRows} · audit rows ${beforeAudit}->${afterAudit}`,
      path,
    );
    finish();
  }

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
    finish();
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
    finish();
  }


  // ── D4b · Send is REFUSED and publication state is untouched ────────────
  //
  // The gate's predicate is asserted elsewhere; this drives `sendQuote`
  // itself and then checks that nothing it would have allocated exists --
  // a refusal that still stamped a quote number or a sent_at would be a
  // worse defect than the one the gate prevents.
  if (process.env.CHECK_SEND === "1") {
    const before = await db
      .select({
        status: quotes.status,
        quoteNumber: quotes.quoteNumber,
        sentAt: quotes.sentAt,
        pdfUrl: quotes.pdfUrl,
        snapshot: quotes.paymentTermsSnapshot,
      })
      .from(quotes)
      .where(eq(quotes.id, UNMAPPED_QUOTE));

    const fd = new FormData();
    fd.set("quoteId", UNMAPPED_QUOTE);
    fd.set("pdfLayout", "tier_table");
    fd.set("detailLevel", "itemized");
    fd.set("includeSpecAddendum", "false");
    let refusal = "";
    let threw = false;
    try {
      const res = await sendQuote(fd);
      refusal = res.ok ? "ACCEPTED" : res.error.message;
      threw = !res.ok;
    } catch (e) {
      threw = true;
      refusal = e instanceof Error ? e.message : String(e);
    }

    const after = await db
      .select({
        status: quotes.status,
        quoteNumber: quotes.quoteNumber,
        sentAt: quotes.sentAt,
        pdfUrl: quotes.pdfUrl,
        snapshot: quotes.paymentTermsSnapshot,
      })
      .from(quotes)
      .where(eq(quotes.id, UNMAPPED_QUOTE));

    const same = JSON.stringify(before) === JSON.stringify(after);
    const path = save(
      "send-refusal.json",
      JSON.stringify({ refusal, before, after }, null, 2),
    );
    rec(
      "D4b",
      threw && same && after[0]?.quoteNumber === null && after[0]?.sentAt === null
        ? "PASS"
        : "FAIL",
      `sendQuote refused=${threw} ("${refusal.slice(0, 70)}") · publication state unchanged=${same} (quote_number=${after[0]?.quoteNumber}, sent_at=${after[0]?.sentAt})`,
      path,
    );
    finish();
  }

  // ── B3 · save writes the row and the audit ──────────────────────────────
  const before = await termsFor(UNMAPPED_QUOTE);
  rec(
    "B4a",
    before.kind === "unverified" && before.reason === "no_lineage" ? "PASS" : "FAIL",
    `before mapping: kind=${before.kind} reason=${before.reason} printed="${before.printed}"`,
  );

  // NOT named `save`: that shadows the artifact helper for the whole of
  // main() and puts it in the temporal dead zone for every earlier caller.
  const saveRes = await saveCustomerMapping({
    hubspotCompanyId: UNMAPPED_COMPANY,
    netsuiteCustomerId: "validation_ns_customer",
  });
  const row = await mappingRow();
  const created = await auditRows("netsuite_customer_map_created");
  if (!saveRes.ok) {
    rec("B3", "FAIL", `save refused: ${saveRes.error.message}`);
  } else {
    rec(
      "B3",
      row !== null && row.verifiedAt !== null && created.length === 1 ? "PASS" : "FAIL",
      `row=${row !== null} verified_at=${row?.verifiedAt !== null} audit rows=${created.length} · governed terms read back="${saveRes.data.terms}"`,
    );
  }

  // ── B4 · the loop closes: the quote now prints a governed term ──────────
  const after = await termsFor(UNMAPPED_QUOTE);
  rec(
    "B4",
    after.kind === "verified" && after.printed === "Net 30" ? "PASS" : "FAIL",
    `after mapping: resolver kind=${after.kind} printed="${after.printed}" (exact "Net 30")`,
  );

  // B4r · the RENDERED page, not just the resolver. Reopening the quote is
  // what an operator does after mapping, and it is the only step that shows
  // the document actually changed.
  if (process.env.CHECK_BASE) {
    const url = `${process.env.CHECK_BASE}/projects/89346554-e22d-4a6f-89eb-300157cd5cab/quotes/${UNMAPPED_QUOTE}/quote`;
    const html = await fetch(url).then((r) => r.text());
    const path = save("preview-after-mapping.html", html);
    const m = html.match(/data-terms-verified=\\?"([01])\\?"[^>]*>([\s\S]{0,200}?)<\/div>/);
    const value = m
      ? m[2].replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      : null;
    const notice = html.includes('data-testid="payment-terms-unverified"');
    rec(
      "B4r",
      m?.[1] === "1" && value === "Net 30" && !notice ? "PASS" : "FAIL",
      `reopened quote renders terms="${value}" verified=${m?.[1] === "1"} · operator notice gone=${!notice}`,
      path,
    );
  }

  finish();
}

await main();
