import { asc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdminPage } from "@/lib/admin-guard";
import { UsersTable } from "./users-table";

// Slice RI.8 step 4 — Round 5 vocabulary extrapolation to /admin/users.
// CD did NOT ship a R5 design for this page; we extend the R5 vocabulary
// established for firm-settings + markup-defaults + audit-log:
// - .r5-page wrapper with .r5-page-head (eyebrow + italic em h1 + sub)
// - .r5-users-table grid with click-Edit row pattern (mirrors
//   .r5-md-row's row-becomes-editor)
// - role pill (mono + uppercase + accent-tinted for admin)
// - "no phone" chip (mirrors .unused-chip on markup defaults)
// - Designer note panel at bottom
//
// What stays placeholder (per R5 brief vocabulary "drawn-but-inert
// for not-yet-built"):
// - Role transitions (admin/pm/purchasing/...) edit affordance. Still
//   DB-direct; a create form is not a role-management surface, and
//   editing an existing person's authority is its own decision.
//
// The "+ Invite user" placeholder is now "+ Add User" and real. Its
// former note ("Clerk auto-provisions on sign-in") described a
// mechanism that no longer exists: auto-provisioning was removed, and
// a first sign-in now BINDS to a pre-authorized row or is refused. So
// this surface is the only way an employee gets into Nexus, which is
// why it exists rather than staying drawn-but-inert.

export default async function AdminUsersPage() {
  await requireAdminPage();

  const rows = await db.select().from(users).orderBy(asc(users.name));

  return (
    <div className="r5-page">
      <div className="r5-page-head">
        <p className="eyebrow">Admin · Users</p>
        <h1>
          Manage <em>users</em>
        </h1>
        <p className="sub">
          Employees must be added here first, before they can sign in. Select <strong>Edit</strong>
          on a user to grant or remove spec-editing access, manage library
          product creation, or update the phone number shown on quotes.
          Admins have spec-editing access through their role.
        </p>
      </div>

      <UsersTable
        users={rows.map((r) => ({
          id: r.id,
          email: r.email,
          name: r.name,
          role: r.role,
          phone: r.phone,
          bindingState: r.bindingState,
          canEditSpecs: r.canEditSpecs,
          canCreateLeaves: r.canCreateLeaves,
        }))}
      />

    </div>
  );
}
