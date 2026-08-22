"use client";

import { useState, useTransition } from "react";
import { addUser } from "@/app/actions/users";

/**
 * Admin → Users → + Add User.
 *
 * A form over `addUser`, which is a front door onto the certified provisioning
 * mechanism. Everything this panel can produce, the CLI provisioner already
 * produces — the fields are only the three the mechanism accepts.
 *
 * ── WHY THERE ARE EXACTLY THREE FIELDS ───────────────────────────────────
 *
 * Name, work email, role. Commercial approval, spec authority and leaf
 * authority are NOT here and are not defaulted on: BV-005 keeps commercial
 * approval independent of role, and a checkbox on a hiring form is precisely
 * where that independence would quietly erode. They are granted separately,
 * deliberately, by someone who meant to grant them.
 */

const ROLES = [
  "admin",
  "pm",
  "purchasing",
  "production",
  "accounting",
  "logistics",
  "sales",
  "read_only",
] as const;

export function AddUserModal({ onClose }: { onClose: (created: boolean) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("read_only");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("email", email);
    fd.set("role", role);
    startTransition(async () => {
      const r = await addUser(fd);
      if (!r.ok) {
        // The refusal stays on screen with the form intact: the admin needs to
        // see WHICH address was refused and why, and a closed panel would take
        // both away.
        setError(r.error.message);
        return;
      }
      onClose(true);
    });
  }

  return (
    <div
      className="r5-users-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Add user"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose(false);
      }}
    >
      <div className="r5-users-modal">
        <div className="r5-users-modal-head">
          <p className="eyebrow">Admin · Users</p>
          <h2>Add user</h2>
          <p className="sub">
            Pre-authorizes this person. They are recorded now and the record
            binds to their identity the first time they sign in with their
            work account — nothing is emailed and no password is set here.
          </p>
        </div>

        <div className="r5-users-modal-body">
          <label className="r5-users-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Chen"
              autoFocus
              disabled={pending}
            />
          </label>

          <label className="r5-users-field">
            <span>Work email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@thedps.co"
              disabled={pending}
            />
            <em>
              Must be an @thedps.co address. Sign-in resolves the corporate
              domain only, so anything else could never bind.
            </em>
          </label>

          <label className="r5-users-field">
            <span>Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={pending}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <em>
              Role decides what they can reach. Approval authority is separate
              and is not granted here.
            </em>
          </label>

          {error ? (
            <p role="alert" className="r5-users-modal-error">
              {error}
            </p>
          ) : null}
        </div>

        <div className="r5-users-modal-foot">
          <button
            type="button"
            className="cancel"
            onClick={() => onClose(false)}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="save"
            onClick={submit}
            disabled={pending}
          >
            {pending ? "Adding…" : "Add user"}
          </button>
        </div>
      </div>
    </div>
  );
}
