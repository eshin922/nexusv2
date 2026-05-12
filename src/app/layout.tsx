import type { Metadata } from "next";
import { Newsreader, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AppShell } from "@/components/app-shell";
import { GlobalRealtimeProvider } from "@/components/global-realtime-provider";
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
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
          <GlobalRealtimeProvider />
          {/* Slice RI.2 — AppShell renders the outer rail (Round 4)
              for authenticated users; sign-in/sign-up pages pass
              through unwrapped. Project surfaces add the inner rail
              via /projects/[id]/layout.tsx. */}
          <AppShell>{children}</AppShell>
        </body>
      </html>
    </ClerkProvider>
  );
}
