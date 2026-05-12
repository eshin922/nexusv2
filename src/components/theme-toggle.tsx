"use client";

import { useEffect, useState } from "react";

// Slice RI.8 step 8 — dev theme toggle. The base layout hardcodes
// data-theme="light"; this client component reads localStorage on
// mount and applies the saved theme, then provides a button to flip.
// Persists across navigation; non-admins see the same button.
//
// Per brief amendment §4, dark mode is opt-in (not auto-detected from
// prefers-color-scheme) — Edward + DPS PMs primarily work in light;
// dark is for "I'm-on-a-laptop-late" preference rather than the
// default register. Token swap (light → dark) flows through
// design-tokens.css's [data-theme="dark"] rules and via CSS variable
// references throughout the codebase.
//
// PDF subtree (customer view) is structurally locked to light per
// the token-lock convention in CLAUDE.md "Customer-view boundary
// guard" — those components use literal OKLCH values and don't
// respond to data-theme. By design: customers view the PDF in
// whatever shape the rendering tool produces; admin's theme
// preference shouldn't bleed into a customer-facing artifact.

type Theme = "light" | "dark";
const STORAGE_KEY = "nexus-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
    applyTheme(initial);
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage might be unavailable; theme still applies for this session.
    }
  }

  // Avoid SSR/CSR icon mismatch: render an inert button until the
  // client effect has resolved the initial theme.
  if (!mounted) {
    return (
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded text-ink-4"
        aria-label="Theme toggle (loading)"
        disabled
      >
        <ThemeIcon theme="light" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={`Theme: ${theme} · click to switch`}
      className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-paper-3 hover:text-ink"
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      <ThemeIcon theme={theme} />
    </button>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  // Sun for light, crescent moon for dark. Inline SVG, currentColor —
  // tracks token color shifts.
  if (theme === "light") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="7" cy="7" r="2.5" />
        <path
          d="M7 1 V2.5 M7 11.5 V13 M1 7 H2.5 M11.5 7 H13 M2.6 2.6 L3.7 3.7 M10.3 10.3 L11.4 11.4 M2.6 11.4 L3.7 10.3 M10.3 3.7 L11.4 2.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        d="M11.5 8.5 A4.5 4.5 0 0 1 5.5 2.5 A5 5 0 1 0 11.5 8.5 Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}
