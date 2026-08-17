"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { LibrarySpecModal } from "./library-spec-modal";
import { useRouter } from "next/navigation";
import { UNCLASSIFIED_SOURCE_TYPE } from "@/lib/library-source-type";
import { directServiceLabel } from "@/lib/product-structure/direct-service";

/** B-11 · rows per page. Matches the loader default so the pager's arithmetic
 *  and the query agree without either having to know the other's number. */
const PAGE_SIZE = 50;
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
  initialTargetAssemblyId,
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
  /**
   * Preselected destination for `group` mode.
   *
   * Set when the Library is opened FROM an Item Group row, where the operator
   * has already named the destination by choosing which row to act on. Asking
   * them to pick it again in a menu would be asking a question they just
   * answered.
   */
  initialTargetAssemblyId?: string;
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
  const [targetAssemblyId, setTargetAssemblyId] = useState<string>(
    initialTargetAssemblyId ?? "",
  );
  const [rows, setRows] = useState<LibraryBrowseRow[]>([]);
  const [total, setTotal] = useState(0);
  // B-11 · paging state. `offset` resets whenever the filter set changes —
  // staying on page 4 of a result set that just became 12 rows long would show
  // an empty list and read as "no matches".
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
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
  const [specOpen, setSpecOpen] = useState(false);
  const [specLeafId, setSpecLeafId] = useState<string | null>(null);
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

  // B-11 · a filter change returns to page 1. Holding the offset across a
  // filter change lands the operator past the end of the new result set, which
  // renders an empty list and reads as "no matches" rather than as "page 4".
  useEffect(() => {
    setOffset(0);
  }, [search, sourceTypeFilter, scopeFilter, quoteId]);

  // Initial load + filter changes (debounced for search input).
  useEffect(() => {
    if (!open) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      startTransition(async () => {
        setError(null);
        const result = await fetchLibraryBrowse({
          search,
          offset,
          limit: PAGE_SIZE,
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
        setHasMore(result.data.hasMore);
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
  }, [open, search, typeFilter, sourceTypeFilter, scopeFilter, quoteId, offset]);

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
    // An explicit destination wins, and is re-applied on every open: the same
    // modal instance serves a different Item Group each time it is launched
    // from a row, so carrying the previous target forward would silently attach
    // to the wrong group.
    if (initialTargetAssemblyId) {
      setTargetAssemblyId(initialTargetAssemblyId);
      return;
    }
    if (targetAssemblyId) return;
    if (assemblies.length > 0) {
      setTargetAssemblyId(assemblies[0].id);
    }
  }, [open, assemblies, targetAssemblyId, initialTargetAssemblyId]);

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
            {/* Step 2B — ONE control, not a chip row.
                
                The horizontal treatment could not hold the vocabulary: 15
                production categories clipped, and the set is dynamic, so any
                fixed-width row is wrong for whatever HubSpot has next. Smaller
                type, wrapping, horizontal scroll and a curated subset were all
                rejected — each keeps the control's width as the constraint on
                what the operator can reach.

                A native <select> follows the vocabulary at whatever size it is,
                shows its own selection, and is keyboard-accessible and
                screen-reader-addressable without any work from us. */}
            <select
              className="lib-type-select"
              aria-label="Filter by HubSpot product type"
              value={sourceTypeFilter}
              onChange={(e) => setSourceTypeFilter(e.target.value)}
            >
              <option value="">All types</option>
              {/* LABEL shown, VALUE submitted. They differ on the three largest
                  categories, so a label-keyed predicate returns zero for
                  Primary, Secondary and Logistics. */}
              {hsTypeOptions.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
              {/* A selectable STATE, not an absence. Without it, choosing any
                  type silently dropped every unclassified product. */}
              <option value={UNCLASSIFIED_SOURCE_TYPE}>Unclassified</option>
            </select>
            {/* B-11.1 · this said `${rows.length} of ${libraryTotal}` — "50 of
                1,082" — no matter what the filters were set to. It sits beside
                the filters, so it is the number an operator reads immediately
                after changing one, and it answered a question nobody asked:
                how big is the page, out of how big is the library.

                It now answers the question the filter poses — how many products
                match — and the pager below answers where in those matches this
                page sits. Two counts that were contradicting each other became
                two counts answering different questions. */}
            <span className="lib-result-count">
              {pending && rows.length === 0
                ? "loading…"
                : total === libraryTotal
                  ? `${libraryTotal.toLocaleString()} products`
                  : `${total.toLocaleString()} of ${libraryTotal.toLocaleString()} match`}
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
                  // B-14 · `attached` now answers the question the operator is
                  // actually asking: is this product already in this quote at
                  // the place I am about to put it?
                  //
                  // The previous form required BOTH a selected Item Group AND a
                  // legacy junction row. In Direct Product mode there is no
                  // target group, so it short-circuited to `ready` and the row
                  // kept offering `Add` after a successful attach — the operator
                  // clicked again and nothing happened, because the attach was
                  // idempotent and the badge was simply blind to it.
                  const readiness: "ready" | "attached" | "archived" =
                    row.archived
                      ? "archived"
                      : targetAssemblyId
                        ? row.attachedAssemblyIdsInTargetQuote.includes(
                            targetAssemblyId,
                          )
                          ? "attached"
                          : "ready"
                        : // Direct Product mode — attached means attached at
                          // quote level with no group.
                          row.attachedDirectInTargetQuote
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
                      {/* B-2 — the Library's visible Type is HubSpot's
                          classification, because HubSpot's value is what this
                          surface FILTERS on. Reading the Nexus taxonomy here
                          made a product HubSpot classifies correctly display
                          as "untyped" whenever Nexus's separate and largely
                          unset taxonomy had no row — the column disagreeing
                          with the chips directly above it.

                          Raw value stays the authority; the label is looked up
                          for display only. Nexus productTypeId is neither read
                          nor written here: two taxonomies, no mapping. */}
                      <span className="type-cell">
                        {/* BV-012 §5 — a service says so, and says WHICH.
                            
                            Shown INSTEAD of the HubSpot type, not beside it.
                            HubSpot's taxonomy describes what a thing physically
                            is; for a service that question has no useful answer
                            and printing both would invite reading one as
                            qualifying the other. The commercial identity is the
                            fact that governs here. */}
                        {row.commercialKind === "service" ? (
                          <span className="lb-service-type">
                            <span className="kind">Service</span>
                            <span className="ident">
                              {directServiceLabel(row.serviceIdentity)}
                            </span>
                          </span>
                        ) : row.hubspotProductType ? (
                          (hsTypeOptions.find(
                            (o) => o.value === row.hubspotProductType,
                          )?.label ?? row.hubspotProductType)
                        ) : (
                          "Unclassified"
                        )}
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
                            no SKU
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
                            className="lib-attach-btn lib-icon-btn"
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
                            aria-label={`Add product ${row.name}`}
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
                            <span aria-hidden="true">
                              {attaching === row.leafId ? "…" : "+"}
                            </span>
                          </button>
                        )}

                        {/* B-3 · Step 3 — SUBORDINATE, and inside the existing
                            action cell. Not a sixth column and not a second
                            peer button: the state action above stays primary,
                            and this is a quiet text control beneath it.

                            A real <button>, so it is keyboard-focusable with a
                            visible focus ring and an accessible name. Hover
                            carries no part of the discoverability — it is
                            always rendered. */}
                        <button
                          type="button"
                          className="lib-edit-specs lib-icon-btn"
                          onClick={() => {
                            setSpecLeafId(row.leafId);
                            setSpecOpen(true);
                          }}
                          aria-label={`Edit default specs for ${row.name}`}
                          title="Edit default specs"
                        >
                          <span aria-hidden="true">✎</span>
                        </button>
                      </span>
                    </div>
                  );
                })}
                {/* B-11 · the control bar.

                    The list showed at most 50 rows of a 1,082-product library
                    with NO count and NO indication that anything followed.
                    `total` was already in state and never rendered, and the
                    loader computed a "more available" probe and discarded it —
                    so a truncated view was indistinguishable from a complete
                    one. Silent truncation reads as "covered everything".

                    States what is on screen, out of what matches, out of the
                    library — three different denominators that were previously
                    all absent. Paging is prev/next rather than numbered pages:
                    the operator is looking for a product, and search plus the
                    type and scope filters are the tools for that. Numbered
                    pages would invite paging as a search strategy across
                    twenty-two of them. */}
                <div className="lib-pager">
                  <span className="lib-pager-count">
                    {(offset + 1).toLocaleString()}–
                    {(offset + rows.length).toLocaleString()} of{" "}
                    {total.toLocaleString()}
                  </span>
                  <div className="lib-pager-controls">
                    <button
                      type="button"
                      className="a1v2-btn ghost xs"
                      disabled={offset === 0 || pending}
                      onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    >
                      ← Previous
                    </button>
                    <button
                      type="button"
                      className="a1v2-btn ghost xs"
                      disabled={!hasMore || pending}
                      onClick={() => setOffset(offset + PAGE_SIZE)}
                    >
                      Next →
                    </button>
                  </div>
                </div>
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
      <LibrarySpecModal
        leafId={specLeafId}
        open={specOpen}
        onClose={() => setSpecOpen(false)}
      />
      {toast ? (
        <div className="a1v2-toast" role="status" aria-live="polite">
          <span className="glyph">✓</span>
          <div className="body">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}
