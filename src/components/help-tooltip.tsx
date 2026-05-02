"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Generic click-reveal help tooltip. Drop in next to any label that
// needs a "what does this mean?" explanation.
//
// Usage:
//   <label>
//     Total freight <HelpTooltip>The forwarder's quoted amount...</HelpTooltip>
//   </label>
//
// Spec'd in Slice 8.5 #54; designed to be reused in the upcoming
// Slice 13.5 field-label clarity sweep across packaging + production +
// freight + costing without modification. No domain-specific styling
// or vocabulary lives in this component.
//
// Behavior:
//   - Click trigger to open. Click trigger again, click anywhere
//     outside, press ESC, or scroll away to close.
//   - Popover is `position: fixed` so it isn't clipped by container
//     overflow. Viewport-edge-aware: flips above the trigger if no
//     room below; shifts left if it would clip the right edge.
//   - First open paints off-screen (visibility: hidden) for one frame
//     to measure popover size, then re-renders with the calculated
//     position. The user perceives it as an instant single render.
//
// Accessibility:
//   - Trigger is a real <button> with aria-expanded + aria-label.
//   - Popover has role="tooltip".
//   - ESC dismisses, matching native dialog behavior.

const POPOVER_WIDTH_PX = 288; // tailwind w-72
const VIEWPORT_PADDING_PX = 8;
const TRIGGER_GAP_PX = 4;

export function HelpTooltip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Position calculation. Runs after popover renders so we can measure
  // its actual size. Default: below trigger, left-aligned with trigger.
  // Flip above if no room below; shift left if popover overflows right
  // edge of viewport.
  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;

    const triggerRect = trigger.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    // Vertical: below by default, flip above if no room.
    let top = triggerRect.bottom + TRIGGER_GAP_PX;
    if (
      top + popoverRect.height + VIEWPORT_PADDING_PX >
      viewport.height
    ) {
      top = triggerRect.top - popoverRect.height - TRIGGER_GAP_PX;
    }

    // Horizontal: left-align with trigger by default. Shift left if
    // popover overflows right edge. Don't shift past left padding.
    let left = triggerRect.left;
    if (left + popoverRect.width + VIEWPORT_PADDING_PX > viewport.width) {
      left = viewport.width - popoverRect.width - VIEWPORT_PADDING_PX;
    }
    if (left < VIEWPORT_PADDING_PX) left = VIEWPORT_PADDING_PX;

    setPosition({ top, left });
  }, [open]);

  // Click outside to close. Trigger and popover are both excluded.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Close on scroll. Position becomes stale after scroll; cheaper to
  // close than to recompute on every scroll event.
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="Help"
        aria-expanded={open}
        className="ml-1 inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-gray-300 bg-white text-[10px] font-medium text-gray-600 hover:border-gray-400 hover:text-gray-900"
      >
        ?
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="tooltip"
          style={{
            position: "fixed",
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            width: POPOVER_WIDTH_PX,
            visibility: position ? "visible" : "hidden",
          }}
          className="z-50 rounded-md border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-700 shadow-lg"
        >
          {children}
        </div>
      )}
    </>
  );
}
