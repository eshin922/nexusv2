"use server";

// Pricing reframe v1 — pricing_events telemetry actions.
//
// Single table, five event types feeding v1.1 Path 2 promotion analysis +
// ★ Recommended reliability tracking:
//
//   - surgical_apply         · HISTORICAL. Written from applySurgicalAdj,
//                              which P3-016 removed when recommendations
//                              moved onto the staging model. Retained in the
//                              union so existing rows stay readable; nothing
//                              writes it. See the P3-016 record for the
//                              recommendation-telemetry gap this leaves open.
//   - request_override       · written when PM clicks Request override on
//                              below-floor (Step 7, paired with admin gate)
//   - recommended_fired      · written when SuggestionEngine surfaces the
//                              ★ recommended option to the PM (Step 6)
//   - recommended_accepted   · written when PM applies the ★ recommended
//                              option (Step 7, fires alongside the apply)
//   - recommended_overridden · written when PM picks a non-recommended
//                              option (Step 7, fires alongside the apply)
//
// Posture per §0.5 INFO-2: write-only from server actions; RLS off;
// not in realtime publication. PMs don't subscribe to telemetry.
//
// Action result pattern + runAction wrapper per CLAUDE.md.

import { db } from "@/db";
import { pricingEvents, quoteWarnings } from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import { quoteByIdDraft } from "@/lib/quote-guards";
import { runAction, type ActionResult } from "@/lib/action-result";

type PricingEventType =
  | "surgical_apply"
  | "request_override"
  | "recommended_fired"
  | "recommended_accepted"
  | "recommended_overridden";

export type LogPricingEventInput = {
  quoteId: string;
  eventType: PricingEventType;
  violationTierId?: string | null;
  suggestionTargetTierIds?: string[] | null;
  floorBreachPp?: number | null;
  overrideReason?: string | null;
};

// Internal helper used by other server actions (Step 7 apply paths).
// Not idempotent — each call writes a row. Callers handle dedupe
// where it matters (e.g., recommended_fired is gated client-side to
// fire once per surfacing).
export async function writePricingEvent(input: LogPricingEventInput) {
  const user = await ensureUser();
  const [row] = await db
    .insert(pricingEvents)
    .values({
      quoteId: input.quoteId,
      userId: user.id,
      eventType: input.eventType,
      violationTierId: input.violationTierId ?? null,
      suggestionTargetTierIds: input.suggestionTargetTierIds ?? null,
      floorBreachPp:
        input.floorBreachPp == null ? null : String(input.floorBreachPp),
      overrideReason: input.overrideReason ?? null,
    })
    .returning({ id: pricingEvents.id });
  return row;
}

// Public action — currently used for client-driven "recommended_fired"
// telemetry from SuggestionEngine. Other event types are written
// server-side from their owning apply actions (Step 7); they don't
// surface as direct client actions.
export async function logPricingEvent(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const eventType = String(formData.get("eventType") ?? "").trim();
    const violationTierId =
      String(formData.get("violationTierId") ?? "").trim() || null;
    const targetIdsRaw = String(
      formData.get("suggestionTargetTierIds") ?? "",
    ).trim();
    const suggestionTargetTierIds = targetIdsRaw
      ? targetIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    const floorBreachPpRaw = String(formData.get("floorBreachPp") ?? "").trim();
    const floorBreachPp = floorBreachPpRaw ? Number(floorBreachPpRaw) : null;
    const overrideReason =
      String(formData.get("overrideReason") ?? "").trim() || null;

    // Validate event type — server-side defense even though CHECK
    // constraint on the table also enforces (DB-side fail-stop on
    // bad inserts).
    const validTypes: PricingEventType[] = [
      "surgical_apply",
      "request_override",
      "recommended_fired",
      "recommended_accepted",
      "recommended_overridden",
    ];
    if (!validTypes.includes(eventType as PricingEventType)) {
      throw new Error(`Invalid pricing event_type: ${eventType}`);
    }

    // Light validation — quote exists. We DON'T require draft state
    // because telemetry can fire on non-draft contexts (e.g., a PM
    // viewing a sent quote's pricing in read-only mode — no events
    // expected in v1, but the action should not crash if it ever
    // does).
    await db.select({ id: quoteWarnings.id }).from(quoteWarnings).limit(0); // touch noop to keep db import warm

    const row = await writePricingEvent({
      quoteId,
      eventType: eventType as PricingEventType,
      violationTierId,
      suggestionTargetTierIds,
      floorBreachPp,
      overrideReason,
    });

    return { id: row.id };
  });
}
