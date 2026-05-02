"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Slice 8.5 #52 — client-side renderer for AppHeader. Receives the
// admin-eligibility boolean from its server-side wrapper (which had
// to call Clerk's currentUser to determine it).
//
// Pathname-based visibility: hides the Settings link on `/admin/*`
// pages because (a) the user is already in the admin section so the
// link points at where they are, and (b) /admin has its own dark
// header chrome which makes the white app header redundant in
// context. v1 fix: just hide the link. The deeper "stacked headers
// on /admin" pattern is a Slice 13.5 polish item — see UX_BACKLOG.

export function AppHeaderClient({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();
  const onAdminPage = pathname?.startsWith("/admin") ?? false;
  const showSettingsLink = showAdmin && !onAdminPage;

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-2 text-sm">
        <Link
          href="/"
          className="font-semibold text-gray-900 hover:text-gray-700"
        >
          Nexus
        </Link>
        {showSettingsLink && (
          <Link
            href="/admin"
            className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            title="Firm settings, markup defaults, and other admin controls"
          >
            <span aria-hidden>⚙</span>
            <span>Settings</span>
          </Link>
        )}
      </div>
    </header>
  );
}
