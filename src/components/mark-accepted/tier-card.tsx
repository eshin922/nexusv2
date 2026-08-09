"use client";

function fmtUSD(n: number, dec = 2) {
  return (
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    })
  );
}

export type TierCardData = {
  id: string;
  label: string;
  qty: number;
  unitPrice: number;
  total: number;
  /** Percent units (0..100), or null when the tier has no revenue. */
  marginPct: number | null;
  /**
   * `none` when the tier has no margin — the neutral register, distinct from
   * `bad`. Measured-and-failing and never-measured must not look the same.
   */
  status: "good" | "warn" | "bad" | "none";
  recommended?: boolean;
};

export function TierCard({
  tier,
  selected,
  onSelect,
  disabled,
}: {
  tier: TierCardData;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={
        "tier-card" +
        (selected ? " selected" : "") +
        (disabled ? " disabled" : "")
      }
      onClick={disabled ? undefined : onSelect}
      role="button"
      tabIndex={disabled ? -1 : 0}
    >
      <div className="radio" />
      <div>
        <div className="tname">{tier.label}</div>
        <div className="tqty">{tier.qty.toLocaleString()} units</div>
      </div>
      <div>
        <div className="tprice">
          {fmtUSD(tier.unitPrice)}
          <span style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: 4 }}>
            /u
          </span>
        </div>
        <div className="tqty" style={{ textAlign: "right" }}>
          Total {fmtUSD(tier.total, 0)}
        </div>
      </div>
      <div>
        <div className={"tmargin " + tier.status}>
          {tier.marginPct === null ? "—" : `${tier.marginPct.toFixed(1)}%`}
        </div>
        <div className="tqty" style={{ textAlign: "right" }}>
          margin
        </div>
      </div>
    </div>
  );
}
