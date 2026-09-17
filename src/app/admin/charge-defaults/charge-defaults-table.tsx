"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clearChargeProfile,
  removeChargeDefault,
  setNoneExpected,
  upsertChargeDefault,
} from "@/app/actions/charge-defaults";
import {
  COMPONENT_CHARGE_LABELS,
  type ComponentChargeKey,
} from "@/lib/commercial-recovery/registry";
import {
  describeEmptyResolution,
  type ChargeDefaultsResolution,
} from "@/lib/commercial-recovery/charge-defaults";

export type ChargeDefaultsRowView = {
  productTypeValue: string;
  /** What the operator reads. Diverges from the value for three types. */
  label: string;
  /** False once HubSpot stops offering the option. */
  inVocabulary: boolean;
  resolution: ChargeDefaultsResolution;
};

type Refusable = { ok: boolean; error?: { message: string } };
type Runner = (
  key: string,
  fd: FormData,
  action: (f: FormData) => Promise<Refusable>,
  done: string,
) => void;

/**
 * The four states, rendered as four different things.
 *
 * ── WHY EACH STATE GETS ITS OWN TREATMENT ────────────────────────────────
 *
 * The whole point of the schema is that "nobody looked" and "somebody looked
 * and found none" are different answers. Rendering both as an empty list would
 * undo that here, at the only place an admin ever sees it — and it would look
 * finished while doing so.
 *
 * `contradiction` is shown as a fault, with its detail, rather than quietly
 * resolved toward whichever side the surface finds convenient. A state that
 * should not occur survives by being hidden.
 *
 * ── PENDING IS PER ROW AND PER ACTION ────────────────────────────────────
 *
 * Pattern 47(f). One key per (product type, action), so saving a preselection
 * on one type cannot grey out a control on another, and every disabled control
 * names its reason in `title`.
 */
export function ChargeDefaultsTable({
  rows,
  chargeKeys,
}: {
  rows: ChargeDefaultsRowView[];
  chargeKeys: ComponentChargeKey[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run: Runner = (key, fd, action, done) => {
    setError(null);
    setNotice(null);
    setPendingKey(key);
    start(async () => {
      try {
        const r = await action(fd);
        if (!r.ok) {
          setError(r.error?.message ?? "The change was refused.");
          // REFRESH ON REFUSAL TOO, and this is not symmetry for its own sake.
          //
          // The most likely reason a write is refused is that the screen is
          // stale — another admin removed the rule, or recorded a verdict,
          // since this page was rendered. Without the re-read the operator is
          // told "there is no such rule" while the rule is still listed in
          // front of them, which reads as a broken control rather than as an
          // out-of-date screen. Found by clicking Remove on a rule that had
          // been deleted from another connection.
          //
          // Safe to do here: `router.refresh()` re-renders the server tree and
          // leaves client state alone, so a half-typed note survives it.
          router.refresh();
          return;
        }
        setNotice(done);
        router.refresh();
      } finally {
        // Always cleared, including on a refused request — a control left
        // pending after a failure is dead with no explanation.
        setPendingKey(null);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          data-testid="charge-defaults-error"
          className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          data-testid="charge-defaults-notice"
          className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <Row
            key={row.productTypeValue}
            row={row}
            chargeKeys={chargeKeys}
            pendingKey={pendingKey}
            run={run}
          />
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-slate-600">
            No product types to show. This is not a statement that none exist —
            see the vocabulary notice above.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  row,
  chargeKeys,
  pendingKey,
  run,
}: {
  row: ChargeDefaultsRowView;
  chargeKeys: ComponentChargeKey[];
  pendingKey: string | null;
  run: Runner;
}) {
  const { resolution: r, productTypeValue: value } = row;
  const [adding, setAdding] = useState<ComponentChargeKey | "">("");
  const [note, setNote] = useState("");

  const suggested =
    r.kind === "suggestions" ? r.suggestions.map((s) => s.chargeKey) : [];
  const addable = chargeKeys.filter((k) => !suggested.includes(k));

  const key = (action: string) => `${value}:${action}`;
  const busy = (action: string) => pendingKey === key(action);

  return (
    <section
      data-testid={`charge-defaults-row-${value}`}
      data-state={r.kind}
      className="rounded border border-slate-200 p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{row.label}</h2>
          {row.label !== value && (
            // The three divergent options. Shown because a rule is stored
            // against the VALUE, and an admin debugging one needs to see it.
            <p className="text-[11px] text-slate-500">
              stored as <code>{value}</code>
            </p>
          )}
          {!row.inVocabulary && (
            <p className="mt-1 text-[11px] text-amber-800">
              HubSpot no longer offers this option. Existing rules are kept and
              can be removed; nothing can be classified under it.
            </p>
          )}
        </div>
        <StateChip kind={r.kind} />
      </header>

      {/* ── what the state actually says ──────────────────────────────── */}
      <div className="mt-2 text-xs text-slate-700">
        {r.kind === "needs_review" && <p>{describeEmptyResolution(r)}</p>}
        {r.kind === "none_expected" && (
          <p>
            {describeEmptyResolution(r)}{" "}
            <span className="text-slate-500">
              — {r.reviewedByEmail ?? "unknown reviewer"} on{" "}
              {r.reviewedAt.toISOString().slice(0, 10)}
            </span>
            {r.note && <span className="text-slate-500"> · {r.note}</span>}
          </p>
        )}
        {r.kind === "suggestions" && (
          <p className="text-slate-500">
            Reviewed by {r.reviewedByEmail ?? "unknown reviewer"} on{" "}
            {r.reviewedAt.toISOString().slice(0, 10)}
          </p>
        )}
        {r.kind === "contradiction" && (
          <p
            role="alert"
            className="rounded border border-rose-200 bg-rose-50 p-2 text-rose-900"
          >
            <strong>Inconsistent.</strong> {r.detail}. No supported action
            produces this, so something wrote these tables from outside the
            application. {r.remedy}
          </p>
        )}
      </div>

      {/* ── the rules ─────────────────────────────────────────────────── */}
      {r.kind === "suggestions" && (
        <ul className="mt-3 flex flex-col gap-2">
          {r.suggestions.map((s) => {
            const toggleKey = `${value}:toggle:${s.chargeKey}`;
            const removeKey = `${value}:remove:${s.chargeKey}`;
            const isOnlyRule = r.suggestions.length === 1;
            return (
              <li
                key={s.chargeKey}
                className="flex flex-wrap items-center gap-3 text-xs"
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={s.preselected}
                    // NOT disabled while pending: Pattern 47(e). A disabled
                    // input drops focus mid-save.
                    onChange={(e) => {
                      const checked = e.target.checked;
                      const fd = new FormData();
                      fd.set("productTypeValue", value);
                      fd.set("chargeKey", s.chargeKey);
                      if (checked) fd.set("preselected", "on");
                      if (s.note) fd.set("note", s.note);
                      run(
                        toggleKey,
                        fd,
                        upsertChargeDefault,
                        `${COMPONENT_CHARGE_LABELS[s.chargeKey]} is now ${
                          checked ? "preselected" : "offered unticked"
                        } for ${row.label}.`,
                      );
                    }}
                  />
                  <span className="font-medium text-slate-900">
                    {COMPONENT_CHARGE_LABELS[s.chargeKey]}
                  </span>
                  <span className="text-slate-500">
                    {s.preselected ? "ticked by default" : "offered, not ticked"}
                  </span>
                </label>
                {s.note && <span className="text-slate-500">· {s.note}</span>}
                {pendingKey === toggleKey && (
                  <span className="text-slate-500" aria-live="polite">
                    saving…
                  </span>
                )}
                <button
                  type="button"
                  className="ml-auto text-rose-700 underline disabled:text-slate-400"
                  // The LAST rule cannot be removed — the action refuses it,
                  // because removing it would leave the type reviewed with
                  // nothing to suggest. The control says so before the admin
                  // finds out, and names both ways forward (Pattern 60: a
                  // control expresses the failure it excludes). The server
                  // still refuses independently, which is what catches a stale
                  // screen showing two rules when one remains.
                  disabled={isOnlyRule || pendingKey === removeKey}
                  title={
                    isOnlyRule
                      ? "This is the only suggested charge. To swap it, add the replacement first. To record that none are expected, use Clear review, then None expected."
                      : pendingKey === removeKey
                        ? "Removing this rule…"
                        : undefined
                  }
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("productTypeValue", value);
                    fd.set("chargeKey", s.chargeKey);
                    run(
                      removeKey,
                      fd,
                      removeChargeDefault,
                      `${COMPONENT_CHARGE_LABELS[s.chargeKey]} removed from ${row.label}.`,
                    );
                  }}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── controls ──────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
        <select
          aria-label={`Charge to suggest for ${row.label}`}
          value={adding}
          onChange={(e) => setAdding(e.target.value as ComponentChargeKey | "")}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="">Add a suggested charge…</option>
          {addable.map((k) => (
            <option key={k} value={k}>
              {COMPONENT_CHARGE_LABELS[k]}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label={`Why this charge applies to ${row.label}`}
          placeholder="Why (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 disabled:text-slate-400"
          disabled={adding === "" || busy("add")}
          title={
            adding === ""
              ? "Choose a charge to suggest first."
              : busy("add")
                ? "Adding…"
                : undefined
          }
          onClick={() => {
            if (adding === "") return;
            const fd = new FormData();
            fd.set("productTypeValue", value);
            fd.set("chargeKey", adding);
            if (note.trim()) fd.set("note", note.trim());
            run(
              key("add"),
              fd,
              upsertChargeDefault,
              `${COMPONENT_CHARGE_LABELS[adding]} will be offered for ${row.label}.`,
            );
            setAdding("");
            setNote("");
          }}
        >
          Add
        </button>

        {r.kind !== "none_expected" && (
          <button
            type="button"
            data-testid={`none-expected-${value}`}
            className="rounded border border-slate-300 px-2 py-1 disabled:text-slate-400"
            disabled={suggested.length > 0 || busy("none")}
            title={
              suggested.length > 0
                ? // Named, not merely blocked. The action refuses this too; the
                  // control says so before the operator finds out.
                  `Remove the ${suggested.length} suggested charge(s) first — recording "none expected" will not discard rules somebody added.`
                : busy("none")
                  ? "Recording…"
                  : undefined
            }
            onClick={() => {
              const fd = new FormData();
              fd.set("productTypeValue", value);
              if (note.trim()) fd.set("note", note.trim());
              run(
                key("none"),
                fd,
                setNoneExpected,
                `${row.label}: reviewed, no one-time charges expected.`,
              );
              setNote("");
            }}
          >
            None expected
          </button>
        )}

        {r.kind !== "needs_review" && (
          <button
            type="button"
            className="ml-auto text-slate-600 underline disabled:text-slate-400"
            disabled={busy("clear")}
            title={
              busy("clear")
                ? "Clearing…"
                : "Returns this type to needs review and removes its rules."
            }
            onClick={() => {
              const fd = new FormData();
              fd.set("productTypeValue", value);
              run(
                key("clear"),
                fd,
                clearChargeProfile,
                `${row.label} returned to needs review.`,
              );
            }}
          >
            Clear review
          </button>
        )}
      </div>
    </section>
  );
}

function StateChip({ kind }: { kind: ChargeDefaultsResolution["kind"] }) {
  const text: Record<ChargeDefaultsResolution["kind"], string> = {
    needs_review: "Needs review",
    none_expected: "None expected",
    suggestions: "Suggestions",
    contradiction: "Inconsistent",
  };
  const tone: Record<ChargeDefaultsResolution["kind"], string> = {
    needs_review: "border-slate-300 bg-slate-50 text-slate-700",
    none_expected: "border-sky-300 bg-sky-50 text-sky-900",
    suggestions: "border-emerald-300 bg-emerald-50 text-emerald-900",
    contradiction: "border-rose-300 bg-rose-50 text-rose-900",
  };
  return (
    <span
      data-testid={`state-chip-${kind}`}
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone[kind]}`}
    >
      {text[kind]}
    </span>
  );
}
