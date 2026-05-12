"use client";

import { useState, useTransition } from "react";
import { updateUserPhone } from "@/app/actions/users";

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
};

export function UsersTable({ users }: { users: Row[] }) {
  const [editId, setEditId] = useState<string | null>(null);
  const withPhone = users.filter((u) => u.phone !== null && u.phone !== "").length;

  return (
    <div className="r5-users-table">
      <div className="r5-users-table-head">
        <div>Name</div>
        <div>Email</div>
        <div>Role</div>
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
          No users yet — provision via Clerk sign-in.
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
          {users.length} user{users.length === 1 ? "" : "s"} · {withPhone} with
          phone
        </span>
        <button
          type="button"
          disabled
          title="Clerk auto-provisions on first sign-in. Admin-invite flow is post-v1."
          style={{
            color: "var(--ink-4)",
            background: "none",
            border: "none",
            cursor: "not-allowed",
            fontFamily: "inherit",
            fontSize: "inherit",
            letterSpacing: "0.04em",
          }}
        >
          + INVITE USER
        </button>
      </div>
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
