import { redirect } from "next/navigation";
import { ContinueWithDps } from "@/components/auth/continue-with-dps";
import { HeroLoop } from "@/components/auth/hero-loop";
import { NexusMark } from "@/components/auth/nexus-mark";
import { getApplicationDependencies } from "@/lib/integrations/composition";

/**
 * Production sign-in splash. Pattern 30 adoption of CD's handoff
 * (`Nexus Sign In.dc.html` + `IMPLEMENTATION.md`): copy, oklch tokens, layout
 * proportions and the nx-rise stagger are taken verbatim from the source.
 *
 * One deliberate deviation from the handoff, per the existing system: the
 * design links Google Fonts directly, but Newsreader / Instrument Sans /
 * JetBrains Mono are ALREADY self-hosted through `next/font` in `layout.tsx`
 * and exposed as `--display` / `--ui` / `--mono`. Re-declaring them would add
 * a third-party request and a second source of truth for the same faces, so
 * this consumes the existing variables.
 *
 * The isolated validation harness keeps its own sign-in surface. Branching on
 * `identity.kind` rather than replacing `renderSignIn()` outright means the
 * harness path is untouched by this change.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const sp = await searchParams;
  const unauthorized = sp.error === "unauthorized";
  const { authentication } = await getApplicationDependencies();

  // An already-authenticated visitor has nothing to do here. Beyond being the
  // conventional behaviour, it is load-bearing for this page specifically:
  // AppShell decides to render the outer rail from AUTH STATE, not route, so a
  // signed-in user landing on /sign-in would get the full-bleed splash wrapped
  // in application chrome and horizontally offset. Redirecting is narrower than
  // making the shared shell route-aware, and it is what the user wants anyway.
  //
  // No loop with the unauthorized path: production-middleware revokes the
  // session BEFORE redirecting here, so `current()` is null on arrival.
  if (!unauthorized && (await authentication.identity.current())) {
    redirect("/");
  }

  if (authentication.identity.kind === "isolated") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        {authentication.ui.renderSignIn()}
      </main>
    );
  }

  return (
    <>
      <style>{`
        @keyframes nx-rise { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: translateY(0) } }
        .nx-cta:hover:not(:disabled) { background: oklch(0.28 0.12 255) !important; border-color: oklch(0.28 0.12 255) !important; }
        .nx-link { color: oklch(0.42 0.14 255); text-decoration: none; }
        .nx-link:hover { color: oklch(0.28 0.12 255); text-decoration: underline; }
        @media (prefers-reduced-motion: reduce) { .nx-anim { animation: none !important; } }
        @media (max-width: 860px) { .nx-split { grid-template-columns: 1fr !important; } .nx-editorial { order: 2; min-height: 40vh; } .nx-auth { order: 1; } }
      `}</style>

      <div
        className="nx-split"
        style={{
          minHeight: "100vh",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.3fr) minmax(360px, 1fr)",
        }}
      >
        {/* ── editorial panel ─────────────────────────────────────────── */}
        <div
          className="nx-editorial"
          style={{
            position: "relative",
            overflow: "hidden",
            // The ground stays dark beneath the loop: it is what shows while
            // the first frame decodes, and what shows if autoplay is declined.
            background: "oklch(0.16 0.012 255)",
            padding: "clamp(28px, 4vw, 54px) clamp(28px, 4.5vw, 62px)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <HeroLoop />

          {/*
            DIRECTIONAL, and deliberately not a uniform overlay: near-opaque
            behind the copy, 10% at the right edge so the render reads at full
            strength where there is no text. Flattening it would either wash out
            the video or put the headline on an unpredictable ground.
          */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(100deg, oklch(0.16 0.012 255 / 0.94) 0%, oklch(0.16 0.012 255 / 0.80) 34%, oklch(0.16 0.012 255 / 0.30) 62%, oklch(0.16 0.012 255 / 0.10) 100%)",
              pointerEvents: "none",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              // 0.045 -> 0.035: the video supplies its own light now.
              backgroundImage:
                "linear-gradient(oklch(0.985 0.006 85 / 0.035) 1px, transparent 1px), linear-gradient(90deg, oklch(0.985 0.006 85 / 0.035) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
              pointerEvents: "none",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: "50%",
              top: "46%",
              width: 620,
              height: 620,
              transform: "translate(-50%, -50%)",
              background:
                "radial-gradient(circle, oklch(0.42 0.14 255 / 0.14), transparent 62%)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 11,
            }}
          >
            {/* Placement 1 of 2. Paper, because it inherits the wordmark's colour. */}
            <span style={{ color: "oklch(0.975 0.006 85)", display: "flex" }}>
              <NexusMark size={30} />
            </span>
            <span
              style={{
                fontFamily: "var(--display), Georgia, serif",
                fontSize: 27,
                color: "oklch(0.975 0.006 85)",
                letterSpacing: "-0.02em",
              }}
            >
              ne
              <span
                style={{ fontStyle: "italic", color: "oklch(0.78 0.13 250)" }}
              >
                x
              </span>
              us
            </span>
            <span
              style={{
                fontFamily: "var(--mono), monospace",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "oklch(0.62 0.02 255)",
                border: "1px solid oklch(0.32 0.014 255)",
                padding: "3px 7px",
                borderRadius: 4,
                marginLeft: 2,
              }}
            >
              v1
            </span>
            <div style={{ flex: 1 }} />
            {/*
              The white secondary lockup, not the mono "THE DPS" text it
              replaces. It is the firm's mark on the firm's panel, and the panel
              is now a video — a text label reads as a caption against moving
              footage where a lockup reads as ownership.

              Fixed height, auto width, at 56 — double the 28 it was first sized
              to, per Edward. The source is a ROUNDEL with transparent padding on
              every side, so its type sits well inside the box: sized to match
              the v1 mono chip it read as a smudge, and even at 28 the lockup was
              quieter than the Nexus mark opposite it. At 56 the two brand marks
              carry equal weight across the panel head.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/dps-secondary-white.png"
              alt="The DPS"
              style={{ height: 56, width: "auto", opacity: 0.92, display: "block" }}
            />
          </div>

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              position: "relative",
              padding: "40px 0",
            }}
          >
            <div style={{ maxWidth: 560 }}>
              <div
                className="nx-anim"
                style={{
                  fontFamily: "var(--mono), monospace",
                  fontSize: 10.5,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "oklch(0.78 0.13 250)",
                  marginBottom: 18,
                  animation: "nx-rise 700ms ease-out both",
                }}
              >
                Commercial operations · product development
              </div>
              <h1
                className="nx-anim"
                style={{
                  fontFamily: "var(--display), Georgia, serif",
                  fontSize: "clamp(34px, 4.2vw, 58px)",
                  fontWeight: 400,
                  lineHeight: 1.05,
                  letterSpacing: "-0.03em",
                  color: "oklch(0.975 0.006 85)",
                  textWrap: "pretty",
                  margin: 0,
                  animation: "nx-rise 800ms ease-out 60ms both",
                }}
              >
                From first cost
                <br />
                <span
                  style={{ fontStyle: "italic", color: "oklch(0.78 0.13 250)" }}
                >
                  to final order.
                </span>
              </h1>
              <p
                className="nx-anim"
                style={{
                  fontSize: "clamp(13.5px, 1.1vw, 15px)",
                  lineHeight: 1.65,
                  color: "oklch(0.72 0.014 255)",
                  marginTop: 20,
                  marginBottom: 0,
                  maxWidth: 430,
                  animation: "nx-rise 850ms ease-out 120ms both",
                }}
              >
                Nexus connects product development, costing, quoting and
                operations — with every decision traceable to its source.
              </p>

              <div
                className="nx-anim"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 11,
                  marginTop: "clamp(26px, 3.4vw, 42px)",
                  paddingTop: "clamp(20px, 2.4vw, 28px)",
                  borderTop: "1px solid oklch(0.30 0.014 255)",
                  animation: "nx-rise 900ms ease-out 180ms both",
                }}
              >
                {[
                  "Traceable costs",
                  "Governed pricing",
                  "Connected operations",
                ].map((pillar) => (
                  <div
                    key={pillar}
                    style={{ display: "flex", alignItems: "center", gap: 9 }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "oklch(0.78 0.13 250)",
                        flex: "none",
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "var(--mono), monospace",
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "oklch(0.80 0.014 255)",
                      }}
                    >
                      {pillar}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div
            style={{
              position: "relative",
              fontFamily: "var(--mono), monospace",
              fontSize: 10,
              letterSpacing: "0.06em",
              color: "oklch(0.48 0.015 255)",
            }}
          >
            Internal tool · authorized personnel only
          </div>
        </div>

        {/* ── auth pane ───────────────────────────────────────────────── */}
        <div
          className="nx-auth"
          style={{
            background: "oklch(0.985 0.006 85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "48px 44px",
            position: "relative",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(-45deg, oklch(0.972 0.008 85) 0 9px, oklch(0.985 0.006 85) 9px 18px)",
              opacity: 0.7,
            }}
          />

          <div
            className="nx-anim"
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 372,
              animation: "nx-rise 700ms ease-out 100ms both",
            }}
          >
            {unauthorized && (
              <div
                role="alert"
                style={{
                  marginBottom: 22,
                  padding: "12px 14px",
                  borderRadius: 8,
                  border: "1px solid oklch(0.86 0.06 25)",
                  background: "oklch(0.97 0.02 25)",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: "oklch(0.42 0.16 25)",
                }}
              >
                <strong style={{ fontWeight: 600 }}>
                  That account is not authorized for Nexus.
                </strong>
                <div style={{ marginTop: 4 }}>
                  {sp.email ? (
                    <>
                      <span style={{ fontFamily: "var(--mono), monospace" }}>
                        {sp.email}
                      </span>{" "}
                      was rejected.{" "}
                    </>
                  ) : null}
                  Contact your Nexus administrator if you believe this is an
                  error.
                </div>
              </div>
            )}

            {/*
              Placement 2 of 2. An ink tile holding a paper mark — the only
              place the mark appears on the light side, and the reason it can
              stay `currentColor`: the tile sets the colour, the mark takes it.
            */}
            <div
              aria-hidden
              style={{
                width: 52,
                height: 52,
                borderRadius: 13,
                background: "oklch(0.20 0.02 255)",
                boxShadow: "0 10px 26px oklch(0.20 0.02 255 / 0.16)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "oklch(0.985 0.006 85)",
                marginBottom: 20,
              }}
            >
              <NexusMark size={32} />
            </div>

            <div
              style={{
                fontFamily: "var(--mono), monospace",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "oklch(0.68 0.012 255)",
              }}
            >
              Sign in
            </div>
            <div
              style={{
                fontFamily: "var(--display), Georgia, serif",
                fontSize: 32,
                letterSpacing: "-0.02em",
                margin: "5px 0 4px",
                color: "oklch(0.20 0.02 255)",
              }}
            >
              Welcome back
            </div>
            <div
              style={{
                fontSize: 13.5,
                color: "oklch(0.52 0.015 255)",
                lineHeight: 1.6,
              }}
            >
              Sign in with your DPS account. Access is managed in Nexus.
            </div>

            <ContinueWithDps />

            <div
              style={{
                fontSize: 12.5,
                color: "oklch(0.52 0.015 255)",
                marginTop: 18,
                textAlign: "center",
              }}
            >
              Need access? Contact your Nexus administrator.
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 14,
                marginTop: 26,
                paddingTop: 16,
                borderTop: "1px solid oklch(0.90 0.010 85)",
                fontFamily: "var(--mono), monospace",
                fontSize: 9.5,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "oklch(0.68 0.012 255)",
              }}
            >
              <span>Secure SSO</span>
              <span style={{ color: "oklch(0.82 0.014 85)" }}>·</span>
              <span>Audit trail</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
