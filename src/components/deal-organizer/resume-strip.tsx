import Link from "next/link";
import { resolveSurfaceHref, SURFACE_ROUTES } from "@/lib/nav/surface-routes";
import type { ResumeContext } from "@/lib/nav/home-queries";

/**
 * Where you were, under what you should do next.
 *
 * ── WHY NOT THE OLD CARD ─────────────────────────────────────────────────
 *
 * `ResumeCard` still exists in `src/components/nav/`, and mounting it would
 * have been the smaller diff. It was built for the home page the Deal
 * Organizer replaced, and it carries two things from it: a "Check inbox
 * first" chip linking to `#whats-my-move`, an anchor that no longer exists on
 * this page, and an `EmptyResumeCard` for when there is nothing to resume.
 *
 * That empty state is the specific thing this page was rebuilt to remove -- a
 * permanently-reserved block that reports nothing. So this renders NOTHING
 * when there is no visit. A first-time operator sees the page begin at their
 * next move, not at a card apologising for having no history.
 *
 * ── IT IS SUBORDINATE ON PURPOSE ─────────────────────────────────────────
 *
 * Next move is what the work needs; resume is where the operator happened to
 * be. When those disagree the next move should win, so this is one quiet line
 * beneath it rather than a second card competing at the same weight.
 */
export function ResumeStrip({ context }: { context: ResumeContext | null }) {
  if (!context) return null;

  const label = SURFACE_ROUTES[context.surfaceKey].displayLabel;
  const href = resolveSurfaceHref(
    context.surfaceKey,
    context.projectId,
    context.quoteId,
  );

  return (
    <Link
      href={href}
      className="r14-resume"
      aria-label={`Resume ${label} on ${context.projectName}`}
    >
      <span className="r14-resume-label">Pick up where you left off</span>
      <span className="r14-resume-where">
        {context.projectName}
        <span className="r14-resume-sep"> · </span>
        {context.scenarioLabel}
        <span className="r14-resume-sep"> · </span>
        {label}
      </span>
      {/* The last thing that happened to this quote, when there is one. It
          answers "what was I in the middle of" without opening it -- and it
          is read live rather than stamped at visit time, so it stays true
          when someone else has since touched the quote. */}
      {context.lastChangeSummary && (
        <span className="r14-resume-change">{context.lastChangeSummary}</span>
      )}
      <span className="r14-resume-cta">Resume →</span>
    </Link>
  );
}
