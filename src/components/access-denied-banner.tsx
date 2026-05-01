"use client";

import { useSearchParams } from "next/navigation";

// Surfaces a banner when redirected from a gated route. Currently only
// "admin" — non-admin users hitting /admin/* land back at home with
// ?denied=admin set by requireAdmin's redirect. Banner is dismissible
// via page navigation (no internal state needed; the search param is
// stripped naturally on next nav).

const MESSAGES: Record<string, string> = {
  admin: "Admin access required. Contact an administrator if you need access.",
};

export function AccessDeniedBanner() {
  const params = useSearchParams();
  const denied = params.get("denied");
  if (!denied) return null;
  const msg = MESSAGES[denied];
  if (!msg) return null;

  return (
    <div
      role="alert"
      className="mb-4 w-full max-w-md rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      {msg}
    </div>
  );
}
