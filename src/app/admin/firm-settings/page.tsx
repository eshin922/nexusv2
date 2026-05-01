import { desc } from "drizzle-orm";
import { db } from "@/db";
import { firmSettings } from "@/db/schema";
import { requireAdminPage } from "@/lib/admin-guard";
import { FirmSettingsForm } from "./firm-settings-form";

function pctDisplay(d: string): string {
  const n = Number(d) * 100;
  if (!Number.isFinite(n)) return "—";
  return `${Number(n.toFixed(4))}%`;
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
          Target and floor margin policy. Drives the GOOD / BELOW_TARGET /
          BELOW_FLOOR thresholds on every quote's Costing Sheet.
        </p>
      </header>

      <section className="rounded-md border border-slate-300 bg-white p-5">
        <h2 className="mb-4 text-base font-semibold text-slate-900">
          {current ? "Update current policy" : "Set initial policy"}
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

      {current && (
        <section className="rounded-md border border-slate-300 bg-white p-5">
          <h2 className="mb-2 text-base font-semibold text-slate-900">
            Current row
          </h2>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  );
}
