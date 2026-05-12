import { asc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdminPage } from "@/lib/admin-guard";
import { UsersTable } from "./users-table";

// Slice RI.7 — admin user-management surface. v1 scope is narrow:
// manual phone entry for PreparedBy contact derivation (CR-SM DEC-8).
//
// HubSpot Owners API has no phone (verified against
// @hubspot/api-client PublicOwner schema), so phone is exclusively
// admin-managed manual entry. Users without phone render the customer
// view PdfHeader with the phone line OMITTED (graceful degradation;
// email is the canonical contact in CDM contracts).
//
// Role transitions / archival affordances live here too as future
// scope — the surface is the right home for any user-management work.

export default async function AdminUsersPage() {
  await requireAdminPage();

  const rows = await db.select().from(users).orderBy(asc(users.name));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
        <p className="mt-1 text-sm text-slate-600">
          Per-user details. <strong>Phone</strong> is the load-bearing
          field for v1 — it appears on customer-facing PDFs in the
          PreparedBy block when the user is the sales rep on a deal.
          HubSpot does not sync phone; enter manually here.
        </p>
      </header>

      <section className="rounded-md border border-slate-300 bg-white">
        <UsersTable
          users={rows.map((r) => ({
            id: r.id,
            email: r.email,
            name: r.name,
            role: r.role,
            phone: r.phone,
          }))}
        />
      </section>

      <details className="rounded-md border border-slate-300 bg-white p-5 text-sm text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-900">
          About this surface
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            Users are auto-provisioned on first sign-in via Clerk;{" "}
            <code>name</code> + <code>email</code> are pulled from the
            Clerk profile. <code>role</code> is admin or pm based on
            the <code>ADMIN_EMAILS</code> env at first sign-in. To
            change a user's role today, edit the database directly —
            role-editing UI is post-v1 scope.
          </p>
          <p>
            <strong>Phone</strong> is the only field this surface lets
            you edit. It populates{" "}
            <code>quotes.prepared_by_phone_snapshot</code> at sendQuote
            time via the PreparedBy resolution chain. If a user has no
            phone here, the customer view PdfHeader simply omits the
            phone line — email is sufficient contact for the customer.
          </p>
        </div>
      </details>
    </div>
  );
}
