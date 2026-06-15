"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LibraryBrowseRow } from "@/lib/library-browse-loader";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { fetchLibraryBrowse } from "@/app/actions/leaves";
import { attachAssemblyLeaf } from "@/app/actions/assemblies";
import { AddProductModal } from "@/components/add-product/add-product-modal";
import { usePullFromHubSpot } from "@/components/assembly-tree/use-pull-from-hubspot";

// Phase A.1 v2 impl-5 — Library browse modal (scenarios ⑰-⑱).
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// LibraryBrowse (lines 692-753). Modal-style surface — opens
// from the Setup tree's "+ Add leaf from library →" affordance.
//
// Two nexus extensions vs canonical:
//   1. ASY-target selector at top of the modal — canonical
//      hardcodes "+ Add to GLW-30"; nexus lets PM pick the target
//      ASY from a dropdown of available assemblies in the quote.
//      "All ASYs" mode shows attach as inert ("Pick a target ASY").
//   2. Debounced server-side filter — canonical filters in-memory;
//      nexus pushes filter state to the server (handles future
//      large library sizes). For v1 scale (<100 leaves) the
//      tradeoff is minor.
//
// Pattern 47: search input is controlled; no `disabled={pending}`
// on the input. Per-row attach buttons may use disabled={pending}
// (button-only scope per rule (e)).

const SEARCH_DEBOUNCE_MS = 300;

export type AssemblyTarget = {
  id: string;
  sku: string;
  name: string;
};

export function LibraryBrowseModal({
  open,
  onClose,
  quoteId,
  projectId,
  assemblies,
  leafTypes,
  assemblyTypes,
  fullLeafTypes,
  permissions,
}: {
  open: boolean;
  onClose: () => void;
  quoteId: string;
  // slice-library-first-creation-flow Step 3 — projectId threaded
  // for the nested AddProductModal launched from "+ Create new
  // product" (its LEAF-Continue path navigates to
  // /projects/[id]/quotes/[quoteId]/leaves/[leafId]/specs).
  projectId: string;
  assemblies: AssemblyTarget[];
  // Type-filter dropdown options (id + name + placeholder).
  leafTypes: { id: string; name: string; placeholder: boolean }[];
  // slice-library-first-creation-flow Step 3 — AddProductModal
  // form requires the full leaf-spec-entry shape (id + name +
  // placeholder + fieldSchema). Threaded through alongside the
  // type-filter shape; same source (loadProductTypeOptions) on
  // the page.
  assemblyTypes: { id: string; name: string }[];
  fullLeafTypes: LeafSpecEntryProductType[];
  // slice-library-first-creation-flow Step 3 — per locked Q6:
  // gate "+ Create new product" + (Step 5) "↗ Refresh from
  // HubSpot" affordances on canCreateLeaves. Attach actions stay
  // ungated at UI layer (server-side gate is canonical).
  permissions: { canCreateLeaves: boolean };
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "this" | "other">(
    "all",
  );
  const [targetAssemblyId, setTargetAssemblyId] = useState<string>("");
  const [rows, setRows] = useState<LibraryBrowseRow[]>([]);
  const [total, setTotal] = useState(0);
  // slice-library-first-creation-flow Step 2 — libraryTotal lets
  // empty-state copy distinguish "library is empty" (libraryTotal
  // === 0) from "filtered to zero" (libraryTotal > 0 &&
  // rows.length === 0). scenarioLabel surfaced for later steps'
  // modal sub-copy "Find or create a component for {scenarioLabel}".
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [scenarioLabel, setScenarioLabel] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);
  // slice-library-first-creation-flow Step 3 — stacked AddProductModal
  // state. Click "+ Create new product" → setCreateOpen(true) → modal
  // mounts on top of library backdrop. Step 4 formalizes the stacking
  // via the .r-a1v2-modal-stacked nexus extension (z-index: 110 +
  // capture-phase Escape with stopImmediatePropagation).
  const [createOpen, setCreateOpen] = useState(false);
  // slice-library-first-creation-flow Step 4 — attach toast state
  // per locked Q9. Fires on successful attachAssemblyLeaf with the
  // "Attached '{leaf name}' to {ASY sku}." copy. Auto-dismisses 3s
  // (same effect shape as AddProductModal's toast).
  const [toast, setToast] = useState<string | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load + filter changes (debounced for search input).
  useEffect(() => {
    if (!open) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      startTransition(async () => {
        setError(null);
        const result = await fetchLibraryBrowse({
          search,
          typeFilter: typeFilter || undefined,
          scopeFilter,
          targetQuoteId: quoteId,
        });
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setRows(result.data.rows);
        setTotal(result.data.total);
        setLibraryTotal(result.data.libraryTotal);
        setScenarioLabel(result.data.scenarioLabel);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [open, search, typeFilter, scopeFilter, quoteId]);

  // Escape dismiss.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending && !attaching) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, pending, attaching, onClose]);

  // Reset state on close. Pull state (lives in the hook) is reset
  // in a separate effect after the hook call below — hooks rules
  // require a stable call order.
  useEffect(() => {
    if (open) return;
    setSearch("");
    setTypeFilter("");
    setScopeFilter("all");
    setTargetAssemblyId("");
    setRows([]);
    setTotal(0);
    setLibraryTotal(0);
    setScenarioLabel("");
    setError(null);
    setAttaching(null);
    setCreateOpen(false);
    setToast(null);
  }, [open]);

  // slice-library-first-creation-flow Step 4 — auto-dismiss attach
  // toast after 3s. Matches AddProductModal's toast lifecycle.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // slice-library-first-creation-flow Step 3 — re-fetch library
  // after a successful "+ Create new" submit. Reused by both empty-
  // state Create-new paths + the post-AddProductModal success
  // callback. Clears search/type/scope filters so the new leaf
  // surfaces at the top of the list immediately. Pattern mirrors
  // the attach refresh below.
  function refreshLibrary() {
    setSearch("");
    setTypeFilter("");
    setScopeFilter("all");
    startTransition(async () => {
      const refreshed = await fetchLibraryBrowse({
        search: "",
        typeFilter: undefined,
        scopeFilter: "all",
        targetQuoteId: quoteId,
      });
      if (refreshed.ok) {
        setRows(refreshed.data.rows);
        setTotal(refreshed.data.total);
        setLibraryTotal(refreshed.data.libraryTotal);
        setScenarioLabel(refreshed.data.scenarioLabel);
      }
    });
    router.refresh();
  }

  const targetAssembly = useMemo(
    () => assemblies.find((a) => a.id === targetAssemblyId) ?? null,
    [assemblies, targetAssemblyId],
  );

  function handleAttach(row: LibraryBrowseRow) {
    if (!targetAssemblyId) {
      setError("Pick a target ASY at the top of the modal first.");
      return;
    }
    setAttaching(row.leafId);
    // Snapshot the target sku before the async transition so the
    // toast carries the value even if the user changes the target
    // picker between submit + result. handleAttach is invoked from
    // the row's button, so targetAssembly was current at click time.
    const targetSkuAtClick = targetAssembly?.sku ?? "ASY";
    const fd = new FormData();
    fd.set("assemblyId", targetAssemblyId);
    fd.set("leafId", row.leafId);
    startTransition(async () => {
      setError(null);
      const result = await attachAssemblyLeaf(fd);
      setAttaching(null);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      // slice-library-first-creation-flow Step 4 — attach toast
      // fires on success per locked Q9. Auto-dismisses 3s via the
      // toast useEffect above.
      setToast(`Attached "${row.name}" to ${targetSkuAtClick}.`);
      // Refresh the library data so the row flips to "✓ in scenario"
      // (and refresh the Setup tree behind the modal).
      const refreshed = await fetchLibraryBrowse({
        search,
        typeFilter: typeFilter || undefined,
        scopeFilter,
        targetQuoteId: quoteId,
      });
      if (refreshed.ok) {
        setRows(refreshed.data.rows);
        setTotal(refreshed.data.total);
        setLibraryTotal(refreshed.data.libraryTotal);
        setScenarioLabel(refreshed.data.scenarioLabel);
      }
      router.refresh();
    });
  }

  // slice-library-first-creation-flow Step 5 — pull engine for the
  // inline progress band. onComplete refreshes the library browse
  // rows so newly-pulled leaves surface immediately. Pull-pending
  // blocks the modal close affordance just like an in-flight attach.
  const pull = usePullFromHubSpot({
    projectId,
    onComplete: refreshLibrary,
  });
  const pullBlocking = pull.isPulling;

  // Reset pull state when modal closes. Companion to the close-reset
  // effect above (separate effect because hooks rules require the
  // pull hook call before this).
  useEffect(() => {
    if (open) return;
    pull.reset();
    // pull.reset is stable across renders (hook returns the same
    // identity); intentionally omitted from deps to avoid the lint
    // warning + unnecessary re-fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="a1v2-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (
          e.target === e.currentTarget &&
          !pending &&
          !attaching &&
          !pullBlocking
        )
          onClose();
      }}
    >
      <div
        className="a1v2-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-browse-title"
        style={{ maxWidth: 920 }}
      >
        <div className="a1v2-card-head" style={{ borderBottom: "1px solid var(--rule)" }}>
          <h3 id="library-browse-title">
            Library <em>· reusable leaves</em>
          </h3>
          <div className="actions">
            <span className="meta">
              {pending && rows.length === 0 ? "loading…" : `${total} leaves`}
            </span>
            {/* slice-library-first-creation-flow Step 5 — Refresh
                from HubSpot affordance per locked Q3 disposition.
                Small ghost button in header; click triggers the
                pull via the hook (progress renders inline below
                the head; no nested modal). Gated on
                canCreateLeaves per locked Q6. */}
            <button
              type="button"
              className="a1v2-btn ghost sm"
              onClick={pull.start}
              disabled={
                !permissions.canCreateLeaves ||
                pull.pending ||
                pull.isPulling ||
                pending ||
                !!attaching
              }
              aria-disabled={!permissions.canCreateLeaves}
              title={
                permissions.canCreateLeaves
                  ? "Pull HubSpot products into the library"
                  : "You don't have permission to create new products. Ask an admin."
              }
            >
              ↗ Refresh from HubSpot
            </button>
            <button
              type="button"
              className="a1v2-btn ghost sm"
              onClick={onClose}
              disabled={pending || !!attaching}
            >
              Close
            </button>
          </div>
        </div>

        <div className="a1v2-library-browse">
          {/* slice-library-first-creation-flow Step 5 — inline pull
              progress band per locked Q5 disposition β. Renders
              below the head when phase != idle. Three states:
              pulling (active or archived sweep), error (with
              retry), complete (auto-clears via the same Close
              gating used by attach pending). PMs stay visually
              in library context — no nested overlay. */}
          {pull.phase !== "idle" && (
            <div
              role="status"
              aria-live="polite"
              style={{
                padding: "10px 14px",
                background:
                  pull.phase === "error"
                    ? "var(--bad-soft, var(--paper-2))"
                    : pull.phase === "complete"
                      ? "var(--good-soft, var(--paper-2))"
                      : "var(--paper-2)",
                borderBottom: "1px solid var(--rule)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: 12,
                color: "var(--ink-2)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--ink-3)",
                  }}
                >
                  {pull.phase === "pulling-active" &&
                    "Pulling… pass 1/2 · active products"}
                  {pull.phase === "pulling-archived" &&
                    "Pulling… pass 2/2 · archived sweep"}
                  {pull.phase === "complete" && "Pull complete"}
                  {pull.phase === "error" &&
                    "Pull paused — retry resumes from last batch"}
                </span>
                {pull.phase === "error" && (
                  <button
                    type="button"
                    className="a1v2-btn primary sm"
                    onClick={pull.retry}
                    disabled={pull.pending}
                  >
                    Retry from batch{" "}
                    {pull.retryCursor?.batchNumber ?? "?"}
                  </button>
                )}
                {(pull.phase === "complete" || pull.phase === "error") && (
                  <button
                    type="button"
                    className="a1v2-btn ghost sm"
                    onClick={pull.reset}
                  >
                    Dismiss
                  </button>
                )}
              </div>
              {pull.isPulling && pull.latestBatch && (
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--ink-3)",
                  }}
                >
                  Batch {pull.totals.batchCount}:{" "}
                  {pull.latestBatch.processed} processed · +
                  {pull.latestBatch.added} added · ~
                  {pull.latestBatch.updated} updated ·{" "}
                  {pull.latestBatch.archived} archived
                </div>
              )}
              {pull.phase === "complete" && (
                <div style={{ color: "var(--good, var(--ink))" }}>
                  ✓ Pulled {pull.totals.processed} HubSpot product
                  {pull.totals.processed === 1 ? "" : "s"} ·{" "}
                  {pull.totals.added} added · {pull.totals.updated}{" "}
                  updated · {pull.totals.archived} archived
                </div>
              )}
              {pull.phase === "error" && pull.errorMessage && (
                <div
                  role="alert"
                  style={{ color: "var(--bad, var(--ink))" }}
                >
                  {pull.errorMessage}
                </div>
              )}
            </div>
          )}
          {/* Nexus extension: ASY-target selector. Replaces canonical
              hardcoded "+ Add to GLW-30". */}
          <div
            className="a1v2-library-target"
            style={{
              padding: "10px 14px",
              background: "var(--paper-2)",
              borderBottom: "1px solid var(--rule)",
              display: "flex",
              gap: 10,
              alignItems: "center",
              fontSize: 12.5,
              color: "var(--ink-3)",
            }}
          >
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-4)" }}>
              Attach target:
            </span>
            <select
              value={targetAssemblyId}
              onChange={(e) => setTargetAssemblyId(e.target.value)}
              style={{ minWidth: 260 }}
            >
              <option value="">— Pick an ASY in this quote —</option>
              {assemblies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.sku} · {a.name}
                </option>
              ))}
            </select>
            {targetAssembly ? (
              <span style={{ color: "var(--ink-3)" }}>
                Attach button label will say{" "}
                <code style={{ fontFamily: "var(--mono)" }}>+ Add to {targetAssembly.sku}</code>
              </span>
            ) : (
              <span style={{ color: "var(--ink-4)" }}>
                Pick a target to enable attach actions
              </span>
            )}
          </div>

          <div className="a1v2-library-search">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or SKU"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">All types</option>
              {leafTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.placeholder ? " · fields TBD" : ""}
                </option>
              ))}
            </select>
            <select
              value={scopeFilter}
              onChange={(e) =>
                setScopeFilter(e.target.value as typeof scopeFilter)
              }
            >
              <option value="all">All scenarios</option>
              <option value="this">This scenario only</option>
              <option value="other">Used elsewhere</option>
            </select>
          </div>

          {error ? (
            <div
              role="alert"
              style={{
                padding: "8px 16px",
                color: "var(--bad)",
                fontFamily: "var(--mono)",
                fontSize: 11,
              }}
            >
              {error}
            </div>
          ) : null}

          <div className="a1v2-library-results">
            {/* slice-library-first-creation-flow Step 2 — empty-state
                copy splits into two shapes per locked Q3 disposition:
                  - libraryTotal === 0 → "Library is empty…" (first-touch)
                  - libraryTotal > 0 + rows.length === 0 → "No
                    components match '{search}.' Library has N
                    components total." (filtered to zero)
                "Create new" CTA + inline Pull progress band land in
                Steps 3 + 5. */}
            {rows.length === 0 && !pending ? (
              <div
                style={{
                  padding: "24px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  alignItems: "center",
                  textAlign: "center",
                }}
              >
                {libraryTotal === 0 ? (
                  <p
                    style={{
                      color: "var(--ink-3)",
                      fontStyle: "italic",
                      margin: 0,
                    }}
                  >
                    Library is empty. Start by creating your first
                    product or pulling the HubSpot catalog.
                  </p>
                ) : (
                  <p
                    style={{
                      color: "var(--ink-3)",
                      fontStyle: "italic",
                      margin: 0,
                    }}
                  >
                    No components match &ldquo;{search}.&rdquo;
                    Library has {libraryTotal} components total. Try
                    a different search, or:
                  </p>
                )}
                {/* slice-library-first-creation-flow Step 3 —
                    + Create new product CTA per locked Q5. Renders
                    in both empty-state shapes (truly-empty +
                    filtered-empty). Per Q6: disabled when
                    !canCreateLeaves, with explanatory tooltip. */}
                <button
                  type="button"
                  className="a1v2-btn primary sm"
                  onClick={() => setCreateOpen(true)}
                  disabled={!permissions.canCreateLeaves}
                  aria-disabled={!permissions.canCreateLeaves}
                  title={
                    permissions.canCreateLeaves
                      ? "Create a new product and add it to the library"
                      : "You don't have permission to create new products. Ask an admin."
                  }
                >
                  + Create new product →
                </button>
              </div>
            ) : null}
            {rows.map((row) => {
              const alreadyHere =
                row.attachedAssemblyIdsInTargetQuote.length > 0;
              const alreadyOnTarget =
                targetAssemblyId &&
                row.attachedAssemblyIdsInTargetQuote.includes(targetAssemblyId);
              return (
                <div
                  key={row.leafId}
                  className={`a1v2-library-row${alreadyHere ? " in-scenario" : ""}`}
                >
                  <span className="icon" aria-hidden="true">
                    ◦
                  </span>
                  <div className="name-cell">
                    <div className="name">{row.name}</div>
                    <div className="sku">SKU {row.sku ?? "—"}</div>
                  </div>
                  <span className="type-tag">
                    {row.productType?.name ?? "untyped"}
                  </span>
                  {/* slice-hubspot-bidirectional Step 7 — origin
                      indicator. Renders only when leaf has a HubSpot
                      anchor; absence implies Nexus-local. accent-soft
                      register distinguishes from the rule/paper-2
                      type-tag chip so HubSpot-sourced reads at a
                      glance during library browse. */}
                  {row.hubspotProductId && (
                    <span
                      title={`Sourced from HubSpot · product id ${row.hubspotProductId}`}
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "var(--accent-ink, var(--ink-2))",
                        background: "var(--accent-soft, var(--paper-2))",
                        border:
                          "1px solid var(--accent, var(--rule))",
                        borderRadius: 3,
                        padding: "1px 6px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ⤓ HS
                    </span>
                  )}
                  <span className="refs-cell">
                    <strong>{row.totalRefs}</strong> ASY
                    {row.totalRefs === 1 ? "" : "s"} ·{" "}
                    {row.totalScenarios} scenario
                    {row.totalScenarios === 1 ? "" : "s"}
                  </span>
                  {alreadyOnTarget ? (
                    <span className="already-in">✓ on this ASY</span>
                  ) : (
                    <button
                      type="button"
                      className="a1v2-btn sm"
                      onClick={() => handleAttach(row)}
                      disabled={
                        !targetAssemblyId ||
                        attaching === row.leafId ||
                        pending
                      }
                      aria-disabled={!targetAssemblyId}
                    >
                      {attaching === row.leafId
                        ? "Adding…"
                        : targetAssembly
                          ? `+ Add to ${targetAssembly.sku}`
                          : "Pick target ASY"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* slice-library-first-creation-flow Step 3 — stacked
          AddProductModal. Mounted as a peer inside the library
          backdrop's tree; AddProductModal's own backdrop
          (.a1v2-modal-backdrop with position:fixed inset:0)
          covers the viewport regardless of mount location. Both
          modals share z-index:100 in canonical CSS; later mount
          wins by DOM order (Step 4 formalizes via
          .r-a1v2-modal-stacked nexus extension + Escape
          stopPropagation). onSuccess refreshes library +
          re-fetches so the new leaf surfaces immediately. */}
      <AddProductModal
        quoteId={quoteId}
        projectId={projectId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={(r) => {
          if (r.kind === "leaf") {
            refreshLibrary();
          }
        }}
        stacked
        assemblyTypes={assemblyTypes}
        leafTypes={fullLeafTypes}
      />
      {/* slice-library-first-creation-flow Step 4 — attach toast
          per locked Q9. Matches the .a1v2-toast register PR #50
          commit 10 shipped (fixed bottom-right via nexus extension;
          glyph + body structure). Auto-dismisses 3s. */}
      {toast ? (
        <div className="a1v2-toast" role="status" aria-live="polite">
          <span className="glyph">✓</span>
          <div className="body">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}
