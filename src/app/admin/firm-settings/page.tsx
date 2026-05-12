import { desc } from "drizzle-orm";
import { db } from "@/db";
import { firmSettings, users } from "@/db/schema";
import { requireAdminPage } from "@/lib/admin-guard";
import {
  getFirmPortfolioBands,
  type PortfolioBands,
} from "@/app/actions/firm-settings";
import { FirmSettingsForm } from "./firm-settings-form";
import { CustomerFacingDefaultsForm } from "./customer-facing-defaults-form";

// Slice RI.8 step 3 — Firm settings Round 5 rebuild per brief §3.10.
// R5 source: docs/design-prototypes/dist/source/round-5/e46652c1.js +
// r5-admin.css.
//
// Key Round 5 commitments landed in this step:
// - R5 page-head (eyebrow + italic "margin policy" h1 + sub).
// - Two-column grid: current-policy card + history rail sidebar.
// - Two-state read/edit on a single page (FirmSettingsForm renders
//   either the read-state portfolio strip or the edit-state inputs
//   + live re-band preview). Single page matches Edward's actual
//   workflow: peek at history → open edit → watch preview → commit.
// - Portfolio effect strip (read state): live count of sent quotes
//   bucketed by current target/floor margin.
// - Re-band preview engine (edit state): see previewFirmSettingsReband
//   action — recomputes bucket counts under hypothetical new
//   target/floor and surfaces newly-below-target/floor sample list.
// - "Save & re-band N quotes" button names the side effect plainly
//   per R5 brief (Designer note: the explicit consequence-naming
//   replaces a confirm modal).
// - Customer-facing defaults retained as a separate section below
//   (out-of-R5-scope; lives here because both edit the same
//   firm_settings versioned row).

function fmtRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1d ago";
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function pctDisplay(d: string | null): string {
  if (d === null) return "—";
  const n = Number(d) * 100;
  if (!Number.isFinite(n)) return "—";
  return `${Number(n.toFixed(4))}`;
}

function valueOrDash(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const s = String(v);
  return s === "" ? "—" : s;
}

export default async function FirmSettingsAdminPage() {
  await requireAdminPage();

  const rows = await db
    .select()
    .from(firmSettings)
    .orderBy(desc(firmSettings.effectiveFrom));
  const current = rows.find((r) => r.effectiveUntil === null) ?? null;
  const history = rows.filter((r) => r.effectiveUntil !== null);

  // Resolve user emails for history items (display: who made the change)
  const userMap = new Map<string, string>();
  const hasAnyUpdater = rows.some((r) => r.updatedByUserId !== null);
  if (hasAnyUpdater) {
    const all = await db.select().from(users);
    for (const u of all) userMap.set(u.id, u.email);
  }

  // Portfolio bands — live count of sent quotes by margin band.
  // Best-effort: if computation fails (e.g. orphaned quotes during
  // dev), the page still renders with placeholder. Production has
  // small N (~50 quotes); sequential cost is fine.
  let portfolio: PortfolioBands | null = null;
  if (current) {
    const r = await getFirmPortfolioBands();
    if (r.ok) portfolio = r.data;
  }

  // Effective-from "29D" style age string per R5 source ("EFFECTIVE
  // 2025-04-15 · 29D"). Compute days since effective_from.
  let effectiveAgeDays = 0;
  if (current?.effectiveFrom) {
    const d = new Date(current.effectiveFrom);
    effectiveAgeDays = Math.max(
      0,
      Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)),
    );
  }

  return (
    <div className="r5-page">
      <div className="r5-page-head">
        <p className="eyebrow">Admin · Firm policy</p>
        <h1>
          Firm <em>margin policy</em>
        </h1>
        <p className="sub">
          Two numbers govern every quote: the{" "}
          <strong style={{ color: "var(--ink)" }}>target</strong> we aim to
          exceed, and the <strong style={{ color: "var(--ink)" }}>floor</strong>{" "}
          below which an override DM to the firm owner is required. Changes
          apply to all open quotes in real time and are recorded in the audit
          log.
        </p>
      </div>

      {current ? (
        <FirmSettingsForm
          current={{
            targetMarginPct: current.targetMarginPct,
            floorMarginPct: current.floorMarginPct,
            effectiveFrom: current.effectiveFrom,
          }}
          history={history.map((h) => ({
            effectiveFrom: h.effectiveFrom,
            effectiveUntil: h.effectiveUntil,
            targetMarginPct: h.targetMarginPct,
            floorMarginPct: h.floorMarginPct,
            by: h.updatedByUserId ? userMap.get(h.updatedByUserId) ?? "—" : "—",
          }))}
          currentBy={
            current.updatedByUserId
              ? userMap.get(current.updatedByUserId) ?? "—"
              : "—"
          }
          effectiveAgeDays={effectiveAgeDays}
          portfolio={portfolio}
        />
      ) : (
        // Initial-setup branch — no current row yet. Render a simpler
        // single-card setup with just the inputs.
        <div className="r5-fs-card">
          <div className="row-head">
            <h2>Set initial margin policy</h2>
          </div>
          <FirmSettingsForm
            current={null}
            history={[]}
            currentBy="—"
            effectiveAgeDays={0}
            portfolio={null}
          />
        </div>
      )}

      {/* Customer-facing defaults — separate section, RI.7 (not R5-scoped) */}
      {current && (
        <section
          className="r5-fs-card"
          style={{ marginTop: 24 }}
        >
          <div className="row-head">
            <h2>Customer-facing defaults</h2>
            <span className="effective">VENDOR + COMMERCIAL DEFAULTS</span>
          </div>
          <CustomerFacingDefaultsForm
            current={{
              vendorName: current.vendorName,
              vendorTagline: current.vendorTagline,
              vendorAddress: current.vendorAddress,
              quoteNumberPrefix: current.quoteNumberPrefix,
              tcsDefault: current.tcsDefault,
              paymentTermsDefault: current.paymentTermsDefault,
              leadTimeDefault: current.leadTimeDefault,
              incotermsDefault: current.incotermsDefault,
              daysValidDefault: current.daysValidDefault,
            }}
          />
        </section>
      )}

      {/* Current-row summary for verification (compact) */}
      {current && (
        <details
          className="r5-fs-card"
          style={{ marginTop: 24 }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontFamily: "var(--display)",
              fontWeight: 500,
              fontSize: 14,
              color: "var(--ink)",
            }}
          >
            Current row · raw values
          </summary>
          <dl
            className="grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "14px 24px",
              marginTop: 16,
              fontSize: 12.5,
            }}
          >
            <div>
              <dt
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--ink-4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 2,
                }}
              >
                Target margin
              </dt>
              <dd style={{ margin: 0, fontFamily: "var(--mono)" }}>
                {pctDisplay(current.targetMarginPct)}%
              </dd>
            </div>
            <div>
              <dt
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--ink-4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 2,
                }}
              >
                Floor margin
              </dt>
              <dd style={{ margin: 0, fontFamily: "var(--mono)" }}>
                {pctDisplay(current.floorMarginPct)}%
              </dd>
            </div>
            <div>
              <dt
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--ink-4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 2,
                }}
              >
                Effective from
              </dt>
              <dd style={{ margin: 0, fontFamily: "var(--mono)" }}>
                {current.effectiveFrom}
              </dd>
            </div>
            <div>
              <dt
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--ink-4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 2,
                }}
              >
                Firm name
              </dt>
              <dd style={{ margin: 0 }}>{valueOrDash(current.vendorName)}</dd>
            </div>
            <div>
              <dt
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--ink-4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 2,
                }}
              >
                Quote # prefix
              </dt>
              <dd style={{ margin: 0 }}>
                {valueOrDash(current.quoteNumberPrefix)}
              </dd>
            </div>
            <div>
              <dt
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--ink-4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 2,
                }}
              >
                Days valid
              </dt>
              <dd style={{ margin: 0 }}>
                {valueOrDash(current.daysValidDefault)}
              </dd>
            </div>
          </dl>
        </details>
      )}

      {/* Below-the-fold designer note */}
      <div className="r5-dn" style={{ marginTop: 18 }}>
        <span className="lbl">Designer note</span>
        The &ldquo;Save &amp; re-band N quotes&rdquo; button names the side
        effect plainly. We considered a soft Save with a silent recompute
        — that hides what happens. Naming the consequence on the button is
        how we make this safe to use without a confirm modal. Portfolio +
        re-band counts compute live by iterating every sent/accepted quote;
        if portfolio grows past ~200, swap to a cached blended_margin column
        refreshed at sendQuote time.
      </div>
    </div>
  );
}
