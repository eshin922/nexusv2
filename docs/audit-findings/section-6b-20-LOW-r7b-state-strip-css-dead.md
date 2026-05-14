**Severity:** LOW

**Dimension:** 8 — Pattern 21 compliance (R7B STATES tab strip)

**Issue:** The canonical `r7b-setup.css` file contains the `.r7b-state-strip` ruleset (lines 29-46) for the prototype's review chrome:

```css
.r7b-state-strip { display: flex; gap: 4px; … }
.r7b-state-strip .lbl { … }
.r7b-state-strip button { … }
…
```

Per Pattern 21, the R7B STATES tab strip is review chrome only — no JSX should render it in production. Grep confirms ZERO production references to `r7b-state-strip` in `src/` (verified). So Pattern 21 compliance is met behavior-wise.

But the CSS rules are now **dead code** in `r7b-setup.css`. The canonical file is verbatim from `docs/design-prototypes/dist/7bstyles.css` per Pattern 30 — so the rules legitimately exist in the upstream source. Pattern 30 says don't edit the canonical file; if it has the strip CSS, the canonical keeps the strip CSS.

This is a Pattern 30 ↔ Pattern 21 tension: Pattern 30 says keep canonical CSS verbatim including dead rules; Pattern 21 says the strip is review chrome. The dead rules are correctly not rendered (Pattern 21 honored), but the file ships ~20 lines of unused CSS to production (Pattern 30 honored).

**Canonical reference:** `docs/design-prototypes/dist/7bstyles.css:5-22` (the source has these rules) — preserved verbatim in `src/styles/r7b-setup.css`.

**Implementation reference:** `src/styles/r7b-setup.css:29-46`

**Fix proposal:** Defer-with-rationale. Pattern 30 wins — canonical CSS stays verbatim. The dead rules are a small payload cost (~600 bytes) and survive verbatim-from-source as a feature, not a bug. CC notes the dead rules in a comment block at the top of the file pointing future maintainers at this audit finding.

Add comment block to `r7b-setup.css`:

```css
/* Pattern 21 note (banked from §6.b audit, May 2026):
 *
 * The .r7b-state-strip ruleset below lines 29-46 styles the R7b
 * prototype's review chrome ("R7B STATES tab strip"). Per Pattern 21,
 * this strip is review chrome only — NO JSX in src/ renders it.
 *
 * The rules survive in this file per Pattern 30 (canonical CSS
 * imported verbatim) — `7bstyles.css` upstream has them, so the
 * verbatim copy has them. The discipline is: don't render the strip
 * in production; don't strip the canonical CSS to "clean up."
 *
 * If a future round (R7c) drops the strip from upstream `7bstyles.css`,
 * re-running the verbatim copy will naturally drop it from here too.
 */
```

This is a notation-only change; no behavioral impact.

**Risk if shipped:** Trivial. ~600 bytes of dead CSS. LOW.
