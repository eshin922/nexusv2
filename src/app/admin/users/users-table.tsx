"use client";

import { useState, useTransition } from "react";
import { updateUserPhone } from "@/app/actions/users";

// Slice RI.7 — per-user inline-edit table on /admin/users. v1 scope:
// edit phone only. Other fields (name, email, role) are read-only.
//
// Edit flow: click "Edit" → row swaps to editable input + Save/Cancel.
// Save fires updateUserPhone; success advances back to read mode with
// the new value. Inline error display via the action's ActionResult
// error message.

type Row = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  phone: string | null;
};

export function UsersTable({ users }: { users: Row[] }) {
  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-4 py-2">Name</th>
          <th className="px-4 py-2">Email</th>
          <th className="px-4 py-2">Role</th>
          <th className="px-4 py-2">Phone</th>
          <th className="px-4 py-2 w-32 text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {users.map((u) => (
          <UserRow key={u.id} user={u} />
        ))}
        {users.length === 0 && (
          <tr>
            <td
              colSpan={5}
              className="px-4 py-6 text-center italic text-slate-500"
            >
              No users yet — provision via Clerk sign-in.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function UserRow({ user }: { user: Row }) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [currentPhone, setCurrentPhone] = useState(user.phone);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function cancel() {
    setEditing(false);
    setPhone(currentPhone ?? "");
    setError(null);
  }

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
        setCurrentPhone(r.data.phone);
        setEditing(false);
      }
    });
  }

  return (
    <tr>
      <td className="px-4 py-2 font-medium text-slate-900">
        {user.name ?? <span className="italic text-slate-500">(no name)</span>}
      </td>
      <td className="px-4 py-2 text-slate-700">{user.email}</td>
      <td className="px-4 py-2">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {user.role}
        </span>
      </td>
      <td className="px-4 py-2">
        {editing ? (
          <div className="space-y-1">
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 555 0184"
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
              autoFocus
            />
            {error && (
              <p className="text-xs text-red-700" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : currentPhone ? (
          <span className="font-mono text-xs text-slate-900">{currentPhone}</span>
        ) : (
          <span className="italic text-slate-500">—</span>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        {editing ? (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="text-xs text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="r2-btn primary sm"
              style={{ opacity: pending ? 0.5 : 1 }}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-slate-700 underline hover:text-slate-900"
          >
            Edit phone
          </button>
        )}
      </td>
    </tr>
  );
}
