/**
 * @nexora/app-web — IntelligenceNetwork (S40 digital-headquarters pass).
 *
 * The "Nexora Intelligence Network": a decorative Canvas 2D scene depicting
 * the product's real narrative as a stylized DIGITAL TWIN of an enterprise —
 * a central intelligence core, six fixed spatial ZONES around it (Executive,
 * Finance, Operations, Technology, People, Legal — one per curated persona,
 * `../lib/rolePersonas.js`), soft architectural background structure, and
 * sparse cinematic events (SIGNAL → INTELLIGENCE → PLANNING → ACTION →
 * VERIFICATION) — never a constantly-looping animation. The zones are
 * ABSTRACT (translucent glass panels tinted per domain, never literal desks/
 * people/rooms) — "premium digital twin," not a video-game office. When an
 * `activeZone` is set (the authenticated shell passes the caller's resolved
 * persona), that zone reads as spatially prominent and every other zone
 * recedes — the SAME headquarters, a different area emphasized, matching
 * how role switching already recomposes the rest of the shell. Pure Canvas +
 * requestAnimationFrame: no new dependency, no 3D library (none exists in
 * this app, and this scene's abstraction level doesn't need one).
 *
 * Purely decorative (`aria-hidden`, `pointer-events: none`) — it carries no
 * information a screen reader needs and never intercepts input. Respects
 * `prefers-reduced-motion` (renders one static frame, no rAF loop), pauses
 * while the tab is hidden, and thins out on small/`simplified` viewports.
 */

import { useEffect, useRef } from 'react';

/**
 * A subtle contextual hue for the core/connections (S32 authenticated
 * shell; S33 expanded the palette so each business role's workspace reads
 * as a genuinely different operating environment, not just a different
 * page within one).
 */
export type IntelligenceNetworkTint =
  | 'indigo'
  | 'amber'
  | 'violet'
  | 'teal'
  | 'slate'
  | 'gold'
  | 'cyan'
  | 'emerald'
  | 'rose'
  | 'jade'
  | 'magenta'
  | 'olive'
  | 'orange'
  | 'steel';

/** Props of {@link IntelligenceNetwork}. */
export interface IntelligenceNetworkProps {
  /** Quieter, sparser composition for the Login page (default `false`). */
  quiet?: boolean;
  /**
   * Even quieter still — the persistent authenticated app-shell background:
   * lower density and opacity than `quiet`, meant to sit behind productivity
   * content for hours, not seconds (default `false`).
   */
  ambient?: boolean;
  /** Forces the low-density composition regardless of viewport (mobile). */
  simplified?: boolean;
  /** When true, plays the "signals converge into the core" transition. */
  converging?: boolean;
  /** A subtle contextual hue for the core/connections (default `indigo`). */
  tint?: IntelligenceNetworkTint;
  /**
   * The spatially prominent zone of the digital headquarters — set by the
   * authenticated shell to the caller's resolved persona's domain. That
   * zone panel reads as bright/foregrounded; the other five recede. `undefined`
   * (Landing/Login, or a role outside the six curated personas) shows all
   * six zones at equal, calm prominence — the whole headquarters, no area
   * singled out yet.
   */
  activeZone?: EnterpriseZone;
}

/**
 * The six spatial zones of the digital headquarters — one per curated
 * persona (`../lib/rolePersonas.js`). Fixed layout (not randomized): the
 * same six positions every render, only their EMPHASIS changes with
 * `activeZone`, so switching roles reads as "a different area of the same
 * building lighting up," never a different scene.
 */
export type EnterpriseZone =
  'executive' | 'finance' | 'operations' | 'technology' | 'people' | 'legal';

/** Each zone's tint reuses the SAME hue its persona's `RoleTheme` already
 * uses elsewhere in the app (`../lib/roleThemes.js`) — one color language,
 * not a second palette invented for this scene. */
export const ZONE_TINT: Record<EnterpriseZone, IntelligenceNetworkTint> = {
  executive: 'gold',
  finance: 'emerald',
  operations: 'orange',
  technology: 'cyan',
  people: 'rose',
  legal: 'amber',
};

/** Zone panels sit at fixed angles around the core, in a stable "floor
 * plan" order — always the same six positions regardless of which is
 * active. */
export const ZONE_ORDER: readonly EnterpriseZone[] = [
  'executive',
  'finance',
  'operations',
  'technology',
  'people',
  'legal',
];

/** Distant architectural facades — fixed, understated, framing not filling. */
const FACADES: readonly { nx: number; w: number; h: number }[] = [
  { nx: 0.1, w: 0.09, h: 0.62 },
  { nx: 0.24, w: 0.05, h: 0.42 },
  { nx: 0.78, w: 0.06, h: 0.5 },
  { nx: 0.92, w: 0.08, h: 0.34 },
];

/** Core/connection hue per tint — intentionally close to the base indigo,
 * never a different theme, just a whisper of context. */
export const TINT_RGB: Record<
  IntelligenceNetworkTint,
  { core: string; core2: string; line: string }
> = {
  indigo: { core: '167, 139, 250', core2: '99, 102, 241', line: '129, 140, 248' },
  amber: { core: '252, 211, 77', core2: '245, 158, 11', line: '217, 160, 90' },
  violet: { core: '196, 165, 250', core2: '139, 92, 246', line: '167, 139, 250' },
  teal: { core: '94, 234, 212', core2: '20, 184, 166', line: '94, 214, 200' },
  slate: { core: '186, 196, 216', core2: '148, 163, 184', line: '160, 172, 196' },
  gold: { core: '250, 219, 141', core2: '217, 160, 60', line: '224, 184, 110' },
  cyan: { core: '148, 233, 255', core2: '14, 165, 204', line: '94, 214, 240' },
  emerald: { core: '167, 243, 208', core2: '16, 150, 110', line: '110, 220, 175' },
  rose: { core: '253, 205, 220', core2: '225, 110, 150', line: '235, 160, 185' },
  jade: { core: '190, 242, 210', core2: '34, 170, 120', line: '120, 220, 175' },
  magenta: { core: '244, 190, 235', core2: '190, 70, 165', line: '215, 130, 200' },
  olive: { core: '224, 224, 160', core2: '150, 150, 60', line: '190, 190, 110' },
  orange: { core: '254, 202, 152', core2: '230, 120, 40', line: '240, 160, 95' },
  steel: { core: '186, 210, 240', core2: '70, 120, 190', line: '140, 175, 220' },
};

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

function buildNodes(density: 'full' | 'simplified', quiet: boolean, ambient: boolean): Node[] {
  const scale = ambient ? 0.4 : quiet ? 0.65 : 1;
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
  ambient = false,
  simplified = false,
  converging = false,
  tint = 'indigo',
  activeZone,
}: IntelligenceNetworkProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const convergingRef = useRef(converging);
  convergingRef.current = converging;
  const tintRef = useRef(TINT_RGB[tint]);
  tintRef.current = TINT_RGB[tint];
  const activeZoneRef = useRef(activeZone);
  activeZoneRef.current = activeZone;

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
      nodes = buildNodes(isNarrow() ? 'simplified' : 'full', quiet, ambient);
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
      const t = now / 1000;
      if (!staticFrame) advancePhase(now);

      // Damped camera follow (parallax) — frame-rate independent (~220ms
      // settle time), never a hard snap. A slow autonomous drift (independent
      // of the cursor, ~50s period) is blended in underneath so the
      // headquarters still breathes when the cursor is still — never a
      // direct mouseX → cameraX mapping either way.
      const followRate = Math.min(1, dt / 220);
      const driftX = staticFrame ? 0 : Math.sin(t * 0.125) * 0.05;
      const driftY = staticFrame ? 0 : Math.cos(t * 0.09) * 0.035;
      camera.x += (mouse.x + driftX - camera.x) * followRate;
      camera.y += (mouse.y + driftY - camera.y) * followRate;

      const targetConverge = convergingRef.current ? 1 : 0;
      const convergeRate = staticFrame ? 1 : Math.min(1, dt / 260);
      convergeProgress += (targetConverge - convergeProgress) * convergeRate;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const coreX = width * 0.5;
      const coreY = height * (quiet ? 0.4 : 0.46);
      const rgb = tintRef.current;
      const alphaScale = ambient ? 0.45 : 1;

      const phaseElapsed = staticFrame ? 0 : now - phaseStart;
      const breathe = 0.5 + 0.5 * Math.sin(t * 0.6);
      const pulse = phase === 'intelligence' ? Math.min(1, phaseElapsed / 350) : 0;
      const corePulseScale = 1 + pulse * 0.22 * (1 - pulse) * 4;
      const coreOpacityBase = (quiet ? 0.5 : 0.62) * alphaScale;
      const coreOpacity = coreOpacityBase + breathe * 0.12 + pulse * 0.25 + convergeProgress * 0.3;
      const coreRadius =
        (quiet ? 90 : 130) * (1 + breathe * 0.06) * corePulseScale * (1 + convergeProgress * 0.5);

      // --- Architectural background: distant glass facades (S40) ---
      // A handful of tall, soft-edged translucent slabs suggesting distant
      // office structures — never literal buildings, just enough structure
      // to read as "architecture" rather than empty space. Furthest depth
      // plane: minimal parallax, near-static.
      for (const facade of FACADES) {
        const fx = facade.nx * width + camera.x * 4;
        const fw = facade.w * width;
        const fh = facade.h * height;
        const fy = height - fh;
        const grad = ctx.createLinearGradient(0, fy, 0, height);
        grad.addColorStop(0, `rgba(${rgb.line}, 0)`);
        grad.addColorStop(1, `rgba(${rgb.line}, ${0.05 * alphaScale})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        const cornerRadius = Math.min(fw / 2, 18);
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(fx - fw / 2, fy, fw, fh, [cornerRadius, cornerRadius, 0, 0]);
        } else {
          ctx.rect(fx - fw / 2, fy, fw, fh);
        }
        ctx.fill();
      }

      // --- Background atmosphere (depth 2) ---
      for (const node of nodes) {
        if (node.depth !== 2) continue;
        const drift = staticFrame ? 0 : Math.sin(t * 0.15 + node.phase) * node.drift;
        const px = node.nx * width + camera.x * 8 + drift;
        const py = node.ny * height + camera.y * 8 + drift * 0.6;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, node.radius);
        const nodeRgb = HUE_RGB[node.hue];
        grad.addColorStop(0, `rgba(${nodeRgb}, ${(quiet ? 0.05 : 0.07) * alphaScale})`);
        grad.addColorStop(1, `rgba(${nodeRgb}, 0)`);
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
        const baseAlpha = (quiet ? 0.05 : 0.09) * alphaScale;
        ctx.strokeStyle = `rgba(${rgb.line}, ${baseAlpha + convergeProgress * 0.12})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo((px + coreX) / 2 + wobble, (py + coreY) / 2, coreX, coreY);
        ctx.stroke();
      }

      // --- Zone panels: the six spatial areas of the digital headquarters
      // (S40) — a fixed "floor plan" around the core; only EMPHASIS changes
      // with `activeZone`, never the layout. Each panel is oriented to face
      // the core and tinted with its persona's own theme color. ---
      const zoneCount = ZONE_ORDER.length;
      const zoneRadiusFrac = quiet ? 0.34 : 0.42;
      const activeZone = activeZoneRef.current;
      const zonePositions: { zone: EnterpriseZone; x: number; y: number }[] = [];
      for (let i = 0; i < zoneCount; i += 1) {
        const zone = ZONE_ORDER[i]!;
        const isActive = zone === activeZone;
        const angle = (i / zoneCount) * Math.PI * 2 - Math.PI / 2;
        const baseNx = 0.5 + Math.cos(angle) * zoneRadiusFrac;
        const baseNy = 0.46 + Math.sin(angle) * zoneRadiusFrac * 0.68;
        const zonePhase = i * 1.7;
        const drift = staticFrame ? 0 : Math.sin(t * 0.18 + zonePhase) * 5;
        const parallax = 14;
        const px =
          baseNx * width +
          camera.x * parallax +
          drift +
          (baseNx * width - coreX) * -convergeProgress * 0.5;
        const py =
          baseNy * height +
          camera.y * parallax +
          drift * 0.6 +
          (baseNy * height - coreY) * -convergeProgress * 0.5;
        zonePositions.push({ zone, x: px, y: py });

        const zoneTintRgb = TINT_RGB[ZONE_TINT[zone]];
        const emphasis = isActive ? 1 : activeZone === undefined ? 0.55 : 0.22;
        const zoneBreathe = 0.5 + 0.5 * Math.sin(t * 0.4 + zonePhase);
        const fade = 1 - convergeProgress * 0.5;

        ctx.strokeStyle = `rgba(${zoneTintRgb.line}, ${(isActive ? 0.22 : 0.07) * alphaScale * fade})`;
        ctx.lineWidth = isActive ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(coreX, coreY);
        ctx.stroke();

        const panelW = (isActive ? 30 : 20) * (quiet ? 0.75 : 1);
        const panelH = panelW * 0.62;
        const panelAlpha = (0.16 + zoneBreathe * 0.06) * emphasis * alphaScale * fade;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle + Math.PI / 2);
        ctx.fillStyle = `rgba(${zoneTintRgb.core2}, ${panelAlpha})`;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 4);
        } else {
          ctx.rect(-panelW / 2, -panelH / 2, panelW, panelH);
        }
        ctx.fill();
        if (isActive) {
          ctx.strokeStyle = `rgba(${zoneTintRgb.core}, ${0.35 * alphaScale * fade})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      }

      // Where the sparse SIGNAL → ... → VERIFICATION cycle originates this
      // time: the active zone's own panel when the shell has one resolved
      // (an authenticated CFO literally sees signals travel from Finance to
      // the core), otherwise a random connected midground node (Landing/
      // Login — no persona resolved yet, no zone to single out).
      const activeZonePosition =
        activeZone !== undefined ? zonePositions.find((z) => z.zone === activeZone) : undefined;

      // --- Traveling signal (signal → core, or core → action) ---
      if (!staticFrame && (activeZonePosition !== undefined || connectedNodes.length > 0)) {
        let px: number;
        let py: number;
        if (activeZonePosition !== undefined) {
          px = activeZonePosition.x;
          py = activeZonePosition.y;
        } else {
          const active = connectedNodes[activeConnectionIndex % connectedNodes.length]!;
          const parallax = 18;
          px = active.nx * width + camera.x * parallax;
          py = active.ny * height + camera.y * parallax;
        }
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
      if (
        !staticFrame &&
        phase === 'verification' &&
        (activeZonePosition !== undefined || connectedNodes.length > 0)
      ) {
        let px: number;
        let py: number;
        if (activeZonePosition !== undefined) {
          px = activeZonePosition.x;
          py = activeZonePosition.y;
        } else {
          const active = connectedNodes[activeConnectionIndex % connectedNodes.length]!;
          const parallax = 18;
          px = active.nx * width + camera.x * parallax;
          py = active.ny * height + camera.y * parallax;
        }
        const p = Math.min(1, phaseElapsed / PHASE_DURATIONS.verification);
        const ringRadius = 4 + p * 14;
        ctx.strokeStyle = `rgba(52, 211, 153, ${0.5 * (1 - p)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // --- Core (intelligence): layered translucent geometry, not a single
      // glowing blob. A restrained ambient glow sits underneath; concentric
      // rings (each breathing on its own slow phase) and one faint rotating
      // highlight arc read as "glass depth" and "intelligent light
      // movement" rather than a sci-fi orb.
      const coreGrad = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, coreRadius);
      coreGrad.addColorStop(0, `rgba(${rgb.core}, ${coreOpacity * 0.72})`);
      coreGrad.addColorStop(0.4, `rgba(${rgb.core2}, ${coreOpacity * 0.4})`);
      coreGrad.addColorStop(1, `rgba(${rgb.core2}, 0)`);
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(coreX, coreY, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      const ringFractions = [0.36, 0.56, 0.78] as const;
      for (let i = 0; i < ringFractions.length; i += 1) {
        const ringBreathe = staticFrame ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.45 + i * 1.35);
        const ringRadius = coreRadius * ringFractions[i]!;
        ctx.strokeStyle = `rgba(${rgb.line}, ${(0.1 + ringBreathe * 0.07) * alphaScale * (1 - convergeProgress * 0.4)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(coreX, coreY, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
      // One slow-rotating highlight arc — a whisper of motion across the
      // glass, never a spinner: a full revolution takes minutes.
      const arcAngle = staticFrame ? 0 : t * 0.12;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.16 * alphaScale})`;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(coreX, coreY, coreRadius * 0.56, arcAngle, arcAngle + Math.PI * 0.3);
      ctx.stroke();

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
        const nodeRgb = HUE_RGB[node.hue];
        const alpha = (quiet ? 0.35 : 0.5) * alphaScale * (1 - convergeProgress * 0.6);
        ctx.fillStyle = `rgba(${nodeRgb}, ${alpha})`;
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
        ctx.fillStyle = `rgba(245, 245, 255, ${(quiet ? 0.3 : 0.42) * alphaScale * twinkle})`;
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
    // props change; `converging`, `tint`, and `activeZone` are read live via
    // refs instead — a role switch must recompose the zone emphasis without
    // rebuilding the whole node layout underneath it.
  }, [quiet, ambient, simplified]);

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
