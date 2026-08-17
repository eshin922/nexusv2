"use client";

/**
 * Client Target, authored on the sellable-unit row.
 *
 * ── WHERE THIS SITS, AND WHY ──────────────────────────────────────────────
 *
 * On the row, because the row IS the unit of account: an Item Group finished
 * good, or a Direct Product. Nested member rows get no affordance at all — the
 * client named a price for the finished product, not for the bottle inside it.
 * The action refuses a member leaf too, but an operator never reaches that
 * refusal, and a refusal you cannot trigger is a better surface than one you
 * can.
 *
 * It is NOT in the Tiers table, where the vacated Price Adj column was. That
 * column holds one value per tier, which is exactly one sellable unit's worth,
 * and a quote with two Item Groups — or an Item Group and a Direct Product —
 * has no way to say which one it means.
 *
 * ── PRECEDENCE IS NOT REPRODUCED HERE ─────────────────────────────────────
 *
 * `tier target ?? common target` is governed, and this file consumes it
 * through `resolveClientTarget` rather than restating it. The summary copy
 * likewise comes from `summariseClientTargets`. Two implementations of one
 * precedence rule is the defect this whole model replaced — the previous read
 * path resolved differently from the engine and the two disagreed whenever a
 * tier carried its own target.
 *
 * ── NO PRICING SIDE EFFECTS ───────────────────────────────────────────────
 *
 * A benchmark. Nothing here touches a GPA, a tier adjustment, a lift, a direct
 * price or a Final Quoted Sell — the actions it calls write one table.
 */

import { useState, useTransition } from "react";

import { Drawer, DrawerBody, DrawerHead } from "@/components/modal/drawer";
import {
  clearAllClientTargets,
  clearClientTarget,
  setClientTarget,
  type SellableUnitKind,
} from "@/app/actions/client-targets";
import {
  resolveClientTarget,
  summariseClientTargets,
  type UnitTargets,
} from "@/lib/client-target";

export type TargetTier = { id: string; label: string; qty: number | null };

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });

/**
 * A read↔edit money cell.
 *
 * Empty renders as an em-dash, never `$0.00`: zero is a target somebody chose
 * — "we need this at cost" — and absence is not that. Committing an empty
 * value clears; committing a number sets.
 */
function TargetInput({
  value,
  inherited,
  placeholder,
  disabled,
  onCommit,
  ariaLabel,
}: {
  /** This row's OWN value. Null when it has none of its own. */
  value: number | null;
  /**
   * The value in force here anyway, when this row has none of its own.
   *
   * Shown muted rather than as an em-dash. A tier inheriting $5.00 and a tier
   * with no target at all are different states, and rendering both as "—"
   * makes the number column say the same thing about each — leaving the
   * caption beneath to carry a distinction the figure contradicts.
   */
  inherited?: number | null;
  placeholder: string;
  disabled: boolean;
  onCommit: (next: number | null) => void;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!editing) {
    return (
      <button
        type="button"
        className="ct-read"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => {
          setDraft(value === null ? "" : String(value));
          setEditing(true);
        }}
      >
        {value !== null ? (
          usd(value)
        ) : inherited != null ? (
          <span className="ct-inherited">{usd(inherited)}</span>
        ) : (
          <span className="ct-unset">—</span>
        )}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    const raw = draft.trim();
    if (raw === "") {
      if (value !== null) onCommit(null);
      return;
    }
    const n = Number(raw);
    // Not a commercial rule — a parse guard. Whether a target is sensible is
    // the operator's call; whether they typed a number is this input's.
    if (!Number.isFinite(n) || n < 0) return;
    if (value !== null && n === value) return;
    onCommit(n);
  };

  return (
    <input
      className="ct-input"
      autoFocus
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      // Pattern 47(e): never `disabled={pending}` on an input — blocking it
      // mid-save drops focus and the next keystroke goes nowhere.
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setEditing(false);
        }
      }}
    />
  );
}

/**
 * The row affordance: the common target, and a way into the tier detail.
 *
 * Rendered only by `asy-row` and `direct-product-row` — the two top-level
 * sellable units.
 */
export function ClientTargetCell({
  unitKind,
  unitId,
  unitLabel,
  targets,
  tiers,
  editable,
}: {
  unitKind: SellableUnitKind;
  unitId: string;
  unitLabel: string;
  targets: UnitTargets | undefined;
  tiers: ReadonlyArray<TargetTier>;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const common = targets?.common ?? null;
  const summary = summariseClientTargets(targets, tiers.length);

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error?.message ?? "Could not save.");
    });
  }

  const fd = (extra: Record<string, string>) => {
    const f = new FormData();
    f.set("unitKind", unitKind);
    f.set("unitId", unitId);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };

  return (
    <div className="ct-cell">
      <span className="ct-k">Client target</span>
      <TargetInput
        value={common}
        placeholder="0.00"
        disabled={!editable}
        ariaLabel={`Common client target for ${unitLabel}`}
        onCommit={(next) =>
          run(() =>
            next === null
              ? clearClientTarget(fd({}))
              : setClientTarget(fd({ value: String(next) })),
          )
        }
      />
      <button
        type="button"
        className="ct-sub"
        onClick={() => setOpen(true)}
        // Enabled even when nothing is set: the drawer is how a tier-specific
        // target gets made in the first place.
        title={`Tier-specific client targets for ${unitLabel}`}
      >
        {error ?? (pending ? "saving…" : (summary ?? "set a target"))}
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        label={`Client target · ${unitLabel}`}
      >
        <DrawerHead>
          <div className="psr-drawer-title">
            <span className="who">{unitLabel}</span>
            <span className="where">
              Client target · internal — never quoted
            </span>
          </div>
          <button className="btn ghost sm" type="button" onClick={() => setOpen(false)}>
            ✕
          </button>
        </DrawerHead>

        <DrawerBody>
          <section className="psr-drawer-sect">
            <h3 className="psr-drawer-sect-k">Common target</h3>
            <div className="ct-drawer-row">
              <span className="ct-drawer-lab">Applies to every tier</span>
              <TargetInput
                value={common}
                placeholder="0.00"
                disabled={!editable}
                ariaLabel={`Common client target for ${unitLabel}`}
                onCommit={(next) =>
                  run(() =>
                    next === null
                      ? clearClientTarget(fd({}))
                      : setClientTarget(fd({ value: String(next) })),
                  )
                }
              />
            </div>
            {common === null && (targets?.byTier.size ?? 0) > 0 && (
              <p className="psr-drawer-empty">
                No common target. The tiers below without one of their own have
                no client target at all.
              </p>
            )}
          </section>

          <section className="psr-drawer-sect">
            <h3 className="psr-drawer-sect-k">By tier</h3>
            {tiers.length === 0 ? (
              <p className="psr-drawer-empty">
                Add tiers to set tier-specific targets.
              </p>
            ) : (
              tiers.map((t) => {
                // GOVERNED RESOLUTION, not a local `??`. Same function the
                // adapter uses, so the row cannot say one thing and the
                // engine another.
                const { value, source } = resolveClientTarget(targets, t.id);
                const own = source === "tier";
                return (
                  <div className="ct-drawer-row" key={t.id}>
                    <span className="ct-drawer-lab">
                      {t.label}
                      {t.qty !== null && (
                        <span className="ct-drawer-qty">
                          {" · "}
                          {t.qty.toLocaleString()}
                        </span>
                      )}
                    </span>
                    <span className="ct-drawer-val">
                      <TargetInput
                        value={own ? value : null}
                        // What is in force here regardless — muted, so the
                        // figure and the caption beneath it agree.
                        inherited={own ? null : value}
                        placeholder={value === null ? "0.00" : String(value)}
                        disabled={!editable}
                        ariaLabel={`Client target for ${t.label}`}
                        onCommit={(next) =>
                          run(() =>
                            next === null
                              ? clearClientTarget(fd({ tierId: t.id }))
                              : setClientTarget(
                                  fd({ tierId: t.id, value: String(next) }),
                                ),
                          )
                        }
                      />
                      <span className="ct-drawer-src">
                        {own ? (
                          <>
                            <span className="ct-own">
                              tier target
                              {common !== null && ` · replaces common ${usd(common)}`}
                            </span>
                            <button
                              type="button"
                              className="ct-revert"
                              disabled={!editable}
                              onClick={() =>
                                run(() => clearClientTarget(fd({ tierId: t.id })))
                              }
                            >
                              revert to common
                            </button>
                          </>
                        ) : value === null ? (
                          "no target"
                        ) : (
                          "common"
                        )}
                      </span>
                    </span>
                  </div>
                );
              })
            )}
          </section>

          {(common !== null || (targets?.byTier.size ?? 0) > 0) && (
            <section className="psr-drawer-sect">
              <button
                type="button"
                className="btn ghost sm"
                disabled={!editable}
                onClick={() => run(() => clearAllClientTargets(fd({})))}
              >
                Clear all targets
              </button>
              <p className="psr-drawer-empty" style={{ marginTop: 8 }}>
                Removes the common target and every tier-specific one. Clearing
                the common target alone leaves tier targets standing.
              </p>
            </section>
          )}

          {error && (
            <section className="psr-drawer-sect">
              <p className="ct-error">{error}</p>
            </section>
          )}
        </DrawerBody>
      </Drawer>
    </div>
  );
}
