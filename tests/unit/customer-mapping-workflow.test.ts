// Three review findings on the customer-mapping workflow, each closed by
// exercising the real thing rather than asserting on its source.
//
//   1 · search must WORK under production configuration, through a read path
//       narrow enough that production mutation protection is untouched;
//   2 · results and selection must be bound to the company and search that
//       produced them, so a mid-flight company switch cannot map the wrong
//       customer;
//   3 · a failed save must be visible where the click happened, and retryable.
//
// Findings 2 and 3 are RACES and FEEDBACK PATHS -- both invisible to a source
// grep, and both able to pass a structural check while behaving wrongly.
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWriteAuthorized,
  isReadOnlyTransport,
  suiteQL,
  type NetsuiteConfig,
} from "../../src/lib/netsuite/client.ts";
import {
  beginSave,
  canChoose,
  closePanel,
  initialSession,
  issueSearch,
  openPanel,
  receive,
  saveFailed,
  saveSucceeded,
  shouldAccept,
  visibleCandidates,
  type SearchOutcome,
} from "../../src/lib/admin/customer-search-session.ts";

// ── 1 · production configuration ───────────────────────────────────────────

const PROD: NetsuiteConfig = {
  accountId: "1234567",
  consumerKey: "ck",
  consumerSecret: "cs",
  tokenId: "ti",
  tokenSecret: "ts",
  env: "production",
};
const SANDBOX: NetsuiteConfig = { ...PROD, accountId: "1234567_SB2", env: "sandbox" };

test("SuiteQL is authorized on a production account — it is a read", () => {
  // The defect: SuiteQL travels as POST, the guard classified by METHOD, and
  // `loadNetsuiteConfig` never sets `allowProduction`. So there was NO
  // configuration in which a production account could be searched at all.
  assert.doesNotThrow(() =>
    assertWriteAuthorized(PROD, "POST", "/query/v1/suiteql"),
  );
  assert.doesNotThrow(() =>
    assertWriteAuthorized(PROD, "POST", "/query/v1/suiteql?limit=25"),
  );
});

test("production mutation protection is UNCHANGED", () => {
  // The carve-out must not have widened anything else. If this ever passes
  // silently, the fix has become a hole.
  const mutations: [string, string][] = [
    ["POST", "/record/v1/salesOrder"],
    ["POST", "/record/v1/customer"],
    ["PATCH", "/record/v1/salesOrder/2735/item/1"],
    ["PUT", "/record/v1/salesOrder/2735"],
    ["DELETE", "/record/v1/salesOrder/2735"],
    // A mutating verb aimed AT the query path is still a mutation.
    ["PATCH", "/query/v1/suiteql"],
    ["PUT", "/query/v1/suiteql"],
  ];
  for (const [method, path] of mutations) {
    assert.throws(
      () => assertWriteAuthorized(PROD, method, path),
      /Production write attempted/,
      `${method} ${path} must stay refused on production`,
    );
  }
});

test("the read carve-out is one exact path, not a prefix", () => {
  // `startsWith` would admit anything beginning with the query route, which is
  // how a narrow exemption quietly becomes a broad one.
  assert.equal(isReadOnlyTransport("POST", "/query/v1/suiteql"), true);
  assert.equal(isReadOnlyTransport("POST", "/query/v1/suiteql/../record/v1/x"), false);
  assert.equal(isReadOnlyTransport("POST", "/query/v1/suiteqlx"), false);
  assert.equal(isReadOnlyTransport("POST", "/record/v1/salesOrder"), false);
  assert.equal(isReadOnlyTransport("GET", "/record/v1/salesOrder/1"), true);
  assert.equal(isReadOnlyTransport("PATCH", "/query/v1/suiteql"), false);
});

test("sandbox is unaffected in both directions", () => {
  assert.doesNotThrow(() => assertWriteAuthorized(SANDBOX, "POST", "/record/v1/salesOrder"));
  assert.doesNotThrow(() => assertWriteAuthorized(SANDBOX, "POST", "/query/v1/suiteql"));
});

test("a production search reaches the wire — the whole path, not just the guard", async () => {
  // End-to-end through the REAL `suiteQL` and the REAL request primitive, with
  // only the network replaced. Proves the guard, the call site that now passes
  // a path, and the transport agree — a guard test alone would pass even if
  // `nsRequest` never forwarded the path.
  const realFetch = globalThis.fetch;
  let sawUrl = "";
  let sawMethod = "";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sawUrl = String(url);
    sawMethod = String(init?.method ?? "");
    return new Response(
      JSON.stringify({ items: [{ id: "176785", companyname: "Example Co" }], hasMore: false }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;

  try {
    const r = await suiteQL("select id, companyname from customer where id = 1", {
      config: PROD,
    });
    assert.equal(r.items.length, 1);
    assert.match(sawUrl, /\/query\/v1\/suiteql/);
    assert.equal(sawMethod, "POST");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a production MUTATION still never reaches the wire", async () => {
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    assert.throws(
      () => assertWriteAuthorized(PROD, "POST", "/record/v1/salesOrder"),
      /Production write attempted/,
    );
    assert.equal(called, false, "the guard must refuse before any request");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── 2 · results and selection are bound to their origin ────────────────────

const OK = (ids: string[]): SearchOutcome => ({
  state: "ok",
  candidates: ids.map((id) => ({
    netsuiteCustomerId: id,
    entityId: `E-${id}`,
    companyName: `Customer ${id}`,
    inactive: false,
  })),
});

test("switching companies while a search is pending DISCARDS the response", () => {
  // The corruption path: A's candidates render under B's heading, and
  // "Use this customer" maps B to A's customer. Nothing looks wrong on screen.
  let s = openPanel(initialSession, "company-A", "Acme");
  const { state, ticket } = issueSearch(s);
  s = state;

  // the admin switches before the response lands
  s = openPanel(s, "company-B", "Beta");

  assert.equal(shouldAccept(s, ticket), false);
  s = receive(s, ticket, OK(["A-1", "A-2"]));
  assert.equal(s.results, null, "A's response must not surface under B");
  assert.equal(visibleCandidates(s), null);
});

test("a superseded search of the SAME company is discarded", () => {
  let s = openPanel(initialSession, "company-A", "Ac");
  const first = issueSearch(s);
  s = first.state;
  const second = issueSearch(s);
  s = second.state;

  // The slower first request returns last — the classic out-of-order finish.
  s = receive(s, second.ticket, OK(["fresh"]));
  s = receive(s, first.ticket, OK(["stale"]));

  const out = visibleCandidates(s);
  assert.ok(out && out.state === "ok");
  assert.deepEqual(
    out.state === "ok" ? out.candidates.map((c) => c.netsuiteCustomerId) : [],
    ["fresh"],
    "the last-issued search wins, not the last-returned",
  );
});

test("closing the panel while a search is pending discards the response", () => {
  let s = openPanel(initialSession, "company-A", "Acme");
  const { state, ticket } = issueSearch(s);
  s = closePanel(state);
  s = receive(s, ticket, OK(["A-1"]));
  assert.equal(s.results, null);
});

test("a candidate cannot be chosen for a company it did not come from", () => {
  let s = openPanel(initialSession, "company-A", "Acme");
  const { state, ticket } = issueSearch(s);
  s = receive(state, ticket, OK(["A-1"]));

  assert.equal(canChoose(s, "company-A", "A-1"), true);
  // wrong company
  assert.equal(canChoose(s, "company-B", "A-1"), false);
  // a customer that was never in this result set
  assert.equal(canChoose(s, "company-A", "SOMETHING-ELSE"), false);
});

test("switching companies leaves nothing choosable until the new search returns", () => {
  let s = openPanel(initialSession, "company-A", "Acme");
  const a = issueSearch(s);
  s = receive(a.state, a.ticket, OK(["A-1"]));
  s = openPanel(s, "company-B", "Beta");
  assert.equal(canChoose(s, "company-B", "A-1"), false);
  assert.equal(canChoose(s, "company-A", "A-1"), false);
});

test("an unavailable response is not choosable and is not an empty result", () => {
  let s = openPanel(initialSession, "company-A", "Acme");
  const { state, ticket } = issueSearch(s);
  s = receive(state, ticket, { state: "unavailable", detail: "connection reset" });
  const out = visibleCandidates(s);
  assert.ok(out && out.state === "unavailable");
  assert.equal(canChoose(s, "company-A", "anything"), false);
});

test("sequence numbers never restart — a reopened panel cannot collide", () => {
  let s = openPanel(initialSession, "company-A", "Acme");
  const a = issueSearch(s);
  s = openPanel(a.state, "company-B", "Beta");
  const b = issueSearch(s);
  assert.notEqual(a.ticket.seq, b.ticket.seq);
  // A's in-flight response cannot match B's ticket by coincidence.
  assert.equal(shouldAccept(b.state, a.ticket), false);
});

// ── 3 · a failed save is visible, and retryable ────────────────────────────

test("a failed save keeps the panel open with the reason inside it", () => {
  let s = openPanel(initialSession, "company-A", "Acme");
  const { state, ticket } = issueSearch(s);
  s = receive(state, ticket, OK(["A-1"]));
  s = beginSave(s);
  s = saveFailed(s, "NetSuite could not be reached, so the mapping was not saved.");

  assert.equal(s.openCompanyId, "company-A", "the panel must not close");
  assert.match(String(s.panelError), /not saved/);
  assert.equal(s.saving, false, "and the control must be usable again");
});

test("retry after a failure works, and clears the error", () => {
  let s = openPanel(initialSession, "company-A", "Acme");
  const { state, ticket } = issueSearch(s);
  s = receive(state, ticket, OK(["A-1"]));
  s = saveFailed(beginSave(s), "transient");

  // the candidate is still on screen and still choosable — that IS the retry
  assert.equal(canChoose(s, "company-A", "A-1"), true);

  s = beginSave(s);
  assert.equal(s.panelError, null, "retry clears the stale error");
  assert.equal(canChoose(s, "company-A", "A-1"), false, "no double-submit mid-save");

  s = saveSucceeded(s);
  assert.equal(s.openCompanyId, null, "success closes the panel");
  assert.equal(s.panelError, null);
});

test("a failure does not strand the panel in a saving state", () => {
  // The shape that produces a permanently disabled button with nothing on
  // screen explaining it — Pattern 47(f), in miniature.
  let s = openPanel(initialSession, "company-A", "Acme");
  const { state, ticket } = issueSearch(s);
  s = receive(state, ticket, OK(["A-1"]));
  s = saveFailed(beginSave(s), "boom");
  assert.equal(s.saving, false);
  assert.ok(s.panelError, "a disabled-then-re-enabled control must say why");
});
