"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UNCLASSIFIED_SOURCE_TYPE } from "@/lib/library-source-type";
import type { LibraryBrowseRow } from "@/lib/library-browse-loader";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import {
  fetchHubspotProductTypes,
  fetchLibraryBrowse,
  restoreLeaf,
} from "@/app/actions/leaves";
import { attachAssemblyLeaf } from "@/app/actions/assemblies";
import { attachQuoteProduct } from "@/app/actions/quote-products";
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
  // slice-library-modal-polish Step 4 — count of LEAF children
  // attached to this ASY. Rendered in the picker menu's meta line
  // ("ASY-sku · N components") per CD designer notes §3. Derived
  // from tree.assemblies[].children.length at the
  // assembly-tree-view.tsx call site.
  leafCount: number;
};

export function LibraryBrowseModal({
  mode = "group",
  open,
  onClose,
  quoteId,
  projectId,
  assemblies,
  leafTypes,
  fullLeafTypes,
  permissions,
}: {
  /**
   * `direct` — attach the chosen product straight to the quote
   * (`assembly_id = NULL`). No Item Group is created, ever, including when the
   * quote ends up holding exactly one product.
   *
   * `group` — the existing grouped path: pick or create an Item Group, then add
   * products inside it.
   *
   * Defaults to `group` so any caller not yet passing a mode keeps its current
   * behaviour rather than silently changing structure.
   */
  mode?: "direct" | "group";
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
  // HubSpot classification filter — the populated vocabulary. `typeFilter`
  // above is retained for the Nexus taxonomy but is no longer chip-driven.
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>("");
  const [hsTypeOptions, setHsTypeOptions] = useState<
    { label: string; value: string }[]
  >([]);
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
  // slice-library-modal-polish Step 8 hotfix BUG-LMP-2-A —
  // libraryTotalActive (archived=false count) triggers the
  // library-empty (⊹) shape when all leaves are archived. Split
  // from libraryTotal so the result-count denominator stays
  // aligned with the rendered (active + archived) scope while
  // the empty-state branching reads the PM-facing "is there
  // anything to browse" signal.
  const [libraryTotalActive, setLibraryTotalActive] = useState(0);
  const [catalogState, setCatalogState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [scenarioLabel, setScenarioLabel] = useState("");
  // slice-library-modal-polish Step 2 — clientName threaded for the
  // CD redesign subtitle "{client} · {qid}" landing in Step 3. NULL
  // when project has no client_name set.
  const [clientName, setClientName] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);
  // slice-library-first-creation-flow Step 3 — stacked AddProductModal
  // state. Click "+ Create new product" → setCreateOpen(true) → modal
  // mounts on top of library backdrop. Step 4 formalizes the stacking
  // via the .r-a1v2-modal-stacked nexus extension (z-index: 110 +
  // capture-phase Escape with stopImmediatePropagation).
  const [createOpen, setCreateOpen] = useState(false);
  // slice-library-modal-polish Step 4 — attach-target picker menu
  // open state. Click .lib-target-select toggles; click outside or
  // selecting an item closes. Single source of truth for the
  // attach destination (row buttons just say "Attach"; the target
  // bar holds the selected ASY).
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const targetMenuRef = useRef<HTMLDivElement>(null);
  // slice-library-first-creation-flow Step 4 — attach toast state
  // per locked Q9. Fires on successful attachAssemblyLeaf with the
  // "Attached '{leaf name}' to {ASY sku}." copy. Auto-dismisses 3s
  // (same effect shape as AddProductModal's toast).
  const [toast, setToast] = useState<string | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Governed HubSpot vocabulary for the type chips. Fetched, never listed
  // locally: a hard-coded copy drifts silently the moment an option is added.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const r = await fetchHubspotProductTypes();
      if (!cancelled && r.ok) setHsTypeOptions(r.data.options);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

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
        sourceTypeFilter: sourceTypeFilter || undefined,
          scopeFilter,
          targetQuoteId: quoteId,
        });
        if (!result.ok) {
          setError(result.error.message);
          setCatalogState("error");
          return;
        }
        setRows(result.data.rows);
        setTotal(result.data.total);
        setLibraryTotal(result.data.libraryTotal);
        setLibraryTotalActive(result.data.libraryTotalActive);
        setScenarioLabel(result.data.scenarioLabel);
        setClientName(result.data.clientName);
        setCatalogState("ready");
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [open, search, typeFilter, sourceTypeFilter, scopeFilter, quoteId]);

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
    setLibraryTotalActive(0);
    setCatalogState("loading");
    setScenarioLabel("");
    setClientName(null);
    setError(null);
    setAttaching(null);
    setCreateOpen(false);
    setToast(null);
    setTargetMenuOpen(false);
  }, [open]);

  // slice-library-modal-polish Step 4 — default target selection on
  // modal open. CD designer notes §3 lock: "the target is always
  // set." Default to the first ASY in the quote so the bar reads
  // as an active control from first render. Falls back to "" if no
  // assemblies exist (zero-ASY first-touch case; bar renders a
  // placeholder, row attach buttons disable).
  useEffect(() => {
    if (!open) return;
    if (targetAssemblyId) return;
    if (assemblies.length > 0) {
      setTargetAssemblyId(assemblies[0].id);
    }
  }, [open, assemblies, targetAssemblyId]);

  // slice-library-modal-polish Step 4 — click-outside dismiss for
  // the target picker menu. Document-level listener attached only
  // while the menu is open to keep the keydown/mousedown surface
  // tidy. Captures clicks on the modal body / backdrop / other
  // affordances that aren't the menu itself.
  useEffect(() => {
    if (!targetMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (!targetMenuRef.current) return;
      if (targetMenuRef.current.contains(e.target as Node)) return;
      setTargetMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [targetMenuOpen]);

  // slice-library-first-creation-flow Step 4 — auto-dismiss attach
  // toast after 3s. Matches AddProductModal's toast lifecycle.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Re-fetch the library after a successful "+ Create new" submit, or after
  // a pull.
  //
  // This cleared all filters "so the new leaf surfaces at the top of the
  // list immediately", which was true of a small library and is not true of
  // this one. The list is alphabetical and paged at 50 of 1000+, so an
  // unfiltered refresh puts a new component wherever its name sorts —
  // usually nowhere the operator can see. Creation appeared to do nothing.
  //
  // A created component does not need to be on page 1, but it does need to
  // be immediately CONFIRMABLE. So a create focuses the list on the name it
  // just created; a pull, which has no single subject, still clears.
  function refreshLibrary(focusName?: string) {
    const search = focusName ?? "";
    setSearch(search);
    setTypeFilter("");
    setScopeFilter("all");
    startTransition(async () => {
      const refreshed = await fetchLibraryBrowse({
        search,
        typeFilter: undefined,
        scopeFilter: "all",
        targetQuoteId: quoteId,
      });
      if (refreshed.ok) {
        setRows(refreshed.data.rows);
        setTotal(refreshed.data.total);
        setLibraryTotal(refreshed.data.libraryTotal);
        setLibraryTotalActive(refreshed.data.libraryTotalActive);
        setScenarioLabel(refreshed.data.scenarioLabel);
        setClientName(refreshed.data.clientName);
      }
    });
    router.refresh();
  }

  const targetAssembly = useMemo(
    () => assemblies.find((a) => a.id === targetAssemblyId) ?? null,
    [assemblies, targetAssemblyId],
  );

  // Direct mode needs no target: the quote IS the target. Gating it on an
  // assembly would have made Add Product impossible on a quote with no Item
  // Groups — precisely the quote it exists to serve.
  const attachReady = mode === "direct" || Boolean(targetAssemblyId);

  function handleAttach(row: LibraryBrowseRow) {
    const direct = mode === "direct";
    if (!direct && !targetAssemblyId) {
      setError("Pick a target item group at the top of the modal first.");
      return;
    }
    setAttaching(row.leafId);
    // Snapshot the target sku before the async transition so the
    // toast carries the value even if the user changes the target
    // picker between submit + result. handleAttach is invoked from
    // the row's button, so targetAssembly was current at click time.
    const targetSkuAtClick = direct
      ? "this quote"
      : (targetAssembly?.sku ?? "the item group");
    const fd = new FormData();
    if (direct) {
      fd.set("quoteId", quoteId);
    } else {
      fd.set("assemblyId", targetAssemblyId);
    }
    fd.set("leafId", row.leafId);
    startTransition(async () => {
      setError(null);
      // Two writers, chosen by the operator's explicit action — never by
      // product count, and never by falling back from one to the other.
      const result = direct
        ? await attachQuoteProduct(fd)
        : await attachAssemblyLeaf(fd);
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
        sourceTypeFilter: sourceTypeFilter || undefined,
        scopeFilter,
        targetQuoteId: quoteId,
      });
      if (refreshed.ok) {
        setRows(refreshed.data.rows);
        setTotal(refreshed.data.total);
        setLibraryTotal(refreshed.data.libraryTotal);
        setLibraryTotalActive(refreshed.data.libraryTotalActive);
        setScenarioLabel(refreshed.data.scenarioLabel);
        setClientName(refreshed.data.clientName);
      }
      router.refresh();
    });
  }

  // slice-library-modal-polish Step 5 — restore handler. Mirrors
  // handleAttach's optimistic-state shape: setAttaching marks the
  // row pending; restoreLeaf action flips archived to false; on
  // success, re-fetch the library so the row flips readiness
  // 'archived' → 'ready'. Permission gating happens server-side
  // (assertCanCreateLeaves); UI also gates the button visibility
  // via permissions.canCreateLeaves below.
  function handleRestore(row: LibraryBrowseRow) {
    setAttaching(row.leafId);
    startTransition(async () => {
      setError(null);
      const result = await restoreLeaf(row.leafId);
      setAttaching(null);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setToast(`Restored "${row.name}" to the library.`);
      const refreshed = await fetchLibraryBrowse({
        search,
        typeFilter: typeFilter || undefined,
        sourceTypeFilter: sourceTypeFilter || undefined,
        scopeFilter,
        targetQuoteId: quoteId,
      });
      if (refreshed.ok) {
        setRows(refreshed.data.rows);
        setTotal(refreshed.data.total);
        setLibraryTotal(refreshed.data.libraryTotal);
        setLibraryTotalActive(refreshed.data.libraryTotalActive);
        setScenarioLabel(refreshed.data.scenarioLabel);
        setClientName(refreshed.data.clientName);
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
    // Wrapped: a pull reports its own progress and has no single subject to
    // focus, so it must not receive one positionally.
    onComplete: () => refreshLibrary(),
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
        className="a1v2-modal lib-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-browse-title"
      >
        {/* slice-library-modal-polish Step 3 — modal frame + header
            redesign per CD prototype. The .lib-head replaces the
            prior .a1v2-card-head; title drops "leaves" jargon for
            PM-facing "components" (CD §1.5 / issue 5). Subtitle
            consumes clientName (Step 2 loader extension) + quoteId
            for context. .lib-refresh + .lib-close styled affordances
            replace the prior a1v2-btn ghost sm buttons. Modal sizing
            (.lib-modal: width min(940px,100%); max-height calc(100vh
            - 120px)) overrides the inline maxWidth that previously
            constrained the modal. */}
        <div className="lib-head">
          <div className="title-wrap">
            <h2 id="library-browse-title">
              Library <em>· components</em>
            </h2>
            <span className="sub">
              {/* {client} · {qid} per CD data-source map §Header.
                  clientName is nullable on projects; fallback to em-
                  dash. quoteId rendered as 8-char prefix (CD mock
                  uses friendly 6-char SKU-like ids; production UUIDs
                  truncated to comparable density). Banked as v1.1+
                  polish if PMs prefer scenarioLabel/version instead. */}
              {clientName ?? "—"} · {quoteId.slice(0, 8)}
            </span>
          </div>
          <div className="head-actions">
            <button
              type="button"
              className="a1v2-btn primary sm"
              onClick={() => setCreateOpen(true)}
              disabled={!permissions.canCreateLeaves}
              aria-disabled={!permissions.canCreateLeaves}
              title={
                permissions.canCreateLeaves
                  ? "Create a new HubSpot Product and reusable library component"
                  : "You don't have permission to create new products. Ask an admin."
              }
            >
              + Create new product
            </button>
            {/* Subtle refresh — forensic affordance per CD §5. Same
                permission gate + click handler as the Step 5
                (predecessor slice) inline pull entry point; the
                inline progress band lives inside the modal body. */}
            <button
              type="button"
              className="lib-refresh"
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
                  : "You don't have permission to refresh the library catalog. Ask an admin."
              }
            >
              <span className="glyph">↗</span>
              Refresh from HubSpot
            </button>
            <button
              type="button"
              className="lib-close"
              onClick={onClose}
              disabled={pending || !!attaching}
              aria-label="Close library"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="a1v2-library-browse">
          {/* slice-library-modal-polish Step 7 — inline pull
              progress band redesign per CD designer notes §6 +
              .lib-pull-band canonical CSS. Three states:
                - active pull (pulling-active | pulling-archived)
                  → spinner + reassurance copy + running count
                - complete → green-soft success summary + Dismiss
                - error → red-soft error + Retry + Dismiss
              Band sits in a fixed slot between .lib-head and
              .lib-target-bar (CD §6: "the band's position above
              the attach bar means the filter row and table never
              reflow when it appears/disappears"). */}
          {pull.isPulling && (
            <div
              className="lib-pull-band"
              role="status"
              aria-live="polite"
            >
              <div className="spin" aria-hidden="true" />
              <div className="track-wrap">
                <div className="lab">
                  <strong>Refreshing catalog from HubSpot…</strong>{" "}
                  existing components stay usable
                </div>
                {pull.latestBatch && (
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: "var(--ink-4)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Batch {pull.totals.batchCount}:{" "}
                    {pull.latestBatch.processed} processed · +
                    {pull.latestBatch.added} added · ~
                    {pull.latestBatch.updated} updated ·{" "}
                    {pull.latestBatch.archived} archived
                  </div>
                )}
              </div>
              <div className="count">
                {/* CD prototype assumes a denominator (done/total);
                    production HubSpot list paginates by cursor with
                    no total. Display the running processed count
                    + phase label instead. */}
                {pull.totals.processed.toLocaleString()} processed ·{" "}
                {pull.phase === "pulling-active"
                  ? "pass 1/2"
                  : "pass 2/2"}
              </div>
            </div>
          )}
          {/* Completion + error states keep the prior inline-styled
              shapes since CD's .lib-pull-band CSS only covers the
              active pull case. PMs see the summary briefly then
              dismiss. */}
          {(pull.phase === "complete" || pull.phase === "error") && (
            <div
              role="status"
              aria-live="polite"
              style={{
                padding: "10px 22px",
                background:
                  pull.phase === "error"
                    ? "var(--bad-soft, var(--paper-2))"
                    : "var(--good-soft, var(--paper-2))",
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
                  {pull.phase === "complete"
                    ? "Pull complete"
                    : "Pull paused — retry resumes from last batch"}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
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
                  <button
                    type="button"
                    className="a1v2-btn ghost sm"
                    onClick={pull.reset}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
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
          {/* slice-library-modal-polish Step 4 — persistent prominent
              attach-target bar per CD designer notes §3. The
              selected ASY is the implicit object of every row's
              Attach action; the bar is the single source of the
              attach destination (row buttons just say "Attach"). */}
          <div className="lib-target-bar">
            <span className="eyebrow">Adding to</span>
            {mode === "direct" ? (
              // No picker in direct mode: the destination is the quote, and a
              // control offering item groups here would invite the operator to
              // group a product they explicitly chose not to group.
              <span className="name" style={{ justifySelf: "flex-start" }}>
                This quote — as a standalone product
              </span>
            ) : (
            <div
              ref={targetMenuRef}
              style={{ position: "relative", justifySelf: "flex-start" }}
            >
              {targetAssembly ? (
                <div
                  className="lib-target-select"
                  onClick={() => setTargetMenuOpen((v) => !v)}
                  role="button"
                  tabIndex={0}
                  aria-haspopup="menu"
                  aria-expanded={targetMenuOpen}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setTargetMenuOpen((v) => !v);
                    }
                  }}
                >
                  <span className="asy-icon" aria-hidden="true">
                    ◈
                  </span>
                  <span className="asy-body">
                    <span className="name">{targetAssembly.name}</span>
                    <span className="meta">
                      {targetAssembly.sku} · {targetAssembly.leafCount}{" "}
                      component{targetAssembly.leafCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="chevron" aria-hidden="true">
                    ▾
                  </span>
                </div>
              ) : (
                <div
                  className="lib-target-select"
                  style={{
                    background: "var(--paper-2)",
                    borderColor: "var(--rule)",
                    boxShadow: "none",
                    cursor: "default",
                  }}
                  aria-disabled="true"
                >
                  <span className="asy-icon" aria-hidden="true">
                    ◈
                  </span>
                  <span className="asy-body">
                    <span
                      className="name"
                      style={{ color: "var(--ink-3)" }}
                    >
                      No item groups in this quote
                    </span>
                    <span className="meta">
                      Create an item group before adding products
                    </span>
                  </span>
                </div>
              )}
              {targetMenuOpen && assemblies.length > 0 && (
                <div
                  className="lib-target-menu"
                  role="menu"
                  aria-label="Pick item group"
                >
                  <div className="header">
                    Item groups in {scenarioLabel || "this scenario"}
                  </div>
                  {assemblies.map((a) => {
                    const active = a.id === targetAssemblyId;
                    return (
                      <div
                        key={a.id}
                        className={`item${active ? " active" : ""}`}
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => {
                          setTargetAssemblyId(a.id);
                          setTargetMenuOpen(false);
                        }}
                      >
                        <span
                          className="asy-icon"
                          style={{ width: 24, height: 24, fontSize: 12 }}
                          aria-hidden="true"
                        >
                          ◈
                        </span>
                        <span>
                          <span className="name">{a.name}</span>
                          <span
                            className="meta"
                            style={{ display: "block" }}
                          >
                            {a.sku} · {a.leafCount} component
                            {a.leafCount === 1 ? "" : "s"}
                          </span>
                        </span>
                        {active && (
                          <span className="check" aria-hidden="true">
                            ✓
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
            )}
            <span className="target-hint">
              {mode === "direct"
                ? "Each product you add becomes its own quote line"
                : "Products you add land in this item group"}
            </span>
          </div>

          {/* slice-library-modal-polish Step 5 — filter row
              consolidation per CD designer notes §8. Three control
              rows (search + type + scope) collapse to one row
              (search + type segmented + result count). Scope filter
              dropped from the default row per CD §8 ("forensic
              chrome weight; if needed it belongs in overflow/
              advanced affordance, not the default row"). */}
          <div className="lib-filters">
            <div className="lib-search">
              <span className="glyph" aria-hidden="true">
                ⌕
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or SKU"
                aria-label="Search library"
              />
            </div>
            {/* Type filter, driven by HubSpot's classification rather than the
                Nexus taxonomy. The Nexus column carries a value on 26 of 1,077
                leaves, so filtering it returned almost nothing and read as
                broken; `hs_product_type` is populated on 1,032 of 1,037 HubSpot
                products.

                Chips render the LABEL and filter on the VALUE — they differ on
                the three largest categories, so a label-keyed predicate would
                return zero for Primary, Secondary and Logistics.

                "Unclassified" is a SELECTABLE state, not an absence. Before it,
                choosing any type silently dropped every unclassified product
                with nothing on screen saying so. */}
            <div className="lib-seg" role="tablist" aria-label="Type filter">
              <button
                type="button"
                role="tab"
                aria-selected={sourceTypeFilter === ""}
                className={sourceTypeFilter === "" ? "active" : ""}
                onClick={() => setSourceTypeFilter("")}
              >
                All types
              </button>
              {hsTypeOptions.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={sourceTypeFilter === t.value}
                  className={sourceTypeFilter === t.value ? "active" : ""}
                  onClick={() => setSourceTypeFilter(t.value)}
                  title={`HubSpot product type · ${t.value}`}
                >
                  {t.label}
                </button>
              ))}
              <button
                type="button"
                role="tab"
                aria-selected={sourceTypeFilter === UNCLASSIFIED_SOURCE_TYPE}
                className={
                  sourceTypeFilter === UNCLASSIFIED_SOURCE_TYPE ? "active" : ""
                }
                onClick={() => setSourceTypeFilter(UNCLASSIFIED_SOURCE_TYPE)}
                title="Products with no HubSpot classification — Nexus-local, or unclassified in HubSpot"
              >
                Unclassified
              </button>
            </div>
            <span className="lib-result-count">
              {pending && rows.length === 0
                ? "loading…"
                : `${rows.length} of ${libraryTotal}`}
            </span>
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

          {/* slice-library-modal-polish Step 5 — 5-col results
              table per CD designer notes §1. Fixed-height (56px)
              rows scale to ~990 HubSpot catalog items without
              collapse. Empty states retain Step 2's two-shape copy
              + Step 3's "+ Create new product" CTA (Step 6
              redesigns the .lib-empty visual shape). */}
          <div className="lib-results">
            {/* slice-library-modal-polish Step 8 hotfix BUG-LMP-2-A —
                empty-state branching lifted out of `rows.length ===
                0` gate. When libraryTotalActive === 0, the ⊹ shape
                takes priority and suppresses the table even if
                archived rows exist (rows.length > 0). Otherwise
                the filtered-empty ∅ shape triggers on no-row
                results. */}
            {catalogState === "loading" ? (
              <div className="lib-empty" role="status" aria-live="polite">
                <span
                  className="h-5 w-5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent"
                  aria-hidden="true"
                />
                <h3>Loading components</h3>
                <p>Checking the reusable Product Library.</p>
              </div>
            ) : catalogState === "error" && rows.length === 0 ? (
              <div className="lib-empty" role="status">
                <div className="glyph" aria-hidden="true">
                  !
                </div>
                <h3>Library unavailable</h3>
                <p>
                  The catalog could not be loaded. You can still create a new
                  product or try again later.
                </p>
              </div>
            ) : libraryTotalActive === 0 ? (
              /* slice-library-modal-polish Step 6 — library-empty
                 shape per CD §4. Generative glyph ⊹; two equal-
                 weight CTAs (Create new + Refresh from HubSpot —
                 Refresh promoted to primary here, the only place
                 it carries primary visual weight per CD §5).
                 Permission note beneath when !canCreateLeaves. */
              <div className="lib-empty">
                  <div className="glyph" aria-hidden="true">
                    ⊹
                  </div>
                  <h3>Your library is empty</h3>
                  <p>
                    No reusable components yet. Create your first one,
                    or pull your existing catalog from HubSpot to get
                    started.
                  </p>
                  <div className="cta-row">
                    <button
                      type="button"
                      className="lib-empty-cta primary"
                      onClick={() => setCreateOpen(true)}
                      disabled={!permissions.canCreateLeaves}
                      aria-disabled={!permissions.canCreateLeaves}
                    >
                      + Create new product →
                    </button>
                    <button
                      type="button"
                      className="lib-empty-cta secondary"
                      onClick={pull.start}
                      disabled={
                        !permissions.canCreateLeaves ||
                        pull.pending ||
                        pull.isPulling
                      }
                      aria-disabled={!permissions.canCreateLeaves}
                    >
                      ↗ Refresh from HubSpot
                    </button>
                  </div>
                  {!permissions.canCreateLeaves && (
                    <div className="perm-note">
                      You don&apos;t have permission to create new
                      products. Ask an admin.
                    </div>
                  )}
                </div>
            ) : rows.length === 0 && !pending ? (
              /* slice-library-modal-polish Step 6 — filtered-to-
                 zero shape per CD §4. Null-set glyph ∅; query
                 echoed back in a .q chip; Create new (primary) +
                 Clear search (secondary). Refresh is absent —
                   pulling won't help a bad query (CD §4 lock). */
                <div className="lib-empty">
                  <div className="glyph" aria-hidden="true">
                    ∅
                  </div>
                  <h3>No components match</h3>
                  <p>
                    Nothing in the library matches{" "}
                    <span className="q">{search}</span>. Adjust the
                    search, or create it as a new product.
                  </p>
                  <div className="cta-row">
                    <button
                      type="button"
                      className="lib-empty-cta primary"
                      onClick={() => setCreateOpen(true)}
                      disabled={!permissions.canCreateLeaves}
                      aria-disabled={!permissions.canCreateLeaves}
                    >
                      + Create new product →
                    </button>
                    <button
                      type="button"
                      className="lib-empty-cta secondary"
                      onClick={() => setSearch("")}
                    >
                      Clear search
                    </button>
                  </div>
                  {!permissions.canCreateLeaves && (
                    <div className="perm-note">
                      You don&apos;t have permission to create new
                      products. Ask an admin.
                    </div>
                  )}
                </div>
            ) : null}
            {libraryTotalActive > 0 && rows.length > 0 && (
              <>
                <div className="lib-table-head">
                  <span className="h rail" aria-hidden="true" />
                  <span className="h name">Component</span>
                  <span className="h type">Type</span>
                  <span className="h status">Status</span>
                  <span className="h action">Action</span>
                </div>
                {rows.map((row) => {
                  /* slice-library-modal-polish Step 5 — readiness
                     derivation client-side per CD designer notes §7.
                     `attached` reads against the currently-selected
                     target ASY (re-evaluates when target changes).
                     `archived` takes priority — an archived leaf
                     shows the Restore action regardless of any-ASY
                     attachment status. */
                  const readiness: "ready" | "attached" | "archived" =
                    row.archived
                      ? "archived"
                      : targetAssemblyId &&
                          row.attachedAssemblyIdsInTargetQuote.includes(
                            targetAssemblyId,
                          )
                        ? "attached"
                        : "ready";
                  const source: "nexus" | "hubspot" = row.hubspotProductId
                    ? "hubspot"
                    : "nexus";
                  return (
                    <div
                      key={row.leafId}
                      className={`lib-row ${readiness}`}
                    >
                      <span className="rail" aria-hidden="true" />
                      <div className="name-cell">
                        <span className="icon" aria-hidden="true">
                          ◦
                        </span>
                        <span className="text">
                          <span className="name">{row.name}</span>
                          <span className="sub">
                            <span
                              className={`src ${source}`}
                              title={
                                source === "hubspot"
                                  ? `Sourced from HubSpot · product id ${row.hubspotProductId}`
                                  : "Nexus-local"
                              }
                            >
                              {source}
                            </span>
                            <span>SKU {row.sku ?? "—"}</span>
                            <span className="usage">
                              · {row.totalRefs} group
                              {row.totalRefs === 1 ? "" : "s"} ·{" "}
                              {row.totalScenarios} scenario
                              {row.totalScenarios === 1 ? "" : "s"}
                            </span>
                          </span>
                        </span>
                      </div>
                      <span className="type-cell">
                        {row.productType?.name ?? "untyped"}
                      </span>
                      <span className="status-cell">
                        {/* §9.4 — surface the ALREADY-ENFORCED eligibility
                            state before the operator spends an action on it.
                            `row.eligibility` is the server's own verdict from
                            `evaluateAttachmentEligibility`; nothing here
                            re-derives it, so the badge and the refusal can
                            never disagree.

                            Shown INSTEAD of the readiness pill, not beside it:
                            a product that cannot be attached has no meaningful
                            readiness, and showing "ready · not projectable"
                            together would be contradictory. Archived keeps its
                            own pill — that state has a Restore path. */}
                        {!row.eligibility.attachable &&
                        row.eligibility.reason === "missing_sku" ? (
                          <span
                            className="status-pill not-projectable"
                            title={row.eligibility.message}
                          >
                            <span className="dot" aria-hidden="true" />
                            not projectable — no SKU
                          </span>
                        ) : (
                          <span className={`status-pill ${readiness}`}>
                            <span className="dot" aria-hidden="true" />
                            {readiness}
                          </span>
                        )}
                      </span>
                      <span className="action-cell">
                        {/* Readiness-driven action: Attach (ready) /
                            ✓ Attached (attached, no button) /
                            Restore (archived, perm-gated). */}
                        {readiness === "attached" ? (
                          <span className="lib-attached-mark">
                            ✓ Attached
                          </span>
                        ) : readiness === "archived" ? (
                          <button
                            type="button"
                            className="lib-restore-btn"
                            onClick={() => handleRestore(row)}
                            disabled={
                              !permissions.canCreateLeaves ||
                              attaching === row.leafId ||
                              pending
                            }
                            aria-disabled={!permissions.canCreateLeaves}
                            title={
                              permissions.canCreateLeaves
                                ? "Restore this leaf to the active catalog"
                                : "You don't have permission to restore library items. Ask an admin."
                            }
                          >
                            {attaching === row.leafId
                              ? "Restoring…"
                              : "Restore"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="lib-attach-btn"
                            onClick={() => handleAttach(row)}
                            disabled={
                              // Preventative only. The server gate remains
                              // authoritative — this stops the operator
                              // spending an action on a refusal they can
                              // already be shown.
                              !row.eligibility.attachable ||
                              !attachReady ||
                              attaching === row.leafId ||
                              pending
                            }
                            aria-disabled={
                              !attachReady || !row.eligibility.attachable
                            }
                            title={
                              // A disabled control must say why (Pattern 47f).
                              // The server's own message is reused verbatim, so
                              // the operator reads the same reason whether they
                              // hover it here or trigger the refusal.
                              !row.eligibility.attachable
                                ? row.eligibility.message
                                : mode === "direct"
                                  ? "Add this product to the quote"
                                  : targetAssemblyId
                                    ? `Add to ${targetAssembly?.sku}`
                                    : "Create an item group first to enable adding"
                            }
                          >
                            {attaching === row.leafId ? "Adding…" : "Add"}
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
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
            refreshLibrary(r.name);
          }
        }}
        stacked
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
