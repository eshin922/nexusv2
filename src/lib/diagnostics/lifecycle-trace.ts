/**
 * Lifecycle trace — a temporary diagnostic for the "the page keeps jumping back
 * to the top" and "Nexus intermittently seems to refresh itself" reports.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────
 *
 * Both reports describe the same felt experience and may or may not be the same
 * defect. Four different events look identical to someone using the app, and
 * telling them apart is the entire job:
 *
 *   1. a true browser document reload
 *   2. a Next.js navigation / router refresh
 *   3. a React remount of the shell or the page
 *   4. a re-render with no navigation and no remount
 *
 * A re-render that preserves the DOM does not move the scroll position, so
 * "React re-rendered" is not an explanation for a viewport jump. Something more
 * specific is happening, and this records enough to name it.
 *
 * ── THE DOCUMENT INSTANCE ID IS THE DISCRIMINATOR ───────────────────────
 *
 * `DOCUMENT_ID` is generated once per loaded document and lives in a module
 * constant — NOT in storage. So:
 *
 *   same id + a mount event    → application lifecycle (case 2, 3 or 4)
 *   a NEW id                   → the document was actually replaced (case 1)
 *
 * That single fact separates "the browser reloaded" from "React remounted",
 * which no amount of watching the screen can do.
 *
 * ── WHY THE BUFFER IS IN sessionStorage ─────────────────────────────────
 *
 * A real reload destroys everything in memory, including the evidence that a
 * reload happened. The buffer therefore survives in `sessionStorage`, capped,
 * and each entry carries the id of the document that wrote it. After a reload
 * the buffer still holds the previous document's final moments beside the new
 * document's first — which is exactly the seam we need to read.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────
 *
 * Diagnostic only. It observes; it changes no behaviour, writes nothing to the
 * server, and repairs nothing. It is deliberately safe in production because
 * the intermittent report comes from normal use and from training sessions,
 * not from a reproduction someone can stage on request.
 *
 * `window.fetch` is wrapped to correlate events with network activity. That is
 * not framework internals — it is the platform API — and it is how we find out
 * whether an apparent refresh follows an autosave or an action completing. The
 * wrapper is pass-through: it records and rethrows, and one installed at most.
 *
 * REMOVE THIS once the defect is classified and repaired.
 */

export type TraceEvent = {
  /** ms since epoch. */
  t: number;
  /** Which loaded document wrote this. A change here means a real reload. */
  doc: string;
  kind: string;
  path: string;
  search: string;
  scrollY: number;
  /** Tag + id/name of the focused element, or null. Focus moves can scroll. */
  focus: string | null;
  detail?: Record<string, unknown>;
};

const KEY = "nexus:lifecycle-trace";
const CAP = 300;

/**
 * New for every loaded document. Short and readable — this gets eyeballed in a
 * console dump, not parsed by anything.
 */
export const DOCUMENT_ID =
  typeof window === "undefined"
    ? "server"
    : Math.random().toString(36).slice(2, 8);

function describeFocus(): string | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  const name = el.getAttribute("name");
  const id = el.id;
  return [
    el.tagName.toLowerCase(),
    id ? `#${id}` : "",
    name ? `[name=${name}]` : "",
  ].join("");
}

function read(): TraceEvent[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TraceEvent[]) : [];
  } catch {
    // Private mode, blocked storage, corrupt JSON. A diagnostic that throws
    // into the app it is diagnosing is worse than no diagnostic.
    return [];
  }
}

function write(events: TraceEvent[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(events.slice(-CAP)));
  } catch {
    /* ignore */
  }
}

/** Record one event. Safe to call from anywhere on the client. */
export function trace(kind: string, detail?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const event: TraceEvent = {
    t: Date.now(),
    doc: DOCUMENT_ID,
    kind,
    path: window.location.pathname,
    search: window.location.search,
    scrollY: Math.round(window.scrollY),
    focus: describeFocus(),
    ...(detail ? { detail } : {}),
  };
  const events = read();
  events.push(event);
  write(events);
}

/**
 * Classify a network call by shape, so the dump reads as intent rather than as
 * a wall of URLs. Server actions and RSC fetches are the two we care about:
 * the question is whether an apparent refresh FOLLOWS one.
 */
function classify(url: string, init?: RequestInit): string {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers ?? {});
  if (headers.has("next-action")) return "server-action";
  if (url.includes("_rsc=")) return "rsc";
  if (/clerk|session|__session/i.test(url)) return "auth";
  if (/supabase|realtime/i.test(url)) return "supabase";
  return method === "GET" ? "fetch-get" : `fetch-${method.toLowerCase()}`;
}

let installed = false;

/**
 * Install the listeners. Idempotent — React StrictMode double-invokes effects
 * in development, and a second set of listeners would double every entry.
 */
export function installLifecycleTrace() {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  // How this document came to exist. `reload` and `back_forward` here are the
  // strongest possible evidence for case 1, recorded before anything else can
  // overwrite it.
  let navType = "unknown";
  try {
    const nav = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming | undefined;
    navType = nav?.type ?? "unknown";
  } catch {
    /* ignore */
  }
  trace("document:load", { navType, referrer: document.referrer || null });

  addEventListener("pageshow", (e) =>
    trace("pageshow", { persisted: (e as PageTransitionEvent).persisted }),
  );
  addEventListener("pagehide", (e) =>
    trace("pagehide", { persisted: (e as PageTransitionEvent).persisted }),
  );
  // If this fires, the document is genuinely going away — case 1, and the last
  // thing the old document will ever record.
  addEventListener("beforeunload", () => trace("beforeunload"));
  addEventListener("visibilitychange", () =>
    trace("visibilitychange", { state: document.visibilityState }),
  );
  addEventListener("popstate", () => trace("popstate"));

  // History mutations, which are how this app opens a Costs section. Recorded
  // rather than assumed: `replaceState` is explicitly used there to AVOID a
  // Next navigation, and whether that holds is part of what we are testing.
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = function (
      this: History,
      ...args: Parameters<History["pushState"]>
    ) {
      trace(`history:${method}`, { url: String(args[2] ?? "") });
      return original(...args);
    };
  }

  // Scroll, sampled. Every scroll event would drown the buffer, so this records
  // the position when scrolling STOPS — which is the position a jump moves away
  // from, and therefore the one worth having.
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  addEventListener(
    "scroll",
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => trace("scroll:settled"), 150);
    },
    { passive: true },
  );

  const originalFetch = window.fetch;
  window.fetch = async function (
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const kind = classify(url, init);
    const started = Date.now();
    try {
      const response = await originalFetch.call(this, input as RequestInfo, init);
      trace("net", {
        kind,
        status: response.status,
        ms: Date.now() - started,
        url: url.slice(0, 120),
      });
      return response;
    } catch (error) {
      // A failed request followed by a navigation is one of the signatures we
      // are explicitly looking for, so failures are recorded, not swallowed.
      trace("net:error", {
        kind,
        ms: Date.now() - started,
        url: url.slice(0, 120),
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  // The operator-facing handle. Edward runs this in the console after a jump.
  const api = {
    /** Every event, oldest first. */
    all: () => read(),
    /** The last N events as a readable table. */
    dump: (n = 40) => {
      const rows = read().slice(-n);
      const t0 = rows[0]?.t ?? Date.now();
      // eslint-disable-next-line no-console
      console.table(
        rows.map((e) => ({
          "+ms": e.t - t0,
          doc: e.doc,
          kind: e.kind,
          scrollY: e.scrollY,
          path: e.path + e.search,
          focus: e.focus ?? "",
          detail: e.detail ? JSON.stringify(e.detail) : "",
        })),
      );
      return rows.length;
    },
    /** Copy the buffer as JSON, for pasting into a report. */
    copy: async () => {
      const text = JSON.stringify(read(), null, 1);
      try {
        await navigator.clipboard.writeText(text);
        return `copied ${text.length} chars`;
      } catch {
        return text;
      }
    },
    /** How many distinct documents are represented — >1 means a real reload. */
    documents: () => [...new Set(read().map((e) => e.doc))],
    clear: () => {
      write([]);
      return "cleared";
    },
    doc: DOCUMENT_ID,
  };
  (window as unknown as Record<string, unknown>).__nexusTrace = api;

  // eslint-disable-next-line no-console
  console.info(
    `[nexus-trace] document ${DOCUMENT_ID} · __nexusTrace.dump() after a jump`,
  );
}
