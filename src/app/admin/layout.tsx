import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdminPage } from "@/lib/admin-guard";

// Hard role gate at the layout boundary: non-admins redirect to home
// before any admin page renders. Each admin server action MUST also call
// requireAdmin internally — defense in depth, since action endpoints are
// reachable without going through this layout.
//
// Visual treatment is intentionally distinct from PM workflow (slate
// background, "Admin" header badge, separate nav). PMs landing here by
// accident immediately see "this is not the quoting tool."

const NAV: Array<{ href: string; label: string; description: string }> = [
  {
    href: "/admin/firm-settings",
    label: "Firm settings",
    description: "Margin policy + customer-facing defaults",
  },
  {
    href: "/admin/markup-defaults",
    label: "Markup defaults",
    description: "Per-category markup percentages",
  },
  {
    href: "/admin/users",
    label: "Users",
    description: "Manual phone entry for PreparedBy",
  },
];

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const admin = await requireAdminPage();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-300 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-slate-900">
              Admin
            </span>
            <Link href="/admin" className="text-sm font-semibold hover:underline">
              Nexus admin
            </Link>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-300">
            <span>{admin.email}</span>
            <Link href="/" className="text-slate-100 underline hover:text-white">
              ← Back to quoting tool
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-6 py-6">
        <nav className="w-56 shrink-0">
          <ul className="space-y-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-md border border-transparent px-3 py-2 text-sm text-slate-700 hover:border-slate-300 hover:bg-white"
                >
                  <div className="font-medium text-slate-900">{item.label}</div>
                  <div className="text-xs text-slate-500">{item.description}</div>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
