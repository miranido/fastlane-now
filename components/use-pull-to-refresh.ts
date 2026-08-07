"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pull-to-refresh for standalone mode.
 *
 * Once the app is installed to the home screen there's no browser chrome and
 * therefore no reload button, so the gesture people already expect has to be
 * provided. Only fires when the page is scrolled to the top and the drag is
 * downward, so ordinary scrolling is untouched.
 */

/** How far you must pull before releasing actually refreshes. */
const THRESHOLD_PX = 70;
/** Hard stop, so a long drag doesn't push the page off screen. */
const MAX_PULL_PX = 120;
/** Finger travel is halved, which is what makes it feel elastic. */
const DAMPING = 0.5;
/** A refresh that resolves instantly still shows feedback this long. */
const MIN_FEEDBACK_MS = 550;
/**
 * And one that never resolves gives up here. Without this, a single hung
 * request would leave `busy` stuck and kill the gesture for the whole session.
 */
const MAX_REFRESH_MS = 8_000;

export type PullPhase = "idle" | "pulling" | "ready" | "refreshing";

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [distance, setDistance] = useState(0);
  const [phase, setPhase] = useState<PullPhase>("idle");

  // Kept in a ref so re-renders don't rebind the listeners mid-gesture.
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let startY: number | null = null;
    let pulling = false;
    let travelled = 0;
    let busy = false;

    const atTop = () => window.scrollY <= 0;

    const onTouchStart = (event: TouchEvent) => {
      if (busy || event.touches.length !== 1 || !atTop()) return;
      startY = event.touches[0].clientY;
      pulling = false;
      travelled = 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (startY === null || busy) return;

      const delta = event.touches[0].clientY - startY;

      // Upward, or the page scrolled away from the top: this is a normal
      // scroll, so bow out and leave it alone.
      if (delta <= 0 || !atTop()) {
        if (!pulling) startY = null;
        return;
      }

      // Now it's definitely a pull — take over from the native bounce.
      pulling = true;
      event.preventDefault();

      travelled = Math.min(delta * DAMPING, MAX_PULL_PX);
      setDistance(travelled);
      setPhase(travelled >= THRESHOLD_PX ? "ready" : "pulling");
    };

    const settle = () => {
      setDistance(0);
      setPhase("idle");
    };

    const onTouchEnd = () => {
      if (startY === null) return;

      const shouldRefresh = pulling && travelled >= THRESHOLD_PX;
      startY = null;
      pulling = false;

      if (!shouldRefresh) {
        settle();
        return;
      }

      busy = true;
      setPhase("refreshing");
      setDistance(THRESHOLD_PX);

      const startedAt = Date.now();
      const guard = new Promise<void>((resolve) =>
        setTimeout(resolve, MAX_REFRESH_MS),
      );

      void Promise.race([
        refreshRef.current().catch(() => {
          /* the page shows its own error state */
        }),
        guard,
      ]).then(async () => {
        // Without a floor, a cached response snaps back so fast the gesture
        // reads as "nothing happened".
        const elapsed = Date.now() - startedAt;
        if (elapsed < MIN_FEEDBACK_MS) {
          await new Promise((resolve) =>
            setTimeout(resolve, MIN_FEEDBACK_MS - elapsed),
          );
        }
        settle();
        busy = false;
      });
    };

    // touchmove must be non-passive or preventDefault is ignored.
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return { distance, phase, threshold: THRESHOLD_PX };
}
