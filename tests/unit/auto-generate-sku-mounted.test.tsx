// MOUNTED tests for the Auto-generate SKU control.
//
// Driven with injected services, because what matters here is what the
// operator is OFFERED and when -- and every one of those is a render
// decision that reading the source cannot settle:
//
//   * it must not appear beside a field that already holds a value
//   * it must not appear beside an established SKU
//   * from a customer quote it uses that customer and asks nothing
//   * a customer with no code, or a code awaiting setup, gets an explanation
//     and the manual field -- never somebody else's namespace
//   * in the Library it refuses to act until a customer is chosen
//   * a refusal stays visible and does not fill the field
//
// The database-bound half -- uniqueness, idempotence, the two constraints --
// is exercised against real Postgres by `scripts/gate-1b/sku-allocation-walk.ts`.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { flush, mount } from "../support/mount.tsx";
import {
  AutoGenerateSku,
  type SkuServices,
} from "../../src/components/library/auto-generate-sku.tsx";
import type { SkuBrandContext } from "../../src/app/actions/sku-allocation.ts";

const TWO_BRANDS = [
  { token: "SPJ", customerLabel: "Smart Pressed Juice" },
  { token: "JLF", customerLabel: "JLF" },
];

function services(
  ctx: SkuBrandContext,
  generate?: SkuServices["generate"],
): { svc: SkuServices; calls: FormData[] } {
  const calls: FormData[] = [];
  const svc: SkuServices = {
    loadContext: async () => ({ ok: true, data: ctx }),
    generate:
      generate ??
      (async (fd) => {
        calls.push(fd);
        return { ok: true, data: { ok: true, sku: "DPS-SPJ-1001", allocationId: "alloc-1" } };
      }),
  };
  return { svc, calls };
}

const READY: SkuBrandContext = {
  kind: "ready",
  token: "SPJ",
  customerLabel: "Smart Pressed Juice",
};
const CHOOSE: SkuBrandContext = { kind: "choose", brands: TWO_BRANDS };

function render(ctx: SkuBrandContext, over: Partial<{
  quoteId: string | null;
  currentValue: string;
  established: boolean;
  attemptKey: string;
  onGenerated: (sku: string, id: string) => void;
  generate: SkuServices["generate"];
}> = {}) {
  const { svc, calls } = services(ctx, over.generate);
  return {
    calls,
    el: mount(
      <AutoGenerateSku
        services={svc}
        quoteId={over.quoteId === undefined ? "quote-1" : over.quoteId}
        currentValue={over.currentValue ?? ""}
        established={over.established ?? false}
        attemptKey={over.attemptKey ?? "k"}
        onGenerated={over.onGenerated ?? (() => {})}
      />,
    ),
  };
}

// ── it never overwrites ──────────────────────────────────────────────────

test("does not appear beside a field that already holds a value", async () => {
  const el = await render(READY, { currentValue: "MISTR-1001" }).el;
  await flush();
  assert.equal(
    el.byTestId("sku-autogenerate"),
    null,
    "offered to generate over a value the operator already had",
  );
});

test("does not appear beside an established SKU", async () => {
  const el = await render(READY, { established: true }).el;
  await flush();
  assert.equal(el.byTestId("sku-autogenerate"), null);
});

test("does not appear when generation is unavailable in this environment", async () => {
  const el = await render({ kind: "unavailable" }).el;
  await flush();
  assert.equal(el.byTestId("sku-autogenerate"), null);
  assert.equal(el.byTestId("sku-no-code"), null, "explained a customer problem for an environment one");
});

// ── in a quote, the customer settles it ──────────────────────────────────

test("from a customer quote it acts on that customer and asks nothing", async () => {
  const el = await render(READY).el;
  await flush();
  const btn = el.byTestId("sku-autogenerate") as HTMLButtonElement;
  assert.ok(btn, "no button where the customer is known");
  assert.equal(btn.disabled, false, "known customer and still not actionable");
  assert.equal(el.byTestId("sku-customer"), null, "asked which customer inside their own quote");

  // Whose namespace it is belongs on the surface, not in a tooltip: this is a
  // permanent identifier about to be filed under somebody.
  const shown = el.byTestId("sku-ready-brand");
  assert.ok(shown, "generated under a customer it never named");
  assert.match(shown.textContent ?? "", /Smart Pressed Juice/);
  assert.match(shown.textContent ?? "", /SPJ/);
});

test("a customer with no code gets the manual path, never a neighbour's", async () => {
  const el = await render({ kind: "no_code", customerLabel: "Acme Botanicals" }).el;
  await flush();

  const note = el.byTestId("sku-no-code");
  assert.ok(note, "said nothing at all");
  assert.match(note.textContent ?? "", /Acme Botanicals/, "did not name the customer");
  assert.match(note.textContent ?? "", /manually/i, "did not point at manual entry");

  // THE PROHIBITION. The old shape listed every allocatable brand here, so one
  // click filed a product under somebody else's namespace.
  assert.equal(el.byTestId("sku-customer"), null, "offered another customer as a fallback");
  assert.equal(el.byTestId("sku-autogenerate"), null, "offered to generate with no code");
});

test("an unresolvable customer says so rather than naming the wrong one", async () => {
  const el = await render({ kind: "no_code", customerLabel: null }).el;
  await flush();
  const note = el.byTestId("sku-no-code");
  assert.ok(note);
  assert.match(note.textContent ?? "", /could not be resolved/i);
  assert.equal(el.byTestId("sku-customer"), null);
});

test("a code awaiting setup is a DIFFERENT message from having no code", async () => {
  const el = await render({
    kind: "awaiting_setup",
    token: "MISTR",
    customerLabel: "heymistr.com",
  }).el;
  await flush();

  const note = el.byTestId("sku-awaiting-setup");
  assert.ok(note, "awaiting setup was not explained");
  assert.match(note.textContent ?? "", /MISTR/, "did not name the code that exists");
  assert.match(note.textContent ?? "", /heymistr\.com/);
  assert.match(note.textContent ?? "", /manually/i);
  // The remedy differs from `no_code`, so the copy must not send someone to
  // enter a mnemonic that is already entered.
  assert.equal(el.byTestId("sku-no-code"), null, "collapsed two different states into one");
  assert.equal(el.byTestId("sku-autogenerate"), null, "offered to generate against an unseeded counter");
  assert.equal(el.byTestId("sku-customer"), null);
});

// ── the Library is the only place that asks ──────────────────────────────

test("in the Library it will not act until a customer is chosen", async () => {
  const { el: mounting, calls } = render(CHOOSE, { quoteId: null });
  const el = await mounting;
  await flush();

  const picker = el.byTestId("sku-customer") as HTMLSelectElement;
  assert.ok(picker, "no customer selector where there is no customer in context");
  assert.equal(picker.value, "", "a customer was defaulted");

  const btn = el.byTestId("sku-autogenerate") as HTMLButtonElement;
  assert.equal(btn.disabled, true, "actionable with no customer chosen");

  await el.click('[data-testid="sku-autogenerate"]');
  await flush();
  assert.equal(calls.length, 0, "generated without a customer");
});

test("the selector offers every ready customer and no default entry", async () => {
  const el = await render(CHOOSE, { quoteId: null }).el;
  await flush();
  const picker = el.byTestId("sku-customer") as HTMLSelectElement;
  assert.deepEqual([...picker.options].map((o) => o.value), ["", "SPJ", "JLF"]);
});

test("the selector is searchable, by customer name and by code", async () => {
  const el = await render(CHOOSE, { quoteId: null }).el;
  await flush();
  const search = el.byTestId("sku-customer-search") as HTMLInputElement;
  assert.ok(search, "no search where the list is expected to grow");

  await el.type('[data-testid="sku-customer-search"]', "smart");
  await flush();
  assert.deepEqual(
    [...(el.byTestId("sku-customer") as HTMLSelectElement).options].map((o) => o.value),
    ["", "SPJ"],
    "searching by customer name did not narrow the list",
  );

  await el.type('[data-testid="sku-customer-search"]', "jlf");
  await flush();
  assert.deepEqual(
    [...(el.byTestId("sku-customer") as HTMLSelectElement).options].map((o) => o.value),
    ["", "JLF"],
    "searching by code did not narrow the list",
  );
});

test("a search matching nothing says why, and still offers no fallback", async () => {
  const el = await render(CHOOSE, { quoteId: null }).el;
  await flush();
  await el.type('[data-testid="sku-customer-search"]', "zzzz-no-such-customer");
  await flush();

  assert.deepEqual(
    [...(el.byTestId("sku-customer") as HTMLSelectElement).options].map((o) => o.value),
    [""],
    "left a selectable customer that did not match",
  );
  const note = el.byTestId("sku-no-matches");
  assert.ok(note, "an empty result said nothing");
  assert.match(note.textContent ?? "", /manually/i);
  assert.equal(
    (el.byTestId("sku-autogenerate") as HTMLButtonElement).disabled,
    true,
  );
});

// ── generating ───────────────────────────────────────────────────────────

test("a generated SKU is handed back, and the attempt key travels with it", async () => {
  const got: string[] = [];
  const { el: mounting, calls } = render(READY, {
    attemptKey: "intent-42",
    onGenerated: (v) => got.push(v),
  });
  const el = await mounting;
  await flush();
  await el.click('[data-testid="sku-autogenerate"]');
  await flush();

  assert.deepEqual(got, ["DPS-SPJ-1001"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].get("attemptKey"), "intent-42", "retry safety depends on this");
  assert.equal(calls[0].get("brandToken"), "SPJ", "generated under a code the quote did not name");
});

test("the Library sends the CHOSEN customer, not the first in the list", async () => {
  const { el: mounting, calls } = render(CHOOSE, { quoteId: null });
  const el = await mounting;
  await flush();
  await el.select('[data-testid="sku-customer"]', "JLF");
  await flush();
  await el.click('[data-testid="sku-autogenerate"]');
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].get("brandToken"), "JLF");
});

test("a refusal stays visible and does not fill the field", async () => {
  const got: string[] = [];
  const el = await render(READY, {
    onGenerated: (v) => got.push(v),
    generate: async () => ({
      ok: true,
      data: {
        ok: false,
        refusal: {
          kind: "counter_not_seeded",
          token: "SPJ",
          message: 'The counter for "SPJ" has not been seeded.',
        },
      },
    }),
  }).el;
  await flush();
  await el.click('[data-testid="sku-autogenerate"]');
  await flush();

  assert.deepEqual(got, [], "a refusal put a value in the field");
  const alert = el.find('[role="alert"]');
  assert.ok(alert, "the refusal was not shown");
  assert.match(alert.textContent ?? "", /not been seeded/);
  assert.ok(
    el.byTestId("sku-autogenerate"),
    "the control vanished after a refusal, leaving no way to retry",
  );
});
