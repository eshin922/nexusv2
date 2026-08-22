import type { Metadata } from "next";
import { Newsreader, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { ApplicationAuthProvider } from "@/components/application-auth-provider";
import { RealtimeCompositionProvider } from "@/lib/integrations/realtime-composition";
import "./globals.css";

// Slice RI.0 — CD's three font families loaded via next/font for
// optimized self-hosted serving. Each font's CSS variable is consumed
// by design-tokens.css → globals.css @theme → Tailwind utilities
// (font-display / font-ui / font-mono). Variable names match the
// CD-canonical token names (--display / --ui / --mono).
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--display",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--ui",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DPS Quoting Tool",
  description: "Internal quoting tool for The DPS",
  /*
   * The Nexus mark as the app icon. The sign-in v2 handoff supplies these and
   * says to use them "if that separate branding slice has not already landed" —
   * it had not: `public/` held only `fonts/`, and the app was serving whatever
   * default the framework provides.
   *
   * SVG first so it scales and follows the browser's own dark-mode handling;
   * the PNGs are the fallback for the surfaces that will not take an SVG.
   */
  icons: {
    icon: [
      { url: "/icons/nexus-favicon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/icons/nexus-app-180.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ApplicationAuthProvider>
      {/* Slice RI.0 — data-theme="light" sets the app default; CD's
          tokens in design-tokens.css activate the light palette in
          :root. Slice RI.8 step 8 — pre-paint script reads
          localStorage("nexus-theme") and applies "dark" before
          React mounts, preventing flash-of-light-mode on page load
          for users who have saved a dark preference. ThemeToggle in
          the outer rail wires the runtime flip. */}
      <html
        lang="en"
        data-theme="light"
        className={`${newsreader.variable} ${instrumentSans.variable} ${jetbrainsMono.variable}`}
        // Slice RI.8 step 8 — pre-paint script intentionally diverges
        // server-rendered data-theme="light" from client-applied theme
        // (read from localStorage before React mounts, to prevent
        // flash-of-light-mode for users who saved "dark"). Standard
        // next-themes pattern: suppress hydration warning on the
        // <html> element so React doesn't flag the deliberate mismatch.
        // Only suppresses warnings for THIS element's attributes;
        // hydration mismatches anywhere else still throw.
        suppressHydrationWarning
      >
        <head>
          <script
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: `try{var t=localStorage.getItem("nexus-theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}`,
            }}
          />
        </head>
        <body>
          {/* Slice 8.5 — single per-session subscription to admin-managed
              reference tables (firm_settings, markup_defaults). Dispatches
              a window CustomEvent on changes; CostingStoreProvider folds
              it into the same reconcile pipe as per-quote events. */}
          <RealtimeCompositionProvider />
          {/* Slice RI.2 — AppShell renders the outer rail (Round 4)
              for authenticated users; sign-in/sign-up pages pass
              through unwrapped. Project surfaces add the inner rail
              via /projects/[id]/layout.tsx. */}
          <AppShell>{children}</AppShell>
        </body>
      </html>
    </ApplicationAuthProvider>
  );
}
