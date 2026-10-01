'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AudioLines, Captions, Check, Clapperboard, Download, Film, Music, Scissors, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import { Brand } from '../components/brand';
import { Creator } from '../components/creator';
import { collectGarbage, db } from '../lib/db';
import { projectDuration } from '../lib/generate';
import type { Project } from '../lib/types';

export default function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);

  const load = useCallback(() => db.listProjects().then(setProjects).catch(() => setProjects([])), []);
  useEffect(() => { load(); }, [load]);

  const add = (list: File[]) => {
    const ok = list.filter((f) => /^(video|image|audio)\//.test(f.type) || /\.(mp4|mov|webm|m4v|jpe?g|png|webp|mp3|wav|m4a|aac)$/i.test(f.name));
    if (ok.length) setFiles((prev) => [...prev, ...ok]);
  };

  // Dateien überall auf der Seite ablegen
  useEffect(() => {
    const prevent = (e: DragEvent) => { e.preventDefault(); setOver(true); };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setOver(false); };
    const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); add([...(e.dataTransfer?.files || [])]); };
    window.addEventListener('dragover', prevent);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const remove = async (p: Project) => {
    if (!confirm(`„${p.name}“ löschen?`)) return;
    await db.deleteProject(p.id);
    await collectGarbage();
    load();
  };

  return (
    <div className="home">
      <header className="home-head">
        <Brand />
        <span className="badge badge-ai"><Sparkles size={12} /> KI-Videoeditor</span>
      </header>

      <main className="home-main">
        {files.length ? (
          <Creator files={files} onAdd={add} onCancel={() => setFiles([])} />
        ) : (
          <section className="hero">
            <div className="hero-copy">
              <h1>Marketing-Videos, <span>automatisch geschnitten.</span></h1>
              <p>Lade Clips, Fotos und Musik hoch – VYSN Video findet die besten Momente, schneidet im Takt, setzt Texte und Übergänge und liefert ein fertiges Reel. Feinschliff im Editor.</p>
              <ul className="hero-points">
                {['Auto-Schnitt mit KI-Szenenbewertung', 'Pausen in Sprechvideos entfernen', 'Schnitte im Takt der Musik', 'Reels, TikTok, Feed & YouTube', 'Hook, Untertitel & CTA per KI', 'Export als MP4 – direkt im Browser'].map((p) => (
                  <li key={p}><Check size={16} /> {p}</li>
                ))}
              </ul>
            </div>
            <label className={`drop${over ? ' over' : ''}`}>
              <span className="drop-icon"><Upload size={28} /></span>
              <h2>Dateien hierher ziehen</h2>
              <p>Videos, Fotos und optional ein Song. Alles wird lokal in deinem Browser verarbeitet – nichts wird hochgeladen.</p>
              <span className="btn btn-primary btn-lg btn-glow"><Wand2 size={18} /> Dateien auswählen</span>
              <input type="file" accept="video/*,image/*,audio/*" multiple onChange={(e) => { add([...(e.target.files || [])]); e.target.value = ''; }} />
            </label>
          </section>
        )}

        {projects?.length ? (
          <section>
            <div className="section-head">
              <h2>Meine Projekte</h2>
              <span className="muted small">{projects.length} {projects.length === 1 ? 'Projekt' : 'Projekte'}</span>
            </div>
            <div className="projects">
              {projects.map((p) => (
                <div key={p.id} className="project-card">
                  <Link href={`/editor?id=${p.id}`} className="project-thumb">
                    {p.thumb ? <img src={p.thumb} alt="" /> : <Film size={28} />}
                    <span className="badge">{p.format}</span>
                  </Link>
                  <div className="project-meta">
                    <div>
                      <Link href={`/editor?id=${p.id}`}><strong>{p.name}</strong></Link>
                      <small>{Math.round(projectDuration(p))} s · {new Date(p.updatedAt).toLocaleDateString('de-DE')}</small>
                    </div>
                    <button className="icon-btn" onClick={() => remove(p)} aria-label="Projekt löschen"><Trash2 size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {!files.length ? (
          <section className="features">
            <Feature icon={<Scissors />} title="KI-Schnitt" text="Szenenwechsel, Bewegung, Schärfe und Ton werden analysiert. Die stärksten Momente landen im Video, der Hook ganz vorne." />
            <Feature icon={<AudioLines />} title="Im Takt der Musik" text="Tempo und Beats deines Songs werden erkannt – Schnitte sitzen auf dem Beat, Originalton wird automatisch abgesenkt." />
            <Feature icon={<Captions />} title="Texte, die verkaufen" text="Hook, Einblendungen und Call-to-Action – auf Wunsch von der KI-Regie passend zu deinen Bildern geschrieben." />
            <Feature icon={<Clapperboard />} title="Editor wie in CapCut" text="Timeline mit Trimmen, Teilen, Verschieben, Tempo, Filtern, Übergängen, Kamerafahrten und animierten Texten." />
            <Feature icon={<Music />} title="Sprechvideos" text="Pausen und Versprecher-Lücken werden automatisch herausgeschnitten. Untertitel aus deinem Skript mit einem Klick." />
            <Feature icon={<Download />} title="Export für jede Plattform" text="9:16, 1:1, 4:5 oder 16:9 in 720p oder 1080p – als MP4 (oder WebM) direkt aus dem Browser." />
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="feature">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
