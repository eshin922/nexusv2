/**
 * WHICH CONTROL A SPEC FIELD GETS — the schema decides, the key guesses.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────
 *
 * `spec-panel` chose its control by FIELD KEY alone: keys containing
 * `additional` / `description` / `packout` rendered a textarea, everything else
 * a hard-coded `<input type="text">`. `field.type` was never read.
 *
 * So `tp_units_per_case` — declared `"type": "number"`, and the only typed
 * numeric field in any live schema — rendered as a generic text box. Nothing
 * failed: a schema author could mark a field `number` and silently get text.
 * The field's NAME was governing the control the SCHEMA is supposed to.
 *
 * The two also disagreed about which fields are multi-line, and agreed only by
 * coincidence. `tp_description` rendered as a textarea because its key contains
 * "description", not because the schema says `"type": "textarea"` — the right
 * control for the wrong reason, which holds exactly until a schema names a
 * long-form field something else.
 *
 * ── PRECEDENCE ──────────────────────────────────────────────────────────
 *
 * An explicit `type` wins. The heuristic applies ONLY where the schema is
 * silent — which is every PP and SP field today, so their rendering is
 * unchanged, and the heuristic survives exactly as long as the untyped schemas
 * that need it.
 *
 * ── WHY IT LIVES HERE AND NOT IN THE COMPONENT ──────────────────────────
 *
 * It is a pure decision about a schema, and keeping it out of the `"use client"`
 * component is what lets it be exercised directly rather than inferred from
 * rendered markup. A precedence rule that can only be checked by reading JSX is
 * one that drifts.
 */
import type { LeafSpecField } from "@/lib/leaf-spec-loader";

export type SpecFieldControl = "textarea" | "number" | "text";

export function resolveFieldControl(field: LeafSpecField): SpecFieldControl {
  // ── Explicit schema type — the authority ────────────────────────────
  if (field.type === "textarea") return "textarea";
  if (field.type === "number") return "number";
  if (field.type === "text") return "text";
  // `select` is declared in the type union and used by no live schema. It gets
  // a text input rather than a silently wrong control, and is named here so the
  // gap stays visible instead of being absorbed by the fallback below.
  // Rendering an actual picker is a schema-surface change, not this repair.
  if (field.type === "select") return "text";

  // ── No explicit type — the pre-existing key heuristic, unchanged ─────
  //
  // Wide multi-line fields trigger textarea rendering; everything else is
  // single-line. Every live PP and SP field lands here.
  return field.key.includes("additional") ||
    field.key.includes("description") ||
    field.key.includes("packout")
    ? "textarea"
    : "text";
}
