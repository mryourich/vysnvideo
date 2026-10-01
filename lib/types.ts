/** Datenmodell des Video Studios. Zeiten immer in Sekunden. */

export type MediaKind = 'video' | 'image' | 'audio';

/** Erkanntes Wort mit Zeit (Sekunden) */
export type Word = { text: string; start: number; end: number };

/** Ergebnis der KI-Analyse eines Videos: Abschnitte zwischen Szenenwechseln/Pausen mit Bewertung. */
export type Segment = {
  start: number;
  end: number;
  /** 0–1: wie „sehenswert“ der Abschnitt ist (Bewegung, Schärfe, Farbe, Ton) */
  score: number;
  motion: number;
  speech: boolean;
  thumb: string;
};

export type MediaAnalysis = {
  /** Szenenwechsel (Sekunden) */
  cuts: number[];
  segments: Segment[];
  /** Sprechpassagen [start, end] aus der Lautstärke-Analyse */
  speech: [number, number][];
  /** Lautstärkeverlauf (0–1, 10 Werte pro Sekunde) für die Wellenform */
  loudness: number[];
  /** Nur Musik: erkannte Beats (Sekunden) und Tempo */
  beats?: number[];
  bpm?: number;
};

export type MediaAsset = {
  id: string;
  kind: MediaKind;
  name: string;
  mime: string;
  duration: number;
  width: number;
  height: number;
  /** Vorschaubilder für die Timeline (Data-URLs) */
  thumbs: string[];
  analysis?: MediaAnalysis;
  /** Ergebnis der Spracherkennung (Zeiten in der Quelldatei) */
  transcript?: Word[];
  transcriptLanguage?: string;
  createdAt: string;
};

export type Format = '9:16' | '1:1' | '4:5' | '16:9';

export const FORMATS: Record<Format, { label: string; w: number; h: number; hint: string }> = {
  '9:16': { label: 'Hochformat 9:16', w: 1080, h: 1920, hint: 'Reels, TikTok, Shorts, Stories' },
  '1:1': { label: 'Quadrat 1:1', w: 1080, h: 1080, hint: 'Instagram- und Facebook-Feed' },
  '4:5': { label: 'Portrait 4:5', w: 1080, h: 1350, hint: 'Instagram-Feed (mehr Fläche)' },
  '16:9': { label: 'Querformat 16:9', w: 1920, h: 1080, hint: 'YouTube, Website, LinkedIn' },
};

export type Filter = 'none' | 'vivid' | 'warm' | 'cool' | 'mono' | 'cinema' | 'fade';
export type Transition = 'none' | 'fade' | 'zoom' | 'slide' | 'flash' | 'blur' | 'whip' | 'spin' | 'glitch';

export type Effect = 'none' | 'pulse' | 'shake' | 'flash-beat' | 'glitch' | 'rgb' | 'vhs' | 'grain' | 'vignette' | 'lightleak' | 'glow' | 'mirror' | 'strobe';
export type Motion = 'none' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right';

export type Clip = {
  id: string;
  assetId: string;
  /** Ausschnitt aus der Quelle */
  in: number;
  out: number;
  speed: number;
  volume: number;
  filter: Filter;
  /** Übergang am Anfang dieses Clips (vom vorherigen Clip) */
  transition: Transition;
  motion: Motion;
  /** Video-Effekt (wie in CapCut), Stärke 0–1 */
  effect?: Effect;
  effectAmount?: number;
  /** Bildausschnitt: 'cover' füllt das Format, 'contain' zeigt alles mit unscharfem Hintergrund */
  fit: 'cover' | 'contain';
};

export type TextStyle = 'hook' | 'title' | 'caption' | 'cta' | 'label' | 'price' | 'neon';
export type TextAnim = 'none' | 'pop' | 'fade' | 'slide-up' | 'typewriter' | 'bounce' | 'karaoke' | 'word';

export type TextItem = {
  id: string;
  text: string;
  start: number;
  end: number;
  /** Position (0–1) des Textmittelpunkts */
  x: number;
  y: number;
  style: TextStyle;
  anim: TextAnim;
  color: string;
  accent: string;
  size: number;
  /** Wortgenaue Zeiten (aus der Spracherkennung) für Karaoke-Untertitel */
  words?: Word[];
};

export type MusicTrack = {
  assetId: string;
  volume: number;
  /** Startpunkt innerhalb des Songs */
  offset: number;
  fadeOut: boolean;
  /** Originalton der Clips leiser stellen, solange Musik läuft */
  ducking: boolean;
};

export type Project = {
  id: string;
  name: string;
  format: Format;
  clips: Clip[];
  texts: TextItem[];
  music: MusicTrack | null;
  /** Alle Medien des Projekts (Medienablage) */
  library: string[];
  /** Logo als Wasserzeichen oben rechts */
  watermark: boolean;
  /** Logo als Data-URL (optional) */
  logo: string;
  /** Hintergrundfarbe für Ränder */
  background: string;
  brandColor: string;
  /** Briefing, mit dem das Video erstellt wurde (für „Neu generieren“) */
  brief?: Brief;
  thumb: string;
  createdAt: string;
  updatedAt: string;
};

export type Style = 'dynamic' | 'elegant' | 'minimal' | 'bold';

export const STYLES: Record<Style, { label: string; hint: string; cut: number; transitions: Transition[]; anims: TextAnim[]; filter: Filter; effects: Effect[] }> = {
  dynamic: { label: 'Dynamisch', hint: 'Schnelle Schnitte im Takt, Zooms – ideal für Reels', cut: 1.3, transitions: ['zoom', 'whip', 'flash', 'spin', 'none'], anims: ['pop', 'bounce'], filter: 'vivid', effects: ['pulse', 'flash-beat', 'shake'] },
  elegant: { label: 'Elegant', hint: 'Ruhige Überblendungen, langsame Kamerafahrten', cut: 3.2, transitions: ['fade', 'blur'], anims: ['fade', 'slide-up'], filter: 'cinema', effects: ['lightleak', 'glow', 'vignette'] },
  minimal: { label: 'Minimal', hint: 'Klare harte Schnitte, dezente Texte', cut: 2.2, transitions: ['none'], anims: ['fade'], filter: 'none', effects: ['vignette'] },
  bold: { label: 'Auffällig', hint: 'Große Texte, Blitz-Übergänge, kräftige Farben', cut: 1.6, transitions: ['glitch', 'flash', 'zoom', 'whip'], anims: ['bounce', 'pop', 'word'], filter: 'vivid', effects: ['glitch', 'rgb', 'pulse', 'strobe'] },
};

export type Goal = 'product' | 'offer' | 'brand' | 'event' | 'recruiting';

export const GOALS: Record<Goal, { label: string; hook: string; cta: string }> = {
  product: { label: 'Produkt vorstellen', hook: 'Das musst du sehen 👀', cta: 'Jetzt entdecken' },
  offer: { label: 'Angebot / Aktion', hook: 'Nur für kurze Zeit 🔥', cta: 'Jetzt sichern' },
  brand: { label: 'Firma vorstellen', hook: 'Das sind wir', cta: 'Lerne uns kennen' },
  event: { label: 'Event bewerben', hook: 'Save the Date 📅', cta: 'Jetzt anmelden' },
  recruiting: { label: 'Mitarbeiter finden', hook: 'Wir suchen dich!', cta: 'Jetzt bewerben' },
};

export type Brief = {
  goal: Goal;
  style: Style;
  format: Format;
  /** Ziellänge in Sekunden */
  duration: number;
  product: string;
  message: string;
  cta: string;
  /** Pausen in Sprechvideos automatisch herausschneiden */
  removeSilence: boolean;
  /** KI-Texte über Claude (falls Server-Schlüssel vorhanden) */
  useAi: boolean;
};

/** Antwort der KI-Regie (/api/video/ai) */
export type AiPlan = {
  title: string;
  hook: string;
  /** Reihenfolge der besten Abschnitte als Index in die gesendete Liste */
  order: number[];
  captions: string[];
  cta: string;
  style?: Style;
};

/** Antwort der KI-Effekte (/api/ai, mode=effects): je Clip Effekt, Übergang, Filter, Kamerafahrt */
export type AiEffects = {
  clips: { effect: Effect; amount: number; transition: Transition; filter: Filter; motion: Motion }[];
};
