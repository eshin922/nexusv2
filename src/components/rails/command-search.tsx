"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { searchProjects, type ProjectSearchHit } from "@/app/actions/project-search";

/**
 * Deal search — the rail's ⌘K control.
 *
 * ── WHAT IT REPLACES ─────────────────────────────────────────────────────
 *
 * A `disabled` button titled "Search · coming soon". Honestly labelled, but a
 * disabled control gives no click feedback at all, so pressing it was
 * indistinguishable from pressing something broken. A permanently dead control
 * in a rail teaches operators that rail controls may not work.
 *
 * ── SCOPE, STATED ────────────────────────────────────────────────────────
 *
 * It searches DEALS by name and customer, and nothing else. Not quotes, not
 * SKUs, not settings. That is a real limit and the placeholder says so, because
 * a search box that silently covers less than the operator assumes is worse
 * than one that names its own scope.
 *
 * Distinct from the Organizer's own filter box, which narrows the table you are
 * looking at. This navigates, from anywhere.
 */
export function CommandSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProjectSearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against an earlier, slower response overwriting a later one.
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery("");
      setHits([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    const q = query;
    if (q.trim().length < 2) {
      setHits([]);
      setPending(false);
      return;
    }
    setPending(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await searchProjects(q);
        if (mine !== seq.current) return; // a newer query has been issued
        setHits(r);
        setActive(0);
      } finally {
        if (mine === seq.current) setPending(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const go = useCallback(
    (hit: ProjectSearchHit) => {
      setOpen(false);
      router.push(
        hit.latestQuoteId
          ? `/projects/${hit.projectId}/quotes/${hit.latestQuoteId}/pricing`
          : `/projects/${hit.projectId}`,
      );
    },
    [router],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Search deals · ⌘K"
        aria-label="Search deals"
        className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-paper-3 hover:text-ink"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="6" cy="6" r="3.5" />
          <line x1="9" y1="9" x2="12" y2="12" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search deals"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "oklch(0 0 0 / 0.28)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "14vh",
          }}
        >
          <div
            style={{
              width: "min(560px, calc(100vw - 32px))",
              background: "var(--paper)",
              border: "1px solid var(--rule)",
              borderRadius: 10,
              boxShadow: "0 18px 48px oklch(0 0 0 / 0.22)",
              overflow: "hidden",
            }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, hits.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && hits[active]) {
                  e.preventDefault();
                  go(hits[active]);
                }
              }}
              placeholder="Search deals by name or customer"
              aria-label="Search deals by name or customer"
              style={{
                width: "100%",
                border: 0,
                borderBottom: hits.length ? "1px solid var(--rule)" : "0",
                background: "transparent",
                padding: "14px 16px",
                fontSize: 14,
                color: "var(--ink)",
                outline: "none",
              }}
            />

            {hits.map((h, i) => (
              <button
                key={h.projectId}
                type="button"
                onPointerEnter={() => setActive(i)}
                onClick={() => go(h)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 16px",
                  border: 0,
                  cursor: "pointer",
                  background: i === active ? "var(--paper-2)" : "transparent",
                  color: "inherit",
                }}
              >
                <span style={{ display: "block", fontSize: 13.5 }}>{h.dealName}</span>
                {h.clientName && (
                  <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginTop: 1 }}>
                    {h.clientName}
                  </span>
                )}
              </button>
            ))}

            {/*
              Three distinguishable states. "No deals match" is a RESULT and must
              not be shown while a request is still in flight, or search reports
              an absence it has not established yet.
            */}
            {query.trim().length >= 2 && !pending && hits.length === 0 && (
              <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--ink-3)" }}>
                No deals match that.
              </div>
            )}
            {query.trim().length < 2 && (
              <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--ink-3)" }}>
                Searches deal names and customers. Test records are excluded.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
