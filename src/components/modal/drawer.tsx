"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// A side drawer, sibling to `Modal` and deliberately built on the same three
// disciplines — portal to body, `r3-shared` on the portal root, Escape to
// close. Those exist for reasons that have nothing to do with being a dialog
// (see modal.tsx: positioning-context escape, and the namespace scope the
// shared `.btn` / `.formfield` rules live under), so a second overlay that
// skipped them would rediscover both bugs.
//
// ── WHY A DRAWER AND NOT THE MODAL ────────────────────────────────────────
//
// A modal dims and blocks the page. What goes in here is the detail of ONE
// CELL of a grid, and the operator's next act is almost always to look at
// another cell — compare a tier, check the neighbouring SKU, read the blended
// row. Covering the grid to describe one of its cells takes away the context
// that makes the description mean anything.
//
// So: no scrim. The catcher below is transparent and exists only to give
// click-outside somewhere to land. The grid stays fully legible beside it,
// which is the entire point of choosing this shape over the full-width panel
// it replaces.

export function Drawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name — the drawer describes one thing and should say which. */
  label: string;
  children: ReactNode;
}) {
  // SSR-safe portal mount, same shape as Modal: `document` does not exist on
  // the server pass or on first client paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="r3-shared">
      {/* Transparent, not a scrim. See the note above. */}
      <div className="psr-drawer-catch" onClick={onClose} />
      <aside
        className="psr-drawer"
        role="dialog"
        aria-label={label}
        // NOT aria-modal. The page behind stays readable and reachable on
        // purpose, and claiming modality to a screen reader while leaving the
        // grid live would describe a different surface than the one built.
      >
        {children}
      </aside>
    </div>,
    document.body,
  );
}

export function DrawerHead({ children }: { children: ReactNode }) {
  return <div className="psr-drawer-head">{children}</div>;
}

export function DrawerBody({ children }: { children: ReactNode }) {
  return <div className="psr-drawer-body">{children}</div>;
}

/** One titled block inside the body. The title is the section's own label. */
export function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="psr-drawer-sect">
      <h3 className="psr-drawer-sect-k">{title}</h3>
      {children}
    </section>
  );
}
