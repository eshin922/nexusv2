import "server-only";
import Link from "next/link";
import { ensureUser } from "@/lib/auth/ensure-user";
import { isAdmin } from "@/lib/admin-guard";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import {
  getPinnedProjects,
  getRecentProjects,
} from "@/lib/workspace-queries";
import { ProjectGlyph } from "./project-glyph";
import { ThemeToggle } from "../theme-toggle";
import { NexusMark } from "@/components/brand/nexus-mark";
import { CommandSearch } from "./command-search";
import { UserMenu } from "./user-menu";

// Slice RI.2 — Round 4 outer rail (56px wide, fixed left). Always
// visible to authenticated users. Composition (top to bottom):
//   - Nexus N mark (link home)
//   - All-deals nav icon (also links home)
//   - Deal search (⌘K command palette)
//   - Pinned section header + glyphs (up to 8)
//   - Recent section header + glyphs (up to 4, MRU)
//   - (spacer)
//   - Settings link (admin-gated; if admin, includes audit log + markup
//     defaults stacked above)
//   - Account menu (initials → menu with Sign out)
//
// Renders server-side; queries Pinned + Recent from the workspace
// state tables shipped in RI.1.

export async function OuterRail() {
  const { authentication } = await getApplicationDependencies();
  const identity = await authentication.identity.current();
  if (!identity) return null;

  const email = identity.email;
  const showAdmin = email ? isAdmin(email) : false;

  // ensureUser maps Clerk identity to a row in our users table.
  // Both queries below are keyed on our users.id, not Clerk user ID.
  const user = await ensureUser();
  const [pinned, recent] = await Promise.all([
    getPinnedProjects(user.id),
    getRecentProjects(user.id),
  ]);

  const initials = (() => {
    const first = identity.firstName?.[0] ?? "";
    const last = identity.lastName?.[0] ?? "";
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
        className="mb-2 flex h-9 w-9 items-center justify-center rounded text-ink hover:text-accent"
      >
        {/* The real mark, not a letter. `currentColor` means it takes the
            link's colour, including the hover state. */}
        <NexusMark size={22} />
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

      {/* Deal search · ⌘K. Was a disabled "coming soon" stub. */}
      <CommandSearch />

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

      {/* Settings — admin only. Slice RI.8 step 11 followup: icon
          swap from sparkle/asterisk-ray glyph (8 rays from a center
          circle, read as "magic/decoration") to a proper gear. Gear
          is the universal admin-settings convention (matches
          lucide-react Settings icon; codebase uses inline SVG
          throughout, no lucide-react dep). */}
      {showAdmin && (
        <Link
          href="/admin"
          title="Admin: firm settings, markup defaults, audit log"
          className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-paper-3 hover:text-ink"
          aria-label="Admin"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </Link>
      )}

      {/* Account menu.
          The avatar OPENS a menu; the provider's sign-out control wraps the
          menu's item rather than the avatar itself, so clicking your own
          initials no longer signs you out on the first press. Clerk's redirect
          behaviour is untouched — this still goes through
          `renderSignOutControl`. */}
      <UserMenu
        initials={initials}
        email={email}
        signOutItem={authentication.ui.renderSignOutControl({
          email,
          children: (
            <button
              type="button"
              className="w-full rounded px-2.5 py-2 text-left text-[12.5px] text-ink hover:bg-paper-2"
            >
              Sign out
            </button>
          ),
        })}
      />
    </aside>
  );
}
