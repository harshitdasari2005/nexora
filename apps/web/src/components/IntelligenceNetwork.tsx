/**
 * @nexora/app-web — IntelligenceNetwork (visual wow pass).
 *
 * The "Nexora Intelligence Network": a decorative Canvas 2D scene depicting
 * the product's real narrative — a central intelligence core, business
 * signal nodes across three depth planes, and sparse cinematic events
 * (SIGNAL → INTELLIGENCE → PLANNING → ACTION → VERIFICATION) — never a
 * constantly-looping animation. Pure Canvas + requestAnimationFrame: no new
 * dependency, no 3D library (none exists in this app).
 *
 * Purely decorative (`aria-hidden`, `pointer-events: none`) — it carries no
 * information a screen reader needs and never intercepts input. Respects
 * `prefers-reduced-motion` (renders one static frame, no rAF loop), pauses
 * while the tab is hidden, and thins out on small/`simplified` viewports.
 */

import { useEffect, useRef } from 'react';

/** Props of {@link IntelligenceNetwork}. */
export interface IntelligenceNetworkProps {
  /** Quieter, sparser composition for the Login page (default `false`). */
  quiet?: boolean;
  /** Forces the low-density composition regardless of viewport (mobile). */
  simplified?: boolean;
  /** When true, plays the "signals converge into the core" transition. */
  converging?: boolean;
}

type Phase = 'idle' | 'signal' | 'intelligence' | 'planning' | 'action' | 'verification';

interface Node {
  /** Normalized layout position (0..1) within the canvas. */
  nx: number;
  ny: number;
  depth: number; // 0 = foreground (closest/brightest), 1 = midground, 2 = background
  radius: number;
  phase: number; // per-node drift phase offset
  drift: number; // per-node drift magnitude in px
  connected: boolean; // has a line to the core
  hue: 'indigo' | 'violet' | 'white';
}

const PHASE_DURATIONS: Record<Phase, number> = {
  idle: 0, // computed randomly per cycle
  signal: 1100,
  intelligence: 700,
  planning: 1500,
  action: 1100,
  verification: 750,
};
const PHASE_ORDER: readonly Phase[] = [
  'signal',
  'intelligence',
  'planning',
  'action',
  'verification',
];

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function buildNodes(density: 'full' | 'simplified', quiet: boolean): Node[] {
  const scale = quiet ? 0.65 : 1;
  const counts = density === 'full' ? { bg: 4, mid: 14, fg: 6 } : { bg: 2, mid: 6, fg: 3 };
  const midCount = Math.max(3, Math.round(counts.mid * scale));
  const fgCount = Math.max(2, Math.round(counts.fg * scale));
  const bgCount = Math.max(2, counts.bg);

  const nodes: Node[] = [];
  const rand = (min: number, max: number): number => min + Math.random() * (max - min);
  const hues: Node['hue'][] = ['indigo', 'violet', 'white'];

  for (let i = 0; i < bgCount; i += 1) {
    nodes.push({
      nx: rand(0.05, 0.95),
      ny: rand(0.05, 0.95),
      depth: 2,
      radius: rand(60, 120),
      phase: rand(0, Math.PI * 2),
      drift: rand(6, 14),
      connected: false,
      hue: hues[i % hues.length]!,
    });
  }
  for (let i = 0; i < midCount; i += 1) {
    // Keep a clear ring around the core free so the headline stays legible.
    const angle = (i / midCount) * Math.PI * 2 + rand(-0.2, 0.2);
    const radiusFrac = rand(0.28, 0.48);
    nodes.push({
      nx: 0.5 + Math.cos(angle) * radiusFrac,
      ny: 0.46 + Math.sin(angle) * radiusFrac * 0.72,
      depth: 1,
      radius: rand(1.6, 3.2),
      phase: rand(0, Math.PI * 2),
      drift: rand(8, 18),
      connected: i % 2 === 0,
      hue: hues[i % hues.length]!,
    });
  }
  for (let i = 0; i < fgCount; i += 1) {
    nodes.push({
      nx: rand(0.08, 0.92),
      ny: rand(0.1, 0.9),
      depth: 0,
      radius: rand(1.5, 2.6),
      phase: rand(0, Math.PI * 2),
      drift: rand(14, 26),
      connected: false,
      hue: 'white',
    });
  }
  return nodes;
}

const HUE_RGB: Record<Node['hue'], string> = {
  indigo: '99, 102, 241',
  violet: '167, 139, 250',
  white: '245, 245, 255',
};

/** The decorative intelligence-network scene. */
export function IntelligenceNetwork({
  quiet = false,
  simplified = false,
  converging = false,
}: IntelligenceNetworkProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const convergingRef = useRef(converging);
  convergingRef.current = converging;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const isNarrow = (): boolean => simplified || window.innerWidth < 720;
    let nodes: Node[] = [];
    let connectedNodes: Node[] = [];

    const resize = (): void => {
      const parent = canvas.parentElement;
      if (parent === null) return;
      width = parent.clientWidth;
      height = parent.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      nodes = buildNodes(isNarrow() ? 'simplified' : 'full', quiet);
      // Recomputed on every resize — otherwise this would keep pointing at
      // nodes from the PREVIOUS layout, which are no longer drawn.
      connectedNodes = nodes.filter((n) => n.connected);
      activeConnectionIndex = 0;
    };

    // Cursor parallax target — read from a ref, never React state.
    const mouse = { x: 0, y: 0 };
    const camera = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent): void => {
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    // The sparse cinematic phase machine.
    let phase: Phase = 'idle';
    let phaseStart = performance.now();
    let idleDuration = 6500 + Math.random() * 4000;
    let activeConnectionIndex = 0;
    resize();

    const advancePhase = (now: number): void => {
      const elapsed = now - phaseStart;
      const duration = phase === 'idle' ? idleDuration : PHASE_DURATIONS[phase];
      if (elapsed < duration) return;
      phaseStart = now;
      if (phase === 'idle') {
        phase = PHASE_ORDER[0]!;
        if (connectedNodes.length > 0) {
          activeConnectionIndex = Math.floor(Math.random() * connectedNodes.length);
        }
      } else {
        const currentIndex = PHASE_ORDER.indexOf(phase);
        if (currentIndex >= PHASE_ORDER.length - 1) {
          phase = 'idle';
          idleDuration = 6500 + Math.random() * 4000;
        } else {
          phase = PHASE_ORDER[currentIndex + 1]!;
        }
      }
    };

    let convergeProgress = 0; // 0..1, eases toward 1 while converging
    let rafId = 0;
    let lastTime = performance.now();
    const staticFrame = reducedMotion();

    const draw = (now: number): void => {
      const dt = Math.min(64, now - lastTime);
      lastTime = now;
      if (!staticFrame) advancePhase(now);

      // Damped camera follow (parallax) — frame-rate independent (~220ms
      // settle time), never a hard snap.
      const followRate = Math.min(1, dt / 220);
      camera.x += (mouse.x - camera.x) * followRate;
      camera.y += (mouse.y - camera.y) * followRate;

      const targetConverge = convergingRef.current ? 1 : 0;
      const convergeRate = staticFrame ? 1 : Math.min(1, dt / 260);
      convergeProgress += (targetConverge - convergeProgress) * convergeRate;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const coreX = width * 0.5;
      const coreY = height * (quiet ? 0.4 : 0.46);
      const t = now / 1000;

      const phaseElapsed = staticFrame ? 0 : now - phaseStart;
      const breathe = 0.5 + 0.5 * Math.sin(t * 0.6);
      const pulse = phase === 'intelligence' ? Math.min(1, phaseElapsed / 350) : 0;
      const corePulseScale = 1 + pulse * 0.22 * (1 - pulse) * 4;
      const coreOpacityBase = quiet ? 0.5 : 0.62;
      const coreOpacity = coreOpacityBase + breathe * 0.12 + pulse * 0.25 + convergeProgress * 0.3;
      const coreRadius =
        (quiet ? 90 : 130) * (1 + breathe * 0.06) * corePulseScale * (1 + convergeProgress * 0.5);

      // --- Background atmosphere (depth 2) ---
      for (const node of nodes) {
        if (node.depth !== 2) continue;
        const drift = staticFrame ? 0 : Math.sin(t * 0.15 + node.phase) * node.drift;
        const px = node.nx * width + camera.x * 8 + drift;
        const py = node.ny * height + camera.y * 8 + drift * 0.6;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, node.radius);
        const rgb = HUE_RGB[node.hue];
        grad.addColorStop(0, `rgba(${rgb}, ${quiet ? 0.05 : 0.07})`);
        grad.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, node.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- Connections (midground → core) ---
      const reorganize =
        phase === 'planning' ? Math.min(1, phaseElapsed / PHASE_DURATIONS.planning) : 0;
      for (const node of nodes) {
        if (node.depth !== 1 || !node.connected) continue;
        const parallax = 18;
        const drift = staticFrame ? 0 : Math.sin(t * 0.2 + node.phase) * node.drift * 0.4;
        const px =
          node.nx * width +
          camera.x * parallax +
          drift +
          (node.nx * width - coreX) * -convergeProgress * 0.7;
        const py =
          node.ny * height +
          camera.y * parallax +
          drift * 0.6 +
          (node.ny * height - coreY) * -convergeProgress * 0.7;
        const wobble =
          reorganize > 0
            ? Math.sin(reorganize * Math.PI * 3 + node.phase) * 6 * (1 - reorganize)
            : 0;
        const baseAlpha = quiet ? 0.05 : 0.09;
        ctx.strokeStyle = `rgba(129, 140, 248, ${baseAlpha + convergeProgress * 0.12})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo((px + coreX) / 2 + wobble, (py + coreY) / 2, coreX, coreY);
        ctx.stroke();
      }

      // --- Traveling signal (signal → core, or core → action) ---
      if (!staticFrame && connectedNodes.length > 0) {
        const active = connectedNodes[activeConnectionIndex % connectedNodes.length]!;
        const parallax = 18;
        const px = active.nx * width + camera.x * parallax;
        const py = active.ny * height + camera.y * parallax;
        let travel: number | null = null;
        let fromX = px;
        let fromY = py;
        let toX = coreX;
        let toY = coreY;
        if (phase === 'signal') {
          travel = Math.min(1, phaseElapsed / PHASE_DURATIONS.signal);
        } else if (phase === 'action') {
          travel = Math.min(1, phaseElapsed / PHASE_DURATIONS.action);
          fromX = coreX;
          fromY = coreY;
          toX = px;
          toY = py;
        }
        if (travel !== null) {
          const eased = 1 - (1 - travel) * (1 - travel);
          const sx = fromX + (toX - fromX) * eased;
          const sy = fromY + (toY - fromY) * eased;
          const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 10);
          glow.addColorStop(0, 'rgba(224, 231, 255, 0.9)');
          glow.addColorStop(1, 'rgba(224, 231, 255, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(sx, sy, 10, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // --- Verification confirmation ring ---
      if (!staticFrame && phase === 'verification' && connectedNodes.length > 0) {
        const active = connectedNodes[activeConnectionIndex % connectedNodes.length]!;
        const parallax = 18;
        const px = active.nx * width + camera.x * parallax;
        const py = active.ny * height + camera.y * parallax;
        const p = Math.min(1, phaseElapsed / PHASE_DURATIONS.verification);
        const ringRadius = 4 + p * 14;
        ctx.strokeStyle = `rgba(52, 211, 153, ${0.5 * (1 - p)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // --- Core (intelligence) ---
      const coreGrad = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, coreRadius);
      coreGrad.addColorStop(0, `rgba(167, 139, 250, ${coreOpacity})`);
      coreGrad.addColorStop(0.4, `rgba(99, 102, 241, ${coreOpacity * 0.55})`);
      coreGrad.addColorStop(1, 'rgba(99, 102, 241, 0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(coreX, coreY, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      // --- Midground nodes (depth 1) ---
      for (const node of nodes) {
        if (node.depth !== 1) continue;
        const parallax = 18;
        const drift = staticFrame ? 0 : Math.sin(t * 0.2 + node.phase) * node.drift * 0.4;
        const px =
          node.nx * width +
          camera.x * parallax +
          drift +
          (node.nx * width - coreX) * -convergeProgress * 0.7;
        const py =
          node.ny * height +
          camera.y * parallax +
          drift * 0.6 +
          (node.ny * height - coreY) * -convergeProgress * 0.7;
        const rgb = HUE_RGB[node.hue];
        const alpha = (quiet ? 0.35 : 0.5) * (1 - convergeProgress * 0.6);
        ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, node.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- Foreground signal dots (depth 0) ---
      for (const node of nodes) {
        if (node.depth !== 0) continue;
        const parallax = 34;
        const drift = staticFrame ? 0 : Math.sin(t * 0.28 + node.phase) * node.drift * 0.5;
        const px = node.nx * width + camera.x * parallax + drift;
        const py = node.ny * height + camera.y * parallax + drift * 0.7;
        const twinkle = staticFrame ? 0.8 : 0.6 + 0.4 * Math.sin(t * 0.9 + node.phase);
        ctx.fillStyle = `rgba(245, 245, 255, ${(quiet ? 0.3 : 0.42) * twinkle})`;
        ctx.beginPath();
        ctx.arc(px, py, node.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // The browser itself withholds requestAnimationFrame callbacks for a
      // hidden document and resumes the already-queued one once visible
      // again (spec behavior) — no manual visibilitychange handling needed,
      // and no risk of double-scheduling a second loop on resume.
      if (!staticFrame) {
        rafId = window.requestAnimationFrame(draw);
      }
    };

    // ResizeObserver fires an initial callback shortly after `.observe()`
    // even when nothing visually changed — `resize()` resets `canvas.width`,
    // which clears the bitmap as a side effect. In static (reduced-motion)
    // mode nothing else ever redraws, so that callback must repaint too.
    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (staticFrame) draw(performance.now());
    });
    if (canvas.parentElement !== null) resizeObserver.observe(canvas.parentElement);

    if (staticFrame) {
      // One static, motionless frame — still shows the scene, respects the
      // user's reduced-motion preference. No rAF loop is ever scheduled.
      draw(performance.now());
    } else {
      rafId = window.requestAnimationFrame(draw);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
    };
    // Re-initializes the whole imperative scene only when density/tone
    // props change; `converging` is read live via `convergingRef` instead.
  }, [quiet, simplified]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        display: 'block',
      }}
    />
  );
}
