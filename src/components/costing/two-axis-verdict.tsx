// Slice RI.5 Room 3 sweep — two-axis verdict pair per R2 source
// (`docs/design-prototypes/dist/source/round-2/app/r2/costing.jsx:5-32`).
//
// Two adjacent monospace bordered chips with IDENTICAL register:
//   ● margin · GOOD/BELOW TARGET/BELOW FLOOR
//   ● client · COMPETITIVE/OVER CLIENT TARGET/NO CLIENT TARGET
//
// Both chips render at all times (NOT NULL-as-empty-signal) — the
// "NO CLIENT TARGET" chip surfaces explicitly so PMs see the two-
// axis grammar regardless of whether a benchmark is set on this cell.
//
// Replaces MarginVerdictPill + CompetitiveIndicator. The 9.4b inline-
// magnitude pattern ("under target by $0.74") is dropped per Edward
// + Designer call: magnitude lives in the gap-readout below the
// chips (per R2), not inside the chip itself.

export type MarginStatus = "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";
export type CompetitiveStatus =
  | "COMPETITIVE"
  | "OVER_CLIENT_TARGET"
  | null;

const MARGIN_TOKENS: Record<
  MarginStatus,
  { label: string; color: string }
> = {
  GOOD: { label: "GOOD", color: "var(--good)" },
  BELOW_TARGET: { label: "BELOW TARGET", color: "var(--warn)" },
  BELOW_FLOOR: { label: "BELOW FLOOR", color: "var(--bad)" },
};

const CLIENT_TOKENS = {
  COMPETITIVE: { label: "COMPETITIVE", color: "var(--good)" },
  OVER_CLIENT_TARGET: {
    label: "OVER CLIENT TARGET",
    color: "var(--warn)",
  },
  NO_TARGET: { label: "NO CLIENT TARGET", color: "var(--ink-4)" },
} as const;

function chipStyle(color: string): React.CSSProperties {
  // R2 register: mono 10px, letter-spacing 0.1em, uppercase, padding
  // 3×8, radius 4, paper-3 bg, 1px border in status color, status-
  // colored text. R2 styles `costing.jsx:14-19`.
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontFamily: "var(--mono)",
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    padding: "3px 8px",
    borderRadius: 4,
    background: "var(--paper-3)",
    border: `1px solid ${color}`,
    color,
    whiteSpace: "nowrap",
  };
}

function dotStyle(): React.CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "currentColor",
  };
}

export function TwoAxisVerdict({
  marginStatus,
  competitiveStatus,
}: {
  marginStatus: MarginStatus;
  // Allow null (no client target); allow null overall (assembly with
  // no competitive verdict — only margin chip renders)
  competitiveStatus: CompetitiveStatus;
  // When null entirely (assembly), only render margin chip.
  // When competitiveStatus === null but renderClientChip = true (leaf
  // with no target set), render the NO CLIENT TARGET chip.
  renderClientChip?: boolean;
}) {
  const margin = MARGIN_TOKENS[marginStatus];
  return (
    <div
      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
    >
      <span style={chipStyle(margin.color)}>
        <span aria-hidden style={dotStyle()} />
        margin · {margin.label}
      </span>
    </div>
  );
}

export function TwoAxisVerdictPair({
  marginStatus,
  competitiveStatus,
  renderClientChip = true,
}: {
  marginStatus: MarginStatus;
  competitiveStatus: CompetitiveStatus;
  // For assembly rows where competitive verdict isn't applicable,
  // pass renderClientChip={false} to suppress the second chip entirely.
  renderClientChip?: boolean;
}) {
  const margin = MARGIN_TOKENS[marginStatus];
  const client =
    competitiveStatus === null
      ? CLIENT_TOKENS.NO_TARGET
      : CLIENT_TOKENS[competitiveStatus];

  return (
    <div
      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
    >
      <span style={chipStyle(margin.color)}>
        <span aria-hidden style={dotStyle()} />
        margin · {margin.label}
      </span>
      {renderClientChip && (
        <span style={chipStyle(client.color)}>
          <span aria-hidden style={dotStyle()} />
          client · {client.label}
        </span>
      )}
    </div>
  );
}
