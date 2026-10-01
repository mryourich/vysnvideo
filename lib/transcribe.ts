/**
 * Auto-Untertitel: Spracherkennung mit Whisper direkt im Browser (transformers.js, WebGPU/WASM).
 * Das Modell (~80 MB) wird beim ersten Mal von Hugging Face geladen und danach vom Browser
 * zwischengespeichert. Audio verlässt das Gerät nicht.
 */
import { db } from './db';
import type { Clip, MediaAsset, Project, TextItem, Word } from './types';
import { text as makeText } from './generate';
import { layout } from './render';

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/+esm';
const MODEL = 'onnx-community/whisper-base_timestamped';

export type Language = 'german' | 'english' | 'auto';
export const LANGUAGES: Record<Language, string> = { german: 'Deutsch', english: 'Englisch', auto: 'Automatisch' };

const WORKER_SRC = `
let asr = null;
let device = null;
async function load(post) {
  const { pipeline, env } = await import('${LIB}');
  env.allowLocalModels = false;
  const progress_callback = (p) => { if (p.status === 'progress') post({ type: 'download', file: p.file, loaded: p.loaded, total: p.total }); };
  const tryLoad = (dev) => pipeline('automatic-speech-recognition', '${MODEL}', {
    device: dev,
    dtype: dev === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
    progress_callback,
  });
  let gpu = null;
  try { gpu = self.navigator && self.navigator.gpu ? await self.navigator.gpu.requestAdapter() : null; } catch (e) { gpu = null; }
  if (gpu) {
    try { asr = await tryLoad('webgpu'); device = 'webgpu'; return; } catch (e) { /* zurück auf WASM */ }
  }
  asr = await tryLoad('wasm');
  device = 'wasm';
}
self.onmessage = async (e) => {
  const { id, audio, language } = e.data;
  const post = (m) => self.postMessage({ id, ...m });
  try {
    if (!asr) { post({ type: 'status', label: 'KI-Modell wird geladen …' }); await load(post); }
    post({ type: 'status', label: 'Sprache wird erkannt (' + device + ') …' });
    const opts = { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 };
    if (language !== 'auto') { opts.language = language; opts.task = 'transcribe'; }
    const out = await asr(audio, opts);
    post({ type: 'done', chunks: out.chunks || [], text: out.text || '' });
  } catch (err) {
    post({ type: 'error', message: String((err && err.message) || err) });
  }
};`;

let worker: Worker | null = null;
let seq = 0;
function getWorker() {
  if (!worker) {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    worker = new Worker(url, { type: 'module' });
  }
  return worker;
}

export type Progress = (label: string, ratio?: number) => void;

/** Audio auf 16 kHz Mono umrechnen (Format, das Whisper erwartet). */
async function audio16k(blob: Blob): Promise<Float32Array | null> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const length = Math.ceil(decoded.duration * 16000);
    const off = new OfflineAudioContext(1, length, 16000);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return rendered.getChannelData(0);
  } catch {
    return null;
  } finally {
    ctx.close();
  }
}

function run(audio: Float32Array, language: Language, onProgress: Progress): Promise<Word[]> {
  const w = getWorker();
  const id = ++seq;
  const files = new Map<string, [number, number]>();
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'download') {
        files.set(m.file, [m.loaded, m.total]);
        const [l, t] = [...files.values()].reduce((s, [a, b]) => [s[0] + a, s[1] + b], [0, 0]);
        onProgress(`KI-Modell wird geladen … ${Math.round(l / 1e6)} / ${Math.round(t / 1e6)} MB`, t ? l / t : undefined);
      } else if (m.type === 'status') onProgress(m.label);
      else if (m.type === 'done') {
        w.removeEventListener('message', onMessage);
        resolve((m.chunks as { text: string; timestamp: [number, number | null] }[])
          .map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }))
          .filter((x) => x.text));
      } else if (m.type === 'error') {
        w.removeEventListener('message', onMessage);
        reject(new Error(m.message));
      }
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, audio, language }, [audio.buffer]);
  });
}

/** Wörter eines Videos erkennen (Ergebnis wird am Medium gespeichert). */
export async function transcribeAsset(asset: MediaAsset, language: Language, onProgress: Progress): Promise<Word[]> {
  if (asset.transcript && asset.transcriptLanguage === language) return asset.transcript;
  const blob = await db.getBlob(asset.id);
  if (!blob) throw new Error('Datei nicht gefunden.');
  onProgress('Ton wird vorbereitet …');
  const audio = await audio16k(blob);
  if (!audio) return [];
  const words = await run(audio, language, onProgress);
  asset.transcript = words;
  asset.transcriptLanguage = language;
  await db.saveAsset(asset);
  return words;
}

/**
 * Untertitel für das ganze Projekt: erkennt die Sprache aller Video-Clips und legt
 * Karaoke-Untertitel (2–4 Wörter, wortgenau) auf die Timeline.
 */
export async function autoCaptions(
  project: Project,
  assets: Map<string, MediaAsset>,
  opts: { language: Language; anim: TextItem['anim']; style: TextItem['style']; accent: string; upper: boolean },
  onProgress: Progress,
): Promise<TextItem[]> {
  const timeline = layout(project);
  const videoIds = [...new Set(project.clips.map((c) => c.assetId))].filter((id) => assets.get(id)?.kind === 'video' && (project.clips.find((c) => c.assetId === id)?.volume ?? 1) > 0);
  const byAsset = new Map<string, Word[]>();
  for (let i = 0; i < videoIds.length; i++) {
    const asset = assets.get(videoIds[i])!;
    const words = await transcribeAsset(asset, opts.language, (label, r) => onProgress(videoIds.length > 1 ? `${label} (Video ${i + 1}/${videoIds.length})` : label, r));
    byAsset.set(asset.id, words);
  }

  // Wörter auf die Timeline übertragen
  const placed: Word[] = [];
  for (const c of timeline) {
    const words = byAsset.get(c.clip.assetId);
    if (!words || c.clip.volume === 0) continue;
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid < c.clip.in || mid >= c.clip.out) continue;
      placed.push({ text: w.text, start: toTimeline(c.clip, c.start, w.start), end: toTimeline(c.clip, c.start, Math.min(w.end, c.clip.out)) });
    }
  }
  return groupWords(placed, opts);
}

const toTimeline = (clip: Clip, start: number, t: number) => +(start + (Math.max(t, clip.in) - clip.in) / clip.speed).toFixed(3);

/** 2–4 Wörter je Einblendung, Umbruch bei Satzzeichen und Pausen. */
function groupWords(words: Word[], opts: { anim: TextItem['anim']; style: TextItem['style']; accent: string; upper: boolean }): TextItem[] {
  const items: TextItem[] = [];
  let group: Word[] = [];
  const flush = () => {
    if (!group.length) return;
    const text = group.map((w) => w.text).join(' ');
    const item = makeText(opts.upper ? text.toUpperCase() : text, group[0].start, group[group.length - 1].end + 0.15, 0.5, 0.72, opts.style, opts.anim, opts.accent);
    item.words = group.map((w) => ({ ...w, text: opts.upper ? w.text.toUpperCase() : w.text }));
    items.push(item);
    group = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (group.length && (w.start - prev.end > 0.6 || group.length >= 4 || (group.length >= 2 && /[,;:]$/.test(prev.text)))) flush();
    group.push(w);
    if (/[.!?]$/.test(w.text)) flush();
  });
  flush();
  // Überlappungen vermeiden
  for (let i = 0; i < items.length - 1; i++) if (items[i].end > items[i + 1].start) items[i].end = items[i + 1].start;
  return items;
}
