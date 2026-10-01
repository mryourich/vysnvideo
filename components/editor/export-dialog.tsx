'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Share2, X } from 'lucide-react';
import { exportMime } from '../../lib/engine';
import type { Player } from '../../lib/engine';
import { download } from '../../lib/browser';

export function ExportDialog({ player, name, onClose }: { player: Player; name: string; onClose: () => void }) {
  const [height, setHeight] = useState<720 | 1080>(1080);
  const [fps, setFps] = useState<30 | 60>(30);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ blob: Blob; ext: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const { ext } = exportMime();
  const file = `${(name || 'video').replace(/[^\wäöüÄÖÜß -]+/g, '').trim() || 'video'}.${result?.ext || ext}`;

  useEffect(() => () => abort.current?.abort(), []);
  const previewUrl = useMemo(() => (result ? URL.createObjectURL(result.blob) : ''), [result]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function start() {
    setError(null);
    setResult(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const res = await player.export({ height, fps, onProgress: setProgress, signal: abort.current.signal });
      setResult(res);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message || 'Export fehlgeschlagen.');
    }
    setProgress(null);
  }

  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare && !!result && navigator.canShare({ files: [new File([result.blob], file, { type: result.blob.type })] });

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Exportieren">
        <div className="modal-head">
          <h2>Video exportieren</h2>
          <button className="icon-btn" onClick={() => { abort.current?.abort(); onClose(); }} aria-label="Schließen"><X size={18} /></button>
        </div>
        <div className="modal-body">
          {result ? (
            <>
              <video src={previewUrl} controls playsInline style={{ width: '100%', maxHeight: 360, borderRadius: 10, background: '#000' }} />
              <p className="muted small">{file} · {(result.blob.size / 1024 / 1024).toFixed(1)} MB</p>
            </>
          ) : progress !== null ? (
            <>
              <p>Video wird gerendert … {Math.round(progress * 100)} %</p>
              <span className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>
              <p className="hint">Der Export läuft in Echtzeit. Bitte diesen Tab geöffnet und im Vordergrund lassen.</p>
            </>
          ) : (
            <>
              <div className="field">
                <span className="field-label">Auflösung</span>
                <div className="segmented">
                  <button className={height === 720 ? 'active' : ''} onClick={() => setHeight(720)}>720p</button>
                  <button className={height === 1080 ? 'active' : ''} onClick={() => setHeight(1080)}>1080p (Full HD)</button>
                </div>
              </div>
              <div className="field">
                <span className="field-label">Bildrate</span>
                <div className="segmented">
                  <button className={fps === 30 ? 'active' : ''} onClick={() => setFps(30)}>30 fps</button>
                  <button className={fps === 60 ? 'active' : ''} onClick={() => setFps(60)}>60 fps</button>
                </div>
              </div>
              <p className="hint">Dateiformat: {ext.toUpperCase()}{ext === 'webm' ? ' – dein Browser kann kein MP4 aufnehmen. Instagram/TikTok akzeptieren WebM beim Upload am Computer; für MP4 Chrome oder Edge nutzen.' : ' – passt für Instagram, TikTok, YouTube und LinkedIn.'}</p>
            </>
          )}
          {error ? <div className="notice notice-error">{error}</div> : null}
        </div>
        <div className="modal-foot">
          {result ? (
            <>
              <button className="btn" onClick={() => setResult(null)}>Neu exportieren</button>
              {canShare ? (
                <button className="btn" onClick={() => navigator.share({ files: [new File([result.blob], file, { type: result.blob.type })], title: name }).catch(() => {})}><Share2 size={15} /> Teilen</button>
              ) : null}
              <button className="btn btn-primary" onClick={() => download(result.blob, file)}><Download size={15} /> Herunterladen</button>
            </>
          ) : progress !== null ? (
            <button className="btn" onClick={() => abort.current?.abort()}>Abbrechen</button>
          ) : (
            <button className="btn btn-primary btn-glow" onClick={start}><Download size={15} /> Exportieren</button>
          )}
        </div>
      </div>
    </div>
  );
}
