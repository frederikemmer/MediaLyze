# MediaLyze – vollständige Methoden-/Endpunktmatrix für die geplante Nutzerverwaltung

Stand 22.10.2026, lokaler `dev` bei `cdc4f3994cfc807a67f77fb1d265dff7badfe65d`. [Konsolidiertes Konzept](MediaLyze-Nutzerverwaltung-konsolidiert-2026-10-22.md) und [JSON mit allen aufgelösten Policyfeldern](MediaLyze-Nutzerverwaltung-Endpunktmatrix-2026-10-22.json).

**Die Rechtezuordnung beschreibt SOLL, nicht heutigen Schutz.** Es gibt heute keine durchgängigen lokalen Konten-/Bibliothekspolicies. Maschinenrouten haben eigene vorhandene Pairing-/Envelopeprüfungen; das ist keine allgemeine Nutzerautorisierung. `T` ist technische Empfehlung. `B/T` kennzeichnet bestätigte Bereichszuordnung mit weiterhin technischen Ausführungsdetails. `O-xx` verweist auf unbestätigte Produktzuordnung im Konzept. Bis Klärung offen markierter Zuordnungen keine Freigabe ableiten. Alle vorgeschlagenen Rechtekennungen sind noch zu implementieren.

## Erhebungsmethode und Abdeckung

Alle Python-Dateien unter `backend/` wurden per AST nach HTTP-/WebSocket-Routendekoratoren durchsucht, ergänzt durch Suche nach FastAPI/APIRouter, include_router, add_route/add_api_route und mount. Die tatsächlichen Dekoratoren ergeben 163 Routen in `api/routes.py`, 22 in `api/federation_routes.py`, zwei in `main.py`: **187 explizite Methode/Pfad-Kombinationen**. Davon sind elf Protokollrouten zusätzlich auf dem separaten Federation-Listener eingebunden. Hinzu kommen je App vier FastAPI-Standardrouten mit GET/HEAD (16 Methodenzeilen), Assets GET/HEAD als Mount (2) und dynamisches OPTIONS-Preflight als Middleware (1): **217 Matrixzeilen**, davon 216 Routeneinträge/Methoden inklusive Mount und eine Middlewareklasse von Requests. Nicht als 217 fachliche API-Endpunkte lesen.

Präfixe: `main.py:139` bindet `/api` (konfigurierbares `api_prefix`), `routes.py:338–339` bindet beide Federationrouter, `federation_app.py:35` dieselben elf Protokollhandler am Zusatzlistener. `main.py:126` registriert Performance außerhalb des Routers. Framework-Docs liegen ohne API-Präfix auf beiden Apps. Alle Konfigurationsvarianten sind als **Vereinigung** dokumentiert, nicht als Behauptung, dass heute jeder Listener aktiv ist.

Die Framework-Standardrouten wurden zusätzlich mit einer isolierten `FastAPI()`-Instanz der installierten Versionen FastAPI 0.138.0 / Starlette 1.3.1 auf GET/HEAD geprüft. Kein Backendimport, Projekt-Appstart, Lifespan oder Testlauf: kein Risiko einer realen DB-/Runtimeinitialisierung. Die Erhebung ist statisch vollständig für die gefundenen Registrierungsformen; der spätere automatische Abdeckungstest muss das echte `app.routes` aller Varianten gegen die Policyregistrierung prüfen. Keine WebSocket-Endpunkte gefunden; die Uvicorn-WebSocketoption allein registriert keine Route. Kein eigener lokaler Telemetrie-Ingest gefunden; ausgehender externer Telemetriedienst ist nicht Teil der lokalen API.

HEAD ist für FastAPI-fachliche `@get`-Routen nicht automatisch als erlaubte Fachmethode angenommen. GET/HEAD bei Frameworkrouten und StaticFiles wurden separat aufgenommen. Sonstige unbekannte Methoden/Pfade müssen gesperrt bleiben. Range, If-Range, If-None-Match, Downloadquery, Kodierungs-Sidecars und Responsevarianten sind dieselben Endpunkte mit derselben vorgeschalteten Ressourcenprüfung.

## Übergreifender Vertrag

- Jede Zeile verweist auf eine unten vollständig definierte Policy aus **Funktionsrecht, Bibliotheks-/Jobprüfung und Vertrauensart**. Die JSON-Datei löst diese Felder zusätzlich je Endpunkt direkt auf.
- Browserkonto und aktivierter Gast sind jeweils eigene Identitäten; nur ausdrücklich erlaubte Gastrechte, keine Vererbung. Gast-Nutzerverwaltung bleibt grundsätzlich ausgeschlossen. Der Desktopnachweis gewährt lokalen Vollzugriff, ersetzt aber nicht Path-Safety und validierte Payloads.
- Schreibende Browserrequests: zusätzlich CSRF und Origin. Maschinenprotokolle verwenden ausschließlich ihren eigenen Vertrauensweg; Session/Gast/Owner-UI-Rechte sind dafür kein Authentifizierungsersatz. Interne Systemjobs laufen nicht über öffentlich freizugebende Browserendpunkte.
- Aktuelle Rechte ab jeder Anfrage; Objektzugriffe auf fremde IDs wie unbekannte IDs 404, fehlendes Funktionsrecht 403, erforderliche Anmeldung 401. Keine Status-/Timing-/Fehlerprojektion verborgener Objekte. Besitzervollzugriff nur im interaktiven Kontokontext, keine magische Maschinenauthentifizierung.
- Bibliotheksfilter **vor** count/limit/offset/Sortierung/Aggregation. Alle IDs auch in Query/Body/verschachtelten Ressourcen prüfen. Keine unbereinigten globalen Cacheantworten teilen. Historybounds, Jobzahlen und Filtervorschläge sind ebenfalls Daten.
- Playbackrecht gilt zusätzlich auf jedem Endpunkt mit Wiedergabedaten, auch in Rohpayloads, Exporten und historischen Snapshots. Ohne Recht keine Wiedergabefilter/-sortierung auswerten. Technische Felder bleiben separat verfügbar.
- Bearbeiten->Ansehen, Dateiaktion->Metadaten und Transcodingaktion->Jobansicht sind technische Abhängigkeitsvorschläge, nicht bereits bestätigte Produktregeln. Die bestätigte Voraussetzung für Bibliotheksanlage bleibt verbindlich.

## Policydefinitionen

### HEALTH · T

- **Funktionsrecht:** Kein Datenrecht; minimale Betriebsprüfung
- **Ressourcen-/Jobprüfung:** Keine Bibliothek; vor Setup nur minimaler Status, Versionsausgabe nach Empfehlung erst nach Setup
- **Vertrauen:** Öffentlich minimal / Desktopbereitschaft

### BROWSE · T

- **Funktionsrecht:** library.create mit allen Voraussetzungen ODER library.paths für Zielbibliothek
- **Ressourcen-/Jobprüfung:** Anlagekontext mit All-and-future oder Zielbibliothek+Pfadaktion prüfen; MEDIA_ROOT/Symlinks; Kontext fehlt heute im Request
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### DESKTOP_PATH · T

- **Funktionsrecht:** Lokaler Vollzugriff
- **Ressourcen-/Jobprüfung:** Nativer absoluter Pfad; ausschließlich Desktop, kein Vertrauen auf Modusflag allein
- **Vertrauen:** Desktopnachweis

### DASHBOARD · B/T

- **Funktionsrecht:** overview.dashboard + erlaubter Metadatenumfang
- **Ressourcen-/Jobprüfung:** Nur je Aktion erlaubte Bibliotheken; show_on_dashboard zusätzlich; Playback nur mit connector.playback; vollständige Historienbounds ebenfalls filtern
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis
- **Einordnung:** Drei globale Übersichts-Unterrechte plus Datenbegrenzung auf lesbare Bibliotheken bestätigt; technische Endpunktprojektion/Mehrfachnutzung bleibt T.

### SCAN_VIEW · T/O-03

- **Funktionsrecht:** Empfehlung library.read je Bibliothek
- **Ressourcen-/Jobprüfung:** Jobs über library_id filtern/auflösen; Typ Scan/Qualitätsjob, Diagnosen und Pfade im selben Umfang; Gaststandard offen
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### SCAN_MUTATE · T

- **Funktionsrecht:** library.scan je Bibliothek
- **Ressourcen-/Jobprüfung:** Jobbibliothek vor Mutation prüfen; Sammelabbruch nur erlaubte Jobs; wartend erneut autorisieren; nicht erlaubte IDs/Zähler nicht ausgeben
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### APP_VIEW · T

- **Funktionsrecht:** settings.app.view
- **Ressourcen-/Jobprüfung:** Installationsweite Konfiguration/Betriebsdaten; keine geheimen Credentials; ungewollte eingebettete Mediendetails ausnehmen; heutige globale ui_preferences in eigene Preferences überführen.
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### APP_EDIT · T

- **Funktionsrecht:** settings.app.edit + Empfehlung settings.app.view
- **Ressourcen-/Jobprüfung:** Installationsweite Mutation; Folgejobs als autorisierte globale Konfigurationswirkung kennzeichnen; Secret- und Credentialfelder separat validieren; persönliche ui_preferences nicht über einen globalen Schreibweg verändern.
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### RECONSTRUCT_VIEW · T/O-06

- **Funktionsrecht:** Empfehlung settings.app.view
- **Ressourcen-/Jobprüfung:** Installationsweiter Fortschritt, keine verborgenen Dateisamples in Antwort
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### RECONSTRUCT_EDIT · T/O-06

- **Funktionsrecht:** Empfehlung settings.app.edit
- **Ressourcen-/Jobprüfung:** Installationsweite Rekonstruktion und sichere Statusprojektion; als explizite globale Wartungsaktion, nicht als Bibliothek-Scan tarnen
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### UPDATE · T

- **Funktionsrecht:** Empfehlung erlaubte UI-Konfigurationsprojektion / Identität
- **Ressourcen-/Jobprüfung:** Nur freigegebene Versions-/Updateinformation; vor Setup minimal halten; kein voller App-Settings-Zugriff nötig
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### DESKTOP_UPDATE · T

- **Funktionsrecht:** Lokaler Vollzugriff
- **Ressourcen-/Jobprüfung:** Nur Desktop; auch Node-HTTP-Anfrage aus Hauptprozess mit Nachweis
- **Vertrauen:** Desktopnachweis

### QUALITY_VIEW · T

- **Funktionsrecht:** settings.quality.view
- **Ressourcen-/Jobprüfung:** Globaler Profilbereich; keine Bibliotheksdaten zurückliefern
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### QUALITY_EDIT · T

- **Funktionsrecht:** settings.quality.edit + Empfehlung .view
- **Ressourcen-/Jobprüfung:** Globaler Profilbereich; Folge-Neuberechnung installationsweit erlaubt; Ergebnisantwort ohne verborgene Bibliotheksdetails
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### CONNECTOR_VIEW · T

- **Funktionsrecht:** connector.view
- **Ressourcen-/Jobprüfung:** Globale Verbindung/Providerkonfiguration; keine Credentials/Token; eingebettete lokale Medien nach Bibliothek-Aktion projizieren
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### CONNECTOR_MANAGE · T

- **Funktionsrecht:** connector.manage + Empfehlung connector.view
- **Ressourcen-/Jobprüfung:** Globale Konfiguration/Sync/Recompute; vorhandene Verbindung und Capability prüfen; auf lokale Zielressourcen verweisende Änderungen gesondert begrenzen
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### CONNECTOR_USERS · T

- **Funktionsrecht:** connector.view für Konfiguration; connector.playback für Nutzungsdaten
- **Ressourcen-/Jobprüfung:** Externe Nutzerauswahl als Konfiguration, keine Playbacks ohne Playbackrecht; keine lokalen Konten damit verwechseln
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### CONNECTOR_JOB · T

- **Funktionsrecht:** connector.view
- **Ressourcen-/Jobprüfung:** Installationsweite Connectorjobs; Ressourcen-/Fehlersamples ohne verborgene lokale Mediendetails; keine Gast-Standardfreigabe ableiten
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### CONNECTOR_CATALOG · T/O-04

- **Funktionsrecht:** Empfehlung connector.view; connector.playback nur zusätzlich
- **Ressourcen-/Jobprüfung:** Reichweite externer/ungematchter Katalogdaten offen; lokale Matches/IDs/Pfade nur bei erlaubter library.read; Summen vor Pagination filtern
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### CONNECTOR_LINK · T/O-04

- **Funktionsrecht:** connector.manage + betroffene library.edit; Roots/Pfade ggf. library.paths
- **Ressourcen-/Jobprüfung:** Alle lokalen Zielbibliotheken, Root-ID-Zugehörigkeit und entfernten Zuordnungen prüfen; Batch darf verborgene Links weder lesen noch ersetzen; globaler Sync bleibt unabhängig
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### CONNECTOR_CREATE · T

- **Funktionsrecht:** connector.manage + library.create + erforderliche library.edit/paths im All-and-future-Modus
- **Ressourcen-/Jobprüfung:** Externe Verbindung/Bibliothek zugehörig; lokale Erzeugung wie reguläre Anlage, kein Umweg über Connector; MEDIA_ROOT bzw. Desktopgrenzen
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### LIB_LIST · T

- **Funktionsrecht:** library.read je Bibliothek
- **Ressourcen-/Jobprüfung:** Liste nur im erlaubten Aktionsumfang; eingebettete Job-/Playbackfelder getrennt projizieren; keine globalen unbereinigten Summaries
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### LIB_READ · T

- **Funktionsrecht:** library.read für Zielbibliothek
- **Ressourcen-/Jobprüfung:** library_id prüfen; series_id/Dateien müssen dazugehören; Playbackfelder nur mit connector.playback; technische Rohdaten/Historie enthalten
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### LIB_CREATE · T

- **Funktionsrecht:** library.create + library.edit + library.paths, All and future libraries
- **Ressourcen-/Jobprüfung:** Aktuelle Voraussetzungen vor Anlage atomar prüfen; erstmalige Ordnerauswahl enthalten; Löschen nicht erforderlich
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### LIB_PATCH · T

- **Funktionsrecht:** library.edit für normale Felder; library.paths für path/paths/roots
- **Ressourcen-/Jobprüfung:** Zielbibliothek je geänderter Aktion; gemischte Payload erfordert alle passenden Rechte; keine Änderung über Legacyfelder; Pfadgrenze bleibt
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### LIB_DELETE · T

- **Funktionsrecht:** library.delete für Zielbibliothek
- **Ressourcen-/Jobprüfung:** Bibliotheks-/Jobbezug und bestehende Betriebssperren prüfen; keine Dateilöschung durch Rechteannahme erfinden
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### DUP_WRITE · T/O-06

- **Funktionsrecht:** Empfehlung library.edit
- **Ressourcen-/Jobprüfung:** Zielbibliothek und Signaturgruppe; Wirkung installationsweit innerhalb dieser Bibliothek, keine bloße persönliche Layoutänderung
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### STORAGE · B/T

- **Funktionsrecht:** overview.storage + erlaubter Metadatenumfang
- **Ressourcen-/Jobprüfung:** Zielbibliothek und darin zugängliche Dateien; Ordner-/Summen-/Rootinformationen vor Aggregation filtern
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis
- **Einordnung:** Drei globale Übersichts-Unterrechte plus Datenbegrenzung auf lesbare Bibliotheken bestätigt; technische Endpunktprojektion/Mehrfachnutzung bleibt T.

### EXPORT · T

- **Funktionsrecht:** library.export + Empfehlung library.read
- **Ressourcen-/Jobprüfung:** Zielbibliothek/Datei und alle Filter/Sortierung; vollständiger erlaubter Ergebnissatz, Playback nur mit connector.playback; Stream nicht ungeprüft aus globalem Cache
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### SEARCH · B/T

- **Funktionsrecht:** library.read im Ergebnisscope; overview.compare bei Verwendung als Vergleich
- **Ressourcen-/Jobprüfung:** Suche über alle erlaubten Bibliotheken vor Ranking/Limit; keine Treffer verborgener Dateien; dieselbe API ist auch in anderen zulässigen Kontexten nutzbar
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis
- **Einordnung:** Drei globale Übersichts-Unterrechte plus Datenbegrenzung auf lesbare Bibliotheken bestätigt; technische Endpunktprojektion/Mehrfachnutzung bleibt T.

### CAP_VIEW · T

- **Funktionsrecht:** Empfehlung transcode.view ODER transcode.run ODER settings.hardware.view
- **Ressourcen-/Jobprüfung:** Nur notwendige technische Laufzeitfähigkeiten; globale Betriebsdaten/Secrets nicht freigeben; kein Teststart durch Lesepolicy
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### CAP_TEST · T

- **Funktionsrecht:** Empfehlung settings.hardware.edit
- **Ressourcen-/Jobprüfung:** Realer globaler Hardwaretest; Ressourcen-/busy-Grenzen; kein Bibliotheksrecht ersetzt dieses Verwaltungsrecht
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### PRESET_VIEW · T

- **Funktionsrecht:** settings.presets.view
- **Ressourcen-/Jobprüfung:** Installationsweiter Profil-/Formatierungsbereich; deprecated profiles sind identische Aliase
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### PRESET_EDIT · T

- **Funktionsrecht:** settings.presets.edit + Empfehlung .view
- **Ressourcen-/Jobprüfung:** Globaler Bereich; Built-in-Sperren und Verweise/Regelwirkungen beachten; keine verborgenen Dateidetails
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### AUTO_RULE_VIEW · B/T

- **Funktionsrecht:** settings.app.view
- **Ressourcen-/Jobprüfung:** Persistente Regelkonfiguration; referenzierte lokale Bibliotheken/Pfade gemäß erlaubten Aktionen projizieren; keine Freigabe allein durch Jobansicht
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis
- **Einordnung:** Bereichszuordnung und zusätzliche Transcodingrechte je Bibliothek bestätigt am 22.10.2026; technische DTO-/Abhängigkeits-/Batchdetails bleiben T.

### AUTO_RULE_EDIT · B/T

- **Funktionsrecht:** settings.app.edit + transcode.run aller betroffenen Bibliotheken; bei Ersatz transcode.replace
- **Ressourcen-/Jobprüfung:** Alle Regelziele und Alt-/Neuziele prüfen; globale Reihung kann fremde Regeln beeinflussen, keine blinde Gesamtliste; dauerhafte Systemarbeit ausdrücklich kennzeichnen
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis
- **Einordnung:** Bereichszuordnung und zusätzliche Transcodingrechte je Bibliothek bestätigt am 22.10.2026; technische DTO-/Abhängigkeits-/Batchdetails bleiben T.

### AUTO_APPROVE · B/T

- **Funktionsrecht:** Wie AUTO_RULE_EDIT + transcode.replace für alle Regelbibliotheken
- **Ressourcen-/Jobprüfung:** Regelversion und explizite serverseitige Ersatzbestätigung prüfen; Presetänderung darf Freigabe nicht umgehen
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis
- **Einordnung:** Bereichszuordnung und zusätzliche Transcodingrechte je Bibliothek bestätigt am 22.10.2026; technische DTO-/Abhängigkeits-/Batchdetails bleiben T.

### AUTO_PREVIEW · T

- **Funktionsrecht:** transcode.run + Empfehlung transcode.view/library.read
- **Ressourcen-/Jobprüfung:** Scope aus rule_ids/library_ids/source_file_ids vor Materialisierung auf jede Zielbibliothek prüfen; Ersatzrecht bei Ersatzplänen; kein Preview von verborgenen Dateien
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis
- **Einordnung:** Technische Zuordnung von Inventarläufen; O-01 zur dauerhaften Regelverwaltung ist erledigt. Keine pauschale Bestätigung sämtlicher Laufdetails.

### AUTO_START · T

- **Funktionsrecht:** transcode.run + Empfehlung transcode.view/library.read
- **Ressourcen-/Jobprüfung:** Jede Zielbibliothek prüfen, Originalersatz zusätzlich; nutzerausgelösten Inventarlauf nicht als privilegierten Systemlauf ausführen; queued erneut prüfen
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis
- **Einordnung:** Technische Zuordnung von Inventarläufen; O-01 zur dauerhaften Regelverwaltung ist erledigt. Keine pauschale Bestätigung sämtlicher Laufdetails.

### AUTO_VIEW · T

- **Funktionsrecht:** transcode.view im erlaubten Bibliotheksumfang
- **Ressourcen-/Jobprüfung:** Run kann mehrere Bibliotheken enthalten: sichere Teilansicht mit neu berechneten Zählern/IDs; nicht vollständig erlaubten Run nie unverändert ausgeben
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis
- **Einordnung:** Technische Zuordnung von Inventarläufen; O-01 zur dauerhaften Regelverwaltung ist erledigt. Keine pauschale Bestätigung sämtlicher Laufdetails.

### AUTO_CANCEL · T/O-07

- **Funktionsrecht:** transcode.cancel_own oder transcode.cancel_other passend zur Herkunft + transcode.view
- **Ressourcen-/Jobprüfung:** Nur erlaubte Bibliotheken/queued Teiljobs; nicht pauschal kompletten Mehrbibliothekslauf abbrechen; Gast-Eigenbezug ungeklärt
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis
- **Einordnung:** Technische Zuordnung von Inventarläufen; O-01 zur dauerhaften Regelverwaltung ist erledigt. Keine pauschale Bestätigung sämtlicher Laufdetails.

### TRANSCODE_FILE · T

- **Funktionsrecht:** transcode.view + Empfehlung library.read
- **Ressourcen-/Jobprüfung:** Quelldatei->Bibliothek prüfen; verknüpfte Varianten/Jobs nur im erlaubten Scope; Plan-/Presetprojektion ohne volle Konfigurationsfreigabe
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### TRANSCODE_RUN · T

- **Funktionsrecht:** transcode.run + Empfehlung transcode.view/library.read; bei target replace_original zusätzlich transcode.replace
- **Ressourcen-/Jobprüfung:** Quelldatei->Bibliothek vor Validierung/Start; Remote-Ziel kein Bypass; ausdrückliche Ersatzbestätigung und Pfadprüfung bleiben; Herkunft persistieren
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### TRANSCODE_VIEW · T

- **Funktionsrecht:** transcode.view im jeweiligen Bibliotheksumfang
- **Ressourcen-/Jobprüfung:** Job über library_id auch ohne source_file_id auflösen; Listen/Totals/Status filterbar; technische Diagnosen enthalten, Secrets redigieren
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### TRANSCODE_CLEAN · T

- **Funktionsrecht:** transcode.clean + Empfehlung transcode.view
- **Ressourcen-/Jobprüfung:** Nur sichtbare terminale Jobhistorie der erlaubten Bibliothek; kein Löschen der Medien/Variantenbeziehung ableiten
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### TRANSCODE_CANCEL · T/O-07

- **Funktionsrecht:** transcode.cancel_own ODER transcode.cancel_other + Empfehlung transcode.view
- **Ressourcen-/Jobprüfung:** Jobbibliothek und beständige Auslöseridentität; fremde/Systemjobs nur mit cancel_other; aktueller User nicht über Anzeigename vergleichen
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### FILE_READ · T

- **Funktionsrecht:** library.read der Ursprungsbibliothek
- **Ressourcen-/Jobprüfung:** file_id->library_id; Rohdaten/Streams/Qualität/technische Historie enthalten; Playback in eingebetteten Daten ausschließen ohne connector.playback
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### FILE_CONNECTOR · T

- **Funktionsrecht:** library.read der Datei; Playback nur connector.playback
- **Ressourcen-/Jobprüfung:** Datei und lokale Matches im Scope; externer Metadatenoverlay erfordert nicht pauschal volle Connector-Konfigurationssicht; keine Secrets
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### PLAYBACK · T

- **Funktionsrecht:** connector.playback + library.read der Datei
- **Ressourcen-/Jobprüfung:** Alle gematchten Verbindungen nur für erlaubte Datei; kein Cross-Server-Zugriffsersatz
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### REMOTE_ITEM · T/O-04

- **Funktionsrecht:** connector.view laut Katalogempfehlung ODER gematchte erlaubte library.read; Playback nur connector.playback
- **Ressourcen-/Jobprüfung:** Externe item_id sicher auf lokale Matches/erlaubte Katalogsicht abbilden; existierende Antwort enthält user_data, daher projektionieren
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### IMAGE · T/O-04/O-06

- **Funktionsrecht:** Empfehlung library.read über erlaubten Match ODER zulässige Connector-Katalogansicht
- **Ressourcen-/Jobprüfung:** item_id vor 304/ETag und vor Cachelookup prüfen; keine externe API-Key-Weitergabe; Bildcache kein Autorisierungsersatz
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### PROFILE_VIEW · T/O-06

- **Funktionsrecht:** Empfehlung settings.hardware.view
- **Ressourcen-/Jobprüfung:** Hardware-, Software- und Kombinationsprofile unter gemeinsamem vorhandenen Bereich; kein neues sichtbares V1-Recht
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### PROFILE_EDIT · T/O-06

- **Funktionsrecht:** Empfehlung settings.hardware.edit + .view
- **Ressourcen-/Jobprüfung:** Installationsweiter Katalog, ID/Referenzen und Built-in-Sperren prüfen; keine Bibliotheksrechte nötig
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### PROFILE_EVAL · T/O-06

- **Funktionsrecht:** library.read der Datei; Empfehlung begrenzte Profilprojektion unter Dateiansicht
- **Ressourcen-/Jobprüfung:** file_id auch im Requestbody prüfen; technische Evaluation, keine Mutation des Katalogs und kein pauschales Katalogrecht
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### COVER · T/O-06

- **Funktionsrecht:** Empfehlung library.read; bei download=true library.download
- **Ressourcen-/Jobprüfung:** file_id->Bibliothek vor Extraktion; Metadatenbild versus expliziter Download; no-store; Geheimnisse aus Fehlerdiagnosen entfernen
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### MEDIA · T

- **Funktionsrecht:** library.preview für inline; library.download für download=true; Empfehlung jeweils library.read
- **Ressourcen-/Jobprüfung:** file_id->Bibliothek vor Datei-/Range-/Bedingungsantwort; Preview liefert Originalbytes und ist kein Kopierschutz; Content-Disposition allein ist keine Prüfung
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### VARIANT_MEDIA · T

- **Funktionsrecht:** library.preview; Empfehlung library.read; expliziter Downloadweg falls ergänzt library.download
- **Ressourcen-/Jobprüfung:** variant_id->Gruppe->Ursprungsbibliothek auch ohne Primärdatei prüfen; Output-Pfadgrenze reicht nicht; alle Range/Bedingungsantworten gleich schützen
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### FED_VIEW · T/O-05

- **Funktionsrecht:** Empfehlung settings.app.view
- **Ressourcen-/Jobprüfung:** Globale Federationkonfiguration; Pairingcode/Shared Secrets nicht im normalen Lese-DTO; getrennte Verwalterprojektion
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### FED_EDIT · T/O-05

- **Funktionsrecht:** Empfehlung settings.app.edit
- **Ressourcen-/Jobprüfung:** Globale Member-/Endpointverwaltung; Test/Discover/Sync als erlaubte Verwaltungsaktion; DTO ohne unbeabsichtigte Secrets
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### FED_CODE · T/O-05

- **Funktionsrecht:** Empfehlung settings.app.edit
- **Ressourcen-/Jobprüfung:** Pairingnachweis nur gezielt für berechtigten Pairingworkflow; nie Shared Secret oder Browsertoken ausgeben
- **Vertrauen:** Browserkonto / aktivierter Gast / Desktopnachweis

### M_HELLO · T

- **Funktionsrecht:** Keine Browser-/Gastrechte; explizite Protokoll-Ausnahme
- **Ressourcen-/Jobprüfung:** Minimierten Deskriptor, Aktivierung/Rate-Limit und vor-Setup-Verhalten definieren; heute gibt hello auch enabled-Status aus
- **Vertrauen:** Maschine: vor Pairing, ohne Memberauthentifizierung

### M_PAIR · T

- **Funktionsrecht:** Keine Browser-/Gastrechte; Pairingcode
- **Ressourcen-/Jobprüfung:** Aktiviertes Federation-Opt-in/Prozessgate, gültiger Pairingnachweis, Protokollversion; eigener Rate-Limit-/Origin-unabhängiger Maschinenvertrag
- **Vertrauen:** Maschine: Pairingnachweis

### M_MEMBER · T

- **Funktionsrecht:** Keine interaktiven Funktionsrechte; Memberauthentifizierung
- **Ressourcen-/Jobprüfung:** X-MediaLyze-Installation-ID + authentifizierter Envelope; Memberstatus, Replay/Zeitfenster, Operation/Objektzugehörigkeit und Opt-in je Pfad prüfen
- **Vertrauen:** Maschine: gepaarter Member

### M_TRANSFER · T

- **Funktionsrecht:** Keine Browser-/Gastrechte; Member-/Attempt-/Transferbindung
- **Ressourcen-/Jobprüfung:** Envelope/Member + Richtung/Rolle/Origin + Transfer/Attempt-ID im Body und Pfad; Pfad-/Chunk-/Größen-/Hash-/Speichergrenzen
- **Vertrauen:** Maschine: gepaarter Member

### M_JOB · T

- **Funktionsrecht:** Keine Browser-/Gastrechte; Member-/Attemptbindung
- **Ressourcen-/Jobprüfung:** Envelope und Member prüfen; fremde Attempts ablehnen; zugewiesener remote Workspace, kein beliebiger lokaler Bibliothekszugriff
- **Vertrauen:** Maschine: gepaarter Member

### OPENAPI · T

- **Funktionsrecht:** Empfehlung nur nach Anmeldung bzw. Desktop; Protokollschema nur im Maschinen-/Betriebskontext
- **Ressourcen-/Jobprüfung:** Schema und Docs nicht vor Setup öffentlich; keine eigenen Datenrechte; Entscheidung als technische Expositionspolicy festschreiben
- **Vertrauen:** Browserkonto / Desktop / separater Betriebskontext

### STATIC · T

- **Funktionsrecht:** Kein Datenrecht für freigegebene gebaute UI-Ressourcen
- **Ressourcen-/Jobprüfung:** Nur Distribution-Assets mit kanonischer Pfadgrenze; keine DB/Exports/Medien; JS/CSS Sidecars/Range/304 dürfen nur diese öffentlichen Bytes betreffen
- **Vertrauen:** Öffentlich: Login-/Setup-Shell und statische Assets

### FALLBACK · T

- **Funktionsrecht:** Kein Datenrecht für öffentliche Login-/Setup-Shell
- **Ressourcen-/Jobprüfung:** Unbekannte API-Pfade nie als HTML-Erfolg; keine privaten Zustandsdaten im HTML; direkte Frontenddateien nur geprüft unter dist
- **Vertrauen:** Öffentlich: UI-Shell

### CORS · T

- **Funktionsrecht:** Keine Ressourcenerlaubnis durch Preflight
- **Ressourcen-/Jobprüfung:** Nur zugelassene Origins/Methoden/Header; eigentliche Anfrage weiterhin autorisieren; aktuelles *-CORS ersetzen
- **Vertrauen:** Browser-Origin, kein Authentifizierungsnachweis

## Einzelinventar

Quellenpfade relativ zum Repository. Zeilennummern beziehen sich auf den geprüften lokalen Stand. Ein Policyverweis gilt stets einschließlich aller drei Felder aus der Definition. `Protokoll` in der Listener-Spalte bezeichnet den zusätzlichen ASGI-Listener.

| ID | Listener | Methode | Vollständiger Pfad | Quelle / Handler | Policy | Registrierung / Besonderheit | Heutiger Schutz |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E001 | Haupt-App | GET | `/api/transcoding/federation` | backend/app/api/federation_routes.py:107 / federation_detail | FED_VIEW (T/O-05) | UI versteckt; Funktions-/Opt-in-Gates nicht mit Zugriffspolitik verwechseln | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E002 | Haupt-App | PATCH | `/api/transcoding/federation` | backend/app/api/federation_routes.py:116 / federation_update | FED_EDIT (T/O-05) | UI versteckt; Funktions-/Opt-in-Gates nicht mit Zugriffspolitik verwechseln | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E003 | Haupt-App | POST | `/api/transcoding/federation/passcode/reset` | backend/app/api/federation_routes.py:132 / federation_passcode_reset | FED_CODE (T/O-05) | UI versteckt; Funktions-/Opt-in-Gates nicht mit Zugriffspolitik verwechseln | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E004 | Haupt-App | POST | `/api/transcoding/federation/discover` | backend/app/api/federation_routes.py:146 / federation_discover | FED_EDIT (T/O-05) | UI versteckt; Funktions-/Opt-in-Gates nicht mit Zugriffspolitik verwechseln | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E005 | Haupt-App | POST | `/api/transcoding/federation/network/test` | backend/app/api/federation_routes.py:158 / federation_network_test | FED_EDIT (T/O-05) | UI versteckt; Funktions-/Opt-in-Gates nicht mit Zugriffspolitik verwechseln | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E006 | Haupt-App | POST | `/api/transcoding/federation/members/pair` | backend/app/api/federation_routes.py:172 / federation_pair | FED_EDIT (T/O-05) | UI versteckt; Funktions-/Opt-in-Gates nicht mit Zugriffspolitik verwechseln | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E007 | Haupt-App | POST | `/api/transcoding/federation/members/{installation_id}/sync` | backend/app/api/federation_routes.py:187 / federation_member_sync | FED_EDIT (T/O-05) | UI versteckt; Funktions-/Opt-in-Gates nicht mit Zugriffspolitik verwechseln | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E008 | Haupt-App | PATCH | `/api/transcoding/federation/members/{installation_id}/endpoints` | backend/app/api/federation_routes.py:202 / federation_member_endpoint_preference | FED_EDIT (T/O-05) | UI versteckt; Funktions-/Opt-in-Gates nicht mit Zugriffspolitik verwechseln | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E009 | Haupt-App | POST | `/api/transcoding/federation/members/{installation_id}/capability-matrix/test` | backend/app/api/federation_routes.py:219 / federation_member_capability_matrix_test | FED_EDIT (T/O-05) | UI versteckt; Funktions-/Opt-in-Gates nicht mit Zugriffspolitik verwechseln | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E010 | Haupt-App | GET | `/api/transcoding/federation/members/{installation_id}/capability-matrix/test/progress` | backend/app/api/federation_routes.py:237 / federation_member_capability_matrix_test_progress | FED_VIEW (T/O-05) | UI versteckt; Funktions-/Opt-in-Gates nicht mit Zugriffspolitik verwechseln | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E011 | Haupt-App | DELETE | `/api/transcoding/federation/members/{installation_id}` | backend/app/api/federation_routes.py:252 / federation_member_exclude | FED_EDIT (T/O-05) | UI versteckt; Funktions-/Opt-in-Gates nicht mit Zugriffspolitik verwechseln | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E012 | Haupt-App | POST | `/api/transcoding/federation/protocol/hello` | backend/app/api/federation_routes.py:261 / federation_protocol_hello | M_HELLO (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | hello ohne Membernachweis |
| E013 | Separater Federation-Listener | POST | `/api/transcoding/federation/protocol/hello` | backend/app/api/federation_routes.py:261; backend/app/api/federation_app.py:35 / federation_protocol_hello | M_HELLO (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | hello ohne Membernachweis |
| E014 | Haupt-App | POST | `/api/transcoding/federation/protocol/pair` | backend/app/api/federation_routes.py:272 / federation_protocol_pair | M_PAIR (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Pairingcode/Opt-in |
| E015 | Separater Federation-Listener | POST | `/api/transcoding/federation/protocol/pair` | backend/app/api/federation_routes.py:272; backend/app/api/federation_app.py:35 / federation_protocol_pair | M_PAIR (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Pairingcode/Opt-in |
| E016 | Haupt-App | POST | `/api/transcoding/federation/protocol/heartbeat` | backend/app/api/federation_routes.py:284 / federation_protocol_heartbeat | M_MEMBER (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E017 | Separater Federation-Listener | POST | `/api/transcoding/federation/protocol/heartbeat` | backend/app/api/federation_routes.py:284; backend/app/api/federation_app.py:35 / federation_protocol_heartbeat | M_MEMBER (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E018 | Haupt-App | POST | `/api/transcoding/federation/protocol/network/probe` | backend/app/api/federation_routes.py:301 / federation_protocol_network_probe | M_MEMBER (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E019 | Separater Federation-Listener | POST | `/api/transcoding/federation/protocol/network/probe` | backend/app/api/federation_routes.py:301; backend/app/api/federation_app.py:35 / federation_protocol_network_probe | M_MEMBER (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E020 | Haupt-App | POST | `/api/transcoding/federation/protocol/capability-matrix/test` | backend/app/api/federation_routes.py:315 / federation_protocol_capability_matrix_test | M_MEMBER (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E021 | Separater Federation-Listener | POST | `/api/transcoding/federation/protocol/capability-matrix/test` | backend/app/api/federation_routes.py:315; backend/app/api/federation_app.py:35 / federation_protocol_capability_matrix_test | M_MEMBER (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E022 | Haupt-App | POST | `/api/transcoding/federation/protocol/capability-matrix/test/progress` | backend/app/api/federation_routes.py:339 / federation_protocol_capability_matrix_test_progress | M_MEMBER (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E023 | Separater Federation-Listener | POST | `/api/transcoding/federation/protocol/capability-matrix/test/progress` | backend/app/api/federation_routes.py:339; backend/app/api/federation_app.py:35 / federation_protocol_capability_matrix_test_progress | M_MEMBER (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E024 | Haupt-App | POST | `/api/transcoding/federation/protocol/transfers/{transfer_id}/chunk` | backend/app/api/federation_routes.py:358 / federation_protocol_transfer_chunk | M_TRANSFER (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E025 | Separater Federation-Listener | POST | `/api/transcoding/federation/protocol/transfers/{transfer_id}/chunk` | backend/app/api/federation_routes.py:358; backend/app/api/federation_app.py:35 / federation_protocol_transfer_chunk | M_TRANSFER (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E026 | Haupt-App | POST | `/api/transcoding/federation/protocol/jobs/assign` | backend/app/api/federation_routes.py:432 / federation_protocol_assign | M_JOB (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E027 | Separater Federation-Listener | POST | `/api/transcoding/federation/protocol/jobs/assign` | backend/app/api/federation_routes.py:432; backend/app/api/federation_app.py:35 / federation_protocol_assign | M_JOB (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E028 | Haupt-App | POST | `/api/transcoding/federation/protocol/jobs/{attempt_id}/status` | backend/app/api/federation_routes.py:447 / federation_protocol_attempt_status | M_JOB (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E029 | Separater Federation-Listener | POST | `/api/transcoding/federation/protocol/jobs/{attempt_id}/status` | backend/app/api/federation_routes.py:447; backend/app/api/federation_app.py:35 / federation_protocol_attempt_status | M_JOB (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E030 | Haupt-App | POST | `/api/transcoding/federation/protocol/jobs/{attempt_id}/cancel` | backend/app/api/federation_routes.py:464 / federation_protocol_attempt_cancel | M_JOB (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E031 | Separater Federation-Listener | POST | `/api/transcoding/federation/protocol/jobs/{attempt_id}/cancel` | backend/app/api/federation_routes.py:464; backend/app/api/federation_app.py:35 / federation_protocol_attempt_cancel | M_JOB (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E032 | Haupt-App | POST | `/api/transcoding/federation/protocol/transfers/{transfer_id}/read` | backend/app/api/federation_routes.py:485 / federation_protocol_transfer_read | M_TRANSFER (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E033 | Separater Federation-Listener | POST | `/api/transcoding/federation/protocol/transfers/{transfer_id}/read` | backend/app/api/federation_routes.py:485; backend/app/api/federation_app.py:35 / federation_protocol_transfer_read | M_TRANSFER (T) | auf Haupt-App und zusätzlichem Protokoll-Listener registrierbar; Runtime kann Listener aktivieren | Member-ID + Secure Envelope; weitere Objekt-/Funktionsprüfungen im Handler/Service |
| E034 | Haupt-App | GET | `/api/health` | backend/app/api/routes.py:479 / health | HEALTH (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E035 | Haupt-App | GET | `/api/browse` | backend/app/api/routes.py:484 / browse | BROWSE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E036 | Haupt-App | POST | `/api/paths/inspect` | backend/app/api/routes.py:495 / inspect_path | DESKTOP_PATH (T) | Handler nur Desktop | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E037 | Haupt-App | GET | `/api/dashboard` | backend/app/api/routes.py:508 / dashboard | DASHBOARD (B/T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E038 | Haupt-App | GET | `/api/dashboard/history` | backend/app/api/routes.py:531 / dashboard_history | DASHBOARD (B/T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E039 | Haupt-App | GET | `/api/dashboard/comparison` | backend/app/api/routes.py:538 / dashboard_comparison | DASHBOARD (B/T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E040 | Haupt-App | GET | `/api/scan-jobs/active` | backend/app/api/routes.py:550 / active_scan_jobs | SCAN_VIEW (T/O-03) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E041 | Haupt-App | GET | `/api/scan-jobs/recent` | backend/app/api/routes.py:555 / recent_scan_jobs | SCAN_VIEW (T/O-03) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E042 | Haupt-App | GET | `/api/history-storage` | backend/app/api/routes.py:572 / history_storage | APP_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E043 | Haupt-App | GET | `/api/history/reconstruct` | backend/app/api/routes.py:580 / history_reconstruct_status | RECONSTRUCT_VIEW (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E044 | Haupt-App | POST | `/api/history/reconstruct` | backend/app/api/routes.py:587 / history_reconstruct | RECONSTRUCT_EDIT (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E045 | Haupt-App | GET | `/api/scan-jobs/{job_id}` | backend/app/api/routes.py:597 / scan_job_detail | SCAN_VIEW (T/O-03) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E046 | Haupt-App | GET | `/api/app-settings` | backend/app/api/routes.py:605 / app_settings | APP_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E047 | Haupt-App | GET | `/api/update-status` | backend/app/api/routes.py:613 / update_status | UPDATE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E048 | Haupt-App | GET | `/api/desktop/update-reminder` | backend/app/api/routes.py:621 / desktop_update_reminder | DESKTOP_UPDATE (T) | Handler nur Desktop | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E049 | Haupt-App | POST | `/api/desktop/update-reminder/mark` | backend/app/api/routes.py:631 / mark_desktop_update_reminder_route | DESKTOP_UPDATE (T) | Handler nur Desktop | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E050 | Haupt-App | GET | `/api/telemetry/preview` | backend/app/api/routes.py:645 / telemetry_preview | APP_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E051 | Haupt-App | POST | `/api/telemetry/send-now` | backend/app/api/routes.py:666 / telemetry_send_now | APP_EDIT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E052 | Haupt-App | PATCH | `/api/app-settings` | backend/app/api/routes.py:681 / app_settings_update | APP_EDIT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E053 | Haupt-App | GET | `/api/quality-profiles` | backend/app/api/routes.py:709 / quality_profiles_list | QUALITY_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E054 | Haupt-App | POST | `/api/quality-profiles` | backend/app/api/routes.py:720 / quality_profile_create | QUALITY_EDIT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E055 | Haupt-App | PATCH | `/api/quality-profiles/{profile_id}` | backend/app/api/routes.py:737 / quality_profile_update | QUALITY_EDIT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E056 | Haupt-App | DELETE | `/api/quality-profiles/{profile_id}` | backend/app/api/routes.py:762 / quality_profile_delete | QUALITY_EDIT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E057 | Haupt-App | POST | `/api/scan-jobs/active/cancel` | backend/app/api/routes.py:778 / cancel_active_scan_jobs | SCAN_MUTATE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E058 | Haupt-App | GET | `/api/connectors/providers` | backend/app/api/routes.py:823 / connector_providers | CONNECTOR_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E059 | Haupt-App | GET | `/api/connectors/provider-descriptors` | backend/app/api/routes.py:828 / connector_provider_descriptors | CONNECTOR_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E060 | Haupt-App | GET | `/api/connectors` | backend/app/api/routes.py:848 / connector_connections | CONNECTOR_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E061 | Haupt-App | POST | `/api/connectors` | backend/app/api/routes.py:860 / connector_connection_create | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E062 | Haupt-App | GET | `/api/connectors/{connection_id}` | backend/app/api/routes.py:876 / connector_connection_get | CONNECTOR_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E063 | Haupt-App | PATCH | `/api/connectors/{connection_id}` | backend/app/api/routes.py:887 / connector_connection_update | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E064 | Haupt-App | DELETE | `/api/connectors/{connection_id}` | backend/app/api/routes.py:934 / connector_connection_delete | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E065 | Haupt-App | POST | `/api/connectors/{connection_id}/test` | backend/app/api/routes.py:965 / connector_connection_test | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E066 | Haupt-App | POST | `/api/connectors/{connection_id}/sync` | backend/app/api/routes.py:997 / connector_sync_start | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E067 | Haupt-App | POST | `/api/connectors/{connection_id}/sync/cancel` | backend/app/api/routes.py:1015 / connector_sync_cancel | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E068 | Haupt-App | GET | `/api/connectors/{connection_id}/sync/status` | backend/app/api/routes.py:1047 / connector_sync_status | CONNECTOR_JOB (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E069 | Haupt-App | GET | `/api/connector-jobs/active` | backend/app/api/routes.py:1080 / connector_active_jobs | CONNECTOR_JOB (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E070 | Haupt-App | GET | `/api/connectors/{connection_id}/users` | backend/app/api/routes.py:1123 / connector_users | CONNECTOR_USERS (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E071 | Haupt-App | PUT | `/api/connectors/{connection_id}/users` | backend/app/api/routes.py:1138 / connector_users_update | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E072 | Haupt-App | GET | `/api/connectors/{connection_id}/libraries` | backend/app/api/routes.py:1183 / connector_libraries | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E073 | Haupt-App | POST | `/api/connectors/{connection_id}/libraries/{connector_library_id}/create-medialyze-library` | backend/app/api/routes.py:1193 / connector_library_create_medialyze | CONNECTOR_CREATE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E074 | Haupt-App | GET | `/api/connectors/{connection_id}/locations` | backend/app/api/routes.py:1258 / connector_locations | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E075 | Haupt-App | GET | `/api/connectors/{connection_id}/bindings` | backend/app/api/routes.py:1275 / connector_bindings | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E076 | Haupt-App | GET | `/api/connectors/{connection_id}/mapping-overview` | backend/app/api/routes.py:1297 / connector_mapping_overview | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E077 | Haupt-App | PUT | `/api/connectors/{connection_id}/bindings` | backend/app/api/routes.py:1311 / connector_bindings_replace | CONNECTOR_LINK (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E078 | Haupt-App | PUT | `/api/connectors/{connection_id}/library-links` | backend/app/api/routes.py:1331 / connector_library_links_replace | CONNECTOR_LINK (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E079 | Haupt-App | GET | `/api/connectors/{connection_id}/items` | backend/app/api/routes.py:1348 / connector_items | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E080 | Haupt-App | GET | `/api/connectors/{connection_id}/item-status-summary` | backend/app/api/routes.py:1382 / connector_item_status_summary | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E081 | Haupt-App | GET | `/api/connectors/{connection_id}/items/{item_id}/provider-payload` | backend/app/api/routes.py:1399 / connector_item_provider_payload | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E082 | Haupt-App | GET | `/api/jellyfin/connection` | backend/app/api/routes.py:1470 / jellyfin_connection_get | CONNECTOR_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E083 | Haupt-App | PATCH | `/api/jellyfin/connection` | backend/app/api/routes.py:1479 / jellyfin_connection_update | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E084 | Haupt-App | DELETE | `/api/jellyfin/connection` | backend/app/api/routes.py:1521 / jellyfin_connection_delete | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E085 | Haupt-App | POST | `/api/jellyfin/test` | backend/app/api/routes.py:1551 / jellyfin_test | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E086 | Haupt-App | POST | `/api/jellyfin/sync` | backend/app/api/routes.py:1575 / jellyfin_sync | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E087 | Haupt-App | POST | `/api/jellyfin/sync/cancel` | backend/app/api/routes.py:1587 / jellyfin_sync_cancel | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E088 | Haupt-App | GET | `/api/jellyfin/sync/status` | backend/app/api/routes.py:1595 / jellyfin_sync_status | CONNECTOR_JOB (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E089 | Haupt-App | GET | `/api/jellyfin/users` | backend/app/api/routes.py:1645 / jellyfin_users | CONNECTOR_USERS (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E090 | Haupt-App | PATCH | `/api/jellyfin/users` | backend/app/api/routes.py:1650 / jellyfin_users_update | CONNECTOR_MANAGE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E091 | Haupt-App | GET | `/api/jellyfin/path-mappings` | backend/app/api/routes.py:1703 / jellyfin_path_mappings | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E092 | Haupt-App | PUT | `/api/jellyfin/path-mappings/batch` | backend/app/api/routes.py:1740 / jellyfin_path_mappings_batch_update | CONNECTOR_LINK (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E093 | Haupt-App | POST | `/api/jellyfin/path-mappings` | backend/app/api/routes.py:1790 / jellyfin_path_mapping_create | CONNECTOR_LINK (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E094 | Haupt-App | PATCH | `/api/jellyfin/path-mappings/{mapping_id}` | backend/app/api/routes.py:1804 / jellyfin_path_mapping_update | CONNECTOR_LINK (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E095 | Haupt-App | DELETE | `/api/jellyfin/path-mappings/{mapping_id}` | backend/app/api/routes.py:1822 / jellyfin_path_mapping_delete | CONNECTOR_LINK (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E096 | Haupt-App | GET | `/api/jellyfin/matches/recompute/status` | backend/app/api/routes.py:1836 / jellyfin_match_recompute_status | CONNECTOR_JOB (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E097 | Haupt-App | GET | `/api/jellyfin/libraries` | backend/app/api/routes.py:1848 / jellyfin_libraries | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E098 | Haupt-App | PATCH | `/api/jellyfin/libraries/{jellyfin_library_id}/link` | backend/app/api/routes.py:1856 / jellyfin_library_link_update | CONNECTOR_LINK (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E099 | Haupt-App | GET | `/api/jellyfin/catalog/summary` | backend/app/api/routes.py:1894 / jellyfin_catalog_summary | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E100 | Haupt-App | GET | `/api/jellyfin/libraries/{jellyfin_library_id}/overview` | backend/app/api/routes.py:1914 / jellyfin_library_overview | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E101 | Haupt-App | GET | `/api/jellyfin/libraries/{jellyfin_library_id}/items` | backend/app/api/routes.py:1928 / jellyfin_library_items | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E102 | Haupt-App | POST | `/api/jellyfin/libraries/{jellyfin_library_id}/create-medialyze-library` | backend/app/api/routes.py:1972 / jellyfin_library_create_medialyze | CONNECTOR_CREATE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E103 | Haupt-App | GET | `/api/jellyfin/unmatched` | backend/app/api/routes.py:2023 / jellyfin_unmatched | CONNECTOR_CATALOG (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E104 | Haupt-App | GET | `/api/libraries` | backend/app/api/routes.py:2042 / libraries | LIB_LIST (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E105 | Haupt-App | POST | `/api/libraries` | backend/app/api/routes.py:2047 / libraries_create | LIB_CREATE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E106 | Haupt-App | GET | `/api/libraries/{library_id}/summary` | backend/app/api/routes.py:2065 / library_summary | LIB_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E107 | Haupt-App | GET | `/api/libraries/{library_id}/statistics` | backend/app/api/routes.py:2073 / library_statistics | LIB_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E108 | Haupt-App | GET | `/api/libraries/{library_id}/statistics/comparison` | backend/app/api/routes.py:2085 / library_statistics_comparison | LIB_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E109 | Haupt-App | GET | `/api/libraries/{library_id}/duplicates` | backend/app/api/routes.py:2107 / library_duplicates | LIB_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E110 | Haupt-App | POST | `/api/libraries/{library_id}/duplicates/suppressions` | backend/app/api/routes.py:2129 / library_duplicate_suppression_create | DUP_WRITE (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E111 | Haupt-App | DELETE | `/api/libraries/{library_id}/duplicates/suppressions` | backend/app/api/routes.py:2148 / library_duplicate_suppression_delete | DUP_WRITE (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E112 | Haupt-App | GET | `/api/libraries/{library_id}/history` | backend/app/api/routes.py:2163 / library_history | LIB_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E113 | Haupt-App | GET | `/api/libraries/{library_id}/scan-jobs` | backend/app/api/routes.py:2173 / library_scan_jobs | SCAN_VIEW (T/O-03) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E114 | Haupt-App | GET | `/api/libraries/{library_id}/series` | backend/app/api/routes.py:2184 / library_series | LIB_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E115 | Haupt-App | GET | `/api/libraries/{library_id}/series/{series_id}` | backend/app/api/routes.py:2191 / library_series_detail | LIB_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E116 | Haupt-App | GET | `/api/libraries/{library_id}/series/{series_id}/grouped-detail` | backend/app/api/routes.py:2203 / library_series_grouped_detail | LIB_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E117 | Haupt-App | PATCH | `/api/libraries/{library_id}` | backend/app/api/routes.py:2314 / library_update | LIB_PATCH (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E118 | Haupt-App | DELETE | `/api/libraries/{library_id}` | backend/app/api/routes.py:2356 / library_delete | LIB_DELETE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E119 | Haupt-App | GET | `/api/libraries/{library_id}/files` | backend/app/api/routes.py:2381 / library_files | LIB_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E120 | Haupt-App | GET | `/api/libraries/{library_id}/storage-map` | backend/app/api/routes.py:2547 / library_storage_map | STORAGE (B/T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E121 | Haupt-App | GET | `/api/libraries/{library_id}/files/grouped` | backend/app/api/routes.py:2562 / library_grouped_files | LIB_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E122 | Haupt-App | GET | `/api/libraries/{library_id}/files/export.csv` | backend/app/api/routes.py:2729 / library_files_export_csv | EXPORT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E123 | Haupt-App | POST | `/api/libraries/{library_id}/scan/cancel` | backend/app/api/routes.py:2896 / library_scan_cancel | SCAN_MUTATE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E124 | Haupt-App | POST | `/api/libraries/{library_id}/scan` | backend/app/api/routes.py:2917 / library_scan | SCAN_MUTATE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E125 | Haupt-App | GET | `/api/files/search` | backend/app/api/routes.py:2939 / file_search | SEARCH (B/T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E126 | Haupt-App | GET | `/api/transcoding/capabilities` | backend/app/api/routes.py:2951 / transcoding_capabilities | CAP_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E127 | Haupt-App | GET | `/api/transcoding/capability-matrix` | backend/app/api/routes.py:2959 / transcoding_capability_matrix | CAP_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E128 | Haupt-App | GET | `/api/transcoding/capability-matrix/test/progress` | backend/app/api/routes.py:2966 / transcoding_capability_matrix_test_progress | CAP_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E129 | Haupt-App | POST | `/api/transcoding/capability-matrix/test` | backend/app/api/routes.py:2974 / transcoding_capability_matrix_test | CAP_TEST (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E130 | Haupt-App | GET | `/api/transcoding/formatting-presets` | backend/app/api/routes.py:2984 / transcoding_formatting_presets_list | PRESET_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E131 | Haupt-App | POST | `/api/transcoding/formatting-presets` | backend/app/api/routes.py:2989 / transcoding_formatting_preset_create | PRESET_EDIT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E132 | Haupt-App | PATCH | `/api/transcoding/formatting-presets/{preset_id}` | backend/app/api/routes.py:3000 / transcoding_formatting_preset_update | PRESET_EDIT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E133 | Haupt-App | DELETE | `/api/transcoding/formatting-presets/{preset_id}` | backend/app/api/routes.py:3012 / transcoding_formatting_preset_delete | PRESET_EDIT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E134 | Haupt-App | GET | `/api/transcoding/presets` | backend/app/api/routes.py:3021 / transcoding_presets_list | PRESET_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E135 | Haupt-App | GET | `/api/transcoding/profiles` | backend/app/api/routes.py:3022 / transcoding_presets_list | PRESET_VIEW (T) | Schema False; deprecated | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E136 | Haupt-App | POST | `/api/transcoding/presets` | backend/app/api/routes.py:3029 / transcoding_preset_create | PRESET_EDIT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E137 | Haupt-App | POST | `/api/transcoding/profiles` | backend/app/api/routes.py:3030 / transcoding_preset_create | PRESET_EDIT (T) | Schema False; deprecated | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E138 | Haupt-App | GET | `/api/transcoding/presets/{preset_id}` | backend/app/api/routes.py:3041 / transcoding_preset_detail | PRESET_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E139 | Haupt-App | GET | `/api/transcoding/profiles/{preset_id}` | backend/app/api/routes.py:3042 / transcoding_preset_detail | PRESET_VIEW (T) | Schema False; deprecated | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E140 | Haupt-App | PATCH | `/api/transcoding/presets/{preset_id}` | backend/app/api/routes.py:3053 / transcoding_preset_update | PRESET_EDIT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E141 | Haupt-App | PATCH | `/api/transcoding/profiles/{preset_id}` | backend/app/api/routes.py:3054 / transcoding_preset_update | PRESET_EDIT (T) | Schema False; deprecated | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E142 | Haupt-App | POST | `/api/transcoding/presets/{preset_id}/duplicate` | backend/app/api/routes.py:3066 / transcoding_preset_duplicate | PRESET_EDIT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E143 | Haupt-App | POST | `/api/transcoding/profiles/{preset_id}/duplicate` | backend/app/api/routes.py:3067 / transcoding_preset_duplicate | PRESET_EDIT (T) | Schema False; deprecated | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E144 | Haupt-App | DELETE | `/api/transcoding/presets/{preset_id}` | backend/app/api/routes.py:3079 / transcoding_preset_delete | PRESET_EDIT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E145 | Haupt-App | DELETE | `/api/transcoding/profiles/{preset_id}` | backend/app/api/routes.py:3080 / transcoding_preset_delete | PRESET_EDIT (T) | Schema False; deprecated | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E146 | Haupt-App | GET | `/api/transcoding/rules` | backend/app/api/routes.py:3092 / transcoding_rules_list | AUTO_RULE_VIEW (B/T) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E147 | Haupt-App | POST | `/api/transcoding/rules` | backend/app/api/routes.py:3102 / transcoding_rule_create | AUTO_RULE_EDIT (B/T) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E148 | Haupt-App | POST | `/api/transcoding/rules/reorder` | backend/app/api/routes.py:3113 / transcoding_rules_reorder | AUTO_RULE_EDIT (B/T) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E149 | Haupt-App | GET | `/api/transcoding/rules/{rule_id}` | backend/app/api/routes.py:3124 / transcoding_rule_detail | AUTO_RULE_VIEW (B/T) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E150 | Haupt-App | PATCH | `/api/transcoding/rules/{rule_id}` | backend/app/api/routes.py:3135 / transcoding_rule_update | AUTO_RULE_EDIT (B/T) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E151 | Haupt-App | POST | `/api/transcoding/rules/{rule_id}/replacement-approval` | backend/app/api/routes.py:3147 / transcoding_rule_replacement_approval | AUTO_APPROVE (B/T) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E152 | Haupt-App | DELETE | `/api/transcoding/rules/{rule_id}` | backend/app/api/routes.py:3159 / transcoding_rule_delete | AUTO_RULE_EDIT (B/T) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E153 | Haupt-App | POST | `/api/transcoding/automation/preview` | backend/app/api/routes.py:3171 / transcoding_automation_preview | AUTO_PREVIEW (T) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E154 | Haupt-App | POST | `/api/transcoding/automation/start` | backend/app/api/routes.py:3183 / transcoding_automation_start | AUTO_START (T) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E155 | Haupt-App | GET | `/api/transcoding/automation/status` | backend/app/api/routes.py:3196 / transcoding_automation_status | AUTO_VIEW (T) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E156 | Haupt-App | GET | `/api/transcoding/automation/runs` | backend/app/api/routes.py:3213 / transcoding_automation_runs | AUTO_VIEW (T) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E157 | Haupt-App | GET | `/api/transcoding/automation/{run_id}` | backend/app/api/routes.py:3221 / transcoding_automation_detail | AUTO_VIEW (T) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E158 | Haupt-App | POST | `/api/transcoding/automation/{run_id}/cancel` | backend/app/api/routes.py:3232 / transcoding_automation_cancel | AUTO_CANCEL (T/O-07) | UI versteckt, Route vorhanden | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E159 | Haupt-App | GET | `/api/files/{file_id}/transcode` | backend/app/api/routes.py:3243 / file_transcode_detail | TRANSCODE_FILE (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E160 | Haupt-App | POST | `/api/files/{file_id}/transcode/validate` | backend/app/api/routes.py:3257 / file_transcode_validate | TRANSCODE_RUN (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E161 | Haupt-App | POST | `/api/files/{file_id}/transcode` | backend/app/api/routes.py:3289 / file_transcode_start | TRANSCODE_RUN (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E162 | Haupt-App | GET | `/api/transcode-jobs/active` | backend/app/api/routes.py:3309 / transcode_jobs_active | TRANSCODE_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E163 | Haupt-App | GET | `/api/transcode-jobs` | backend/app/api/routes.py:3314 / transcode_jobs_list | TRANSCODE_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E164 | Haupt-App | GET | `/api/transcode-jobs/{job_id}` | backend/app/api/routes.py:3335 / transcode_job_detail | TRANSCODE_VIEW (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E165 | Haupt-App | DELETE | `/api/transcode-jobs/{job_id}` | backend/app/api/routes.py:3346 / transcode_job_delete | TRANSCODE_CLEAN (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E166 | Haupt-App | POST | `/api/transcode-jobs/{job_id}/cancel` | backend/app/api/routes.py:3357 / transcode_job_cancel | TRANSCODE_CANCEL (T/O-07) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E167 | Haupt-App | GET | `/api/files/{file_id}` | backend/app/api/routes.py:3370 / file_detail | FILE_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E168 | Haupt-App | GET | `/api/files/{file_id}/connectors` | backend/app/api/routes.py:3382 / file_connector_sources | FILE_CONNECTOR (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E169 | Haupt-App | GET | `/api/files/{file_id}/connector-playback` | backend/app/api/routes.py:3440 / file_connector_playback | PLAYBACK (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E170 | Haupt-App | GET | `/api/files/{file_id}/raw-ffprobe` | backend/app/api/routes.py:3523 / file_raw_ffprobe | FILE_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E171 | Haupt-App | GET | `/api/files/{file_id}/jellyfin` | backend/app/api/routes.py:3534 / file_jellyfin_overlay | FILE_CONNECTOR (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E172 | Haupt-App | GET | `/api/jellyfin/items/{item_id}` | backend/app/api/routes.py:3676 / jellyfin_item_detail | REMOTE_ITEM (T/O-04) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E173 | Haupt-App | GET | `/api/jellyfin/images/{item_id}/{image_type}` | backend/app/api/routes.py:3737 / jellyfin_image | IMAGE (T/O-04/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E174 | Haupt-App | GET | `/api/compatibility/hardware-profiles` | backend/app/api/routes.py:3785 / compatibility_hardware_profiles | PROFILE_VIEW (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E175 | Haupt-App | POST | `/api/compatibility/hardware-profiles` | backend/app/api/routes.py:3793 / create_compatibility_hardware_profile | PROFILE_EDIT (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E176 | Haupt-App | PATCH | `/api/compatibility/hardware-profiles/{profile_id}` | backend/app/api/routes.py:3804 / update_compatibility_hardware_profile | PROFILE_EDIT (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E177 | Haupt-App | DELETE | `/api/compatibility/hardware-profiles/{profile_id}` | backend/app/api/routes.py:3819 / delete_compatibility_hardware_profile | PROFILE_EDIT (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E178 | Haupt-App | GET | `/api/compatibility/software-profiles` | backend/app/api/routes.py:3832 / compatibility_software_profiles | PROFILE_VIEW (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E179 | Haupt-App | POST | `/api/compatibility/software-profiles` | backend/app/api/routes.py:3840 / create_compatibility_software_profile | PROFILE_EDIT (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E180 | Haupt-App | PATCH | `/api/compatibility/software-profiles/{profile_id}` | backend/app/api/routes.py:3851 / update_compatibility_software_profile | PROFILE_EDIT (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E181 | Haupt-App | DELETE | `/api/compatibility/software-profiles/{profile_id}` | backend/app/api/routes.py:3866 / delete_compatibility_software_profile | PROFILE_EDIT (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E182 | Haupt-App | GET | `/api/compatibility/profiles` | backend/app/api/routes.py:3879 / compatibility_profiles | PROFILE_VIEW (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E183 | Haupt-App | POST | `/api/compatibility/profiles` | backend/app/api/routes.py:3887 / create_compatibility_profile | PROFILE_EDIT (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E184 | Haupt-App | PATCH | `/api/compatibility/profiles/{profile_id}` | backend/app/api/routes.py:3898 / update_compatibility_profile | PROFILE_EDIT (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E185 | Haupt-App | DELETE | `/api/compatibility/profiles/{profile_id}` | backend/app/api/routes.py:3913 / delete_compatibility_profile | PROFILE_EDIT (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E186 | Haupt-App | POST | `/api/compatibility/profiles/{profile_id}/evaluate` | backend/app/api/routes.py:3948 / evaluate_saved_compatibility_profile | PROFILE_EVAL (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E187 | Haupt-App | GET | `/api/files/{file_id}/compatibility` | backend/app/api/routes.py:3961 / file_compatibility | PROFILE_EVAL (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E188 | Haupt-App | GET | `/api/files/{file_id}/hardware-compatibility` | backend/app/api/routes.py:3980 / file_hardware_compatibility | PROFILE_EVAL (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E189 | Haupt-App | GET | `/api/files/{file_id}/software-compatibility` | backend/app/api/routes.py:4005 / file_software_compatibility | PROFILE_EVAL (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E190 | Haupt-App | GET | `/api/files/{file_id}/chapters/export.csv` | backend/app/api/routes.py:4030 / file_chapters_export | EXPORT (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E191 | Haupt-App | GET | `/api/files/{file_id}/cover` | backend/app/api/routes.py:4043 / file_cover | COVER (T/O-06) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E192 | Haupt-App | GET | `/api/transcode-variants/{variant_id}/media` | backend/app/api/routes.py:4065 / transcode_variant_media | VARIANT_MEDIA (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E193 | Haupt-App | GET | `/api/files/{file_id}/media` | backend/app/api/routes.py:4087 / file_media | MEDIA (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E194 | Haupt-App | GET | `/api/files/{file_id}/streams` | backend/app/api/routes.py:4111 / file_stream_details | FILE_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E195 | Haupt-App | GET | `/api/files/{file_id}/quality-score` | backend/app/api/routes.py:4119 / file_quality_score | FILE_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E196 | Haupt-App | GET | `/api/files/{file_id}/history` | backend/app/api/routes.py:4127 / file_history | FILE_READ (T) | immer registriert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E197 | Haupt-App | GET | `/api/performance` | backend/app/main.py:126 / performance_snapshot | APP_VIEW (T) | Schema False; nur MEDIALYZE_PERFORMANCE_METRICS | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E198 | Haupt-App | GET | `/{path:path}` | backend/app/main.py:147 / serve_frontend | FALLBACK (T) | nur wenn frontend_dist existiert | Kein lokaler Nutzer-/Bibliotheks-Rechtecheck |
| E199 | Haupt-App | GET | `/openapi.json` | backend/app/main.py:116 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E200 | Haupt-App | HEAD | `/openapi.json` | backend/app/main.py:116 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E201 | Haupt-App | GET | `/docs` | backend/app/main.py:116 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E202 | Haupt-App | HEAD | `/docs` | backend/app/main.py:116 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E203 | Haupt-App | GET | `/docs/oauth2-redirect` | backend/app/main.py:116 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E204 | Haupt-App | HEAD | `/docs/oauth2-redirect` | backend/app/main.py:116 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E205 | Haupt-App | GET | `/redoc` | backend/app/main.py:116 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E206 | Haupt-App | HEAD | `/redoc` | backend/app/main.py:116 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E207 | Separater Federation-Listener | GET | `/openapi.json` | backend/app/api/federation_app.py:27 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E208 | Separater Federation-Listener | HEAD | `/openapi.json` | backend/app/api/federation_app.py:27 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E209 | Separater Federation-Listener | GET | `/docs` | backend/app/api/federation_app.py:27 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E210 | Separater Federation-Listener | HEAD | `/docs` | backend/app/api/federation_app.py:27 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E211 | Separater Federation-Listener | GET | `/docs/oauth2-redirect` | backend/app/api/federation_app.py:27 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E212 | Separater Federation-Listener | HEAD | `/docs/oauth2-redirect` | backend/app/api/federation_app.py:27 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E213 | Separater Federation-Listener | GET | `/redoc` | backend/app/api/federation_app.py:27 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E214 | Separater Federation-Listener | HEAD | `/redoc` | backend/app/api/federation_app.py:27 (FastAPI-Standardroute) / FastAPI framework | OPENAPI (T) | FastAPI-Defaults, docs_url/redoc_url/openapi_url nicht deaktiviert | Kein lokaler Nutzer-Rechtecheck |
| E215 | Haupt-App | GET | `/assets/{path:path}` | backend/app/main.py:145 / ImmutableAssetStaticFiles | STATIC (T) | frontend_dist und assets existieren; Unterpfad des Mounts, keine einzelne APIRoute | StaticFiles-Pfadschutz, keine Nutzerpolicy |
| E216 | Haupt-App | HEAD | `/assets/{path:path}` | backend/app/main.py:145 / ImmutableAssetStaticFiles | STATIC (T) | frontend_dist und assets existieren; Unterpfad des Mounts, keine einzelne APIRoute | StaticFiles-Pfadschutz, keine Nutzerpolicy |
| E217 | Haupt-App | OPTIONS | `/{beliebiger Pfad} (CORS-Preflight)` | backend/app/main.py:132 / CORSMiddleware | CORS (T) | Serverbetrieb, Origin + Access-Control-Request-Method; keine registrierte APIRoute | allow_origins=* / credentials=True; keine Nutzerpolicy |

## Bereits fehlende zukünftige APIs – nicht in den Ist-Zähler aufgenommen

Diese vorgeschlagenen Bereiche existieren noch nicht: `/api/auth` (Setup/Login/Logout/Selbstpasswort/Sitzungsstatus), `/api/users` (Anlage/Reset/Deaktivierung/Löschung innerhalb Zielkontogrenze), `/api/access` (effektive Rechte, Baum-/Vergabeinformationen, Gastverwaltung), `/api/me/preferences` (eigene geräteübergreifende Einstellungen) und minimale erlaubte UI-Konfiguration. Methoden/DTOs erst im Implementierungsentwurf festlegen. Sie werden nicht als bereits vorhandene Endpunkte verkauft.

Für die späteren Benutzer-APIs gelten: angemeldet + access.users/access.guest, Zielkonto vollständig von eigenen effektiven Rechten/Bibliothek-Aktionskombinationen gedeckt, Owner geschützt, Zukunftsumfang symbolisch prüfen. Persönliche Preferences ausschließlich eigene Identität. Setup nach atomarer Besitzereinrichtung geschlossen. Erzwungener Passwortwechsel gibt vor Abschluss keine regulären Datenrechte frei.

## Priorisierte Umsetzungslücken

1. Zentrale Autorisierung für **beide Apps** und externe Route/Asset-/Docsregistrierungen; keine pauschale Browserumgehung für `/transcoding/federation/*`, nur explizite Protokollpfade mit eigenen Checks.
2. SQL-/Aggregate-/Cachekontext je Aktion und Wiedergaberecht, einschließlich Daten in Serien-/Dateidetails, export.csv und Roh-/Historyantworten.
3. Geteiltes Library-PATCH nach Feldrechten, drei Wege der Bibliotheksanlage konsistent, Kontext für Browse/Inspect; Pfadprüfung ist keine Bibliotheksautorisierung.
4. Jobherkunft und erneute queued-Prüfung, sichtbare globale Listen und sichere Sammelaktionen; mehrbibliotheksfähige Automationläufe nicht unkontrolliert komplett anzeigen/abbrechen.
5. Medien/Varianten/Covers/Bilder: Ressourcenprüfung vor Probe/Cache/304/Range. Quellbibliotheksbezug am Variantenobjekt dauerhaft auflösen, auch bei nicht mehr vorhandener Primärdatei.
6. `app-settings` und Betriebs-/Telemetryantworten nicht als allgemeinen Frontend-Bootstrap behandeln; Secretprojektion und erforderliche zulässige UI-Konfiguration trennen.
7. Aktuelle CORS-Konfiguration vor serverseitigen Cookies ersetzen; Desktopnachweis auch für native Medien und Node-Anfragen. Keine URL-Token. Frontend-Fallback kanonisch begrenzen und unbekannte API-Pfade gesperrt halten.
8. O-01 (dauerhafte Automationsregeln unter globalen App-Einstellungen plus Transcodingrechte je Bibliothek) ist am 22.10.2026 bestätigt. O-02 (drei globale Übersichtsrechte mit Bibliothekslesefilter) ist ebenfalls bestätigt; weitere offene Punkte einzeln klären. Übrige technische Vorschläge gelten nicht als stillschweigend bestätigt.

Die 187 expliziten Methoden-/Pfade sind inventarisiert, aber **nicht** bereits abgesichert oder durch Policytests abgenommen. Dokumentation und Originalnotiz liegen ausschließlich auf dem Desktop; im Projekt wurden keine Änderungen vorgenommen.
