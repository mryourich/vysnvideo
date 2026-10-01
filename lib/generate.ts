/**
 * Auto-Schnitt: baut aus hochgeladenen Medien + Kurzbriefing ein fertiges Marketing-Video
 * (Clips, Übergänge, Kamerafahrten, Texte, Musik im Takt).
 */
import { FORMATS, GOALS, STYLES } from './types';
import type { AiPlan, Brief, Clip, MediaAsset, Motion, Project, Segment, TextItem } from './types';
import { now, uid } from './util';

export const DEFAULT_BRIEF: Brief = {
  goal: 'product',
  style: 'dynamic',
  format: '9:16',
  duration: 20,
  product: '',
  message: '',
  cta: '',
  removeSilence: true,
  useAi: true,
};

/** Ein Kandidat für den Schnitt: Abschnitt eines Videos oder ein Bild. */
export type Candidate = { assetId: string; start: number; end: number; score: number; thumb: string; image: boolean };

export function candidates(assets: MediaAsset[]): Candidate[] {
  const list: Candidate[] = [];
  for (const a of assets) {
    if (a.kind === 'image') list.push({ assetId: a.id, start: 0, end: 3, score: 0.55, thumb: a.thumbs[0], image: true });
    if (a.kind === 'video') {
      const segs: Segment[] = a.analysis?.segments?.length ? a.analysis.segments : [{ start: 0, end: a.duration, score: 0.5, motion: 0, speech: false, thumb: a.thumbs[0] }];
      segs.forEach((s) => list.push({ assetId: a.id, start: s.start, end: s.end, score: s.score, thumb: s.thumb, image: false }));
    }
  }
  return list;
}

/** Sprechvideo („A-Roll“): überwiegend Sprache → Pausen schneiden statt Highlights suchen. */
export function isTalking(a: MediaAsset) {
  if (a.kind !== 'video' || !a.analysis?.speech.length) return false;
  const spoken = a.analysis.speech.reduce((s, [x, y]) => s + y - x, 0);
  return spoken / a.duration > 0.45 && a.duration > 6;
}

/** Auswahl, die an die KI-Regie geschickt wird (max. 16 Vorschaubilder). */
export function shortlist(assets: MediaAsset[], max = 16): Candidate[] {
  const all = candidates(assets).sort((a, b) => b.score - a.score);
  // jede Datei mindestens einmal
  const picked: Candidate[] = [];
  for (const a of assets) {
    const best = all.find((c) => c.assetId === a.id);
    if (best) picked.push(best);
  }
  for (const c of all) {
    if (picked.length >= max) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked.slice(0, max);
}

export function generateProject(assets: MediaAsset[], brief: Brief, opts: { ai?: AiPlan | null; shortlist?: Candidate[]; name?: string; logo?: string } = {}): Project {
  const style = STYLES[opts.ai?.style || brief.style];
  const visuals = assets.filter((a) => a.kind !== 'audio');
  const music = assets.find((a) => a.kind === 'audio') || null;
  const beat = music?.analysis?.bpm ? 60 / music.analysis.bpm : null;

  // Schnittlänge: Vielfaches des Beats in der Nähe der Stil-Länge
  const unit = beat ? Math.max(1, Math.round(style.cut / beat)) * beat : style.cut;

  const talking = visuals.filter(isTalking);
  let clips: Clip[] = [];

  if (talking.length && brief.removeSilence) {
    clips = talkingCut(talking, brief.duration);
    // Übrige Clips/Fotos als kurzer Abspann vor dem CTA
    const others = visuals.filter((v) => !talking.includes(v));
    if (others.length) clips.push(...highlightCut(others, { ...brief, duration: Math.min(3, others.length) * unit }, unit, null).map((c) => ({ ...c, volume: 0.3 })));
  } else {
    clips = highlightCut(visuals, brief, unit, opts.ai, opts.shortlist);
  }

  // Übergänge und Kamerafahrten
  const motions: Motion[] = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'];
  clips.forEach((c, i) => {
    c.transition = i === 0 ? 'none' : style.transitions[i % style.transitions.length];
    const asset = assets.find((a) => a.id === c.assetId);
    if (asset?.kind === 'image') c.motion = motions[i % motions.length];
    else if (brief.style === 'dynamic' || brief.style === 'bold') c.motion = i % 3 === 0 ? 'zoom-in' : 'none';
    else if (brief.style === 'elegant') c.motion = i % 2 ? 'zoom-in' : 'zoom-out';
    c.filter = style.filter;
  });

  const total = clips.reduce((s, c) => s + (c.out - c.in) / c.speed, 0);
  const texts = buildTexts(brief, total, opts.ai, style.anims);

  const first = assets.find((a) => a.id === clips[0]?.assetId);
  return {
    id: uid(),
    name: opts.name || opts.ai?.title || brief.product || GOALS[brief.goal].label,
    format: brief.format,
    clips,
    texts,
    music: music ? { assetId: music.id, volume: talking.length ? 0.25 : 0.8, offset: musicOffset(music), fadeOut: true, ducking: talking.length > 0 } : null,
    library: assets.map((a) => a.id),
    watermark: !!opts.logo,
    logo: opts.logo || '',
    background: '#000000',
    brandColor: '#007cfb',
    brief,
    thumb: first?.thumbs[Math.floor(first.thumbs.length / 3)] || first?.thumbs[0] || '',
    createdAt: now(),
    updatedAt: now(),
  };
}

export function newClip(asset: MediaAsset, start = 0, end?: number): Clip {
  return {
    id: uid(),
    assetId: asset.id,
    in: start,
    out: end ?? (asset.kind === 'image' ? 3 : asset.duration),
    speed: 1,
    volume: 1,
    filter: 'none',
    transition: 'none',
    motion: asset.kind === 'image' ? 'zoom-in' : 'none',
    fit: 'cover',
  };
}

/* ---------- Highlights (Produkt-, Image-, Event-Videos) ---------- */

function highlightCut(visuals: MediaAsset[], brief: Brief, unit: number, ai?: AiPlan | null, list?: Candidate[]): Clip[] {
  let pool = candidates(visuals);
  if (!pool.length) return [];
  const byId = new Map(visuals.map((a) => [a.id, a]));

  // Reihenfolge: KI-Regie, sonst: stärkster Moment als Hook, dann chronologisch je Datei, Abschluss stark
  let ordered: Candidate[];
  if (ai?.order?.length && list?.length) {
    ordered = ai.order.map((i) => list[i]).filter(Boolean);
    const rest = pool.filter((c) => !ordered.includes(c)).sort((a, b) => b.score - a.score);
    ordered = [...ordered, ...rest];
  } else {
    pool = pool.filter((c) => c.image || c.end - c.start >= 0.5);
    const ranked = [...pool].sort((a, b) => b.score - a.score);
    const needed = Math.ceil(brief.duration / unit) + 2;
    // Je Datei faire Anteile (Round-Robin über die Bestenliste)
    const perAsset = new Map<string, Candidate[]>();
    ranked.forEach((c) => perAsset.set(c.assetId, [...(perAsset.get(c.assetId) || []), c]));
    const chosen: Candidate[] = [];
    while (chosen.length < needed && [...perAsset.values()].some((l) => l.length)) {
      for (const l of perAsset.values()) {
        const c = l.shift();
        if (c) chosen.push(c);
        if (chosen.length >= needed) break;
      }
    }
    const hook = chosen[0];
    const middle = chosen.slice(1).sort((a, b) => (a.assetId === b.assetId ? a.start - b.start : visuals.findIndex((v) => v.id === a.assetId) - visuals.findIndex((v) => v.id === b.assetId)));
    // stärkster der restlichen Clips ans Ende (vor dem CTA)
    const strongest = middle.reduce((best, c, i) => (c.score > middle[best].score ? i : best), 0);
    const finale = middle.splice(strongest, 1);
    ordered = [hook, ...middle, ...finale].filter(Boolean);
  }

  const clips: Clip[] = [];
  let total = 0;
  let round = 0;
  while (total < brief.duration - 0.05 && round < 4) {
    for (const c of ordered) {
      if (total >= brief.duration - 0.05) break;
      const asset = byId.get(c.assetId);
      if (!asset) continue;
      const remaining = brief.duration - total;
      let len = Math.min(unit * (c.image ? 2 : 1), remaining);
      if (!c.image) {
        const avail = c.end - c.start;
        if (avail < len) len = beatFloor(avail, unit) || avail;
      }
      if (remaining - len < unit * 0.5) len = Math.min(remaining, c.image ? remaining : c.end - c.start);
      if (len < 0.3) continue;
      // Bei Wiederholung anderer Bereich im Abschnitt
      const avail = c.image ? len : c.end - c.start;
      const offset = c.image ? 0 : Math.min(avail - len, ((round * 0.37) % 1) * (avail - len) + Math.min(0.15, (avail - len) / 2));
      const clip = newClip(asset, c.image ? 0 : c.start + offset, c.image ? len : c.start + offset + len);
      clips.push(clip);
      total += len;
    }
    round++;
  }
  return clips;
}

/** Abrunden auf ganze Beats (mindestens ein halber Beat). */
function beatFloor(len: number, unit: number) {
  const half = unit / 2;
  return Math.floor(len / half) * half;
}

/* ---------- Sprechvideos: Pausen raus ---------- */

function talkingCut(talking: MediaAsset[], target: number): Clip[] {
  const clips: Clip[] = [];
  let total = 0;
  for (const a of talking) {
    for (const [s, e] of a.analysis!.speech) {
      // Ganze Sätze behalten, Ziel nur grob einhalten (+30 %)
      if (total > 0 && total + (e - s) > target * 1.3) break;
      clips.push(newClip(a, s, e));
      total += e - s;
    }
  }
  return clips;
}

/* ---------- Texte ---------- */

export function buildTexts(brief: Brief, total: number, ai: AiPlan | null | undefined, anims: TextItem['anim'][]): TextItem[] {
  const goal = GOALS[brief.goal];
  const accent = '#007cfb';
  const hook = ai?.hook || (brief.product ? `${goal.hook.replace(/[!👀🔥📅]+$/u, '').trim()}: ${brief.product}` : goal.hook);
  const cta = ai?.cta || brief.cta || goal.cta;
  const captions = ai?.captions?.length ? ai.captions : splitMessage(brief.message);
  const texts: TextItem[] = [];
  const hookEnd = Math.min(2.6, total * 0.25);
  texts.push(text(hook, 0.1, hookEnd, 0.5, 0.2, 'hook', anims[0], accent));

  const ctaLen = Math.min(3, Math.max(1.5, total * 0.18));
  const ctaStart = Math.max(hookEnd + 0.3, total - ctaLen);
  const window = ctaStart - hookEnd - 0.4;
  if (captions.length && window > 1) {
    const each = window / captions.length;
    captions.forEach((c, i) => {
      const s = hookEnd + 0.3 + i * each;
      texts.push(text(c, s, s + each - 0.15, 0.5, 0.74, 'caption', anims[(i + 1) % anims.length], accent));
    });
  }
  texts.push(text(cta, ctaStart, total, 0.5, 0.8, 'cta', 'pop', accent));
  if (brief.product && !ai?.hook) texts.push(text(brief.product, ctaStart, total, 0.5, 0.42, 'title', 'slide-up', accent));
  return texts;
}

export function text(value: string, start: number, end: number, x: number, y: number, style: TextItem['style'], anim: TextItem['anim'], accent = '#007cfb'): TextItem {
  return { id: uid(), text: value, start: +start.toFixed(2), end: +end.toFixed(2), x, y, style, anim, color: '#ffffff', accent, size: 1 };
}

function splitMessage(message: string) {
  return message
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
}

/** Musik ab dem ersten kräftigen Beat statt mit leisem Intro. */
function musicOffset(music: MediaAsset) {
  const loud = music.analysis?.loudness || [];
  const i = loud.findIndex((v) => v > 0.35);
  const t = i > 0 ? i * 0.1 : 0;
  const beat = music.analysis?.beats?.find((b) => b >= t - 0.05);
  return beat !== undefined && beat < music.duration - 10 ? beat : 0;
}

/* ---------- Werkzeuge für den Editor ---------- */

/** Pausen aus einem Clip entfernen → mehrere Clips. */
export function removeSilence(clip: Clip, asset: MediaAsset): Clip[] {
  const speech = asset.analysis?.speech || [];
  const parts = speech
    .map(([a, b]) => [Math.max(a, clip.in), Math.min(b, clip.out)] as [number, number])
    .filter(([a, b]) => b - a > 0.25);
  if (!parts.length) return [clip];
  return parts.map(([a, b], i) => ({ ...clip, id: i ? uid() : clip.id, in: a, out: b, transition: i ? 'none' : clip.transition }));
}

/** Clip-Längen an die Beats der Musik anpassen. */
export function snapToBeats(project: Project, music: MediaAsset): Clip[] {
  const beats = music.analysis?.beats || [];
  if (beats.length < 4 || !project.music) return project.clips;
  const offset = project.music.offset;
  const grid = beats.map((b) => b - offset).filter((b) => b > 0);
  let t = 0;
  return project.clips.map((c) => {
    const len = (c.out - c.in) / c.speed;
    const target = t + len;
    const snapped = grid.reduce((best, b) => (Math.abs(b - target) < Math.abs(best - target) && b > t + 0.3 ? b : best), target);
    const newLen = Math.max(0.3, snapped - t);
    t += newLen;
    return { ...c, out: c.in + newLen * c.speed };
  });
}

/** Untertitel aus einem Skript: auf die Sprechpassagen der Clips verteilen. */
export function captionsFromScript(script: string, project: Project, assets: MediaAsset[]): TextItem[] {
  const words = script.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  // Sprechzeiten auf der Timeline
  const spans: [number, number][] = [];
  let t = 0;
  for (const c of project.clips) {
    const len = (c.out - c.in) / c.speed;
    const a = assets.find((x) => x.id === c.assetId);
    const speech = a?.analysis?.speech || [];
    for (const [s, e] of speech) {
      const x = Math.max(s, c.in);
      const y = Math.min(e, c.out);
      if (y - x > 0.2) spans.push([t + (x - c.in) / c.speed, t + (y - c.in) / c.speed]);
    }
    t += len;
  }
  if (!spans.length) spans.push([0, t]);
  const spoken = spans.reduce((s, [a, b]) => s + b - a, 0);
  const perWord = spoken / words.length;
  // Gruppen von 3–4 Wörtern
  const items: TextItem[] = [];
  let w = 0;
  let span = 0;
  let cursor = spans[0][0];
  while (w < words.length && span < spans.length) {
    const group = words.slice(w, w + 4);
    const len = group.length * perWord;
    let start = cursor;
    if (start + len > spans[span][1] + 0.05) {
      span++;
      if (span >= spans.length) break;
      start = spans[span][0];
    }
    items.push(text(group.join(' '), start, Math.min(start + len, spans[span][1]), 0.5, 0.72, 'caption', 'pop'));
    cursor = start + len;
    w += group.length;
  }
  return items;
}

export const projectDuration = (p: Project) => p.clips.reduce((s, c) => s + (c.out - c.in) / c.speed, 0);

export function formatSize(p: Project) {
  return FORMATS[p.format];
}
