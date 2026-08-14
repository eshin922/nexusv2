/**
 * The thing the operator is carrying.
 *
 * Uses the native `setDragImage`, not a hand-tracked overlay. HTML5 drag
 * throttles and rounds `dragover` coordinates, so a manually positioned element
 * lags the pointer visibly; the native drag image is composited by the browser
 * and tracks exactly. It also disappears on its own at drop, which is the whole
 * requirement for a transient cue.
 *
 * Deliberately not a copy of the row: the row answers "what is this product",
 * which the operator can already read on the surface. The proxy answers only
 * "what am I currently carrying", so it carries identity and nothing else.
 */

const PROXY_CLASS = "a1v2-drag-proxy";

export function attachDragProxy(
  e: React.DragEvent,
  name: string,
  sku: string | null,
): void {
  if (typeof document === "undefined") return;

  const node = document.createElement("div");
  node.className = PROXY_CLASS;
  if (sku) {
    const s = document.createElement("span");
    s.className = "sku";
    s.textContent = sku;
    node.appendChild(s);
  }
  const n = document.createElement("span");
  n.className = "name";
  n.textContent = name;
  node.appendChild(n);

  // Must be IN the document and painted for the browser to snapshot it. It is
  // parked offscreen by the stylesheet rather than hidden — `display:none` and
  // `visibility:hidden` both snapshot as empty.
  document.body.appendChild(node);
  try {
    e.dataTransfer.setDragImage(node, 14, 16);
  } catch {
    // Older Safari refuses a detached-ish node; the drag still works without a
    // custom image, so this must never break the move.
  }
  // The snapshot is taken synchronously during dragstart, so the node can go on
  // the next tick.
  window.setTimeout(() => node.remove(), 0);
}
