/**
 * KI-Analyse im Browser: erkennt Szenenwechsel, bewertet Abschnitte (Bewegung, Schärfe,
 * Farbe, Helligkeit, Ton), findet Sprechpausen und – bei Musik – Tempo und Beats.
 * Alles läuft lokal, ohne Upload.
 */
import type { MediaAnalysis, MediaAsset, MediaKind, Segment } from './types';
import { clamp, now, once, seek, uid } from './util';

export type Progress = (p: number, label: string) => void;

const THUMB_W = 160;

export function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'mov', 'webm', 'm4v', 'mkv'].includes(ext)) return 'video';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio';
  return null;
}

/** Liest eine Datei ein und analysiert sie. */
export async function importFile(file: File, onProgress: Progress = () => {}): Promise<MediaAsset> {
  const kind = kindOf(file);
  if (!kind) throw new Error(`${file.name}: Dateiformat wird nicht unterstützt.`);
  const url = URL.createObjectURL(file);
  try {
    const base = { id: uid(), kind, name: file.name, mime: file.type, createdAt: now() };
    if (kind === 'image') return { ...base, ...(await analyzeImage(url)) };
    if (kind === 'audio') return { ...base, ...(await analyzeMusic(file, onProgress)) };
    return { ...base, ...(await analyzeVideo(file, url, onProgress)) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------------- Bilder ---------------- */

async function analyzeImage(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => { throw new Error('Bild konnte nicht gelesen werden.'); });
  return {
    duration: 3,
    width: img.naturalWidth,
    height: img.naturalHeight,
    thumbs: [snapshot(img, img.naturalWidth, img.naturalHeight, THUMB_W * 2)],
  };
}

/* ---------------- Videos ---------------- */

type FrameStats = { t: number; luma: Float32Array; brightness: number; sharpness: number; color: number; thumb: string };

async function analyzeVideo(file: File, url: string, onProgress: Progress) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await once(video, 'loadeddata', 15000);
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`${file.name}: Videolänge nicht lesbar.`);
  const width = video.videoWidth;
  const height = video.videoHeight;

  // 1. Bilder abtasten
  const step = clamp(duration / 140, 0.25, 1);
  const frames: FrameStats[] = [];
  const sw = 64;
  const sh = Math.max(1, Math.round((sw * height) / Math.max(1, width)));
  const small = document.createElement('canvas');
  small.width = sw; small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  const total = Math.floor(duration / step);
  for (let i = 0; i <= total; i++) {
    const t = Math.min(duration - 0.05, i * step + 0.02);
    await seek(video, t);
    sctx.drawImage(video, 0, 0, sw, sh);
    frames.push({ t, ...frameStats(sctx.getImageData(0, 0, sw, sh).data, sw, sh), thumb: snapshot(video, width, height, THUMB_W) });
    if (i % 4 === 0) onProgress((i / total) * 0.75, 'Szenen werden erkannt …');
  }

  // 2. Ton
  onProgress(0.8, 'Ton wird analysiert …');
  const loudness = await loudnessCurve(file).catch(() => [] as number[]);
  const speech = activeRanges(loudness, duration);

  // 3. Szenenwechsel + Abschnitte
  onProgress(0.92, 'Beste Momente werden bewertet …');
  const diffs = frames.map((f, i) => (i === 0 ? 0 : lumaDiff(frames[i - 1].luma, f.luma)));
  const mean = diffs.reduce((s, d) => s + d, 0) / Math.max(1, diffs.length);
  const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, diffs.length));
  const cutThreshold = Math.max(0.1, mean + 2.5 * sd);
  const cuts: number[] = [];
  diffs.forEach((d, i) => {
    if (d > cutThreshold && (!cuts.length || frames[i].t - cuts[cuts.length - 1] > 0.6)) cuts.push(frames[i].t);
  });

  // Grenzen: Szenenwechsel, max. 4 s je Abschnitt
  const bounds = [0, ...cuts, duration];
  const segments: Segment[] = [];
  for (let b = 0; b < bounds.length - 1; b++) {
    const s = bounds[b];
    const e = bounds[b + 1];
    const pieces = Math.max(1, Math.round((e - s) / 3.5));
    for (let p = 0; p < pieces; p++) {
      const a = s + ((e - s) * p) / pieces;
      const z = s + ((e - s) * (p + 1)) / pieces;
      if (z - a < 0.4) continue;
      segments.push(scoreSegment(a, z, frames, diffs, loudness, speech));
    }
  }
  normalizeScores(segments);

  const thumbs = pickEvenly(frames, 12).map((f) => f.thumb);
  const analysis: MediaAnalysis = { cuts, segments, speech, loudness };
  video.removeAttribute('src');
  video.load();
  onProgress(1, 'Fertig');
  return { duration, width, height, thumbs, analysis };
}

function frameStats(px: Uint8ClampedArray, w: number, h: number) {
  const luma = new Float32Array(w * h);
  let bright = 0;
  let color = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    luma[j] = y;
    bright += y;
    color += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  }
  let sharp = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      sharp += Math.abs(4 * luma[k] - luma[k - 1] - luma[k + 1] - luma[k - w] - luma[k + w]);
    }
  }
  const n = w * h;
  return { luma, brightness: bright / n, color: color / n, sharpness: sharp / Math.max(1, (w - 2) * (h - 2)) };
}

function lumaDiff(a: Float32Array, b: Float32Array) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}

function scoreSegment(start: number, end: number, frames: FrameStats[], diffs: number[], loudness: number[], speech: [number, number][]): Segment {
  const idx = frames.map((_, i) => i).filter((i) => frames[i].t >= start && frames[i].t < end);
  const pick = idx.length ? idx : [nearest(frames, (start + end) / 2)];
  const avg = (fn: (i: number) => number) => pick.reduce((s, i) => s + fn(i), 0) / pick.length;
  const motion = avg((i) => diffs[i]);
  const sharp = avg((i) => frames[i].sharpness);
  const color = avg((i) => frames[i].color);
  const bright = avg((i) => frames[i].brightness);
  const loud = loudness.length ? avgRange(loudness, start, end) : 0;
  const speechShare = overlap(speech, start, end) / (end - start);
  // Zu dunkel/überbelichtet wird abgewertet, Bewegung + Schärfe + Farbe aufgewertet
  const exposure = 1 - Math.min(1, Math.abs(bright - 0.5) * 2.2);
  const raw = motion * 6 + sharp * 4 + color * 1.2 + exposure * 0.8 + loud * 0.6;
  // Bild in der Mitte als Vorschau
  const mid = nearest(frames, (start + end) / 2);
  return { start, end, score: raw, motion, speech: speechShare > 0.5, thumb: frames[mid].thumb };
}

function normalizeScores(segments: Segment[]) {
  const max = Math.max(...segments.map((s) => s.score), 0.0001);
  const min = Math.min(...segments.map((s) => s.score));
  segments.forEach((s) => { s.score = max === min ? 0.6 : (s.score - min) / (max - min); });
}

const nearest = (frames: { t: number }[], t: number) =>
  frames.reduce((best, f, i) => (Math.abs(f.t - t) < Math.abs(frames[best].t - t) ? i : best), 0);

function pickEvenly<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * (list.length - 1)) / (n - 1))]);
}

/* ---------------- Ton ---------------- */

let audioCtx: AudioContext | null = null;
function decoder() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

async function decode(file: File): Promise<AudioBuffer> {
  const buf = await file.arrayBuffer();
  return decoder().decodeAudioData(buf);
}

/** Lautstärke (RMS) in 100-ms-Fenstern, normiert auf 0–1. */
async function loudnessCurve(file: File): Promise<number[]> {
  const audio = await decode(file);
  return rmsCurve(audio, 0.1);
}

function rmsCurve(audio: AudioBuffer, win: number) {
  const data = audio.getChannelData(0);
  const size = Math.round(audio.sampleRate * win);
  const out: number[] = [];
  for (let i = 0; i < data.length; i += size) {
    let s = 0;
    const end = Math.min(data.length, i + size);
    for (let j = i; j < end; j += 4) s += data[j] * data[j];
    out.push(Math.sqrt(s / Math.max(1, (end - i) / 4)));
  }
  const peak = percentile(out, 0.98) || 1;
  return out.map((v) => Math.min(1, v / peak));
}

/** Bereiche mit Ton (Sprache/Action) – Pausen dazwischen kann der Auto-Schnitt entfernen. */
export function activeRanges(loudness: number[], duration: number): [number, number][] {
  if (!loudness.length) return [];
  const floor = percentile(loudness, 0.15);
  const peak = percentile(loudness, 0.95);
  if (peak - floor < 0.08) return []; // durchgehend gleich laut (Musik/Rauschen) → keine Pausen
  const thr = floor + (peak - floor) * 0.22;
  const ranges: [number, number][] = [];
  let start = -1;
  loudness.forEach((v, i) => {
    if (v >= thr && start < 0) start = i;
    if ((v < thr || i === loudness.length - 1) && start >= 0) {
      ranges.push([start * 0.1, (i + 1) * 0.1]);
      start = -1;
    }
  });
  // Kurze Lücken (< 0,4 s) schließen, Mini-Geräusche verwerfen, etwas Luft lassen
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < 0.4) last[1] = r[1];
    else merged.push([...r]);
  }
  return merged
    .filter(([a, b]) => b - a >= 0.3)
    .map(([a, b]) => [Math.max(0, a - 0.12), Math.min(duration, b + 0.15)] as [number, number]);
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function avgRange(curve: number[], start: number, end: number) {
  const a = Math.floor(start * 10);
  const b = Math.max(a + 1, Math.ceil(end * 10));
  const slice = curve.slice(a, b);
  return slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : 0;
}

function overlap(ranges: [number, number][], start: number, end: number) {
  return ranges.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, end) - Math.max(a, start)), 0);
}

/* ---------------- Musik: Tempo & Beats ---------------- */

async function analyzeMusic(file: File, onProgress: Progress) {
  onProgress(0.1, 'Musik wird dekodiert …');
  const audio = await decode(file).catch(() => { throw new Error(`${file.name}: Audio konnte nicht gelesen werden.`); });
  onProgress(0.5, 'Takt wird erkannt …');
  const { bpm, beats } = detectBeats(audio);
  const loudness = rmsCurve(audio, 0.1);
  onProgress(1, 'Fertig');
  return {
    duration: audio.duration,
    width: 0,
    height: 0,
    thumbs: [],
    analysis: { cuts: [], segments: [], speech: [], loudness, bpm, beats } satisfies MediaAnalysis,
  };
}

/** Einfache Beat-Erkennung: Onset-Hüllkurve → Autokorrelation (70–180 BPM) → Phase. */
export function detectBeats(audio: AudioBuffer) {
  const data = audio.getChannelData(0);
  const hop = 512;
  const hopSec = hop / audio.sampleRate;
  const energy: number[] = [];
  for (let i = 0; i + hop < data.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j += 2) s += data[j] * data[j];
    energy.push(Math.log1p(s * 100));
  }
  const onset = energy.map((e, i) => (i === 0 ? 0 : Math.max(0, e - energy[i - 1])));

  let best = 0;
  let bestLag = Math.round(0.5 / hopSec);
  const minLag = Math.round(60 / 180 / hopSec);
  const maxLag = Math.round(60 / 70 / hopSec);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
    // leichte Bevorzugung von ~120 BPM
    const bpm = 60 / (lag * hopSec);
    s *= Math.exp(-((Math.log2(bpm / 120)) ** 2) * 0.5);
    if (s > best) { best = s; bestLag = lag; }
  }
  let bestPhase = 0;
  let phaseScore = -1;
  for (let p = 0; p < bestLag; p++) {
    let s = 0;
    for (let i = p; i < onset.length; i += bestLag) s += onset[i];
    if (s > phaseScore) { phaseScore = s; bestPhase = p; }
  }
  const beats: number[] = [];
  for (let i = bestPhase; i < onset.length; i += bestLag) beats.push(+(i * hopSec).toFixed(3));
  return { bpm: Math.round(60 / (bestLag * hopSec)), beats };
}

/* ---------------- Hilfen ---------------- */

function snapshot(src: CanvasImageSource, w: number, h: number, targetW: number) {
  const c = document.createElement('canvas');
  c.width = targetW;
  c.height = Math.max(1, Math.round((targetW * h) / Math.max(1, w)));
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}
