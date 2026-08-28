/**
 * @nexora/app-web — CloudLayer.
 *
 * A purely ambient, independent atmosphere layer for the Landing page's
 * cinematic scene — soft, low-opacity cloud shapes drifting across the
 * sky above the building. Entirely decoupled from `CinematicJourney`: it
 * never reads or writes `video.currentTime`, has no knowledge of scroll
 * progress, and keeps drifting when the video is frozen on a held frame
 * (scrolling stopped) — that contrast is the point, it's what keeps the
 * scene feeling alive at rest instead of like a paused screenshot.
 *
 * Pure CSS: three stacked `@keyframes` loops (`transform: translate3d`
 * only — compositor-friendly, no layout/paint cost, no JS/rAF at all,
 * since nothing here needs to react to any input). Each layer is a
 * 200vw-wide strip holding two copies of the same soft cloud cluster
 * exactly 100vw apart; animating `translateX` by exactly one strip-width
 * (`-100vw`) loops seamlessly — the "seam" is invisible because the
 * content on both sides of it is identical. Durations are long (90–220s)
 * relative to any realistic time-on-page, so in practice a visitor never
 * sees the loop point at all.
 *
 * Density (how many depth layers render) and motion are both handled by
 * plain CSS media queries — `@media (max-width)` hides the deeper layers
 * on tablet/mobile, `@media (prefers-reduced-motion: reduce)` disables
 * every animation, leaving a static (not removed) atmosphere. Neither
 * needs JS, so this component carries zero React state and never
 * re-renders.
 */

/** The ambient sky cloud layer behind the Landing page's cinematic scene. */
export function CloudLayer(): JSX.Element {
  return (
    <div
      aria-hidden
      className="nexora-cloud-field"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      <div className="nexora-cloud-layer nexora-cloud-bg">
        <span className="nexora-cloud-shape nexora-cloud-shape-a" />
        <span className="nexora-cloud-shape nexora-cloud-shape-b" />
        <span className="nexora-cloud-shape nexora-cloud-shape-a-dup" />
        <span className="nexora-cloud-shape nexora-cloud-shape-b-dup" />
      </div>
      <div className="nexora-cloud-layer nexora-cloud-mid">
        <span className="nexora-cloud-shape nexora-cloud-shape-c" />
        <span className="nexora-cloud-shape nexora-cloud-shape-c-dup" />
      </div>
      <div className="nexora-cloud-layer nexora-cloud-fg">
        <span className="nexora-cloud-shape nexora-cloud-shape-d" />
        <span className="nexora-cloud-shape nexora-cloud-shape-d-dup" />
      </div>

      <style>{`
        .nexora-cloud-layer {
          position: absolute;
          top: 0;
          left: 0;
          width: 200vw;
          height: 62%;
          will-change: transform;
        }
        .nexora-cloud-shape {
          position: absolute;
          border-radius: 44% 56% 52% 48% / 56% 48% 52% 44%;
          background: radial-gradient(ellipse 60% 55% at 50% 50%, rgba(244,243,241,0.5), rgba(244,243,241,0) 72%);
        }

        /* Background — furthest, slowest, most subtle. */
        .nexora-cloud-bg {
          animation: nexora-cloud-drift-bg 220s linear infinite;
          opacity: 0.06;
        }
        .nexora-cloud-bg .nexora-cloud-shape-a,
        .nexora-cloud-bg .nexora-cloud-shape-a-dup { top: 8%; left: 6vw; width: 46vw; height: 160px; filter: blur(54px); }
        .nexora-cloud-bg .nexora-cloud-shape-b,
        .nexora-cloud-bg .nexora-cloud-shape-b-dup { top: 22%; left: 62vw; width: 38vw; height: 130px; filter: blur(54px); }
        .nexora-cloud-bg .nexora-cloud-shape-a-dup { left: 106vw; }
        .nexora-cloud-bg .nexora-cloud-shape-b-dup { left: 162vw; }
        @keyframes nexora-cloud-drift-bg {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(-100vw, -1.2vh, 0); }
        }

        /* Midground — a touch faster and a touch more present. */
        .nexora-cloud-mid {
          animation: nexora-cloud-drift-mid 140s linear infinite;
          opacity: 0.08;
        }
        .nexora-cloud-mid .nexora-cloud-shape-c,
        .nexora-cloud-mid .nexora-cloud-shape-c-dup { top: 14%; left: 30vw; width: 34vw; height: 110px; filter: blur(38px); }
        .nexora-cloud-mid .nexora-cloud-shape-c-dup { left: 130vw; }
        @keyframes nexora-cloud-drift-mid {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(-100vw, 1.6vh, 0); }
        }

        /* Foreground — very subtle still, but the most noticeable layer. */
        .nexora-cloud-fg {
          animation: nexora-cloud-drift-fg 90s linear infinite;
          opacity: 0.1;
        }
        .nexora-cloud-fg .nexora-cloud-shape-d,
        .nexora-cloud-fg .nexora-cloud-shape-d-dup { top: 4%; left: 2vw; width: 26vw; height: 84px; filter: blur(26px); }
        .nexora-cloud-fg .nexora-cloud-shape-d-dup { left: 102vw; }
        @keyframes nexora-cloud-drift-fg {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(-100vw, -2vh, 0); }
        }

        /* Tablet — drop the foreground layer, keep depth with two. */
        @media (max-width: 1023px) {
          .nexora-cloud-fg { display: none; }
        }
        /* Mobile — a single lightweight layer is enough. */
        @media (max-width: 767px) {
          .nexora-cloud-mid { display: none; }
        }
        /* A completely static atmosphere, not a removed one. */
        @media (prefers-reduced-motion: reduce) {
          .nexora-cloud-bg, .nexora-cloud-mid, .nexora-cloud-fg {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
