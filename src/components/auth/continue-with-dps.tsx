"use client";

import { useSignIn } from "@clerk/nextjs";
import { useState } from "react";

/**
 * The single production sign-in action: Enterprise SSO through The DPS
 * Microsoft connection → Microsoft Entra (DPS tenant).
 *
 * ── WHY A ROUTING IDENTIFIER, AND WHY IT IS NOT A PERSON ──────────────────
 *
 * Clerk selects an enterprise connection by the EMAIL DOMAIN of `identifier`,
 * not by whether that address exists. Verified against production before this
 * was written: `sso@thedps.co` (no Entra mailbox, no Clerk user) resolves to
 * `oauth_custom_the_dps_microsoft` and produces a tenant-specific authorize
 * URL for `c578459a-…` with our client id — identical to a real person's
 * address. An off-domain identifier is refused with `form_identifier_not_found`.
 *
 * So the button needs no email input and hardcodes no employee. The routing
 * identifier picks the CONNECTION; Entra decides WHO. The signed-in identity
 * comes back from the Entra token — proven by completing this exact flow with
 * `sso@thedps.co` and receiving `edward@thedps.co` /
 * `user_3IEXNyfOoru6Fd5wGgle34XLngR`, with no Clerk or Nexus user provisioned
 * for the routing address.
 *
 * ── WHY `oidcPrompt: "select_account"` IS LOAD-BEARING ────────────────────
 *
 * Clerk forwards `login_hint=<identifier>` to Entra. Left alone, a user with
 * no active Microsoft session would land on a sign-in form prefilled with an
 * address that does not exist. `select_account` makes Entra show the account
 * picker regardless of the hint — confirmed present as `prompt=select_account`
 * in the generated authorize URL. Removing it reintroduces that failure for
 * exactly the users least able to diagnose it: first-time signers on a clean
 * browser.
 */
const SSO_ROUTING_IDENTIFIER = "sso@thedps.co";

export function ContinueWithDps() {
  const { signIn, isLoaded } = useSignIn();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!isLoaded || !signIn || pending) return;
    setPending(true);
    setError(null);
    try {
      await signIn.authenticateWithRedirect({
        strategy: "enterprise_sso",
        identifier: SSO_ROUTING_IDENTIFIER,
        oidcPrompt: "select_account",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/",
      });
      // On success the browser navigates away; nothing after this runs.
    } catch {
      setPending(false);
      setError(
        "Could not reach The DPS sign-in. Try again, or contact your Nexus administrator.",
      );
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={!isLoaded || pending}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 11,
          marginTop: 28,
          padding: "14px 16px",
          borderRadius: 8,
          border: "1px solid oklch(0.42 0.14 255)",
          background: "oklch(0.42 0.14 255)",
          color: "oklch(0.985 0.006 85)",
          fontSize: 14.5,
          fontWeight: 500,
          cursor: pending || !isLoaded ? "default" : "pointer",
          opacity: pending || !isLoaded ? 0.72 : 1,
          boxShadow: "0 8px 22px oklch(0.42 0.14 255 / 0.26)",
          transition: "all 140ms",
        }}
        className="nx-cta"
      >
        {pending ? "Opening The DPS sign-in…" : "Continue with The DPS"}
      </button>
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 14,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "oklch(0.45 0.16 25)",
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}
