import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { AppHeader } from "@/components/app-header";
import { GlobalRealtimeProvider } from "@/components/global-realtime-provider";
import "./globals.css";

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
      <html lang="en">
        <body className="antialiased">
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
