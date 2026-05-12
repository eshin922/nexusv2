import type {
  CustomerViewServiceFee,
  CustomerViewFreightLine,
  CustomerViewTier,
} from "@/types/quote";

function fmtUSD(n: number, decimals = 2) {
  const abs = Math.abs(n);
  const fixed = abs >= 100 ? n.toFixed(0) : n.toFixed(decimals);
  return (
    "$" +
    Number(fixed).toLocaleString("en-US", {
      minimumFractionDigits: abs >= 100 ? 0 : decimals,
      maximumFractionDigits: abs >= 100 ? 0 : decimals,
    })
  );
}

function fmtQty(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return n.toLocaleString("en-US");
}

export function PdfChargesBlock({
  serviceFees,
  freightLines,
  recommendedTierIdx,
  tiers,
}: {
  serviceFees: ReadonlyArray<CustomerViewServiceFee>;
  freightLines: ReadonlyArray<CustomerViewFreightLine>;
  recommendedTierIdx: number | null;
  tiers: ReadonlyArray<CustomerViewTier>;
}) {
  if (serviceFees.length === 0 && freightLines.length === 0) return null;
  const t =
    recommendedTierIdx !== null && recommendedTierIdx < tiers.length
      ? tiers[recommendedTierIdx]
      : null;
  const tierLabel = t ? `${t.label} (${fmtQty(t.quantity)} units)` : "";

  return (
    <div className="pdf-charges">
      <h3 className="pdf-h3">Additional charges</h3>
      <p
        style={{
          fontSize: 11.5,
          color: "oklch(0.45 0.015 255)",
          margin: "0 0 10px",
          fontStyle: "italic",
        }}
      >
        Charges shown for {tierLabel}. Per-tier amounts available on request.
      </p>
      {serviceFees.map((sf) => (
        <div key={sf.id} className="pdf-charge-row">
          <div className="label">
            {sf.label}
            <span className="sub">{sf.sub}</span>
          </div>
          <div className="qty">{sf.qtyLabel}</div>
          <div className="amount">{fmtUSD(sf.amount)}</div>
        </div>
      ))}
      {freightLines.map((fr) => {
        const amt =
          recommendedTierIdx !== null && recommendedTierIdx < fr.tierAmounts.length
            ? fr.tierAmounts[recommendedTierIdx]
            : null;
        return (
          <div key={fr.id} className="pdf-charge-row">
            <div className="label">
              {fr.label}
              <span className="sub">{fr.sub}</span>
            </div>
            <div className="qty">{fr.qtyLabel}</div>
            <div className="amount">
              {amt !== null ? (
                <>
                  {fmtUSD(amt)}
                  <span
                    style={{
                      fontSize: 10,
                      color: "oklch(0.55 0.015 255)",
                      marginLeft: 4,
                    }}
                  >
                    /unit
                  </span>
                </>
              ) : (
                "quote on request"
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
