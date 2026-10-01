'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, Download, FolderOpen, Pause, Play, Redo2, SkipBack, SlidersHorizontal, Sparkles, Type, Undo2, Wand2 } from 'lucide-react';
import { Brand } from '../brand';
import { Timeline } from './timeline';
import type { Selection } from './timeline';
import { Inspector } from './inspector';
import { AiPanel, EffectsPanel, MediaPanel, TextPresets } from './panels';
import type { CaptionOptions } from './panels';
import { ExportDialog } from './export-dialog';
import { Player } from '../../lib/engine';
import { db } from '../../lib/db';
import { requestEffects, requestPlan } from '../../lib/ai';
import { autoCaptions } from '../../lib/transcribe';
import type { Language } from '../../lib/transcribe';
import { storage } from '../../lib/browser';
import { applyAiEffects, applyAutoEffects, buildTexts, captionsFromScript, DEFAULT_BRIEF, generateProject, isTalking, newClip, projectDuration, removeSilence, shortlist, snapToBeats, text as makeText } from '../../lib/generate';
import type { Candidate } from '../../lib/generate';
import { layout } from '../../lib/render';
import { STYLES } from '../../lib/types';
import type { Effect, MediaAsset, Project, Style, TextItem, Transition } from '../../lib/types';
import { clamp, now, timecode, uid } from '../../lib/util';

type LeftTab = 'media' | 'text' | 'effects' | 'ai';
type MobilePanel = LeftTab | 'inspect' | null;

export function Editor() {
  const params = useSearchParams();
  const id = params?.get('id') || '';
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Map<string, MediaAsset>>(new Map());
  const [missing, setMissing] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<LeftTab>('media');
  const [mobile, setMobile] = useState<MobilePanel>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState(true);

  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<Player | null>(null);
  const undo = useRef<Project[]>([]);
  const redo = useRef<Project[]>([]);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const [, force] = useState(0);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  /* ---------- Laden ---------- */
  useEffect(() => {
    if (!id) { setMissing(true); return; }
    (async () => {
      const p = await db.getProject(id);
      if (!p) { setMissing(true); return; }
      const all = await db.listAssets();
      setAssets(new Map(all.map((a) => [a.id, a])));
      setProject(p);
      const note = storage.take<string | null>('vv-note', null);
      if (note) notify(note);
      else if (params?.get('ai')) notify('✨ Von der KI-Regie geschnitten – jetzt nach Wunsch anpassen.');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ---------- Player ---------- */
  useEffect(() => {
    if (!canvas.current || player.current) return;
    const p = new Player(canvas.current);
    p.onTime = (t, pl) => { setTime(t); setPlaying(pl); };
    player.current = p;
    return () => { p.destroy(); player.current = null; };
  }, []);

  useEffect(() => {
    if (project && player.current) player.current.setProject(project, [...assets.values()]);
  }, [project, assets]);

  useEffect(() => {
    if (!player.current) return;
    player.current.selectedText = selection?.type === 'text' ? selection.id : null;
    player.current.invalidate();
  }, [selection]);

  /* ---------- Speichern ---------- */
  useEffect(() => {
    if (!project) return;
    setSaved(false);
    const t = window.setTimeout(() => {
      db.saveProject({ ...project, updatedAt: now() }).then(() => setSaved(true));
    }, 600);
    return () => clearTimeout(t);
  }, [project]);

  /* ---------- Änderungen mit Undo ---------- */
  const commit = useCallback((next: Project, key?: string) => {
    setProject((prev) => {
      if (!prev) return next;
      const t = Date.now();
      const merge = key && lastKey.current?.key === key && t - lastKey.current.at < 1200;
      if (!merge) {
        undo.current.push(prev);
        if (undo.current.length > 100) undo.current.shift();
      }
      redo.current = [];
      lastKey.current = key ? { key, at: t } : null;
      return next;
    });
    force((n) => n + 1);
  }, []);

  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev || !project) return;
    redo.current.push(project);
    lastKey.current = null;
    setProject(prev);
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next || !project) return;
    undo.current.push(project);
    lastKey.current = null;
    setProject(next);
  };

  const duration = project ? projectDuration(project) : 0;
  const seek = (t: number) => { player.current?.seek(t); setTime(clamp(t, 0, duration)); };

  /* ---------- Werkzeuge ---------- */
  const timeline = useMemo(() => (project ? layout(project) : []), [project]);

  function split() {
    if (!project) return;
    const cur = timeline.find((c) => time > c.start + 0.1 && time < c.end - 0.1);
    if (!cur) return notify('Abspielkopf auf einen Clip setzen, um zu teilen.');
    const cut = cur.clip.in + (time - cur.start) * cur.clip.speed;
    const a = { ...cur.clip, out: cut };
    const b = { ...cur.clip, id: uid(), in: cut, transition: 'none' as const };
    const clips = [...project.clips];
    clips.splice(cur.index, 1, a, b);
    commit({ ...project, clips });
    setSelection({ type: 'clip', id: b.id });
  }

  function remove() {
    if (!project || !selection) return;
    if (selection.type === 'clip') {
      const old = duration;
      const next = { ...project, clips: project.clips.filter((c) => c.id !== selection.id) };
      if (next.clips[0]) next.clips[0] = { ...next.clips[0], transition: 'none' };
      commit(retime(next, old));
    } else if (selection.type === 'text') commit({ ...project, texts: project.texts.filter((t) => t.id !== selection.id) });
    else commit({ ...project, music: null });
    setSelection(null);
  }

  function duplicate() {
    if (!project || !selection) return;
    if (selection.type === 'clip') {
      const i = project.clips.findIndex((c) => c.id === selection.id);
      if (i < 0) return;
      const copy = { ...project.clips[i], id: uid() };
      const clips = [...project.clips];
      clips.splice(i + 1, 0, copy);
      commit({ ...project, clips });
      setSelection({ type: 'clip', id: copy.id });
    } else if (selection.type === 'text') {
      const t = project.texts.find((x) => x.id === selection.id);
      if (!t) return;
      const len = t.end - t.start;
      const copy = { ...t, id: uid(), start: Math.min(t.end, Math.max(0, duration - len)), end: Math.min(duration, t.end + len) };
      commit({ ...project, texts: [...project.texts, copy] });
      setSelection({ type: 'text', id: copy.id });
    }
  }

  function addText(style: TextItem['style'] = 'title') {
    if (!project) return;
    const samples: Record<TextItem['style'], string> = { hook: 'Dein Hook hier', title: 'Titel', caption: 'Dein Untertitel', cta: 'Jetzt kaufen', label: 'Hinweis', price: '49 €', neon: 'Neon' };
    const start = duration ? Math.min(time, Math.max(0, duration - 1)) : 0;
    const y = style === 'cta' ? 0.8 : style === 'caption' ? 0.74 : style === 'hook' ? 0.2 : 0.45;
    const item = makeText(samples[style], start, Math.max(start + 1, Math.min(duration || 3, start + 2.5)), 0.5, y, style, style === 'cta' ? 'pop' : 'fade', project.brandColor);
    commit({ ...project, texts: [...project.texts, item] });
    setSelection({ type: 'text', id: item.id });
    setMobile('inspect');
  }

  function addClip(asset: MediaAsset) {
    if (!project) return;
    const clip = newClip(asset, 0, asset.kind === 'image' ? 3 : Math.min(asset.duration, 8));
    const i = selection?.type === 'clip' ? project.clips.findIndex((c) => c.id === selection.id) : -1;
    const clips = [...project.clips];
    clips.splice(i >= 0 ? i + 1 : clips.length, 0, clip);
    commit({ ...project, clips, library: project.library.includes(asset.id) ? project.library : [...project.library, asset.id] });
    setSelection({ type: 'clip', id: clip.id });
    notify(`„${asset.name}“ hinzugefügt`);
  }

  function imported(asset: MediaAsset) {
    setAssets((m) => new Map(m).set(asset.id, asset));
    if (!project) return;
    const next = { ...project, library: [...project.library, asset.id] };
    if (asset.kind === 'audio' && !project.music) {
      next.music = { assetId: asset.id, volume: 0.8, offset: 0, fadeOut: true, ducking: project.clips.some((c) => isTalking(assets.get(c.assetId)!)) };
      notify('Musik hinzugefügt – Tipp: „Im Takt schneiden“ unter KI.');
    }
    commit(next);
  }

  function applyMusic(asset: MediaAsset) {
    if (!project) return;
    commit({ ...project, music: { assetId: asset.id, volume: project.music?.volume ?? 0.8, offset: 0, fadeOut: true, ducking: project.music?.ducking ?? false } });
    setSelection({ type: 'music', id: asset.id });
  }

  function removeSilenceIn(clipIds: string[]) {
    if (!project) return;
    const old = duration;
    const clips = project.clips.flatMap((c) => {
      const a = assets.get(c.assetId);
      return clipIds.includes(c.id) && a ? removeSilence(c, a) : [c];
    });
    const next = retime({ ...project, clips }, old);
    const saved = old - projectDuration(next);
    if (saved < 0.05) return notify('Keine Pausen gefunden.');
    commit(next);
    notify(`${saved.toFixed(1)} s Pausen entfernt.`);
  }

  function snapBeats() {
    if (!project?.music) return;
    const music = assets.get(project.music.assetId);
    if (!music?.analysis?.beats?.length) return notify('In der Musik wurden keine Beats erkannt.');
    const old = duration;
    commit(retime({ ...project, clips: snapToBeats(project, music) }, old));
    notify(`Schnitte auf ${music.analysis.bpm} BPM ausgerichtet.`);
  }

  function shorten(target: number) {
    if (!project || duration <= target) return notify(`Das Video ist schon kürzer als ${target} s.`);
    const old = duration;
    const scoreOf = (i: number) => {
      const c = project.clips[i];
      const a = assets.get(c.assetId);
      const mid = (c.in + c.out) / 2;
      return a?.analysis?.segments.find((s) => mid >= s.start && mid <= s.end)?.score ?? 0.55;
    };
    // Erster Clip (Hook) bleibt, schwächste fliegen raus
    let keep = project.clips.map((c, i) => ({ c, i, s: i === 0 ? 2 : scoreOf(i) }));
    const len = (list: typeof keep) => list.reduce((s, x) => s + (x.c.out - x.c.in) / x.c.speed, 0);
    while (keep.length > 1 && len(keep) > target) {
      const worst = keep.reduce((w, x) => (x.s < w.s ? x : w), keep[0]);
      if (len(keep) - (worst.c.out - worst.c.in) / worst.c.speed < target * 0.8) break;
      keep = keep.filter((x) => x !== worst);
    }
    let clips = keep.map((x) => x.c);
    // Rest gleichmäßig kürzen
    const over = len(keep) - target;
    if (over > 0.05) {
      const f = target / len(keep);
      clips = clips.map((c) => ({ ...c, out: c.in + (c.out - c.in) * f }));
    }
    commit(retime({ ...project, clips }, old));
    notify(`Auf ${target} s gekürzt.`);
  }

  async function regenerate(style: Style) {
    if (!project) return;
    const lib = project.library.map((i) => assets.get(i)).filter(Boolean) as MediaAsset[];
    const brief = { ...DEFAULT_BRIEF, ...project.brief, style, format: project.format };
    setBusy('Video wird neu geschnitten …');
    let plan = null;
    let list: Candidate[] | undefined;
    if (brief.useAi && !lib.some(isTalking)) {
      setBusy('KI-Regie wählt die besten Szenen …');
      list = shortlist(lib);
      const res = await requestPlan(brief, list, lib);
      plan = res.plan;
      if (res.note) notify(res.note);
    }
    const next = generateProject(lib, brief, { ai: plan, shortlist: list, logo: project.logo });
    commit({ ...next, id: project.id, name: project.name, watermark: project.watermark, brandColor: project.brandColor, createdAt: project.createdAt, thumb: project.thumb, library: project.library });
    setBusy(null);
    setSelection(null);
    seek(0);
    notify(`Neu geschnitten im Stil „${STYLES[style].label}“.`);
  }

  async function rewriteTexts() {
    if (!project) return;
    const brief = { ...DEFAULT_BRIEF, ...project.brief, format: project.format };
    const list: Candidate[] = timeline.slice(0, 16).map((c) => {
      const a = assets.get(c.clip.assetId)!;
      const mid = (c.clip.in + c.clip.out) / 2;
      const seg = a.analysis?.segments.find((s) => mid >= s.start && mid <= s.end);
      return { assetId: a.id, start: c.clip.in, end: c.clip.out, score: seg?.score ?? 0.5, thumb: seg?.thumb || a.thumbs[0], image: a.kind === 'image' };
    }).filter((c) => c.thumb);
    if (!list.length) return;
    setBusy('KI schreibt Texte …');
    const res = await requestPlan(brief, list, [...assets.values()]);
    setBusy(null);
    if (!res.plan) return notify(res.note || 'KI nicht erreichbar.');
    const anims = STYLES[brief.style].anims;
    const texts = buildTexts(brief, duration, res.plan, anims).map((t) => ({ ...t, accent: project.brandColor }));
    commit({ ...project, texts });
    notify('✨ Neue Texte von der KI.');
  }

  function scriptCaptions(script: string) {
    if (!project) return;
    const items = captionsFromScript(script, project, [...assets.values()]).map((t) => ({ ...t, accent: project.brandColor }));
    if (!items.length) return;
    commit({ ...project, texts: [...project.texts.filter((t) => t.style !== 'caption'), ...items] });
    notify(`${items.length} Untertitel erzeugt.`);
  }

  /* ---------- Effekte & KI ---------- */
  const currentClip = project
    ? (selection?.type === 'clip' ? project.clips.find((c) => c.id === selection.id) : null)
      || timeline.find((c) => time >= c.start && time < c.end)?.clip
      || null
    : null;

  function applyEffect(effect: Effect, all: boolean) {
    if (!project) return;
    const target = all ? null : currentClip?.id;
    if (!all && !target) return notify('Erst einen Clip auswählen.');
    commit({ ...project, clips: project.clips.map((c) => (all || c.id === target ? { ...c, effect, effectAmount: c.effectAmount ?? 0.7 } : c)) });
    if (!all && target) setSelection({ type: 'clip', id: target });
    if (!playing) player.current?.play();
  }

  function applyTransition(transition: Transition, all: boolean) {
    if (!project) return;
    const target = all ? null : currentClip?.id;
    if (!all && !target) return notify('Erst einen Clip auswählen.');
    const clips = project.clips.map((c, i) => (i > 0 && (all || c.id === target) ? { ...c, transition } : c));
    commit({ ...project, clips });
    const at = timeline.find((c) => c.clip.id === (target || project.clips[1]?.id));
    if (at) { seek(Math.max(0, at.start - 0.6)); player.current?.play(); }
  }

  async function aiEffects() {
    if (!project) return;
    const lib = [...assets.values()];
    const brief = { ...DEFAULT_BRIEF, ...project.brief, format: project.format };
    const music = project.music ? assets.get(project.music.assetId) : null;
    setBusy('KI wählt Effekte …');
    const frames = timeline.slice(0, 24).map((c) => {
      const a = assets.get(c.clip.assetId)!;
      const mid = (c.clip.in + c.clip.out) / 2;
      const seg = a.analysis?.segments.find((s) => mid >= s.start && mid <= s.end);
      const maxMotion = Math.max(...(a.analysis?.segments.map((s) => s.motion) || [0]), 0.0001);
      return {
        thumb: seg?.thumb || a.thumbs[0] || '',
        length: c.end - c.start,
        source: a.kind === 'image' ? 'Foto' : 'Video',
        motion: seg ? seg.motion / maxMotion : 0,
        speech: !!a.analysis?.speech.some(([x, y]) => x < c.clip.out && y > c.clip.in) && isTalking(a),
      };
    });
    const res = frames.every((f) => f.thumb) ? await requestEffects(brief, frames, music?.analysis?.bpm ?? null) : { effects: null, note: null };
    let clips;
    if (res.effects?.clips?.length) {
      clips = applyAiEffects(project.clips, res.effects);
      notify('✨ KI-Effekte gesetzt (Claude).');
    } else {
      clips = applyAutoEffects(project.clips.map((c) => ({ ...c })), lib, brief.style);
      notify('✨ Auto-Effekte gesetzt' + (res.note ? ' (lokale Automatik)' : '') + '.');
    }
    commit({ ...project, clips });
    setBusy(null);
    seek(0);
    player.current?.play();
  }

  async function captions(o: CaptionOptions) {
    if (!project) return;
    setBusy('Spracherkennung startet …');
    try {
      const items = await autoCaptions(project, assets, { ...o, accent: project.brandColor }, (label, r) => setBusy(r !== undefined ? `${label} (${Math.round(r * 100)} %)` : label));
      setAssets((m) => new Map(m));
      if (!items.length) notify('Keine Sprache erkannt.');
      else {
        commit({ ...project, texts: [...project.texts.filter((t) => t.style !== 'caption' && !t.words), ...items] });
        notify(`${items.length} Untertitel erzeugt.`);
      }
    } catch (e) {
      notify('Spracherkennung fehlgeschlagen: ' + (e as Error).message);
    }
    setBusy(null);
  }

  // Automatische Untertitel direkt nach dem Erstellen (aus dem Assistenten)
  const autoSubsDone = useRef(false);
  useEffect(() => {
    if (!project || autoSubsDone.current || !params?.get('subs')) return;
    autoSubsDone.current = true;
    setTab('ai');
    captions({ language: (params.get('lang') as Language) || 'german', anim: 'karaoke', style: 'caption', upper: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  /* ---------- Text in der Vorschau verschieben ---------- */
  const textDrag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  function canvasPoint(e: RPointerEvent<HTMLCanvasElement>) {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height, w: c.width, h: c.height };
  }
  function canvasDown(e: RPointerEvent<HTMLCanvasElement>) {
    if (!project || !player.current) return;
    const p = canvasPoint(e);
    const hit = [...player.current.hitBoxes].reverse().find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (hit) {
      const item = project.texts.find((t) => t.id === hit.id);
      if (!item) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      textDrag.current = { id: hit.id, dx: p.x / p.w - item.x, dy: p.y / p.h - item.y, moved: false };
      setSelection({ type: 'text', id: hit.id });
    } else {
      textDrag.current = null;
      player.current.toggle();
    }
  }
  function canvasMove(e: RPointerEvent<HTMLCanvasElement>) {
    const d = textDrag.current;
    if (!d || !project) return;
    const p = canvasPoint(e);
    d.moved = true;
    const x = clamp(p.x / p.w - d.dx, 0.05, 0.95);
    const y = clamp(p.y / p.h - d.dy, 0.04, 0.96);
    // Magnet zur Mitte
    const sx = Math.abs(x - 0.5) < 0.02 ? 0.5 : x;
    commit({ ...project, texts: project.texts.map((t) => (t.id === d.id ? { ...t, x: +sx.toFixed(3), y: +y.toFixed(3) } : t)) }, `drag-${d.id}`);
  }

  /* ---------- Tastatur ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]') || exporting) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') { e.preventDefault(); player.current?.toggle(); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
      else if (mod) return;
      else if (e.key === 's' || e.key === 'S') split();
      else if (e.key === 'd' || e.key === 'D') duplicate();
      else if (e.key === 't' || e.key === 'T') addText();
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      else if (e.key === 'ArrowLeft') seek(time - (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === 'ArrowRight') seek(time + (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === 'Home') seek(0);
      else if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (missing) {
    return (
      <div className="home" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h2>Projekt nicht gefunden</h2>
          <p className="muted">Projekte werden in diesem Browser gespeichert. Vielleicht wurde es gelöscht oder auf einem anderen Gerät erstellt.</p>
          <Link href="/" className="btn btn-primary"><FolderOpen size={16} /> Zu meinen Projekten</Link>
        </div>
      </div>
    );
  }

  const leftOpen = mobile === 'media' || mobile === 'text' || mobile === 'effects' || mobile === 'ai';
  const leftTab: LeftTab = leftOpen ? (mobile as LeftTab) : tab;
  const closeMobile = mobile ? () => setMobile(null) : undefined;

  return (
    <div className="editor">
      <header className="ed-top">
        <Link href="/" className="icon-btn" aria-label="Zurück"><ChevronLeft size={20} /></Link>
        <Brand />
        {project ? (
          <input className="ed-name" type="text" value={project.name} onChange={(e) => commit({ ...project, name: e.target.value }, 'name')} aria-label="Projektname" />
        ) : null}
        <span className="spacer" />
        <span className="save-state">{saved ? 'Gespeichert' : 'Speichert …'}</span>
        <button className="icon-btn" onClick={doUndo} disabled={!undo.current.length} title="Rückgängig (Strg+Z)"><Undo2 size={17} /></button>
        <button className="icon-btn" onClick={doRedo} disabled={!redo.current.length} title="Wiederholen (Strg+Y)"><Redo2 size={17} /></button>
        <button className="btn btn-primary btn-glow" disabled={!project?.clips.length} onClick={() => { player.current?.pause(); setExporting(true); }}>
          <Download size={16} /> <span className="hide-sm">Exportieren</span>
        </button>
      </header>

      <div className="ed-body">
        <aside className={`ed-side${leftOpen ? ' open' : ''}`}>
          <div className="tabs">
            <button className={`tab${leftTab === 'media' ? ' active' : ''}`} onClick={() => (leftOpen ? setMobile('media') : setTab('media'))}><FolderOpen size={17} />Medien</button>
            <button className={`tab${leftTab === 'text' ? ' active' : ''}`} onClick={() => (leftOpen ? setMobile('text') : setTab('text'))}><Type size={17} />Text</button>
            <button className={`tab${leftTab === 'effects' ? ' active' : ''}`} onClick={() => (leftOpen ? setMobile('effects') : setTab('effects'))}><Wand2 size={17} />Effekte</button>
            <button className={`tab${leftTab === 'ai' ? ' active' : ''}`} onClick={() => (leftOpen ? setMobile('ai') : setTab('ai'))}><Sparkles size={17} />KI</button>
          </div>
          {project ? (
            leftTab === 'media' ? <MediaPanel project={project} assets={assets} onImported={imported} onAddClip={(a) => { addClip(a); setMobile(null); }} onUseMusic={applyMusic} onClose={closeMobile} />
              : leftTab === 'text' ? <TextPresets onAdd={(s) => addText(s)} onClose={closeMobile} />
                : leftTab === 'effects' ? <EffectsPanel project={project} current={currentClip} busy={busy} onApplyEffect={applyEffect} onApplyTransition={applyTransition} onAiEffects={aiEffects} onClose={closeMobile} />
                : <AiPanel project={project} busy={busy} onAiEffects={aiEffects} onAutoCaptions={(o) => captions(o)} onRegenerate={regenerate} onRemoveSilenceAll={() => removeSilenceIn(project.clips.map((c) => c.id))} onSnapBeats={snapBeats} onShorten={shorten} onRewriteTexts={rewriteTexts} onScript={scriptCaptions} onClose={closeMobile} />
          ) : null}
        </aside>

        <section className="ed-stage">
          <div className="stage">
            <canvas ref={canvas} width={540} height={960} onPointerDown={canvasDown} onPointerMove={canvasMove} onPointerUp={() => { textDrag.current = null; }} />
            {project && !project.clips.length ? <div className="stage-empty">Noch keine Clips – füge links Medien hinzu.</div> : null}
            {!project ? <div className="stage-empty"><span className="spinner" /></div> : null}
          </div>
          <div className="transport">
            <button className="icon-btn" onClick={() => seek(0)} aria-label="Zum Anfang"><SkipBack size={17} /></button>
            <button className="play-btn" onClick={() => player.current?.toggle()} aria-label={playing ? 'Pause' : 'Abspielen'}>
              {playing ? <Pause size={18} fill="#000" /> : <Play size={18} fill="#000" style={{ marginLeft: 2 }} />}
            </button>
            <span className="time">{timecode(time)} / {timecode(duration)}</span>
          </div>
        </section>

        <aside className={`ed-side right${mobile === 'inspect' ? ' open' : ''}`}>
          {project ? (
            <Inspector project={project} assets={assets} selection={selection} onChange={commit} onSplit={split} onDelete={remove} onDuplicate={duplicate}
              onRemoveSilence={(cid) => removeSilenceIn([cid])} onSnapBeats={snapBeats} onClose={closeMobile} />
          ) : null}
        </aside>
      </div>

      {project ? (
        <Timeline project={project} assets={assets} time={time} duration={duration} selection={selection}
          onSelect={(s) => { setSelection(s); }} onSeek={seek} onChange={commit} onSplit={split} onDelete={remove} onDuplicate={duplicate} onAddText={() => addText()} />
      ) : <div className="timeline" />}

      <nav className="mobile-tabs">
        <button className={mobile === 'media' ? 'active' : ''} onClick={() => setMobile(mobile === 'media' ? null : 'media')}><FolderOpen size={19} />Medien</button>
        <button className={mobile === 'text' ? 'active' : ''} onClick={() => setMobile(mobile === 'text' ? null : 'text')}><Type size={19} />Text</button>
        <button className={mobile === 'effects' ? 'active' : ''} onClick={() => setMobile(mobile === 'effects' ? null : 'effects')}><Wand2 size={19} />Effekte</button>
        <button className={mobile === 'ai' ? 'active' : ''} onClick={() => setMobile(mobile === 'ai' ? null : 'ai')}><Sparkles size={19} />KI</button>
        <button className={mobile === 'inspect' ? 'active' : ''} onClick={() => setMobile(mobile === 'inspect' ? null : 'inspect')}><SlidersHorizontal size={19} />Bearbeiten</button>
      </nav>

      {exporting && player.current && project ? <ExportDialog player={player.current} name={project.name} onClose={() => setExporting(false)} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

/** Texte proportional an eine neue Videolänge anpassen (CTA bleibt am Ende). */
function retime(p: Project, oldDuration: number): Project {
  const d = projectDuration(p);
  if (!oldDuration || Math.abs(d - oldDuration) < 0.01) return p;
  const f = d / oldDuration;
  return {
    ...p,
    texts: p.texts
      .map((t) => {
        if (t.style === 'cta' && Math.abs(t.end - oldDuration) < 0.3) {
          const len = Math.min(t.end - t.start, d);
          return { ...t, start: +(d - len).toFixed(2), end: +d.toFixed(2) };
        }
        return { ...t, start: +(t.start * f).toFixed(2), end: +(t.end * f).toFixed(2), words: t.words?.map((w) => ({ ...w, start: w.start * f, end: w.end * f })) };
      })
      .filter((t) => t.end - t.start > 0.2),
  };
}
