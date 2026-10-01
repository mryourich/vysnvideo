/**
 * KI-Regie über Claude. Zwei Aufgaben:
 * – mode "plan": sieht Vorschaubilder der besten Abschnitte + Briefing und liefert
 *   Reihenfolge, Hook, Untertitel und Call-to-Action.
 * – mode "effects": sieht die Clips der Timeline und wählt je Clip Effekt, Übergang,
 *   Filter und Kamerafahrt (wie CapCuts Auto-Effekte).
 * Ohne ANTHROPIC_API_KEY antwortet die Route mit 501 – die App nutzt dann die lokale Automatik.
 */
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Brief = { goal: string; style: string; duration: number; product: string; message: string; cta: string; format: string; language?: string };
type Frame = { image: string; length: number; source: string; motion?: number; speech?: boolean };
type Body = { mode?: 'plan' | 'effects'; brief: Brief; frames: Frame[]; bpm?: number | null };

const EFFECTS = ['none', 'pulse', 'shake', 'flash-beat', 'glitch', 'rgb', 'vhs', 'grain', 'vignette', 'lightleak', 'glow', 'mirror', 'strobe'];
const TRANSITIONS = ['none', 'fade', 'zoom', 'slide', 'flash', 'blur', 'whip', 'spin', 'glitch'];
const FILTERS = ['none', 'vivid', 'warm', 'cool', 'mono', 'cinema', 'fade'];
const MOTIONS = ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right'];

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'hook', 'order', 'captions', 'cta', 'style'],
  properties: {
    title: { type: 'string', description: 'Kurzer Projektname' },
    hook: { type: 'string', description: 'Einstiegstext für die ersten 2 Sekunden, max. 6 Wörter, darf 1 Emoji enthalten' },
    order: { type: 'array', items: { type: 'integer' }, description: 'Indizes der Bilder in der besten Reihenfolge für das Video; schwache/unscharfe/doppelte weglassen' },
    captions: { type: 'array', items: { type: 'string' }, description: '2–4 kurze Texteinblendungen (je max. 7 Wörter) für die Mitte des Videos' },
    cta: { type: 'string', description: 'Call-to-Action am Ende, max. 4 Wörter' },
    style: { type: 'string', enum: ['dynamic', 'elegant', 'minimal', 'bold'] },
  },
} as const;

const EFFECTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clips'],
  properties: {
    clips: {
      type: 'array',
      description: 'Genau ein Eintrag pro Clip, in derselben Reihenfolge wie die Bilder',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['effect', 'amount', 'transition', 'filter', 'motion'],
        properties: {
          effect: { type: 'string', enum: EFFECTS },
          amount: { type: 'number', description: 'Effektstärke 0.2–1' },
          transition: { type: 'string', enum: TRANSITIONS, description: 'Übergang vom vorherigen Clip in diesen' },
          filter: { type: 'string', enum: FILTERS },
          motion: { type: 'string', enum: MOTIONS, description: 'Kamerafahrt, v. a. für Fotos' },
        },
      },
    },
  },
} as const;

const GOALS: Record<string, string> = {
  product: 'ein Produkt vorstellen',
  offer: 'ein zeitlich begrenztes Angebot bewerben',
  brand: 'die Firma vorstellen (Imagevideo)',
  event: 'ein Event bewerben',
  recruiting: 'neue Mitarbeiter gewinnen',
};

const EFFECT_GUIDE = `Verfügbare Effekte: pulse (Zoom auf den Beat), flash-beat (weißer Blitz auf den Beat), shake (Kamerawackeln, Action),
strobe (Hell/Dunkel im Takt), glitch (digitale Störung), rgb (Farbkanäle versetzt), vhs (Retro-Kassette), grain (Filmkorn),
vignette (dunkle Ränder), lightleak (warmes Licht, emotional), glow (weiches Leuchten), mirror (gespiegelt), none.
Übergänge: none (harter Schnitt), fade, zoom, slide, flash, blur, whip (schneller Wisch), spin (Drehung), glitch.
Filter: none, vivid, warm, cool, mono, cinema, fade (vintage). Kamerafahrt: none, zoom-in, zoom-out, pan-left, pan-right.
Regeln: Der erste Clip ist der Hook – kräftig, aber Übergang "none". Nicht jeder Clip braucht einen Effekt; Abwechslung,
aber ein durchgehender Look (meist ein Filter für alle). Sprechende Personen: ruhige Effekte, keine Glitches/Wackler.
Fotos brauchen eine Kamerafahrt. Action/Bewegung verträgt shake/pulse, Produkte und Emotion eher glow/lightleak/vignette.`;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return NextResponse.json({ error: 'KI-Regie ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt).' }, { status: 501 });
  }
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 });
  }
  const mode = body.mode === 'effects' ? 'effects' : 'plan';
  const frames = (body.frames || []).slice(0, mode === 'effects' ? 24 : 16).filter((f) => typeof f.image === 'string' && f.image.startsWith('data:image/jpeg;base64,'));
  if (!frames.length) return NextResponse.json({ error: 'Keine Bilder.' }, { status: 400 });
  const b = body.brief || ({} as Brief);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  frames.forEach((f, i) => {
    const facts = [`${f.source}`, `Länge ${f.length.toFixed(1)} s`];
    if (f.motion !== undefined) facts.push(`Bewegung ${Math.round(f.motion * 100)} %`);
    if (f.speech) facts.push('Person spricht');
    content.push({ type: 'text', text: `${mode === 'effects' ? 'Clip' : 'Bild'} ${i} – ${facts.join(', ')}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.image.slice('data:image/jpeg;base64,'.length) } });
  });
  const briefText = [
    b.goal ? `Ziel des Videos: ${GOALS[b.goal] || b.goal}.` : '',
    `Format: ${b.format || '9:16'}, Länge ca. ${b.duration || 20} Sekunden, gewünschter Stil: ${b.style || 'dynamic'}.`,
    b.product ? `Produkt / Thema: ${b.product}` : '',
    b.message ? `Kernbotschaft: ${b.message}` : '',
  ];
  if (mode === 'plan') {
    content.push({
      type: 'text',
      text: [
        ...briefText,
        b.cta ? `Gewünschter Call-to-Action: ${b.cta}` : '',
        `Sprache der Texte: ${b.language || 'Deutsch'}.`,
        'Wähle die Reihenfolge der Bilder für ein Social-Media-Marketingvideo: das stärkste, auffälligste Bild zuerst (Hook), dann eine kleine Geschichte, ein starkes Bild am Schluss. Schreibe knackige Texte, die zum Bildinhalt passen. Erfinde keine Preise oder Fakten, die nicht im Briefing stehen.',
      ].filter(Boolean).join('\n'),
    });
  } else {
    content.push({
      type: 'text',
      text: [
        ...briefText,
        body.bpm ? `Hintergrundmusik mit ca. ${body.bpm} BPM – Takt-Effekte (pulse, flash-beat, strobe) sitzen auf dem Beat.` : 'Keine Musik – Takt-Effekte reagieren auf die Schnitte.',
        EFFECT_GUIDE,
        `Wähle für jeden der ${frames.length} Clips Effekt, Stärke, Übergang, Filter und Kamerafahrt – wie ein professioneller CapCut-Editor für virale Marketing-Videos.`,
      ].filter(Boolean).join('\n'),
    });
  }

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: mode === 'plan' ? PLAN_SCHEMA : EFFECTS_SCHEMA } },
      system: 'Du bist Cutter, Motion-Designer und Social-Media-Texter für kleine Unternehmen. Antworte ausschließlich im vorgegebenen JSON-Format.',
      messages: [{ role: 'user', content }],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'Die KI hat diese Anfrage abgelehnt.' }, { status: 422 });
    }
    const text = response.content.find((c): c is Anthropic.Beta.BetaTextBlock => c.type === 'text')?.text;
    if (!text) return NextResponse.json({ error: 'Leere Antwort der KI.' }, { status: 502 });
    const result = JSON.parse(text);
    if (mode === 'plan') {
      result.order = (result.order as number[]).filter((i) => Number.isInteger(i) && i >= 0 && i < frames.length);
    } else {
      result.clips = (result.clips as { effect: string; transition: string; filter: string; motion: string; amount: number }[])
        .slice(0, frames.length)
        .map((c) => ({
          effect: EFFECTS.includes(c.effect) ? c.effect : 'none',
          amount: Math.min(1, Math.max(0.1, Number(c.amount) || 0.6)),
          transition: TRANSITIONS.includes(c.transition) ? c.transition : 'none',
          filter: FILTERS.includes(c.filter) ? c.filter : 'none',
          motion: MOTIONS.includes(c.motion) ? c.motion : 'none',
        }));
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return NextResponse.json({ error: 'API-Schlüssel ungültig.' }, { status: 502 });
    if (error instanceof Anthropic.RateLimitError) return NextResponse.json({ error: 'KI gerade ausgelastet – bitte gleich nochmal.' }, { status: 429 });
    if (error instanceof Anthropic.APIError) return NextResponse.json({ error: `KI-Fehler (${error.status}).` }, { status: 502 });
    return NextResponse.json({ error: 'KI-Antwort konnte nicht gelesen werden.' }, { status: 502 });
  }
}
