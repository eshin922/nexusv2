import { CORPORATE_DOMAIN } from "@/lib/auth/corporate-email";
import {
  clerkClient,
  clerkMiddleware,
  createRouteMatcher,
} from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// `/api/certification-status` is public by design. It reports whether THIS
// runtime has certification suppression active — the gate that must be proven
// before any Accept against a real production HubSpot deal. Auth-gating it
// would make the check unanswerable from the runtime itself (the failure mode
// it exists to rule out), and it exposes only a boolean, a fixed banner and a
// fixed reason: no secrets, no configuration values, no customer data.
// `/api/slack/interactivity` is public BY NECESSITY, not by convenience: Slack
// carries no Clerk session, so a session gate would make interactive approvals
// impossible rather than merely inconvenient. Its authentication is Slack
// request signing — raw-body HMAC-SHA256, a five-minute replay window and a
// constant-time comparison, all evaluated before the payload is parsed. See
// `src/lib/slack/signature.ts`. It decides nothing itself: it establishes a
// governed Nexus identity and delegates to the same authorization core the UI
// uses, which re-reads authority from the database.
// `/sso-callback` is public BY NECESSITY. It is the Enterprise SSO return
// leg: at the moment the browser lands there the Clerk session does not exist
// yet, so gating it would redirect to /sign-in before the handshake can
// complete — an infinite loop that presents as a broken identity provider
// rather than a misconfigured route. It grants nothing: it only finishes the
// OAuth round trip, and the authorization check below runs on the destination
// request that follows.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sso-callback(.*)",
  "/api/certification-status",
  "/api/slack/interactivity",
]);
// One definition, shared with the binding path. The two ask DIFFERENT questions
// of it — sign-in also honours ALLOWED_EMAILS below, binding never does — but
// they must agree on what the tenant domain IS.

function emailAllowed(email: string | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (normalized.endsWith(CORPORATE_DOMAIN)) return true;
  const extras = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return extras.includes(normalized);
}

export const productionMiddleware = clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { userId, sessionId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress;

  if (emailAllowed(email)) return;

  if (sessionId) {
    try {
      await clerk.sessions.revokeSession(sessionId);
    } catch {
      // Best-effort revoke; the authorization check still rejects the request.
    }
  }

  const url = new URL("/sign-in", req.url);
  url.searchParams.set("error", "unauthorized");
  if (email) url.searchParams.set("email", email);
  return NextResponse.redirect(url);
});
