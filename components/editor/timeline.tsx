'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { ArrowLeftRight, Copy, Magnet, Scissors, Trash2, Type, ZoomIn, ZoomOut } from 'lucide-react';
import { layout } from '../../lib/render';
import { EFFECTS } from '../../lib/effects';
import type { Clip, MediaAsset, Project, TextItem } from '../../lib/types';
import { clamp, timecode } from '../../lib/util';

export type Selection = { type: 'clip' | 'text' | 'music'; id: string } | null;

type Props = {
  project: Project;
  assets: Map<string, MediaAsset>;
  time: number;
  duration: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onSeek: (t: number) => void;
  /** key: gleichartige Änderungen (z. B. Ziehen) werden zu einem Undo-Schritt zusammengefasst */
  onChange: (p: Project, key?: string) => void;
  onSplit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddText: () => void;
};

type Drag =
  | { kind: 'clip-move'; id: string; x0: number; moved: boolean; drop: number | null }
  | { kind: 'clip-in' | 'clip-out'; id: string; x0: number; orig: Clip }
  | { kind: 'text-move' | 'text-in' | 'text-out'; id: string; x0: number; orig: TextItem }
  | { kind: 'music'; x0: number; orig: number }
  | { kind: 'scrub' };

const PAD = 16;

export function Timeline(props: Props) {
  const { project, assets, time, duration, selection } = props;
  const [pps, setPps] = useState(60);
  const [snap, setSnap] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dragState, setDragState] = useState<Drag | null>(null);
  const timeline = useMemo(() => layout(project), [project]);

  // Zoom passend zur Länge beim ersten Laden
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !duration || !scroller.current) return;
    fitted.current = true;
    const w = scroller.current.clientWidth - PAD * 2 - 40;
    setPps(clamp(w / duration, 12, 160));
  }, [duration]);

  // Abspielkopf sichtbar halten
  useEffect(() => {
    const el = scroller.current;
    if (!el || drag.current) return;
    const x = PAD + time * pps;
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - el.clientWidth * 0.3;
  }, [time, pps]);

  const width = Math.max(duration * pps + PAD * 2 + 200, 600);
  const xToTime = (clientX: number) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    return clamp((clientX - r.left + el.scrollLeft - PAD) / pps, 0, duration);
  };

  // Einrasten: Clip-Grenzen, Abspielkopf
  const snapPoints = useMemo(() => [0, ...timeline.map((c) => c.end), time], [timeline, time]);
  const snapT = (t: number) => {
    if (!snap) return t;
    const tol = 8 / pps;
    for (const p of snapPoints) if (Math.abs(p - t) < tol) return p;
    return t;
  };

  function start(e: RPointerEvent, d: Drag) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = d;
    setDragState(d);
    if (d.kind === 'scrub') props.onSeek(xToTime(e.clientX));
  }

  function move(e: RPointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'scrub') {
      props.onSeek(xToTime(e.clientX));
      return;
    }
    const dt = (e.clientX - d.x0) / pps;
    if (d.kind === 'clip-move') {
      if (!d.moved && Math.abs(e.clientX - d.x0) < 5) return;
      const t = xToTime(e.clientX);
      let drop = timeline.length;
      for (const c of timeline) if (t < (c.start + c.end) / 2) { drop = c.index; break; }
      drag.current = { ...d, moved: true, drop };
      setDragState(drag.current);
      return;
    }
    if (d.kind === 'clip-in' || d.kind === 'clip-out') {
      const asset = assets.get(d.orig.assetId);
      const image = asset?.kind === 'image';
      const max = image ? 60 : asset?.duration ?? d.orig.out;
      const c = { ...d.orig };
      if (d.kind === 'clip-out' || image) {
        const sign = d.kind === 'clip-in' ? -1 : 1;
        c.out = clamp(d.orig.out + sign * dt * c.speed, c.in + 0.2, max);
      } else {
        c.in = clamp(d.orig.in + dt * c.speed, 0, c.out - 0.2);
      }
      props.onChange({ ...project, clips: project.clips.map((x) => (x.id === c.id ? c : x)) }, `trim-${c.id}`);
      return;
    }
    if (d.kind === 'text-move' || d.kind === 'text-in' || d.kind === 'text-out') {
      const o = d.orig;
      const t = { ...o };
      if (d.kind === 'text-move') {
        const len = o.end - o.start;
        t.start = clamp(snapT(o.start + dt), 0, Math.max(0, duration - len));
        t.end = t.start + len;
        const shift = t.start - o.start;
        if (o.words) t.words = o.words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift }));
      } else if (d.kind === 'text-in') t.start = clamp(snapT(o.start + dt), 0, o.end - 0.3);
      else t.end = clamp(snapT(o.end + dt), o.start + 0.3, duration);
      t.start = +t.start.toFixed(2);
      t.end = +t.end.toFixed(2);
      props.onChange({ ...project, texts: project.texts.map((x) => (x.id === t.id ? t : x)) }, `text-${t.id}`);
      return;
    }
    if (d.kind === 'music' && project.music) {
      const music = assets.get(project.music.assetId);
      const offset = clamp(d.orig - dt, 0, Math.max(0, (music?.duration ?? 0) - 1));
      props.onChange({ ...project, music: { ...project.music, offset } }, 'music-offset');
    }
  }

  function end() {
    const d = drag.current;
    drag.current = null;
    setDragState(null);
    if (d?.kind === 'clip-move') {
      if (d.moved && d.drop !== null) {
        const from = project.clips.findIndex((c) => c.id === d.id);
        let to = d.drop;
        if (to > from) to -= 1;
        if (to !== from) {
          const clips = [...project.clips];
          const [c] = clips.splice(from, 1);
          clips.splice(to, 0, c);
          props.onChange({ ...project, clips });
        }
      } else {
        props.onSelect({ type: 'clip', id: d.id });
      }
    }
  }

  // Lineal
  const step = pps > 90 ? 1 : pps > 40 ? 2 : pps > 18 ? 5 : 10;
  const ticks = [];
  for (let s = 0; s <= duration + step; s += step) ticks.push(s);

  const selClip = selection?.type === 'clip';
  const music = project.music ? assets.get(project.music.assetId) : null;

  return (
    <div className="timeline">
      <div className="tl-tools">
        <button className="icon-btn" title="Am Abspielkopf teilen (S)" onClick={props.onSplit} disabled={!project.clips.length}><Scissors size={17} /></button>
        <button className="icon-btn" title="Duplizieren (D)" onClick={props.onDuplicate} disabled={!selection || selection.type === 'music'}><Copy size={16} /></button>
        <button className="icon-btn" title="Löschen (Entf)" onClick={props.onDelete} disabled={!selection}><Trash2 size={16} /></button>
        <span className="sep" />
        <button className="icon-btn" title="Text hinzufügen (T)" onClick={props.onAddText}><Type size={16} /></button>
        <button className={`icon-btn${snap ? ' active' : ''}`} title="Einrasten" onClick={() => setSnap(!snap)}><Magnet size={16} /></button>
        <span className="spacer" />
        <span className="muted small hide-sm">{selClip ? 'Clip ziehen = verschieben · Ränder ziehen = kürzen' : 'Clip anklicken zum Bearbeiten'}</span>
        <span className="sep hide-sm" />
        <button className="icon-btn" title="Verkleinern" onClick={() => setPps((p) => clamp(p / 1.4, 8, 300))}><ZoomOut size={16} /></button>
        <button className="icon-btn" title="Vergrößern" onClick={() => setPps((p) => clamp(p * 1.4, 8, 300))}><ZoomIn size={16} /></button>
      </div>
      <div className="tl-scroll" ref={scroller} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <div className="tl-inner" style={{ width }} onPointerDown={(e) => { props.onSelect(null); start(e, { kind: 'scrub' }); }}>
          <div className="ruler">
            {ticks.map((s) => (
              <span key={s} style={{ left: PAD + s * pps }}>{timecode(s, 0)}</span>
            ))}
            {ticks.map((s) => <i key={`i${s}`} style={{ left: PAD + s * pps }} />)}
          </div>

          <div className="track track-video" style={{ marginLeft: PAD }}>
            {timeline.map((c) => {
              const asset = assets.get(c.clip.assetId);
              const w = (c.end - c.start) * pps;
              const thumbs = asset?.thumbs || [];
              const thumb = thumbs.length ? thumbs[Math.min(thumbs.length - 1, Math.floor((c.clip.in / Math.max(0.1, asset!.duration)) * thumbs.length))] : '';
              const selected = selection?.type === 'clip' && selection.id === c.clip.id;
              const dragging = dragState?.kind === 'clip-move' && dragState.id === c.clip.id && dragState.moved;
              return (
                <div key={c.clip.id}
                  className={`clip${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}`}
                  style={{ left: c.start * pps, width: Math.max(4, w - 2), backgroundImage: thumb ? `url(${thumb})` : undefined }}
                  onPointerDown={(e) => start(e, { kind: 'clip-move', id: c.clip.id, x0: e.clientX, moved: false, drop: null })}>
                  <div className="clip-badges">
                    {c.clip.speed !== 1 ? <span>{c.clip.speed}×</span> : null}
                    {c.clip.volume === 0 && asset?.kind === 'video' ? <span>stumm</span> : null}
                  </div>
                  {c.clip.effect && c.clip.effect !== 'none' ? <span className="clip-fx" title={EFFECTS[c.clip.effect].label}>{EFFECTS[c.clip.effect].icon}</span> : null}
                  {w > 60 ? <span className="clip-label">{(c.end - c.start).toFixed(1)} s</span> : null}
                  <span className="handle l" onPointerDown={(e) => start(e, { kind: 'clip-in', id: c.clip.id, x0: e.clientX, orig: c.clip })} />
                  <span className="handle r" onPointerDown={(e) => start(e, { kind: 'clip-out', id: c.clip.id, x0: e.clientX, orig: c.clip })} />
                </div>
              );
            })}
            {timeline.slice(1).filter((c) => c.clip.transition !== 'none').map((c) => (
              <span key={`t${c.clip.id}`} className="trans-mark" style={{ left: c.start * pps }}><ArrowLeftRight size={10} /></span>
            ))}
            {dragState?.kind === 'clip-move' && dragState.moved && dragState.drop !== null ? (
              <span className="drop-marker" style={{ left: (dragState.drop < timeline.length ? timeline[dragState.drop].start : duration) * pps }} />
            ) : null}
            {!timeline.length ? <span className="tl-empty">Füge links Medien hinzu.</span> : null}
          </div>

          <div className="track track-text" style={{ marginLeft: PAD }}>
            {project.texts.map((t) => {
              const selected = selection?.type === 'text' && selection.id === t.id;
              return (
                <div key={t.id} className={`text-bar ${t.style}${selected ? ' selected' : ''}`} style={{ left: t.start * pps, width: Math.max(8, (t.end - t.start) * pps - 2) }}
                  onPointerDown={(e) => { props.onSelect({ type: 'text', id: t.id }); start(e, { kind: 'text-move', id: t.id, x0: e.clientX, orig: t }); }}>
                  <span className="handle l" onPointerDown={(e) => { props.onSelect({ type: 'text', id: t.id }); start(e, { kind: 'text-in', id: t.id, x0: e.clientX, orig: t }); }} />
                  {t.text}
                  <span className="handle r" onPointerDown={(e) => { props.onSelect({ type: 'text', id: t.id }); start(e, { kind: 'text-out', id: t.id, x0: e.clientX, orig: t }); }} />
                </div>
              );
            })}
          </div>

          {project.music && music ? (
            <div className="track track-audio" style={{ marginLeft: PAD }}>
              <div className={`audio-bar${selection?.type === 'music' ? ' selected' : ''}`} style={{ left: 0, width: Math.max(8, Math.min(duration, music.duration - project.music.offset) * pps) }}
                onPointerDown={(e) => { props.onSelect({ type: 'music', id: music.id }); start(e, { kind: 'music', x0: e.clientX, orig: project.music!.offset }); }}>
                <span>♪ {music.name}{music.analysis?.bpm ? ` · ${music.analysis.bpm} BPM` : ''}</span>
                <Wave loudness={music.analysis?.loudness || []} from={project.music.offset} to={project.music.offset + duration} beats={music.analysis?.beats || []} />
              </div>
            </div>
          ) : null}

          <span className="playhead" style={{ left: PAD + time * pps }} />
        </div>
      </div>
    </div>
  );
}

function Wave({ loudness, from, to, beats }: { loudness: number[]; from: number; to: number; beats: number[] }) {
  const a = Math.floor(from * 10);
  const b = Math.min(loudness.length, Math.ceil(to * 10));
  const slice = loudness.slice(a, b);
  if (!slice.length) return null;
  const n = slice.length;
  const d = slice.map((v, i) => `M${i},${18 - v * 14}V${18 + v * 14}`).join('');
  return (
    <svg viewBox={`0 0 ${n} 36`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} stroke="rgba(47,210,127,0.55)" strokeWidth="0.6" />
      {beats.filter((x) => x >= from && x <= to).map((x) => (
        <line key={x} x1={(x - from) * 10} x2={(x - from) * 10} y1="30" y2="36" stroke="rgba(255,255,255,0.5)" strokeWidth="0.4" />
      ))}
    </svg>
  );
}
