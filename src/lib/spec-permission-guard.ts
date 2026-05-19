import "server-only";
import { ensureUser, type AppUser } from "@/lib/auth/ensure-user";
import { ActionGuardError, ERR } from "@/lib/action-result";

// Phase A.1 v2 — action-layer permission guards for the ASY/LEAF/
// library model.
//
// Per Architect §0.5 Gate 5 (Path B), Nexus enforces ASY/LEAF
// permissions via server-action guards on top of boolean flags
// (`users.can_edit_specs`, `users.can_create_leaves`), NOT Postgres
// RLS. This matches the existing admin-guard.ts pattern; the initial
// brief proposed Postgres RLS DDL and was corrected to align with
// existing access-control discipline.
//
// Failure mode: throw ActionGuardError(FORBIDDEN, ...) so runAction
// converts to { ok: false, error: { code: 'FORBIDDEN', ... } }. Client
// surfaces denial toast; optimistic UI state reverts per Pattern 47.
//
// Source of truth: users.can_edit_specs / users.can_create_leaves
// columns. Admins (users.role === 'admin') receive both grants
// implicitly — explicit per-user assignments seeded via migration
// (Phase A.1 v2 §15.3 dispositions) override the default false.
// Admin-implicit treatment keeps `requireAdminAction` callers from
// double-checking flags they should already pass.

export async function assertCanEditSpecs(): Promise<AppUser> {
  const user = await ensureUser();
  if (user.role === "admin") return user;
  if (!user.canEditSpecs) {
    throw new ActionGuardError(
      ERR.FORBIDDEN,
      "You don't have permission to edit specs.",
    );
  }
  return user;
}

export async function assertCanCreateLeaves(): Promise<AppUser> {
  const user = await ensureUser();
  if (user.role === "admin") return user;
  if (!user.canCreateLeaves) {
    throw new ActionGuardError(
      ERR.FORBIDDEN,
      "You don't have permission to create library leaves.",
    );
  }
  return user;
}
