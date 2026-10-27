# MediaLyze – konsolidiertes Konzept für Nutzer und Zugriffe

Stand: 22.10.2026. **Planung, keine implementierte Zugriffskontrolle.**

## Verbindlichkeit und Quellen

- **B = bestätigt:** Produktregeln aus der vollständig gelesenen [Verlaufsnotiz](archive/MediaLyze-Nutzerverwaltung-temp-2026-10-19.md), mit Vorrang der später bestätigten Entscheidungen, und den im Arbeitsauftrag ergänzten Grundlagen des ursprünglichen Entwurfs.
- **T = technische Empfehlung:** vorgeschlagene Umsetzung beziehungsweise Zuordnung bestehender Funktionen. Kein neuer Produktbeschluss.
- **O = offen:** echte Produktlücke, vor verbindlicher Implementierung einzeln zu klären. Eine empfohlene Zuordnung in der Matrix ist keine Bestätigung.
- Die Verlaufsnotiz bleibt unverändert erhalten. Dieses Dokument ist ihre konsolidierte Schwesterdatei, kein Ersatz des Entscheidungsverlaufs.
- Ist-Code: lokaler `dev`, Commit `cdc4f3994cfc807a67f77fb1d265dff7badfe65d`. Bereits vorhanden: Änderung an `docs/README.md` und unversionierte Dateien unter `docs/prototyping/`; diese wurden ausschließlich gelesen. Keine Releasebewertung aus diesem Commit abgeleitet.
- Einstieg über `AGENTS.md` und `docs/README.md`, dann Code in `backend/app/api/routes.py`, `federation_routes.py`, `federation_app.py`, `main.py` und zugehörigen Services. Der Graphify-Graph dient nur der Navigation: Er enthält ältere Quellpositionen und bildet aktuelle Routen nicht vollständig ab.
- Dazu gehören [Endpunktmatrix](MediaLyze-Nutzerverwaltung-Endpunktmatrix-2026-10-22.md), [maschinenlesbare Matrix](MediaLyze-Nutzerverwaltung-Endpunktmatrix-2026-10-22.json) und [Prüfstand](MediaLyze-Nutzerverwaltung-Pruefstand-2026-10-22.json).

## 1. Konten, Besitzer und Vergabegrenzen [B]

Es gibt ausschließlich lokale Konten vom Typ Nutzer, ohne Adminrolle oder Rollengruppen. Keine Selbstregistrierung, E-Mail-Flows oder externe Anmeldung in V1. Jeder angemeldete Nutzer kann sein eigenes Passwort ändern.

Genau ein Konto trägt das geschützte Besitzermerkmal. Nur dieses Konto hat automatisch und unveränderbar alle bestehenden und künftigen Rechte. Andere Konten erhalten nur ausdrücklich vergebene aktuelle Rechte, auch wenn heute alle markiert sind. Neue Rechte bleiben dort zunächst gesperrt. Andere Nutzer können den Besitzer weder bearbeiten, deaktivieren, löschen, zurücksetzen noch einschränken. Seine eigenen Zugangsdaten kann der Besitzer ändern, soweit das betreffende Feld nicht durch Environment-Vorgaben gesperrt ist.

Rechte werden als Baum mit Sammelauswahl vergeben. Ein Bereichsknoten wählt seine aktuell vergebbaren Einzelrechte; er ist kein Abonnement auf künftig hinzukommende Rechte. Nicht vergebbare Rechte bleiben sichtbar und ausgegraut, mit Erklärung per Hover, Tastatur und Touch. Nicht zugewiesen und nicht vergebbar sind unterschiedliche Zustände.

Nutzerverwaltung und Rechtevergabe sind nur angemeldeten, entsprechend berechtigten Nutzern zugänglich, nie Gästen. Es dürfen ausschließlich eigene **effektive** Rechte und Bibliothek-Aktionskombinationen vergeben werden. Der Zukunftsumfang darf nur weitergegeben werden, wenn er selbst vorhanden ist. Konten mit auch nur einem darüber hinausgehenden Recht oder Zugriff dürfen nicht bearbeitet, deaktiviert, gelöscht oder zurückgesetzt werden. Eine bloße Anzahl oder ein vermeintlich insgesamt geringerer Umfang reicht nicht. Die Berechtigung zur jeweiligen Verwaltung ist zusätzlich erforderlich.

Vergaben bleiben unabhängig pro Konto gespeichert. Ein späterer Entzug beim ursprünglich vergebenden Konto entzieht anderen Konten nichts automatisch. Weitere Verwaltung richtet sich nach den dann aktuellen Rechten. Keine Kontenhierarchie und keine Entzugskaskade.

## 2. Erstinstallation, Upgrade und Besitzer-Environment [B]

Bei neuer wie bestehender Serverinstallation wird atomar genau ein Besitzer eingerichtet. Vorher sind ausschließlich Einrichtung und minimale Betriebsprüfung erreichbar. Ohne Environment-Vorgaben darf der erste Besucher ohne Einrichtungscode den Besitzer anlegen; nach erfolgreicher Einrichtung ist dieser Weg geschlossen. Vorhandene Mediendaten und Hintergrundarbeit bleiben erhalten. Die notwendige Besitzereinrichtung ist von einem künftig erweiterten Einrichtungsassistenten zu unterscheiden.

Nur `OWNER_USERNAME` und `OWNER_PASSWORD` konfigurieren den Besitzer. Erstmaliger Bootstrap über Environment benötigt beide Variablen. Bei bereits vorhandenem Besitzer wird jedes gesetzte Feld bei **jedem Start** abgeglichen. Gesetzte Felder sind im UI gesperrt; dort wird Entfernung aus Compose beziehungsweise Startkonfiguration plus Neustart erklärt. Nach Entfernung bleiben die letzten Werte erhalten. Eine tatsächliche Credentialänderung widerruft die Besitzersitzungen, identische Werte nicht. Ungültige oder kollidierende Werte führen zum Startfehler. Passwörter und Token erscheinen weder in Antworten noch in Logs.

Technische Empfehlung [T]: Singleton-Invariante und Setup-Abschluss transaktional in SQLite absichern, nicht nur über eine vorherige Zählabfrage. Setup-Abschluss mit konkurrierenden Requests und parallelen Starts testen. Wartung/Systemarbeit von der Sperre interaktiver APIs getrennt halten.

## 3. Bibliotheksmodell und Moduswechsel [B]

Bibliotheksbezogene Rechte sind Kombinationen aus **Bibliothek und Aktion**, nicht globale Aktionen mit einer bloßen Bibliotheksliste.

| Modus | Bedeutung |
| --- | --- |
| Per library | Eigener Aktionsbaum je Bibliothek; etwa A nur lesen, B lesen und scannen. |
| All libraries | Ein gemeinsamer Baum für einen beim Speichern festen Bestand der aktuell vorhandenen Bibliotheken. Spätere Bibliotheken kommen nicht hinzu. |
| All and future libraries | Ein gemeinsamer Baum für aktuelle und künftige Bibliotheken. |

Die Vergabegrenze gilt pro Bibliothek **und** Aktion. Ein Scanrecht auf A erlaubt keine Vergabe dieses Rechts für B. `All libraries` darf keine nicht vergebbaren Bibliotheken einschließen; der gesperrte Modus erklärt dies. Die globale Reichweite gemeinsamer Konfigurationen wird dadurch nicht pro Bibliothek vervielfacht.

Beim Wechsel von Einzelbäumen zu einem gemeinsamen Baum ist nur die **Schnittmenge** aller vom Zielmodus erfassten bestehenden Bibliotheken vorausgewählt. Eine bisher nicht freigegebene Bibliothek trägt eine leere Menge bei. Keine automatische Vereinigung. Zusätzliche Rechte und Zukunftsumfang müssen ausdrücklich gewählt werden.

Beim Rückwechsel in `Per library` werden die gemeinsamen Rechte in die Einzelbäume aller aktuell erfassten Bibliotheken kopiert. Zukunftsumfang und gegebenenfalls Anlegerecht entfallen; die Oberfläche erklärt dies vor dem Speichern. Speichern prüft immer erneut die aktuellen Vergabegrenzen.

Technische Empfehlung [T]: `All libraries` als Snapshot konkreter IDs persistieren. Bei zwischenzeitlich geänderter Bibliotheksmenge erneute Vorschau/Bestätigung statt stiller Erweiterung. Bei null bestehenden Bibliotheken keine mathematisch unbegrenzte Schnittmenge annehmen, sondern leere Vorauswahl. Zukunftsgrenzen bei Mengenvergleich symbolisch prüfen, nicht nur anhand heutiger IDs.

### Bibliotheken anlegen

Anlegen ist ausschließlich in `All and future libraries` möglich, wenn im gemeinsamen Baum alle benötigten Bibliotheks-Bearbeitungs- und Pfadrechte aktiv sind. Löschen ist keine Voraussetzung. Vorschau, Download, Export und Transcoding werden dadurch nicht zu Voraussetzungen.

Fällt die Modus- oder Rechtevoraussetzung weg, schaltet der Editor das Anlegerecht mit aus und erklärt die Folge. Die API lehnt widersprüchliche Zustände ab und prüft unmittelbar vor der Anlage erneut. Die erste Ordnerauswahl gehört zur Anlage. Für späteres Hinzufügen, Ändern und Entfernen bestehender Roots/Pfade ist das eigene Pfadrecht erforderlich. Die Servergrenze `MEDIA_ROOT` bleibt bestehen; Desktop nutzt native Auswahl mit absoluter Pfadvalidierung.

Das gilt auch für ein ausdrücklich erweitertes Gastprofil. Es gibt in V1 keine Anlage mit fester Auswahl und keine hierfür erforderliche automatische Erstellerfreigabe. Die älteren Regeln dazu sind ersetzt.

### Pfadbrowser und Sammelaktionen

Kein separates Ordner-Browsing-Recht und kein separates Recht für absolute Pfade. Browserzugriff folgt der erlaubten Anlage oder Pfadverwaltung einer bestehenden Bibliothek. Ein Hinweis erklärt, dass Ordnernamen außerhalb bereits freigegebener Bibliotheken sichtbar werden können; dadurch entsteht kein Lesezugriff auf Mediendaten.

Sammelaktionen betreffen nur Ressourcen mit der passenden Aktion im effektiven Umfang. „Alle Scans abbrechen“ lässt nicht erlaubte Jobs unverändert. Weder Anzeige noch Ergebnis dürfen verborgene Ressourcen offenlegen.

Technische Empfehlung [T]: Browse-Request mit Anlage-/Bearbeitungskontext und bei Änderung mit Bibliotheks-ID versehen. Das heutige freie `GET /api/browse?path=...` transportiert diesen Kontext noch nicht. Jeden Zielpfad weiter serverseitig kanonisieren und prüfen.

## 4. Bestätigter Rechtebaum [B]

Die folgenden Kennungen sind **technische Vorschläge [T]**, die beschriebenen Bereiche und Aktionen sind bestätigt. Kennungen sind keine heutigen Codefunktionen. Dashboard, Dateivergleich und Storage Map sind drei einzeln vergebbare globale Unterrechte. Ihre Daten werden auf die jeweils lesbaren Bibliotheken begrenzt (O-02 bestätigt).

| Bereich | Aktionen / vorgeschlagene Kennungen |
| --- | --- |
| Übersicht | `overview.dashboard` Dashboard mit technischen Statistiken/Historie; `overview.compare` Dateivergleich; `overview.storage` Storage Map. Drei einzeln vergebbare Unterrechte. |
| Bibliotheken & Dateien | `library.read` Metadaten einschließlich Rohdaten/technischer Historie; `library.preview`; `library.download`; `library.export`; `library.scan` Start und Abbruch von Scans sowie bibliotheksbezogene Verlaufsrekonstruktion zusammen; `library.create`; `library.edit`; `library.paths`; `library.delete`. |
| Transcoding | `transcode.view` Jobs ansehen; `transcode.run` Pläne erstellen/Jobs starten; `transcode.cancel_own`; `transcode.cancel_other` fremde einschließlich Systemjobs; `transcode.clean` sichtbare Historie bereinigen; `transcode.replace` Originale ersetzen. Bibliotheksgrenzen gelten zusätzlich. **Transcoding-Automation wird hier mit aufgeführt** (bestätigt am 23.10.2026); die bestehenden globalen App-Einstellungsrechte und zusätzlichen Zielbibliotheksrechte bleiben unverändert, keine eigenen Automationsrechte. |
| Einstellungen | Dauerhafte Transcoding-Automationsregeln gehören zu globalen App-Einstellungen (bestätigt am 22.10.2026); zusätzlich passende Transcodingrechte je Zielbibliothek. Je gemeinsamem Bereich ansehen und bearbeiten: `settings.quality.view/edit`, `settings.hardware.view/edit`, `settings.presets.view/edit`, `settings.app.view/edit`. Hardware-, Software- und Kombinationsprofile gehören bestätigt gemeinsam unter „Kompatibilitätsprofile ansehen/bearbeiten“; die bestehenden technischen Kennungen bleiben kompatibel. |
| Connectoren | `connector.view` Konfiguration ansehen; `connector.manage` Konfiguration und Synchronisierung verwalten; `connector.playback` Wiedergabedaten ansehen. Globale Konfigurationsrechte, Bibliotheksgrenzen für lokale Mediendaten weiterhin wirksam. Legacy-Jellyfin-Pfadzuordnungen werden auf freigegebene Wurzeln begrenzt; globale Änderungen erfordern Pfadrechte in allen betroffenen Bibliotheken. |
| Nutzer & Zugriffe | `access.users` Konten/Rechte verwalten als V1-Bündel; `access.guest` Gastprofil verwalten. Immer angemeldet, Vergabe- und Zielkontogrenzen beachten. |

Persönliche Einstellungen stehen jedem angemeldeten Nutzer unabhängig von Verwaltungsrechten zur Verfügung. Kein neues Recht für jedes Diagnosefeld, keine zusätzliche absolute-Pfad-Berechtigung.

## 5. Gemeinsame Konfigurationen und Datenantworten [B]

Qualitäts-/Hardwareprofile, Transcoding-Presets, Connector-Konfiguration und globale App-Einstellungen gelten je Bereich installationsweit. Ansichts-/Bearbeitungsrechte sind für den ganzen Bereich vergeben, nicht je Profil oder Bibliothek. Wer bearbeiten darf, kann diese gemeinsame Konfiguration auch bei eingeschränkter Bibliotheksfreigabe ändern. Der Editor erklärt die installationsweite Wirkung.

Diese Wirkung darf eine Konfigurationsberechtigung nicht stillschweigend in ein Leserecht für verborgene Mediendateien verwandeln. Datei-Rohdaten und Diagnosen eines sichtbaren Jobs gehören zum jeweiligen Datei-/Job-Ansichtsrecht; Geheimnisse bleiben geschützt. Globale Betriebsdiagnosen werden durch Datei-Leserechte nicht automatisch freigegeben.

`connector.playback` schützt persönliche Connector-Wiedergabeverläufe **und** abgeleitete Zähler, Metriken, Filter und Sortierungen auf jeder Seite. Ohne dieses Recht werden sie serverseitig ausgeschlossen. Bibliotheksgrenzen gelten zusätzlich. Angemeldete Konten erben keine Gastrechte.

Technische Empfehlungen [T]: Bearbeiten setzt Ansehen desselben Bereichs voraus. Dateiaktionen setzen `library.read` voraus; Transcoding-Aktionen zusätzlich `transcode.view`, Start zusätzlich Dateiansicht, Originalersatz zusätzlich Start. Keine Abhängigkeit eines reinen Ansichtsrechts vom Bearbeiten. Der genaue Abhängigkeitsgraph ist vor Implementierung festzuschreiben, ohne weitere sichtbare Rechte einzuführen. Datei-bezogene Profilanwendung darf eine begrenzte passende Profilprojektion verwenden; vollständige Katalogverwaltung bleibt beim Profilbereich. Diese Empfehlungen sind noch keine bestätigten Vergaberegeln.

## 6. Gastprofil [B]

Gastzugriff startet **deaktiviert**. Nach ausdrücklicher Aktivierung beginnt er mit lesenden Standardrechten, aber **ohne freigegebene Bibliotheken**. Technische Metadaten, Statistiken und technische Datei-/Bibliothekshistorie sind innerhalb ausdrücklich freigegebener Bibliotheken lesbar. Vorschau, Download, Export und Wiedergabedaten bleiben zunächst aus.

Schreibrechte können ausdrücklich vergeben werden; Nutzerverwaltung und Rechtevergabe bleiben stets ausgeschlossen. Für die Bibliotheksanlage gelten die gleichen Voraussetzungen und der Zukunftsmodus. Keine Gast-Sonderrolle mit unveränderbarer allgemeiner Schreibsperre.

Bestätigter Gaststandard: Scan-/Qualitätsjobansichten folgen dem Metadaten-Leserecht freigegebener Bibliotheken (Bestätigung „klingt gut“). Gemeinsame Qualitäts-/Hardwareprofile, Presets, Connector-Konfiguration und globale App-Einstellungen sind standardmäßig nicht freigeschaltet; Ansichtsrechte können ausdrücklich vergeben werden (anschließende Bestätigung „ja“). Transcoding-Jobs sind im Gaststandard ebenfalls ausgeblendet; „Transcoding-Jobs ansehen“ kann je Bibliothek ausdrücklich freigeschaltet werden, Start/Abbruch bleiben getrennt (weitere Bestätigung „ja“). Ein künftiger erweiterter Einrichtungsworkflow soll Gastaktivierung abfragen; dieser Workflow ist kein zusätzlicher jetziger V1-Auftrag.

Gäste speichern Darstellungsoptionen im Browser; keine kontobezogene Cloud-/Server-Synchronisation dafür vorgesehen. Bestätigt [B] am 23.10.2026: Anonyme Jobs gehören zum gemeinsamen Gastprofil. „Eigene Jobs abbrechen“ erteilt Gästen keine Abbruchberechtigung; erforderlich ist ausdrücklich „Fremde und Systemjobs abbrechen“ in der jeweiligen Bibliothek. Es wird keine persönliche anonyme Jobidentität eingeführt.

## 7. Sitzungen, Passwörter, Browser und Desktop [B]

- Argon2id für Passwörter; widerrufbare serverseitige Sessions; nur Tokenhash speichern, Cookie `HttpOnly`.
- Logout, Passwortänderung, administrativer Reset und Deaktivierung widerrufen betroffene Sitzungen. Löschung beendet ebenfalls den Zugriff und entfernt/widerruft die Sitzungen.
- Kontoanlage und administrativer Reset verwenden ein vom verwaltenden Nutzer eingegebenes vorläufiges Passwort. Vor regulärer Nutzung beim ersten/nächsten Login eigenes Passwort erzwingen. Kein automatischer Versand. Besitzer separat behandeln.
- Login rate-limitieren und generische Fehler liefern. Keine Passwörter/Token in Logs oder Antworten.
- Server prüft 24 Stunden ohne authentifizierte Anfrage sowie maximal sieben Tage ab Anmeldung. Polling zählt als Aktivität. Bewusst komfortorientiert bestätigt; keine allgemeine OWASP-Zeitlimit-Empfehlung und kein Nachweis tatsächlicher Bedienung.
- Schreibende Browseranfragen einschließlich Gastaktionen benötigen CSRF- und Originprüfung. HTTPS setzt `Secure`; dokumentierter lokaler HTTP-Betrieb bleibt möglich. Proxy-/CORS-Vertrauen ist technisch festzulegen.
- Desktop hat keinen Login, sondern lokalen Vollzugriff mit zufälligem pro Start erzeugtem Nachweis im Electron-Hauptprozess. Loopback, CORS oder ein Frontendflag allein reichen nicht. Nur eigenes Backend darf den Nachweis erhalten, auch Medienanfragen müssen ihn tragen; niemals URL-Parameter oder Weitergabe an externe Ziele.
- Interne Jobs und bestehende Maschinenprotokolle erhalten eigene Vertrauenswege. Keine Freigabe über Gastrechte.

Technische Empfehlungen [T]: same-origin als Browserstandard, explizite Origin-Allowlist für notwendige Abweichungen; vertrauenswürdige Forwarded-Header nur von konfigurierten Proxies. Das aktuelle pauschale CORS ist vor Cookie-Sessions zu ersetzen. Login-/Logout-/Setup-Zustandswechsel ebenfalls gegen Origin-/Login-CSRF absichern. Bei erzwungenem Passwortwechsel nur eng begrenzte Session für Selbständerung/Logout zulassen. Desktop-Nachweis via auf Backend-Origin und Port beschränkte Header-Injektion auch für `<video>`, Bilder und Range; Redirects dürfen ihn nicht weitertragen. Node-seitige Update-/Health-Anfragen berücksichtigen. Medien-Tokens in URLs sind keine Alternative.

## 8. Persönliche Einstellungen und Identitätswechsel [B]

Eigene Sprache, Theme und Layouts pro Nutzer, geräteübergreifend gespeichert. Neue Konten starten mit dem Standardlayout; **keine Übernahme bestehender Browserlayouts und kein Übernahmeangebot**. Bereits vorhandene persönliche Layouts werden beim Login geladen.

Identitätswechsel und Sitzungsablauf leeren Kontodaten und Caches, brechen laufende Anfragen ab oder verwerfen späte Antworten. Nach Ablauf Anmeldung anzeigen, niemals still in Gast wechseln. „Als Gast fortfahren“ nur ausdrücklich und bei aktiviertem Gastzugriff anbieten.

Rechteänderungen gelten ab der nächsten Anfrage; UI aktualisiert Rechte periodisch und leert entzogene Ansichten. Empfehlung [T]: Autorisierungsrevision und Identitätsgeneration in Query-/Cachekontext und in der Behandlung später Antworten verwenden; persönliche Browserdaten strikt nach Konto und Installation trennen, Gast separat.

## 9. Jobs und Herkunft [B]

Wartende Nutzerjobs werden unmittelbar vor Ausführung erneut geprüft. Bei Deaktivierung/Löschung wartende Jobs abbrechen und verständlichen Grund zeigen. Laufende Jobs werden bei Kontolöschung, Deaktivierung oder Rechteentzug nicht abrupt beendet; andere berechtigte Nutzer können sie abbrechen. Die Nutzerherkunft bleibt nach Kontolöschung erhalten. Kein Umbenennen in Systemarbeit.

Zeitpläne, Watchdog und Wartung bleiben unabhängig von Konten aktiv, auch nach Löschung des Kontos, das sie eingerichtet hat. Berechtigte Nutzer dürfen sie im zugehörigen Verwaltungsbereich verändern/abschalten.

Technische Empfehlungen [T]: Auslösertyp, unveränderliche Konto-ID bzw. Tombstone, verständliche Herkunft und Berechtigungssnapshot für Nachvollziehbarkeit speichern. Der Snapshot ersetzt nie die aktuelle Prüfung vor Start. Gast, Desktop, System und Federation gesondert ausweisen. System-Folgearbeit nach ausdrücklich erlaubter globaler Profiländerung kann installationsweit neu berechnen, darf aber keine fremden Dateidetails in die Antwort tragen. Manuell gestartete Nutzerarbeit nicht durch bloßes Auslagern in einen Executor privilegieren. Für gelöschte Quelldateien Bibliothekszuordnung am Job/Variantenobjekt dauerhaft bewahren.

## 10. Durchsetzung und Antwortverträge [B, technische Ausgestaltung T]

Jede Anfrage wird geprüft; unbekannte Endpunkte sind gesperrt (deny by default). Nicht erlaubte Objekt-IDs ergeben 404, fehlende Funktionsrechte 403, erforderliche Anmeldung 401. Browser-, Desktop-, Maschinen- und Systemvertrauen bleiben getrennt. Besitzervollzugriff ersetzt keine Path-Safety-/Validierungsprüfung.

SQL, Aggregate, Exporte, Historie, Suche und Caches müssen dieselben erlaubten Bibliothek-Aktionskombinationen berücksichtigen. IDs aus Query/Body/verschachtelten Objekten sind genauso zu prüfen wie Pfadparameter. Filterung erfolgt vor Zählung, Pagination, Gruppierung und Aggregation. Verborgene Daten dürfen nicht über Summen, Zeitachsenbounds, Fehlermeldungen, Statusbanner oder Trefferzahlen zurückkehren.

Technische Empfehlungen [T]: Ein Policy-Registry-Eintrag je Methode/Pfad und explizite Behandlung automatischer Frameworkrouten, statischer Dateien und aller Listener. Bei Objektendpunkten unbekannte und fremde IDs gleich behandeln. Ein globales Feature-Gate vor/nach Objektauflösung darf den 404-Vertrag nicht durch unterschiedliche Fehler verraten. Methodenwechsel, Aliase, 304/Range/416 und Redirects erhalten denselben Zugriffskontext. Für nicht erlaubte Wiedergabefilter/-sortierungen klare Ablehnung ohne Datenauswertung; technische Standardansichten weiterhin anbieten.

Bestehende vollständige App-Einstellungen nicht als allgemeinen UI-Bootstrap verwenden. Vorgeschlagen, noch nicht vorhanden: `/api/auth`, `/api/users`, `/api/access`, `/api/me/preferences` sowie ein erlaubter, minimaler UI-Konfigurationsendpunkt. Vor Owner-Einrichtung nur minimaler Setup-/Health-Vertrag und notwendige UI-Ressourcen. Öffentliche Login-/Setup-Shell ist keine öffentliche Daten-API.

## 11. Konkrete Lücken aus dem Ist-Code

Die Matrix ordnet **jede gefundene HTTP-Methode/Pfad-Kombination** einer vorgeschlagenen Policy und einem Ressourcen-/Vertrauenskontext zu. „T“ bedeutet keine bereits vorhandene Zugriffskontrolle.

1. Keine interne Nutzerauthentifizierung/Autorisierung: `api/deps.py` liefert DB, Settings und Runtime; die Routen haben keine effektive Nutzer-/Bibliothekspolicy. Das geplante Konten-/Session-/Rechteschema und der Desktopnachweis fehlen.
2. Neben dem Hauptrouter existieren bedingtes `/api/performance`, Frontend-Fallback/Assets, FastAPI-Dokumentationsrouten sowie ein separater Federation-Protokoll-Listener. Ein Schutz nur in `routes.py` wäre unvollständig. `include_in_schema=False` und versteckte Frontendtabs sind keine Sperren.
3. `PATCH /api/libraries/{id}` mischt Metadaten, Roots/Pfade, Qualitätszuordnung, Dashboardflag und Connectorpräferenz. Prüfung nach tatsächlich gelieferten Feldern erforderlich. Root-Aliasänderungen gehören zum Root/Pfad-Vertrag; Anlegen über Connector- und Legacy-Routen darf Voraussetzungen nicht umgehen.
4. Datei-/Serien-/Bibliotheksantworten und CSVs können Wiedergabefelder enthalten. Auch historische Snapshots, Roh-Providerpayloads, Sortierungen und aggregierte Tabellen prüfen, nicht nur den expliziten Playback-Endpunkt.
5. Statistik-Caches sind bislang nach DB/Parametern/Bibliothek strukturiert, nicht nach effektiven Rechten. Kontext um kanonischen Umfang je Aktion, Playbackfreigabe und Autorisierungsrevision erweitern oder nur intern sichere, anschließend korrekt projizierte Bausteine teilen. Globale historische Snapshots lassen sich nicht zuverlässig erst nach fertiger Aggregation auf beliebige Nutzermengen reduzieren; aus bibliotheksbezogenen Daten aggregieren.
6. `files/{id}/media` unterscheidet inline/Download über Query. Varianten haben eigene IDs und teilweise separate Ausgabeordner. Beide brauchen Zugriff über die ursprüngliche Bibliothek; fehlende Primärdatei ist kein Freibrief. Preview liefert heute Originalbytes: Ein Previewrecht kann technisches Speichern dieser Bytes nicht verhindern. Ein Downloadrecht steuert den expliziten Downloadweg, keinen Kopierschutz.
7. Eingebettete Cover einschließlich `download=true` gehören bestätigt vollständig zu Metadaten: Anzeigen und Herunterladen benötigen ausschließlich `library.read` der betroffenen Bibliothek, weder Vorschau-/Downloadrecht noch ein eigenes Coverrecht. Nutzerentscheidung: „Cover anzeigen/downloaden etc. nicht mit extra Rechten schützen. Soll einfach mit den Metadaten mit behandelt werden“. Jellyfin-Bilder folgen dem zugänglichen Metadaten-/externen Katalogkontext. Der geprüfte Ressourcenbezug bleibt vor jeder Auslieferung erforderlich, einschließlich 304 und Download-/Range-Varianten.
8. Connector-Konfiguration ist global bestätigt; heutige Katalog-/Mappingantworten können dennoch lokale IDs, Pfade, Statistik und Wiedergabe verborgener Bibliotheken enthalten. Globale externe Konfigurationssicht von lokalen Medienprojektionen trennen; ungematchte externe Items nicht willkürlich einer freigegebenen Bibliothek zuordnen. Die vollständige externe Katalogsicht unter Connectoransicht ist inzwischen in O-04 bestätigt; lokale Medien- und Wiedergabegrenzen gelten weiterhin.
9. Jobmodelle haben Auslöserfelder, aber keine durchgängige lokale Kontoherrkunft für eigene/fremde Jobs. Connectorjobs sind installationsweit; Automationläufe können mehrere Bibliotheken bündeln. Ressourcenzuordnung und sichere Teilansichten/Teilergebnisse ergänzen, ohne verborgene IDs und Zähler. Eine globale Cancel-Funktion darf nicht einfach unverändert weitergereicht werden.
10. Versteckte Automation verwaltet persistente Regeln und scaninduzierte Jobs. Die Verwaltung dauerhafter Regeln ist inzwischen bestätigt den globalen App-Einstellungen ansehen/bearbeiten zugeordnet (O-01 erledigt). Die passenden Transcodingrechte je betroffener Bibliothek gelten zusätzlich; Transcoding-Start allein erlaubt keine dauerhafte Regelverwaltung.
11. Federation-Verwaltung enthält Pairingcode und Membersteuerung, getrennt vom bereits kryptografisch geprüften Maschinenprotokoll. Die künftige Bedienberechtigung gehört zum Transcoding-Bereich; ihre Einzelrechte werden erst vor der offiziellen Einführung festgelegt (O-05 zurückgestellt). Pairingcode nicht pauschal in einer gewöhnlichen Leseantwort belassen. `hello` ist heute ein nicht mit Memberschlüssel authentifizierter Protokolldeskriptor, `pair` verwendet den Pairingnachweis. Maschinenkontext darf keine interaktiven Browserrechte übernehmen.
12. Heutige `AppSettingsRead/Update.ui_preferences` sind noch global. Sprache/Theme und persönliche Layouts künftig über eigene Preferences abwickeln; nicht bloß den globalen Settings-Endpunkt für alle Nutzer freischalten. Telemetrie-Vorschau enthält installationsweite Aggregate und ggf. vollständige Installations-ID, Senden wirkt installationsweit. Bestätigt [B] am 23.10.2026 durch Nutzerantwort „Ja“: Performance, Historien-Speicherverbrauch sowie Telemetrie-Vorschau und gespeicherte Payloads/Installations-ID gehören zu „Globale App-Einstellungen ansehen“. Die Sicht ist installationsweit und enthält auch Aggregate aus einzeln nicht freigegebenen Bibliotheken. Manuelles Telemetrie-Senden benötigt zusätzlich „Globale App-Einstellungen bearbeiten“. Nicht über Dashboard/Dateirechte veröffentlichen. Keine neuen sichtbaren Spezialrechte nötig.
13. Der Frontend-Fallback versucht existierende Dateien unter `frontend_dist / path` zu liefern und fällt sonst auf index.html zurück. Explizite kanonische Pfadgrenze und Trennung unbekannter API-Pfade empfehlen. Keine privaten Daten/DB/Exports in statischen Frontendpfaden. Öffentliche Assets nur als geprüfte Distribution-Assets, keine allgemeine Dateifreigabe.
14. Mehrere GETs initialisieren Konfiguration/Profile oder cachen Ergebnisse. Technisch interne Initialisierung von fachlichen Schreibaktionen unterscheiden; keine pauschale Annahme „GET hat keinerlei Wirkung“. Keine Ausführung der App oder Tests gegen reale Konfiguration für dieses Audit.

## 12. Echte offene Produktpunkte – einzeln besprechen

Diese Liste ist ein Arbeitsvorrat, keine gebündelte Rückfrage. Bereits bestätigte Regeln werden nicht erneut geöffnet.

- **O-01 erledigt – bestätigt am 22.10.2026:** Dauerhafte Transcoding-Automationsregeln fallen unter „Globale App-Einstellungen → ansehen/bearbeiten“, zusätzlich mit den passenden Transcodingrechten je betroffener Bibliothek; bei Originalersatz zusätzlich Originalersatzrecht. Bestätigung des Nutzers: „ja sollte es“. **Darstellung ergänzt am 23.10.2026:** Nutzerwunsch „Transcoding-Automation im Bereich für Transoding mit auflisten“, konkretisiert mit „Nur dort aufführen; bisherige Rechte behalten“. Automation erscheint im Transcoding-Bereich des Rechtebaums als Hinweis auf die bestehenden globalen App-Einstellungsrechte und zusätzlichen Bibliotheksrechte. Keine neuen Automationsrechte und keine Zugriffserweiterung. Technische Ausgestaltung von Vorschau, Inventarläufen, Systemherkunft und Teilansichten bleibt als Empfehlung gekennzeichnet; diese Bestätigung macht nicht sämtliche technischen Details zu Produktbeschlüssen.
- **O-02 erledigt – bestätigt am 22.10.2026:** Dashboard, Dateivergleich und Storage Map bleiben drei einzeln vergebbare globale Rechte; sämtliche Daten sind jeweils auf lesbare Bibliotheken begrenzt. Bestätigung: „ja das passt so.“ Kein zusätzlicher Übersichtsbaum je Bibliothek. Die technischen API-Projektionen bleiben Empfehlungen; die Vergleichsseite eröffnet keinen zusätzlichen Rohdatenzugang.
- **O-03 erledigt – Scanansicht und Gaststandards bestätigt:** Nutzerbestätigung „klingt gut“ zur Zuordnung von Scan-/Qualitätsjobansichten zum Metadaten-Leserecht je Bibliothek. Aktive Jobs, Verlauf und Details einschließlich technischer Diagnosen folgen `library.read`; Bibliotheksgrenzen gelten vor Pagination und Aggregation. Das gilt auch für ausdrücklich freigegebene Gastbibliotheken. Start/Abbruch bleiben unter `library.scan`. Technische Rohdaten gehören gemäß Abschnitt 5 zum Ansichtsrecht; es entsteht kein neues Diagnose- oder absolutes-Pfad-Recht, Geheimnisse bleiben geschützt. **Gaststandard für gemeinsame Konfigurationen bestätigt:** Nutzerantwort „ja“ zur Empfehlung, Qualitäts-/Hardwareprofile, Presets, Connector-Konfiguration und globale App-Einstellungen standardmäßig auszublenden und nur ausdrücklich freizuschalten. **Gaststandard für Transcoding-Jobs bestätigt:** Weitere Nutzerantwort „ja“: standardmäßig keine Jobansicht; ausdrücklich vergebbares Ansichtsrecht je Bibliothek, Start und Abbruch weiterhin separate Rechte.
- **O-04 erledigt – bestätigt:** Nutzerantwort „ja“ zur vollständigen externen Katalogsicht unter „Connector-Konfiguration ansehen“, einschließlich nicht zugeordneter Einträge sowie externer Titel und Pfade. Lokale MediaLyze-Dateidaten und Zuordnungen bleiben auf lesbare Bibliotheken beschränkt. Wiedergabedaten benötigen weiterhin das eigene Recht und passende lokale Medienfreigaben. Keine automatische Freigabe von Mutationen oder vertraulichen Betriebsdiagnosen.
- **O-05 für den aktuellen Umfang zurückgestellt – Bereich bestätigt:** Nutzerentscheidung: Federation gehört künftig unter die Transcoding-Rechte und wird erst zur offiziellen Einführung ergänzt; aktuell ist die Funktion verborgen. Die frühere Empfehlung einer Zuordnung zu globalen App-Einstellungen ist verworfen. Jetzt keine neuen sichtbaren Federationrechte und keine Freigabe durch bestehende Transcoding-/App-Einstellungsrechte. Die bisherige Owner-/Maschinen-Abgrenzung bleibt erhalten. Einzelrechte für Ansicht, Verwaltung/Pairing und entfernte Starts sowie die Sicherheitsabnahme werden vor der offiziellen Einführung festgelegt; diese Details sind noch nicht bestätigt.
- **O-06 erledigt – Einzelzuordnungen bestätigt:** Nutzerantwort „ja klingt gut“: Hardware-, Software- und Kombinationsprofile teilen den Rechtebereich „Kompatibilitätsprofile ansehen/bearbeiten“. Die technische Kennung `settings.hardware.view/edit` bleibt für bestehende Richtlinien erhalten. Datei-Bewertungen benötigen zusätzlich Metadaten-Leserecht für die betroffene Bibliothek. **Duplikatunterdrückung bestätigt:** Nutzerantwort „finde ich gut.“: dauerhaftes Ausblenden und erneutes Einblenden von Duplikatgruppen fällt unter „Bibliothek bearbeiten“ innerhalb der freigegebenen Bibliothek. Metadaten-Leserecht erlaubt weiterhin die Ansicht einschließlich bereits ausgeblendeter Gruppen. **Cover vollständig unter Metadaten bestätigt:** Anzeigen und Herunterladen benötigen nur das Metadaten-Leserecht der jeweiligen Bibliothek; keine zusätzliche Vorschau-/Download- oder Coverberechtigung. Die frühere Empfehlung, den Coverdownload gesondert zu schützen, ist verworfen. **Verlaufsrekonstruktion unter Scanrecht bestätigt (23.10.2026):** Nach Korrektur der vorgeschlagenen globalen Zuordnung und Nutzerbestätigung „Ja“ erlaubt das vorhandene Scanrecht die Rekonstruktion der jeweiligen Bibliothek. Einzelaktionen beziehen sich auf diese Bibliothek; Sammelaktionen berücksichtigen ausschließlich scanberechtigte Bibliotheken. Die Auswahl wird beim Einreihen festgehalten, vor Ausführung erneut geprüft und später nicht durch neue Rechte/Bibliotheken erweitert. Die frühere Zuordnung zu globalen App-Einstellungen ist verworfen. Status und Ergebnisse dürfen keine verborgenen Bibliotheksnamen, IDs, Zähler oder Dateidaten offenlegen. Damit sind die hier genannten O-06-Zuordnungen entschieden; **Globale Betriebsdiagnosen bestätigt (23.10.2026):** Nutzerantwort „Ja“: Performance, Historien-Speicherverbrauch und Telemetrie-Vorschau einschließlich gespeicherter Payloads/Installations-ID fallen unter „Globale App-Einstellungen ansehen“, unabhängig von Bibliotheksfreigaben installationsweit. Manuelles Telemetrie-Senden erfordert zusätzlich „Globale App-Einstellungen bearbeiten“. Kein weiteres Spezialrecht. Diese Bestätigung erweitert keine lokalen Datei-, Job- oder Connector-Diagnoseansichten.
- **O-07 erledigt – bestätigt am 23.10.2026:** Nutzerantwort „Ja“: Alle Gastjobs gehören zum gemeinsamen Gastprofil. „Eigene Jobs abbrechen“ reicht für Gäste nicht aus; sie benötigen ausdrücklich „Fremde und Systemjobs abbrechen“ in der betroffenen lesbaren Bibliothek, zusätzlich zur Jobansicht. Auch verschiedene Gast-Sessions erhalten keine persönliche Eigenberechtigung. Keine neue anonyme Accountverwaltung.

## 13. Technischer Umsetzungsweg [T]

1. Matrix und offene Zuordnungen festschreiben, Permission-Registry/Abhängigkeiten versionieren, deny-by-default je Listener/Route definieren.
2. Additive Persistenzmigration für Konten/Besitzerinvariante, Rechte plus Aktionsreichweiten, Sessions, Gastprofil, persönliche Preferences und Jobauslöser. Bestandsbibliotheken und Jobs erhalten, vorhandene automatische Arbeit korrekt als Systemherkunft klassifizieren, manuelle Altjobs nicht erfundenen Nutzerkonten zuordnen.
3. Atomaren Bootstrap und Environment-Abgleich, Sessions/Loginlimit/CSRF/Origin sowie den eigenen Desktopvertrauensweg bauen.
4. Backend vollständig absichern: Objektresolver, SQL-/Aggregatkontexte, Histogramme/Historie, Streaming/Range/Exporte, Cachekontexte, Jobs, Connectoren/Legacy und Maschinenlistener. Erst danach Frontend-Freischaltung.
5. Login/Passwortwechsel, Nutzer-/Gastverwaltung, Rechtebaum und geräteübergreifende Preferences, Identitätswechsel/Leerung. Bestehende kompakte UI-Patterns verwenden; alle Sprachen, mobile/Tastatur/Light-Dark und `/ui-elements` berücksichtigen.
6. Produktdokumentation und Migrationshinweise, spätere Implementierungsänderungen mit Changelog. In diesem Auftrag ausdrücklich **kein** Projekt-Changelog und keine Projektänderung.

### Spätere Abnahme

- Upgrade, Setup-Races, genau ein Besitzer, beide Bootstrapvariablen, Einzelabgleich bestehender Felder, identische/geänderte Werte, Kollisionen und unveränderbarer Besitzerschutz.
- Gesamte Bibliothek-Aktionsgrenze über Suche/Details/Serien/Histories, Summen/Pagination, CSV/Rohdaten, Connectoren/Playback, Bilder/304, Preview/Download/Range/416, Varianten ohne Primärdatei, globale Sammelaktionen.
- Alle Gastzustände einschließlich deaktiviert/aktiv ohne Bibliotheken, explizit erweiterte Schreibrechte, keine Kontoverwaltung, kein stiller Gastwechsel.
- Sessionwiderruf/24h/7 Tage/Polling, Loginlimit, CSRF/Origin auch bei Gast und Login, Proxy- und CORS-Vertrauen; keine Secrets in Logs/Antworten/URLs.
- Wartende/laufende/abgebrochene Jobs, gelöschte Konten, eigene/fremde/System/Gast-/Desktopherkunft, Zeitpläne bleiben erhalten; keine Executor-Eskalation.
- Konto-/Gastwechsel mit gecachten Medien, verspäteten Antworten und parallelen Requests; Rechteentzug ab nächster Anfrage, keine Wiederverwendung fremder Aggregate.
- Desktopnachweis nur eigenes Backend, alle Medienanfragen und Node-Anfragen, keine Weitergabe an Redirect-/Fremdziele; Maschinenprotokolle ohne Browser-/Gast-Bypass.
- Automatisierter Policy-Abdeckungstest über **tatsächlich registrierte** Routen aller Appvarianten, Methoden/Aliase/Frameworkrouten und bedingte Registrierung. Test als Umsetzungsauftrag, heute nicht implementiert.

## 14. Umsetzungsreife

**Der Kern des Produktmodells ist konsistent und weitgehend entschieden. Für eine vollständige sichere Implementierung ist das Konzept noch nicht freigabefertig.** Die vorhandene Endpunktmatrix schafft eine konkrete Arbeitsgrundlage; offene Punkte sind sichtbar statt stillschweigend als Produktbeschlüsse umgesetzt. O-01 und O-02 sind bestätigt und eingearbeitet. Die übrigen Zuordnungen werden einzeln und nur soweit wirklich nötig bestätigt. Aktuell wünscht der Nutzer zusätzlich Vorschläge zur Übersichtlichkeit des Rechteeditors.

Die Bestandsaufnahme ist ein statischer Quellcodeabgleich, keine laufende Penetrationsprüfung oder bestandene Policy-Testsuite. Es wurde keine App gestartet, keine produktive DB geöffnet und kein Schutz als bereits vorhanden behauptet.

Abschlussprüfung: 187 explizite Methodendekoratoren unabhängig erneut abgeglichen; 217 Matrixzeilen ohne doppelte Listener-/Methode-/Pfad-Kombination, alle Policyfelder und Dokumentlinks vorhanden. Originalnotiz per SHA-256 unverändert, HEAD unverändert. Im Git-Status erschien während der Arbeit zusätzlich `docs/prototyping/nutzerverwaltung/Desktop-Prototypen-Übersicht.md`; diese Datei stammt nicht aus eigenen Schreibaufrufen. Der Prüfstand behauptet deshalb keinen insgesamt unveränderten fremden Workspacezustand.

## 15. Übersichtlichkeit des Rechteeditors – Vorschläge vom 22.10.2026 [T]

Die Suche ist in A3.4 als klickbare Prototypinteraktion umgesetzt. Sie filtert Rechtenamen und übergeordnete Gruppenbezeichnungen, zeigt bei Treffern die zugehörigen Bibliotheken als übergeordnete Zeilen im Baum, öffnet passende Baumzweige vorübergehend und stellt beim Leeren den vorherigen Aufklappzustand wieder her. Während der Suche ist die Gruppensammelauswahl deaktiviert; einzelne Rechte bleiben bearbeitbar. Der Geltungsbereich nutzt das MediaLyze-Auswahlfeld im Header der Rechte-Gruppe, direkt links neben der Gruppensammelauswahl; die Höhe des zugeklappten Headers bleibt dabei unverändert. „Bibliotheksverwaltung“ ist als Unterüberschrift im Stil von „Bibliothekszugriff“ gesetzt; die Bibliotheken bleiben einzeln aufklappbar und erhalten eine leichte Einrahmung. Rechtebereiche und aufklappbare Bibliotheken verwenden dieselben 26-Pixel-MediaLyze-Chevrons; der Abstand zwischen Chevron und Überschrift ist auf beiden Ebenen reduziert. Die Aktionen zum Hinzufügen und Schließen nutzen die randlose 32-Pixel-MediaLyze-Icon-Button-Variante. Die Erklärung zum Bibliothekszugriff ist als fokussierbarer Tooltip an der Überschrift verfügbar. Nicht vergebbare Rechte zeigen ihre Erklärung beim Hover oder Tastaturfokus auf der ausgegrauten Zeile. Der Kontoschalter ersetzt das Aktiv-Badge und steht direkt neben dem Namen. Diese Umsetzung ist kein abschließend bestätigter Produkt- oder Suchvertrag.

- Der Prototyp zeigt „Rechte durchsuchen“ oberhalb des Baums und durchsucht aktuell Rechtebezeichnungen sowie Gruppennamen. Bei einem Treffer wie „Download“ bleiben die Namen der zugehörigen Bibliotheken als übergeordnete Zeilen sichtbar. Eine Suche nach Beschreibungen oder Bibliotheksnamen selbst ist noch offen.
- Treffer im bestehenden Baum mit ihren übergeordneten Bereichen zeigen; passende Zweige vorübergehend öffnen und Treffer hervorheben. Beim Leeren den vorherigen Aufklappzustand wiederherstellen. Suchstatus und Rechtezustand bleiben unabhängig.
- Die Prototyp-Sammelauswahl ist während einer aktiven Suche deaktiviert und erklärt, dass die Suche zum Ändern des ganzen Bereichs geleert werden muss. Ob die finale Bedienregel genauso bleibt, ist noch nicht beschlossen.
- Optionaler kompakter Filter „Alle / Nur vergebene“, unabhängig von der Suche. Nicht vergebbare Rechte bleiben in der normalen Ansicht entsprechend dem bestätigten Muster sichtbar und erklärt. Nach Änderungen dürfen bearbeitete Zeilen nicht unvermittelt verschwinden.
- Teilweise ausgewählte Bereiche über den üblichen gemischten Checkboxzustand erkennbar machen. Ein knapper Hinweis auf unterschiedliche Rechte je Bibliothek kann Unterschiede erklären; keine zweite parallele Verwaltungsebene einführen.
- „Alle aufklappen / zuklappen“ als kleine Baumwerkzeuge; bei Bibliotheksnamenssuche gegebenenfalls alle Rechte dieser Bibliothek anzeigen, bei zusätzlichem Rechtebegriff weiter eingrenzen.
- Bereits beschlossene Auswirkungen vor Speichern kompakt zusammenfassen: entfernte Rechte, entfallende Zukunftsfreigabe/Anlegerechte und installationsweite Wirkungen. Keine weitere obligatorische Dialogstufe allein für kosmetische Änderungen.

Prioritätsempfehlung: Suchvertrag und Teil-Auswahlzustand anhand der A3.4-Prototypinteraktion weiter prüfen; danach bei Bedarf Filter „Nur vergebene“. Eine Umsetzung in der MediaLyze-Anwendung ist damit nicht beauftragt.
