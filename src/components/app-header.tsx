import "server-only";
import { isAdmin } from "@/lib/admin-guard";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import { AppHeaderClient } from "./app-header-client";

// Slice 8.5 #52 — persistent app header bar with admin entry point.
// Mounted in src/app/layout.tsx above {children} so it appears on
// every authenticated route.
//
// Two-layer split:
//   - This file (server): calls Clerk's currentUser to get the email,
//     applies env-based isAdmin() check.
//   - AppHeaderClient (client): consumes the showAdmin boolean and
//     uses usePathname for context-aware visibility (hides Settings
//     link on /admin/* where it would point at the user's current
//     location).
//
// Why env-based isAdmin (not requireAdmin*): header renders on every
// page render. A DB hit per render would multiply load for no
// security benefit (the actual gate is at /admin/layout.tsx
// requireAdminPage + every admin action's requireAdminAction; this
// is just deciding whether to RENDER the link).

export async function AppHeader() {
  const { authentication } = await getApplicationDependencies();
  const email = (await authentication.identity.current())?.email ?? null;
  const showAdmin = email ? isAdmin(email) : false;

  return <AppHeaderClient showAdmin={showAdmin} />;
}
