# Notifications: unabhängige Browserprüfung

> Historical evidence from 2026-10-27, before integration onto current dev. See [current notifications](../../notifications.md) for the current API and UI contracts; test counts below are historical.

Prüfer: gpt-6-luna, reasoning effort high. Datum: 27. Oktober 2026. Umsetzung in getrennten gpt-6.1-terra-Arbeitspaketen mit medium; Hauptagent übernimmt Integration und Befundabschluss. Zugehörig: [Plan](implementation-plan-2026-10-27.md), [Aktionsabdeckung](action-coverage-2026-10-27.md).

## Prüfaufbau

Echte Chromium-Klicks und Eingaben gegen einen isolierten Backend-/Vite-Prozess mit Wegwerf-SQLite und einem generierten einsekündigen MP4. Erfolgsfälle verwendeten tatsächliche APIs und Persistenz. Für Fehler/Verzögerung wurden einzelne Requests kontrolliert abgefangen und anschließend echte Wiederholungen geprüft. Es wurden keine produktiven Konten, Medien oder Connectoren verändert. Der erste Vite-Start hatte den Standardproxy auf 8080 geerbt; nach einem ausschließlich lesenden Seitenaufruf wurde er beendet und mit dem isolierten Backendport neu gestartet. Vor Mutationen wurde die leere Testinstallation bestätigt.

T3 Preview lieferte Timeout-/Chrome-Fehler. Die anschließend verwendete CLI ist `npx --yes --package @playwright/cli playwright-cli`; der alte Skill-Wrapper verweist auf `@playwright/mcp`, das hier kein passendes CLI-Binary bereitstellte. Die Browser- und Testserverprozesse wurden nach der Prüfung beendet.

## Tatsächlich ausgelöste Browserfälle

| Bereich | Geprüfter Ablauf | Nachweis |
| --- | --- | --- |
| Unveränderter Besuch | Leeres Dashboard öffnen und anmelden | Kein falscher Erfolgs-/Abschluss-Toast |
| Bibliotheken | Anlegen, umbenennen/speichern, manueller Scan und Schnellscan | Sichere sichtbare Aktionsmeldung, gespeicherte History; Annahme und tatsächlicher Scanabschluss getrennt |
| Konten | Anlegen, temporäres Passwort zurücksetzen, Löschen abbrechen, Löschen bestätigen | Korrekte Aktionsmeldungen; keine Zugangsdaten im Text |
| Connector | Fake-Verbindung anlegen und echten fehlgeschlagenen Verbindungstest gegen unerreichbaren Loopback-Port auslösen | Sichere Kurzmeldung und Connector-Ziel; kein externer Server kontaktiert |
| Qualitätsprofil | Anlegen, umbenennen/speichern und löschen | Sichtbare Ergebnisse nach tatsächlicher Mutation |
| Kompatibilitätsfavorit | Favorit umschalten und Bereich verlassen | Kein Erfolg pro Klick, eine gemeinsame Speicherbestätigung beim Verlassen |
| Transcoding-Preset | Anlegen und mehrfach explizit speichern | Je tatsächlicher Speicherung ein History-Eintrag; Link öffnet den richtigen Presetbereich |
| Notification-Autosave | Palette/Gruppierung mehrfach ändern und Settings-Bereich verlassen | Keine Einzelbestätigungen; genau eine Abschlussmeldung mit History und passendem Ziel |
| Ausstehender Save | Echten App-Settings-PATCH um 1,8 Sekunden verzögern und Bereich verlassen | Bestätigung erst nach erfolgreicher Rückkehr des tatsächlichen Requests |
| Fehler und Wiederholung | App-Settings-PATCH kontrolliert mit HTTP 500 ablehnen, danach echte Speicherung wiederholen | Sofortiger sicherer Fehler; Wiederholung erfolgreich |
| Theme | Dunkel/Hell über den echten Selektor ändern | Tatsächliche Speicherung, identitätsbezogenes Feedback |
| Datei/Clipboard | Rohes ffprobe-JSON laden und kopieren | Sicherer Kopiererfolg; History-Link öffnet die konkrete Datei |
| Zugangsdaten | Erzwungener Erstpasswortwechsel und eigener Passwortwechsel | Nach bestätigter Mutation einmalige Login-Bestätigung; nach Anmeldung entfernt und nicht in Notification-History |
| Refresh nach Zugangsdatenänderung | Tatsächliches erfolgreiches Passwort-POST, nachfolgendes Status-GET kontrolliert fehlschlagen lassen | Geschützte Oberfläche entfernt; sichere Login-Warnung; keine automatische Gastanmeldung; nächste erfolgreiche Anmeldung entfernt die Warnung |

History-Links wurden für eine Datei und einen Preset-Eintrag tatsächlich angeklickt. Für Scanmeldungen wurde das konkrete Scanlog-Ziel geprüft. Screenshots und vollständige Reviewer-Fallmatrix liegen im lokalen QA-Artefaktordner `/tmp/medialyze-notifications-20261027/artifacts-r2/` bzw. `browser-review-r2.md`; sie sind nicht Teil einer veröffentlichten Release-Zusage.

## Befunde

- Die erste kontrollierte Luna-Runde reproduzierte die sofort verschwindende Zugangsdaten-Erfolgsmeldung beim Auth-Remount. Terra korrigierte dies mit der vom Nutzer bestätigten einmaligen Login-Anzeige; beide tatsächlichen Browserfälle oben bestanden danach.
- Die Browserrunde zeigte einen aktiv angebotenen Schnellscan für einen Nutzer ohne Scanrecht. Die API verweigerte korrekt mit 404 und die Notification meldete sicher den Fehler. Terra korrigierte Sichtbarkeit, Handler und die optionale Connector-Synchronisierung unter unveränderten Rechten. Die unabhängige dritte Luna-Runde bestätigte: Metadatenleser hat keinen Schnellscan; Scanberechtigter und Owner lösten echte HTTP-202-Scans aus und erhielten sichere Annahmemeldungen sowie getrennte, durch fertige Jobs belegte Abschluss-History. Der Scanberechtigte löste keinen Sync aus. Linked-Source-Skip und der aktuelle Handler-Rechtecheck bestanden zusätzlich sechs gezielte Komponentenfälle. Die Live-Testbibliothek war leer; dies belegt Job-/Notification-Verhalten, keine Medienanalyse.
- In den übrigen tatsächlich ausgelösten Notification-Abläufen wurde kein weiterer Fehler bestätigt.

## Grenzen

Dies ist keine vollständige Browserprüfung jeder Zeile der Aktionsmatrix. Owner-Setup erfolgte per Umgebung statt Setup-Assistent. Gemischter Schnellscan/Connector-Erfolg, reale externe Connectoren, sämtliche Hardware-/Software-/Kombinationsprofil-CRUD-Varianten, echte Hardware-Transcodierung, alle Export-/Transferzweige und WebAuthn auf echten Geräten wurden nicht vollständig im Browser ausgeführt. Dafür vorhandene Komponenten-/API-Tests sind gesonderte Evidenz. Mobile, vollständige Screenreader-/Touch-/Theme-Kombinationen und Release-Packaging sind hier ebenfalls nicht freigegeben.

## Automatisierte Gesamtprüfung

Der Hauptagent verifizierte **972 Backendtests**, **667 Frontendtests in 65 Dateien**, den aktuellen TypeScript-/Vite-Produktionsbuild und `git diff --check`. Nach der letzten gemeinsamen Fehlerzuordnungs-/Abschnittsziel-Korrektur bestanden zusätzlich 27 gezielte Tests. Die dritte Luna-Runde bestätigte sechs Schnellscan-Tests und 18 Tests der gemeinsamen Speicher-/Feedback-Helfer. Diese Zahlen überlappen die Gesamtsuite und werden nicht addiert.

Separat beobachtet und nicht untersucht: Hintergrund-403 für Dashboard-/Connector-/Jellyfin-Ladeanfragen eingeschränkter Sitzungen, teilweise mit sichtbarem „Forbidden“. Dies bleibt eine allgemeine Rechte-/Lade-UI-Aufgabe; der korrigierte Schnellscan und die geprüften Notifications wurden dadurch nicht widerlegt. Vollständiger lokaler Nachprüfbericht: `/tmp/medialyze-notifications-20261027/quickscan-review-r3.md`.
