"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

/**
 * Enterprise SSO return leg. Clerk's supported callback component completes
 * the handshake begun by `authenticateWithRedirect` and then navigates on.
 *
 * This route MUST be public in `production-middleware.ts`. At the moment the
 * browser lands here the session does not exist yet — gating it would redirect
 * to /sign-in before Clerk can finish, producing a loop that looks like a
 * broken identity provider rather than a misconfigured route.
 *
 * No Nexus authorization happens here. The middleware's `@thedps.co` check and
 * `ensureUser`'s clerk_user_id resolution run on the destination request,
 * exactly as certified — this component only finishes the OAuth round trip.
 */
export default function SsoCallbackPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "oklch(0.985 0.006 85)",
        fontFamily: "var(--ui), system-ui, sans-serif",
        fontSize: 13.5,
        color: "oklch(0.52 0.015 255)",
      }}
    >
      <p>Completing sign-in…</p>
      <AuthenticateWithRedirectCallback
        signInForceRedirectUrl="/"
        signUpForceRedirectUrl="/"
      />
    </main>
  );
}
