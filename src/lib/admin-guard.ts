import "server-only";
import { redirect } from "next/navigation";
import { ensureUser, type AppUser } from "@/lib/auth/ensure-user";
import { ActionGuardError, ERR } from "@/lib/action-result";

// Three-shaped admin gate. Each variant has a different failure mode
// because the right UX differs by caller context:
//
// `isAdmin(email)` — env-based check. True if email appears in
// ADMIN_EMAILS (comma-separated, case-insensitive). Used for
// pre-session callers (provisioning / webhooks / "you'll be an admin
// once you sign in" hints). Does NOT consult the database.
//
// `requireAdminPage()` — for RSC / layout / page render contexts.
// On role mismatch, throws redirect("/?denied=admin") which Next
// intercepts (do NOT catch). The browser navigates; the access-denied
// banner surfaces on home. Right UX for someone fat-fingering an
// admin URL.
//
// `requireAdminAction()` — for server action bodies wrapped in
// runAction. Throws ActionGuardError('FORBIDDEN', ...) which
// runAction converts to { ok: false, error: { code: 'FORBIDDEN' } }.
// Right UX for a POST replay against an action endpoint: structured
// rejection the client can handle without a forced navigation. This
// is the real security boundary — layout-level redirect is just a
// shortcut for the URL surface.
//
// All three share the same source-of-truth rule: users.role is
// canonical post-sign-in. ADMIN_EMAILS only seeds initial assignment
// at first sign-in. Promotions or demotions made to ADMIN_EMAILS
// later won't auto-apply (by design until Slice 17 ships proper
// user management).

export function isAdmin(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export async function requireAdminPage(): Promise<AppUser> {
  const user = await ensureUser();
  if (user.role !== "admin") {
    redirect("/?denied=admin");
  }
  return user;
}

export async function requireAdminAction(): Promise<AppUser> {
  const user = await ensureUser();
  if (user.role !== "admin") {
    throw new ActionGuardError(ERR.FORBIDDEN, "Admin role required.");
  }
  return user;
}
