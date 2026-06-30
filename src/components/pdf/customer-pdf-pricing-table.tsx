// Slice 11 Step 3 — Pattern-30 verbatim port of CD's PricingTable.
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:81-145 (component) + styles.css:194-262 (CSS).
//
// Pattern 30: structure preserved 1:1. Mechanical substitutions:
//   - <table>/<thead>/<tbody>/<tr>/<td> — NOT used by CD; flex
//     <View>s throughout (audit §4 confirmed zero `<table>` hits).
//   - `text-transform: uppercase` on .pp-c-prod .pp-th-lab
//     (styles.css:228) → `.toUpperCase()` at render time.
//   - `★` glyph rendered inline via Newsreader native (spike §1 +
//     audit §4 noted U+2605 in Newsreader coverage; fall back to
//     `<Svg><Path>` if smoke shows a tofu box).
//
// Pattern 45 boundary: prop types from `customer-pdf-types`; zero
// costing-surface imports. Per-tier qty + tier label are CD's
// `quantity` + `label` — both customer-visible per data-source map.

import { Text, View } from "@react-pdf/renderer";

import { lineTotal, money, qtyK, unit } from "./customer-pdf-helpers";
import { styles } from "./customer-pdf-styles";
import type {
  CpdfPdfLayout,
  CpdfSku,
  CpdfTier,
} from "./customer-pdf-types";

export function PricingTable({
  skus,
  tiers,
  recommendedTierIdx,
  layout,
  quoteNumber,
  continued = false,
}: {
  skus: ReadonlyArray<CpdfSku>;
  tiers: ReadonlyArray<CpdfTier>;
  recommendedTierIdx: number;
  layout: CpdfPdfLayout;
  /** Required when `continued` true — used in the continuation eyebrow. */
  quoteNumber: string;
  continued?: boolean;
}) {
  const isSingle = layout === "single_tier";
  const cols = isSingle
    ? [{ tier: tiers[recommendedTierIdx], ti: recommendedTierIdx }]
    : tiers.map((t, i) => ({ tier: t, ti: i }));

  return (
    <View style={styles.table}>
      {continued && (
        <Text style={[styles.eyebrow, { marginBottom: 8 }]}>
          Tiered pricing · continued — {quoteNumber}
        </Text>
      )}

      {/* thead (CD `pdf-render.jsx:93`) */}
      <View style={[styles.thead, continued ? styles.theadContinued : {}]}>
        {/* product column header */}
        <View style={styles.cProd}>
          <Text style={styles.thLabProd}>{"Product".toUpperCase()}</Text>
        </View>

        {/* tier column headers */}
        {cols.map(({ tier }) => {
          const rec = tier.recommended === true;
          return (
            <View
              key={tier.id}
              style={[
                styles.cNum,
                styles.theadCNum,
                !isSingle && rec ? styles.cRec : {},
                !isSingle && rec ? styles.theadCRec : {},
              ]}
            >
              <View style={styles.thLab}>
                {isSingle ? (
                  <Text style={styles.thLab}>Unit price</Text>
                ) : rec ? (
                  // .pp-th-rec — inline-flex; star + label
                  <View style={styles.thRec}>
                    <Text style={styles.thRecStar}>★</Text>
                    <Text>{tier.label}</Text>
                  </View>
                ) : (
                  <Text style={styles.thLab}>{tier.label}</Text>
                )}
              </View>
              <Text style={styles.thSub}>
                {isSingle ? (
                  <>
                    {tier.label} · {qtyK(tier.quantity)} units ·{" "}
                    <Text style={styles.recWord}>recommended</Text>
                  </>
                ) : (
                  <>
                    {qtyK(tier.quantity)} units
                    {rec && (
                      <Text style={styles.recWord}> · recommended</Text>
                    )}
                  </>
                )}
              </Text>
            </View>
          );
        })}
      </View>

      {/* tbody (CD `pdf-render.jsx:114`) */}
      <View style={styles.tbody}>
        {skus.map((sku) => {
          const isFlat = sku.shape === "flat";
          return (
            // Slice 11 Step 3 Fix 2 (CA 2026-06-30): a SKU row is
            // atomic; never split across pages. Auto-flow would
            // otherwise orphan the extended-price line below the
            // product name (per CA's "RPL-400 split" reference).
            <View key={sku.id} style={styles.tr} wrap={false}>
              {/* product cell */}
              <View style={styles.cProd}>
                <Text style={styles.prodName}>{sku.name}</Text>
                <Text style={styles.prodMeta}>
                  <Text style={styles.prodMetaCode}>{sku.code}</Text>
                  {sku.pack != null && sku.pack.length > 0 ? ` · ${sku.pack}` : ""}
                </Text>
                {isFlat && (
                  <Text style={styles.prodFlat}>
                    Flat unit across all volume tiers
                  </Text>
                )}
              </View>
              {/* tier value cells */}
              {cols.map(({ tier, ti }) => {
                const p = sku.tier_prices[ti];
                const rec = !isSingle && tier.recommended === true;
                const lt = lineTotal(p ?? null, tiers, ti);
                let unitNode;
                if (p == null) {
                  unitNode = (
                    <Text style={styles.priceReq}>quote on request</Text>
                  );
                } else if (isFlat && !isSingle && ti !== 0) {
                  unitNode = <Text style={[styles.price, styles.priceDash]}>—</Text>;
                } else {
                  unitNode = (
                    <Text style={[styles.price, rec ? styles.priceRec : {}]}>
                      {unit(p)}
                    </Text>
                  );
                }
                return (
                  <View
                    key={tier.id}
                    style={[styles.cNum, rec ? styles.cRec : {}]}
                  >
                    {unitNode}
                    {lt != null && (
                      <Text
                        style={[
                          styles.linetotal,
                          rec ? styles.linetotalRec : {},
                        ]}
                      >
                        {money(lt)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>
    </View>
  );
}
