"use client";

import { useEffect, useState } from "react";

/**
 * Expand / collapse the secondary contextual panel.
 *
 * ── HOW THE WIDTH ACTUALLY CHANGES ───────────────────────────────────────
 *
 * Not by prop-drilling. The rail is a fixed-position server component and the
 * two surfaces that offset for it live in different trees with no common
 * ancestor below `<html>` — so a shared React state would have to be lifted to
 * the root layout and threaded through both.
 *
 * Instead one attribute on `<html>` drives two CSS custom properties, and the
 * rail and both offsets read them. Adding a third surface later costs one
 * class, not another prop.
 *
 *     :root                              --inner-rail-w / --inner-rail-offset
 *     :root[data-inner-rail="collapsed"] the collapsed pair
 *
 * ── WHY THE INLINE SCRIPT IN layout.tsx MATTERS ──────────────────────────
 *
 * React mounts after first paint, so state read here would land one frame late
 * and every navigation would flash the panel open before collapsing it. The
 * root layout applies the stored value before hydration, exactly as the theme
 * toggle already does. This component only handles the toggle itself.
 */

const STORAGE_KEY = "nexus-inner-rail";
const NARROW = "(max-width: 1024px)";

export function InnerRailCollapse() {
  const [collapsed, setCollapsed] = useState(false);

  // Mirror whatever the pre-hydration script decided, so the button's label and
  // aria-expanded describe the real state rather than a default this component
  // invented.
  useEffect(() => {
    setCollapsed(
      document.documentElement.getAttribute("data-inner-rail") === "collapsed",
    );
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.setAttribute(
      "data-inner-rail",
      next ? "collapsed" : "expanded",
    );
    try {
      // An explicit choice, so it outranks the narrow-screen default from here
      // on — including when the same user later opens a wide window.
      window.localStorage.setItem(STORAGE_KEY, next ? "collapsed" : "expanded");
    } catch {
      // Private windows and blocked site data. The toggle still works for this
      // page; it just will not be remembered.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // NOT a link, and it must never become one: collapsing is a view change,
      // and navigating would lose the surface the operator is on.
      aria-expanded={!collapsed}
      aria-controls="inner-rail"
      aria-label={collapsed ? "Expand project panel" : "Collapse project panel"}
      title={collapsed ? "Expand project panel" : "Collapse project panel"}
      className="inner-rail-toggle"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {collapsed ? <path d="M4.5 2.5 L8 6 L4.5 9.5" /> : <path d="M7.5 2.5 L4 6 L7.5 9.5" />}
      </svg>
    </button>
  );
}

export { STORAGE_KEY as INNER_RAIL_STORAGE_KEY, NARROW as INNER_RAIL_NARROW_QUERY };
