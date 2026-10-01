export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const now = () => new Date().toISOString();

/** 75.4 → "1:15.4" */
export function timecode(t: number, decimals = 1) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0')}`;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wartet auf ein Medien-Event (mit Timeout, damit nichts hängen bleibt). */
export function once(el: HTMLMediaElement, event: string, timeout = 8000) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); resolve(); }, timeout);
    const ok = () => { cleanup(); resolve(); };
    const err = () => { cleanup(); reject(new Error('Datei konnte nicht gelesen werden.')); };
    const cleanup = () => { clearTimeout(t); el.removeEventListener(event, ok); el.removeEventListener('error', err); };
    el.addEventListener(event, ok);
    el.addEventListener('error', err);
  });
}

/** Seek, der auch funktioniert, wenn das Ziel bereits erreicht ist. */
export async function seek(el: HTMLMediaElement, t: number) {
  if (Math.abs(el.currentTime - t) < 0.01 && el.readyState >= 2) return;
  const p = once(el, 'seeked', 3000);
  el.currentTime = t;
  await p;
}
