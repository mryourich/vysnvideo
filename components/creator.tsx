'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Film, ImageIcon, Music, Plus, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { importFile } from '../lib/analyze';
import { requestPlan } from '../lib/ai';
import { db, registerUrl } from '../lib/db';
import { DEFAULT_BRIEF, generateProject, isTalking, shortlist } from '../lib/generate';
import { FORMATS, GOALS, STYLES } from '../lib/types';
import type { Brief, Format, Goal, MediaAsset, Style } from '../lib/types';
import { readLogo, storage } from '../lib/browser';

type Item = { key: string; file: File; progress: number; label: string; asset?: MediaAsset; error?: string };

const ACCEPT = 'video/*,image/*,audio/*';
const DURATIONS = [10, 15, 20, 30, 45, 60];

export function Creator({ files, onAdd, onCancel }: { files: File[]; onAdd: (f: File[]) => void; onCancel: () => void }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [brief, setBrief] = useState<Brief>(() => ({ ...DEFAULT_BRIEF, ...storage.get<Partial<Brief>>('vv-brief', {}) }));
  const [auto, setAuto] = useState(() => storage.get('vv-auto', true));
  const [logo, setLogo] = useState(() => storage.get('vv-logo', ''));
  const [subs, setSubs] = useState(() => storage.get('vv-subs', true));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const touched = useRef(false);
  const started = useRef(new Set<string>());

  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => {
    touched.current = true;
    setBrief((b) => ({ ...b, [k]: v }));
  };

  useEffect(() => storage.set('vv-brief', { ...brief, product: '', message: '', cta: '' }), [brief]);
  useEffect(() => storage.set('vv-auto', auto), [auto]);
  useEffect(() => storage.set('vv-subs', subs), [subs]);

  // Neue Dateien in die Liste übernehmen
  useEffect(() => {
    setItems((prev) => {
      const known = new Set(prev.map((i) => i.key));
      const add = files
        .map((file) => ({ key: `${file.name}-${file.size}-${file.lastModified}`, file, progress: 0, label: 'Wartet …' }))
        .filter((i) => !known.has(i.key));
      return add.length ? [...prev, ...add] : prev;
    });
  }, [files]);

  // Nacheinander analysieren
  useEffect(() => {
    const next = items.find((i) => !i.asset && !i.error && !started.current.has(i.key));
    if (!next || items.some((i) => started.current.has(i.key) && !i.asset && !i.error)) return;
    started.current.add(next.key);
    const update = (patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === next.key ? { ...i, ...patch } : i)));
    update({ label: 'Wird analysiert …' });
    importFile(next.file, (progress, label) => update({ progress, label }))
      .then(async (asset) => {
        await db.saveAsset(asset, next.file);
        registerUrl(asset.id, next.file);
        update({ asset, progress: 1, label: describe(asset) });
      })
      .catch((e: Error) => update({ error: e.message, label: e.message }));
  }, [items]);

  const ready = items.filter((i) => i.asset).map((i) => i.asset!);
  const pending = items.some((i) => !i.asset && !i.error);
  const visuals = ready.filter((a) => a.kind !== 'audio');
  const talking = visuals.some(isTalking);

  // Automatisch erstellen, sobald alles analysiert ist
  const autoFired = useRef(false);
  useEffect(() => {
    if (auto && !pending && visuals.length && !busy && !autoFired.current && !touched.current) {
      autoFired.current = true;
      create();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, pending, visuals.length]);

  async function create() {
    if (!visuals.length) return;
    setError(null);
    try {
      let plan = null;
      let list;
      if (brief.useAi && !talking) {
        setBusy('KI-Regie wählt die besten Szenen …');
        list = shortlist(ready);
        const res = await requestPlan(brief, list, ready);
        plan = res.plan;
        if (res.note) storage.set('vv-note', res.note);
      }
      setBusy('Video wird geschnitten …');
      const project = generateProject(ready, brief, { ai: plan, shortlist: list, logo });
      await db.saveProject(project);
      router.push(`/editor?id=${project.id}${plan ? '&ai=1' : ''}${subs && talking ? '&subs=1&lang=german' : ''}`);
    } catch (e) {
      setBusy(null);
      setError((e as Error).message || 'Video konnte nicht erstellt werden.');
    }
  }

  if (busy) {
    return (
      <div className="card generating">
        <div className="spinner" />
        <h2>{busy}</h2>
        <p className="muted">Szenen bewerten, Schnitte setzen, Texte und Übergänge einfügen.</p>
      </div>
    );
  }

  return (
    <div className="creator">
      <section className="card">
        <div className="card-head">
          <h2>Deine Medien</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Abbrechen"><X size={18} /></button>
        </div>
        <div className="files">
          {items.map((i) => (
            <div key={i.key} className="file-row">
              <span className="file-thumb">
                {i.asset?.thumbs[0] ? <img src={i.asset.thumbs[0]} alt="" /> : kindIcon(i.file)}
              </span>
              <span className="file-info">
                <strong>{i.file.name}</strong>
                <small className={i.error ? 'btn-danger' : ''}>{i.label}</small>
                {!i.asset && !i.error ? <span className="bar"><i style={{ width: `${Math.round(i.progress * 100)}%` }} /></span> : null}
              </span>
              <span>{i.asset ? <Check size={18} color="var(--success)" /> : i.error ? null : started.current.has(i.key) ? <span className="spinner" /> : null}</span>
            </div>
          ))}
        </div>
        <label className="add-more">
          <Plus size={16} /> Weitere Clips, Fotos oder Musik
          <input type="file" accept={ACCEPT} multiple onChange={(e) => { onAdd([...(e.target.files || [])]); e.target.value = ''; }} />
        </label>
        <p className="hint">Tipp: Lade eine Musikdatei mit hoch – dann wird im Takt geschnitten. Sprechvideos werden automatisch von Pausen befreit.</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Was soll das Video erreichen?</h2>
          <span className="badge badge-ai"><Sparkles size={12} /> KI</span>
        </div>
        <div className="chips">
          {(Object.keys(GOALS) as Goal[]).map((g) => (
            <button key={g} className={`chip${brief.goal === g ? ' active' : ''}`} onClick={() => set('goal', g)}>{GOALS[g].label}</button>
          ))}
        </div>

        <div className="form-grid">
          <label className="field">
            <span className="field-label">Produkt / Thema</span>
            <input type="text" value={brief.product} onChange={(e) => set('product', e.target.value)} placeholder="z. B. Sommer-Sneaker „Aero“" />
          </label>
          <label className="field">
            <span className="field-label">Call-to-Action</span>
            <input type="text" value={brief.cta} onChange={(e) => set('cta', e.target.value)} placeholder={GOALS[brief.goal].cta} />
          </label>
          <label className="field span-2">
            <span className="field-label">Kernbotschaft (optional, jeder Satz wird eine Einblendung)</span>
            <textarea value={brief.message} onChange={(e) => set('message', e.target.value)} placeholder="Federleicht. Wasserabweisend. Jetzt 20 % günstiger." rows={2} />
          </label>
        </div>

        <div className="field">
          <span className="field-label">Format</span>
          <div className="options">
            {(Object.keys(FORMATS) as Format[]).map((f) => {
              const s = FORMATS[f];
              const k = 22 / Math.max(s.w, s.h);
              return (
                <button key={f} className={`option${brief.format === f ? ' active' : ''}`} onClick={() => set('format', f)}>
                  <span className="format-shape" style={{ width: s.w * k, height: s.h * k }} />
                  <strong>{f}</strong>
                  <small>{s.hint}</small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Stil</span>
          <div className="options">
            {(Object.keys(STYLES) as Style[]).map((s) => (
              <button key={s} className={`option${brief.style === s ? ' active' : ''}`} onClick={() => set('style', s)}>
                <strong>{STYLES[s].label}</strong>
                <small>{STYLES[s].hint}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Länge</span>
          <div className="chips">
            {DURATIONS.map((d) => (
              <button key={d} className={`chip${brief.duration === d ? ' active' : ''}`} onClick={() => set('duration', d)}>{d} s</button>
            ))}
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <span className="field-label">Logo (optional, als Wasserzeichen)</span>
            <div className="field-row">
              {logo ? <img src={logo} alt="" style={{ height: 32, maxWidth: 90, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 3 }} /> : null}
              <label className="btn btn-sm">
                <ImageIcon size={14} /> {logo ? 'Ändern' : 'Logo wählen'}
                <input type="file" accept="image/*" hidden onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const url = await readLogo(f).catch(() => '');
                  setLogo(url);
                  storage.set('vv-logo', url);
                }} />
              </label>
              {logo ? <button className="icon-btn" onClick={() => { setLogo(''); storage.set('vv-logo', ''); }} aria-label="Logo entfernen"><Trash2 size={15} /></button> : null}
            </div>
          </div>
        </div>

        <label className="check"><input type="checkbox" checked={brief.removeSilence} onChange={(e) => set('removeSilence', e.target.checked)} /> Pausen in Sprechvideos automatisch herausschneiden</label>
        <label className="check"><input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)} /> Untertitel automatisch erzeugen, wenn gesprochen wird (Spracherkennung)</label>
        <label className="check"><input type="checkbox" checked={brief.useAi} onChange={(e) => set('useAi', e.target.checked)} /> KI-Regie: Szenen auswählen und Texte schreiben lassen</label>
        <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Nach dem Hochladen sofort automatisch erstellen</label>

        {error ? <div className="notice notice-error">{error}</div> : null}
        <div className="creator-actions">
          <span className="muted small">
            {pending ? 'Analyse läuft …' : `${visuals.length} Clips/Fotos${ready.some((a) => a.kind === 'audio') ? ' + Musik' : ''}${talking ? ' · Sprechvideo erkannt' : ''}`}
          </span>
          <button className="btn btn-primary btn-lg btn-glow" disabled={pending || !visuals.length} onClick={create}>
            <Wand2 size={18} /> Video erstellen
          </button>
        </div>
      </section>
    </div>
  );
}

function kindIcon(file: File) {
  if (file.type.startsWith('audio')) return <Music size={20} />;
  if (file.type.startsWith('image')) return <ImageIcon size={20} />;
  return <Film size={20} />;
}

function describe(a: MediaAsset) {
  if (a.kind === 'image') return `Foto · ${a.width}×${a.height}`;
  if (a.kind === 'audio') return `Musik · ${Math.round(a.duration)} s${a.analysis?.bpm ? ` · ${a.analysis.bpm} BPM` : ''}`;
  const scenes = a.analysis?.segments.length || 0;
  return `Video · ${a.duration.toFixed(1)} s · ${scenes} Szenen${isTalking(a) ? ' · Sprache' : ''}`;
}
