"use client";

import { useEffect } from "react";

export type ToastKind = "success" | "error";
export type ToastState = { kind: ToastKind; message: string } | null;

// Lightweight toast — fixed bottom-right, auto-dismisses after 5s by default,
// click × to dismiss manually. No provider/portal — caller owns visibility
// state and renders <Toast> conditionally next to the trigger.
export function Toast({
  kind,
  message,
  onDismiss,
  autoDismissMs = 5000,
}: {
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
  autoDismissMs?: number;
}) {
  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [onDismiss, autoDismissMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-md border px-4 py-2.5 text-sm shadow-md ${
        kind === "success"
          ? "border-green-200 bg-green-50 text-green-900"
          : "border-red-200 bg-red-50 text-red-900"
      }`}
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="rounded text-base leading-none text-current hover:opacity-70"
      >
        ×
      </button>
    </div>
  );
}
