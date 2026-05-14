import type {
  CustomerViewSku,
  CustomerViewTier,
  CustomerViewPdfLayout,
} from "@/types/quote";

function fmtUSD(n: number) {
  return (
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function fmtQty(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return n.toLocaleString("en-US");
}

const tierSubheadStyle = {
  fontSize: 9,
  fontWeight: 400,
  color: "oklch(0.55 0.02 255)",
  marginTop: 2,
  letterSpacing: "0.04em",
} as const;

const skuPackStyle = {
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 10,
  color: "oklch(0.50 0.02 255)",
  letterSpacing: "0.04em",
  marginTop: 2,
} as const;

const flatNoteStyle = {
  fontSize: 10,
  color: "oklch(0.50 0.02 255)",
  marginLeft: 6,
  fontStyle: "italic",
  fontFamily: "Newsreader, serif",
} as const;

export function PdfPricingTable({
  tiers,
  skus,
  recommendedTierIdx,
  pdfLayout,
}: {
  tiers: ReadonlyArray<CustomerViewTier>;
  skus: ReadonlyArray<CustomerViewSku>;
  recommendedTierIdx: number | null;
  pdfLayout: CustomerViewPdfLayout;
}) {
  const isSingle = pdfLayout === "single_tier" && recommendedTierIdx !== null;
  const cols = isSingle ? [tiers[recommendedTierIdx!]] : tiers;

  // Maps a column-index in the rendered cols array → the index in
  // the full sku.tierPrices array. Single-tier mode flattens to one
  // column whose price index is recommendedTierIdx.
  const colIdx = (i: number): number =>
    isSingle ? recommendedTierIdx! : i;

  return (
    <table className="pdf-pricing">
      <thead>
        <tr>
          <th>Product</th>
          {cols.map((t, i) => (
            <th key={t.id}>
              {isSingle ? "Unit price" : t.label}
              <div style={tierSubheadStyle}>
                {fmtQty(t.quantity)} units
                {isSingle ? " · recommended" : ""}
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {skus.map((sku) => {
          const isFlat = sku.shape === "flat";
          return (
            <tr key={sku.label}>
              <td>
                <div style={{ fontWeight: 500 }}>{sku.name}</div>
                {/* Pattern 45 (customer-facing render data-source
                    verification) — caption suppressed entirely when
                    pack is null. Same graceful-degradation shape as
                    preparedBy.phone in PdfHeader. Synthetic
                    "{pack-format-pending}" placeholder removed in
                    rest-of-app sweep Step 10 audit. */}
                {sku.pack ? (
                  <div style={skuPackStyle}>{sku.pack}</div>
                ) : null}
              </td>
              {cols.map((_, ii) => {
                const i = colIdx(ii);
                const price = sku.tierPrices[i];
                if (price === null || price === undefined) {
                  return (
                    <td key={ii} className="unpriced">
                      quote on request
                    </td>
                  );
                }
                if (isFlat && !isSingle) {
                  if (i === 0) {
                    return (
                      <td key={ii}>
                        <div>
                          {fmtUSD(price)}
                          <span style={flatNoteStyle}>
                            flat across all tiers
                          </span>
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td
                      key={ii}
                      style={{ color: "oklch(0.55 0.02 255)" }}
                    >
                      —
                    </td>
                  );
                }
                return <td key={ii}>{fmtUSD(price)}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
