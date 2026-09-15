"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { GenerateResult, SkuBrandContext } from "@/app/actions/sku-allocation";

/**
 * The two server calls, injected rather than imported.
 *
 * Same discipline as `EditProductModal`'s `save` / `recover`: a component that
 * imports its server actions at module scope drags the database client into
 * the import graph of everything that mounts it, including tests. Declaring
 * them as a structural type keeps the boundary at the call site, where the
 * real actions are passed in.
 */
export type SkuServices = {
  loadContext: (quoteId: string | null) => Promise<ActionResult<SkuBrandContext>>;
  generate: (formData: FormData) => Promise<ActionResult<GenerateResult>>;
};

/**
 * Auto-generate SKU, beside the SKU field.
 *
 * ── IT NEVER OVERWRITES ──────────────────────────────────────────────────
 *
 * The control does not render at all when the field already holds a value or
 * the product's SKU is established. Not disabled -- absent. A disabled button
 * beside a filled field still advertises that generating over it is a thing
 * one might do, and an established SKU is exactly the value that must never be
 * replaced by an ordinary edit.
 *
 * ── IN A QUOTE THERE IS NO CHOICE TO MAKE ────────────────────────────────
 *
 * The quote has a customer, and the customer settles the namespace. So there
 * is NO dropdown here: the code is the one registered against that customer's
 * record, or there is no generation and the control says why.
 *
 * The dropdown this replaces listed every allocatable brand whenever the
 * quote's own customer had none -- which offered OTHER PEOPLE'S codes beside a
 * product belonging to this one, and made filing it wrongly a single click.
 * A customer without a code now gets an explanation and the manual field, and
 * never a neighbour's namespace as a fallback.
 *
 * ── THE LIBRARY IS THE ONLY PLACE THAT ASKS ──────────────────────────────
 *
 * Creating straight into the Library has no customer in context, so the
 * operator picks one -- searchable, because the list grows, and with no
 * default option, because a default would file a product under whichever
 * customer sorted first.
 *
 * Nothing here derives a code from the product's name.
 *
 * ── THE VALUE SURVIVES RETRIES ───────────────────────────────────────────
 *
 * One `attemptKey` per creation intent, minted once per mount. Retrying a
 * failed save reuses it, and the same key returns the SAME allocation rather
 * than consuming a second number -- so the SKU an operator was shown is the
 * SKU they keep, even across a failure. The durability is in the allocation
 * row, not in this component's state.
 */
export function AutoGenerateSku({
  quoteId,
  currentValue,
  established,
  onGenerated,
  attemptKey,
  services,
}: {
  /** Null on the Library surface, which has no customer in context. */
  quoteId: string | null;
  currentValue: string;
  established: boolean;
  /**
   * Both halves. The allocation id is what the save sends back so the
   * reservation is bound to the product that carries it -- without it the
   * identifier is in the catalog while its reservation still reads
   * `allocated`.
   */
  onGenerated: (sku: string, allocationId: string) => void;
  attemptKey: string;
  services: SkuServices;
}) {
  const [ctx, setCtx] = useState<SkuBrandContext | null>(null);
  /** Library only. Empty means nothing chosen, and nothing is chosen for you. */
  const [chosen, setChosen] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const loaded = useRef(false);

  const occupied = currentValue.trim() !== "" || established;

  useEffect(() => {
    if (occupied || loaded.current) return;
    loaded.current = true;
    void services.loadContext(quoteId).then((r) => {
      if (!r.ok) return;
      setCtx(r.data);
    });
  }, [occupied, quoteId]);

  const filtered = useMemo(() => {
    if (!ctx || ctx.kind !== "choose") return [];
    const q = search.trim().toLowerCase();
    if (!q) return ctx.brands;
    return ctx.brands.filter(
      (b) =>
        b.customerLabel.toLowerCase().includes(q) ||
        b.token.toLowerCase().includes(q),
    );
  }, [ctx, search]);

  // Nothing to offer: the field already has a value, the SKU is established,
  // or generation is unavailable in this environment. Renders nothing rather
  // than a control that cannot work.
  if (occupied || !ctx || ctx.kind === "unavailable") return null;

  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    flexShrink: 0,
  };
  /**
   * A refusal takes its OWN LINE, under the field.
   *
   * `flexBasis: "100%"` rather than leaving it to wrap when space runs out.
   * Both call sites render this inside the row that holds the SKU input, and
   * the input is `flex: 1` -- so a two-line explanation sitting beside it as
   * an ordinary flex child squeezes the field the message is telling the
   * operator to type into. Forcing the break makes that independent of
   * viewport width instead of true above some breakpoint nobody picked.
   *
   * The BUTTON still sits beside the field; it is short and it is the thing
   * the row exists for. Only the prose drops.
   */
  const note: React.CSSProperties = {
    fontSize: 11,
    color: "var(--ink-3)",
    // `flexBasis: 100%` ALONE DID NOT BREAK THE LINE, because `maxWidth`
    // clamped it. Flex decides line breaks from the hypothetical main size --
    // the basis clamped by min and max -- so with a 380px cap the notice
    // measured 380, and 180 (input floor) + 8 + 380 fitted inside a 594px
    // field. The two shared a line and the input was squeezed to 206px:
    // exactly the defect the basis was added to prevent, hidden above the
    // width where it bites.
    //
    // `minWidth: 100%` is what actually guarantees the break, since a minimum
    // cannot be clamped away by a maximum. The cap is gone with it; at 11px
    // inside a modal no wider than 594 the measure stays readable without one.
    flexBasis: "100%",
    minWidth: "100%",
  };

  // ── a code exists but cannot issue yet ─────────────────────────────────
  //
  // Said as its own state rather than folded into "no code", because the
  // remedy differs: nobody needs to enter a mnemonic, the starting number has
  // to be established. It does NOT offer to do that -- there is no inline
  // path, and implying one would be worse than saying nothing.
  if (ctx.kind === "awaiting_setup") {
    return (
      <div style={note} data-testid="sku-awaiting-setup">
        <strong>{ctx.token}</strong> is set for {ctx.customerLabel}, but SKU setup
        is not finished — its starting number has still to be checked against
        the existing catalogs. Enter the SKU manually for now.
      </div>
    );
  }

  // ── no code for this customer ──────────────────────────────────────────
  if (ctx.kind === "no_code") {
    return (
      <div style={note} data-testid="sku-no-code">
        {ctx.customerLabel
          ? `${ctx.customerLabel} has no SKU code yet.`
          : "This quote's customer could not be resolved, so no SKU code applies."}{" "}
        Enter the SKU manually. A code is set in Settings, and SKU setup has to
        finish before one can generate.
      </div>
    );
  }

  const token = ctx.kind === "ready" ? ctx.token : chosen;
  const needsChoice = token === "";

  function run() {
    setError(null);
    const fd = new FormData();
    fd.set("brandToken", token);
    fd.set("attemptKey", attemptKey);
    startTransition(async () => {
      const r = await services.generate(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      if (!r.data.ok) {
        setError(r.data.refusal.message);
        return;
      }
      onGenerated(r.data.sku, r.data.allocationId);
    });
  }

  return (
    // Sits INLINE, to the right of the SKU input -- both call sites put the
    // two in one flex row. `flexWrap` still applies: at narrow widths the
    // selector and any error text drop to their own lines rather than
    // squeezing the input.
    <div style={row}>
      {/* THE LIBRARY ONLY. A quote never reaches this branch, because a quote
          has a customer and the customer is the answer. */}
      {ctx.kind === "choose" && (
        <>
          <input
            type="search"
            aria-label="Search customers"
            data-testid="sku-customer-search"
            placeholder="Search customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", width: 140 }}
          />
          <select
            aria-label="Customer for the generated SKU"
            data-testid="sku-customer"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", maxWidth: 220 }}
          >
            {/* No "— choose —" that could be submitted: the empty value is
                what `needsChoice` refuses on. */}
            <option value="">Choose a customer…</option>
            {filtered.map((b) => (
              <option key={b.token} value={b.token}>
                {b.customerLabel} ({b.token})
              </option>
            ))}
          </select>
        </>
      )}

      <button
        type="button"
        data-testid="sku-autogenerate"
        onClick={run}
        disabled={pending || needsChoice}
        title={
          needsChoice
            ? "Choose a customer first — there is no default."
            : ctx.kind === "ready"
              ? `Generates under ${ctx.token} — ${ctx.customerLabel}`
              : undefined
        }
        style={{
          fontSize: 12,
          padding: "4px 10px",
          borderRadius: 5,
          border: "1px solid var(--rule)",
          background: "var(--paper)",
          color: needsChoice ? "var(--ink-3)" : "var(--ink-2)",
          cursor: needsChoice ? "not-allowed" : "pointer",
        }}
      >
        {pending ? "Generating…" : "Auto-generate SKU"}
      </button>

      {/* In a quote, whose namespace this is belongs ON the surface rather
          than in a tooltip. An operator should not have to hover to find out
          which customer a permanent identifier is about to be filed under. */}
      {ctx.kind === "ready" && (
        <span style={{ fontSize: 11, color: "var(--ink-3)" }} data-testid="sku-ready-brand">
          {ctx.customerLabel} · <strong>{ctx.token}</strong>
        </span>
      )}

      {/* A disabled control must say why. */}
      {needsChoice && (
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
          Choose a customer — there is no default.
        </span>
      )}
      {ctx.kind === "choose" && search.trim() !== "" && filtered.length === 0 && (
        <span style={{ fontSize: 11, color: "var(--ink-3)" }} data-testid="sku-no-matches">
          No customer with a SKU code matches. Only customers whose setup is
          finished can generate; enter the SKU manually.
        </span>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "var(--danger, #b42318)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
