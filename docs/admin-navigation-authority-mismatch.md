# Admin navigation authority does not match admin authorization

**Banked 2026-08-21. Recorded, not repaired.** Surfaced while removing
auto-provisioning (#336), which is what made `ADMIN_EMAILS` stop seeding roles
and left it governing only one thing.

## The mismatch

Two different authorities decide two halves of the same question.

| half | authority | where |
|---|---|---|
| does the **Admin link render**? | `ADMIN_EMAILS` env var | `outer-rail.tsx:34`, `app-header.tsx:30` |
| does the **admin surface authorize**? | `users.role = 'admin'` | `admin-guard.ts` (page + action) |

```ts
// outer-rail.tsx / app-header.tsx
const showAdmin = email ? isAdmin(email) : false;   // env
// admin-guard.ts
if (user.role !== "admin") …                        // database
```

They agree today only because the same people happen to satisfy both.

## Why it matters now

`ADMIN_EMAILS` used to do two jobs: seed `role` at first sign-in, and control
nav visibility. #336 removed auto-provisioning, so it no longer seeds anything —
**it now governs visibility alone**, with nothing keeping it in step with the
role it used to set.

Both directions are reachable:

- **Env-listed, not role-admin** — sees the Admin link, is refused on arrival.
  A dead-end control that reads as a permissions bug.
- **Role-admin, not env-listed** — has full admin authority and no way to
  navigate to it. Worse, because it is silent: the surface is reachable only by
  typing the URL, so it presents as a missing feature.

Neither is a *security* hole. `requireAdminPage` / `requireAdminAction` remain
the real boundary and are role-based. This is a **correctness and legibility**
defect in navigation.

## Where it should land

**Nexus role is the authority.** `role = 'admin'` already decides whether the
surface authorizes; navigation should read the same value rather than a parallel
env list that can drift from it.

`ensureUser` returns the row, so the role is available wherever the rails render
— this is a small change, deliberately not folded into #336.

## What to decide first

1. **Does `ADMIN_EMAILS` retain a purpose after this?** With seeding gone and
   visibility converged on role, it governs nothing. If it stays, it should say
   what for; if not, remove it and its `isAdmin` helper together.
2. **Bootstrap.** `ADMIN_EMAILS` was how the first admin ever became one. With
   admin-created enrollment (#327) an admin now provisions the next admin — but
   the FIRST one needs some path that does not require an existing admin. Today
   that is a direct database write. Worth stating deliberately rather than
   discovering during a disaster recovery.

## Cross-references

- PR #336 — removed auto-provisioning; the change that isolated this.
- `docs/user-onboarding-pre-authorized-binding.md` (#327) — Nexus Admin as the
  enrollment authority, the principle this mismatch sits under.
- `src/lib/admin-guard.ts` — both `isAdmin` (env) and the role-based guards.
