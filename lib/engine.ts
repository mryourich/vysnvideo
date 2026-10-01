/**
 * Player & Export: verwaltet Video-/Bild-/Audio-Elemente, synchronisiert sie mit der
 * Timeline, zeichnet die Vorschau und nimmt beim Export Bild + Ton per MediaRecorder auf.
 */
import { assetUrl } from './db';
import { FORMATS } from './types';
import type { MediaAsset, Project } from './types';
import { clipAt, drawFrame, layout, sourceTime, TRANSITION_TIME } from './render';
import type { HitBox, Source, Timed } from './render';
import { clamp, once, seek } from './util';

type Pooled = { el: HTMLVideoElement; gain: GainNode | null };

export type ExportOptions = { height: 720 | 1080; fps: 30 | 60; onProgress: (p: number) => void; signal?: AbortSignal };

export function exportMime(): { mime: string; ext: 'mp4' | 'webm' } {
  const options: [string, 'mp4' | 'webm'][] = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,mp4a.40.2', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
    ['video/mp4', 'mp4'],
  ];
  for (const [mime, ext] of options) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return { mime: '', ext: 'webm' };
}

export class Player {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private project: Project | null = null;
  private assets = new Map<string, MediaAsset>();
  private timeline: Timed[] = [];
  private pools = new Map<string, Pooled[]>();
  private images = new Map<string, HTMLImageElement>();
  private music: HTMLAudioElement | null = null;
  private musicGain: GainNode | null = null;
  private logo: HTMLImageElement | null = null;
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private speakers: GainNode | null = null;
  private raf = 0;
  private dirty = true;
  private startWall = 0;
  private startT = 0;
  private exportTarget: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

  t = 0;
  playing = false;
  hitBoxes: HitBox[] = [];
  selectedText: string | null = null;
  onTime: (t: number, playing: boolean) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    const loop = () => {
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  get duration() {
    return this.timeline.length ? this.timeline[this.timeline.length - 1].end : 0;
  }

  /** Projekt (neu) setzen – Elemente werden nur für neue Medien angelegt. */
  async setProject(project: Project, assets: MediaAsset[]) {
    this.project = project;
    assets.forEach((a) => this.assets.set(a.id, a));
    this.timeline = layout(project);
    this.resize();
    const needed = new Set(project.clips.map((c) => c.assetId));
    await Promise.all([...needed].map((id) => this.ensure(id)));
    if (project.music) await this.ensureMusic(project.music.assetId);
    else if (this.music) { this.music.pause(); this.music = null; }
    if (project.logo && this.logo?.src !== project.logo) {
      const img = new Image();
      img.src = project.logo;
      this.logo = img;
      img.onload = () => this.invalidate();
    }
    if (this.t > this.duration) this.t = this.duration;
    this.invalidate();
  }

  /** Vorschau-Auflösung an Format anpassen (max. 960 px Höhe). */
  private resize() {
    if (!this.project) return;
    const f = FORMATS[this.project.format];
    const scale = Math.min(1, 960 / f.h, 960 / f.w);
    const w = Math.round(f.w * scale);
    const h = Math.round(f.h * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private async ensure(assetId: string) {
    const asset = this.assets.get(assetId);
    if (!asset) return;
    const url = await assetUrl(assetId);
    if (!url) return;
    if (asset.kind === 'image' && !this.images.has(assetId)) {
      const img = new Image();
      img.src = url;
      this.images.set(assetId, img);
      img.onload = () => this.invalidate();
    }
    if (asset.kind === 'video' && !this.pools.has(assetId)) {
      const pool: Pooled[] = [0, 1].map(() => {
        const el = document.createElement('video');
        el.src = url;
        el.preload = 'auto';
        el.playsInline = true;
        el.crossOrigin = 'anonymous';
        el.addEventListener('seeked', () => this.invalidate());
        el.addEventListener('loadeddata', () => this.invalidate());
        return { el, gain: null };
      });
      this.pools.set(assetId, pool);
      if (this.audio) pool.forEach((p) => this.connect(p));
    }
  }

  private async ensureMusic(assetId: string) {
    const url = await assetUrl(assetId);
    if (!url) return;
    if (this.music?.dataset.asset === assetId) return;
    this.music?.pause();
    const el = new Audio(url);
    el.preload = 'auto';
    el.dataset.asset = assetId;
    this.music = el;
    this.musicGain = null;
    if (this.audio) this.connectMusic();
  }

  /** WebAudio erst beim ersten Abspielen anlegen (Browser verlangen eine Nutzeraktion). */
  private initAudio() {
    if (this.audio) return;
    this.audio = new AudioContext();
    this.master = this.audio.createGain();
    this.speakers = this.audio.createGain();
    this.master.connect(this.speakers);
    this.speakers.connect(this.audio.destination);
    this.pools.forEach((pool) => pool.forEach((p) => this.connect(p)));
    this.connectMusic();
  }

  private connect(p: Pooled) {
    if (!this.audio || p.gain) return;
    const src = this.audio.createMediaElementSource(p.el);
    p.gain = this.audio.createGain();
    p.gain.gain.value = 0;
    src.connect(p.gain).connect(this.master!);
  }

  private connectMusic() {
    if (!this.audio || !this.music || this.musicGain) return;
    const src = this.audio.createMediaElementSource(this.music);
    this.musicGain = this.audio.createGain();
    src.connect(this.musicGain).connect(this.master!);
  }

  private elementFor(c: Timed): HTMLVideoElement | null {
    const pool = this.pools.get(c.clip.assetId);
    return pool ? pool[c.index % 2].el : null;
  }

  private source = (index: number): Source => {
    const c = this.timeline[index];
    if (!c) return null;
    const img = this.images.get(c.clip.assetId);
    if (img) return img.complete && img.naturalWidth ? { el: img, w: img.naturalWidth, h: img.naturalHeight } : null;
    const el = this.elementFor(c);
    return el && el.readyState >= 2 ? { el, w: el.videoWidth, h: el.videoHeight } : null;
  };

  invalidate() {
    this.dirty = true;
  }

  async play() {
    if (!this.project || !this.duration) return;
    this.initAudio();
    await this.audio!.resume();
    if (this.t >= this.duration - 0.05) this.t = 0;
    this.startT = this.t;
    this.startWall = performance.now();
    this.playing = true;
    if (this.music && this.project.music) {
      this.music.currentTime = this.project.music.offset + this.t;
      this.music.play().catch(() => {});
    }
  }

  pause() {
    this.playing = false;
    this.pools.forEach((pool) => pool.forEach((p) => p.el.pause()));
    this.music?.pause();
    this.invalidate();
    this.onTime(this.t, false);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    this.t = clamp(t, 0, this.duration);
    if (this.playing) {
      this.startT = this.t;
      this.startWall = performance.now();
      this.pools.forEach((pool) => pool.forEach((p) => p.el.pause()));
      if (this.music && this.project?.music) this.music.currentTime = this.project.music.offset + this.t;
    }
    this.invalidate();
    this.onTime(this.t, this.playing);
  }

  private tick() {
    if (!this.project) return;
    if (this.playing) {
      this.t = this.startT + (performance.now() - this.startWall) / 1000;
      if (this.t >= this.duration) {
        this.t = this.duration;
        this.pause();
        this.onEnded?.();
      }
    }
    if (!this.playing && !this.dirty) return;
    this.dirty = false;
    this.sync();
    const target = this.exportTarget || { canvas: this.canvas, ctx: this.ctx };
    this.hitBoxes = drawFrame(target.ctx, target.canvas.width, target.canvas.height, {
      project: this.project,
      timeline: this.timeline,
      t: this.t,
      source: this.source,
      logo: this.logo,
      selectedText: this.exportTarget ? null : this.selectedText,
    });
    if (this.exportTarget) this.ctx.drawImage(this.exportTarget.canvas, 0, 0, this.canvas.width, this.canvas.height);
    if (this.playing) this.onTime(this.t, true);
  }

  private onEnded: (() => void) | null = null;

  /** Video-Elemente an die Timeline-Zeit anpassen. */
  private sync() {
    const cur = clipAt(this.timeline, this.t);
    if (!cur || !this.project) return;
    const active = new Set<HTMLVideoElement>();
    const el = this.elementFor(cur);
    const want = sourceTime(cur, this.t);
    const music = this.project.music;

    if (el) {
      active.add(el);
      if (this.playing) {
        el.playbackRate = cur.clip.speed;
        if (Math.abs(el.currentTime - want) > 0.3 || el.ended) el.currentTime = want;
        if (el.paused) el.play().catch(() => {});
      } else if (Math.abs(el.currentTime - want) > 0.02 && !el.seeking) {
        el.currentTime = want;
      }
      const pool = this.pools.get(cur.clip.assetId)!;
      const g = pool[cur.index % 2].gain;
      if (g) g.gain.value = this.playing ? cur.clip.volume : 0;
    }

    // Vorheriger Clip während des Übergangs: auf letztem Bild stehen lassen
    const prev = cur.index > 0 ? this.timeline[cur.index - 1] : null;
    if (prev && cur.clip.transition !== 'none' && this.t - cur.start < TRANSITION_TIME) {
      const pel = this.elementFor(prev);
      if (pel && pel !== el) {
        active.add(pel);
        if (!pel.paused) pel.pause();
        const end = Math.max(prev.clip.in, prev.clip.out - 0.04);
        if (Math.abs(pel.currentTime - end) > 0.05 && !pel.seeking) pel.currentTime = end;
      }
    }

    // Nächsten Clip vorbereiten
    const next = this.timeline[cur.index + 1];
    if (next && cur.end - this.t < 1.5) {
      const nel = this.elementFor(next);
      if (nel && nel !== el && !active.has(nel)) {
        active.add(nel);
        if (!nel.paused) nel.pause();
        if (Math.abs(nel.currentTime - next.clip.in) > 0.05 && !nel.seeking) nel.currentTime = next.clip.in;
      }
    }

    this.pools.forEach((pool) => pool.forEach((p) => {
      if (!active.has(p.el)) {
        if (!p.el.paused) p.el.pause();
        if (p.gain) p.gain.gain.value = 0;
      } else if (p.el !== el && p.gain) p.gain.gain.value = 0;
    }));

    // Musik: Lautstärke, Ducking, Ausblenden
    if (this.music && music && this.musicGain) {
      let v = music.volume;
      if (music.ducking && cur.clip.volume > 0 && this.assets.get(cur.clip.assetId)?.kind === 'video') v *= 0.35;
      if (music.fadeOut) v *= clamp((this.duration - this.t) / 1.5, 0, 1);
      this.musicGain.gain.value = v;
      const mt = music.offset + this.t;
      if (this.playing && Math.abs(this.music.currentTime - mt) > 0.35 && mt < this.music.duration) this.music.currentTime = mt;
    }
  }

  /** Einzelbild an Position t (für Vorschaubild des Projekts) */
  async snapshot(t: number, width = 320): Promise<string> {
    this.seek(t);
    const cur = clipAt(this.timeline, t);
    const el = cur && this.elementFor(cur);
    if (el) await seek(el, sourceTime(cur!, t)).catch(() => {});
    this.dirty = true;
    this.tick();
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round((width * this.canvas.height) / this.canvas.width);
    c.getContext('2d')!.drawImage(this.canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  }

  /** Export in Echtzeit: Canvas + Ton werden aufgenommen. */
  async export(opts: ExportOptions): Promise<{ blob: Blob; ext: string }> {
    if (!this.project || !this.duration) throw new Error('Das Projekt ist leer.');
    this.pause();
    this.initAudio();
    await this.audio!.resume();
    const f = FORMATS[this.project.format];
    const scale = opts.height / Math.min(f.w, f.h);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((f.w * scale) / 2) * 2;
    canvas.height = Math.round((f.h * scale) / 2) * 2;
    this.exportTarget = { canvas, ctx: canvas.getContext('2d')! };

    // Alle Clips am Anfang bereitstellen
    this.seek(0);
    const first = this.timeline[0];
    const el = first && this.elementFor(first);
    if (el) {
      if (el.readyState < 2) await once(el, 'loadeddata').catch(() => {});
      await seek(el, first.clip.in).catch(() => {});
    }
    await Promise.all([...this.images.values()].map((i) => i.decode().catch(() => {})));

    const { mime, ext } = exportMime();
    const stream = canvas.captureStream(opts.fps);
    const dest = this.audio!.createMediaStreamDestination();
    this.master!.connect(dest);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    this.speakers!.gain.value = 0;

    const recorder = new MediaRecorder(stream, {
      mimeType: mime || undefined,
      videoBitsPerSecond: opts.height >= 1080 ? 10_000_000 : 5_000_000,
      audioBitsPerSecond: 192_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => { recorder.onstop = () => r(); });

    const cleanup = () => {
      this.exportTarget = null;
      this.onEnded = null;
      this.speakers!.gain.value = 1;
      try { this.master!.disconnect(dest); } catch { /* bereits getrennt */ }
      stream.getTracks().forEach((tr) => tr.stop());
      this.invalidate();
    };

    let aborted = false;
    const progress = window.setInterval(() => opts.onProgress(clamp(this.t / this.duration, 0, 1)), 200);
    const done = new Promise<void>((resolve) => {
      this.onEnded = () => resolve();
      opts.signal?.addEventListener('abort', () => { aborted = true; this.pause(); resolve(); });
    });

    recorder.start(500);
    await this.play();
    await done;
    // letztes Bild noch kurz aufnehmen
    await new Promise((r) => setTimeout(r, 250));
    recorder.stop();
    await stopped;
    clearInterval(progress);
    cleanup();
    if (aborted) throw new DOMException('Export abgebrochen', 'AbortError');
    opts.onProgress(1);
    return { blob: new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] }), ext };
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.pause();
    this.pools.forEach((pool) => pool.forEach((p) => { p.el.removeAttribute('src'); p.el.load(); }));
    this.pools.clear();
    this.audio?.close();
  }
}
