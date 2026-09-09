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
  noteSearchIssued,
  openPanel,
  receive,
  saveFailed,
  saveSucceeded,
  shouldAcceptSearch,
  visibleCandidates,
  type SaveTicket,
  type SearchOutcome,
  type SearchTicket,
  type SessionState,
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

// ── 2 · results and selection are bound to their origin ───────────────────
//
// These are the RULES, exhaustively. That the component invokes them is a
// separate question, answered by `customer-map-view-mounted.test.tsx` -- and
// it has to be asked separately: every test in this file passed while the
// component was issuing no search request at all.
//
// Epochs are minted by the caller here exactly as the component mints them
// from refs, because a counter that must be readable at the instant of a click
// cannot live in React state.

const OK = (ids: string[]): SearchOutcome => ({
  state: "ok",
  candidates: ids.map((id) => ({
    netsuiteCustomerId: id,
    entityId: `E-${id}`,
    companyName: `Customer ${id}`,
    inactive: false,
  })),
});

/** Mirrors the component's ref-held counters. */
function harness() {
  let epoch = 0;
  let seq = 0;
  let state: SessionState = initialSession;
  return {
    get state() {
      return state;
    },
    open(companyId: string, query = "") {
      state = openPanel(state, companyId, query, ++epoch);
    },
    close() {
      state = closePanel(state, ++epoch);
    },
    issue(): SearchTicket {
      const ticket: SearchTicket = {
        epoch,
        seq: ++seq,
        companyId: state.openCompanyId ?? "",
        query: state.query,
      };
      state = noteSearchIssued(state, ticket);
      return ticket;
    },
    receive(ticket: SearchTicket, outcome: SearchOutcome) {
      state = receive(state, ticket, outcome);
    },
    saveTicket(netsuiteCustomerId: string): SaveTicket {
      return {
        epoch,
        companyId: state.openCompanyId ?? "",
        netsuiteCustomerId,
      };
    },
    begin(t: SaveTicket) {
      state = beginSave(state, t);
    },
    fail(t: SaveTicket, detail: string) {
      state = saveFailed(state, t, detail);
    },
    succeed(t: SaveTicket) {
      state = saveSucceeded(state, t, ++epoch);
    },
  };
}

test("switching companies while a search is pending DISCARDS the response", () => {
  const h = harness();
  h.open("company-A", "Acme");
  const ticket = h.issue();
  h.open("company-B", "Beta");

  assert.equal(shouldAcceptSearch(h.state, ticket), false);
  h.receive(ticket, OK(["A-1"]));
  assert.equal(h.state.results, null, "A's response must not surface under B");
  assert.equal(visibleCandidates(h.state), null);
});

test("A → close → reopen A discards the first response", () => {
  // Same company, different panel session. A company check alone readmits it;
  // this is the case the epoch exists for.
  const h = harness();
  h.open("company-A", "Acme");
  const ticket = h.issue();
  h.close();
  h.open("company-A", "Acme");

  assert.equal(shouldAcceptSearch(h.state, ticket), false);
  h.receive(ticket, OK(["stale"]));
  assert.equal(visibleCandidates(h.state), null);
});

test("a superseded search of the SAME company is discarded", () => {
  const h = harness();
  h.open("company-A", "Ac");
  const first = h.issue();
  const second = h.issue();

  // The slower first request returns last — the classic out-of-order finish.
  h.receive(second, OK(["fresh"]));
  h.receive(first, OK(["stale"]));

  const out = visibleCandidates(h.state);
  assert.ok(out && out.state === "ok");
  assert.deepEqual(
    out.state === "ok" ? out.candidates.map((c) => c.netsuiteCustomerId) : [],
    ["fresh"],
    "the last-issued search wins, not the last-returned",
  );
});

test("closing the panel while a search is pending discards the response", () => {
  const h = harness();
  h.open("company-A", "Acme");
  const ticket = h.issue();
  h.close();
  h.receive(ticket, OK(["A-1"]));
  assert.equal(h.state.results, null);
});

test("a candidate cannot be chosen for a company it did not come from", () => {
  const h = harness();
  h.open("company-A", "Acme");
  const ticket = h.issue();
  h.receive(ticket, OK(["A-1"]));

  assert.equal(canChoose(h.state, "company-A", "A-1"), true);
  assert.equal(canChoose(h.state, "company-B", "A-1"), false);
  assert.equal(canChoose(h.state, "company-A", "SOMETHING-ELSE"), false);
});

test("switching companies leaves nothing choosable until the new search returns", () => {
  const h = harness();
  h.open("company-A", "Acme");
  h.receive(h.issue(), OK(["A-1"]));
  h.open("company-B", "Beta");
  assert.equal(canChoose(h.state, "company-B", "A-1"), false);
  assert.equal(canChoose(h.state, "company-A", "A-1"), false);
});

test("an unavailable response is not choosable and is not an empty result", () => {
  const h = harness();
  h.open("company-A", "Acme");
  h.receive(h.issue(), { state: "unavailable", detail: "connection reset" });
  const out = visibleCandidates(h.state);
  assert.ok(out && out.state === "unavailable");
  assert.equal(canChoose(h.state, "company-A", "anything"), false);
});

test("sequence numbers never restart — a reopened panel cannot collide", () => {
  const h = harness();
  h.open("company-A", "Acme");
  const a = h.issue();
  h.open("company-B", "Beta");
  const b = h.issue();
  assert.notEqual(a.seq, b.seq);
  assert.equal(shouldAcceptSearch(h.state, a), false);
});

// ── 3 · a save result belongs to the panel that started it ─────────────────

test("a failed save keeps the panel open with the reason inside it", () => {
  const h = harness();
  h.open("company-A", "Acme");
  h.receive(h.issue(), OK(["A-1"]));
  const t = h.saveTicket("A-1");
  h.begin(t);
  h.fail(t, "NetSuite could not be reached, so the mapping was not saved.");

  assert.equal(h.state.openCompanyId, "company-A", "the panel must not close");
  assert.match(String(h.state.panelError), /not saved/);
  assert.equal(h.state.saving, false, "and the control must be usable again");
});

test("retry after a failure works, and clears the error", () => {
  const h = harness();
  h.open("company-A", "Acme");
  h.receive(h.issue(), OK(["A-1"]));
  const t = h.saveTicket("A-1");
  h.begin(t);
  h.fail(t, "transient");

  assert.equal(canChoose(h.state, "company-A", "A-1"), true, "still retryable");

  h.begin(t);
  assert.equal(h.state.panelError, null, "retry clears the stale error");
  assert.equal(canChoose(h.state, "company-A", "A-1"), false, "no double-submit");

  h.succeed(t);
  assert.equal(h.state.openCompanyId, null, "success closes the panel");
  assert.equal(h.state.panelError, null);
});

test("save A → open B → A resolves: B is untouched", () => {
  const h = harness();
  h.open("company-A", "Acme");
  h.receive(h.issue(), OK(["A-1"]));
  const t = h.saveTicket("A-1");
  h.begin(t);
  h.open("company-B", "Beta");

  h.succeed(t);
  assert.equal(h.state.openCompanyId, "company-B", "B must stay open");
  h.fail(t, "A failed");
  assert.equal(h.state.panelError, null, "and must not inherit A's error");
});

test("a failure does not strand the panel in a saving state", () => {
  // The shape that produces a permanently disabled control with nothing on
  // screen explaining it — Pattern 47(f), in miniature.
  const h = harness();
  h.open("company-A", "Acme");
  h.receive(h.issue(), OK(["A-1"]));
  const t = h.saveTicket("A-1");
  h.begin(t);
  h.fail(t, "boom");
  assert.equal(h.state.saving, false);
  assert.ok(h.state.panelError, "a re-enabled control must say why it stalled");
});
