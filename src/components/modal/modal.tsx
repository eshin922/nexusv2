"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Slice RI.6 — Generic modal primitive (per Designer memory write
// reference_ri6_boundary_guard.md: src/components/modal/ as the
// UNGUARDED home for modal primitives, introduced in RI.6).
//
// Slice R6.2 commit 2 hotfix — Modal now portals to `document.body`
// AND carries the `r3-shared` namespace class on the portal root.
// Two coupled reasons:
//
//   1. Portal escape. Without `createPortal`, the modal subtree
//      renders inline in the consumer's React tree and inherits
//      whatever positioning context that parent has (overflow,
//      transforms, fixed-positioned ancestors). The FreightDrilldown
//      lives inside the Costs accordion; without a portal the modal
//      rendered nested below the panel instead of overlaying it.
//
//   2. Namespace scope. The canonical R3 CSS (r3-shared.css) wraps
//      `.modal-scrim` / `.modal` / `.modal-head` / `.modal-body` /
//      `.modal-foot` / `.formfield` / `.btn.primary` under a single
//      `.r3-shared { ... }` parent scope (Pattern 30 Path-B-namespace-
//      scoped, banked from R2 Pricing + R3 Quote/Mark-Accepted). When
//      a consumer surface (Costs, Pricing, Setup) opens a modal, the
//      portal root needs `r3-shared` ancestry for the rules to fire.
//      Mark-Accepted's host already wraps its body in `r3-shared`;
//      Quote does too. Other surfaces don't — and shouldn't have to
//      know about the namespace requirement just to open a modal.
//
// Both fixes live at the Modal primitive so every consumer (across
// every surface) gets correct rendering for free.
//
// Pattern catalogued: CLAUDE.md "Portal-escape from namespace scope"
// (rest-of-app sweep Step 10 HIGH-1 — ReverseSolveDialog same shape).

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
  // SSR-safe portal mount: `document` isn't available during server
  // render. Track client-mounted state; render null on the server
  // pass and on first client paint before useEffect runs. Same shape
  // every Next/React portal needs.
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
    </div>,
    document.body,
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
