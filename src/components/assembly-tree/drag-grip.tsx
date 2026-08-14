import type React from "react";

/**
 * The drag affordance. Six dots, the conventional grip.
 *
 * B-12 · replaces a bare glyph that read as decoration — operators could not
 * tell it was the handle, so the capability behind it went unused.
 *
 * It renders ONLY where dragging is actually supported. An affordance that
 * advertises a capability the surface does not have is worse than none: it
 * teaches the operator that dragging is unreliable, and they stop trying it
 * where it does work.
 */
export function DragGrip({
  onDragStart,
  title = "Drag to move or reorder",
}: {
  onDragStart: (e: React.DragEvent) => void;
  title?: string;
}) {
  return (
    <span
      className="a1v2-grip"
      role="button"
      tabIndex={-1}
      aria-label={title}
      title={title}
      draggable
      onDragStart={onDragStart}
    >
      <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
        {[4, 8, 12].map((cy) =>
          [3, 7].map((cx) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.1" />
          )),
        )}
      </svg>
    </span>
  );
}
