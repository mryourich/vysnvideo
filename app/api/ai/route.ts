/**
 * KI-Regie: Claude sieht Vorschaubilder der besten Abschnitte und das Briefing und liefert
 * Reihenfolge, Hook, Untertitel und Call-to-Action. Ohne ANTHROPIC_API_KEY antwortet die
 * Route mit 501 – die App nutzt dann die lokale Automatik.
 */
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Body = {
  brief: { goal: string; style: string; duration: number; product: string; message: string; cta: string; format: string; language?: string };
  /** JPEG-Data-URLs der Kandidaten, Index = Position */
  frames: { image: string; length: number; source: string }[];
};

const SCHEMA = {
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

const GOALS: Record<string, string> = {
  product: 'ein Produkt vorstellen',
  offer: 'ein zeitlich begrenztes Angebot bewerben',
  brand: 'die Firma vorstellen (Imagevideo)',
  event: 'ein Event bewerben',
  recruiting: 'neue Mitarbeiter gewinnen',
};

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
  const frames = (body.frames || []).slice(0, 16).filter((f) => typeof f.image === 'string' && f.image.startsWith('data:image/jpeg;base64,'));
  if (!frames.length) return NextResponse.json({ error: 'Keine Bilder.' }, { status: 400 });
  const b = body.brief;

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  frames.forEach((f, i) => {
    content.push({ type: 'text', text: `Bild ${i} – ${f.source}, verfügbare Länge ${f.length.toFixed(1)} s` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.image.slice('data:image/jpeg;base64,'.length) } });
  });
  content.push({
    type: 'text',
    text: [
      `Ziel des Videos: ${GOALS[b.goal] || b.goal}.`,
      `Format: ${b.format}, Länge ca. ${b.duration} Sekunden, gewünschter Stil: ${b.style}.`,
      b.product ? `Produkt / Thema: ${b.product}` : '',
      b.message ? `Kernbotschaft: ${b.message}` : '',
      b.cta ? `Gewünschter Call-to-Action: ${b.cta}` : '',
      `Sprache der Texte: ${b.language || 'Deutsch'}.`,
      'Wähle die Reihenfolge der Bilder für ein Social-Media-Marketingvideo: das stärkste, auffälligste Bild zuerst (Hook), dann eine kleine Geschichte, ein starkes Bild am Schluss. Schreibe knackige Texte, die zum Bildinhalt passen. Erfinde keine Preise oder Fakten, die nicht im Briefing stehen.',
    ].filter(Boolean).join('\n'),
  });

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: 'Du bist Cutter und Social-Media-Texter für kleine Unternehmen. Antworte ausschließlich im vorgegebenen JSON-Format.',
      messages: [{ role: 'user', content }],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'Die KI hat diese Anfrage abgelehnt.' }, { status: 422 });
    }
    const text = response.content.find((c): c is Anthropic.Beta.BetaTextBlock => c.type === 'text')?.text;
    if (!text) return NextResponse.json({ error: 'Leere Antwort der KI.' }, { status: 502 });
    const plan = JSON.parse(text);
    plan.order = (plan.order as number[]).filter((i) => Number.isInteger(i) && i >= 0 && i < frames.length);
    return NextResponse.json(plan);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return NextResponse.json({ error: 'API-Schlüssel ungültig.' }, { status: 502 });
    if (error instanceof Anthropic.RateLimitError) return NextResponse.json({ error: 'KI gerade ausgelastet – bitte gleich nochmal.' }, { status: 429 });
    if (error instanceof Anthropic.APIError) return NextResponse.json({ error: `KI-Fehler (${error.status}).` }, { status: 502 });
    return NextResponse.json({ error: 'KI-Antwort konnte nicht gelesen werden.' }, { status: 502 });
  }
}
