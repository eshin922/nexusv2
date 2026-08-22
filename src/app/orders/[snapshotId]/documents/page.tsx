import { notFound } from "next/navigation";

import { ensureUser } from "@/lib/auth/ensure-user";
import { readOrderPacket, type PacketItem } from "@/lib/order-packet/reader";

/**
 * The Nexus Order Packet — the durable, order-specific record behind one Sales
 * Order. This slice delivers ITEM-LEVEL SPECIFICATIONS.
 *
 * ── WHY THE ROUTE IS KEYED TO THE SNAPSHOT ───────────────────────────────
 *
 * `/orders/<quote_snapshot_id>/documents`. The snapshot IS the sent offer, so
 * the link is order-specific rather than deal-specific, and stays stable across
 * later quote or spec revisions: a revision creates a NEW snapshot with its own
 * link, and this one keeps resolving to what this order actually was.
 *
 * Keyed to the quote or the deal, the opposite would be true — the link would
 * silently begin showing a later offer, which is the failure a historical
 * record exists to prevent.
 *
 * ── AUTH ─────────────────────────────────────────────────────────────────
 *
 * Not public. Inherits production middleware — corporate domain plus Nexus
 * enrollment — and calls `ensureUser`, so an authenticated but unenrolled
 * identity is refused here exactly as everywhere else. Read-only: no mutation
 * path exists on this route.
 */

/** Plain-language reading of a disposition. The state is the fact; this is the sentence. */
function dispositionNote(item: PacketItem): string {
  switch (item.disposition) {
    case "specified":
      return "Frozen specification as ordered.";
    case "governed_no_spec":
      return "No specification applies to this item — a governed answer, recorded at send.";
    case "not_spec_bearing":
      return "Not a specifiable item (service or one-time charge). No specification is expected.";
    case "unresolved":
      return "This send predates the specification freeze, so no ordered specification was recorded. The live spec is NOT shown here: it answers what the product is now, not what was ordered.";
  }
}

export default async function OrderPacketPage({
  params,
}: {
  params: Promise<{ snapshotId: string }>;
}) {
  await ensureUser();
  const { snapshotId } = await params;
  const packet = await readOrderPacket(snapshotId);
  if (!packet) notFound();

  const specBearing = packet.items.filter((i) => i.disposition !== "not_spec_bearing");
  const other = packet.items.filter((i) => i.disposition === "not_spec_bearing");

  return (
    <main style={{ padding: "32px 40px", maxWidth: 1040, margin: "0 auto" }}>
      <header style={{ marginBottom: 26 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.09em", textTransform: "uppercase", opacity: 0.55 }}>
          Nexus order packet
        </div>
        <h1 style={{ fontSize: 23, margin: "6px 0 4px" }}>
          {packet.quoteNumber ?? "Quote"} · version {packet.versionNumber}
        </h1>
        <div style={{ fontSize: 12.5, opacity: 0.7 }}>
          {packet.sentAt ? `Sent ${packet.sentAt.toISOString().slice(0, 10)}` : "Not sent"}
          {packet.acceptedTier
            ? ` · accepted ${packet.acceptedTier.tierLabel}${
                packet.acceptedTier.quantity !== null
                  ? ` · ${packet.acceptedTier.quantity.toLocaleString("en-US")} units`
                  : ""
              }`
            : ""}
        </div>
        <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>
          Specifications below are the values frozen when this offer was sent. Later
          revisions to the working specification do not change them.
        </div>
      </header>

      <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Ordered items &amp; specifications</h2>
      {specBearing.map((item) => (
        <article
          key={item.snapshotLineId}
          style={{ borderTop: "1px solid #dcdcdc", padding: "14px 0" }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
            {item.displaySku ? `${item.displaySku} — ` : ""}
            {item.displayName}
          </div>
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>
            {item.lineKind}
            {item.netsuiteItemId ? ` · NetSuite item ${item.netsuiteItemId}` : " · NetSuite item unresolved"}
            {item.selectedNetsuiteItemCode ? ` (${item.selectedNetsuiteItemCode})` : ""}
          </div>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{dispositionNote(item)}</div>

          {item.spec ? (
            <>
              <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 8, fontFamily: "var(--mono), monospace" }}>
                {item.spec.productTypeId ?? "no product type"}
                {item.spec.specSchema ? ` · schema ${item.spec.specSchema}` : ""}
                {` · rev ${item.spec.contentHash.slice(0, 16)}`}
              </div>
              {Object.keys(item.spec.values).length > 0 ? (
                <dl
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(140px, auto) 1fr",
                    gap: "3px 16px",
                    margin: "8px 0 0",
                    fontSize: 12.5,
                  }}
                >
                  {Object.entries(item.spec.values).map(([k, v]) => (
                    <div key={k} style={{ display: "contents" }}>
                      <dt style={{ opacity: 0.6 }}>{k}</dt>
                      <dd style={{ margin: 0 }}>
                        {v === null || v === "" ? "—" : String(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <div style={{ fontSize: 12.5, opacity: 0.6, marginTop: 8 }}>
                  No values were authored for this specification at send.
                </div>
              )}
            </>
          ) : null}
        </article>
      ))}

      {other.length > 0 ? (
        <section style={{ marginTop: 26 }}>
          <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Other lines on this order</h2>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>
            Listed so the packet accounts for every frozen line. These are not
            specifiable items.
          </div>
          {other.map((item) => (
            <div
              key={item.snapshotLineId}
              style={{ borderTop: "1px solid #ececec", padding: "9px 0", fontSize: 12.5 }}
            >
              {item.displayName}
              <span style={{ opacity: 0.6 }}>
                {` · ${item.lineKind}`}
                {item.netsuiteItemId ? ` · NetSuite item ${item.netsuiteItemId}` : ""}
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
