import "server-only";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import { OuterRail } from "./rails/outer-rail";

// Slice RI.2 — Round 4 app shell. Always renders the outer rail for
// authenticated users; main content area is offset to the right
// (left padding = outer rail width = 56px). Inner rail is rendered
// per-project via /projects/[id]/layout.tsx (separate concern; its
// content shifts left padding further).
//
// Auth pages (/sign-in, /sign-up) are handled by Clerk's own layout
// and never wrap in AppShell — those pages render at the root.

export async function AppShell({ children }: { children: React.ReactNode }) {
  const { authentication } = await getApplicationDependencies();
  const userId = (await authentication.identity.current())?.externalUserId;
  // Unauthenticated → render children only (sign-in / sign-up pages).
  if (!userId) return <>{children}</>;

  return (
    <div className="min-h-screen">
      <OuterRail />
      {/* Main content area — offset by outer rail width.
          Project surfaces add another 240px offset via project layout. */}
      <div className="pl-14">{children}</div>
    </div>
  );
}
