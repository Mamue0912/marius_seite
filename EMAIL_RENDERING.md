# E-Mail-Darstellung (Phase 1)

Dieses Dokument beschreibt, wie geöffnete E-Mails im Cockpit gerendert werden
und wie die drei Ansichtsmodi funktionieren.

## Ziel

HTML-Mails sollen sich harmonisch in das dunkle Cockpit einfügen, ohne dass
das Original-Layout, Markenfarben, Logos oder Produktbilder zerstört werden.
Frühere Probleme:

- Geöffnete HTML-Mails wurden als große **weiße Fläche** dargestellt (das
  isolierte iframe hatte `background:#fff`), was im Dark-Mode-Cockpit hart
  wirkte (z. B. PayPal-Mails).
- Ein pauschales `filter: invert(1)` ist **keine** Lösung – es zerstört
  Logos, Fotos und Markenfarben.

## Isolierte Darstellung (unverändert)

Der Mail-Inhalt wird weiterhin in einem **sandboxed iframe** über `srcDoc`
gerendert (`sandbox="allow-same-origin allow-popups
allow-popups-to-escape-sandbox"`). Das serverseitige `sanitize-html`
(`app/api/mail/message/route.ts` → `safeHtml`) entfernt vorher:

- `script`, `style`, `iframe`, `object`, `embed`, `form`, `input`, `button`,
  `textarea`, `link`, `meta`
- alle Event-Handler (`onclick` etc.)
- externe Bilder, solange sie nicht ausdrücklich freigegeben wurden
  (Tracking-Pixel-Schutz)

Inline-Styles und Tabellenlayout **bleiben erhalten**, sonst zerbricht das
Original-Layout.

## Externe Bilder

Externe Bilder werden zunächst blockiert. Über den Button **„Externe Bilder
laden"** kann der Nutzer sie pro geöffneter Mail nachladen
(`?images=1` an der Message-Route). Die Wahl wird **nicht** global pro
Absender gespeichert.

## Drei Ansichtsmodi

In der geöffneten Mail gibt es eine kompakte Umschaltleiste
(`.rd-viewsel`). Standard ist **Angepasst**.

### 1. Angepasst (Standard im Dark Mode)

Kontrollierte Dark-Mode-Transformation in `components/Cockpit.tsx`
(`applyDarkTransform`). Nach dem Laden des iframes werden die berechneten
Stile jedes Elements gelesen und **gezielt** angepasst:

- **Helle, weitgehend neutrale Hintergründe** (weiß/hellgrau/blasse
  Tönungen) → dunkles Neutral (`#1b1b1d` / `#25252a`).
- **Dunkle, weitgehend neutrale Textfarben** (schwarz/dunkelgrau) → hell
  (`#e6e6ea` / `#b7b7c0`).
- **Dunkle Rahmen/Trennlinien** → dezent hell (`rgba(255,255,255,.14)`).
- **Links**, die zu dunkel wären → gut lesbares Hellblau (`#6fb1ff`).

**Bewusst unangetastet** bleiben:

- Bilder, SVGs, `picture`, `video`, `canvas` (keine Invertierung).
- Elemente mit Hintergrund**bild** (oft Logos/Banner).
- **Farbige** Hintergründe und **farbige** Schrift (Markenfarben) – die
  Anpassung greift nur bei nahezu grauen Farben (`max−min ≤ 20`) bzw. bei
  sehr hellen Flächen.

Es wird also **keine Invertierung**, sondern eine helligkeits- und
sättigungsbasierte Zielanpassung genutzt. Markenfarben, Logos, Produktbilder,
Fotos, Tabellenstruktur und Inline-Formatierung bleiben erhalten.

### 2. Original

Nahezu unveränderte Originaldarstellung (kann hell sein), aber innerhalb einer
begrenzten, hochwertigen **„Mail-Leinwand"** (`.rd-canvas`): Innenabstand,
weiche Rundung, dezenter Rahmen und Schatten. Fallback, falls „Angepasst" eine
Mail einmal ungünstig darstellt.

### 3. Nur Text

Aufgeräumte Lesefassung (`.rd-plain`) aus dem reinen Textteil der Mail
(`reading.text`): Absätze bleiben erhalten, Layout-Tabellen, Werbegrafiken und
Tracking entfallen komplett.

## Test-Checkliste

Vor Phase 2 mit folgenden Mails prüfen:

- [ ] PayPal-Mail (Marken-Header, Tabellenlayout)
- [ ] Apple-Mail
- [ ] reine Text-Mail
- [ ] Newsletter mit vielen Bildern
- [ ] Mail mit Tabellen
- [ ] Mail mit Logo
- [ ] Mail mit mehreren Bildern
- [ ] persönliche Text-Mail

Erwartung: „Angepasst" ist dunkel-harmonisch ohne kaputte Logos/Farben,
„Original" zeigt die helle Leinwand, „Nur Text" zeigt sauberen Text.
