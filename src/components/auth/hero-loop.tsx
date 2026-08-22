"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The sign-in panel's background loop.
 *
 * ── WHY TWO VIDEOS ───────────────────────────────────────────────────────
 *
 * A single `<video loop>` restarts on a hard cut, and the cut is visible. Two
 * copies of the same source crossfade across the seam: when the front copy is
 * within FADE of its end, the back copy seeks to 0, plays, and the pair swap
 * opacity over a matching CSS transition. Roles then swap, and the copy that
 * just faded out pauses so only one is ever decoding at full rate.
 *
 * Ported from the handoff's `componentDidMount` with the same constants.
 *
 * ── THREE THINGS THAT ARE NOT PREFERENCES ────────────────────────────────
 *
 * 1. MUTED AS A PROPERTY. React drops the `muted` ATTRIBUTE during hydration,
 *    which is a long-standing quirk — a video that was muted in the server HTML
 *    can arrive unmuted in the DOM. `v.muted = true; v.volume = 0` is set
 *    imperatively on mount, and the attribute is restored alongside it. The
 *    attribute alone is not enough, and the failure is audible.
 *
 * 2. NOT MOUNTED BELOW THE BREAKPOINT. The handoff says the panel is "hidden
 *    anyway" under 860px. Checked rather than taken: it is not hidden, it is
 *    REORDERED — the auth pane takes `order: 1` and the panel drops beneath it
 *    at `min-height: 40vh`. So it is still on screen, and the poster is what
 *    fills it.
 *
 *    The gate stands regardless, on the handoff's actual reason: a phone should
 *    not spend 2.3MB and a decode budget on a decorative loop below the fold.
 *    It gates the ELEMENTS rather than their visibility, because a hidden
 *    `<video>` still fetches. Re-evaluated on resize, so a widened window gets
 *    the loop.
 *
 * 3. REDUCED MOTION SHOWS THE POSTER. Not a slower loop or a paused first
 *    frame — no video elements at all, so nothing decodes and nothing can start
 *    playing. The poster is frame 0 of the encode, so the still and the moving
 *    version are the same image.
 *
 * ── PLAYBACK RATE ────────────────────────────────────────────────────────
 *
 * 1.0, deliberately, against the handoff's 0.75. The handoff set 0.75 believing
 * the source was ~30fps; it is 24, so 0.75 would render ~18fps and judder worse
 * than the note anticipated. The asset was instead re-encoded to 60fps with
 * motion-compensated interpolation at half speed, which is the handoff's own
 * suggested remedy — so the slowness is in the file and the rate stays at 1.
 */

const FADE_SECONDS = 0.9;
const FRONT_OPACITY = 0.9;
/** Below this the panel drops beneath the auth pane; the poster serves it. */
const PANEL_MIN_WIDTH = 860;

const SRC = "/media/nexus-hero-loop.mp4";
const POSTER = "/media/nexus-hero-poster.jpg";

export function HeroLoop() {
  const a = useRef<HTMLVideoElement | null>(null);
  const b = useRef<HTMLVideoElement | null>(null);

  // Starts false so the server render and the first client render agree — the
  // decision needs `window`, and guessing it would hydrate-mismatch.
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const decide = () =>
      setEnabled(motionOk && window.innerWidth >= PANEL_MIN_WIDTH);
    decide();
    window.addEventListener("resize", decide);
    return () => window.removeEventListener("resize", decide);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const va = a.current;
    const vb = b.current;
    if (!va || !vb) return;

    for (const v of [va, vb]) {
      v.muted = true;
      v.volume = 0;
      v.setAttribute("muted", "");
      v.playbackRate = 1;
    }

    let front = va;
    let back = vb;
    let armed = false;
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;

    const swap = () => {
      armed = true;
      back.currentTime = 0;
      void back.play().catch(() => {});
      back.style.opacity = String(FRONT_OPACITY);
      front.style.opacity = "0";
      const previous = front;
      front = back;
      back = previous;
      pauseTimer = setTimeout(() => {
        back.pause();
        armed = false;
      }, FADE_SECONDS * 1000 + 60);
    };

    const tick = () => {
      const v = front;
      if (!armed && v.duration && v.duration - v.currentTime <= FADE_SECONDS) {
        swap();
      }
    };

    va.addEventListener("timeupdate", tick);
    vb.addEventListener("timeupdate", tick);
    // Autoplay needs muted + playsinline, and some browsers still decline.
    // A rejected promise leaves the poster showing, which is a correct outcome.
    void va.play().catch(() => {});

    return () => {
      va.removeEventListener("timeupdate", tick);
      vb.removeEventListener("timeupdate", tick);
      if (pauseTimer) clearTimeout(pauseTimer);
      va.pause();
      vb.pause();
    };
  }, [enabled]);

  const shared: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transition: `opacity ${FADE_SECONDS}s linear`,
    pointerEvents: "none",
  };

  // Reduced motion, or a viewport where the panel is a secondary band: the
  // poster only.
  // Rendered as a background rather than an <img> so it cannot be dragged,
  // selected, or announced.
  if (!enabled) {
    return (
      <div
        aria-hidden
        style={{
          ...shared,
          transition: undefined,
          backgroundImage: `url(${POSTER})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: FRONT_OPACITY,
        }}
      />
    );
  }

  return (
    <>
      <video
        ref={a}
        data-bg="a"
        src={SRC}
        poster={POSTER}
        muted
        playsInline
        preload="auto"
        aria-hidden
        tabIndex={-1}
        style={{ ...shared, opacity: FRONT_OPACITY }}
      />
      <video
        ref={b}
        data-bg="b"
        src={SRC}
        poster={POSTER}
        muted
        playsInline
        preload="auto"
        aria-hidden
        tabIndex={-1}
        style={{ ...shared, opacity: 0 }}
      />
    </>
  );
}
