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
// - Role transitions (admin/pm/purchasing/...) edit affordance. v1
//   stays DB-direct per pre-existing comment; UI is post-MVP scope.
// - "+ Invite user" button — Clerk auto-provisions on sign-in; no
//   admin-invite path exists today. Add when invite flow lands.
//
// v1 scope unchanged from RI.7: phone-only inline edit. The R5
// presentation makes the page belong with the rest of the admin
// surfaces without expanding feature scope.

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
          Users are auto-provisioned via Clerk sign-in. The load-bearing
          edit here is <strong style={{ color: "var(--ink)" }}>phone</strong>{" "}
          — it populates the PreparedBy block on customer-facing PDFs.
          HubSpot doesn&rsquo;t sync phone, so it&rsquo;s admin-managed
          manually.
        </p>
      </div>

      <UsersTable
        users={rows.map((r) => ({
          id: r.id,
          email: r.email,
          name: r.name,
          role: r.role,
          phone: r.phone,
        }))}
      />

      <div className="r5-dn">
        <span className="lbl">Designer note</span>
        Phone is the only field this surface lets you edit; name + email
        come from Clerk, and role transitions are DB-direct in v1. Once
        we have an invite-flow (admin pre-creates user, role gets picked
        before first sign-in) plus a role-edit affordance, this surface
        grows two more click-Edit columns. Re-evaluate the table shape
        when that scope lands — at three editable columns the
        click-Edit-the-whole-row pattern starts to crowd.
      </div>
    </div>
  );
}
