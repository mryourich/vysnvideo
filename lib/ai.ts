import type { AiPlan, Brief, MediaAsset } from './types';
import type { Candidate } from './generate';

/** Fragt die KI-Regie (Claude) an. Liefert null, wenn sie nicht verfügbar ist – dann greift die lokale Automatik. */
export async function requestPlan(brief: Brief, list: Candidate[], assets: MediaAsset[]): Promise<{ plan: AiPlan | null; note: string | null }> {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        brief,
        frames: list.map((c) => ({
          image: c.thumb,
          length: c.image ? 3 : c.end - c.start,
          source: `${c.image ? 'Foto' : 'Video'} „${assets.find((a) => a.id === c.assetId)?.name || ''}“`,
        })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { plan: null, note: data.error || 'KI-Regie nicht erreichbar – lokale Automatik verwendet.' };
    return { plan: data as AiPlan, note: null };
  } catch {
    return { plan: null, note: 'KI-Regie nicht erreichbar – lokale Automatik verwendet.' };
  }
}
