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
const ART = process.env.CHECK_ARTIFACTS ?? ".artifacts/pr-557";
mkdirSync(ART, { recursive: true });

// ── the permitted target is established FROM THE TARGET ───────────────────
//
// An earlier version read `NEXUS_*_PROVIDER` out of THIS process. Those
// variables describe the shell that launched the script, not the server it is
// pointed at, and the two are different processes -- so the check could be
// perfectly isolated while the app it drove was not. Isolation now comes from
// the target reporting its own runtime, and an unreachable or non-isolated
// target is refused rather than inferred around.
//
// Loopback is still required first, because asking a remote host to describe
// itself already sent it the request.
async function establishTarget() {
  const host = new URL(BASE).hostname;
  if (!(host === "127.0.0.1" || host === "localhost" || host === "::1")) {
    return { ok: false, detail: `${BASE} is not a loopback address. These checks render customer documents and drive real actions.` };
  }

  let body;
  let status = 0;
  try {
    const res = await fetch(new URL("/api/validation-runtime", BASE));
    status = res.status;
    if (status !== 200) {
      return {
        ok: false,
        detail: `target did not report runtime facts (HTTP ${status} from /api/validation-runtime). The probe does not exist outside isolated mode, so its ABSENCE is not evidence of isolation.`,
      };
    }
    body = await res.json();
  } catch (e) {
    return { ok: false, detail: `could not reach ${BASE} to establish isolation: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (body?.mode !== "isolated") {
    return { ok: false, detail: `target reports mode="${body?.mode}", not isolated.` };
  }
  const providers = body.providers ?? {};
  const wrong = Object.entries(providers).filter(([, kind]) => kind !== "isolated");
  if (wrong.length === 0 && Object.keys(providers).length === 0) {
    return { ok: false, detail: "target reported no providers — facts are absent, not clean." };
  }
  if (wrong.length > 0) {
    return { ok: false, detail: `target providers not isolated: ${wrong.map(([n, k]) => `${n}=${k}`).join(", ")}.` };
  }
  if (!body.database?.carriesValidationMarker) {
    return { ok: false, detail: `target database "${body.database?.name}" does not carry the validation marker.` };
  }
  if (!body.identity?.role) {
    return { ok: false, detail: "target reported no signed-in identity role." };
  }
  return { ok: true, facts: body };
}const Q = {
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
  // BEFORE any document is requested.
  const target = await establishTarget();
  if (!target.ok) {
    console.error(`[gate-1b] refusing: ${target.detail}`);
    process.exit(2);
  }
  console.log(
    `[gate-1b] target established · mode=${target.facts.mode} · db=${target.facts.database.name} · serving=${target.facts.identity.role} (${target.facts.identity.email})`,
  );
  const who = process.env.NEXUS_VALIDATION_IDENTITY ?? "pm";
  // The frozen check needs the customer's CURRENT term overridden, which
  // changes what every DRAFT legitimately renders. Running both in one pass
  // would make the draft expectations wrong for a reason that is not a defect,
  // so the two are separate runs over the same fixtures.
  const only = process.env.CHECK_ONLY ?? "all";
  const wantDraftChecks = only === "all";
  // `preflight` runs target establishment and the access checks ALONE. The
  // document checks render three PDFs per invocation, which would make a
  // falsification sweep over the preflight cost minutes for evidence it does
  // not use.
  const wantAccess = only === "all" || only === "preflight";

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
  // REQUESTED and OBSERVED are held apart on purpose. A PM run pointed at an
  // admin session is a BLOCKED PM test -- not a passing admin test. Rewriting
  // the expectation to match what was found would turn "I tested the wrong
  // thing" into a green tick, which is the failure mode this whole file exists
  // to prevent.
  if (wantAccess) {
    const requested = process.env.NEXUS_VALIDATION_IDENTITY ?? "pm";
    const observed = target.facts.identity.role;
    if (observed !== requested) {
      rec("C:identity", "BLOCKED",
        `requested "${requested}" but the target is serving "${observed}" (${target.facts.identity.email}). Point the check at an app started for "${requested}"; its expectations are NOT being rewritten to match.`);
    } else {
      rec("C:identity", "PASS",
        `requested and observed identity agree: "${observed}" (${target.facts.identity.email})`);
      for (const path of ["/admin/netsuite-customer-map", "/admin/netsuite"]) {
        const r = await get(path);
        const expected = observed === "admin" ? 200 : 307;
        rec(`C:${observed}:${path.includes("customer") ? "map" : "ns"}`,
          r.status === expected ? "PASS" : "FAIL",
          `HTTP ${r.status} (expected ${expected} for ${observed})`);
      }
    }
  }

  const summary = {
    category: "application",
    requestedIdentity: who,
    observedIdentity: target.facts.identity.role,
    scenario: process.env.NEXUS_FAKE_NETSUITE_SCENARIO ?? "success",
    pass: results.filter((r) => r.verdict === "PASS").length,
    fail: results.filter((r) => r.verdict === "FAIL").length,
    blocked: results.filter((r) => r.verdict === "BLOCKED").length,
    results,
  };
  const sp = save(`summary-application-${target.facts.identity.role}-${only}.json`, JSON.stringify(summary, null, 2));
  console.log(`\nPASS ${summary.pass}  FAIL ${summary.fail}  BLOCKED ${summary.blocked}  [${sp}]`);
  process.exit(summary.fail + summary.blocked > 0 ? 1 : 0);
}

await main();
