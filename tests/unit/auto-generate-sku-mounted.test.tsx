// MOUNTED tests for the Auto-generate SKU control.
//
// Driven with injected services, because what matters here is what the
// operator is OFFERED and when -- and every one of those is a render
// decision that reading the source cannot settle:
//
//   * it must not appear beside a field that already holds a value
//   * it must not appear beside an established SKU
//   * from a customer quote it preselects and needs one click
//   * in the Library it refuses to act until a brand is chosen
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

const TWO_BRANDS = [
  { token: "SPJ", customerLabel: "Smart Pressed Juice" },
  { token: "JLF", customerLabel: "JLF" },
];

function services(over: Partial<{
  brands: { token: string; customerLabel: string }[];
  preselected: string | null;
  enabled: boolean;
  generate: SkuServices["generate"];
}> = {}): { svc: SkuServices; calls: FormData[] } {
  const calls: FormData[] = [];
  const svc: SkuServices = {
    loadContext: async () => ({
      ok: true,
      data: {
        brands: over.brands ?? TWO_BRANDS,
        preselected: over.preselected ?? null,
        enabled: over.enabled ?? true,
      },
    }),
    generate:
      over.generate ??
      (async (fd) => {
        calls.push(fd);
        return { ok: true, data: { ok: true, sku: "DPS-SPJ-1001", allocationId: "alloc-1" } };
      }),
  };
  return { svc, calls };
}


// ── it never overwrites ──────────────────────────────────────────────────

test("does not appear beside a field that already holds a value", async () => {
  const { svc } = services();
  const el = await mount(
    <AutoGenerateSku
      services={svc}
      quoteId={null}
      currentValue="MISTR-1001"
      established={false}
      attemptKey="k"
      onGenerated={() => {}}
    />,
  );
  await flush();
  assert.equal(
    el.byTestId("sku-autogenerate"),
    null,
    "offered to generate over a value the operator already had",
  );
});

test("does not appear beside an established SKU", async () => {
  const { svc } = services();
  const el = await mount(
    <AutoGenerateSku
      services={svc}
      quoteId={null}
      currentValue=""
      established={true}
      attemptKey="k"
      onGenerated={() => {}}
    />,
  );
  await flush();
  assert.equal(el.byTestId("sku-autogenerate"), null);
});

test("does not appear when generation is unavailable in this environment", async () => {
  const { svc } = services({ enabled: false });
  const el = await mount(
    <AutoGenerateSku
      services={svc}
      quoteId={null}
      currentValue=""
      established={false}
      attemptKey="k"
      onGenerated={() => {}}
    />,
  );
  await flush();
  assert.equal(el.byTestId("sku-autogenerate"), null);
});

// ── the brand is chosen, never guessed ───────────────────────────────────

test("from a customer quote the brand preselects and no picker is shown", async () => {
  const { svc } = services({ preselected: "SPJ" });
  const el = await mount(
    <AutoGenerateSku
      services={svc}
      quoteId="quote-1"
      currentValue=""
      established={false}
      attemptKey="k"
      onGenerated={() => {}}
    />,
  );
  await flush();
  const btn = el.byTestId("sku-autogenerate") as HTMLButtonElement;
  assert.ok(btn, "no button after preselection");
  assert.equal(btn.disabled, false, "preselected and still not actionable");
  assert.equal(
    el.byTestId("sku-brand"),
    null,
    "asked for a brand that was already known",
  );
});

test("in the Library it will not act until a brand is chosen", async () => {
  const { svc, calls } = services({ preselected: null });
  const el = await mount(
    <AutoGenerateSku
      services={svc}
      quoteId={null}
      currentValue=""
      established={false}
      attemptKey="k"
      onGenerated={() => {}}
    />,
  );
  await flush();

  const picker = el.byTestId("sku-brand") as HTMLSelectElement;
  assert.ok(picker, "no brand picker where there is no customer in context");

  // The empty option is a prompt, not a selectable default namespace.
  assert.equal(picker.value, "", "a brand was defaulted");
  const btn = el.byTestId("sku-autogenerate") as HTMLButtonElement;
  assert.equal(btn.disabled, true, "actionable with no brand chosen");

  await el.click('[data-testid="sku-autogenerate"]');
  await flush();
  assert.equal(calls.length, 0, "generated without a brand");
});

test("the picker offers every allocatable brand and no default entry", async () => {
  const { svc } = services({ preselected: null });
  const el = await mount(
    <AutoGenerateSku
      services={svc}
      quoteId={null}
      currentValue=""
      established={false}
      attemptKey="k"
      onGenerated={() => {}}
    />,
  );
  await flush();
  const picker = el.byTestId("sku-brand") as HTMLSelectElement;
  const values = [...picker.options].map((o) => o.value);
  assert.deepEqual(values, ["", "SPJ", "JLF"]);
  assert.equal(values.filter((v) => v !== "").length, 2);
});

// ── generating ───────────────────────────────────────────────────────────

test("a generated SKU is handed back, and the attempt key travels with it", async () => {
  const got: string[] = [];
  const { svc, calls } = services({ preselected: "SPJ" });
  const el = await mount(
    <AutoGenerateSku
      services={svc}
      quoteId="quote-1"
      currentValue=""
      established={false}
      attemptKey="intent-42"
      onGenerated={(v) => got.push(v)}
    />,
  );
  await flush();
  await el.click('[data-testid="sku-autogenerate"]');
  await flush();

  assert.deepEqual(got, ["DPS-SPJ-1001"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].get("attemptKey"), "intent-42", "retry safety depends on this");
  assert.equal(calls[0].get("brandToken"), "SPJ");
});

test("a refusal stays visible and does not fill the field", async () => {
  const got: string[] = [];
  const { svc } = services({
    preselected: "SPJ",
    generate: async () => ({
      ok: true,
      data: {
        ok: false,
        refusal: {
          kind: "counter_not_seeded",
          token: "SPJ",
          message: "The counter for \"SPJ\" has not been seeded.",
        },
      },
    }),
  });
  const el = await mount(
    <AutoGenerateSku
      services={svc}
      quoteId="quote-1"
      currentValue=""
      established={false}
      attemptKey="k"
      onGenerated={(v) => got.push(v)}
    />,
  );
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

