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
import { Fragment } from "react";

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
  recommendedTierIdx: number | null;
  layout: CpdfPdfLayout;
  /** Required when `continued` true — used in the continuation eyebrow. */
  quoteNumber: string | null;
  continued?: boolean;
}) {
  // SINGLE-TIER LAYOUT picks which tier to SHOW. With no recommendation it
  // shows the first — a display choice, not a claim that the tier is
  // recommended. Nothing in this component says the word.
  const soloIdx = recommendedTierIdx ?? 0;
  const isSingle = layout === "single_tier";
  const hasItemGroups = skus.some((sku) => sku.item_group);
  const cols = isSingle
    ? [{ tier: tiers[soloIdx], ti: soloIdx }]
    : tiers.map((t, i) => ({ tier: t, ti: i }));

  return (
    <View style={styles.table}>
      {continued && (
        <Text style={[styles.eyebrow, { marginBottom: 8 }]}>
          {/* The number qualifies the eyebrow; with none, the eyebrow still
              has its job to do and simply says less. */}
          Tiered pricing · continued{quoteNumber ? ` — ${quoteNumber}` : ""}
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
        {skus.map((sku, index) => {
          const isFlat = sku.shape === "flat";
          return (
            <Fragment key={sku.id}>
            {sku.item_group && (index === 0 || skus[index - 1]?.item_group?.id !== sku.item_group.id) ? (
              <View style={[styles.itemGroup, styles.itemGroupOwned]} wrap={false}>
                <View style={[styles.cProd, styles.groupHeaderProduct]}>
                  <Text style={styles.itemGroupName}>{sku.item_group.name}</Text>
                </View>
                {cols.map(({ tier, ti }) => {
                  const summary = sku.item_group?.tierSummaries?.[ti];
                  const rec = !isSingle && tier.recommended === true;
                  return <View key={tier.id} style={[styles.cNum, rec ? styles.cRec : {}]}>
                    {summary?.unitPrice != null && summary.lineTotal != null ? <>
                      <Text style={[styles.price, rec ? styles.priceRec : {}]}>{unit(summary.unitPrice)}</Text>
                      <Text style={styles.linetotal}>Group total {money(summary.lineTotal)}</Text>
                    </> : <Text style={styles.priceReq}>quote on request</Text>}
                  </View>;
                })}
              </View>
            ) : null}
            {!sku.item_group && hasItemGroups && (index === 0 || skus[index - 1]?.item_group) ? (
              <View style={styles.itemGroup} wrap={false}>
                <View style={styles.cProd}><Text style={styles.itemGroupName}>Individual items</Text></View>
              </View>
            ) : null}
            {/* A priced SKU row is atomic; never orphan its amount across pages. */}
            <View style={[styles.tr, sku.item_group ? styles.groupMemberRow : {}, sku.item_group && skus[index + 1]?.item_group?.id !== sku.item_group.id ? styles.groupMemberLast : {}]} wrap={false}>
              {/* product cell */}
              <View style={[styles.cProd, sku.item_group ? styles.groupMemberProduct : {}]}>
                <Text style={styles.prodName}>{sku.name}</Text>
                <Text style={styles.prodMeta}>
                  <Text style={styles.prodMetaCode}>{sku.code}</Text>
                  {sku.pack != null && sku.pack.length > 0 ? ` · ${sku.pack}` : ""}
                  {sku.included_services?.length ? ` · Includes ${sku.included_services.join(", ")}` : ""}
                  {/* Why the member quantity exceeds the finished-good
                      quantity. Shown ONLY above 1 — "×1 per unit" is noise on
                      every ordinary line, and the absence of a qualifier is
                      itself the statement that one unit takes one. */}
                  {typeof sku.multiplicity_per_unit === "number" &&
                  sku.multiplicity_per_unit > 1
                    ? ` · ×${sku.multiplicity_per_unit} per unit`
                    : ""}
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
                const lt = lineTotal(sku, tiers, ti);
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
                    {sku.tier_quantities?.[ti] != null ? <Text style={styles.linetotal}>{sku.tier_quantities[ti]!.toLocaleString()} units</Text> : null}
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
            </Fragment>
          );
        })}
      </View>
    </View>
  );
}
