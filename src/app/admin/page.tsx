import Link from "next/link";

const SECTIONS: Array<{
  href: string;
  label: string;
  description: string;
}> = [
  {
    href: "/admin/firm-settings",
    label: "Firm settings",
    description:
      "Target margin and floor margin policy. Drives the GOOD / BELOW_TARGET / BELOW_FLOOR thresholds on every quote's Costing Sheet.",
  },
  {
    href: "/admin/markup-defaults",
    label: "Markup defaults",
    description:
      "Per-category markup percentages applied to packaging, production, and freight cost components. Slice 9 will redefine the category schedule.",
  },
];

export default function AdminIndexPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
      <p className="mt-1 text-sm text-slate-600">
        Firm-level policy and pricing controls. Changes here affect every
        quote.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-md border border-slate-300 bg-white p-4 hover:border-slate-400 hover:shadow-sm"
          >
            <h2 className="font-semibold text-slate-900">{s.label}</h2>
            <p className="mt-1 text-sm text-slate-600">{s.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
