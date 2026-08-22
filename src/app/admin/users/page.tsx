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
          An employee reaches Nexus only if they are added here first — a
          sign-in with no record waiting for it is refused, not enrolled.
          The load-bearing edit is{" "}
          <strong style={{ color: "var(--ink)" }}>phone</strong>: it populates
          the PreparedBy block on customer-facing PDFs, and HubSpot
          doesn&rsquo;t sync it.
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
        }))}
      />

      <div className="r5-dn">
        <span className="lbl">Designer note</span>
        Add User creates the record; it does not grant anything beyond the
        role. Approval authority, spec and leaf permissions stay separate
        grants, because each is a decision someone should have to make on
        purpose rather than inherit from a hiring form. Editing an existing
        person&rsquo;s role is likewise not here — changing what someone can
        already reach is a different act from deciding what they start with.
        Phone remains the one inline edit. When role editing does land, this
        table grows a second click-Edit column and the row-becomes-editor
        pattern will want re-examining.
      </div>
    </div>
  );
}
