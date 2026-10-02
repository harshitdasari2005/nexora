/**
 * @nexora/app-web — Landing.
 *
 * The public landing page. The environment is a cinematic video
 * (`CinematicJourney`) — the Nexora headquarters approach → entrance →
 * interior → boardroom — whose playback position scrubs with scroll
 * instead of autoplaying. Delivery is tiered to the viewport (desktop vs.
 * mobile renditions, WebM/VP9 before MP4/H.264 — see
 * `apps/web/media-source/README.md` for the encode pipeline) so only one
 * appropriately-sized file is ever fetched.
 *
 * Scroll progress is kept in a ref, never React state — see
 * `CinematicJourney` for why (it's read every rAF tick; putting it in
 * state would re-render this page and its children on every scroll
 * frame). The story-beat overlays (opening heading, closing CTA, scroll
 * hint, badge) are therefore faded by writing directly to their DOM
 * nodes' `style.opacity` from the same scroll handler, not from JSX
 * driven by state.
 *
 * The primary CTA ("Get started") is ALSO in the fixed header, always
 * reachable without scrolling — the scroll journey is optional cinematic
 * storytelling, never a gate in front of the product. Only
 * `prefers-reduced-motion` skips the scroll-scrub, for a static frame (no
 * video element at all) with the same content — a scroll-linked camera IS
 * motion, so this one is an accessibility requirement, not a bandwidth
 * one. Mobile gets its own lightweight video tier rather than a fallback:
 * see the encode pipeline for why that's affordable now.
 *
 * This is the ONLY page carrying this visual system: the authenticated
 * application, Login's own composition (still `IntelligenceNetwork` /
 * `DigitalHeadquarters`), and Command Center are unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Stack, typography } from '@nexora/design-system';

import { CinematicJourney, type CinematicSource } from '../components/CinematicJourney.js';
import { CloudLayer } from '../components/CloudLayer.js';
import { useDemo } from '../demo/demo-state.js';

const TRANSITION_MS = 650;
const MOBILE_BREAKPOINT = 768;

type Tier = 'desktop' | 'mobile';

const ASSETS: Record<Tier, { poster: string; sources: readonly CinematicSource[] }> = {
  desktop: {
    poster: '/media/nexora-hq-desktop-poster.jpg',
    sources: [
      { src: '/media/nexora-hq-desktop.webm', type: 'video/webm' },
      { src: '/media/nexora-hq-desktop.mp4', type: 'video/mp4' },
    ],
  },
  mobile: {
    poster: '/media/nexora-hq-mobile-poster.jpg',
    sources: [
      { src: '/media/nexora-hq-mobile.webm', type: 'video/webm' },
      { src: '/media/nexora-hq-mobile.mp4', type: 'video/mp4' },
    ],
  },
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function resolveTier(): Tier {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
    ? 'mobile'
    : 'desktop';
}

/** The public landing page. */
export function Landing(): JSX.Element {
  const [transitioning, setTransitioning] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  // The scroll-scrub itself is only ever skipped for reduced-motion (a
  // scroll-linked camera IS motion, an accessibility concern) — not for
  // narrow viewports, which get their own lightweight video tier instead
  // of a fallback. `tier` picks which rendition to fetch.
  const [cinematic, setCinematic] = useState(
    () => typeof window !== 'undefined' && !reducedMotion(),
  );
  const [tier, setTier] = useState<Tier>(() => resolveTier());
  useEffect(() => {
    const onResize = (): void => {
      setCinematic(!reducedMotion());
      setTier(resolveTier());
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const trackRef = useRef<HTMLDivElement | null>(null);
  // Read every rAF tick by CinematicJourney — kept out of React state so
  // scrolling never re-renders this page.
  const progressRef = useRef(0);
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef<HTMLDivElement | null>(null);
  const scrollHintRef = useRef<HTMLDivElement | null>(null);
  const cloudFieldRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!cinematic) return;
    let ticking = false;
    const syncFromScroll = (): void => {
      const track = trackRef.current;
      if (track !== null) {
        const rect = track.getBoundingClientRect();
        const viewport = window.innerHeight;
        const total = rect.height - viewport;
        const progress = total > 0 ? clamp01(-rect.top / total) : 0;
        progressRef.current = progress;
        if (badgeRef.current !== null) {
          badgeRef.current.style.opacity = String(Math.max(0, 1 - progress * 10));
        }
        if (heroRef.current !== null) {
          heroRef.current.style.opacity = String(Math.max(0, 1 - progress * 6));
        }
        if (closingRef.current !== null) {
          closingRef.current.style.opacity = String(clamp01((progress - 0.86) / 0.14));
        }
        if (scrollHintRef.current !== null) {
          scrollHintRef.current.style.opacity = String(clamp01(1 - progress * 14));
        }
      }
      ticking = false;
    };

    // The cloud layer is independent atmosphere, not part of the scroll
    // story — this only ever nudges its opacity down a little while a
    // scroll gesture is actively in flight, so the camera journey reads
    // clearly, then lets it settle back once scrolling stops. It never
    // touches video.currentTime or anything CinematicJourney owns.
    let scrollStopTimer: number | undefined;
    const onScroll = (): void => {
      if (cloudFieldRef.current !== null) {
        cloudFieldRef.current.style.opacity = '0.55';
      }
      window.clearTimeout(scrollStopTimer);
      scrollStopTimer = window.setTimeout(() => {
        if (cloudFieldRef.current !== null) {
          cloudFieldRef.current.style.opacity = '1';
        }
      }, 220);

      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(syncFromScroll);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    syncFromScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(scrollStopTimer);
    };
  }, [cinematic]);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  // Both "Get started" and "Sign in" take the user STRAIGHT to the identity
  // provider (`/api/auth/login`) — a full-page navigation, no in-app
  // sign-in screen in between. The plain anchor `href` is the real target
  // (works with JS disabled); `goToLogin` only intercepts a plain click to
  // play the cinematic fade-out before the redirect.
  const SSO_LOGIN_URL = '/api/auth/login';
  const goToLogin = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    // Preserve modifier-key / middle-click "open in new tab" — only
    // intercept a plain click to play the transition.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (reducedMotion()) {
      window.location.assign(SSO_LOGIN_URL);
      return;
    }
    setTransitioning(true);
    timeoutRef.current = window.setTimeout(
      () => window.location.assign(SSO_LOGIN_URL),
      TRANSITION_MS,
    );
  }, []);

  // "Start Demo" appears ONLY when the backend reports demo mode; it leads to
  // the gated demo entry (real seeded personas, real sessions).
  const demo = useDemo();
  const cta = (size: 'sm' | 'lg' = 'lg'): JSX.Element => (
    <Stack direction="row" gap={size === 'lg' ? 3 : 2} align="center">
      <a href={SSO_LOGIN_URL} onClick={goToLogin} style={{ textDecoration: 'none' }}>
        <Button size={size}>Get started</Button>
      </a>
      {demo.status === 'enabled' ? (
        <Link to="/demo" style={{ textDecoration: 'none' }} data-testid="start-demo">
          <Button size={size} variant="secondary">
            Start demo
          </Button>
        </Link>
      ) : null}
    </Stack>
  );

  // Readability over live footage, applied only where the video actually
  // needs it — never a large opaque card over the scene.
  const scrimTop = (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: '0 0 auto 0',
        height: '38%',
        background: 'linear-gradient(180deg, rgba(6,6,9,0.72) 0%, rgba(6,6,9,0) 100%)',
        pointerEvents: 'none',
      }}
    />
  );
  const scrimBottom = (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 'auto 0 0 0',
        height: '44%',
        background: 'linear-gradient(0deg, rgba(6,6,9,0.78) 0%, rgba(6,6,9,0) 100%)',
        pointerEvents: 'none',
      }}
    />
  );

  const assets = ASSETS[tier];

  return (
    <div
      data-theme="dark"
      // Keeps the landing page on its own palette, typeface and shape — the
      // app's "desk and ledger" language deliberately stops at this door.
      className="nexora-landing"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#0c0c0f',
        color: 'var(--nexora-text)',
        // `overflowX` ONLY (never plain `overflow`, never `minHeight`
        // replaced with a fixed `height`) — the window itself must stay the
        // real scroll container: the cinematic section's `position: sticky`
        // stage and its scroll-progress listener both assume `window` is
        // scrolling. A fixed height + clipped Y, or an `overflow: auto`
        // wrapper anywhere in between, silently makes some inner div the
        // scroll container instead, and neither sticky nor the progress
        // listener (attached to `window`) fires correctly. 'clip' (not
        // 'hidden') on X alone avoids the separate overflow-x/y
        // auto-coupling issue where mismatched hidden/visible on
        // perpendicular axes turns the visible one into a scroll container.
        overflowX: 'clip',
        opacity: transitioning ? 0 : 1,
        transform: transitioning ? 'scale(1.02)' : 'none',
        filter: transitioning ? 'blur(6px)' : 'none',
        transition: `opacity ${TRANSITION_MS}ms cubic-bezier(0.2,0,0,1), transform ${TRANSITION_MS}ms cubic-bezier(0.2,0,0,1), filter ${TRANSITION_MS}ms cubic-bezier(0.2,0,0,1)`,
      }}
    >
      {/* Minimal top navigation — the primary CTA lives here too, always
          reachable without scrolling the cinematic section below. */}
      <header
        style={{
          position: 'relative',
          zIndex: 3,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px 32px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
              display: 'inline-flex',
            }}
          />
          <span style={{ fontWeight: typography.weights.bold, fontSize: typography.sizes.md }}>
            Nexora
          </span>
        </div>
        <Stack direction="row" gap={4} align="center">
          <a
            href={SSO_LOGIN_URL}
            onClick={goToLogin}
            style={{
              color: 'var(--nexora-textSecondary)',
              fontSize: typography.sizes.sm,
              textDecoration: 'none',
            }}
          >
            Sign in
          </a>
          {cta('sm')}
        </Stack>
      </header>

      {/* The journey. */}
      {cinematic ? (
        <div style={{ flex: 1 }}>
          <div ref={trackRef} style={{ position: 'relative', height: '380vh' }}>
            <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
              <CinematicJourney
                key={tier}
                sources={assets.sources}
                poster={assets.poster}
                progressRef={progressRef}
              />
              <div
                ref={cloudFieldRef}
                style={{ position: 'absolute', inset: 0, transition: 'opacity 400ms ease-out' }}
              >
                <CloudLayer />
              </div>
              {scrimTop}
              {scrimBottom}

              <div
                ref={badgeRef}
                style={{
                  position: 'absolute',
                  top: 24,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 2,
                }}
              >
                <Badge tone="ai" dot>
                  AI-native enterprise operating system
                </Badge>
              </div>

              {/* Opening beat — fades early so the interior/boardroom
                  footage reads clearly once the user starts scrolling. */}
              <div
                ref={heroRef}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: '0 24px',
                  zIndex: 2,
                  pointerEvents: 'none',
                }}
              >
                <div>
                  <h1
                    style={{
                      margin: 0,
                      fontSize: 'clamp(2.6rem, 7vw, 5.5rem)',
                      fontWeight: 700,
                      letterSpacing: '-0.03em',
                      lineHeight: 1.08,
                      color: '#f7f6f4',
                      textShadow: '0 8px 60px rgba(0,0,0,0.6)',
                    }}
                  >
                    Work. Orchestrated by AI.
                  </h1>
                </div>
              </div>

              {/* Closing beat — the boardroom frame is the transition point
                  into sign-in, so the CTA arrives with it. */}
              <div
                ref={closingRef}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: '0 24px 88px',
                  zIndex: 2,
                  opacity: 0,
                }}
              >
                <div>
                  <p
                    style={{
                      margin: '0 0 20px',
                      fontSize: typography.sizes.md,
                      color: 'rgba(244,243,241,0.78)',
                    }}
                  >
                    Verified. Enter Nexora.
                  </p>
                  {cta('lg')}
                </div>
              </div>

              <div
                ref={scrollHintRef}
                aria-hidden
                style={{
                  position: 'absolute',
                  bottom: 28,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 2,
                  fontSize: typography.sizes.xs,
                  color: 'var(--nexora-textMuted)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                Scroll
                <span style={{ fontSize: 14 }}>↓</span>
              </div>
            </div>
          </div>
          <footer
            style={{
              position: 'relative',
              zIndex: 1,
              padding: '20px 32px',
              display: 'flex',
              justifyContent: 'space-between',
              color: 'var(--nexora-textMuted)',
              fontSize: typography.sizes.sm,
            }}
          >
            <span>Nexora — Work. Orchestrated by AI.</span>
            <span>© 2026 Nexora</span>
          </footer>
        </div>
      ) : (
        <div style={{ flex: 1, position: 'relative' }}>
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${ASSETS.desktop.poster})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <CloudLayer />
          {scrimTop}
          {scrimBottom}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '0 24px',
              zIndex: 2,
            }}
          >
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 'clamp(2.4rem, 9vw, 3.5rem)',
                  fontWeight: 700,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.1,
                  color: '#f7f6f4',
                  textShadow: '0 8px 60px rgba(0,0,0,0.6)',
                }}
              >
                Work. Orchestrated by AI.
              </h1>
              <div style={{ marginTop: 28 }}>{cta('lg')}</div>
            </div>
          </div>
          <footer
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 1,
              padding: '20px 32px',
              display: 'flex',
              justifyContent: 'space-between',
              color: 'var(--nexora-textMuted)',
              fontSize: typography.sizes.sm,
            }}
          >
            <span>Nexora — Work. Orchestrated by AI.</span>
            <span>© 2026 Nexora</span>
          </footer>
        </div>
      )}
    </div>
  );
}
