# Migration: Aufgaben & Fristen

Die Datei `supabase/schema_tasks_unified.sql` wird einmal im Supabase SQL Editor ausgeführt.
Sie ist wiederholbar und führt vor Änderungen eine private Sicherung in
`cockpit_backup.tasks_before_unification_20260907` durch.

Die Migration:

- bewahrt alle bestehenden Aufgaben und ihre IDs,
- behält Aufgaben ohne Datum,
- ergänzt Kalender- und Verknüpfungsfelder,
- übernimmt E-Mail- und Bewerbungsfristen ohne doppelte externe IDs,
- hält spätere Änderungen über Datenbank-Trigger synchron,
- aktiviert die deduplizierte iCloud-Verknüpfung.

Nach erfolgreicher Ausführung die Cockpit-Seite neu laden und im Kalender einmal
`Aktualisieren` wählen. Dadurch werden die iCloud-Termine des sichtbaren
Zeitraums sofort in `Aufgaben & Fristen` übernommen.