/**
 * Zeichnet ein Einzelbild des Projekts zum Zeitpunkt t – dieselbe Funktion für Vorschau und Export.
 */
import type { Clip, Filter, Project, TextItem } from './types';
import { clamp } from './util';
import { applyOverlay, glitchTransition, motionFx } from './effects';

export const TRANSITION_TIME = 0.45;

export type Timed = { clip: Clip; index: number; start: number; end: number };

export function layout(project: Project): Timed[] {
  let t = 0;
  return project.clips.map((clip, index) => {
    const start = t;
    t += (clip.out - clip.in) / clip.speed;
    return { clip, index, start, end: t };
  });
}

export function clipAt(timeline: Timed[], t: number): Timed | null {
  if (!timeline.length) return null;
  for (const c of timeline) if (t >= c.start && t < c.end) return c;
  return t >= timeline[timeline.length - 1].end ? timeline[timeline.length - 1] : timeline[0];
}

/** Zeit innerhalb der Quelldatei */
export const sourceTime = (c: Timed, t: number) => clamp(c.clip.in + (t - c.start) * c.clip.speed, c.clip.in, Math.max(c.clip.in, c.clip.out - 0.04));

export type Source = { el: CanvasImageSource; w: number; h: number } | null;

const FILTERS: Record<Filter, string> = {
  none: 'none',
  vivid: 'saturate(1.35) contrast(1.08)',
  warm: 'sepia(0.22) saturate(1.25) brightness(1.03)',
  cool: 'saturate(1.05) hue-rotate(-10deg) brightness(1.02)',
  mono: 'grayscale(1) contrast(1.12)',
  cinema: 'contrast(1.15) saturate(0.85) brightness(0.96)',
  fade: 'contrast(0.86) brightness(1.08) saturate(0.8)',
};
export const FILTER_LABELS: Record<Filter, string> = {
  none: 'Original', vivid: 'Lebendig', warm: 'Warm', cool: 'Kühl', mono: 'Schwarzweiß', cinema: 'Kino', fade: 'Vintage',
};

const ease = (p: number) => 1 - (1 - p) ** 3;

/** Textflächen des letzten Bildes (für Drag & Drop in der Vorschau) */
export type HitBox = { id: string; x: number; y: number; w: number; h: number };

export type FrameInput = {
  project: Project;
  timeline: Timed[];
  t: number;
  /** Quelle für einen Clip (Video-Element oder Bild) */
  source: (index: number) => Source;
  logo?: HTMLImageElement | null;
  /** Hilfsrahmen um den ausgewählten Text */
  selectedText?: string | null;
  /** Beats auf der Timeline (Musik) – ohne Musik die Schnittpunkte */
  beats?: number[];
};

/** Beats der Musik in Timeline-Zeit; ohne Musik dienen die Schnitte als Takt. */
export function timelineBeats(project: Project, timeline: Timed[], musicBeats?: number[]) {
  if (project.music && musicBeats?.length) return musicBeats.map((b) => b - project.music!.offset).filter((b) => b >= 0);
  return timeline.map((c) => c.start);
}

export function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, input: FrameInput): HitBox[] {
  const { project, timeline, t } = input;
  ctx.save();
  ctx.fillStyle = project.background || '#000';
  ctx.fillRect(0, 0, W, H);

  frameBeats = input.beats || [];
  const cur = clipAt(timeline, t);
  if (cur) {
    const local = t - cur.start;
    const prev = cur.index > 0 ? timeline[cur.index - 1] : null;
    const tr = cur.clip.transition;
    const p = prev && tr !== 'none' ? clamp(local / TRANSITION_TIME, 0, 1) : 1;
    if (p < 1 && prev) {
      const pe = ease(p);
      switch (tr) {
        case 'fade':
          drawClip(ctx, W, H, prev, prev.end - 0.01, input.source(prev.index), {});
          drawClip(ctx, W, H, cur, t, input.source(cur.index), { alpha: pe });
          break;
        case 'zoom':
          drawClip(ctx, W, H, prev, prev.end - 0.01, input.source(prev.index), { scale: 1 + pe * 0.3, alpha: 1 - pe });
          drawClip(ctx, W, H, cur, t, input.source(cur.index), { scale: 1.3 - pe * 0.3, alpha: pe });
          break;
        case 'slide':
          drawClip(ctx, W, H, prev, prev.end - 0.01, input.source(prev.index), { dx: -pe * W });
          drawClip(ctx, W, H, cur, t, input.source(cur.index), { dx: (1 - pe) * W });
          break;
        case 'flash':
          drawClip(ctx, W, H, cur, t, input.source(cur.index), {});
          ctx.fillStyle = `rgba(255,255,255,${(1 - p) * 0.95})`;
          ctx.fillRect(0, 0, W, H);
          break;
        case 'blur':
          drawClip(ctx, W, H, prev, prev.end - 0.01, input.source(prev.index), { blur: pe * 24, alpha: 1 - pe });
          drawClip(ctx, W, H, cur, t, input.source(cur.index), { blur: (1 - pe) * 24, alpha: pe });
          break;
        case 'whip':
          drawClip(ctx, W, H, prev, prev.end - 0.01, input.source(prev.index), { dx: -pe * W, blur: Math.sin(p * Math.PI) * 18 });
          drawClip(ctx, W, H, cur, t, input.source(cur.index), { dx: (1 - pe) * W, blur: Math.sin(p * Math.PI) * 18 });
          break;
        case 'spin':
          drawClip(ctx, W, H, prev, prev.end - 0.01, input.source(prev.index), { rotate: pe * 0.9, scale: 1 + pe * 0.6, alpha: 1 - pe });
          drawClip(ctx, W, H, cur, t, input.source(cur.index), { rotate: (pe - 1) * 0.9, scale: 1.6 - pe * 0.6, alpha: pe });
          break;
        case 'glitch':
          drawClip(ctx, W, H, p < 0.5 ? prev : cur, p < 0.5 ? prev.end - 0.01 : t, input.source(p < 0.5 ? prev.index : cur.index), {});
          glitchTransition(ctx, W, H, p, t);
          break;
        default:
          drawClip(ctx, W, H, cur, t, input.source(cur.index), {});
      }
    } else {
      drawClip(ctx, W, H, cur, t, input.source(cur.index), {});
    }
    applyOverlay(ctx, W, H, cur.clip.effect, cur.clip.effectAmount ?? 0.7, t, input.beats || []);
  }

  const boxes: HitBox[] = [];
  for (const item of project.texts) {
    if (t < item.start || t > item.end) continue;
    const box = drawText(ctx, W, H, item, t);
    if (box) {
      boxes.push(box);
      if (input.selectedText === item.id) {
        ctx.save();
        ctx.strokeStyle = '#3d95ff';
        ctx.lineWidth = Math.max(2, W / 400);
        ctx.setLineDash([W / 80, W / 120]);
        ctx.strokeRect(box.x - 6, box.y - 6, box.w + 12, box.h + 12);
        ctx.restore();
      }
    }
  }

  if (project.watermark && input.logo?.complete && input.logo.naturalWidth) {
    const lw = W * 0.16;
    const lh = (lw * input.logo.naturalHeight) / input.logo.naturalWidth;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(input.logo, W - lw - W * 0.05, W * 0.05, lw, lh);
    ctx.globalAlpha = 1;
  }

  // Ausblenden am Ende
  const total = timeline.length ? timeline[timeline.length - 1].end : 0;
  if (total && t > total - 0.3) {
    ctx.fillStyle = `rgba(0,0,0,${clamp((t - (total - 0.3)) / 0.3, 0, 1) * 0.9})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  return boxes;
}

type DrawOpts = { alpha?: number; scale?: number; dx?: number; blur?: number; rotate?: number };

let frameBeats: number[] = [];

function drawClip(ctx: CanvasRenderingContext2D, W: number, H: number, c: Timed, t: number, src: Source, o: DrawOpts) {
  if (!src || !src.w || !src.h) return;
  const { clip } = c;
  const dur = Math.max(0.01, c.end - c.start);
  const p = clamp((t - c.start) / dur, 0, 1);

  // Kamerafahrt (Ken Burns)
  let scale = 1;
  let mx = 0;
  let my = 0;
  switch (clip.motion) {
    case 'zoom-in': scale = 1 + 0.14 * p; break;
    case 'zoom-out': scale = 1.14 - 0.14 * p; break;
    case 'pan-left': scale = 1.14; mx = 0.06 - 0.12 * p; break;
    case 'pan-right': scale = 1.14; mx = -0.06 + 0.12 * p; break;
  }
  scale *= o.scale ?? 1;
  const fx = motionFx(clip.effect, clip.effectAmount ?? 0.7, t, frameBeats, W);
  scale *= fx.scale;

  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  const rot = (o.rotate ?? 0) + fx.rotate;
  if (rot) {
    ctx.translate(W / 2, H / 2);
    ctx.rotate(rot);
    ctx.translate(-W / 2, -H / 2);
  }
  const base = FILTERS[clip.filter] || 'none';
  const blur = o.blur ? `blur(${o.blur.toFixed(1)}px)` : '';
  const bright = fx.brightness !== 1 ? `brightness(${fx.brightness.toFixed(2)})` : '';
  const filter = [base === 'none' ? '' : base, blur, bright].filter(Boolean).join(' ') || 'none';

  if (clip.fit === 'contain') {
    // Unscharfer Hintergrund + vollständiges Bild
    const cover = Math.max(W / src.w, H / src.h);
    ctx.filter = 'blur(28px) brightness(0.55)';
    ctx.drawImage(src.el, (W - src.w * cover * 1.1) / 2, (H - src.h * cover * 1.1) / 2, src.w * cover * 1.1, src.h * cover * 1.1);
  }
  ctx.filter = filter;
  const fit = clip.fit === 'contain' ? Math.min(W / src.w, H / src.h) : Math.max(W / src.w, H / src.h);
  const dw = src.w * fit * scale;
  const dh = src.h * fit * scale;
  const x = (W - dw) / 2 + mx * W + (o.dx ?? 0) + fx.dx;
  const y = (H - dh) / 2 + my * H + fx.dy;
  ctx.drawImage(src.el, x, y, dw, dh);
  ctx.restore();
}

/* ---------------- Texte ---------------- */

export const TEXT_STYLES: Record<TextItem['style'], { label: string; size: number; weight: number; upper: boolean }> = {
  hook: { label: 'Hook (Einstieg)', size: 0.068, weight: 800, upper: false },
  title: { label: 'Titel', size: 0.085, weight: 800, upper: true },
  caption: { label: 'Untertitel', size: 0.052, weight: 700, upper: false },
  cta: { label: 'Call-to-Action', size: 0.058, weight: 800, upper: false },
  label: { label: 'Hinweis', size: 0.04, weight: 600, upper: false },
  price: { label: 'Preis / Zahl', size: 0.13, weight: 900, upper: false },
  neon: { label: 'Neon', size: 0.075, weight: 800, upper: true },
};

export const ANIM_LABELS: Record<TextItem['anim'], string> = {
  none: 'Keine', pop: 'Pop', fade: 'Einblenden', 'slide-up': 'Von unten', typewriter: 'Schreibmaschine', bounce: 'Hüpfen',
  karaoke: 'Karaoke', word: 'Wort für Wort',
};

/** Index des gerade gesprochenen Worts (mit Spracherkennungs-Zeiten oder gleichmäßig verteilt) */
function activeWord(item: TextItem, t: number, count: number) {
  if (item.words?.length === count) {
    let idx = -1;
    item.words.forEach((w, i) => { if (t >= w.start - 0.02) idx = i; });
    return idx;
  }
  const span = Math.max(0.2, (item.end - item.start) * 0.9);
  return Math.min(count - 1, Math.floor(((t - item.start) / span) * count));
}

const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawText(ctx: CanvasRenderingContext2D, W: number, H: number, item: TextItem, t: number): HitBox | null {
  const st = TEXT_STYLES[item.style];
  const local = t - item.start;
  const remain = item.end - t;
  const ref = Math.min(W, H * 0.75);
  const size = ref * st.size * item.size;
  let content = st.upper ? item.text.toUpperCase() : item.text;
  if (!content.trim()) return null;

  // Animation
  let alpha = 1;
  let scale = 1;
  let dy = 0;
  const p = clamp(local / 0.4, 0, 1);
  switch (item.anim) {
    case 'pop': scale = p < 1 ? 0.6 + 0.55 * ease(p) - 0.15 * Math.max(0, (p - 0.7) / 0.3) : 1; alpha = clamp(local / 0.12, 0, 1); break;
    case 'fade': alpha = p; break;
    case 'slide-up': dy = (1 - ease(p)) * size * 1.5; alpha = p; break;
    case 'bounce': dy = -Math.abs(Math.sin(local * 5)) * size * 0.25 * Math.max(0, 1 - local / 1.6); alpha = clamp(local / 0.12, 0, 1); break;
    case 'typewriter': {
      const n = Math.ceil(content.length * clamp(local / Math.max(0.4, content.length * 0.045), 0, 1));
      content = content.slice(0, n);
      break;
    }
  }
  alpha *= clamp(remain / 0.2, 0, 1);
  if (alpha <= 0.01) return null;

  ctx.save();
  ctx.font = `${st.weight} ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const full = st.upper ? item.text.toUpperCase() : item.text;
  const lines = wrap(ctx, content, W * 0.82);
  const fullLines = wrap(ctx, full, W * 0.82);
  const lineH = size * 1.18;
  const widest = Math.max(...fullLines.map((l) => ctx.measureText(l).width));
  const blockH = lineH * fullLines.length;
  const cx = item.x * W;
  const cy = item.y * H + dy;
  const padX = size * 0.55;
  const padY = size * 0.32;

  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  if (item.style === 'price') ctx.rotate(-0.06);
  ctx.scale(scale, scale);

  const top = -blockH / 2;
  if (item.style === 'hook' || item.style === 'cta' || item.style === 'label') {
    ctx.fillStyle = item.style === 'label' ? 'rgba(0,0,0,0.55)' : item.accent;
    const r = item.style === 'cta' ? (blockH + padY * 2) / 2 : size * 0.3;
    roundRect(ctx, -widest / 2 - padX, top - padY, widest + padX * 2, blockH + padY * 2, Math.min(r, size));
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = size * 0.5;
    ctx.shadowOffsetY = size * 0.1;
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }
  const wordMode = item.anim === 'karaoke' || item.anim === 'word';
  const drawLine = (line: string, x: number, y: number, color: string) => {
    if (item.style === 'caption' || item.style === 'title' || item.style === 'price') {
      ctx.lineJoin = 'round';
      ctx.lineWidth = size * (item.style === 'price' ? 0.16 : 0.18);
      ctx.strokeStyle = item.style === 'price' ? '#ffffff' : 'rgba(0,0,0,0.85)';
      ctx.strokeText(line, x, y);
    }
    if (item.style === 'title') {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = size * 0.4;
    }
    if (item.style === 'neon') {
      ctx.shadowColor = item.accent;
      ctx.shadowBlur = size * 0.6;
      ctx.lineWidth = size * 0.06;
      ctx.strokeStyle = item.accent;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(line, x, y);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  };
  const baseColor = item.style === 'price' ? item.accent : item.color;

  if (wordMode) {
    // Wort für Wort zeichnen, aktives Wort hervorheben
    const count = fullLines.reduce((n, l) => n + l.split(' ').filter(Boolean).length, 0);
    const active = activeWord(item, t, count);
    let k = 0;
    ctx.textAlign = 'left';
    const space = ctx.measureText(' ').width + size * 0.28;
    fullLines.forEach((line, i) => {
      const y = top + lineH * (i + 0.5);
      const words = line.split(' ').filter(Boolean);
      const lineW = words.reduce((sum, w) => sum + ctx.measureText(w).width, 0) + space * (words.length - 1);
      let x = -lineW / 2;
      for (const w of words) {
        const ww = ctx.measureText(w).width;
        const isActive = k === active;
        if (item.anim === 'word' && k > active) break;
        ctx.save();
        if (isActive) {
          const since = item.words?.[k] ? t - item.words[k].start : (t - item.start) % 0.3;
          const pop = item.anim === 'word' ? 0.7 + 0.3 * Math.min(1, since / 0.12) : 1.05;
          ctx.translate(x + ww / 2, y);
          ctx.scale(pop, pop);
          ctx.translate(-(x + ww / 2), -y);
          if (item.anim === 'karaoke' && item.style !== 'neon') {
            ctx.fillStyle = item.accent;
            roundRect(ctx, x - size * 0.12, y - size * 0.6, ww + size * 0.24, size * 1.2, size * 0.22);
            ctx.fill();
          }
        }
        drawLine(w, x, y, isActive && item.anim === 'word' ? item.accent : baseColor);
        ctx.restore();
        x += ww + space;
        k++;
      }
    });
  } else {
    lines.forEach((line, i) => drawLine(line, 0, top + lineH * (i + 0.5), baseColor));
  }
  ctx.restore();

  const bw = (widest + padX * 2) * scale;
  const bh = (blockH + padY * 2) * scale;
  return { id: item.id, x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}
