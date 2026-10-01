/**
 * Video-Effekte wie in CapCut. Zwei Arten:
 * – Bewegungs-Effekte (Pulse, Shake, Strobe) verändern, wie der Clip gezeichnet wird.
 * – Bild-Effekte (Glitch, VHS, RGB, Glow …) bearbeiten das fertige Bild danach.
 * Takt-Effekte reagieren auf die Beats der Musik (ohne Musik auf die Schnitte).
 */
import type { Effect } from './types';
import { clamp } from './util';

export const EFFECTS: Record<Effect, { label: string; icon: string; hint: string; beat?: boolean }> = {
  none: { label: 'Kein', icon: '⦸', hint: 'Kein Effekt' },
  pulse: { label: 'Beat-Zoom', icon: '💥', hint: 'Zoomt auf jeden Beat', beat: true },
  'flash-beat': { label: 'Beat-Blitz', icon: '⚡', hint: 'Weißer Blitz auf dem Beat', beat: true },
  shake: { label: 'Wackeln', icon: '📳', hint: 'Kamera wackelt – Energie & Action', beat: true },
  strobe: { label: 'Stroboskop', icon: '🔦', hint: 'Hell/Dunkel im Takt', beat: true },
  glitch: { label: 'Glitch', icon: '👾', hint: 'Digitale Störungen, verschobene Streifen' },
  rgb: { label: 'RGB-Split', icon: '🌈', hint: 'Farbkanäle versetzt' },
  vhs: { label: 'VHS', icon: '📼', hint: 'Retro-Videokassette mit Scanlines' },
  grain: { label: 'Filmkorn', icon: '🎞️', hint: 'Analoges Korn' },
  vignette: { label: 'Vignette', icon: '🔘', hint: 'Dunkle Ränder, Fokus auf die Mitte' },
  lightleak: { label: 'Lichtlecks', icon: '🌅', hint: 'Warmes, wanderndes Licht' },
  glow: { label: 'Glow', icon: '✨', hint: 'Weiches Leuchten, verträumt' },
  mirror: { label: 'Spiegel', icon: '🪞', hint: 'Symmetrisch gespiegelt' },
};

/** Zeit seit dem letzten Beat (für Takt-Effekte) */
export function sinceBeat(beats: number[], t: number) {
  let last = -Infinity;
  for (const b of beats) {
    if (b > t) break;
    last = b;
  }
  return t - last;
}

/** Deterministischer Zufall (gleiches Bild bei gleicher Zeit → Vorschau = Export) */
export function rand(seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export type MotionFx = { scale: number; dx: number; dy: number; rotate: number; brightness: number };

/** Bewegungs-Anteil eines Effekts */
export function motionFx(effect: Effect | undefined, amount: number, t: number, beats: number[], W: number): MotionFx {
  const fx: MotionFx = { scale: 1, dx: 0, dy: 0, rotate: 0, brightness: 1 };
  if (!effect || effect === 'none') return fx;
  const a = clamp(amount, 0, 1);
  const since = sinceBeat(beats, t);
  const decay = Math.exp(-since * 7);
  switch (effect) {
    case 'pulse':
      fx.scale = 1 + 0.09 * a * decay;
      break;
    case 'shake': {
      const k = W * 0.012 * a * (0.35 + decay);
      fx.dx = (rand(Math.floor(t * 30)) - 0.5) * 2 * k;
      fx.dy = (rand(Math.floor(t * 30) + 7) - 0.5) * 2 * k;
      fx.rotate = (rand(Math.floor(t * 30) + 3) - 0.5) * 0.02 * a;
      fx.scale = 1.04;
      break;
    }
    case 'strobe':
      fx.brightness = since < 0.08 ? 1 + 0.6 * a : 1 - 0.35 * a * clamp(since * 4, 0, 1);
      break;
    case 'glitch':
      if (rand(Math.floor(t * 8)) > 0.75) fx.dx = (rand(t * 100) - 0.5) * W * 0.04 * a;
      break;
  }
  return fx;
}

/* ---------------- Bild-Effekte ---------------- */

let buffer: HTMLCanvasElement | null = null;
let tintR: HTMLCanvasElement | null = null;
let tintC: HTMLCanvasElement | null = null;
let noise: HTMLCanvasElement | null = null;

function canvas(c: HTMLCanvasElement | null, w: number, h: number) {
  const el = c || document.createElement('canvas');
  if (el.width !== w || el.height !== h) {
    el.width = w;
    el.height = h;
  }
  return el;
}

function noiseTile() {
  if (noise) return noise;
  noise = document.createElement('canvas');
  noise.width = noise.height = 256;
  const ctx = noise.getContext('2d')!;
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return noise;
}

/** Aktuelles Bild in den Puffer kopieren */
function snapshot(ctx: CanvasRenderingContext2D, W: number, H: number) {
  buffer = canvas(buffer, W, H);
  const b = buffer.getContext('2d')!;
  b.globalCompositeOperation = 'copy';
  b.drawImage(ctx.canvas, 0, 0);
  b.globalCompositeOperation = 'source-over';
  return buffer;
}

/** Farbkanäle getrennt verschieben (Rot nach links, Cyan nach rechts) */
export function rgbSplit(ctx: CanvasRenderingContext2D, W: number, H: number, shift: number) {
  if (Math.abs(shift) < 0.5) return;
  const src = snapshot(ctx, W, H);
  tintR = canvas(tintR, W, H);
  tintC = canvas(tintC, W, H);
  for (const [c, color] of [[tintR, '#ff0000'], [tintC, '#00ffff']] as const) {
    const x = c.getContext('2d')!;
    x.globalCompositeOperation = 'copy';
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = color;
    x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'source-over';
  }
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(tintR, -shift, 0);
  ctx.drawImage(tintC, shift, 0);
  ctx.restore();
}

function slices(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, a: number) {
  const src = snapshot(ctx, W, H);
  const n = 3 + Math.floor(rand(t * 13) * 5);
  for (let i = 0; i < n; i++) {
    const y = rand(t * 31 + i) * H;
    const h = H * (0.02 + rand(t * 17 + i) * 0.08);
    const dx = (rand(t * 7 + i) - 0.5) * W * 0.15 * a;
    ctx.drawImage(src, 0, y, W, h, dx, y, W, h);
  }
}

/** Bild-Effekt auf das bereits gezeichnete Bild anwenden. local = Zeit im Clip. */
export function applyOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, effect: Effect | undefined, amount: number, t: number, beats: number[]) {
  if (!effect || effect === 'none') return;
  const a = clamp(amount, 0, 1);
  const since = sinceBeat(beats, t);
  ctx.save();
  switch (effect) {
    case 'flash-beat': {
      const v = Math.exp(-since * 9) * 0.75 * a;
      if (v > 0.01) {
        ctx.fillStyle = `rgba(255,255,255,${v})`;
        ctx.fillRect(0, 0, W, H);
      }
      break;
    }
    case 'strobe': {
      if (since > 0.08) {
        ctx.fillStyle = `rgba(0,0,0,${0.25 * a * clamp(since * 4, 0, 1)})`;
        ctx.fillRect(0, 0, W, H);
      }
      break;
    }
    case 'rgb':
      rgbSplit(ctx, W, H, W * 0.008 * a * (1 + Math.exp(-since * 6)));
      break;
    case 'glitch': {
      const burst = rand(Math.floor(t * 8)) > 0.6 || since < 0.12;
      if (burst) {
        rgbSplit(ctx, W, H, W * (0.01 + rand(t * 50) * 0.02) * a);
        slices(ctx, W, H, Math.floor(t * 24), a);
      }
      break;
    }
    case 'vhs': {
      rgbSplit(ctx, W, H, W * 0.004 * a);
      // Scanlines
      ctx.fillStyle = `rgba(0,0,0,${0.18 * a})`;
      const step = Math.max(2, Math.round(H / 300));
      for (let y = 0; y < H; y += step * 2) ctx.fillRect(0, y, W, step);
      // Rauschen + wandernder Streifen
      ctx.globalAlpha = 0.12 * a;
      ctx.globalCompositeOperation = 'overlay';
      const tile = noiseTile();
      ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
      ctx.translate(rand(t * 60) * 256, rand(t * 61) * 256);
      ctx.fillRect(-256, -256, W + 512, H + 512);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.1 * a;
      const band = ((t * 0.25) % 1) * H * 1.3 - H * 0.15;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, band, W, H * 0.03);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${Math.round(W * 0.04)}px ui-monospace, monospace`;
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText('▶ PLAY', W * 0.06, W * 0.1);
      break;
    }
    case 'grain': {
      ctx.globalAlpha = 0.16 * a;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = ctx.createPattern(noiseTile(), 'repeat')!;
      ctx.translate(rand(t * 24) * 256, rand(t * 25) * 256);
      ctx.fillRect(-256, -256, W + 512, H + 512);
      break;
    }
    case 'vignette': {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${0.75 * a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'lightleak': {
      ctx.globalCompositeOperation = 'screen';
      const blobs: [number, number, string][] = [[0.15, 0.2, '255,140,40'], [0.85, 0.75, '255,60,120'], [0.5, 0.05, '255,210,120']];
      blobs.forEach(([x, y, c], i) => {
        const cx = (x + Math.sin(t * 0.6 + i * 2) * 0.25) * W;
        const cy = (y + Math.cos(t * 0.45 + i) * 0.2) * H;
        const r = Math.max(W, H) * (0.45 + 0.1 * Math.sin(t + i));
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(${c},${0.55 * a})`);
        g.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      });
      break;
    }
    case 'glow': {
      const src = snapshot(ctx, W, H);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.55 * a;
      ctx.filter = `blur(${Math.round(W * 0.015)}px) brightness(1.1)`;
      ctx.drawImage(src, 0, 0);
      break;
    }
    case 'mirror': {
      const src = snapshot(ctx, W, H);
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(src, 0, 0, W / 2, H, 0, 0, W / 2, H);
      break;
    }
  }
  ctx.restore();
}

/** Glitch-Übergang: Störungen, die zur Mitte hin am stärksten sind */
export function glitchTransition(ctx: CanvasRenderingContext2D, W: number, H: number, p: number, t: number) {
  const k = 1 - Math.abs(p - 0.5) * 2;
  rgbSplit(ctx, W, H, W * 0.04 * k);
  if (k > 0.2) slices(ctx, W, H, Math.floor(t * 30), k);
}
