import Link from "next/link";
import { ADMIN_SECTIONS } from "./sections";


export default function AdminIndexPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
      {/* The grid now lists every admin section, including Users and Audit
          log, which the nav had always offered and this page had not. So the
          blurb can no longer claim to be only policy and pricing. */}
      <p className="mt-1 text-sm text-slate-600">
        Firm-level settings, integrations, and history. Policy changes here
        affect every quote.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {ADMIN_SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-md border border-slate-300 bg-white p-4 hover:border-slate-400 hover:shadow-sm"
          >
            <h2 className="font-semibold text-slate-900">{s.label}</h2>
            <p className="mt-1 text-sm text-slate-600">{s.index}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
