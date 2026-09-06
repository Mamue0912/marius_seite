# iCloud-Kalender anbinden (CalDAV, nur Lesen)

Der iCloud-Kalender wird über **CalDAV** eingebunden – ausschließlich **lesend**.
Es werden keine Termine erstellt, geändert oder gelöscht.

## 1. Datenbank-Tabelle anlegen

Einmalig in Supabase (SQL Editor) ausführen:

```
schema_icloud_calendar.sql
```

Legt `public.icloud_accounts` an. Das app-spezifische Passwort wird dort
**verschlüsselt** gespeichert (AES-256-GCM über `TOKEN_ENC_KEY`, wie bei Google/
Outlook) – nie im Klartext. Es sind keine zusätzlichen Umgebungsvariablen nötig.

## 2. App-spezifisches Passwort erzeugen

Apple erlaubt Fremd-Apps keinen Zugriff mit dem normalen Passwort. Stattdessen:

1. Auf **appleid.apple.com** anmelden
2. **„Anmeldung & Sicherheit"** → **„App-spezifische Passwörter"**
3. Neues Passwort erzeugen (Name z. B. „Cockpit")
4. Das angezeigte Passwort kopieren (Format `xxxx-xxxx-xxxx-xxxx`)

> Voraussetzung: Für die Apple-ID muss die Zwei-Faktor-Authentifizierung aktiv sein.

## 3. Im Cockpit verbinden

Unter **Kalender** → **„iCloud-Kalender verbinden"** die Apple-ID (E-Mail) und das
app-spezifische Passwort eingeben. Bindestriche/Leerzeichen im Passwort werden
automatisch entfernt. Nach erfolgreicher Prüfung erscheinen die iCloud-Termine
zusammen mit ggf. verbundenen Google-Terminen in der Kalenderansicht.

## Wie es funktioniert

- CalDAV-Discovery: `current-user-principal` → `calendar-home-set` → Kalenderliste
- Pro Kalender ein `calendar-query`-REPORT mit `<C:expand>`: iCloud liefert
  wiederkehrende Termine bereits als **UTC-Einzelinstanzen** zurück, daher keine
  RRULE-/Zeitzonen-Auflösung im Client nötig.
- Kalenderfarben werden übernommen (Apple-`calendar-color`, 8-stelliges ARGB wird
  auf `#RRGGBB` gekürzt).
- Nur Kalender mit `VEVENT`-Unterstützung werden geladen (Reminders-Listen = VTODO
  werden hier ausgelassen).

## Grenzen

- **Apple Notizen:** Keine offizielle Schnittstelle – nicht anbindbar.
- **Apple Erinnerungen:** Technisch über CalDAV (VTODO) möglich; noch nicht
  umgesetzt. Kann als nächster Schritt an die Aufgaben-/Deadlines-Ansicht
  angeschlossen werden.
- **Trennen:** Unter Kalender → „Kalenderquellen" → „Trennen". Dabei werden die
  gespeicherten Zugangsdaten gelöscht.
