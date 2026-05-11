"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

// Slice RI.6 — Generic modal primitive (per Designer memory write
// reference_ri6_boundary_guard.md: src/components/modal/ as the
// UNGUARDED home for modal primitives, introduced in RI.6).

export function Modal({
  open,
  onClose,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  size?: "md" | "lg";
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className={`modal${size === "lg" ? " lg" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHead({ children }: { children: ReactNode }) {
  return <div className="modal-head">{children}</div>;
}

export function ModalBody({ children }: { children: ReactNode }) {
  return <div className="modal-body">{children}</div>;
}

export function ModalFoot({ children }: { children: ReactNode }) {
  return <div className="modal-foot">{children}</div>;
}
