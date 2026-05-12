import { desc } from "drizzle-orm";
import { db } from "@/db";
import { firmSettings } from "@/db/schema";
import { requireAdminPage } from "@/lib/admin-guard";
import { FirmSettingsForm } from "./firm-settings-form";
import { CustomerFacingDefaultsForm } from "./customer-facing-defaults-form";

function pctDisplay(d: string): string {
  const n = Number(d) * 100;
  if (!Number.isFinite(n)) return "—";
  return `${Number(n.toFixed(4))}%`;
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Firm settings
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Two cards. <strong>Margin policy</strong> drives the
          GOOD / BELOW_TARGET / BELOW_FLOOR thresholds on every quote.{" "}
          <strong>Customer-facing defaults</strong> drives what
          appears on customer-facing PDFs (firm identity, terms,
          lead time, T&amp;Cs).
        </p>
      </header>

      {/* Card 1 — Margin policy */}
      <section className="rounded-md border border-slate-300 bg-white p-5">
        <h2 className="mb-4 text-base font-semibold text-slate-900">
          {current ? "Update margin policy" : "Set initial margin policy"}
        </h2>
        <FirmSettingsForm
          current={
            current
              ? {
                  targetMarginPct: current.targetMarginPct,
                  floorMarginPct: current.floorMarginPct,
                  effectiveFrom: current.effectiveFrom,
                }
              : null
          }
        />
      </section>

      {/* Card 2 — Customer-facing defaults (RI.7) */}
      <section className="rounded-md border border-slate-300 bg-white p-5">
        <h2 className="mb-4 text-base font-semibold text-slate-900">
          Customer-facing defaults
        </h2>
        <CustomerFacingDefaultsForm
          current={
            current
              ? {
                  vendorName: current.vendorName,
                  vendorTagline: current.vendorTagline,
                  vendorAddress: current.vendorAddress,
                  quoteNumberPrefix: current.quoteNumberPrefix,
                  tcsDefault: current.tcsDefault,
                  paymentTermsDefault: current.paymentTermsDefault,
                  leadTimeDefault: current.leadTimeDefault,
                  incotermsDefault: current.incotermsDefault,
                  daysValidDefault: current.daysValidDefault,
                }
              : null
          }
        />
      </section>

      {/* Current row summary */}
      {current && (
        <section className="rounded-md border border-slate-300 bg-white p-5">
          <h2 className="mb-3 text-base font-semibold text-slate-900">
            Current row
          </h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Target margin
              </dt>
              <dd className="font-medium text-slate-900">
                {pctDisplay(current.targetMarginPct)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Floor margin
              </dt>
              <dd className="font-medium text-slate-900">
                {pctDisplay(current.floorMarginPct)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Effective from
              </dt>
              <dd className="font-medium text-slate-900">
                {current.effectiveFrom}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Firm name
              </dt>
              <dd className="font-medium text-slate-900">
                {valueOrDash(current.vendorName)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Quote-number prefix
              </dt>
              <dd className="font-medium text-slate-900">
                {valueOrDash(current.quoteNumberPrefix)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Days valid
              </dt>
              <dd className="font-medium text-slate-900">
                {valueOrDash(current.daysValidDefault)}
              </dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Tagline
              </dt>
              <dd className="font-medium text-slate-900">
                {valueOrDash(current.vendorTagline)}
              </dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Address
              </dt>
              <dd className="font-medium text-slate-900">
                {valueOrDash(current.vendorAddress)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Payment terms
              </dt>
              <dd className="font-medium text-slate-900">
                {valueOrDash(current.paymentTermsDefault)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Lead time
              </dt>
              <dd className="font-medium text-slate-900">
                {valueOrDash(current.leadTimeDefault)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Incoterms
              </dt>
              <dd className="font-medium text-slate-900">
                {valueOrDash(current.incotermsDefault)}
              </dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                T&amp;Cs
              </dt>
              <dd className="font-medium text-slate-900">
                {current.tcsDefault ? (
                  <span className="text-slate-900">
                    {current.tcsDefault.length > 200
                      ? `${current.tcsDefault.slice(0, 200)}…`
                      : current.tcsDefault}
                  </span>
                ) : (
                  <span className="italic text-slate-500">
                    Not set — customer view PdfTerms renders{" "}
                    <code className="rounded bg-slate-100 px-1">
                      {"{tcs-pending}"}
                    </code>{" "}
                    stub for sent quotes.
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <details className="rounded-md border border-slate-300 bg-white p-5">
        <summary className="cursor-pointer text-base font-semibold text-slate-900">
          History ({history.length} prior version{history.length === 1 ? "" : "s"})
        </summary>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No prior versions. The current row is the first.
          </p>
        ) : (
          <table className="mt-3 min-w-full divide-y divide-slate-200 text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Effective from</th>
                <th className="py-2 pr-3">Effective until</th>
                <th className="py-2 pr-3 text-right">Target</th>
                <th className="py-2 pr-3 text-right">Floor</th>
                <th className="py-2 pr-3">Firm name</th>
                <th className="py-2 pr-3">Prefix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3">{r.effectiveFrom}</td>
                  <td className="py-1.5 pr-3">{r.effectiveUntil}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {pctDisplay(r.targetMarginPct)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {pctDisplay(r.floorMarginPct)}
                  </td>
                  <td className="py-1.5 pr-3">{valueOrDash(r.vendorName)}</td>
                  <td className="py-1.5 pr-3">
                    {valueOrDash(r.quoteNumberPrefix)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  );
}
