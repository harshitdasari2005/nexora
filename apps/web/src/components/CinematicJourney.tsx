/**
 * @nexora/app-web — CinematicJourney.
 *
 * The Landing page's primary visual environment: a cinematic MP4/WebM
 * (drone approach → entrance → interior → boardroom) whose playback
 * position is driven by scroll, not by autoplay.
 *
 * Delivery: the caller resolves a `sources` list (already tiered to the
 * viewport — desktop vs. mobile renditions live at different resolutions
 * and bitrates; only one tier is ever fetched) ordered most- to
 * least-preferred, VP9/WebM before H.264/MP4 — the browser picks the
 * first it can decode. See `apps/web/media-source/README` for the
 * encode pipeline that produced them from the supplied master.
 *
 * Scroll → time mapping: `progressRef` (0..1) is a ref, not React state —
 * scrolling never triggers a re-render here or in the caller. A
 * `requestAnimationFrame` loop reads it every tick and lerps
 * `video.currentTime` toward `progress * duration`, so the picture
 * follows scroll smoothly instead of snapping frame-to-frame; once the
 * target stops moving (scrolling stops) the lerp converges and further
 * ticks are no-ops, holding the current frame rather than continuing to
 * play. Reversing scroll direction reverses the target the same way —
 * there is nothing forward-only about the mapping.
 *
 * Smoothness under fast scrolling: naively assigning `currentTime` on
 * every rAF tick can queue seeks faster than the decoder can service them,
 * which is what actually produces visible stutter/jumping (not the lerp
 * math). This is gated by the standard `seeking`/`seeked` events — a new
 * seek is never issued while one is still in flight, the next tick simply
 * catches up once it resolves. Where `requestVideoFrameCallback` exists
 * (Chromium, Safari — feature-detected, not required), it's used to clear
 * that in-flight flag the moment a frame is actually presented, which is
 * tighter than waiting on `seeked` alone; browsers without it (Firefox)
 * fall back to `seeked` and behave identically, just marginally less
 * tightly paced.
 */

import { useEffect, useRef } from 'react';

export interface CinematicSource {
  src: string;
  type: string;
}

export interface CinematicJourneyProps {
  sources: readonly CinematicSource[];
  poster: string;
  /** 0..1 scroll-driven position through the journey, read from a ref so
   *  scrolling never causes a re-render. */
  progressRef: React.RefObject<number>;
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The scroll-scrubbed cinematic video background. */
export function CinematicJourney({
  sources,
  poster,
  progressRef,
}: CinematicJourneyProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const durationRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;

    // Decorative and scroll-driven, never autoplaying forward on its own —
    // muted + inline are also required for iOS/Safari to allow programmatic
    // `currentTime` seeks without a user gesture.
    video.muted = true;
    video.playsInline = true;

    const onLoadedMetadata = (): void => {
      durationRef.current = video.duration;
    };
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    if (video.readyState >= 1) durationRef.current = video.duration;

    if (reducedMotion()) {
      // A stable frame, not a forced scroll-driven animation — set once and
      // never touched again by this component.
      const setStatic = (): void => {
        video.currentTime = (progressRef.current ?? 0) * (durationRef.current || 0);
      };
      if (durationRef.current > 0) setStatic();
      else video.addEventListener('loadedmetadata', setStatic, { once: true });
      return () => video.removeEventListener('loadedmetadata', onLoadedMetadata);
    }

    // Tracks whether a seek we issued is still resolving. Skipping new
    // seeks while one is in flight is what actually prevents stutter when
    // scrolling fast — the lerp alone doesn't.
    let seekPending = false;
    const onSeeking = (): void => {
      seekPending = true;
    };
    const onSeeked = (): void => {
      seekPending = false;
    };
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);

    const supportsFrameCallback = typeof video.requestVideoFrameCallback === 'function';
    let frameCallbackId = 0;
    if (supportsFrameCallback) {
      const onFramePresented: VideoFrameRequestCallback = () => {
        seekPending = false;
        frameCallbackId = video.requestVideoFrameCallback(onFramePresented);
      };
      frameCallbackId = video.requestVideoFrameCallback(onFramePresented);
    }

    let rafId = 0;
    let lastTime = performance.now();
    let active = !document.hidden;

    const step = (now: number): void => {
      rafId = window.requestAnimationFrame(step);
      if (!active) return;
      const duration = durationRef.current;
      if (duration <= 0) return;
      const dt = Math.min(64, now - lastTime);
      lastTime = now;

      const target = Math.min(duration, Math.max(0, (progressRef.current ?? 0) * duration));
      const current = video.currentTime;
      // Time constant for the catch-up lerp: at 200ms this took ~0.9s to
      // close 99% of a large gap (e.g. a fast fling-scroll), which reads as
      // the picture lagging noticeably behind the scrollbar rather than
      // tracking it — 110ms halves that to ~0.5s, still enough smoothing to
      // avoid raw per-frame snapping on a janky scroll source, but tight
      // enough that the video reads as connected to the scroll input.
      const rate = Math.min(1, dt / 110);
      const next = current + (target - current) * rate;
      if (!seekPending && Math.abs(next - current) > 1 / 48) {
        video.currentTime = next;
      }
    };
    rafId = window.requestAnimationFrame((t) => {
      lastTime = t;
      step(t);
    });

    const onVisibility = (): void => {
      active = !document.hidden;
      lastTime = performance.now();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.cancelAnimationFrame(rafId);
      if (supportsFrameCallback) video.cancelVideoFrameCallback(frameCallbackId);
      document.removeEventListener('visibilitychange', onVisibility);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
    };
    // `sources` identity changes (tier switch) intentionally remount this
    // component (the caller keys it), so this effect only needs to run once.
  }, []);

  return (
    <video
      ref={videoRef}
      poster={poster}
      preload="auto"
      muted
      playsInline
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        // GPU-composited layer promotion only — no layout-triggering
        // properties are ever animated on this element.
        transform: 'translateZ(0)',
      }}
    >
      {sources.map((source) => (
        <source key={source.src} src={source.src} type={source.type} />
      ))}
    </video>
  );
}
