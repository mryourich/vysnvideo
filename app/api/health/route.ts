import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Erreichbarkeitstest für das Hosting: liefert {"status":"ok",...}. */
export function GET() {
  return NextResponse.json({
    status: 'ok',
    app: 'vysn-video',
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
    time: new Date().toISOString(),
  });
}
