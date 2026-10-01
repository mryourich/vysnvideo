'use client';

import { useState } from 'react';
import { AudioWaveform, Captions, Clock, Film, ListOrdered, Mic, Music, Plus, RefreshCw, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { EFFECTS } from '../../lib/effects';
import { LANGUAGES } from '../../lib/transcribe';
import type { Language } from '../../lib/transcribe';
import { importFile } from '../../lib/analyze';
import { db, registerUrl } from '../../lib/db';
import { STYLES } from '../../lib/types';
import type { Clip, Effect, MediaAsset, Project, Style, TextItem, Transition } from '../../lib/types';
import { TEXT_STYLES } from '../../lib/render';

/* ---------------- Medien ---------------- */

export function MediaPanel({ project, assets, onImported, onAddClip, onUseMusic, onClose }: {
  project: Project;
  assets: Map<string, MediaAsset>;
  onImported: (a: MediaAsset) => void;
  onAddClip: (a: MediaAsset) => void;
  onUseMusic: (a: MediaAsset) => void;
  onClose?: () => void;
}) {
  const [jobs, setJobs] = useState<{ name: string; progress: number; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const library = project.library.map((id) => assets.get(id)).filter(Boolean) as MediaAsset[];

  async function upload(files: File[]) {
    setError(null);
    for (const file of files) {
      setJobs((j) => [...j, { name: file.name, progress: 0, label: 'Wird analysiert …' }]);
      try {
        const asset = await importFile(file, (progress, label) => setJobs((j) => j.map((x) => (x.name === file.name ? { ...x, progress, label } : x))));
        await db.saveAsset(asset, file);
        registerUrl(asset.id, file);
        onImported(asset);
      } catch (e) {
        setError((e as Error).message);
      }
      setJobs((j) => j.filter((x) => x.name !== file.name));
    }
  }

  return (
    <div className="side-scroll">
      {onClose ? <div className="field-row"><span className="side-title" style={{ flex: 1 }}>Medien</span><button className="icon-btn side-close" onClick={onClose}><X size={18} /></button></div> : null}
      <label className="add-more">
        <Upload size={16} /> Hochladen
        <input type="file" accept="video/*,image/*,audio/*" multiple onChange={(e) => { upload([...(e.target.files || [])]); e.target.value = ''; }} />
      </label>
      {jobs.map((j) => (
        <div key={j.name} className="file-info">
          <small>{j.name} – {j.label}</small>
          <span className="bar"><i style={{ width: `${Math.round(j.progress * 100)}%` }} /></span>
        </div>
      ))}
      {error ? <div className="notice notice-error">{error}</div> : null}
      <div className="media-grid">
        {library.map((a) => a.kind === 'audio' ? (
          <button key={a.id} className="media-item audio" onClick={() => onUseMusic(a)} title="Als Hintergrundmusik verwenden">
            <Music size={16} /><span>{a.name}</span>
            {project.music?.assetId === a.id ? <span className="badge badge-ai">aktiv</span> : <span className="badge">verwenden</span>}
          </button>
        ) : (
          <button key={a.id} className="media-item" onClick={() => onAddClip(a)} title={`${a.name} zur Timeline hinzufügen`}>
            {a.thumbs[0] ? <img src={a.thumbs[Math.floor(a.thumbs.length / 3)] || a.thumbs[0]} alt="" /> : <Film size={20} />}
            <span className="badge">{a.kind === 'image' ? 'Foto' : `${a.duration.toFixed(0)} s`}</span>
            <span className="add"><Plus size={22} /></span>
          </button>
        ))}
      </div>
      {!library.length ? <p className="hint">Noch keine Medien.</p> : <p className="hint">Klick fügt den Clip hinter dem ausgewählten Clip (oder am Ende) ein.</p>}
    </div>
  );
}

/* ---------------- Texte ---------------- */

export function TextPresets({ onAdd, onClose }: { onAdd: (style: TextItem['style']) => void; onClose?: () => void }) {
  const samples: Record<TextItem['style'], string> = { hook: 'Hook', title: 'Titel', caption: 'Untertitel', cta: 'Jetzt kaufen', label: 'Hinweis', price: '49 €', neon: 'NEON' };
  return (
    <div className="side-scroll">
      {onClose ? <div className="field-row"><span className="side-title" style={{ flex: 1 }}>Text</span><button className="icon-btn side-close" onClick={onClose}><X size={18} /></button></div> : null}
      <span className="side-title">Text hinzufügen</span>
      <div className="text-presets">
        {(Object.keys(TEXT_STYLES) as TextItem['style'][]).map((s) => (
          <button key={s} className={`text-preset tp-${s}`} onClick={() => onAdd(s)} title={TEXT_STYLES[s].label}>
            {s === 'hook' || s === 'cta' || s === 'label' ? <span>{samples[s]}</span> : samples[s]}
          </button>
        ))}
      </div>
      <p className="hint">Der Text erscheint am Abspielkopf. Danach in der Vorschau verschieben und rechts gestalten.</p>
    </div>
  );
}

/* ---------------- KI-Werkzeuge ---------------- */

export type CaptionOptions = { language: Language; anim: TextItem['anim']; style: TextItem['style']; upper: boolean };

export function AiPanel({ project, busy, onRegenerate, onRemoveSilenceAll, onSnapBeats, onShorten, onRewriteTexts, onScript, onAiEffects, onAutoCaptions, onClose }: {
  project: Project;
  busy: string | null;
  onAiEffects: () => void;
  onAutoCaptions: (o: CaptionOptions) => void;
  onRegenerate: (style: Style) => void;
  onRemoveSilenceAll: () => void;
  onSnapBeats: () => void;
  onShorten: (seconds: number) => void;
  onRewriteTexts: () => void;
  onScript: (script: string) => void;
  onClose?: () => void;
}) {
  const [script, setScript] = useState('');
  const [caps, setCaps] = useState<CaptionOptions>({ language: 'german', anim: 'karaoke', style: 'caption', upper: false });
  const [style, setStyle] = useState<Style>(project.brief?.style || 'dynamic');
  return (
    <div className="side-scroll">
      {onClose ? <div className="field-row"><span className="side-title" style={{ flex: 1 }}>KI-Werkzeuge</span><button className="icon-btn side-close" onClick={onClose}><X size={18} /></button></div> : null}
      {busy ? <div className="notice" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> {busy}</div> : null}

      <div className="group">
        <span className="side-title">Auto-Schnitt</span>
        <div className="chips">
          {(Object.keys(STYLES) as Style[]).map((s) => (
            <button key={s} className={`chip${style === s ? ' active' : ''}`} onClick={() => setStyle(s)}>{STYLES[s].label}</button>
          ))}
        </div>
        <button className="ai-tool" disabled={!!busy} onClick={() => onRegenerate(style)}>
          <RefreshCw size={18} />
          <span><strong>Video neu generieren</strong><small>Mit allen Medien und dem gewählten Stil komplett neu schneiden. Rückgängig mit Strg+Z.</small></span>
        </button>
        <button className="ai-tool" disabled={!!busy || !project.clips.length} onClick={onAiEffects}>
          <Wand2 size={18} />
          <span><strong>KI-Effekte</strong><small>Effekte, Übergänge, Filter und Kamerafahrten passend zu Szene und Beat setzen.</small></span>
        </button>
        <button className="ai-tool" disabled={!!busy} onClick={onRewriteTexts}>
          <Sparkles size={18} />
          <span><strong>Texte von der KI schreiben lassen</strong><small>Hook, Einblendungen und CTA passend zu den Bildern (Claude).</small></span>
        </button>
      </div>

      <div className="group">
        <span className="side-title">Schnitt verbessern</span>
        <button className="ai-tool" disabled={!!busy} onClick={onRemoveSilenceAll}>
          <AudioWaveform size={18} />
          <span><strong>Pausen entfernen</strong><small>Stille in allen Sprech-Clips herausschneiden (Jump Cuts).</small></span>
        </button>
        <button className="ai-tool" disabled={!!busy || !project.music} onClick={onSnapBeats}>
          <Music size={18} />
          <span><strong>Im Takt schneiden</strong><small>{project.music ? 'Schnitte auf die Beats der Musik legen.' : 'Erst Musik hinzufügen (Tab Medien).'}</small></span>
        </button>
        <div className="ai-tool" style={{ cursor: 'default' }}>
          <Clock size={18} />
          <span style={{ flex: 1 }}>
            <strong>Auf Länge kürzen</strong>
            <small>Schwächste Szenen fliegen raus.</small>
            <span className="chips" style={{ marginTop: 8 }}>
              {[6, 10, 15, 30].map((s) => <button key={s} className="chip" disabled={!!busy} onClick={() => onShorten(s)}>{s} s</button>)}
            </span>
          </span>
        </div>
      </div>

      <div className="group">
        <span className="side-title"><Mic size={13} style={{ verticalAlign: -2 }} /> Auto-Untertitel (Spracherkennung)</span>
        <div className="segmented">
          {(Object.keys(LANGUAGES) as Language[]).map((l) => <button key={l} className={caps.language === l ? 'active' : ''} onClick={() => setCaps({ ...caps, language: l })}>{LANGUAGES[l]}</button>)}
        </div>
        <div className="chips">
          {([['karaoke', 'Karaoke'], ['word', 'Wort für Wort'], ['pop', 'Klassisch']] as [TextItem['anim'], string][]).map(([a, label]) => (
            <button key={a} className={`chip${caps.anim === a ? ' active' : ''}`} onClick={() => setCaps({ ...caps, anim: a })}>{label}</button>
          ))}
          <button className={`chip${caps.style === 'neon' ? ' active' : ''}`} onClick={() => setCaps({ ...caps, style: caps.style === 'neon' ? 'caption' : 'neon' })}>Neon</button>
          <button className={`chip${caps.upper ? ' active' : ''}`} onClick={() => setCaps({ ...caps, upper: !caps.upper })}>GROSS</button>
        </div>
        <button className="ai-tool" disabled={!!busy || !project.clips.length} onClick={() => onAutoCaptions(caps)}>
          <Captions size={18} />
          <span><strong>Untertitel automatisch erzeugen</strong><small>Whisper-KI erkennt das Gesprochene wortgenau – direkt im Browser. Beim ersten Mal wird das Modell (~80 MB) geladen.</small></span>
        </button>
      </div>

      <div className="group">
        <span className="side-title"><Captions size={13} style={{ verticalAlign: -2 }} /> Untertitel aus Skript</span>
        <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={4} placeholder="Gesprochenen Text hier einfügen – er wird automatisch auf die Sprechpassagen verteilt." />
        <button className="btn btn-sm" disabled={!script.trim()} onClick={() => onScript(script)}><ListOrdered size={14} /> Untertitel erzeugen</button>
      </div>
    </div>
  );
}

/* ---------------- Effekte ---------------- */

const TRANSITION_TILES: [Transition, string, string][] = [
  ['none', '✂️', 'Schnitt'], ['fade', '🌫️', 'Überblenden'], ['zoom', '🔍', 'Zoom'], ['slide', '➡️', 'Schieben'], ['whip', '💨', 'Wischen'],
  ['spin', '🌀', 'Drehen'], ['flash', '⚡', 'Blitz'], ['blur', '💧', 'Unschärfe'], ['glitch', '👾', 'Glitch'],
];

export function EffectsPanel({ project, current, busy, onApplyEffect, onApplyTransition, onAiEffects, onClose }: {
  project: Project;
  /** Clip, auf den Effekte angewendet werden (ausgewählt oder am Abspielkopf) */
  current: Clip | null;
  busy: string | null;
  onApplyEffect: (e: Effect, all: boolean) => void;
  onApplyTransition: (t: Transition, all: boolean) => void;
  onAiEffects: () => void;
  onClose?: () => void;
}) {
  const [all, setAll] = useState(false);
  return (
    <div className="side-scroll">
      {onClose ? <div className="field-row"><span className="side-title" style={{ flex: 1 }}>Effekte</span><button className="icon-btn side-close" onClick={onClose}><X size={18} /></button></div> : null}
      <button className="ai-tool" disabled={!!busy || !project.clips.length} onClick={onAiEffects}>
        <Wand2 size={18} />
        <span><strong>KI-Effekte für das ganze Video</strong><small>Die KI wählt pro Clip Effekt, Übergang, Filter und Kamerafahrt.</small></span>
      </button>
      {busy ? <div className="notice" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> {busy}</div> : null}
      <div className="segmented">
        <button className={!all ? 'active' : ''} onClick={() => setAll(false)}>Aktueller Clip</button>
        <button className={all ? 'active' : ''} onClick={() => setAll(true)}>Alle Clips</button>
      </div>
      <span className="side-title">Video-Effekte</span>
      <div className="fx-grid">
        {(Object.keys(EFFECTS) as Effect[]).map((e) => (
          <button key={e} className={`fx-tile${!all && current?.effect === e ? ' active' : ''}`} disabled={!project.clips.length} onClick={() => onApplyEffect(e, all)} title={EFFECTS[e].hint}>
            <span>{EFFECTS[e].icon}</span>
            {EFFECTS[e].label}
            {EFFECTS[e].beat ? <i>Beat</i> : null}
          </button>
        ))}
      </div>
      <span className="side-title">Übergänge</span>
      <div className="fx-grid">
        {TRANSITION_TILES.map(([t, icon, label]) => (
          <button key={t} className={`fx-tile${!all && current?.transition === t ? ' active' : ''}`} disabled={!project.clips.length} onClick={() => onApplyTransition(t, all)}>
            <span>{icon}</span>{label}
          </button>
        ))}
      </div>
      <p className="hint">{all ? 'Wird auf alle Clips angewendet.' : current ? 'Wird auf den ausgewählten Clip (bzw. den am Abspielkopf) angewendet. Übergänge gelten am Anfang des Clips.' : 'Clip auswählen oder Abspielkopf auf einen Clip setzen.'}</p>
    </div>
  );
}
