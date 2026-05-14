**Severity:** LOW

**Dimension:** 4 — tier row qty cell display

**Issue:** The canonical R7b qty cell renders with comma-separated thousands (`t.qty.toLocaleString()` → `"10,000"`). The implementation passes raw integer (`String(tier.qty)` → `"10000"`) into the input (`tier-row.tsx:51`):

```tsx
const [qty, setQty] = useState(tier.qty == null ? "" : String(tier.qty));
```

`type="number"` input doesn't accept comma-separated values; rendering "10,000" inside a `type="number"` would be browser-rejected. So the canonical's `toLocaleString()` was a static-prototype convenience that doesn't survive the controlled-input round trip.

This is acceptable as-is, BUT PMs reading the tier table at scan speed see `10000`, `50000`, `100000` — harder to read than `10k`, `50k`, `100k` or `10,000`, `50,000`, `100,000`. Adjacent qty column in the cost-stack header (Costs surface) uses the canonical's display register and DOES format with `toLocaleString` (since it's static read-mode there).

**Canonical reference:** `docs/design-prototypes/dist/7bsetup.jsx:292` — `<input defaultValue={t.qty.toLocaleString()} />`. Prototype convenience for the visual; doesn't round-trip controlled inputs.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/tier-row.tsx:51, 163-178`

**Fix proposal (defer to Pattern 29 migration):**

Same target as Finding 06 — Pattern 29 read↔edit cells for tier qty + price-adj. Read mode renders `"10,000 u"` (formatted with commas + unit suffix); click → edit mode shows raw `10000` in `type="number"` input; blur → commit + return to read mode. Out of §6.b scope; banked.

For §6.b ship-as-is: defer-with-rationale per Pattern 19. Document in tier-row.tsx:

```tsx
// §6.b — tier qty renders as raw integer in always-edit-mode input;
// canonical R7b uses `toLocaleString()` in a static prototype but
// that doesn't round-trip in controlled type="number" inputs. Pattern
// 29 read↔edit migration (banked in r1-setup.css) restores the
// formatted display register. Out of §6.b scope.
```

**Risk if shipped:** Subtle scan-speed cost (5-digit and 6-digit integers harder to read without commas). PMs adapt quickly; not blocking. LOW.
