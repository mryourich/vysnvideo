import type { AiEffects, AiPlan, Brief, MediaAsset } from './types';
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

/** KI-Effekte: Claude wählt je Clip Effekt, Übergang, Filter, Kamerafahrt. null → lokale Automatik. */
export async function requestEffects(
  brief: Brief,
  clips: { thumb: string; length: number; source: string; motion: number; speech: boolean }[],
  bpm: number | null,
): Promise<{ effects: AiEffects | null; note: string | null }> {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'effects', brief, bpm, frames: clips.map((c) => ({ image: c.thumb, length: c.length, source: c.source, motion: c.motion, speech: c.speech })) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { effects: null, note: data.error || null };
    return { effects: data as AiEffects, note: null };
  } catch {
    return { effects: null, note: null };
  }
}
