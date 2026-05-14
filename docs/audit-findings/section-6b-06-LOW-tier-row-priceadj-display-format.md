**Severity:** LOW

**Dimension:** 4 — tier row inline-edit affordances (price adj %)

**Issue:** The tier row's `Price adj %` cell renders the value as a raw decimal-percent input (e.g., `-5` for -5%, with implicit `%` suffix per canonical). The canonical R7b prototype renders priceAdjPct as `0%` when zero and `-5%` (with explicit "%") when non-zero (`docs/design-prototypes/dist/7bsetup.jsx:294`):

```jsx
<input defaultValue={t.price_adj_pct === 0 ? "0%" : `${(t.price_adj_pct * 100).toFixed(0)}%`} />
```

The implementation renders the raw number without the % suffix (`tier-row.tsx:181-192`):

```tsx
<input
  type="number"
  step="0.01"
  placeholder="—"
  value={priceAdj}                         // e.g. "-5" without %
  …
/>
```

This is a fidelity gap on read mode (PMs scanning the column see "0", "−5", "−10" instead of "0%", "−5%", "−10%"). Edit mode is OK either way (a `type="number"` input can't accept `%`-suffixed strings).

Pattern 29 (R6 read↔edit) was banked exactly for this case — render mode shows formatted value, edit mode shows raw. The tier row doesn't yet use Pattern 29 (the cells are always-edit-mode inputs); this audit finding is part-fidelity-gap, part-Pattern-29-future-target. Banked in `r1-setup.css` comment: "existing cost-build cells (packaging unit_cost, freight per-line costs, production service fees) should migrate to the read↔edit pattern for consistency" — same target.

**Canonical reference:** `docs/design-prototypes/dist/7bsetup.jsx:294` — `defaultValue={t.price_adj_pct === 0 ? "0%" : `${(t.price_adj_pct * 100).toFixed(0)}%`}` shows the "%" suffix in the read register.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/tier-row.tsx:179-193`

**Fix proposal (minimal — single-state, no Pattern 29 migration yet):**

Switch to a `type="text"` input and format the display string with a "%" suffix when not focused. Parse to number on commit:

```tsx
const [priceAdj, setPriceAdj] = useState(
  tier.tierPriceAdjPct === null
    ? ""
    : `${(Number(tier.tierPriceAdjPct) * 100).toFixed(0)}%`  // ← format with %
);

// In schedulePriceAdjSave overrides, strip the % before persistence:
function schedulePriceAdjSave(overrides: Overrides = {}) {
  if (debounceRef.current) clearTimeout(debounceRef.current);
  debounceRef.current = setTimeout(() => {
    const s = { ...stateRef.current, ...overrides };
    const stripped = s.priceAdj.replace(/%/g, "").trim();
    const fd = new FormData();
    fd.set("tierId", tier.id);
    fd.set("tierPriceAdjPct", stripped);
    startTransition(async () => {
      const r = await updateTierPriceAdj(fd);
      if (!r.ok) setSaveError(r.error.message);
      else setSaveError(null);
    });
  }, DEBOUNCE_MS);
}

// In <input>:
<input
  type="text"
  inputMode="numeric"
  placeholder="—"
  value={priceAdj}
  disabled={disabled}
  onChange={(e) => {
    const v = e.target.value;
    setPriceAdj(v);
    schedulePriceAdjSave({ priceAdj: v });
  }}
  onBlur={() => {
    // Normalize on blur: strip %, parse, re-format with %
    const stripped = priceAdj.replace(/%/g, "").trim();
    const n = Number(stripped);
    if (Number.isFinite(n)) setPriceAdj(`${n.toFixed(0)}%`);
  }}
  aria-label="Per-tier price adjustment percent"
/>
```

Trade-off: PMs typing into the cell will see "%" appear/disappear on blur; OK for tier table since edits are rare and decisive.

**Better fix (Pattern 29 migration target):** Convert tier qty + price-adj cells to Pattern 29 read↔edit cells (like RetailBenchCell). Read mode shows `"-5%"`; click → edit mode shows raw input; blur → format + commit. Out of §6.b scope; banked in r1-setup.css as future polish. Carries forward to §6.c or R7c.

**Risk if shipped:** Visually subtle (PMs reading tier table miss the `%` glyph on price-adj column). Not load-bearing — adjacent qty column reads as raw integer "10,000" without unit suffix and that's accepted. LOW because it's a polish gap, not a behavioral break.
