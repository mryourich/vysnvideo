# VYSN Video

KI-Videoeditor für Marketing-Videos (ähnlich CapCut): Clips, Fotos und Musik hochladen – VYSN Video
analysiert alles, schneidet automatisch ein fertiges Reel/TikTok/Werbevideo und öffnet es im Editor.

## Starten

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

Optional für die **KI-Regie** (Claude wählt Szenen-Reihenfolge und schreibt Hook, Einblendungen, CTA):

```bash
cp .env.example .env.local   # ANTHROPIC_API_KEY eintragen
```

Ohne Schlüssel läuft alles mit der lokalen Automatik.

## Veröffentlichen auf Hostinger

Die App braucht einen **Node.js-Server** (KI-Route `/api/ai`). Reines Webhosting über den
Dateimanager reicht nicht. Nach jedem Merge in `main` baut Hostinger automatisch neu.

1. hPanel → **Websites** → **Website hinzufügen** → **Node.js Web App**
   (ab Business-Webhosting oder Cloud-Hosting).
2. **Mit GitHub verbinden** → Repository `mryourich/vysnvideo`, Branch `main`.
3. Build-Einstellungen:
   - Framework: **Next.js**
   - Node-Version: **20** oder **22**
   - Root-Verzeichnis: `/` (leer lassen)
   - Build-Befehl: `npm run build`
   - Startbefehl: `npm start`
   - Paketmanager: `npm`
4. **Umgebungsvariablen** (optional, für die KI-Regie): `ANTHROPIC_API_KEY` = dein Schlüssel.
   Ohne Schlüssel läuft alles mit der lokalen Automatik.
5. Domain bzw. Subdomain (z. B. `video.deine-domain.com`) der Node.js-App zuweisen.
6. **Deploy** klicken. Test: `https://<domain>/api/health` liefert `{"status":"ok",...}`
   (`"ai": true`, wenn der Schlüssel gesetzt ist).

Hinweis: Die Videos werden im Browser verarbeitet und gespeichert – der Server braucht weder
Speicherplatz für Medien noch Datenbank. HTTPS ist nötig (Hostinger aktiviert SSL automatisch),
sonst funktionieren Videoverarbeitung und Teilen-Dialog in manchen Browsern nicht.

## Funktionen

| Bereich | Was passiert |
| --- | --- |
| **Upload → Auto-Video** | Dateien ablegen, Analyse läuft, Video wird automatisch erstellt (abschaltbar) |
| **KI-Analyse** (lokal) | Szenenwechsel, Bewegung, Schärfe, Farbe, Belichtung, Lautstärke → Bewertung je Abschnitt; Sprechpausen; Musik-Tempo (BPM) und Beats |
| **Auto-Schnitt** | Highlights (stärkster Moment als Hook, faire Verteilung über alle Dateien), Sprechvideos ohne Pausen, Schnittlänge auf den Beat, Übergänge, Kamerafahrten, Filter je Stil |
| **KI-Regie** (Claude, optional) | Sieht Vorschaubilder + Briefing, liefert Reihenfolge, Hook, Untertitel, CTA |
| **Editor** | Vorschau, Timeline mit Trimmen, Teilen, Verschieben, Duplizieren, Tempo, Lautstärke, Filter, Übergänge, Ken-Burns, Bildausschnitt; Texte mit 6 Stilen und Animationen, direkt in der Vorschau verschiebbar; Musikspur mit Wellenform, Beats, Ducking, Ausblenden; Undo/Redo, Tastenkürzel |
| **KI-Werkzeuge** | Neu generieren (Stil wechseln), Texte neu schreiben, Pausen entfernen, im Takt schneiden, auf 6/10/15/30 s kürzen, Untertitel aus Skript |
| **Export** | 9:16, 1:1, 4:5, 16:9 in 720p/1080p, 30/60 fps; MP4 (Chrome/Edge/Safari) oder WebM; Teilen-Dialog auf dem Handy |

Alle Medien und Projekte bleiben im Browser (IndexedDB) – es wird nichts hochgeladen. Nur für die
KI-Regie werden kleine Vorschaubilder an den eigenen Server (`/api/ai`) und von dort an Claude geschickt.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `app/page.tsx` | Startseite: Upload, Assistent, Projekte |
| `app/editor/page.tsx` | Editor (`/editor?id=…`) |
| `app/api/ai/route.ts` | KI-Regie über die Claude API (strukturierte JSON-Antwort) |
| `components/creator.tsx` | Upload-Analyse + Briefing + automatisches Erstellen |
| `components/editor/*` | Editor, Timeline, Inspector, Seitenleisten, Export |
| `lib/analyze.ts` | Medienanalyse (Szenen, Bewertung, Sprache, Beats) |
| `lib/generate.ts` | Auto-Schnitt und Schnitt-Werkzeuge |
| `lib/render.ts` | Zeichnet ein Bild zum Zeitpunkt t (Vorschau = Export) |
| `lib/engine.ts` | Player, Ton (WebAudio), Export (MediaRecorder) |
| `lib/db.ts` | IndexedDB-Speicher |

## Grenzen / nächste Schritte

- Export läuft in Echtzeit im Browser; der Tab muss dabei im Vordergrund bleiben.
- Automatische Untertitel per Spracherkennung fehlen noch (aktuell: Untertitel aus Skript). Möglich z. B. mit Whisper im Browser oder einem Speech-to-Text-Dienst.
- Projekte sind an den Browser gebunden; Cloud-Speicher/Konten wären der nächste Schritt.
