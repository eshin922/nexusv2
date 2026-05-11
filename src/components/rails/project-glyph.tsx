import Link from "next/link";
import type { ProjectGlyph as ProjectGlyphType } from "@/lib/workspace-queries";

// Slice RI.2 — color-coded letter avatar for project glyphs in the
// outer rail (Pinned + Recent sections). Per Round 4 design.
//
// Hue derives from project id (deterministic via hashHue in
// workspace-queries.ts); luminance + chroma fixed at glyph-readable
// values via OKLCH to match CD's design system. Letter from project's
// client_name (or deal_name fallback).
//
// Square chip with rounded corners, ~32px in the outer rail's 56px width.
// Hover surfaces project name as title tooltip; click navigates to
// /projects/[id].

export function ProjectGlyph({
  glyph,
  projectName,
  href,
  size = "md",
}: {
  glyph: ProjectGlyphType;
  projectName: string;
  href?: string;
  size?: "sm" | "md";
}) {
  const dimension = size === "sm" ? "h-7 w-7 text-xs" : "h-8 w-8 text-sm";
  // OKLCH luminance + chroma chosen for legibility on light + dark
  // paper. Hue varies per project; saturation kept moderate.
  const bg = `oklch(0.55 0.12 ${glyph.hue})`;
  const ink = `oklch(0.98 0.02 ${glyph.hue})`;
  const inner = (
    <span
      className={`flex ${dimension} items-center justify-center rounded font-mono font-medium tracking-tight transition-transform hover:scale-105`}
      style={{ background: bg, color: ink }}
      title={projectName}
      aria-label={projectName}
    >
      {glyph.letter}
    </span>
  );
  if (!href) return inner;
  return <Link href={href}>{inner}</Link>;
}
