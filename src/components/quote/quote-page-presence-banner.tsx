"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { heartbeatQuotePagePresence, leaveQuotePagePresence } from "@/app/actions/quote-page-presence";
import { QUOTE_PRESENCE_IDLE_MS, QUOTE_PRESENCE_POLL_MS, quotePageKey } from "@/lib/quote-page-presence";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export function QuotePagePresenceBanner({ projectId, quoteId, realtimeEnabled }: {
  projectId: string; quoteId: string; realtimeEnabled: boolean;
}) {
  const pathname = usePathname();
  const pageKey = quotePageKey(pathname, projectId, quoteId);
  const [viewers, setViewers] = useState<string[]>([]);

  useEffect(() => {
    if (!pageKey) return;
    const sessionId = crypto.randomUUID();
    let active = true;
    let inFlight = false;
    let registered = false;
    let lastActivity = Date.now();
    // Broadcast carries no names or page data. It only asks other authenticated
    // clients to fetch fresh presence; the server action owns the disclosure.
    const client = realtimeEnabled ? getSupabaseBrowser() : null;
    const channel = client?.channel(`quote-presence-hint:${quoteId}:${pageKey}`)
      .on("broadcast", { event: "changed" }, () => { void update(); })
      .subscribe();
    function announce() {
      if (channel) void channel.send({ type: "broadcast", event: "changed", payload: {} }).catch(() => {});
    }
    async function update() {
      if (!active || inFlight || document.hidden) return;
      if (Date.now() - lastActivity > QUOTE_PRESENCE_IDLE_MS) {
        if (registered) {
          registered = false;
          setViewers([]);
          void leaveQuotePagePresence({ projectId, quoteId, sessionId }).then(announce).catch(() => {});
        }
        return;
      }
      inFlight = true;
      try {
        const names = await heartbeatQuotePagePresence({ projectId, quoteId, pageKey: pageKey!, sessionId });
        if (active && !document.hidden) {
          const newlyPresent = !registered;
          registered = true;
          setViewers(names);
          if (newlyPresent) announce();
        }
      } catch {
        // Presence is advisory: a temporary network or migration failure must
        // never block the quote. Expired leases clear on the next good poll.
        if (active) setViewers([]);
      } finally {
        inFlight = false;
        // A tab can close while its heartbeat is still being written. Repeat
        // the release after that write so the lease does not linger to TTL.
        if (!active || document.hidden) {
          void leaveQuotePagePresence({ projectId, quoteId, sessionId }).then(announce).catch(() => {});
        }
      }
    }
    function onVisibility() {
      if (document.hidden) {
        setViewers([]);
        const wasPresent = registered;
        registered = false;
        void leaveQuotePagePresence({ projectId, quoteId, sessionId })
          .then(() => { if (wasPresent) announce(); }).catch(() => {});
      } else {
        lastActivity = Date.now();
        void update();
      }
    }
    function onActivity() {
      const wasIdle = Date.now() - lastActivity > QUOTE_PRESENCE_IDLE_MS;
      lastActivity = Date.now();
      if (wasIdle) void update();
    }
    void update();
    const timer = window.setInterval(() => { void update(); }, QUOTE_PRESENCE_POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("pointerdown", onActivity);
    document.addEventListener("keydown", onActivity);
    document.addEventListener("scroll", onActivity, true);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerdown", onActivity);
      document.removeEventListener("keydown", onActivity);
      document.removeEventListener("scroll", onActivity, true);
      if (registered) announce();
      void leaveQuotePagePresence({ projectId, quoteId, sessionId }).catch(() => {});
      if (client && channel) void client.removeChannel(channel);
    };
  }, [projectId, quoteId, pageKey, realtimeEnabled]);

  if (!pageKey || viewers.length === 0) return null;
  const message = viewers.length === 1
    ? `${viewers[0]} is working on this page`
    : viewers.length === 2
      ? `${viewers[0]} and ${viewers[1]} are working on this page`
      : `${viewers[0]} and ${viewers.length - 1} others are working on this page`;
  return (
    <div role="status" aria-live="polite" style={{
      position: "sticky", top: 0, zIndex: 60, padding: "7px 18px",
      background: "var(--paper-2, #f8f5ef)", color: "var(--ink-2, #334155)",
      borderBottom: "1px solid var(--line, #d6d3d1)", fontSize: 12,
    }}>
      <span aria-hidden="true" style={{ color: "#15803d", marginRight: 8 }}>●</span>{message}
    </div>
  );
}
