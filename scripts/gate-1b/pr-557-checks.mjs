/**
 * #557 — APPLICATION BEHAVIOUR checks, over HTTP, against the isolated app.
 *
 * Everything here is read from what the running application actually served.
 * Server-action and projection checks live in their sibling scripts; the three
 * are reported as separate categories because they establish different things
 * and a reader should not have to infer which is which.
 *
 * Assertions are EXACT. The seeded firm default is "Validation Net 30" and the
 * base governed term is "Net 30" -- the second is a substring of the first, so
 * a `contains` check passes in both states and proves nothing.
 *
 * Three surfaces are read separately and never conflated:
 *   artifact  the terms cell inside the document (data-terms-verified)
 *   chrome    the operator notice outside the sheet
 *   props     the RSC flight payload, which carries the firm default as DATA
 *             beside `paymentTermsSource: "provisional"` and is not a claim
 *
 * Exit code is nonzero if any check FAILs or is BLOCKED.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { extractPdfText } from "./pdf-text.mjs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3100";

// ── the permitted target is asserted, not assumed ─────────────────────────
//
// This script drives an application over HTTP and requests PDF renders. It has
// no database handle, so the runtime guard the sibling scripts import does not
// apply -- but `CHECK_BASE` can point anywhere, and pointing it at a deployed
// environment would exercise real customer documents. Loopback only, and the
// isolated providers must be declared, because a loopback app started from the
// production profile is still the production profile.
{
  const host = new URL(BASE).hostname;
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!loopback) {
    console.error(
      `[gate-1b] refusing to run against ${BASE}.\n` +
        `  These checks render customer documents. CHECK_BASE must be a loopback\n` +
        `  address serving the isolated validation app.`,
    );
    process.exit(2);
  }
  const kinds = [
    "NEXUS_AUTH_PROVIDER",
    "NEXUS_HUBSPOT_PROVIDER",
    "NEXUS_NETSUITE_PROVIDER",
    "NEXUS_ARTIFACT_PROVIDER",
    "NEXUS_REALTIME_PROVIDER",
  ];
  const wrong = kinds.filter((k) => (process.env[k] ?? "").trim() !== "isolated");
  if (wrong.length > 0) {
    console.error(
      `[gate-1b] refusing: these providers are not declared isolated: ${wrong.join(", ")}.\n` +
        `  Launch with --env-file=.env.validation.local, or export the same values,\n` +
        `  so the target the checks drive is the isolated one.`,
    );
    process.exit(2);
  }
}
const ART = process.env.CHECK_ARTIFACTS ?? ".artifacts/pr-557";
mkdirSync(ART, { recursive: true });

const Q = {
  mapped: { p: "601459c0-a0d1-45e4-840d-dce22a558bc3", q: "f6f8a904-5cdd-4e70-8ed7-2cf5a267e6cd", term: "Net 30" },
  unmapped: { p: "89346554-e22d-4a6f-89eb-300157cd5cab", q: "e5129003-958b-40f0-8753-d2a90914363a", term: null },
  alt: { p: "ad1874ab-2f80-4af1-8a1a-c1964d7e852a", q: "6b744fb8-94e5-477d-8379-ee3e2218e71e", term: "Net 60" },
};
const FIRM_DEFAULT = "Validation Net 30";
const FROZEN = "Frozen Net 45";

const results = [];
function rec(id, verdict, detail, artifact) {
  results.push({ id, category: "application", verdict, detail, artifact: artifact ?? null });
  console.log(`${verdict.padEnd(7)} ${id.padEnd(14)} ${detail}${artifact ? `  [${artifact}]` : ""}`);
}
function save(name, body) {
  const path = `${ART}/${name}`;
  writeFileSync(path, body);
  return path;
}

async function get(path) {
  const res = await fetch(BASE + path, { redirect: "manual" });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, body: buf.toString("utf8"), type: res.headers.get("content-type") ?? "" };
}

const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ");
function sheet(html) {
  const i = html.indexOf('data-testid="customer-view-live"');
  if (i === -1) return "";
  const j = html.indexOf("</article>", i);
  return visible(html.slice(i, j === -1 ? undefined : j));
}
const strip = (s) =>
  s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").replace(/\\?"/g, "").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

function artifactTerms(html) {
  const m = html.match(/data-terms-verified=\\?"([01])\\?"[^>]*>([\s\S]{0,200}?)<\/div>/);
  return m ? { verified: m[1] === "1", value: strip(m[2]) } : null;
}
function chromeNotice(html) {
  const reason = html.match(/data-terms-reason=\\?"([a-z_]+)\\?"/);
  return { present: html.includes('data-testid="payment-terms-unverified"'), reason: reason ? reason[1] : null };
}

/**
 * The Sales Order receipt's Terms cell.
 *
 * Read positionally from the receipt grid — `<div class="k">Terms</div>`
 * followed by its `v` cell — because asserting only that the firm default is
 * ABSENT would pass on a receipt that printed nothing at all.
 */
function receiptTerms(html) {
  const v = visible(html);
  const k = v.search(/>\s*Terms\s*</);
  if (k === -1) return null;
  const m = v.slice(k).match(/>\s*Terms\s*<[\s\S]{0,400}?class=\\?"v\\?"[^>]*>([\s\S]{0,200}?)<\/div>/);
  if (!m) return null;
  // The cell carries terms, a <br>, then incoterms in a mono span.
  return strip(m[1].split(/<br\s*\/?>/)[0]);
}

async function main() {
  const who = process.env.NEXUS_VALIDATION_IDENTITY ?? "pm";
  // The frozen check needs the customer's CURRENT term overridden, which
  // changes what every DRAFT legitimately renders. Running both in one pass
  // would make the draft expectations wrong for a reason that is not a defect,
  // so the two are separate runs over the same fixtures.
  const only = process.env.CHECK_ONLY ?? "all";
  const wantDraftChecks = only === "all";

  // ── terms in the rendered document, and the chrome beside it ────────────
  for (const [name, spec] of wantDraftChecks ? Object.entries(Q) : []) {
    const r = await get(`/projects/${spec.p}/quotes/${spec.q}/quote`);
    const path = save(`preview-${name}.html`, r.body);
    if (r.status !== 200) { rec(`A:${name}`, "BLOCKED", `HTTP ${r.status}`, path); continue; }
    const art = artifactTerms(r.body);
    const ch = chromeNotice(r.body);
    if (!art) { rec(`A:${name}`, "BLOCKED", "terms cell absent", path); continue; }
    const inArtifact = sheet(r.body).includes(FIRM_DEFAULT);
    if (spec.term) {
      const ok = art.verified && art.value === spec.term && !ch.present && !inArtifact;
      rec(`A:${name}`, ok ? "PASS" : "FAIL",
        `document terms="${art.value}" (exact "${spec.term}") verified=${art.verified} · firm-default in artifact=${inArtifact} · chrome=${ch.present}`, path);
    } else {
      const inChrome = visible(r.body).includes(FIRM_DEFAULT);
      const ok = !art.verified && art.value === "—" && ch.present && ch.reason === "no_lineage" && !inArtifact && inChrome;
      rec(`A:${name}`, ok ? "PASS" : "FAIL",
        `document terms="${art.value}" verified=${art.verified} · firm-default in artifact=${inArtifact} (false) in chrome=${inChrome} (true) · chrome=${ch.present}/${ch.reason}`, path);
    }
  }

  // A5 · per-customer terms differ
  if (wantDraftChecks) {
    const a = artifactTerms((await get(`/projects/${Q.mapped.p}/quotes/${Q.mapped.q}/quote`)).body);
    const b = artifactTerms((await get(`/projects/${Q.alt.p}/quotes/${Q.alt.q}/quote`)).body);
    const ok = a?.value === "Net 30" && b?.value === "Net 60";
    rec("A5", ok ? "PASS" : "FAIL", `mapped="${a?.value}" alt="${b?.value}" — each keeps its own`);
  }

  // ── the PDF ARTIFACT, text extracted from the generated file ────────────
  for (const [name, spec] of wantDraftChecks ? [["mapped", Q.mapped], ["unmapped", Q.unmapped], ["alt", Q.alt]] : []) {
    const r = await get(`/api/quotes/${spec.q}/customer-pdf`);
    if (r.status !== 200) { rec(`PDF:${name}`, "BLOCKED", `HTTP ${r.status}`); continue; }
    const pdfPath = save(`customer-${name}.pdf`, r.buf);
    // Extracted from the GENERATED FILE, through each subset font's ToUnicode
    // table. Reading the streams naively returns nothing at all, and nothing
    // is indistinguishable from an empty document.
    const text = extractPdfText(pdfPath);
    const txtPath = save(`customer-${name}.pdf.txt`, text);
    // EXACT field value, not a substring of the whole document.
    //
    // `includes(term)` cannot assert the unmapped case at all: an empty terms
    // field and a missing terms BLOCK read identically, so the check that
    // matters most -- the document stating no commitment -- would pass on a
    // document that never rendered the row. The field is delimited by its own
    // label and the next one, so it can be read exactly and compared for
    // equality, including against "".
    const field = text.match(/PAYMENT TERMS([\s\S]*?)LEAD TIME/);
    if (!field) {
      rec(`PDF:${name}`, "BLOCKED",
        `no PAYMENT TERMS -> LEAD TIME block in ${text.length} chars of extracted text`, txtPath);
      continue;
    }
    const value = field[1].trim();
    const expected = spec.term ?? "";
    const ok = value === expected && !text.includes(FIRM_DEFAULT);
    rec(`PDF:${name}`, ok ? "PASS" : "FAIL",
      `${r.buf.length}B pdf · terms field="${value}" (exact "${expected}") · firm default anywhere in document=${text.includes(FIRM_DEFAULT)}`, txtPath);
  }

  // ── the Sales Order receipt ─────────────────────────────────────────────
  //
  // A DRAFT has no order, so no receipt is rendered and the correct assertion
  // is its absence. The earlier run reported "Terms cell not found" as BLOCKED
  // on three drafts; the cell was not missing, the receipt was never supposed
  // to be there. The positive assertion belongs on a quote that HAS an order.
  for (const [name, spec] of wantDraftChecks ? Object.entries(Q) : []) {
    const r = await get(`/projects/${spec.p}/quotes/${spec.q}/quote?tab=tier`);
    const path = save(`so-receipt-${name}.html`, r.body);
    if (r.status !== 200) { rec(`SO:${name}`, "BLOCKED", `HTTP ${r.status}`, path); continue; }
    const t = receiptTerms(r.body);
    rec(`SO:${name}`, t === null ? "PASS" : "FAIL",
      `draft with no Sales Order renders no receipt (terms cell found=${t !== null})`, path);
  }

  if (process.env.CHECK_ORDER_QUOTE) {
    const [op, oq] = process.env.CHECK_ORDER_QUOTE.split("/");
    const r = await get(`/projects/${op}/quotes/${oq}/quote?tab=tier`);
    const path = save("so-receipt-complete.html", r.body);
    if (r.status !== 200) { rec("SO:order", "BLOCKED", `HTTP ${r.status}`, path); }
    else {
      const t = receiptTerms(r.body);
      if (t === null) rec("SO:order", "BLOCKED", "receipt Terms cell not found on a quote WITH an order", path);
      else rec("SO:order", t === FROZEN ? "PASS" : "FAIL",
        `receipt Terms="${t}" (exact "${FROZEN}" — the term frozen at send, not the customer's current one)`, path);
    }
  }

  // ── a SENT quote renders its frozen snapshot ────────────────────────────
  if (process.env.CHECK_SENT_QUOTE) {
    const [sp, sq] = process.env.CHECK_SENT_QUOTE.split("/");
    const r = await get(`/projects/${sp}/quotes/${sq}/quote`);
    const path = save("preview-sent.html", r.body);
    if (r.status !== 200) { rec("FROZEN", "BLOCKED", `HTTP ${r.status}`, path); }
    else {
      const art = artifactTerms(r.body);
      const live = process.env.NEXUS_FAKE_NETSUITE_TERMS ?? "(not overridden)";
      const ok = art?.verified === true && art.value === FROZEN;
      rec("FROZEN", ok ? "PASS" : "FAIL",
        `sent quote shows "${art?.value}" (exact "${FROZEN}") while the customer's CURRENT term is "${live}"`, path);
    }
  }

  // ── access ──────────────────────────────────────────────────────────────
  //
  // The identity is read from the APP, not from this process. `who` above is
  // whatever env THIS script was launched with, and the app under test is a
  // separate process that may have been started with a different one -- which
  // is not hypothetical: a run with the script on `pm` against an app on
  // `admin` reported two failures that were purely that mismatch.
  //
  // Asking the running application is the only reading that describes the
  // thing being tested. If it cannot be determined the checks are BLOCKED,
  // never assumed, because a wrong expectation produces a verdict about the
  // harness wearing the costume of a verdict about the product.
  if (wantDraftChecks) {
    const home = await get("/");
    const email = home.body.match(/[\w.+-]+@nexus-validation\.invalid/)?.[0] ?? null;
    const appIdentity = email?.startsWith("admin@")
      ? "admin"
      : email?.startsWith("pm@")
        ? "pm"
        : null;

    if (appIdentity === null) {
      rec("C:identity", "BLOCKED",
        `could not determine which identity the app at ${BASE} is serving (home HTTP ${home.status})`);
    } else {
      if (appIdentity !== who) {
        rec("C:identity", "PASS",
          `app is serving "${appIdentity}"; this process was launched as "${who}" — expectations follow the APP`);
      }
      for (const path of ["/admin/netsuite-customer-map", "/admin/netsuite"]) {
        const r = await get(path);
        const expected = appIdentity === "admin" ? 200 : 307;
        rec(`C:${appIdentity}:${path.includes("customer") ? "map" : "ns"}`,
          r.status === expected ? "PASS" : "FAIL",
          `HTTP ${r.status} (expected ${expected} for ${appIdentity})`);
      }
    }
  }

  const summary = {
    category: "application",
    identity: who,
    scenario: process.env.NEXUS_FAKE_NETSUITE_SCENARIO ?? "success",
    pass: results.filter((r) => r.verdict === "PASS").length,
    fail: results.filter((r) => r.verdict === "FAIL").length,
    blocked: results.filter((r) => r.verdict === "BLOCKED").length,
    results,
  };
  const sp = save(`summary-application-${who}-${only}.json`, JSON.stringify(summary, null, 2));
  console.log(`\nPASS ${summary.pass}  FAIL ${summary.fail}  BLOCKED ${summary.blocked}  [${sp}]`);
  process.exit(summary.fail + summary.blocked > 0 ? 1 : 0);
}

await main();
