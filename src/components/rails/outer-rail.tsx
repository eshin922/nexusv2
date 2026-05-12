import "server-only";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import { ensureUser } from "@/lib/auth/ensure-user";
import { isAdmin } from "@/lib/admin-guard";
import {
  getPinnedProjects,
  getRecentProjects,
} from "@/lib/workspace-queries";
import { ProjectGlyph } from "./project-glyph";
import { ThemeToggle } from "../theme-toggle";

// Slice RI.2 — Round 4 outer rail (56px wide, fixed left). Always
// visible to authenticated users. Composition (top to bottom):
//   - Nexus N mark (link home)
//   - All-deals nav icon (also links home)
//   - Search icon (⌘K placeholder; functional later)
//   - Pinned section header + glyphs (up to 8)
//   - Recent section header + glyphs (up to 4, MRU)
//   - (spacer)
//   - Settings link (admin-gated; if admin, includes audit log + markup
//     defaults stacked above)
//   - Avatar (current user initials)
//
// Renders server-side; queries Pinned + Recent from the workspace
// state tables shipped in RI.1.

export async function OuterRail() {
  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    null;
  const showAdmin = email ? isAdmin(email) : false;

  // ensureUser maps Clerk identity to a row in our users table.
  // Both queries below are keyed on our users.id, not Clerk user ID.
  const user = await ensureUser();
  const [pinned, recent] = await Promise.all([
    getPinnedProjects(user.id),
    getRecentProjects(user.id),
  ]);

  const initials = (() => {
    const first = clerkUser.firstName?.[0] ?? "";
    const last = clerkUser.lastName?.[0] ?? "";
    if (first || last) return (first + last).toUpperCase();
    return (email?.[0] ?? "?").toUpperCase();
  })();

  return (
    <aside
      className="fixed left-0 top-0 z-30 flex h-screen w-14 flex-col items-center gap-2 py-3"
      style={{
        background: "var(--paper-3)",
        borderRight: "1px solid var(--rule)",
      }}
    >
      {/* Nexus N mark — top */}
      <Link
        href="/"
        title="Nexus — All deals"
        className="mb-2 flex h-9 w-9 items-center justify-center rounded font-display text-2xl font-medium text-ink hover:text-accent"
      >
        N
      </Link>

      {/* All-deals nav (links home; visually distinct from N mark
          which is the brand) */}
      <Link
        href="/"
        title="All deals"
        className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-paper-3 hover:text-ink"
        aria-label="All deals"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1.5" y="2" width="11" height="2" />
          <rect x="1.5" y="6" width="11" height="2" />
          <rect x="1.5" y="10" width="11" height="2" />
        </svg>
      </Link>

      {/* ⌘K search placeholder — functional later */}
      <button
        type="button"
        title="Search · coming soon"
        disabled
        className="flex h-7 w-7 items-center justify-center rounded text-ink-4 disabled:cursor-not-allowed"
        aria-label="Search — coming soon"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="6" cy="6" r="3.5" />
          <line x1="9" y1="9" x2="12" y2="12" strokeLinecap="round" />
        </svg>
      </button>

      {/* Pinned section */}
      {pinned.length > 0 && (
        <>
          <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-4">
            PINNED
          </div>
          <div className="flex flex-col gap-1.5">
            {pinned.map((p) => (
              <ProjectGlyph
                key={p.id}
                glyph={p.glyph}
                projectName={p.clientName ?? p.dealName}
                href={`/projects/${p.id}`}
                size="md"
              />
            ))}
          </div>
        </>
      )}

      {/* Recent section */}
      {recent.length > 0 && (
        <>
          <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-4">
            RECENT
          </div>
          <div className="flex flex-col gap-1.5">
            {recent.map((p) => (
              <ProjectGlyph
                key={p.id}
                glyph={p.glyph}
                projectName={p.clientName ?? p.dealName}
                href={`/projects/${p.id}`}
                size="sm"
              />
            ))}
          </div>
        </>
      )}

      {/* Spacer pushes Settings + Avatar to the bottom */}
      <div className="flex-1" />

      {/* Slice RI.8 step 8 — theme toggle. All users, localStorage-
          backed, persists across navigation. Above Settings so it
          sits adjacent to the avatar cluster. */}
      <ThemeToggle />

      {/* Settings — admin only */}
      {showAdmin && (
        <Link
          href="/admin"
          title="Admin: firm settings, markup defaults, audit log"
          className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-paper-3 hover:text-ink"
          aria-label="Admin"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="2" />
            <path d="M7 1 V3 M7 11 V13 M1 7 H3 M11 7 H13 M2.5 2.5 L4 4 M10 10 L11.5 11.5 M2.5 11.5 L4 10 M10 4 L11.5 2.5" strokeLinecap="round" />
          </svg>
        </Link>
      )}

      {/* Avatar — current user initials */}
      <SignOutButton>
        <button
          type="button"
          title={email ?? "Sign out"}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-paper-3 font-mono text-[10px] font-medium uppercase text-ink-2 hover:bg-paper-4"
          aria-label={`Signed in as ${email ?? "user"}; click to sign out`}
        >
          {initials}
        </button>
      </SignOutButton>
    </aside>
  );
}
