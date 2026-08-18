import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdminPage } from "@/lib/admin-guard";
import { ADMIN_SECTIONS } from "./sections";

// Hard role gate at the layout boundary: non-admins redirect to home
// before any admin page renders. Each admin server action MUST also call
// requireAdmin internally — defense in depth, since action endpoints are
// reachable without going through this layout.
//
// Slice RI.8 step 8 — chrome rebuilt against design tokens. Prior
// version used stock Tailwind palettes (slate-*/amber-*) which don't
// emit CSS under the RI.0 @theme rebuild. R5 admin page bodies were
// already token-driven and swap correctly; this brings the layout
// shell into the same vocabulary so dark-mode swap is consistent
// edge-to-edge.


export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const admin = await requireAdminPage();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--paper-2)",
      }}
    >
      {/* Admin chrome bar — visually distinct from PM workflow so a
          PM landing here by accident sees "this is not the quoting
          tool." Ink-on-paper inversion: dark bar + paper text in
          light mode; light bar + ink text in dark mode (which still
          reads as "admin chrome" because it inverts contrast against
          the body). */}
      <header
        style={{
          background: "var(--admin-chrome-bg)",
          color: "var(--admin-chrome-text)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 24px",
            maxWidth: 1480,
            margin: "0 auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: 4,
                background: "var(--warn)",
                color: "var(--ink)",
              }}
            >
              Admin
            </span>
            <Link
              href="/admin"
              style={{
                fontFamily: "var(--display)",
                fontSize: 14,
                fontWeight: 500,
                color: "var(--admin-chrome-text)",
                textDecoration: "none",
              }}
            >
              Nexus admin
            </Link>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--admin-chrome-muted)",
            }}
          >
            <span>{admin.email}</span>
            <Link
              href="/"
              style={{
                color: "var(--admin-chrome-text)",
                textDecoration: "underline",
                textDecorationColor: "var(--admin-chrome-muted)",
              }}
            >
              ← Back to quoting tool
            </Link>
          </div>
        </div>
      </header>

      <div
        style={{
          display: "flex",
          gap: 24,
          padding: "24px",
          maxWidth: 1480,
          margin: "0 auto",
        }}
      >
        <nav style={{ width: 224, flexShrink: 0 }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {ADMIN_SECTIONS.map((item) => (
              <li key={item.href} style={{ marginBottom: 4 }}>
                <Link
                  href={item.href}
                  className="r5-admin-nav-item"
                  style={{
                    display: "block",
                    padding: "10px 14px",
                    borderRadius: 6,
                    border: "1px solid transparent",
                    textDecoration: "none",
                    transition: "background 80ms, border-color 80ms",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--display)",
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--ink)",
                      marginBottom: 2,
                    }}
                  >
                    {item.label}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--ink-3)",
                      lineHeight: 1.4,
                    }}
                  >
                    {item.nav}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main style={{ minWidth: 0, flex: 1 }}>{children}</main>
      </div>
    </div>
  );
}
