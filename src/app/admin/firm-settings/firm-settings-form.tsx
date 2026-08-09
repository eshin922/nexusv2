"use client";

import { useState, useTransition } from "react";
import {
  previewFirmSettingsReband,
  updateFirmSettings,
  type PortfolioBands,
  type RebandPreview,
} from "@/app/actions/firm-settings";
import { validatePercentDecimal } from "@/lib/percent-validation";

// Slice RI.8 step 3 — Round 5 firm-policy read/edit two-state form.
//
// R5 source: docs/design-prototypes/dist/source/round-5/e46652c1.js.
// Single page, two states (Read + Edit) flipped by an Edit policy
// button. Read state shows current target+floor with portfolio-effect
// strip. Edit state shows inputs + live re-band preview that bins
// existing sent quotes against the proposed new bands. Save names the
// side effect plainly ("Save & re-band 24 quotes") per Designer note.
//
// History rail (sidebar) is rendered here too — it's prop-driven from
// the server but lives inside this client component so the Edit button
// can sit beneath it.
//
// Customer-facing defaults form is a sibling on the page (not embedded
// here); they edit different columns of the same versioned row, but
// the R5 design treats firm-policy as the centerpiece.

type HistoryItem = {
  effectiveFrom: string;
  effectiveUntil: string | null;
  targetMarginPct: string;
  floorMarginPct: string;
  by: string;
};

function decimalToPctDisplay(d: string | null): string {
  if (d === null) return "";
  const n = Number(d) * 100;
  if (!Number.isFinite(n)) return "";
  return Number(n.toFixed(4)).toString();
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtPctAt0Decimal(d: string | null): string {
  if (d === null) return "—";
  const n = Number(d) * 100;
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(0);
}

function bandLabel(b: "good" | "belowTarget" | "belowFloor"): string {
  if (b === "good") return "good";
  if (b === "belowTarget") return "warn";
  return "bad";
}

export function FirmSettingsForm({
  current,
  history,
  currentBy,
  effectiveAgeDays,
  portfolio,
}: {
  current: {
    targetMarginPct: string;
    floorMarginPct: string;
    effectiveFrom: string;
  } | null;
  history: HistoryItem[];
  currentBy: string;
  effectiveAgeDays: number;
  portfolio: PortfolioBands | null;
}) {
  const [isEdit, setIsEdit] = useState(current === null); // initial-setup forces edit
  const currentTarget = decimalToPctDisplay(current?.targetMarginPct ?? null);
  const currentFloor = decimalToPctDisplay(current?.floorMarginPct ?? null);
  const [target, setTarget] = useState(currentTarget);
  const [floor, setFloor] = useState(currentFloor);
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<RebandPreview | null>(null);
  const [, startPreview] = useTransition();

  function clientValidate(): string | null {
    const tDec = target === "" ? null : Number(target) / 100;
    const fDec = floor === "" ? null : Number(floor) / 100;
    if (tDec === null) return "Target margin is required.";
    if (fDec === null) return "Floor margin is required.";
    const tv = validatePercentDecimal(tDec, "rate");
    if (!tv.valid) return `Target: ${tv.message}`;
    const fv = validatePercentDecimal(fDec, "rate");
    if (!fv.valid) return `Floor: ${fv.message}`;
    if (!(tDec > 0 && tDec < 1))
      return "Target margin must be between 0% and 100%.";
    if (!(fDec > 0 && fDec < 1))
      return "Floor margin must be between 0% and 100%.";
    if (!(fDec < tDec))
      return "Floor margin must be less than target margin.";
    return null;
  }

  function refreshPreview(tStr: string, fStr: string) {
    if (tStr === "" || fStr === "") {
      setPreview(null);
      return;
    }
    const tDec = Number(tStr) / 100;
    const fDec = Number(fStr) / 100;
    if (!Number.isFinite(tDec) || !Number.isFinite(fDec)) {
      setPreview(null);
      return;
    }
    // Skip preview when proposed == current — nothing to re-band.
    if (current && tStr === currentTarget && fStr === currentFloor) {
      setPreview(null);
      return;
    }
    startPreview(async () => {
      const r = await previewFirmSettingsReband(String(tDec), String(fDec));
      if (r.ok) setPreview(r.data);
    });
  }

  function onTargetChange(v: string) {
    setTarget(v);
    setError(null);
    refreshPreview(v, floor);
  }
  function onFloorChange(v: string) {
    setFloor(v);
    setError(null);
    refreshPreview(target, v);
  }

  function onCancel() {
    setIsEdit(false);
    setTarget(currentTarget);
    setFloor(currentFloor);
    setPreview(null);
    setError(null);
    setSuccess(null);
  }

  function onSave() {
    setError(null);
    setSuccess(null);
    const v = clientValidate();
    if (v) {
      setError(v);
      return;
    }
    const fd = new FormData();
    fd.set("targetMarginPct", target);
    fd.set("floorMarginPct", floor);
    fd.set("effectiveFrom", effectiveFrom);
    startTransition(async () => {
      const r = await updateFirmSettings(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setSuccess(
        `Saved. New current row effective from ${r.data.effectiveFrom}.`,
      );
      setIsEdit(false);
      setPreview(null);
    });
  }

  // Compute delta labels for input fields
  const targetDelta = (() => {
    if (target === "" || current === null) return null;
    const newN = Number(target);
    const oldN = Number(currentTarget);
    if (!Number.isFinite(newN) || !Number.isFinite(oldN)) return null;
    const d = +(newN - oldN).toFixed(2);
    if (d === 0) return { sign: "same" as const, text: "— unchanged" };
    if (d > 0)
      return {
        sign: "up" as const,
        text: `▲ +${d.toFixed(1)} pts vs. current ${oldN.toFixed(0)}%`,
      };
    // Designer audit M3 — arrow encodes direction; drop redundant minus
    // sign to avoid double-marking (was "▼ -5.0 pts" → now "▼ 5.0 pts").
    return {
      sign: "down" as const,
      text: `▼ ${Math.abs(d).toFixed(1)} pts vs. current ${oldN.toFixed(0)}%`,
    };
  })();
  const floorDelta = (() => {
    if (floor === "" || current === null) return null;
    const newN = Number(floor);
    const oldN = Number(currentFloor);
    if (!Number.isFinite(newN) || !Number.isFinite(oldN)) return null;
    const d = +(newN - oldN).toFixed(2);
    if (d === 0) return { sign: "same" as const, text: "— unchanged" };
    if (d > 0)
      return {
        sign: "up" as const,
        text: `▲ +${d.toFixed(1)} pts vs. current ${oldN.toFixed(0)}%`,
      };
    return {
      sign: "down" as const,
      text: `▼ ${Math.abs(d).toFixed(1)} pts vs. current ${oldN.toFixed(0)}%`,
    };
  })();

  const saveButtonLabel = (() => {
    if (pending) return "Saving…";
    if (!preview) return "Save policy";
    const n = preview.changingBandCount;
    if (n === 0) return "Save policy · no band changes";
    return `Save & re-band ${n} quote${n === 1 ? "" : "s"}`;
  })();

  return (
    <div className="r5-fs-grid">
      <div>
        {isEdit && current && (
          <div className="r5-fs-edit">
            <h2>Edit policy</h2>
            <p className="lead">
              {targetDelta || floorDelta ? (
                <>
                  You&rsquo;re proposing{" "}
                  {targetDelta && targetDelta.sign !== "same" && (
                    <strong style={{ color: "var(--ink)" }}>
                      target {fmtPctAt0Decimal(current.targetMarginPct)}% →{" "}
                      {target}%
                    </strong>
                  )}
                  {targetDelta &&
                    targetDelta.sign !== "same" &&
                    floorDelta &&
                    floorDelta.sign !== "same" &&
                    ", "}
                  {floorDelta && floorDelta.sign !== "same" && (
                    <strong style={{ color: "var(--ink)" }}>
                      floor {fmtPctAt0Decimal(current.floorMarginPct)}% →{" "}
                      {floor}%
                    </strong>
                  )}
                  . We re-band live quotes against the new policy when you
                  save — preview is below.
                </>
              ) : (
                <>
                  Edit the target or floor margin to preview the re-band
                  effect on existing sent quotes.
                </>
              )}
            </p>
            <div className="inputs">
              <div className="field">
                <div className="lbl">Target margin</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min={0}
                    value={target}
                    onChange={(e) => onTargetChange(e.target.value)}
                    aria-label="Target margin percent"
                  />
                  <span
                    style={{
                      fontFamily: "var(--display)",
                      fontWeight: 500,
                      fontSize: 24,
                      color: "var(--ink-3)",
                    }}
                  >
                    %
                  </span>
                </div>
                {targetDelta && (
                  <div className={`delta ${targetDelta.sign}`}>
                    {targetDelta.text}
                  </div>
                )}
              </div>
              <div className="field">
                <div className="lbl">Floor margin</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min={0}
                    value={floor}
                    onChange={(e) => onFloorChange(e.target.value)}
                    aria-label="Floor margin percent"
                  />
                  <span
                    style={{
                      fontFamily: "var(--display)",
                      fontWeight: 500,
                      fontSize: 24,
                      color: "var(--ink-3)",
                    }}
                  >
                    %
                  </span>
                </div>
                {floorDelta && (
                  <div className={`delta ${floorDelta.sign}`}>
                    {floorDelta.text}
                  </div>
                )}
              </div>
            </div>
            <div className="foot">
              <div className="effective-pick">
                Effective{" "}
                <strong style={{ color: "var(--ink)" }}>immediately</strong>
                <input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  style={{
                    marginLeft: 8,
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--accent-ink)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="ghost"
                  onClick={onCancel}
                  disabled={pending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={onSave}
                  disabled={pending || target === "" || floor === ""}
                >
                  {saveButtonLabel}
                </button>
              </div>
            </div>
            {error && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  color: "var(--bad)",
                  fontSize: 12.5,
                  fontWeight: 500,
                }}
              >
                {error}
              </div>
            )}

            {preview && preview.changingBandCount > 0 && (
              <div className="r5-fs-preview">
                <div className="eyebrow">
                  Re-band preview · target{" "}
                  {(preview.currentTargetPct * 100).toFixed(0)} →{" "}
                  {(preview.newTargetPct * 100).toFixed(0)}
                  {preview.currentFloorPct !== preview.newFloorPct && (
                    <>
                      {" "}· floor {(preview.currentFloorPct * 100).toFixed(0)}{" "}
                      → {(preview.newFloorPct * 100).toFixed(0)}
                    </>
                  )}
                </div>
                <h3>
                  {preview.changingBandCount} quote
                  {preview.changingBandCount === 1 ? "" : "s"} change band.{" "}
                  {preview.newlyBelowFloorCount} newly drop
                  {preview.newlyBelowFloorCount === 1 ? "s" : ""} below floor.
                </h3>
                <p>
                  Live quotes are re-evaluated against the new bands the moment
                  you save. The blended margin itself doesn&rsquo;t change —
                  only what colour it earns and whether the gate trips.
                </p>
                <div className="reband">
                  <div className="col">
                    <div className="delta">≥ Target</div>
                    <div className="nums">
                      <span className="from">{preview.currentBands.good}</span>
                      <span className="arrow">→</span>
                      <span
                        className={`to ${
                          preview.newBands.good < preview.currentBands.good
                            ? "warn"
                            : "good"
                        }`}
                      >
                        {preview.newBands.good}
                      </span>
                    </div>
                  </div>
                  <div className="col">
                    <div className="delta">Below target</div>
                    <div className="nums">
                      <span className="from">
                        {preview.currentBands.belowTarget}
                      </span>
                      <span className="arrow">→</span>
                      <span
                        className={`to ${
                          preview.newBands.belowTarget >
                          preview.currentBands.belowTarget
                            ? "warn"
                            : "good"
                        }`}
                      >
                        {preview.newBands.belowTarget}
                      </span>
                    </div>
                  </div>
                  <div className="col">
                    <div className="delta">Below floor</div>
                    <div className="nums">
                      <span className="from">
                        {preview.currentBands.belowFloor}
                      </span>
                      <span className="arrow">→</span>
                      <span
                        className={`to ${
                          preview.newBands.belowFloor >
                          preview.currentBands.belowFloor
                            ? "bad"
                            : "good"
                        }`}
                      >
                        {preview.newBands.belowFloor}
                      </span>
                    </div>
                  </div>
                </div>

                {preview.newlyBelowTarget.length > 0 && (
                  <div className="affected">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                      }}
                    >
                      <span>
                        NEWLY BELOW TARGET — {preview.newlyBelowTarget.length}
                        {preview.newlyBelowTarget.length === 5 &&
                          preview.changingBandCount > 5 &&
                          "+"}{" "}
                        QUOTE
                        {preview.newlyBelowTarget.length === 1 ? "" : "S"}
                      </span>
                    </div>
                    <ul>
                      {preview.newlyBelowTarget.map((q) => (
                        <li key={q.quoteId}>
                          <div className="nm">
                            <em>{q.projectName}</em> · {q.scenarioLabel} v
                            {q.versionNumber}
                          </div>
                          <div className="m">
                            {(q.blendedMarginPct * 100).toFixed(1)}%
                          </div>
                          <div className="arrow">
                            {bandLabel(q.fromBand)} → {bandLabel(q.toBand)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview.newlyBelowFloor.length > 0 && (
                  <div className="affected">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                      }}
                    >
                      <span>
                        NEWLY BELOW FLOOR — {preview.newlyBelowFloor.length}
                        {preview.newlyBelowFloor.length === 5 &&
                          preview.newlyBelowFloorCount > 5 &&
                          "+"}{" "}
                        QUOTE
                        {preview.newlyBelowFloor.length === 1 ? "" : "S"}
                      </span>
                    </div>
                    <ul>
                      {preview.newlyBelowFloor.map((q) => (
                        <li key={q.quoteId}>
                          <div className="nm">
                            <em>{q.projectName}</em> · {q.scenarioLabel} v
                            {q.versionNumber}
                          </div>
                          <div className="m">
                            {(q.blendedMarginPct * 100).toFixed(1)}%
                          </div>
                          <div className="arrow">
                            {bandLabel(q.fromBand)} → bad
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {current && (
          <div className="r5-fs-card">
            <div className="row-head">
              <h2>Current policy</h2>
              <span className="effective">
                EFFECTIVE {current.effectiveFrom.toUpperCase()} ·{" "}
                {effectiveAgeDays}D
              </span>
            </div>
            <div className="r5-fs-values">
              <div className="r5-fs-value target">
                <div className="lbl">Target margin</div>
                <div className="num">
                  {fmtPctAt0Decimal(current.targetMarginPct)}
                  <span className="pct">%</span>
                </div>
                <div className="meta">
                  Quotes at or above target are{" "}
                  <span className="strong">healthy green</span> in the margin
                  gate.
                </div>
              </div>
              <div className="r5-fs-value floor">
                <div className="lbl">Floor margin</div>
                <div className="num">
                  {fmtPctAt0Decimal(current.floorMarginPct)}
                  <span className="pct">%</span>
                </div>
                <div className="meta">
                  Below this, sending requires an override DM to the firm
                  owner.
                </div>
              </div>
            </div>

            {!isEdit && portfolio && (
              <div className="r5-fs-portfolio">
                <div className="lhs">
                  <strong>Portfolio effect — live.</strong> Across{" "}
                  {portfolio.totalQuotes} sent quote
                  {portfolio.totalQuotes === 1 ? "" : "s"} against today&rsquo;s
                  policy:
                </div>
                <div className="nums">
                  <span className="good">
                    <span className="pip" />
                    {portfolio.good} ≥
                    {fmtPctAt0Decimal(current.targetMarginPct)}%
                  </span>
                  <span className="warn">
                    <span className="pip" />
                    {portfolio.belowTarget}{" "}
                    {fmtPctAt0Decimal(current.floorMarginPct)}–
                    {fmtPctAt0Decimal(current.targetMarginPct)}%
                  </span>
                  <span className="bad">
                    <span className="pip" />
                    {portfolio.belowFloor} &lt;
                    {fmtPctAt0Decimal(current.floorMarginPct)}%
                  </span>
                  {/* Both no-margin counts render only when non-zero, so the
                      ordinary page is unchanged. They are shown at all because
                      the three bands are presented against `totalQuotes`: if
                      quotes are excluded from every band and never named, the
                      numbers stop adding up and the reader has no way to see
                      why. */}
                  {portfolio.costWithoutRevenue > 0 && (
                    <span className="bad">
                      <span className="pip" />
                      {portfolio.costWithoutRevenue} cost, no revenue
                    </span>
                  )}
                  {portfolio.unassessed > 0 && (
                    <span>
                      <span className="pip" />
                      {portfolio.unassessed} not assessed
                    </span>
                  )}
                </div>
              </div>
            )}

            {!isEdit && !portfolio && (
              <div className="r5-fs-portfolio" style={{ opacity: 0.6 }}>
                <div className="lhs">
                  <strong>Portfolio effect.</strong> No sent quotes yet —
                  bands will populate once quotes are sent.
                </div>
              </div>
            )}

            {success && (
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "oklch(from var(--good) l c h / 0.10)",
                  border: "1px solid oklch(from var(--good) l c h / 0.30)",
                  color: "var(--good)",
                  fontSize: 12.5,
                  fontWeight: 500,
                }}
              >
                {success}
              </div>
            )}
          </div>
        )}

        {!current && (
          <div style={{ marginTop: 0 }}>
            <div className="inputs" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <label style={{ display: "block" }}>
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    letterSpacing: "0.10em",
                    textTransform: "uppercase",
                    color: "var(--ink-4)",
                    marginBottom: 6,
                  }}
                >
                  Target margin
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "1px solid var(--rule)",
                    borderRadius: 6,
                    fontFamily: "var(--mono)",
                  }}
                />
              </label>
              <label style={{ display: "block" }}>
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    letterSpacing: "0.10em",
                    textTransform: "uppercase",
                    color: "var(--ink-4)",
                    marginBottom: 6,
                  }}
                >
                  Floor margin
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  value={floor}
                  onChange={(e) => setFloor(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "1px solid var(--rule)",
                    borderRadius: 6,
                    fontFamily: "var(--mono)",
                  }}
                />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button
                type="button"
                onClick={onSave}
                disabled={pending}
                className="primary"
                style={{
                  padding: "8px 16px",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  letterSpacing: "0.05em",
                  color: "var(--accent-ink)",
                  background: "oklch(from var(--accent) l c h / 0.12)",
                  border: "1px solid oklch(from var(--accent) l c h / 0.35)",
                  borderRadius: 6,
                }}
              >
                {pending ? "Saving…" : "Set initial policy"}
              </button>
            </div>
            {error && (
              <div role="alert" style={{ marginTop: 12, color: "var(--bad)", fontSize: 12.5 }}>
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sidebar: history rail + edit CTA */}
      <div>
        <div className="r5-history">
          <h3>
            Policy history{" "}
            <span className="meta">
              {history.length + (current ? 1 : 0)} CHANGE
              {history.length + (current ? 1 : 0) === 1 ? "" : "S"}
            </span>
          </h3>

          {current && (
            <div className="item current">
              <div>
                <div className="vals">
                  <span className="target">
                    target {fmtPctAt0Decimal(current.targetMarginPct)}%
                  </span>
                  <span className="sep">·</span>
                  <span className="floor">
                    floor {fmtPctAt0Decimal(current.floorMarginPct)}%
                  </span>
                </div>
                <div className="who">
                  {currentBy}
                  <span style={{ color: "var(--good)", marginLeft: 8 }}>
                    · current
                  </span>
                </div>
              </div>
              <div>
                <div className="when">{current.effectiveFrom}</div>
              </div>
            </div>
          )}

          {history.slice(0, 4).map((h, i) => (
            // Slice RI.8 step 11 fix — composite key. effectiveFrom
            // alone collides when multiple versions land on the same
            // day (the common case — every save uses today's date for
            // effective_from). Combine with effectiveUntil for
            // disambiguation; fall back to index for the (now
            // impossible) duplicate-both-bounds edge case.
            <div
              key={`${h.effectiveFrom}::${h.effectiveUntil ?? "null"}::${i}`}
              className="item"
            >
              <div>
                <div className="vals">
                  <span className="target">
                    target {fmtPctAt0Decimal(h.targetMarginPct)}%
                  </span>
                  <span className="sep">·</span>
                  <span className="floor">
                    floor {fmtPctAt0Decimal(h.floorMarginPct)}%
                  </span>
                </div>
                <div className="who">{h.by}</div>
              </div>
              <div>
                <div className="when">{h.effectiveFrom}</div>
                {h.effectiveUntil && (
                  <div className="when" style={{ color: "var(--ink-3)" }}>
                    → {h.effectiveUntil}
                  </div>
                )}
              </div>
            </div>
          ))}

          {history.length > 4 && (
            <div
              style={{
                display: "block",
                marginTop: 10,
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--ink-3)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                textAlign: "center",
              }}
            >
              + {history.length - 4} earlier
            </div>
          )}
        </div>

        {current && !isEdit && (
          <button
            type="button"
            className="r5-fs-edit-cta"
            onClick={() => setIsEdit(true)}
          >
            Edit policy
          </button>
        )}
      </div>
    </div>
  );
}
