"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LibraryBrowseRow } from "@/lib/library-browse-loader";
import { fetchLibraryBrowse } from "@/app/actions/leaves";
import { attachAssemblyLeaf } from "@/app/actions/assemblies";

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
  assemblies,
  leafTypes,
}: {
  open: boolean;
  onClose: () => void;
  quoteId: string;
  assemblies: AssemblyTarget[];
  leafTypes: { id: string; name: string; placeholder: boolean }[];
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

  // Reset state on close.
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
  }, [open]);

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

  if (!open) return null;

  return (
    <div
      className="a1v2-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending && !attaching) onClose();
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
              libraryTotal === 0 ? (
                <p
                  style={{
                    padding: "24px 16px",
                    color: "var(--ink-3)",
                    fontStyle: "italic",
                    textAlign: "center",
                  }}
                >
                  Library is empty. Start by creating your first product
                  or pulling the HubSpot catalog.
                </p>
              ) : (
                <p
                  style={{
                    padding: "24px 16px",
                    color: "var(--ink-3)",
                    fontStyle: "italic",
                    textAlign: "center",
                  }}
                >
                  No components match &ldquo;{search}.&rdquo; Library
                  has {libraryTotal} components total. Try a different
                  search, or:
                </p>
              )
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
    </div>
  );
}
