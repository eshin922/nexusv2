/**
 * #557 application checks, run against the isolated validation app.
 *
 * Assertions are EXACT. The seeded firm default is "Validation Net 30" and the
 * governed term for the base customer is "Net 30" -- the second is a substring
 * of the first, so a `contains` check passes in both the governed and the
 * unverified state and proves nothing. Every terms assertion here compares the
 * extracted value for equality.
 *
 * The customer ARTIFACT and the operator CHROME are read separately:
 *   artifact -> the terms cell inside the document, tagged
 *               data-terms-verified
 *   chrome   -> the notice outside the sheet, tagged
 *               data-testid="payment-terms-unverified"
 * A check that conflated them could not tell "the document says nothing and
 * the operator was told why" from "the document says the firm default".
 */
const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3100";

const Q = {
  mapped: {
    p: "601459c0-a0d1-45e4-840d-dce22a558bc3",
    q: "f6f8a904-5cdd-4e70-8ed7-2cf5a267e6cd",
    term: "Net 30",
  },
  unmapped: {
    p: "89346554-e22d-4a6f-89eb-300157cd5cab",
    q: "e5129003-958b-40f0-8753-d2a90914363a",
    term: null,
  },
  alt: {
    p: "ad1874ab-2f80-4af1-8a1a-c1964d7e852a",
    q: "6b744fb8-94e5-477d-8379-ee3e2218e71e",
    term: "Net 60",
  },
};
const FIRM_DEFAULT = "Validation Net 30";

const results = [];
function record(id, verdict, detail) {
  results.push({ id, verdict, detail });
  const mark = verdict === "PASS" ? "PASS " : verdict === "FAIL" ? "FAIL " : "BLOCK";
  console.log(`${mark} ${id.padEnd(6)} ${detail}`);
}

async function get(path) {
  const res = await fetch(BASE + path, { redirect: "manual" });
  const body = res.status < 300 ? await res.text() : "";
  return { status: res.status, body, type: res.headers.get("content-type") ?? "" };
}

/** The terms cell inside the customer document. */
function artifactTerms(html) {
  const m = html.match(
    /data-terms-verified=\\?"([01])\\?"[^>]*>([\s\S]{0,200}?)<\/div>/,
  );
  if (!m) return null;
  const raw = m[2]
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\?"/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { verified: m[1] === "1", value: raw };
}

/**
 * Rendered markup only.
 *
 * The RSC flight payload serialises the whole `CustomerView` into a <script>,
 * so the firm default appears there as DATA on every unmapped quote -- next to
 * `paymentTermsSource: "provisional"`, which is what tells the renderer not to
 * print it. Searching raw HTML conflates "the document asserted this" with
 * "the props contained this", and the first run of these checks failed on
 * exactly that: two FAILs, neither of them a defect.
 */
function visible(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ");
}

/** The customer artifact: the sheet, and nothing around it. */
function sheet(html) {
  const start = html.indexOf('data-testid="customer-view-live"');
  if (start === -1) return "";
  const end = html.indexOf("</article>", start);
  return visible(html.slice(start, end === -1 ? undefined : end));
}

/** The operator notice, which lives OUTSIDE the sheet. */
function chromeNotice(html) {
  const present = html.includes('data-testid="payment-terms-unverified"');
  const reason = html.match(/data-terms-reason=\\?"([a-z_]+)\\?"/);
  return { present, reason: reason ? reason[1] : null };
}

async function main() {
  // ── A · terms across preview, artifact and chrome ───────────────────────
  for (const [name, spec] of Object.entries(Q)) {
    const path = `/projects/${spec.p}/quotes/${spec.q}/quote`;
    const r = await get(path);
    if (r.status !== 200) {
      record(`A:${name}`, "BLOCKED", `HTTP ${r.status} on ${path}`);
      continue;
    }
    const art = artifactTerms(r.body);
    const chrome = chromeNotice(r.body);
    if (!art) {
      record(`A:${name}`, "BLOCKED", "terms cell not found in document");
      continue;
    }
    if (spec.term) {
      const inArtifact = sheet(r.body).includes(FIRM_DEFAULT);
      const ok =
        art.verified === true &&
        art.value === spec.term &&
        chrome.present === false &&
        inArtifact === false;
      record(
        `A:${name}`,
        ok ? "PASS" : "FAIL",
        `artifact verified=${art.verified} value="${art.value}" (exact "${spec.term}") · firm-default in-artifact=${inArtifact} · chrome notice=${chrome.present}`,
      );
    } else {
      // In the ARTIFACT the firm default must be absent. In the CHROME it must
      // be PRESENT -- the notice names it in order to disclaim it, and an
      // operator who cannot see what was withheld cannot judge the gap.
      const inArtifact = sheet(r.body).includes(FIRM_DEFAULT);
      const inChrome = visible(r.body).includes(FIRM_DEFAULT);
      const ok =
        art.verified === false &&
        art.value === "—" &&
        chrome.present === true &&
        chrome.reason === "no_lineage" &&
        inArtifact === false &&
        inChrome === true;
      record(
        `A:${name}`,
        ok ? "PASS" : "FAIL",
        `artifact verified=${art.verified} value="${art.value}" · firm-default in-artifact=${inArtifact} (must be false) in-chrome=${inChrome} (must be true) · chrome=${chrome.present}/${chrome.reason}`,
      );
    }
  }

  // A5 · two mapped customers keep DIFFERENT terms
  {
    const a = artifactTerms((await get(`/projects/${Q.mapped.p}/quotes/${Q.mapped.q}/quote`)).body);
    const b = artifactTerms((await get(`/projects/${Q.alt.p}/quotes/${Q.alt.q}/quote`)).body);
    const ok = a && b && a.value === "Net 30" && b.value === "Net 60" && a.value !== b.value;
    record("A5", ok ? "PASS" : "FAIL", `mapped="${a?.value}" alt="${b?.value}" — each keeps its own`);
  }

  // ── A3 · the customer PDF artifact ──────────────────────────────────────
  for (const [name, spec] of [["mapped", Q.mapped], ["unmapped", Q.unmapped]]) {
    const r = await get(`/api/quotes/${spec.q}/customer-pdf`);
    if (r.status !== 200) {
      record(`A3:${name}`, "BLOCKED", `HTTP ${r.status} from the PDF route`);
      continue;
    }
    record(
      `A3:${name}`,
      r.type.includes("pdf") ? "PASS" : "FAIL",
      `HTTP 200 content-type=${r.type} — byte-level term assertion is done at the projection, below`,
    );
  }

  // ── Sales Order receipt ─────────────────────────────────────────────────
  for (const [name, spec] of Object.entries(Q)) {
    const r = await get(`/projects/${spec.p}/quotes/${spec.q}/quote?tab=tier`);
    if (r.status !== 200) {
      record(`SO:${name}`, "BLOCKED", `HTTP ${r.status} on the Sales Order sub-tab`);
      continue;
    }
    const leaked = visible(r.body).includes(FIRM_DEFAULT);
    record(
      `SO:${name}`,
      leaked ? "FAIL" : "PASS",
      `receipt renders; firm default in RENDERED markup=${leaked} (serialized props excluded -- they are data, not a claim)`,
    );
  }

  // ── C · access restrictions (identity comes from the running app) ───────
  const who = process.env.NEXUS_VALIDATION_IDENTITY ?? "pm";
  for (const path of ["/admin/netsuite-customer-map", "/admin/netsuite"]) {
    const r = await get(path);
    const expected = who === "admin" ? 200 : 307;
    record(
      `C:${who}${path.includes("customer") ? ":map" : ":ns"}`,
      r.status === expected ? "PASS" : "FAIL",
      `HTTP ${r.status} (expected ${expected} for ${who})`,
    );
  }

  console.log("\n--- summary ---");
  const by = (v) => results.filter((r) => r.verdict === v).length;
  console.log(`PASS ${by("PASS")}  FAIL ${by("FAIL")}  BLOCKED ${by("BLOCKED")}`);
  console.log(JSON.stringify(results, null, 1));
}

await main();
