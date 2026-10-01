'use client';

import { AudioWaveform, Copy, Image as ImageIcon, Scissors, Trash2, X } from 'lucide-react';
import { FILTER_LABELS, ANIM_LABELS, TEXT_STYLES } from '../../lib/render';
import { EFFECTS } from '../../lib/effects';
import { FORMATS } from '../../lib/types';
import type { Clip, Effect, Filter, Format, MediaAsset, Motion, Project, TextItem, Transition } from '../../lib/types';
import { readLogo } from '../../lib/browser';
import type { Selection } from './timeline';

type Props = {
  project: Project;
  assets: Map<string, MediaAsset>;
  selection: Selection;
  onChange: (p: Project, key?: string) => void;
  onSplit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRemoveSilence: (clipId: string) => void;
  onSnapBeats: () => void;
  onClose?: () => void;
};

const TRANSITIONS: Record<Transition, string> = { none: 'Schnitt', fade: 'Überblenden', zoom: 'Zoom', slide: 'Schieben', flash: 'Blitz', blur: 'Unschärfe', whip: 'Wischen', spin: 'Drehen', glitch: 'Glitch' };
const MOTIONS: Record<Motion, string> = { none: 'Keine', 'zoom-in': 'Zoom rein', 'zoom-out': 'Zoom raus', 'pan-left': 'Schwenk ←', 'pan-right': 'Schwenk →' };
const FILTER_CSS: Record<Filter, string> = {
  none: 'none', vivid: 'saturate(1.35) contrast(1.08)', warm: 'sepia(0.22) saturate(1.25)', cool: 'hue-rotate(-10deg)',
  mono: 'grayscale(1) contrast(1.12)', cinema: 'contrast(1.15) saturate(0.85)', fade: 'contrast(0.86) brightness(1.08) saturate(0.8)',
};
const SPEEDS = [0.5, 1, 1.5, 2, 3];
const COLORS = ['#ffffff', '#000000', '#ffd400', '#ff3b5c', '#1a7dff', '#00d8d8', '#2fd27f'];

export function Inspector(props: Props) {
  const { project, selection } = props;
  const clip = selection?.type === 'clip' ? project.clips.find((c) => c.id === selection.id) : null;
  const text = selection?.type === 'text' ? project.texts.find((t) => t.id === selection.id) : null;
  const head = clip ? 'Clip' : text ? 'Text' : selection?.type === 'music' ? 'Musik' : 'Projekt';
  return (
    <>
      <div className="tabs" style={{ alignItems: 'center' }}>
        <strong style={{ flex: 1, padding: '6px 6px', fontSize: 14 }}>{head}</strong>
        {props.onClose ? <button className="icon-btn side-close" onClick={props.onClose} aria-label="Schließen"><X size={18} /></button> : null}
      </div>
      <div className="side-scroll">
        {clip ? <ClipPanel {...props} clip={clip} /> : text ? <TextPanel {...props} item={text} /> : selection?.type === 'music' && project.music ? <MusicPanel {...props} /> : <ProjectPanel {...props} />}
      </div>
    </>
  );
}

function ClipPanel({ project, assets, clip, onChange, onSplit, onDelete, onDuplicate, onRemoveSilence }: Props & { clip: Clip }) {
  const asset = assets.get(clip.assetId);
  const set = (patch: Partial<Clip>, key?: string) => onChange({ ...project, clips: project.clips.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)) }, key);
  const isVideo = asset?.kind === 'video';
  const thumb = asset?.thumbs[0];
  const index = project.clips.findIndex((c) => c.id === clip.id);
  return (
    <>
      <div className="group">
        <div className="btn-row">
          <button className="btn btn-sm" onClick={onSplit}><Scissors size={14} /> Teilen</button>
          <button className="btn btn-sm" onClick={onDuplicate}><Copy size={14} /> Kopie</button>
          <button className="btn btn-sm btn-danger" onClick={onDelete}><Trash2 size={14} /></button>
        </div>
        <p className="hint">{asset?.name} · {((clip.out - clip.in) / clip.speed).toFixed(1)} s{isVideo ? ` (Quelle ${clip.in.toFixed(1)}–${clip.out.toFixed(1)} s)` : ''}</p>
        {isVideo && asset?.analysis?.speech.length ? (
          <button className="ai-tool" onClick={() => onRemoveSilence(clip.id)}>
            <AudioWaveform size={18} />
            <span><strong>Pausen entfernen</strong><small>Stille Stellen in diesem Clip automatisch herausschneiden.</small></span>
          </button>
        ) : null}
      </div>

      {isVideo ? (
        <div className="group">
          <span className="side-title">Tempo</span>
          <div className="segmented">
            {SPEEDS.map((s) => <button key={s} className={clip.speed === s ? 'active' : ''} onClick={() => set({ speed: s })}>{s}×</button>)}
          </div>
          <div className="range-row">
            <span className="field-label">Lautstärke</span>
            <input type="range" min={0} max={2} step={0.05} value={clip.volume} onChange={(e) => set({ volume: +e.target.value }, `vol-${clip.id}`)} />
            <output>{Math.round(clip.volume * 100)} %</output>
          </div>
        </div>
      ) : (
        <div className="group">
          <div className="range-row">
            <span className="field-label">Anzeigedauer</span>
            <input type="range" min={0.5} max={10} step={0.1} value={clip.out - clip.in} onChange={(e) => set({ out: clip.in + +e.target.value }, `dur-${clip.id}`)} />
            <output>{(clip.out - clip.in).toFixed(1)} s</output>
          </div>
        </div>
      )}

      <div className="group">
        <span className="side-title">Effekt</span>
        <div className="fx-grid">
          {(Object.keys(EFFECTS) as Effect[]).map((e) => (
            <button key={e} className={`fx-tile${(clip.effect || 'none') === e ? ' active' : ''}`} onClick={() => set({ effect: e })} title={EFFECTS[e].hint}>
              <span>{EFFECTS[e].icon}</span>{EFFECTS[e].label}
            </button>
          ))}
        </div>
        {clip.effect && clip.effect !== 'none' ? (
          <div className="range-row">
            <span className="field-label">Stärke</span>
            <input type="range" min={0.1} max={1} step={0.05} value={clip.effectAmount ?? 0.7} onChange={(e) => set({ effectAmount: +e.target.value }, `fx-${clip.id}`)} />
            <output>{Math.round((clip.effectAmount ?? 0.7) * 100)} %</output>
          </div>
        ) : null}
      </div>

      <div className="group">
        <span className="side-title">Filter</span>
        <div className="filters">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
            <button key={f} className={`filter-btn${clip.filter === f ? ' active' : ''}`} onClick={() => set({ filter: f })}>
              <span style={{ backgroundImage: thumb ? `url(${thumb})` : undefined, filter: FILTER_CSS[f], backgroundColor: '#334' }} />
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
        <button className="btn btn-sm" onClick={() => onChange({ ...project, clips: project.clips.map((c) => ({ ...c, filter: clip.filter })) })}>Filter auf alle Clips anwenden</button>
      </div>

      <div className="group">
        <span className="side-title">Übergang {index === 0 ? '(erster Clip)' : 'zum Clip'}</span>
        <div className="chips">
          {(Object.keys(TRANSITIONS) as Transition[]).map((t) => (
            <button key={t} disabled={index === 0} className={`chip${clip.transition === t ? ' active' : ''}`} onClick={() => set({ transition: t })}>{TRANSITIONS[t]}</button>
          ))}
        </div>
      </div>

      <div className="group">
        <span className="side-title">Kamerafahrt</span>
        <div className="chips">
          {(Object.keys(MOTIONS) as Motion[]).map((m) => (
            <button key={m} className={`chip${clip.motion === m ? ' active' : ''}`} onClick={() => set({ motion: m })}>{MOTIONS[m]}</button>
          ))}
        </div>
        <span className="side-title">Bildausschnitt</span>
        <div className="segmented">
          <button className={clip.fit === 'cover' ? 'active' : ''} onClick={() => set({ fit: 'cover' })}>Füllen</button>
          <button className={clip.fit === 'contain' ? 'active' : ''} onClick={() => set({ fit: 'contain' })}>Ganzes Bild</button>
        </div>
      </div>
    </>
  );
}

function TextPanel({ project, item, onChange, onDelete, onDuplicate }: Props & { item: TextItem }) {
  const set = (patch: Partial<TextItem>, key?: string) => onChange({ ...project, texts: project.texts.map((t) => (t.id === item.id ? { ...t, ...patch } : t)) }, key);
  return (
    <>
      <div className="group">
        <textarea value={item.text} onChange={(e) => set({ text: e.target.value }, `txt-${item.id}`)} rows={3} />
        <div className="btn-row">
          <button className="btn btn-sm" onClick={onDuplicate}><Copy size={14} /> Kopie</button>
          <button className="btn btn-sm btn-danger" onClick={onDelete}><Trash2 size={14} /> Löschen</button>
        </div>
      </div>
      <div className="group">
        <span className="side-title">Stil</span>
        <div className="chips">
          {(Object.keys(TEXT_STYLES) as TextItem['style'][]).map((s) => (
            <button key={s} className={`chip${item.style === s ? ' active' : ''}`} onClick={() => set({ style: s })}>{TEXT_STYLES[s].label}</button>
          ))}
        </div>
        <span className="side-title">Animation</span>
        <div className="chips">
          {(Object.keys(ANIM_LABELS) as TextItem['anim'][]).map((a) => (
            <button key={a} className={`chip${item.anim === a ? ' active' : ''}`} onClick={() => set({ anim: a })}>{ANIM_LABELS[a]}</button>
          ))}
        </div>
      </div>
      <div className="group">
        <span className="side-title">Farben</span>
        <div className="field-row">
          <span className="field-label" style={{ width: 70 }}>Schrift</span>
          {COLORS.slice(0, 4).map((c) => <button key={c} className="icon-btn" onClick={() => set({ color: c })} style={{ background: c, border: item.color === c ? '2px solid #3d95ff' : '1px solid #445', width: 24, height: 24, borderRadius: 6 }} aria-label={c} />)}
          <input type="color" value={item.color} onChange={(e) => set({ color: e.target.value }, `col-${item.id}`)} />
        </div>
        <div className="field-row">
          <span className="field-label" style={{ width: 70 }}>Akzent</span>
          {COLORS.slice(2).map((c) => <button key={c} className="icon-btn" onClick={() => set({ accent: c })} style={{ background: c, border: item.accent === c ? '2px solid #fff' : '1px solid #445', width: 24, height: 24, borderRadius: 6 }} aria-label={c} />)}
          <input type="color" value={item.accent} onChange={(e) => set({ accent: e.target.value }, `acc-${item.id}`)} />
        </div>
      </div>
      <div className="group">
        <div className="range-row">
          <span className="field-label">Größe</span>
          <input type="range" min={0.4} max={2.5} step={0.05} value={item.size} onChange={(e) => set({ size: +e.target.value }, `size-${item.id}`)} />
          <output>{Math.round(item.size * 100)} %</output>
        </div>
        <div className="range-row">
          <span className="field-label">Position horizontal</span>
          <input type="range" min={0.05} max={0.95} step={0.01} value={item.x} onChange={(e) => set({ x: +e.target.value }, `x-${item.id}`)} />
          <output>{Math.round(item.x * 100)} %</output>
        </div>
        <div className="range-row">
          <span className="field-label">Position vertikal</span>
          <input type="range" min={0.05} max={0.95} step={0.01} value={item.y} onChange={(e) => set({ y: +e.target.value }, `y-${item.id}`)} />
          <output>{Math.round(item.y * 100)} %</output>
        </div>
        <p className="hint">Tipp: Text in der Vorschau direkt mit der Maus verschieben.</p>
        <div className="field-row">
          <label className="field"><span className="field-label">Start (s)</span><input type="number" step={0.1} min={0} value={item.start} onChange={(e) => set({ start: Math.max(0, Math.min(+e.target.value, item.end - 0.2)) })} /></label>
          <label className="field"><span className="field-label">Ende (s)</span><input type="number" step={0.1} min={0} value={item.end} onChange={(e) => set({ end: Math.max(item.start + 0.2, +e.target.value) })} /></label>
        </div>
      </div>
    </>
  );
}

function MusicPanel({ project, assets, onChange, onSnapBeats }: Props) {
  const music = project.music!;
  const asset = assets.get(music.assetId);
  const set = (patch: Partial<typeof music>, key?: string) => onChange({ ...project, music: { ...music, ...patch } }, key);
  return (
    <>
      <div className="group">
        <p className="hint">{asset?.name}{asset?.analysis?.bpm ? ` · ca. ${asset.analysis.bpm} BPM` : ''}</p>
        <div className="range-row">
          <span className="field-label">Lautstärke</span>
          <input type="range" min={0} max={1.5} step={0.05} value={music.volume} onChange={(e) => set({ volume: +e.target.value }, 'music-vol')} />
          <output>{Math.round(music.volume * 100)} %</output>
        </div>
        <div className="range-row">
          <span className="field-label">Startpunkt im Song</span>
          <input type="range" min={0} max={Math.max(1, (asset?.duration ?? 1) - 1)} step={0.1} value={music.offset} onChange={(e) => set({ offset: +e.target.value }, 'music-offset')} />
          <output>{music.offset.toFixed(1)} s</output>
        </div>
        <label className="check"><input type="checkbox" checked={music.fadeOut} onChange={(e) => set({ fadeOut: e.target.checked })} /> Am Ende ausblenden</label>
        <label className="check"><input type="checkbox" checked={music.ducking} onChange={(e) => set({ ducking: e.target.checked })} /> Musik leiser, wenn Originalton läuft</label>
      </div>
      <div className="group">
        <button className="ai-tool" onClick={onSnapBeats} disabled={!asset?.analysis?.beats?.length}>
          <AudioWaveform size={18} />
          <span><strong>Schnitte auf den Beat legen</strong><small>Clip-Längen so anpassen, dass jeder Schnitt auf einem Beat sitzt.</small></span>
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => onChange({ ...project, music: null })}><Trash2 size={14} /> Musik entfernen</button>
      </div>
    </>
  );
}

function ProjectPanel({ project, onChange }: Props) {
  return (
    <>
      <div className="group">
        <span className="side-title">Format</span>
        <div className="options">
          {(Object.keys(FORMATS) as Format[]).map((f) => (
            <button key={f} className={`option${project.format === f ? ' active' : ''}`} onClick={() => onChange({ ...project, format: f })}>
              <strong>{f}</strong><small>{FORMATS[f].hint}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="group">
        <span className="side-title">Marke</span>
        <div className="field-row">
          <span className="field-label" style={{ flex: 1 }}>Akzentfarbe aller Texte</span>
          <input type="color" value={project.brandColor} onChange={(e) => onChange({ ...project, brandColor: e.target.value, texts: project.texts.map((t) => ({ ...t, accent: e.target.value })) }, 'brand')} />
        </div>
        <div className="field-row">
          <span className="field-label" style={{ flex: 1 }}>Hintergrund (Ränder)</span>
          <input type="color" value={project.background} onChange={(e) => onChange({ ...project, background: e.target.value }, 'bg')} />
        </div>
        <div className="field-row">
          {project.logo ? <img src={project.logo} alt="" style={{ height: 32, maxWidth: 90, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 3 }} /> : null}
          <label className="btn btn-sm">
            <ImageIcon size={14} /> {project.logo ? 'Logo ändern' : 'Logo hinzufügen'}
            <input type="file" accept="image/*" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) onChange({ ...project, logo: await readLogo(f), watermark: true });
            }} />
          </label>
        </div>
        {project.logo ? <label className="check"><input type="checkbox" checked={project.watermark} onChange={(e) => onChange({ ...project, watermark: e.target.checked })} /> Logo als Wasserzeichen zeigen</label> : null}
      </div>
      <div className="group">
        <span className="side-title">Tastenkürzel</span>
        <p className="hint">
          <span className="kbd">Leertaste</span> Abspielen · <span className="kbd">S</span> Teilen · <span className="kbd">D</span> Kopie · <span className="kbd">T</span> Text · <span className="kbd">Entf</span> Löschen · <span className="kbd">Strg+Z</span> Rückgängig · <span className="kbd">←</span>/<span className="kbd">→</span> Bild für Bild
        </p>
      </div>
    </>
  );
}
