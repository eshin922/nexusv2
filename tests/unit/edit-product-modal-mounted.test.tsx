// MOUNTED tests for the Edit product surface.
//
// The defect #567 records is that this surface did not exist: `leaves.ts`
// exported create, restore and two reads, so a product created without a SKU
// could never acquire one — while attachment refused it and told the operator
// to "Add a SKU to the product in the Library", naming a mechanism that was
// not there.
//
// These drive the real component with an injected save, because the two
// behaviours that matter most are a REFUSAL staying visible and a RETRY
// working, and neither can be established by looking at the source.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { deferred, flush, mount } from "../support/mount.tsx";
import {
  EditProductModal,
  type EditProductTarget,
  type UpdateProductService,
} from "../../src/components/library/edit-product-modal.tsx";

const TYPES = [
  { label: "Primary Packaging", value: "Primary" },
  { label: "Logistics", value: "Third Party Logistics" },
  { label: "Raw ingredients", value: "Raw ingredients" },
];

const skuLess: EditProductTarget = {
  leafId: "leaf-1",
  name: "MISTR - 4oz Lube Silicone",
  sku: null,
  url: null,
  unitCost: "1.25",
  hubspotProductType: "Raw ingredients",
  hubspotProductId: "99800000001",
  attachedQuoteCount: 0,
  updatedAt: "2026-09-13T10:00:00.000Z",
};

const established: EditProductTarget = {
  ...skuLess,
  leafId: "leaf-2",
  sku: "DPS-MISTR-1001",
  attachedQuoteCount: 3,
};

const ok: UpdateProductService = async () => ({
  ok: true,
  data: { leafId: "leaf-1", syncedToHubspot: true },
});

type ConfirmService = (fd: FormData) => Promise<
  | { ok: true; data: { leafId: string; state: "resolved" | "diverged" } }
  | { ok: false; error: { code: string; message: string } }
>;

function view(over: {
  target?: EditProductTarget;
  save?: UpdateProductService;
  recover?: UpdateProductService;
  confirm?: ConfirmService;
  onSaved?: (id: string) => void;
  onClose?: () => void;
}) {
  return (
    <EditProductModal
      open
      target={over.target ?? skuLess}
      typeOptions={TYPES}
      save={over.save ?? ok}
      recover={over.recover}
      confirm={over.confirm}
      onClose={over.onClose ?? (() => {})}
      onSaved={over.onSaved ?? (() => {})}
    />
  );
}

// ── the missing SKU is completable ─────────────────────────────────────────

test("a SKU-less product offers an editable SKU, and says why it matters", async () => {
  const m = await mount(view({}));
  const input = m.byTestId("edit-sku") as HTMLInputElement;
  assert.ok(input, "the SKU field must be present");
  assert.equal(input.disabled, false, "and editable");
  assert.ok(m.byTestId("edit-sku-missing"), "with the reason it is needed");
  assert.equal(m.byTestId("edit-sku-established"), null);
  await m.unmount();
});

test("completing the SKU submits it without creating a second product", async () => {
  const calls: Record<string, string>[] = [];
  const save: UpdateProductService = async (fd) => {
    calls.push(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])));
    return { ok: true, data: { leafId: "leaf-1", syncedToHubspot: true } };
  };
  const m = await mount(view({ save }));
  await m.type('[data-testid="edit-sku"]', "DPS-MISTR-1002");
  await m.click('[data-testid="edit-product-save"]');
  await flush();

  assert.equal(calls.length, 1);
  // The leaf id travels, which is what makes this an UPDATE. A create would
  // carry no id and mint a second product.
  assert.equal(calls[0].leafId, "leaf-1");
  assert.equal(calls[0].sku, "DPS-MISTR-1002");
  await m.unmount();
});

// ── an established SKU is a different operation ────────────────────────────

test("an established SKU is not editable here, and the surface says why", async () => {
  const m = await mount(view({ target: established }));
  const input = m.byTestId("edit-sku") as HTMLInputElement;
  assert.equal(input.disabled, true);
  assert.equal(input.value, "DPS-MISTR-1001");
  const note = m.byTestId("edit-sku-established");
  assert.ok(note);
  assert.match(note!.textContent ?? "", /separate controlled correction/i);
  assert.equal(m.byTestId("edit-sku-missing"), null);
  await m.unmount();
});

test("an established SKU is submitted unchanged even if the field is tampered with", async () => {
  // Defence in depth. The server refuses a replacement regardless; this
  // asserts the surface does not ask it to.
  const calls: Record<string, string>[] = [];
  const save: UpdateProductService = async (fd) => {
    calls.push(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])));
    return { ok: true, data: { leafId: "leaf-2", syncedToHubspot: true } };
  };
  const m = await mount(view({ target: established, save }));
  await m.click('[data-testid="edit-product-save"]');
  await flush();
  assert.equal(calls[0].sku, "DPS-MISTR-1001");
  await m.unmount();
});

// ── synchronization failure, and retry ─────────────────────────────────────

test("a synchronization failure is VISIBLE and the surface stays open", async () => {
  const save: UpdateProductService = async () => ({
    ok: false,
    error: {
      code: "VALIDATION",
      message: "HubSpot could not be updated, so nothing was changed. Try again.",
    },
  });
  let closed = false;
  const m = await mount(view({ save, onClose: () => (closed = true) }));
  await m.type('[data-testid="edit-sku"]', "DPS-MISTR-1003");
  await m.click('[data-testid="edit-product-save"]');
  await flush();

  const err = m.byTestId("edit-product-error");
  assert.ok(err, "the failure must be rendered");
  assert.match(err!.textContent ?? "", /nothing was changed/);
  assert.equal(closed, false, "and the surface must not close");
  assert.ok(m.byTestId("edit-product-save"), "with the control still present");
  await m.unmount();
});

test("retry after a failure succeeds, in the same session", async () => {
  let attempts = 0;
  const save: UpdateProductService = async () => {
    attempts++;
    if (attempts === 1) {
      return { ok: false, error: { code: "VALIDATION", message: "HubSpot unreachable." } };
    }
    return { ok: true, data: { leafId: "leaf-1", syncedToHubspot: true } };
  };
  let saved: string | null = null;
  let closed = false;
  const m = await mount(
    view({ save, onSaved: (id) => (saved = id), onClose: () => (closed = true) }),
  );
  await m.type('[data-testid="edit-sku"]', "DPS-MISTR-1004");
  await m.click('[data-testid="edit-product-save"]');
  await flush();
  assert.equal(attempts, 1);
  assert.ok(m.byTestId("edit-product-error"));

  await m.click('[data-testid="edit-product-save"]');
  await flush();
  assert.equal(attempts, 2, "retry must issue a second request");
  assert.equal(saved, "leaf-1");
  assert.equal(closed, true, "and success closes the surface");
  await m.unmount();
});

test("the control is busy during a save and usable again after a failure", async () => {
  const gate = deferred<{ ok: false; error: { code: string; message: string } }>();
  const save: UpdateProductService = async () => gate.promise;
  const m = await mount(view({ save }));
  await m.type('[data-testid="edit-sku"]', "DPS-MISTR-1005");
  await m.click('[data-testid="edit-product-save"]');
  await flush();
  const mid = m.byTestId("edit-product-save") as HTMLButtonElement;
  assert.equal(mid.disabled, true, "disabled while in flight");
  assert.match(mid.textContent ?? "", /Saving/);

  gate.resolve({ ok: false, error: { code: "VALIDATION", message: "boom" } });
  await flush();
  const after = m.byTestId("edit-product-save") as HTMLButtonElement;
  assert.equal(after.disabled, false, "and usable again once it fails");
  await m.unmount();
});

// ── scope, and the separation from specifications ──────────────────────────

test("the surface states the scope of the edit, including quotes it will NOT rewrite", async () => {
  const m = await mount(view({ target: established }));
  const text = m.text();
  assert.match(text, /Library master data/);
  assert.match(text, /future attachments/);
  assert.match(text, /3 quotes already reference this product and are not rewritten/);
  await m.unmount();
});

test("specifications are named as a separate surface, not edited here", async () => {
  const m = await mount(view({}));
  assert.match(m.text(), /Specifications are edited separately/);
  // No spec fields on a product-details surface.
  assert.equal(m.byTestId("spec-field"), null);
  await m.unmount();
});

test("classification submits the INTERNAL value, never the label", async () => {
  // Three production options diverge from their labels; a label-keyed write
  // would resolve nothing for the largest categories.
  const calls: Record<string, string>[] = [];
  const save: UpdateProductService = async (fd) => {
    calls.push(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])));
    return { ok: true, data: { leafId: "leaf-1", syncedToHubspot: true } };
  };
  const m = await mount(view({ save }));
  const select = m.byTestId("edit-hs-type") as HTMLSelectElement;
  const logistics = [...select.options].find((o) => o.textContent === "Logistics");
  assert.ok(logistics, "the divergent option must be offered by LABEL");
  assert.equal(logistics!.value, "Third Party Logistics", "and carry the INTERNAL value");
  await m.unmount();
});

test("a product cannot be saved without a name", async () => {
  const m = await mount(view({ target: { ...skuLess, name: "" } }));
  const save = m.byTestId("edit-product-save") as HTMLButtonElement;
  assert.equal(save.disabled, true);
  await m.unmount();
});

test("the edit carries the version it was populated from", async () => {
  // Optimistic concurrency starts here. A form that does not say which version
  // it was written against cannot be refused when the row has moved, and the
  // second operator's save silently overwrites the first's.
  const calls: Record<string, string>[] = [];
  const save: UpdateProductService = async (fd) => {
    calls.push(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])));
    return { ok: true, data: { leafId: "leaf-1", syncedToHubspot: true } };
  };
  const m = await mount(view({ save }));
  await m.click('[data-testid="edit-product-save"]');
  await flush();
  assert.equal(calls[0].expectedUpdatedAt, "2026-09-13T10:00:00.000Z");
  await m.unmount();
});

test("a stale-write refusal is shown, and the operator's edit is not lost", async () => {
  const save: UpdateProductService = async () => ({
    ok: false,
    error: {
      code: "STALE_WRITE",
      message:
        "This product changed while you were editing it. Nothing was saved, because saving would have overwritten that change with the values you loaded before it. Reload the product and re-apply your edit.",
    },
  });
  const m = await mount(view({ save }));
  await m.type('[data-testid="edit-sku"]', "DPS-MISTR-1006");
  await m.click('[data-testid="edit-product-save"]');
  await flush();
  const err = m.byTestId("edit-product-error");
  assert.ok(err);
  assert.match(err!.textContent ?? "", /changed while you were editing/);
  // The typing survives the refusal, so re-applying is a reload away rather
  // than a retype.
  assert.equal((m.byTestId("edit-sku") as HTMLInputElement).value, "DPS-MISTR-1006");
  await m.unmount();
});

// ── an unconfirmed edit is recoverable, and not writable over ─────────────

const unconfirmed: UpdateProductService = async () => ({
  ok: false,
  error: {
    code: "UNCONFIRMED_EDIT",
    message:
      "An earlier edit to this product was never confirmed in HubSpot, so what HubSpot holds is not known to match what Nexus holds. HubSpot currently holds the SKU \"DPS-9\" for this product. Recover that edit before making another.",
  },
});

test("an unconfirmed edit offers recovery instead of another save", async () => {
  // The original defect was a refusal naming a mechanism that did not exist.
  // A refusal that says "recover that edit" with no control to do it is the
  // same defect one layer up.
  const m = await mount(view({ save: unconfirmed, recover: ok }));
  await m.click('[data-testid="edit-product-save"]');
  await flush();

  const err = m.byTestId("edit-product-error");
  assert.match(err!.textContent ?? "", /never confirmed/);
  assert.ok(m.byTestId("edit-product-recover"), "the remedy must be reachable");
  assert.equal(
    (m.byTestId("edit-product-save") as HTMLButtonElement).disabled,
    true,
    "saving over an unconfirmed remote state is the thing being prevented",
  );
  await m.unmount();
});

test("the refusal names the SKU HubSpot already holds", async () => {
  // Local state cannot answer what the catalog issued -- local state is
  // exactly what failed to be written -- so the refusal carries it.
  const m = await mount(view({ save: unconfirmed, recover: ok }));
  await m.click('[data-testid="edit-product-save"]');
  await flush();
  assert.match(m.byTestId("edit-product-error")!.textContent ?? "", /DPS-9/);
  await m.unmount();
});

test("recovery sends the correctable fields and NOT the SKU", async () => {
  // A recorded attempt can be unrecoverable on its own terms, so the operator
  // may amend the correctable fields. The SKU is pinned server-side; the form
  // must not offer one, or a recovery becomes a way to change identity.
  const calls: Record<string, string>[] = [];
  const recover: UpdateProductService = async (fd) => {
    calls.push(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])));
    return { ok: true, data: { leafId: "leaf-1", syncedToHubspot: true } };
  };
  const m = await mount(view({ save: unconfirmed, recover }));
  await m.click('[data-testid="edit-product-save"]');
  await flush();
  await m.type('[data-testid="edit-unit-cost"]', "2.50");
  await m.click('[data-testid="edit-product-recover"]');
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].leafId, "leaf-1");
  assert.equal(calls[0].unitCost, "2.50", "a correctable field travels");
  assert.equal("sku" in calls[0], false, "the identity-bearing field does not");
  await m.unmount();
});

test("no recovery control is offered for an ordinary failure", async () => {
  const m = await mount(
    view({
      save: async () => ({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "bad" },
      }),
      recover: ok,
    }),
  );
  await m.click('[data-testid="edit-product-save"]');
  await flush();
  assert.equal(m.byTestId("edit-product-recover"), null);
  assert.equal(
    (m.byTestId("edit-product-save") as HTMLButtonElement).disabled,
    false,
    "an ordinary failure stays retryable",
  );
  await m.unmount();
});

// ── an accepted recovery is not a settled one ─────────────────────────────

const awaiting: UpdateProductService = async () => ({
  ok: false,
  error: {
    code: "AWAITING_CONFIRMATION",
    message:
      "A recovery of this product was accepted by HubSpot, but an earlier request to it may still land afterwards — nothing here can rule that out. Confirm it before editing again.",
  },
});

test("awaiting confirmation offers a CHECK, not another retry", async () => {
  // The remedy is different, so the control has to be. Offering "recover"
  // here would invite re-sending a request that already succeeded, which
  // makes the ordering hazard worse rather than better.
  const m = await mount(
    view({
      save: awaiting,
      recover: ok,
      confirm: async () => ({ ok: true, data: { leafId: "leaf-1", state: "resolved" } }),
    }),
  );
  await m.click('[data-testid="edit-product-save"]');
  await flush();

  assert.ok(m.byTestId("edit-product-confirm"), "the check must be reachable");
  assert.equal(m.byTestId("edit-product-recover"), null, "and a retry must not be");
  assert.equal(
    (m.byTestId("edit-product-save") as HTMLButtonElement).disabled,
    true,
  );
  await m.unmount();
});

test("a check that finds a DIVERGENCE says so, and does not close", async () => {
  // The failure this guards is reporting "confirmed" for a check that came
  // back bad -- the same class of error the whole surface exists to avoid.
  let closed = false;
  const m = await mount(
    view({
      save: awaiting,
      confirm: async () => ({ ok: true, data: { leafId: "leaf-1", state: "diverged" } }),
      onClose: () => (closed = true),
    }),
  );
  await m.click('[data-testid="edit-product-save"]');
  await flush();
  await m.click('[data-testid="edit-product-confirm"]');
  await flush();

  const err = m.byTestId("edit-product-error");
  assert.match(err!.textContent ?? "", /does not hold the recovered values/i);
  assert.match(err!.textContent ?? "", /stays held/i);
  assert.equal(closed, false);
  assert.equal(
    (m.byTestId("edit-product-save") as HTMLButtonElement).disabled,
    true,
    "a diverged product must not be editable from here",
  );
  await m.unmount();
});

test("a check that comes back clean closes the surface", async () => {
  let saved: string | null = null;
  const m = await mount(
    view({
      save: awaiting,
      confirm: async () => ({ ok: true, data: { leafId: "leaf-1", state: "resolved" } }),
      onSaved: (id) => (saved = id),
    }),
  );
  await m.click('[data-testid="edit-product-save"]');
  await flush();
  await m.click('[data-testid="edit-product-confirm"]');
  await flush();
  assert.equal(saved, "leaf-1");
  await m.unmount();
});

test("an unreadable check changes nothing and stays open", async () => {
  const m = await mount(
    view({
      save: awaiting,
      confirm: async () => ({
        ok: false,
        error: {
          code: "HUBSPOT_ERROR",
          message:
            "HubSpot could not be read, so what it holds is still unknown. Nothing was changed and this product stays held.",
        },
      }),
    }),
  );
  await m.click('[data-testid="edit-product-save"]');
  await flush();
  await m.click('[data-testid="edit-product-confirm"]');
  await flush();
  assert.match(
    m.byTestId("edit-product-error")!.textContent ?? "",
    /still unknown/i,
  );
  assert.ok(m.byTestId("edit-product-confirm"), "the check stays available");
  await m.unmount();
});
