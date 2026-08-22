/**
 * The Nexus mark — 2a, "graded hub".
 *
 * Inlined rather than referenced through `<img>` or `<use>`, for the reason the
 * handoff gives: the paints are `currentColor`, so the mark takes the colour of
 * whatever it sits in. That is what lets ONE component serve both placements —
 * paper on the dark panel, paper on the ink tile — with no second asset and no
 * colour passed as a prop.
 *
 * `nexus-mark-currentcolor.svg` in `public/icons/` is the same geometry, kept
 * for anything that needs a file. If it is ever swapped for a sprite, note the
 * handoff's warning: `url(#gradient)` fills do not resolve through
 * `<use fill="inherit">`, so solid paints are required.
 *
 * Decorative in both placements — the wordmark and the "Sign in" eyebrow carry
 * the meaning — so it is hidden from assistive technology.
 */
export function NexusMark({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      style={{ display: "block", flex: "none" }}
    >
      <g stroke="currentColor" strokeWidth={5.5} strokeLinecap="round" fill="none">
        <path d="M60 37 V 23" />
        <path d="M79.9 48.5 L 92 41.5" />
        <path d="M79.9 71.5 L 92 78.5" />
        <path d="M60 83 V 97" />
        <path d="M40.1 71.5 L 28 78.5" />
        <path d="M40.1 48.5 L 28 41.5" />
      </g>
      <g fill="currentColor">
        <circle cx="60" cy="60" r="17" />
        <circle cx="60" cy="15.5" r="8" />
        <circle cx="98.5" cy="37.8" r="5.5" />
        <circle cx="98.5" cy="82.2" r="8" />
        <circle cx="60" cy="104.5" r="5.5" />
        <circle cx="21.5" cy="82.2" r="8" />
        <circle cx="21.5" cy="37.8" r="5.5" />
      </g>
    </svg>
  );
}
