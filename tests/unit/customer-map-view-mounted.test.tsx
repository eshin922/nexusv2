// MOUNTED tests for the customer-mapping surface.
//
// These exist because pure-rule tests could not have caught the defect that
// prompted them. `runSearch` minted its ticket inside a `setSession` updater
// and read the variable back on the next line; React does not run updaters
// synchronously, so the ticket was null, the handler returned early, and
// clicking Search issued NO REQUEST. Sixteen session tests passed throughout —
// the rules were never reached.
//
// So the first assertion below is the crudest one available, and the one that
// mattered: pressing the button calls the service.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { deferred, flush, mount } from "../support/mount.tsx";
import {
  CustomerMapView,
  type CustomerMappingRowView,
  type SaveService,
  type SearchService,
} from "../../src/app/admin/netsuite-customer-map/customer-map-view.tsx";

const ROWS: CustomerMappingRowView[] = [
  {
    hubspotCompanyId: "company-A",
    hubspotCompanyName: "Acme",
    netsuiteCustomerId: null,
    netsuiteCustomerDisplayName: null,
    verifiedAt: null,
    latestDealName: "Acme reorder",
  },
  {
    hubspotCompanyId: "company-B",
    hubspotCompanyName: "Beta",
    netsuiteCustomerId: null,
    netsuiteCustomerDisplayName: null,
    verifiedAt: null,
    latestDealName: null,
  },
];

const candidate = (id: string) => ({
  netsuiteCustomerId: id,
  entityId: `E-${id}`,
  companyName: `Customer ${id}`,
  inactive: false,
});

function okSearch(ids: string[]): SearchService {
  return async () => ({
    ok: true,
    data: { state: "ok", candidates: ids.map(candidate) },
  });
}

const okSave: SaveService = async () => ({
  ok: true,
  data: { created: true, displayName: "Customer X", terms: "Net 90" },
});

function view(over: {
  search?: SearchService;
  save?: SaveService;
  refresh?: () => void;
}) {
  return (
    <CustomerMapView
      rows={ROWS}
      search={over.search ?? okSearch(["ns-1"])}
      save={over.save ?? okSave}
      refresh={over.refresh ?? (() => {})}
    />
  );
}

// ── the regression: the button must actually do something ──────────────────

test("clicking Search issues exactly one request", async () => {
  const calls: string[] = [];
  const search: SearchService = async (q) => {
    calls.push(q);
    return { ok: true, data: { state: "ok", candidates: [candidate("ns-1")] } };
  };
  const m = await mount(view({ search }));
  await m.click('[data-testid="open-company-A"]');
  await m.click('[data-testid="customer-search-run"]');
  await flush();

  assert.deepEqual(calls, ["Acme"], "the search service must be called once");
  assert.ok(m.byTestId("customer-candidate"), "and its results must render");
  await m.unmount();
});

test("Enter in the query field issues a request too", async () => {
  let calls = 0;
  const search: SearchService = async () => {
    calls++;
    return { ok: true, data: { state: "ok", candidates: [] } };
  };
  const m = await mount(view({ search }));
  await m.click('[data-testid="open-company-A"]');
  const input = m.byTestId("customer-search-input") as HTMLInputElement;
  await (async () => {
    const { act } = await import("react");
    await act(async () => {
      input.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
  })();
  await flush();
  assert.equal(calls, 1);
  await m.unmount();
});

test("a typed query is the one that gets searched", async () => {
  const calls: string[] = [];
  const search: SearchService = async (q) => {
    calls.push(q);
    return { ok: true, data: { state: "ok", candidates: [] } };
  };
  const m = await mount(view({ search }));
  await m.click('[data-testid="open-company-A"]');
  await m.type('[data-testid="customer-search-input"]', "Squatch Co");
  await m.click('[data-testid="customer-search-run"]');
  await flush();
  assert.deepEqual(calls, ["Squatch Co"]);
  await m.unmount();
});

// ── stale work is invalidated ──────────────────────────────────────────────

test("switching companies mid-search discards the first response", async () => {
  const gate = deferred<{ ok: true; data: { state: "ok"; candidates: ReturnType<typeof candidate>[] } }>();
  let n = 0;
  const search: SearchService = async () => {
    n++;
    if (n === 1) return gate.promise;
    return { ok: true, data: { state: "ok", candidates: [candidate("ns-B")] } };
  };
  const m = await mount(view({ search }));

  await m.click('[data-testid="open-company-A"]');
  await m.click('[data-testid="customer-search-run"]');   // A, in flight
  await m.click('[data-testid="open-company-B"]');        // admin moves on

  gate.resolve({ ok: true, data: { state: "ok", candidates: [candidate("ns-A")] } });
  await flush();

  assert.equal(
    m.byTestId("customer-map-panel")?.getAttribute("data-company"),
    "company-B",
  );
  assert.equal(
    m.find('[data-customer="ns-A"]'),
    null,
    "A's candidate must never render under B",
  );
  await m.unmount();
});

test("A → close → reopen A discards the first response", async () => {
  // The case a company check alone cannot catch: same company, different
  // panel session. This is why an epoch exists.
  const gate = deferred<{ ok: true; data: { state: "ok"; candidates: ReturnType<typeof candidate>[] } }>();
  let n = 0;
  const search: SearchService = async () => {
    n++;
    if (n === 1) return gate.promise;
    return { ok: true, data: { state: "ok", candidates: [candidate("ns-fresh")] } };
  };
  const m = await mount(view({ search }));

  await m.click('[data-testid="open-company-A"]');
  await m.click('[data-testid="customer-search-run"]');   // in flight
  await m.click('[data-testid="customer-search-cancel"]'); // close
  await m.click('[data-testid="open-company-A"]');         // reopen SAME company

  gate.resolve({ ok: true, data: { state: "ok", candidates: [candidate("ns-stale")] } });
  await flush();

  assert.equal(
    m.find('[data-customer="ns-stale"]'),
    null,
    "the previous session's response must not surface in the reopened panel",
  );
  await m.unmount();
});

test("a superseded search of the same company loses to the newer one", async () => {
  const first = deferred<{ ok: true; data: { state: "ok"; candidates: ReturnType<typeof candidate>[] } }>();
  let n = 0;
  const search: SearchService = async () => {
    n++;
    if (n === 1) return first.promise;
    return { ok: true, data: { state: "ok", candidates: [candidate("ns-fresh")] } };
  };
  const m = await mount(view({ search }));
  await m.click('[data-testid="open-company-A"]');
  await m.click('[data-testid="customer-search-run"]');
  await m.click('[data-testid="customer-search-run"]'); // supersedes
  await flush();

  first.resolve({ ok: true, data: { state: "ok", candidates: [candidate("ns-stale")] } });
  await flush();

  assert.ok(m.find('[data-customer="ns-fresh"]'));
  assert.equal(m.find('[data-customer="ns-stale"]'), null);
  await m.unmount();
});

// ── save results belong to the panel that started them ─────────────────────

test("save A → open B → A resolves: B can still search AND save", async () => {
  // "B remains open" is not enough. The stale completion used to advance
  // `epochRef` unconditionally, while `saveSucceeded` correctly refused to
  // touch B's state — so the ref outran `panelEpoch` and every ticket B minted
  // afterwards could never match. B looked fine and was inert.
  const aSave = deferred<{
    ok: true;
    data: { created: boolean; displayName: string | null; terms: string | null };
  }>();
  const saved: string[] = [];
  const save: SaveService = async (input) => {
    saved.push(input.hubspotCompanyId);
    if (input.hubspotCompanyId === "company-A") return aSave.promise;
    return {
      ok: true,
      data: { created: true, displayName: "Customer B", terms: "Net 30" },
    };
  };
  let refreshed = 0;
  const m = await mount(
    view({ search: okSearch(["ns-1"]), save, refresh: () => refreshed++ }),
  );

  await m.click('[data-testid="open-company-A"]');
  await m.click('[data-testid="customer-search-run"]');
  await flush();
  await m.click('[data-testid="choose-ns-1"]');   // A save in flight
  await m.click('[data-testid="open-company-B"]'); // admin moves on

  aSave.resolve({
    ok: true,
    data: { created: true, displayName: "Customer A", terms: "Net 90" },
  });
  await flush();

  const panel = m.byTestId("customer-map-panel");
  assert.ok(panel, "B's panel must still be open");
  assert.equal(panel?.getAttribute("data-company"), "company-B");

  // B must still WORK, not merely still be there.
  await m.click('[data-testid="customer-search-run"]');
  await flush();
  assert.ok(
    m.byTestId("customer-candidate"),
    "B's search must still return results after A's stale success",
  );

  await m.click('[data-testid="choose-ns-1"]');
  await flush();
  assert.ok(saved.includes("company-B"), "B's save must be issued");
  assert.equal(m.byTestId("customer-map-panel"), null, "and must close B on success");
  assert.match(m.byTestId("customer-map-notice")?.textContent ?? "", /Beta mapped to/);
  // TWO refreshes, and both are correct: A's mapping really was written, so
  // the table must show it. Panel ownership governs the PANEL, not whether a
  // genuine success reaches the row list. The notice names its company for the
  // same reason -- the admin may be looking at another one by then.
  assert.equal(refreshed, 2);
  await m.unmount();
});

test("A resolves while B's own search is ALREADY pending", async () => {
  // The harder ordering: B has work in flight when A's stale completion lands,
  // so a counter that moved would invalidate a request B had already sent.
  const aSave = deferred<{
    ok: true;
    data: { created: boolean; displayName: string | null; terms: string | null };
  }>();
  const bSearch = deferred<{
    ok: true;
    data: { state: "ok"; candidates: ReturnType<typeof candidate>[] };
  }>();
  let searches = 0;
  const search: SearchService = async () => {
    searches++;
    if (searches === 1) {
      return { ok: true, data: { state: "ok", candidates: [candidate("ns-1")] } };
    }
    return bSearch.promise;
  };
  const saved: string[] = [];
  const save: SaveService = async (input) => {
    saved.push(input.hubspotCompanyId);
    if (input.hubspotCompanyId === "company-A") return aSave.promise;
    return {
      ok: true,
      data: { created: true, displayName: "Customer B", terms: "Net 30" },
    };
  };
  const m = await mount(view({ search, save }));

  await m.click('[data-testid="open-company-A"]');
  await m.click('[data-testid="customer-search-run"]');
  await flush();
  await m.click('[data-testid="choose-ns-1"]');    // A save in flight
  await m.click('[data-testid="open-company-B"]');
  await m.click('[data-testid="customer-search-run"]'); // B search in flight

  // A's stale success lands in the middle of B's outstanding work.
  aSave.resolve({
    ok: true,
    data: { created: true, displayName: "Customer A", terms: "Net 90" },
  });
  await flush();

  bSearch.resolve({
    ok: true,
    data: { state: "ok", candidates: [candidate("ns-2")] },
  });
  await flush();

  assert.ok(
    m.find('[data-customer="ns-2"]'),
    "B's in-flight search must survive A's stale completion",
  );

  await m.click('[data-testid="choose-ns-2"]');
  await flush();
  assert.ok(saved.includes("company-B"), "and B must still be able to save");
  assert.equal(m.byTestId("customer-map-panel"), null);
  await m.unmount();
});

test("save A fails → open B → A resolves: B shows no error and still works", async () => {
  const gate = deferred<{ ok: false; error: { code: string; message: string } }>();
  const saved: string[] = [];
  const save: SaveService = async (input) => {
    saved.push(input.hubspotCompanyId);
    if (input.hubspotCompanyId === "company-A") return gate.promise;
    return {
      ok: true,
      data: { created: true, displayName: "Customer B", terms: "Net 30" },
    };
  };
  const m = await mount(view({ search: okSearch(["ns-1"]), save }));

  await m.click('[data-testid="open-company-A"]');
  await m.click('[data-testid="customer-search-run"]');
  await flush();
  await m.click('[data-testid="choose-ns-1"]');
  await m.click('[data-testid="open-company-B"]');

  gate.resolve({ ok: false, error: { code: "VALIDATION", message: "A failed" } });
  await flush();

  assert.equal(
    m.byTestId("customer-map-save-error"),
    null,
    "A's failure must not appear on B's panel",
  );

  await m.click('[data-testid="customer-search-run"]');
  await flush();
  await m.click('[data-testid="choose-ns-1"]');
  await flush();
  assert.ok(saved.includes("company-B"), "B must still be able to save");
  await m.unmount();
});

// ── a failure is visible, and retryable ────────────────────────────────────

test("a failed save shows the reason inside the panel", async () => {
  const save: SaveService = async () => ({
    ok: false,
    error: { code: "VALIDATION", message: "NetSuite could not be reached." },
  });
  const m = await mount(view({ search: okSearch(["ns-1"]), save }));
  await m.click('[data-testid="open-company-A"]');
  await m.click('[data-testid="customer-search-run"]');
  await flush();
  await m.click('[data-testid="choose-ns-1"]');
  await flush();

  const panel = m.byTestId("customer-map-panel");
  assert.ok(panel, "the panel must stay open");
  const err = m.byTestId("customer-map-save-error");
  assert.ok(err, "the failure must be rendered");
  assert.match(err!.textContent ?? "", /could not be reached/);
  assert.ok(
    panel!.contains(err!),
    "and rendered INSIDE the panel, where the click happened",
  );
  await m.unmount();
});

test("retry after a failed save issues another request and can succeed", async () => {
  let attempts = 0;
  const save: SaveService = async () => {
    attempts++;
    if (attempts === 1) {
      return { ok: false, error: { code: "VALIDATION", message: "transient" } };
    }
    return { ok: true, data: { created: true, displayName: "Customer X", terms: "Net 90" } };
  };
  let refreshed = 0;
  const m = await mount(
    view({ search: okSearch(["ns-1"]), save, refresh: () => refreshed++ }),
  );

  await m.click('[data-testid="open-company-A"]');
  await m.click('[data-testid="customer-search-run"]');
  await flush();
  await m.click('[data-testid="choose-ns-1"]');
  await flush();
  assert.equal(attempts, 1);
  assert.ok(m.byTestId("customer-map-save-error"));

  // the candidate is still on screen — that IS the retry affordance
  await m.click('[data-testid="choose-ns-1"]');
  await flush();

  assert.equal(attempts, 2, "retry must issue a second request");
  assert.equal(m.byTestId("customer-map-panel"), null, "success closes the panel");
  assert.equal(m.byTestId("customer-map-save-error"), null, "and clears the error");
  assert.equal(refreshed, 1);
  assert.match(m.byTestId("customer-map-notice")?.textContent ?? "", /Acme mapped to/);
  await m.unmount();
});

// ── the two search outcomes stay distinguishable on screen ─────────────────

test("an unavailable search does not read as an empty one", async () => {
  const search: SearchService = async () => ({
    ok: true,
    data: { state: "unavailable", detail: "connection reset" },
  });
  const m = await mount(view({ search }));
  await m.click('[data-testid="open-company-A"]');
  await m.click('[data-testid="customer-search-run"]');
  await flush();

  assert.ok(m.byTestId("customer-search-unavailable"));
  assert.equal(m.byTestId("customer-search-empty"), null);
  assert.match(m.text(), /does not\s+mean the customer is absent/);
  await m.unmount();
});

test("an empty result says the search ran", async () => {
  const m = await mount(view({ search: okSearch([]) }));
  await m.click('[data-testid="open-company-A"]');
  await m.click('[data-testid="customer-search-run"]');
  await flush();
  assert.ok(m.byTestId("customer-search-empty"));
  assert.equal(m.byTestId("customer-search-unavailable"), null);
  await m.unmount();
});

test("ambiguity is shown, and nothing is auto-selected", async () => {
  let saved = 0;
  const save: SaveService = async () => {
    saved++;
    return { ok: true, data: { created: true, displayName: "X", terms: "Net 30" } };
  };
  const m = await mount(view({ search: okSearch(["ns-1", "ns-2"]), save }));
  await m.click('[data-testid="open-company-A"]');
  await m.click('[data-testid="customer-search-run"]');
  await flush();

  assert.equal(m.findAll('[data-testid="customer-candidate"]').length, 2);
  assert.match(m.text(), /2 customers match/);
  assert.equal(saved, 0, "no save may happen without an explicit choice");
  await m.unmount();
});
