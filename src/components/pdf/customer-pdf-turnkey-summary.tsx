// Slice 11 Step 3 — Pattern-30 verbatim port of CD's TurnkeySummary.
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:184-248 (component) + styles.css:396-485 (CSS).
//
// Pattern 30: structure preserved 1:1. Two render branches:
//   - single_tier → `.pp-tk-hero` with single hero figure
//   - tier_table → `.pp-tk-cards` row of `.pp-tk-card`s
// Both branches share the `Included` block (`.pp-tk-included`) per
// CD's source.
//
// `★` glyph: inline Newsreader native (per port plan); fall back to
// `<Svg><Path>` if smoke surfaces a tofu box.
//
// Pattern 45 boundary: prop types from `customer-pdf-types`; zero
// costing-surface imports.

import { Text, View } from "@react-pdf/renderer";

import { money, qtyK, serviceFeesTotal, tierGrand, unit } from "./customer-pdf-helpers";
import { styles } from "./customer-pdf-styles";
import { unpricedLinePhrase } from "./customer-pdf-unpriced";
import type {
  CpdfPdfLayout,
  CpdfServiceFee,
  CpdfSku,
  CpdfTier,
} from "./customer-pdf-types";

export function TurnkeySummary({
  skuSet,
  tiers,
  recommendedTierIdx,
  serviceFees,
  layout,
  foldFees,
  freightAtCost,
  allInUnit,
  partial,
  lede,
}: {
  skuSet: ReadonlyArray<CpdfSku>;
  tiers: ReadonlyArray<CpdfTier>;
  recommendedTierIdx: number | null;
  serviceFees: ReadonlyArray<CpdfServiceFee>;
  layout: CpdfPdfLayout;
  foldFees: boolean;
  freightAtCost: boolean;
  allInUnit: boolean;
  partial: boolean;
  lede?: string;
}) {
  const isSingle = layout === "single_tier";

  // Included block (CD `pdf-render.jsx:188-202`)
  const Included = (
    <View style={styles.tkIncluded}>
      <Text style={styles.tkIncludedLabel}>
        {"What this turnkey price includes".toUpperCase()}
      </Text>
      <Text style={styles.tkScope}>
        Covers {skuSet.length} finished products —{" "}
        <Text style={styles.tkScopeCode}>
          {skuSet.map((s) => s.code).join(" · ")}
        </Text>
        .
      </Text>
      <View style={styles.tkInclList}>
        {allInUnit && (
          <Text style={styles.tkIncl}>
            <Text style={styles.tkInclTick}>→</Text>
            {"  "}
            Container freight, duty {"&"} applicable tariffs — landed in the
            price (FOB Long Beach).
          </Text>
        )}
        {allInUnit && (
          <Text style={styles.tkIncl}>
            <Text style={styles.tkInclTick}>→</Text>
            {"  "}
            Project setup {"&"} tooling — included in the unit price.
          </Text>
        )}
        {foldFees && serviceFeesTotal(serviceFees) > 0 && (
          // Slice 11 Step 8 matrix smoke Cluster 2B fix (2026-07-27):
          // gate on real fee total, not just `foldFees`. See
          // GrandTotalRow's matching fix for full rationale.
          <Text style={styles.tkIncl}>
            <Text style={styles.tkInclTick}>→</Text>
            {"  "}
            One-time project {"&"} SKU fees ({money(serviceFeesTotal(serviceFees))})
            — folded into the total.
          </Text>
        )}
        {freightAtCost && (
          <Text style={[styles.tkIncl, styles.tkInclOut]}>
            <Text style={styles.tkInclOutTick}>×</Text>
            {"  "}
            Outbound freight — billed separately at cost (EXW); not in the
            turnkey figure.
          </Text>
        )}
        {partial && (
          <Text style={[styles.tkIncl, styles.tkInclOut]}>
            <Text style={styles.tkInclOutTick}>×</Text>
            {"  "}
            {unpricedLinePhrase(skuSet, tiers) ?? "One or more lines"} — quote
            on request; the total finalizes once those lines are priced.
          </Text>
        )}
      </View>
    </View>
  );

  if (isSingle) {
    // Display basis for the single-tier layout; see the note in
    // customer-pdf-pricing-table. Not a recommendation.
    const soloIdx = recommendedTierIdx ?? 0;
    const { total, hasUnpriced, perUnit } = tierGrand(
      skuSet,
      tiers,
      soloIdx,
      foldFees,
      serviceFees
    );
    const t = tiers[soloIdx];
    return (
      // Slice 11 Step 3 Fix 2 (CA 2026-06-30): single-tier turnkey
      // hero block is atomic — eyebrow + headline + hero figure +
      // tk-included list read together; never split across pages.
      <View style={styles.turnkey} wrap={false}>
        <Text style={styles.eyebrow}>
          {"Turnkey pricing · all-in".toUpperCase()}
        </Text>
        <Text style={styles.h2}>Your turnkey total</Text>
        {lede && <Text style={[styles.lede, styles.turnkeyLede]}>{lede}</Text>}
        {/* hero figure (CD `pdf-render.jsx:212`) */}
        <View style={styles.tkHero}>
          <View style={styles.hMeta}>
            <Text style={styles.hLabel}>
              {"Recommended volume".toUpperCase()}
            </Text>
            <Text style={styles.hTier}>
              <Text style={styles.hTierStar}>★</Text> {t.full}
            </Text>
            <Text style={styles.hQty}>
              {t.quantity.toLocaleString("en-US")} units
            </Text>
          </View>
          {hasUnpriced ? (
            <Text style={[styles.hNum, styles.hNumReq]}>total on request</Text>
          ) : (
            <Text style={styles.hNum}>{money(total)}</Text>
          )}
        </View>
        {perUnit != null && (
          <Text style={styles.tkHeroUnit}>
            {unit(perUnit)}{" "}
            <Text style={styles.tkHeroUnitPer}>/ unit · blended all-in</Text>
          </Text>
        )}
        {Included}
      </View>
    );
  }

  // tier_table — per-tier cards (CD `pdf-render.jsx:226`)
  return (
    // Slice 11 Step 3 Fix 2 (CA 2026-06-30): multi-tier turnkey
    // card group is atomic — recommended-tier card must stay paired
    // with its siblings; never split across pages.
    <View style={styles.turnkey} wrap={false}>
      <Text style={styles.eyebrow}>
        {"Turnkey pricing · all-in".toUpperCase()}
      </Text>
      <Text style={styles.h2}>Turnkey total by volume tier</Text>
      {lede && <Text style={[styles.lede, styles.turnkeyLede]}>{lede}</Text>}
      <View style={styles.tkCards}>
        {tiers.map((t, ti) => {
          const { total, hasUnpriced, perUnit } = tierGrand(
            skuSet,
            tiers,
            ti,
            foldFees,
            serviceFees
          );
          const isLast = ti === tiers.length - 1;
          const rec = t.recommended === true;
          return (
            <View
              key={t.id}
              style={[
                styles.tkCard,
                isLast ? styles.tkCardLast : {},
                rec ? styles.tkCardRec : {},
              ]}
            >
              <Text style={styles.tkTier}>
                {rec && <Text style={styles.tkTierStar}>★ </Text>}
                {t.label}
              </Text>
              <Text style={styles.tkQty}>{qtyK(t.quantity)} units</Text>
              {hasUnpriced ? (
                <Text style={[styles.tkTotal, styles.tkTotalReq]}>
                  total on request
                </Text>
              ) : rec ? (
                <Text style={[styles.tkTotal, styles.tkTotalRec]}>
                  {money(total)}
                </Text>
              ) : (
                // Slice 11 Cluster-1 real fix (2026-07-27) — split the
                // recommended/non-recommended branch. Was ONE Text with
                // `style={[styles.tkTotal, rec ? styles.tkTotalRec : {}]}`.
                // On Vercel serverless (not local Node), the non-rec
                // path with the `{}` empty-object second style triggered
                // react-pdf font-subsetting to include ONLY the LAST
                // glyph of the money() output — rendering "$1,733" as
                // bare "3" (or "$1,760" as bare "0", etc). Local repro
                // via tsx + renderToBuffer produced correct output on
                // identical code + data; only Vercel's runtime hit the
                // bug. pdfjs op dump confirmed the render emitted a
                // single showText with 1 glyph. Splitting into two
                // Text elements (no empty-object fallback in style
                // array) sidesteps the trigger. See docs/cc-comm-
                // cluster1-diagnosis.md for full evidence trail.
                <Text style={styles.tkTotal}>{money(total)}</Text>
              )}
              {perUnit != null && (
                <Text style={styles.tkPerunit}>
                  {hasUnpriced ? "from " : ""}
                  {unit(perUnit)}{" "}
                  <Text style={styles.tkPerunitPer}>/unit</Text>
                </Text>
              )}
              {rec && (
                <Text style={styles.tkRecWord}>
                  {"recommended".toUpperCase()}
                </Text>
              )}
            </View>
          );
        })}
      </View>
      {Included}
    </View>
  );
}
