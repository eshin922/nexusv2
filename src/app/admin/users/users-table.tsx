"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserPhone } from "@/app/actions/users";
import { AddUserModal } from "./add-user-modal";

// Slice RI.8 step 4 — Round 5 vocabulary on /admin/users. CSS classes
// `.r5-users-*` mirror `.r5-md-*` shape conventions (click-Edit row
// becomes editor; foot strip with count). v1 functional scope is
// unchanged from RI.7: phone-only inline edit.

type Row = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  phone: string | null;
  /**
   * Enrollment state, shown in words. The Clerk id is NOT carried here: it is
   * an identity-provider key, of no use to an administrator and not something
   * an ordinary admin surface should be handing out. "Pending sign-in" vs
   * "Active" is the whole of what this page needs to say.
   */
  bindingState: "pending_first_sign_in" | "bound";
};

export function UsersTable({ users }: { users: Row[] }) {
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const withPhone = users.filter((u) => u.phone !== null && u.phone !== "").length;
  const pendingCount = users.filter(
    (u) => u.bindingState === "pending_first_sign_in",
  ).length;

  return (
    <div className="r5-users-table">
      <div className="r5-users-table-head">
        <div>Name</div>
        <div>Email</div>
        <div>Role</div>
        <div>Status</div>
        <div>Phone</div>
        <div></div>
      </div>

      {users.length === 0 ? (
        <div
          style={{
            padding: "24px 22px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--ink-3)",
            fontStyle: "italic",
          }}
        >
          No users yet — add one to pre-authorize their first sign-in.
        </div>
      ) : (
        users.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            editing={editId === u.id}
            onStartEdit={() => setEditId(u.id)}
            onCancel={() => setEditId(null)}
            onSaved={() => setEditId(null)}
          />
        ))
      )}

      <div className="r5-users-foot">
        <span>
          {users.length} user{users.length === 1 ? "" : "s"} · {pendingCount}{" "}
          pending sign-in · {withPhone} with phone
        </span>
        <button
          type="button"
          className="r5-users-add"
          onClick={() => setAdding(true)}
        >
          + ADD USER
        </button>
      </div>

      {adding ? (
        <AddUserModal
          onClose={(created) => {
            setAdding(false);
            // Re-read from the server rather than splicing the new row in
            // locally: the row an admin sees should be the row that exists.
            if (created) router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function UserRow({
  user,
  editing,
  onStartEdit,
  onCancel,
  onSaved,
}: {
  user: Row;
  editing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  if (editing) {
    return <EditingRow user={user} onCancel={onCancel} onSaved={onSaved} />;
  }

  return (
    <div className="r5-users-row">
      <div className="name">
        {user.name ?? <span className="no-name">(no name)</span>}
      </div>
      <div className="email" title={user.email}>
        {user.email}
      </div>
      <div>
        <span className={`role ${user.role === "admin" ? "admin" : ""}`}>
          {user.role}
        </span>
      </div>
      <EnrollmentCell state={user.bindingState} />
      <div className="phone">
        {user.phone ? (
          user.phone
        ) : (
          <span className="empty">no phone</span>
        )}
      </div>
      <div className="actions">
        <button type="button" onClick={onStartEdit}>
          Edit
        </button>
      </div>
    </div>
  );
}

function EditingRow({
  user,
  onCancel,
  onSaved,
}: {
  user: Row;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [phone, setPhone] = useState(user.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("userId", user.id);
    fd.set("phone", phone);
    startTransition(async () => {
      const r = await updateUserPhone(fd);
      if (!r.ok) {
        setError(r.error.message);
      } else {
        onSaved();
      }
    });
  }

  return (
    <div className="r5-users-row editing">
      <div className="name">
        {user.name ?? <span className="no-name">(no name)</span>}
      </div>
      <div className="email" title={user.email}>
        {user.email}
      </div>
      <div>
        <span className={`role ${user.role === "admin" ? "admin" : ""}`}>
          {user.role}
        </span>
      </div>
      <EnrollmentCell state={user.bindingState} />
      <div className="phone">
        <div className="r5-users-edit">
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 555 0184"
            autoFocus
            aria-label={`${user.name ?? user.email} phone`}
          />
        </div>
      </div>
      <div className="actions">
        <button
          type="button"
          className="cancel"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="save"
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="r5-users-edit-help">
        {error ? (
          <span
            role="alert"
            style={{ color: "var(--bad)", fontWeight: 500 }}
          >
            {error}
          </span>
        ) : (
          <>
            Phone shows on customer-facing PDFs in the{" "}
            <strong>PreparedBy</strong> block when this user is the sales rep
            on a deal. Leave blank if you don&rsquo;t want it on customer
            comms — the email line stays as canonical contact.
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Enrollment state in words.
 *
 * "Pending sign-in" says the record exists and is waiting for the person;
 * "Active" says it has bound to their identity. Neither exposes the Clerk id
 * that distinguishes them in the database — an administrator has no use for an
 * identity-provider key, and a surface that prints one invites it into
 * screenshots and support threads.
 */
function EnrollmentCell({ state }: { state: Row["bindingState"] }) {
  const pending = state === "pending_first_sign_in";
  return (
    <div className="status">
      <span className={`enrollment ${pending ? "pending" : "active"}`}>
        {pending ? "Pending sign-in" : "Active"}
      </span>
    </div>
  );
}
