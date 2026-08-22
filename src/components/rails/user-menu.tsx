"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The rail's account control.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * The initials button was wrapped DIRECTLY in the sign-out control, so a click
 * signed the operator out immediately — no menu, no confirmation, no way to
 * simply check which account you are in. An avatar is an identity affordance;
 * making it a one-click destructive action means the only way to answer "who am
 * I signed in as" was to lose the session finding out.
 *
 * Now the button opens a menu. Sign-out is an explicit item inside it, and the
 * provider's own control still wraps that item — this component never calls
 * `signOut` itself, so Clerk's redirect behaviour is untouched.
 */
export function UserMenu({
  initials,
  email,
  signOutItem,
}: {
  initials: string;
  email: string | null;
  /** The provider's sign-out control, already wrapping the menu's item. */
  signOutItem: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        // Names the account, not the action — the action now lives in the menu.
        aria-label={email ? `Account menu for ${email}` : "Account menu"}
        title={email ?? "Account"}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-paper-3 font-mono text-[10px] font-medium uppercase text-ink-2 hover:bg-paper-4"
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            bottom: 0,
            left: "calc(100% + 8px)",
            minWidth: 208,
            background: "var(--paper)",
            border: "1px solid var(--rule)",
            borderRadius: 8,
            boxShadow: "0 8px 24px oklch(0 0 0 / 0.14)",
            padding: 4,
            zIndex: 60,
          }}
        >
          {email && (
            <div
              style={{
                padding: "8px 10px 9px",
                borderBottom: "1px solid var(--rule)",
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 9,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                }}
              >
                Signed in as
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--ink)",
                  marginTop: 2,
                  wordBreak: "break-all",
                }}
              >
                {email}
              </div>
            </div>
          )}
          <div role="menuitem" className="r14-menu-item">
            {signOutItem}
          </div>
        </div>
      )}
    </div>
  );
}
