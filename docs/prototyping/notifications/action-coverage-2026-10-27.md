# Notification-Aktionsabdeckung

> Historical evidence from 2026-10-27, before integration onto current dev. See [current notifications](../../notifications.md) for the current API and UI contracts; test counts below are historical.

Stand: 27. Oktober 2026. Diese Matrix beschreibt die Aktionsintegration, nicht die Freigabe jeder denkbaren Kombination. Aktuelle Prüfergebnisse und offene Browserfälle stehen im [Arbeitsplan](implementation-plan-2026-10-27.md).

## Direkte Nutzeraktionen

| Bereich | Erfasste Aktionen | Rückmeldung und Grenzen |
| --- | --- | --- |
| Konten | Anlegen, Änderungen an Name/Aktivierung/Rechten, temporäres Passwort/Reset, Löschen | Ergebnis nach bestätigter API-Mutation; Abbruch einer Löschbestätigung bleibt still; Validierung und Erstladefehler bleiben am Formular |
| Gastzugang | Aktivierung/Deaktivierung und Richtlinie explizit speichern | Bestätigter Speichererfolg bzw. sicherer Fehler; keine neue Berechtigung |
| Eigene Zugangsdaten | Owner-Benutzername und eigenes Passwort ändern, erzwungener Passwortwechsel | Nach bestätigter Mutation und Sitzungsende einmalige nicht identifizierende Login-Bestätigung; gesonderte sichere Warnung bei fehlgeschlagenem Session-Refresh; keine alte History an neue Identitäten |
| Abmelden | Account-Menü und persönliches Konto | Fehler in der ursprünglichen Identität; Erfolg beendet die Sitzung ohne übertragenen Toast; erzwungener Passwortdialog nutzt kontextbezogenen Auth-Fehler |
| Passkeys | Registrieren, umbenennen, löschen | Erfolg/Fehler nach tatsächlichem Request; abgebrochene WebAuthn-Zeremonie und Löschbestätigung still; Refresh nach bestätigtem DELETE getrennt |
| Bibliotheken | Anlegen, Name/Typ explizit speichern, Roots/Pfade ändern, löschen | Sicherer Erfolg/Fehler; teilweise fehlgeschlagene Anschlussverknüpfung bzw. Refresh als Warnung; Ziele nach Löschung führen zur Bibliotheksübersicht |
| Scans | Einzel-/Voll-/Sammelscan, Schnellscan, Abbruch im Header | Annahme/Abbruchanforderung von Abschluss getrennt; Schnellscan benötigt Metadaten-/Scanrecht; optionale Synchronisierung zusätzlich Connector-Lese-/Verwaltungsrecht; Ergebnisse unabhängig ausgewertet, Fortschritt bleibt sichtbar |
| Qualität | Profile anlegen, speichern, duplizieren, löschen und Standardwahl | Bestätigte Mutation; getrennte Warnung bei Nachladefehler; spätere Rechenjobs bleiben eigene Abläufe |
| Auflösungen | Kategorie speichern/löschen und Standard wiederherstellen | Explizites Ergebnis; ungültige Entwürfe bleiben am Eingabefeld |
| Ignore-Regeln | Hinzufügen, Entfernen, Defaults wiederherstellen | Explizite Ergebnisse; Bearbeiten bestehender Einträge wird als Autosave gebündelt |
| Connector-Karte | Speichern, Test, Aktivierung, Synchronisierung, Abbruch und Löschen | Sichere Meldung; Testdiagnose separat und bereinigt; laufender Sync und schon angeforderter Abbruch sind keine abgeschlossenen Jobs |
| Connector-Unterbereiche | Verbindung anlegen, Zugangsdaten speichern, analysierte Nutzer, Binding-/Mapping-Modi, Links/Bindings speichern, Bibliothek aus Quelle anlegen | Geheimnisfreie Texte; Formularvalidierung/Erstladefehler bleiben; spätere Refresh-Störung behauptet keinen Mutationsfehler |
| Kompatibilitätsprofile | Hardware/Software/Kombinationen anlegen, speichern, als lokale Kopie/Clone speichern und löschen | Mutation bestätigt; Clone-Entwurf allein erzeugt keinen Speichererfolg; JSON-Validierung bleibt inline |
| Profilquellen und Vorschläge | Quellenlink öffnen, GitHub-Vorschlag vorbereiten, große Vorschlagstexte kopieren | Sichere Fehler; Kopiererfolg erst nach Clipboard-Auflösung; Öffnen/Vorbereiten ist keine Veröffentlichung eines Issues |
| Transcoding-Aufträge | Plan explizit prüfen, starten, abbrechen, erneut anfordern, History-Eintrag löschen | Request-Ergebnis getrennt von FFmpeg-Endzustand; technische Validierungsdetails bleiben; Nachladefehler nach Mutation ist Warnung |
| Presets und Formatierung | Anlegen, speichern, duplizieren, löschen, Standards ändern | Explizite Aktionen unmittelbar; automatische Standardänderungen gebündelt; keine implizite Dateiumbenennung |
| Automationsregeln | Erfasste CRUD-/Toggle-/Sortier-/Ersetzungsfreigabe-Handler | Bestehende Release-Gates unverändert; keine neue sichtbare Funktion oder Berechtigung |
| Dateiexporte | Bibliotheks-CSV, Kapitel-CSV, Cover, Qualitätsbericht | Vorbereitung/Downloadstart statt behauptetem Transferabschluss; Request-Abbruch still; sichere Fehler |
| Clipboard | Rohdaten, Dateivergleich-Rohdaten, technische Scandiagnose, Installations-ID | Ergebnis nach Clipboard-Schreibvorgang; Inhalt/ID/Diagnose nicht in der Notification |
| Duplikate | Gruppe verbergen/wiederherstellen | Bestätigte Mutation, getrennte Refresh-Warnung, unveränderte Bibliotheksrechte |
| History Retention | Aufbewahrung speichern und Rekonstruktion anfordern | Fehler bzw. bestätigte Speicherung; Rekonstruktionsfortschritt bleibt inline und explizite Job-Endzustände beim vorhandenen Watcher |
| Notification-Einstellungen | Palette, Stil, Dauer, Gruppierung und Test-/Clear-Knöpfe | Autosave-Regel unten; Testmeldungen bleiben Vorschauen ohne History, Clear löscht nur aktive Karten |

## Automatische Speicherungen

Einzelne bestätigte Saves bleiben still. Beim Verlassen der Seite bzw. des Settings-Bereichs werden Ergebnisse mehrerer Komponenten zusammengeführt. Ausstehende Schreibvorgänge verzögern die Zusammenfassung; Fehler erscheinen sofort. Gemischte oder nur fehlgeschlagene Vorgänge erhalten keine uneingeschränkte Erfolgsbestätigung. Ein unveränderter Besuch bleibt still. Identitätswechsel verwerfen alte Entwürfe/ausstehendes Feedback, statt sie mit der nächsten Identität zu speichern.

| Speicherart | Erfasste Änderungen |
| --- | --- |
| Bibliothek | Scan-/Duplikateinstellungen, Qualitätsprofilzuordnung, Dashboard-Sichtbarkeit, History-Quelle, Root-Alias und bevorzugter Connector |
| App | Features, Scan-Performance, Muster-/Ignore-Bearbeitung, Aufbewahrung, Telemetriemodus und Notification-Einstellungen |
| Connector | Analysierte Nutzer und automatische Mapping-/Binding-Modi |
| Transcoding | Ausgabe-/Ausführungseinstellungen, automatische Standards sowie vorhandene Regel-Toggles/Sortierung |
| Persönlich | Sprache, Theme und Profilfavoriten; Konto nach tatsächlichem serialisiertem PUT, Gast und globale Desktop-Präferenzen nach lokalem Schreiben |
| Layout/Anzeige | Statistikpanel-Layout, Vergleichsauswahl, Tabellenansicht, Bibliotheks-/Transcoding-Spaltenbreiten, Dateivergleich-Spaltenzahl und Audioanzeige |

Für verzögerte Bibliotheks-/Alias-/Ignore-/Notification-/Transcoding-Speicherungen wird beim normalen Verlassen der ausstehende Entwurf ausgelöst. Beim Identitätswechsel ist dieses Flushen gesperrt. Unabhängige persönliche Preference-Schreiber werden serverseitig atomar zusammengeführt; ein Theme-/Layout-Update überschreibt keine zeitgleich geänderten Notification-Werte.

## Bewusste Grenzen

- Feldvalidierung, Erstlade-/Inspektionsfehler, Livefortschritt und notwendige technische Diagnosen bleiben kontextbezogen. Sie sind keine flüchtigen Mutationsrückmeldungen.
- Navigation, Filter-/History-Auswahl, Akkordeon-/Sidebar-Zustand, Release-Hinweise und Initialisierung werden nicht allein wegen eines lokalen Storage-Schreibvorgangs als relevante Speicheraktion gemeldet.
- Automatische Scan-/Watch-Jobs und Aktionen anderer Nutzer erzeugen keine neuen globalen Toasts. Der vorhandene explizite Jobwatcher bleibt für einmalige Endzustände verantwortlich.
- Verborgene Federation-Handler und die aktuell nirgends produktiv importierte `JellyfinSettingsPanel` sind nicht neu migriert oder sichtbar gemacht. Ihre historischen Tests sind keine produktive Aktionsintegration.
- Der aktuelle Datei-Player besitzt keinen eigenen direkten Medien-Download-Handler; native Browser-Player-Menüs lassen sich nicht als bestätigter App-Dateitransfer auswerten.
- Kontrollierte Komponenten-/API-Prüfungen belegen nicht automatisch Browser-Downloadabschluss, Hardware-Encoding, WebAuthn auf echten Geräten oder vollständige Screenreader-/Touch-Abdeckung.

## Kanonische Quellen

`frontend/src/lib/notifications.tsx`, `notification-actions.ts`, `preference-storage.ts`, `components/PreferenceAutosaveFeedback.tsx`, `lib/auth.tsx`, die Handler in den aufgeführten Seiten/Panels sowie `backend/app/services/notification_access.py` und `account_preferences.py`. Der vorhandene `NotificationProvider` in `App.tsx` umfasst auch `/ui-elements`; ein zweiter Provider im Katalog ist nicht erforderlich. Synthetische Kontenaktionen im Katalog sind als Vorschau von persönlicher History ausgeschlossen.
