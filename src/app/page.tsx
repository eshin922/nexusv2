import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AccessDeniedBanner } from "@/components/access-denied-banner";
import { OrganizerSurface } from "@/components/deal-organizer/organizer-surface";
import { loadOrganizer } from "@/lib/organizer/load";
import { getResumeContext } from "@/lib/nav/home-queries";
import { ensureUser } from "@/lib/auth/ensure-user";
import { getApplicationDependencies } from "@/lib/integrations/composition";

/**
 * Home · the Deal Organizer.
 *
 * ── WHAT REPLACED WHAT ───────────────────────────────────────────────────
 *
 * The previous page paired a `Resume` card with a permanently-empty "What's my
 * move" panel that said its inbox would ship with the validation engine — a
 * placeholder occupying the page's best position — and, above the resume
 * button, a red "check inbox first" warning. Two instructions that could
 * disagree, and often did. One ranking replaces both: the inbox item either
 * outranks the resume or it does not.
 *
 * ── ONE READ PATH, FIXED COST ────────────────────────────────────────────
 *
 * `loadOrganizer` issues five queries for the whole page regardless of how many
 * projects or quotes exist. Nothing here is per-quote, and nothing on this
 * route computes commercial state — see `task-policy.ts` for the four kinds
 * that were deferred rather than approximated, and the measurement behind it.
 */
export default async function Home() {
  const { authentication } = await getApplicationDependencies();
  const identity = await authentication.identity.current();
  if (!identity) redirect("/sign-in");

  const dbUser = await ensureUser();
  // Two reads, not nested: `loadOrganizer` fans out internally, and the
  // getCostingBundle discipline in CLAUDE.md is that a self-fanning helper
  // does not go inside another Promise.all. Resume is one indexed lookup
  // plus a label join, so it costs a round trip rather than a fan-out.
  const data = await loadOrganizer({
    userId: dbUser.id,
    commercialApprover: dbUser.commercialApprover,
    role: dbUser.role,
  });
  const resume = await getResumeContext(dbUser.id);

  return (
    <>
      <Suspense fallback={null}>
        <AccessDeniedBanner />
      </Suspense>
      <OrganizerSurface
        data={data}
        userName={identity.firstName ?? identity.email ?? "there"}
        now={Date.now()}
        resume={resume}
      />
    </>
  );
}
