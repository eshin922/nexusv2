import type { Metadata } from "next";
import { Newsreader, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AppHeader } from "@/components/app-header";
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
          :root. Dark mode is opt-in via [data-theme="dark"] override
          (toggle UX surfaces in a later sub-slice). */}
      <html
        lang="en"
        data-theme="light"
        className={`${newsreader.variable} ${instrumentSans.variable} ${jetbrainsMono.variable}`}
      >
        <body>
          {/* Slice 8.5 — single per-session subscription to admin-managed
              reference tables (firm_settings, markup_defaults). Dispatches
              a window CustomEvent on changes; CostingStoreProvider folds
              it into the same reconcile pipe as per-quote events. */}
          <GlobalRealtimeProvider />
          {/* Slice 8.5 — persistent app header with admin entry point
              (visible to ADMIN_EMAILS-listed users only). */}
          <AppHeader />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
