# Notifications: vollständige Aktionsintegration

> Historical evidence from 2026-10-27, before integration onto current dev. See [current notifications](../../notifications.md) for the current API and UI contracts; test counts below are historical.

Stand: 27. Oktober 2026. Verantwortlich für Koordination, Integration und Abschlussaudit: Hauptagent.

Die konkrete [Aktions- und Speichermatrix](action-coverage-2026-10-27.md) ergänzt diesen Ablauf um die erfassten Aktionen, ihre Ergebnisgrenzen und bewusste Ausnahmen.

## Auftrag und verbindliche Regeln

Der Nutzer beauftragt die Umsetzung der übrigen Aktionen mit parallelen **gpt-6.1-terra / medium** Subagents sowie die unabhängige Funktionsprüfung fertiger Bereiche durch **gpt-6-luna / high**. Tests und tatsächliches Auslösen sind damit ausdrücklich beauftragt; die frühere Testsperre im Integrationsprotokoll gilt für diese Arbeit nicht mehr. Keine Veröffentlichung, kein Commit oder Push.

Bestätigt am 27. Oktober: Automatische Einzeländerungen zeigen Fehler sofort. Beim Verlassen der jeweiligen Seite bzw. des Einstellungsbereichs erscheint eine einzige zusammengefasste Rückmeldung für tatsächlich bestätigte Speicherungen. Keine Erfolgsmeldung pro Schalter/Favorit/Layoutänderung. Ausstehende Speicherungen müssen beendet und Fehler berücksichtigt werden, bevor eine Abschlussmeldung Erfolg behauptet. Identitätswechsel dürfen keine Meldungen in die nächste Identität übertragen. Explizites Speichern, Anlegen und Löschen erhalten direkte Rückmeldungen.

Weitere Regeln aus dem Integrationsprotokoll bleiben bestehen: tablokale Toasts; persönliche History; keine Geheimnisse/rohen Exceptions; validierte interne Ziele; bestätigte Mutation von fehlgeschlagenem Refresh trennen; Jobannahme und Abbruchanforderung nicht als Abschluss melden; existierender Jobwatcher meldet Endzustände einmalig. Feldvalidierung, Lade-/Leerzustände, laufender Fortschritt und notwendige technische Diagnosen bleiben kontextbezogen.

## Arbeitspakete und Dateigrenzen

| Paket | Umfang | Umsetzung | Unabhängige Prüfung |
| --- | --- | --- | --- |
| A Konten | Konten-/Rechte-/Gastverwaltung, Passwortaktionen, persönliche Einstellungen, Account-Menü und Passkeys | abgeschlossen | Luna-Komponenten/API-Prüfung und echte Konten-/Login-Browserfälle bestanden; echte Geräte-WebAuthn bleibt außerhalb dieses Prüfumfangs |
| B Bibliotheken und App-Einstellungen | Bibliotheken, Roots/Aliasse, Löschen, Scanannahme/-abbruch, Schnell-/Sammelscan, Qualität, Ignore-Regeln, Auflösungen, Telemetrie und Settings | abgeschlossen; Schnellscan-Rechtebefund korrigiert | Komponentenfälle und ausgewählte echte Browserfälle bestanden; Schnellscan-Nachprüfung mit drei Identitäten bestanden |
| C Transcoding und Dateien | Dateiaktionen, Planprüfung/Start, Abbruch, Retry, Bereinigung, Presets/Regeln, Exporte/Clipboard und Duplikatgruppen | abgeschlossen | Komponentenfälle bestanden; Preset-Speicherung, Datei-Clipboard und History-Navigation echt geprüft; keine Hardware-Encoding-Freigabe |
| D Connector-Unterbereiche | Nutzerwahl, Bindings/Mappings, Verknüpfungen, Anlegen, Zugangsdaten und Kartenaktionen | abgeschlossen; nicht importierte Legacy-Oberfläche ausgeschlossen | Komponentenfälle sowie echte Erstellung und sicherer fehlgeschlagener Loopback-Verbindungstest bestanden; kein externer Server kontaktiert |
| E Kompatibilitätsprofile | Hardware/Software/Kombinationen, CRUD/Clone, Quellen und Favoriten | abgeschlossen; kein Import/Export in dieser Oberfläche vorhanden | Komponentenfälle und echter Favoriten-/Abschlussablauf bestanden; nicht jede CRUD-Variante live geprüft |
| F Restflächen | Dashboard/Storage Map/Series-Audit, persönliche Layouts/Spalten/Anzeige | abgeschlossen; Navigation/Initialisierung bleiben still | Speicher-/Initialisierungstests, Desktop-Kontext und echte Theme-/Autosave-Fälle bestanden |
| G Gemeinsame Integration | Speicherabschluss-Hook, Übersetzungen EN/DE/ES/UK, History-Zielrechte, atomare Präferenzen, Provider-/Katalogintegration, Dokumentation und Gesamtchecks | abgeschlossen | Gesamtchecks und unabhängige Luna-Nachprüfung bestanden; Grenzen im Prüfbericht |

Getrennte Source-/Testdateien ermöglichen gemeinsame Arbeit im bestehenden Checkout; Worktrees würden die bereits vorhandenen uncommitteten Änderungen nicht enthalten. Shared-Dateien (Locales, AGENTS, Changelog, UI-Katalog und Backend) werden zentral integriert. Subagents liefern Aktionsinventare und Locale-Fragmente in `/tmp/medialyze-notifications-20261027/`.

## Vorgehen pro Aktion

1. Handler und alle Aufrufer erfassen: explizite Aktion, automatisches Speichern, Hintergrundladen, Validierung oder dauerhafte Diagnose.
2. Erfolg, Fehler, Annahme/Abbruch, No-op/Benutzerabbruch und Refresh nach Mutation getrennt behandeln.
3. Sicherer lokalisierter Text, stabiler fachlicher Gruppenschlüssel und tatsächlich erreichbares berechtigtes Ziel.
4. Alte flüchtige Inline-Ergebnisse entfernen; erforderliche kontextbezogene Rückmeldungen erhalten.
5. Automatische Speicherungen über gemeinsamen Hook bündeln; Navigation innerhalb Settings zählt als Bereichswechsel.
6. Fokussierte Verhaltenstests und Prüfanleitung liefern. Erst nach fertiger Integration unabhängige Luna-Prüfung.
7. Befunde mit Reproduktion festhalten, durch Terra beheben lassen, erneut unabhängig prüfen. Kein Bereich gilt allein aufgrund von Quelltextsichtung als funktional geprüft.

## Funktionsprüfung und Nachweise

- Wegwerf-Konfiguration/SQLite/Medien verwenden; keine realen Konten, Passkeys, Connectoren oder Medien verändern.
- Je Bereich Aktionen wirklich auslösen: Erfolg, kontrollierter Fehler, Benutzerabbruch, spätere Refresh-Störung; soweit anwendbar Jobannahme/-abbruch und Endzustand.
- Automatische Änderungen: mehrere Erfolge ohne Toast, Fehler sofort, Bereich verlassen mit einer Abschlussmeldung, ausstehende Speicherung, gemischtes Ergebnis, Identitätswechsel.
- Toast und History auf gleichen sicheren Text, richtiges Ziel, keine Dubletten sowie aktuelle Rechte prüfen.
- Browserprüfungen bevorzugt mit T3 Preview. Reale End-to-End-Aktionen von kontrollierten API-Fixtures unterscheiden. Mock-/DOM-Tests ersetzen keine nicht ausgeführte echte Integration.
- Abschließend Frontendtests/TypeScript/Vite, betroffene Backendtests und `git diff --check`; zusätzliche Gesamtprüfungen nach Befund. Verbleibende nicht ausgeführte Prüfungen ausdrücklich dokumentieren.

## Fortschritt und Restlücken

Der Plan für die Notification-Aktionsintegration ist abgearbeitet. Die Befunde zu ausstehenden Speicherungen, History-Zielrechten, Nachladefehlern, Credential-Bestätigungen und Schnellscan-Sichtbarkeit sind umgesetzt und nachgeprüft. Es bestehen keine offenen Notification-Befunde aus den ausgeführten Prüfrunden. Die bewussten Ausnahmen und nicht ausgeführten Plattform-/Browserkombinationen stehen in der Aktionsmatrix und im Prüfbericht; dies ist keine vollständige Release-Freigabe.

Bestätigte Ergänzung (27. Oktober): Nach einer eigenen Passwort-/Owner-Namensänderung erscheint einmalig „Änderung gespeichert – bitte erneut anmelden“ auf der Anmeldeseite. Diese Anzeige bleibt im Arbeitsspeicher des AuthProviders, enthält keine Kontodaten und überträgt keine History an die nächste Identität. Bei bestätigter Mutation und fehlgeschlagenem Session-Refresh wird eine entsprechende sichere Warnung angezeigt. Diese Authentifizierungsrückmeldung ist eine bewusste Ausnahme zu Toasts, da deren Provider mit der alten Sitzung endet.

Abschließende Verifikation:

- Vollständige Backend-Suite: **972 bestanden**.
- Vollständige Frontend-Suite nach Rechte-/Desktop-Ergänzungen: **667 bestanden in 65 Dateien**. Die letzte gemeinsame Fehlermeldungszuordnung und das kanonische Abschnittsziel wurden danach mit **27 gezielten Tests** geprüft. Luna prüfte die aktuellen gemeinsamen Helfer zusätzlich unabhängig: **18 Tests in drei Dateien bestanden**. Diese Mengen überlappen; sie werden nicht addiert.
- Aktueller TypeScript-/Vite-Produktionsbuild und `git diff --check`: bestanden.
- EN/DE/ES/UK: **146 übereinstimmende Action-Übersetzungsschlüssel**; literale Action-Schlüssel aufgelöst.
- Luna-Runde 2: echte Browseraktionen, sichere Fehler, Persistenz und History-Ziele bestanden. Luna-Runde 3: Metadatenleser sieht keinen Schnellscan; Scanberechtigter und Owner starten echte Jobs, sehen Annahme und erhalten getrennte bestätigte Endzustände. Der Scanberechtigte löst keinen unzulässigen Sync aus. Linked-Source-Skip und Rechteentzug sind zusätzlich kontrollierte Komponentenfälle.
- Prüfaufbau, tatsächlich ausgelöste Fälle und Grenzen: [Browser-Prüfbericht](browser-validation-2026-10-27.md). CLI statt des hier defekten alten Skill-Wrappers; alle verwendeten App-/Browserprozesse beendet, keine Produktivdaten verändert.
- Kein Commit, Push, Merge oder Release durchgeführt.

Separater offener Rechte-UI-Befund: Eingeschränkte Sitzungen erzeugten Hintergrund-403 bei Dashboard-/Connector-/Jellyfin-Ladeanfragen, teilweise mit sichtbarem „Forbidden“. Die API verweigerte den Zugriff; diese Lade-/Rechte-UI-Abstimmung wurde in der Notification-Arbeit nicht untersucht oder als behoben ausgegeben. Sie bleibt ein nachvollziehbarer Folgepunkt für die allgemeine Release-Prüfung.
