/**
 * @nexora/app-web — DigitalHeadquarters (S41).
 *
 * The spatial architectural layer of the "digital corporate headquarters"
 * environment: real CSS 3D — `perspective` + `transform-style: preserve-3d`
 * + `translateZ`/`rotateY` — not a flat background image or a 2D canvas
 * illusion of depth. A tilted glass floor fading into distance, a faint
 * receding back structure, and six zone panels (Executive, Finance,
 * Operations, Technology, People, Legal — one per curated persona,
 * `../lib/rolePersonas.js`) arranged in a shallow curved arc at varying
 * depth — genuinely closer/further from the camera, not just differently
 * colored dots. One perspective camera drifts slowly and turns gently
 * toward the caller's `activeZone` on a role switch, always through the
 * SAME damped spring toward a moving target (idle drift + cursor parallax +
 * role bias summed into one number, never a hard cut) — so a role switch
 * reads as the camera turning to a different part of ONE headquarters, not
 * a different scene.
 *
 * Pairs with {@link IntelligenceNetwork} (rendered alongside, underneath):
 * that Canvas 2D scene keeps owning the fine-grained sparse cinematic
 * storytelling (SIGNAL → INTELLIGENCE → PLANNING → ACTION → VERIFICATION) —
 * reused, not rebuilt, per S40/S41's "reuse what's technically valuable."
 * This component owns what Canvas 2D can't give for free: real architecture
 * and a camera.
 *
 * No new dependency: pure CSS transforms, GPU-composited (`transform` and
 * `opacity` only — no layout-triggering properties touched per frame).
 * Three.js/React Three Fiber were evaluated and deliberately NOT adopted —
 * this scene's abstraction level (six glass panels, a floor, a back wall)
 * doesn't need a full 3D engine, and this app has zero existing 3D infra to
 * amortize that dependency's weight against.
 *
 * Purely decorative (`aria-hidden`, `pointer-events: none`). Respects
 * `prefers-reduced-motion` (renders the settled frame once, no rAF loop)
 * and pauses while the tab is hidden (rAF is throttled/suspended by the
 * browser for a hidden document; no manual visibility handling needed).
 */

import { useEffect, useRef, useState } from 'react';

import { TINT_RGB, ZONE_ORDER, ZONE_TINT, type EnterpriseZone } from './IntelligenceNetwork.js';

/** Props of {@link DigitalHeadquarters}. */
export interface DigitalHeadquartersProps {
  /** Closer camera, quieter composition — the Login page (default `false`). */
  quiet?: boolean;
  /** Persistent authenticated app-shell background — lowest density/opacity. */
  ambient?: boolean;
  /** Forces the low-density composition regardless of viewport (mobile/tablet). */
  simplified?: boolean;
  /** The zone the camera gently turns toward (the caller's resolved persona). */
  activeZone?: EnterpriseZone;
  /**
   * 0..1 scroll-driven camera progress — the Landing page's cinematic
   * scroll journey (`undefined` everywhere else). Sweeps the camera's yaw
   * across the whole arc and gently pushes the scene forward (a "moving
   * deeper into the space" zoom), blended into the SAME damped spring as
   * cursor parallax and idle drift — never a separate, competing motion.
   */
  scrollProgress?: number;
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The six zones' fixed positions in the arc — angle in degrees, -50..+50. */
const ZONE_ANGLES: readonly number[] = [-50, -30, -10, 10, 30, 50];

/** The spatial CSS-3D architectural environment. */
export function DigitalHeadquarters({
  quiet = false,
  ambient = false,
  simplified = false,
  activeZone,
  scrollProgress,
}: DigitalHeadquartersProps): JSX.Element {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const activeZoneRef = useRef(activeZone);
  activeZoneRef.current = activeZone;
  const scrollProgressRef = useRef(scrollProgress);
  scrollProgressRef.current = scrollProgress;

  // Narrow-viewport detection (mirrors `IntelligenceNetwork`'s own
  // `window.innerWidth < 720` threshold) — mobile gets a recomposed, not
  // squeezed, layout: the zone gallery drops below the headline instead of
  // crowding it. A resize listener, not a per-frame check.
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 720,
  );
  useEffect(() => {
    const onResize = (): void => setNarrow(window.innerWidth < 720);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null) return;
    const staticFrame = reducedMotion();

    const mouse = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent): void => {
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    let yaw = 0;
    let pitch = 0;
    let zoom = 0;
    let rafId = 0;
    let lastTime = performance.now();

    const zoneAngle = (): number => {
      const zone = activeZoneRef.current;
      if (zone === undefined) return 0;
      const index = ZONE_ORDER.indexOf(zone);
      return index === -1 ? 0 : (ZONE_ANGLES[index] ?? 0);
    };

    const applyTransform = (): void => {
      scene.style.transform = `rotateX(${pitch.toFixed(3)}deg) rotateY(${yaw.toFixed(3)}deg) scale(${(1 + zoom * 0.22).toFixed(4)})`;
    };

    if (staticFrame) {
      // A settled, motionless frame — turned toward the active zone if one
      // is set, otherwise centered. No rAF loop is ever scheduled.
      yaw = zoneAngle() * 0.32;
      applyTransform();
      window.removeEventListener('pointermove', onPointerMove);
      return () => window.removeEventListener('pointermove', onPointerMove);
    }

    const draw = (now: number): void => {
      const dt = Math.min(64, now - lastTime);
      lastTime = now;
      const t = now / 1000;

      // Idle drift (~45s period) + damped cursor parallax + a gentle turn
      // toward the active zone + the scroll journey's own camera sweep —
      // ALL summed into one moving target, then eased toward with the SAME
      // spring every frame. A role switch or a scroll tick is just that
      // target changing; the camera never jump-cuts to either.
      const scroll = scrollProgressRef.current;
      const scrollYaw = scroll === undefined ? 0 : (scroll - 0.5) * 46;
      const driftYaw = Math.sin(t * 0.14) * 2.2;
      const driftPitch = Math.cos(t * 0.1) * 1.1;
      const targetYaw = driftYaw + mouse.x * (quiet ? 2 : 3.5) + zoneAngle() * 0.32 + scrollYaw;
      const targetPitch = driftPitch - mouse.y * (quiet ? 1 : 1.8);
      const targetZoom = scroll ?? 0;

      const rate = Math.min(1, dt / 550);
      yaw += (targetYaw - yaw) * rate;
      pitch += (targetPitch - pitch) * rate;
      zoom += (targetZoom - zoom) * Math.min(1, dt / 700);
      applyTransform();

      rafId = window.requestAnimationFrame(draw);
    };
    rafId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [quiet]);

  const density = simplified || narrow ? 'simplified' : 'full';
  const alphaScale = ambient ? 0.5 : quiet ? 0.75 : 1;
  const panelScale = (quiet ? 0.8 : 1) * (narrow ? 0.72 : 1);
  // On narrow viewports the zone gallery drops below the headline instead
  // of crowding it — a recomposition, not a squeeze.
  const zoneTop = narrow ? '58%' : '32%';

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        perspective: '1500px',
        perspectiveOrigin: '50% 38%',
        pointerEvents: 'none',
      }}
    >
      <div
        ref={sceneRef}
        style={{
          position: 'absolute',
          inset: 0,
          transformStyle: 'preserve-3d',
          transform: `rotateY(${activeZone !== undefined ? (ZONE_ANGLES[ZONE_ORDER.indexOf(activeZone)] ?? 0) * 0.32 : 0}deg)`,
          willChange: 'transform',
        }}
      >
        {/* Floor: a tilted glass plane fading into distance — steep enough
            perspective (72°, not 80°) that the grid lines actually read as
            a receding floor rather than a flat texture. */}
        <div
          style={{
            position: 'absolute',
            left: '-30%',
            top: '48%',
            width: '160%',
            height: '760px',
            transformOrigin: 'top center',
            transform: 'rotateX(72deg) translateZ(40px)',
            background: `repeating-linear-gradient(
              to bottom,
              rgba(255,255,255,${0.11 * alphaScale}) 0px,
              rgba(255,255,255,${0.11 * alphaScale}) 1px,
              transparent 1px,
              transparent 44px
            ), repeating-linear-gradient(
              to right,
              rgba(255,255,255,${0.07 * alphaScale}) 0px,
              rgba(255,255,255,${0.07 * alphaScale}) 1px,
              transparent 1px,
              transparent 110px
            )`,
            maskImage: 'linear-gradient(to bottom, black, transparent 82%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 82%)',
          }}
        />

        {/* Back structure: a receding wall with vertical framing (structural
            glass mullions). */}
        {density === 'full' ? (
          <div
            style={{
              position: 'absolute',
              left: '2%',
              top: '2%',
              width: '96%',
              height: '84%',
              transform: 'translateZ(-480px)',
              background: `repeating-linear-gradient(
                to right,
                rgba(255,255,255,${0.06 * alphaScale}) 0px,
                rgba(255,255,255,${0.06 * alphaScale}) 1px,
                transparent 1px,
                transparent 84px
              )`,
              maskImage: 'radial-gradient(ellipse 68% 62% at 50% 42%, black, transparent 88%)',
              WebkitMaskImage:
                'radial-gradient(ellipse 68% 62% at 50% 42%, black, transparent 88%)',
            }}
          />
        ) : null}

        {/* Intelligence core: a vertical light column integrated into the
            architecture — not a floating orb. */}
        <div
          className="nexora-hq-core"
          style={{
            position: 'absolute',
            left: '50%',
            top: '14%',
            width: '2px',
            height: '58%',
            transform: 'translateX(-1px) translateZ(-180px)',
            background: `linear-gradient(to bottom, transparent, rgba(255,255,255,${0.4 * alphaScale}) 40%, rgba(255,255,255,${0.4 * alphaScale}) 60%, transparent)`,
            boxShadow: `0 0 60px 10px rgba(255,255,255,${0.06 * alphaScale})`,
          }}
        />

        {/* The six zone panels: a shallow curved gallery, tinted per persona. */}
        {ZONE_ORDER.map((zone, index) => {
          const angle = ZONE_ANGLES[index] ?? 0;
          const rad = (angle * Math.PI) / 180;
          const isActive = zone === activeZone;
          const depth = -160 - Math.abs(angle) * 2.6;
          const x = Math.sin(rad) * 340;
          const y = 30 + Math.abs(angle) * 0.4;
          const tint = TINT_RGB[ZONE_TINT[zone]];
          const emphasis = isActive ? 1 : activeZone === undefined ? 0.85 : 0.34;
          const panelW = (isActive ? 158 : 128) * panelScale;
          const panelH = panelW * 0.62;
          return (
            <div
              key={zone}
              style={{
                position: 'absolute',
                left: '50%',
                top: zoneTop,
                width: `${panelW}px`,
                height: `${panelH}px`,
                marginLeft: `${-panelW / 2}px`,
                marginTop: `${-panelH / 2}px`,
                transform: `translate3d(${x}px, ${y}px, ${depth}px) rotateY(${-angle * 0.6}deg)`,
                borderRadius: '10px',
                background: `linear-gradient(160deg, rgba(${tint.core2}, ${0.24 * emphasis * alphaScale}), rgba(${tint.core2}, ${0.06 * emphasis * alphaScale}))`,
                border: `1px solid rgba(${tint.line}, ${(isActive ? 0.45 : 0.2) * alphaScale})`,
                boxShadow: isActive
                  ? `0 0 40px -4px rgba(${tint.core}, ${0.35 * alphaScale}), inset 0 1px 0 rgba(255,255,255,0.08)`
                  : 'inset 0 1px 0 rgba(255,255,255,0.04)',
                transition:
                  'width 480ms cubic-bezier(0.16,1,0.3,1), height 480ms cubic-bezier(0.16,1,0.3,1), background 480ms ease, border-color 480ms ease, box-shadow 480ms ease',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
