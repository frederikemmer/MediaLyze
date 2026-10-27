# Notifications: Einbindung für das nächste Release

Stand: 25. Oktober 2026. Arbeitsplan im bestehenden Root-Checkout auf `dev`.

## Auftrag und Status

Der Nutzer möchte das Grundsystem gemeinsam bis zur vollständigen Einbindung für das nächste Release weiterführen. Die vorhandenen lokalen Änderungen bleiben erhalten; kein Reset, Stash, Cleanup, Commit oder Push. Die bisherige Vorgabe gegen Tests und Verifikation gilt weiter, bis der Nutzer diese ausdrücklich beauftragt.

Das Grundsystem und der aktuelle Integrationsblock sind implementiert, aber noch nicht laufzeitverifiziert. Dieser Plan ist keine Release-Freigabe. Die direkten Aktionen der Connector-Karte sowie einmalige Abschlussmeldungen für explizit gestartete Scans, Transcodes, akzeptierte Connector-/Jellyfin-Synchronisierungen und Verlaufsrekonstruktionen sind angeschlossen. Im History-Retention-Panel kommen Speichervalidierungsfehler, Rekonstruktions-Startfehler und Job-Endzustände als Notifications; Live-Fortschritt bleibt inline. Weitere Produktaktionen werden Bereich für Bereich abgestimmt und integriert.

## Vorgehen

1. Gemeinsame Ereignisregeln festlegen: direkte Aktionsrückmeldung, spätere Jobergebnisse, Empfängerkreis und Wiederholungsschutz.
2. Persönliche Einstellungen und Rechte für normale Konten, Gast und Desktop klären. Angemeldete Konten und Guest bearbeiten Notifications unabhängig von globalen App-Settings-Rechten; Konten speichern serverseitig, Guest browserlokal.
3. Bestätigte Regeln Bereich für Bereich umsetzen. Pro Aktion werden Auslöser, Status, fachlicher Schlüssel, sicherer Text, konkretes Ziel und verbleibende kontextbezogene Rückmeldung festgehalten.
4. Bestätigtes Scroll-/Stapelverhalten, Fehlerdarstellung und Verhalten bei Navigation, Dialogen, Rechtewechsel, Wiederverbindung und mehreren Tabs abschließen.
5. Nach ausdrücklicher Beauftragung die Prüfungen ausführen, Befunde beheben und Release-Dokumentation abschließen.

Nur ausdrücklich bestätigte Produktentscheidungen gelten als beschlossen. Technische Empfehlungen bleiben als solche erkennbar. Pro Gesprächsschritt wird eine zusammenhängende Frage gestellt.

## Erste Quelltext-Inventur

Diese Liste benennt Integrationsbereiche, keine bereits beschlossenen Notification-Ereignisse und keine abschließend vollständige Aktionserfassung.

- **Connectoren:** Verbindungstest, Speichern, Aktivierung, Synchronisierung, Verknüpfungen/Bindings und Zugangsdaten-Dialoge. Quelle: `frontend/src/components/ConnectorSettingsPanel.tsx`. Der Verbindungstest verwendet aktuell lokale Erfolgs-/Fehlermeldungen. Diagnose und Geheimnisse dürfen nicht ungeprüft global erscheinen.
- **Bibliotheken und Scans:** Anlegen, Umbenennen, Pfade/Root-Aliasse, Einstellungen, Löschen, Scanannahme, Abbruch und spätere Ergebnisse. Quellen: `LibrariesPage.tsx`, `LibraryDetailPage.tsx`, `lib/scan-jobs.tsx`. Das Verschwinden aus der Liste aktiver Jobs beweist keinen erfolgreichen Abschluss.
- **Transkodierung:** Auftragserstellung aus Dateiansichten, Annahme, Abbruch, Wiederholung, Aufräumen und spätere Ergebnisse. Quellen: `FileDetailPage.tsx`, `TranscodingPage.tsx` und zugehörige Komponenten. Ziel muss den konkreten Job auffindbar machen; die bisherige Vorschau hat nur ein simuliertes Jobbeispiel.
- **Einstellungen und Profile:** App-Einstellungen, Qualität, Auflösungen, Hardware-/Software-/Kombinationsprofile und Presets. Quellen unter anderem `LibrariesPage.tsx`, `CompatibilityProfilesPanel.tsx`, `NotificationSettingsPanel.tsx`. Häufige automatische Einzeländerungen benötigen eine zurückhaltende Ereignisregel.
- **Konten und Zugriffe:** Konto-/Rechteänderungen, Aktivierung und Passwortaktionen. Quelle: `AccountsPanel.tsx`. Keine Passwörter, Tokens oder vertraulichen Diagnosen in Meldungstexten; Identitätswechsel benötigen eine gesonderte Behandlung.
- **Wartung und weitere Aktionen:** Verlaufsrekonstruktion, Telemetrieaktionen, Exporte/Kopieren und weitere Dateiansichtsaktionen gesondert sichten. Erfolg nur für den tatsächlich bestätigten Schritt melden; ein gestarteter Download ist kein bestätigter erfolgreicher Dateitransfer.

Ladezustände, dauerhafte Erklärungen, Formularvalidierung, Fortschrittsanzeigen und bestehende Update-/Releaseinformationen werden nicht allein aufgrund ihrer Notice-/Alert-Klasse in Toasts umgewandelt. Die konkrete Abgrenzung wird bei der Einbindung festgehalten.

## Entscheidungsprotokoll

### D1 — Welche Ereignisse gehören in Notifications? Bestätigt am 24. Oktober 2026

Der Nutzer bestätigte die vorgeschlagene gemeinsame Ereignisregel mit „klingt gut“:

- Bestätigte relevante Nutzeraktionen erhalten kurze Rückmeldungen.
- Zusätzlich erscheinen einmalige Ergebnisse von Jobs, die der Nutzer in der laufenden Oberfläche selbst gestartet hat, auch nach einem Routenwechsel.
- Automatisch gestartete Jobs und Aktionen anderer Nutzer erzeugen zunächst keine globalen Toasts.
- Wiederholte Statusabfragen sind keine neuen Ereignisse. Ein Abschluss benötigt einen bestätigten Endzustand.

Dies erweitert das frühere reine Aktionskonzept um gezielt verfolgte Jobergebnisse. Technische Umsetzungsvorgabe: Herkunft und Zuordnung müssen zuverlässig sein; gemeinsam verwendete Gastidentitäten reichen nicht als Nachweis eines persönlich gestarteten Jobs. Inzwischen umgesetzt: ein über Routenwechsel bestehender Watcher verfolgt Scan-, Transcoding-, Connector-/Jellyfin-Sync- und History-Reconstruction-Abschlüsse einmalig. Automatische Scan-/Watch-Aufträge sowie Sync-Nebenwirkungen werden nicht registriert. Guest-Scans und globale History-Reconstruction werden wegen der geteilten Guest-Jobherkunft nicht verfolgt.

### D4 — Flüchtige Inline-Rückmeldungen ersetzen: Bestätigt am 24. Oktober 2026

Der Nutzer möchte auftauchende Fehler- und Bestätigungsfelder/-panels in einzelnen Menüs und Einstellungsbereichen durch die automatisch verschwindenden Notifications unten rechts ersetzen. Diese flüchtigen Aktionsrückmeldungen sollen keinen Inhalt mehr zwischen andere Bedienelemente schieben und nicht zusätzlich doppelt inline angezeigt werden.

Abgrenzung bei der Umsetzung: Feldvalidierung, Lade-/Leerzustände, laufender Fortschritt und dauerhaft benötigte technische Informationen sind nicht automatisch flüchtige Aktionsrückmeldungen. Ihre konkrete Behandlung wird pro Bereich erfasst. Die Migration erfolgt schrittweise; nicht jeder existierende Alert ist bereits umgestellt.

### D4a — Technische Connector-Testdiagnose erhalten: Bestätigt am 25. Oktober 2026

Auf die Frage, ob die technische Diagnose bei fehlgeschlagenen Connector-Verbindungstests weiterhin in der Verbindungskarte erreichbar sein oder vollständig durch die Kurzmeldung ersetzt werden soll, bestätigte der Nutzer: „die technische Diagnose ist schon sinnvoll“.

Umgesetzt: Der Toast zeigt nur die sichere lokalisierte Kurzmeldung. Eine vom Test-Endpunkt gelieferte, serverseitig bereinigte Diagnose bleibt in der betreffenden Verbindungskarte in einem aufklappbaren Detailbereich zugänglich, auch nachdem der Toast abgelaufen ist. Sie wird weder in den Toast noch in den Notification-Verlauf übernommen. Die aktuelle Diagnose wird identitätsbezogen browserlokal gespeichert und bleibt bis zu einem neuen Test oder einer Änderung der gespeicherten Verbindungskonfiguration erhalten.

### D4b — Diagnose nach Navigation und Neuladen behalten: Bestätigt am 25. Oktober 2026

Der Nutzer bestätigte: „Auch nach Navigation und Neuladen behalten“.

Zur Erfüllung dieser Entscheidung wurde zunächst `sessionStorage` verwendet, getrennt nach Identität und Connector-ID. Gespeichert wurden nur serverseitig bereinigte Diagnosen; sie gingen weder an den Server noch in den Notification-Verlauf. D4c hat diese zunächst tabgebundene Speicherdauer anschließend auf Browser-Neustarts erweitert.

### D4c — Diagnose über Tab- und Browser-Neustart behalten: Bestätigt am 25. Oktober 2026

Der Nutzer bestätigte: „Auch nach Tab-/Browser-Neustart behalten“.

Umgesetzt mit `localStorage`, getrennt nach Identität und Connector-ID. Gespeichert wird höchstens die vom Backend bereinigte Diagnose mit 2048 Zeichen. Ein neuer Test, eine Änderung der gespeicherten Verbindungskonfiguration oder das Entfernen der Verbindung löscht den Eintrag. Die Diagnose wird nicht an den Server oder Notification-Verlauf gesendet.

### D4d — Diagnose des letzten Tests mit ungespeicherter Adresse behalten: Bestätigt am 25. Oktober 2026

Der Nutzer bestätigte, dass auch eine Diagnose aus einem Test mit einer noch nicht gespeicherten Serveradresse über Tab- und Browser-Neustarts erhalten bleiben soll: „Ja, als Diagnose des letzten Tests“.

Umgesetzt: Die browserlokale Diagnose speichert, ob der letzte Test die aktuell gespeicherte URL oder eine Entwurfs-URL verwendete. Bei einer Entwurfs-URL zeigt die Verbindungskarte einen entsprechenden Hinweis. Die URL selbst wird nicht mitgespeichert.

### D9 — Toasts bleiben im auslösenden Tab: Bestätigt am 25. Oktober 2026

Der Nutzer bestätigte, dass ein Toast nur in dem Tab erscheint, in dem die Aktion ausgelöst wurde. Es gibt keine tabübergreifende Toast-Synchronisierung. Der persönliche serverseitige Verlauf bleibt weiterhin identitätsgebunden und kann aus jedem Tab abgerufen werden.

### Erster umgesetzter Integrationsblock: Connector-Verbindungskarte

- Speichern, Verbindungstest, Aktivierung/Deaktivierung, Synchronisierung anfordern, Abbruch anfordern und Löschen melden ihre direkten Ergebnisse als Notifications.
- Die bisherigen flüchtigen Erfolgs-/Fehlerfelder unter den Aktionsknöpfen sind entfernt. Fehler verwenden sichere lokalisierte Formulierungen anstelle roher API-/Exception-Texte. Beim fehlgeschlagenen Test verweist der Toast auf URL und Zugangsdaten; die bereinigte technische Diagnose bleibt separat in einem aufklappbaren Detailbereich der Verbindungskarte erreichbar und wird nicht in Toast oder Verlauf gespeichert.
- Die Synchronisierungsantwort unterscheidet eine neue Annahme und einen bereits aktiven Lauf. Die Abbruchantwort unterscheidet angeforderten und nicht neu angeforderten Abbruch. Keine dieser Meldungen behauptet den späteren Abschluss.
- Bestätigte Mutation und anschließendes Neuladen werden getrennt behandelt: Ein fehlgeschlagenes Neuladen macht aus einer bestätigten Speicherung/Löschung keinen vermeintlichen Aktionsfehler.
- Links öffnen die betroffene Verbindung auch in einer bereits geöffneten Connector-Seite; nach dem Löschen führen sie zur Connector-Übersicht.
- Noch unverändert: Unterbereiche für analysierte Nutzer, Mappings, Anlegen und Zugangsdaten-Dialoge sowie initiale Ladefehler/Leerzustände. Weitere Produktbereiche werden einzeln abgestimmt.
- Nur fokussierte Quelltextsichtung; weiterhin keine Tests, Builds oder Laufzeit-/Browserprüfungen.

### History Retention: Rekonstruktion und Aufbewahrung speichern

Rekonstruktions-Startfehler und einmalige Job-Endzustände aus Logs und Bibliotheksansicht erscheinen als Notifications; laufender Fortschritt bleibt am jeweiligen Auslöser sichtbar. Fehler beim Speichern von Aufbewahrungswerten erscheinen ebenfalls als Notifications, nachdem die Eingabewerte wie bisher zurückgesetzt wurden. Die alte Ergebnisfläche unter History Retention entfällt. Es wurden keine Tests, Builds oder Laufzeitprüfungen ausgeführt.

### D7 — Logs und persönlicher Notification-Verlauf: Bestätigt am 24. Oktober 2026

Der Nutzer möchte Scan-Logs, Transcoding History, History Retention und einen durchsuchbaren, zeitlich sortierten Notification-Verlauf unter einem einzigen englisch benannten Menüpunkt „Logs“, jeweils als auf-/zuklappbares Unterpanel. Die serverseitige Speicherung pro Nutzer mit getrennten Gast-Sitzungen wurde ausdrücklich bestätigt.

Umgesetzt im Arbeitsstand: gemeinsamer Logs-Eintrag, kompatible bisherige Links, separate Transcoding History, persönlicher serverseitiger Verlauf mit Suche/Paginierung und eigene altersbasierte Aufbewahrung in History Retention. Startwert 30 Tage, 0 unbegrenzt; diese Anfangswerte folgen der bisherigen Retention-Konvention und sind veränderbar. Toast-Lebensdauer und Verlaufsaufbewahrung sind unabhängig. Die Aufbewahrungsregel gilt global; bestehende globale Einstellungsrechte bleiben erhalten. Details und Grenzen stehen in [Logs](../../logs.md).

Technische Grenze: Nicht bestätigte Schreibversuche können nur in der geöffneten App nachgeholt werden. Bereits vor der Erweiterung verschwundene Toasts sind nicht rekonstruierbar. Weitere Produktintegrationen und die Prüfungen stehen weiterhin aus.

### D2a — Persönliche Einstellungen für angemeldete Konten: Bestätigt am 24. Oktober 2026

Auf die Frage, ob jeder angemeldete Nutzer seine Notification-Einstellungen unabhängig von allgemeinen Einstellungsrechten selbst ändern dürfen soll, bestätigte der Nutzer: „ja sollte jeder selber machen dürfen“.

Die erste technische Umsetzung platzierte zusätzlich einen Editor unter „Mein Konto“. Diese Platzierung war eine Fehlinterpretation und wurde nach der folgenden ausdrücklichen Nutzerkorrektur entfernt; sie ist nicht mehr aktuelles Produktverhalten.

Der API-Pfad ist unverändert: `ui_preferences.notifications` wird für ein Konto in dessen `LocalAccount.preferences` gespeichert. Der Server bestimmt das Konto aus der Sitzung; die Änderung erfordert keine Erweiterung der Zugriffsregeln. Die gespeicherten Werte werden im Editor unter App-Einstellungen für das jeweils angemeldete Konto geladen. Speichererfolg und Speicherfehler dieses Editors erscheinen ausschließlich als Notifications; die Entwürfe bleiben bei einem fehlgeschlagenen Speichern erhalten.

Zu diesem Zeitpunkt waren Guest-Einstellungen noch offen. Die spätere Quelltextaufnahme bestätigt, dass Guest im persönlichen Einstellungsbereich Sprache und Theme ändern kann; beide Werte werden unter dem lokalen Guest-Präferenz-Namespace des Browsers gespeichert. Die zusätzliche Notification-Palette, Darstellung, Dauer und Gruppierung wurde später mit D2b entschieden. Quelltext wurde gesichtet; keine Tests, Builds oder Laufzeitprüfung wurden ausgeführt.

### D2a-Korrektur — Ausschließlich App-Einstellungen, weiterhin pro Konto

Der Nutzer stellte klar: Die Einstellungen sollen nicht im Kontobereich angeboten werden, sondern ausschließlich an der bisherigen Stelle unter App-Einstellungen. Dort werden die Werte des jeweils angemeldeten Kontos angezeigt und für genau dieses Konto gespeichert.

Umgesetzt: Der zusätzliche Kontobereich-Editor und seine Zielroute sind entfernt. App-Einstellungen ist für jedes angemeldete Konto über die Settings-Navigation erreichbar. Sprache/Theme und Notifications bleiben dort zugänglich; globale Scan-, Chart- und Feature-Einstellungen sind ohne globale Leserechte ausgeblendet und ohne Schreibrechte deaktiviert. Der vorhandene kontobezogene API-/Speicherpfad bleibt unverändert. Es werden keine allgemeinen Einstellungsrechte hinzugefügt. Desktop bleibt bei App-Einstellungen; Guest kann Sprache und Theme zusätzlich lokal im persönlichen Einstellungsbereich festlegen.

Katalog, Changelog und aktuelle Dokumentation folgen dieser Korrektur. Nur Quelltextsichtung; keine Tests, Builds oder Laufzeitprüfung.

### D2c — Keine eigene Berechtigung für persönliche Notification-Einstellungen

Der Nutzer bestätigte, dass persönliche Notification-Einstellungen keine Rechte erfordern und aus dem Rechtebaum herausgelöst werden sollen. In der Rechteverwaltung gibt es keine eigene Notification-Berechtigung. Die Rechte für App-Einstellungen bleiben für installationsweite Konfigurationen erhalten; ihre Bezeichnungen und Hinweise grenzen diesen Geltungsbereich jetzt ausdrücklich von den persönlichen Notification-Einstellungen ab. Jeder angemeldete Account und Guest kann den Notification-Editor unter App-Einstellungen verwenden. D2b legt für Guest die lokale Browser-Persistenz fest.

### D2b — Guest-Notification-Präferenzen: Bestätigt am 24. Oktober 2026

Auf die Frage, ob Guest Farbpalette, Darstellungsvariante, Anzeigedauer und Gruppierung der Notifications in App-Einstellungen bearbeiten können soll, bestätigte der Nutzer: „Ja, browserlokal einstellbar“.

Umgesetzt: Der Gast erhält in der Settings-Navigation Zugang zu App-Einstellungen und dort ausschließlich zum Notifications-Unterpanel. Die globalen Scan-, Chart- und Feature-Einstellungen bleiben verborgen; Sprache und Theme bleiben im bisherigen persönlichen Einstellungsbereich. Notification-Werte werden unter dem bestehenden lokalen Guest-Präferenz-Namespace `medialyze-identity:guest:` gespeichert und steuern die Toasts direkt. Sie werden weder in einem Accountprofil noch in der globalen Serverkonfiguration abgelegt. Der Editor benötigt keine zusätzlichen Rechte.

Keine Tests, Builds, Typprüfung oder Laufzeitprüfung ausgeführt.

### D3 — Gleichzeitige Gruppen behalten und scrollen: Bestätigt am 24. Oktober 2026

Auf die Frage, ob viele unterschiedliche Notifications begrenzt und in eine Warteschlange verschoben oder alle im scrollbaren Bereich behalten werden sollen, bestätigte der Nutzer: „Alle behalten, scrollbarer Bereich“.

Umgesetzt ist ein viewport-begrenzter scrollbarer Host ohne Obergrenze, die Meldungen verwirft. Einzelne Karten laufen weiterhin nach ihrer Anzeigedauer ab; die Scrollentscheidung hebt deren Timer nicht auf. Die kompakten Gruppenstapel und ihre interne Scrollfläche bleiben unverändert.

Keine Tests, Builds, Typprüfung oder Laufzeitprüfung ausgeführt.

### D5 — Daueränderung gilt auch für sichtbare Notifications: Bestätigt am 25. Oktober 2026

Der Nutzer bestätigte auf die Frage, ob eine neue Anzeigedauer auch für bereits sichtbare Notifications gelten soll: „auch für diese“.

Umgesetzt: Nach dem Speichern einer geänderten Dauer starten die Timer aller aktiven Karten mit der neuen vollen Dauer erneut. Während einer globalen Pause bleiben sie pausiert und laufen nach deren Ende mit der neuen Dauer weiter. Normale Pausen ohne Einstellungsänderung bewahren weiterhin die jeweilige Restzeit.

Keine Tests, Builds, Typprüfung oder Laufzeitprüfung ausgeführt.

### D6 — Verlauf bei Rechteentzug prunen: Bestätigt am 24. Oktober 2026

Der Nutzer möchte bereits gespeicherte Benachrichtigungen entfernen, sobald ihre Zielressource wegen einer Rechteänderung nicht mehr zugänglich ist. Umgesetzt: Account-Rechteänderungen prüfen und löschen unlesbare Bibliotheks-, Transcoding-Job- und Connector-Ziele in derselben Datenbanktransaktion wie die Richtlinienänderung. Guest-Richtlinienänderungen prüfen alle getrennten Guest-Sitzungsverläufe. Verlaufsabrufe wiederholen die Prüfung als zusätzliche Sicherung. Deaktivierte oder gelöschte Konten verlieren ihren gesamten Verlauf; das Deaktivieren von Guest entfernt alle Guest-Verläufe. Die Löschung ist endgültig. Diese Tabelle bleibt ein persönlicher Verlauf, kein Sicherheits- oder Audit-Log.

### D8 — Nicht bestätigte Verlaufs-Schreibvorgänge verwerfen: Bestätigt am 25. Oktober 2026

Der Nutzer entschied, nicht bestätigte Verlaufs-Schreibvorgänge beim Verlassen der Sitzung zu verwerfen.

Umgesetzt: Schreibversuche bleiben bis zur Serverbestätigung ausschließlich in der Arbeitsspeicher-Warteschlange des aktuellen Providers. Solange dieselbe Identitätssitzung geöffnet bleibt, können sie durch Wiederverbindung, Fokus, eine weitere Meldung oder den Verlauf erneut gesendet werden. Nach Neuladen oder Identitätswechsel werden sie nicht wiederhergestellt oder unter einer anderen Identität erneut gesendet. Bereits vom Server bestätigte Einträge bleiben davon unberührt. Die parallel offenen Mehr-Tab-Regeln sind damit noch nicht entschieden.

### Weitere offene Entscheidungen

- D6 Rechteentzug, D8 Umgang mit nicht bestätigten Schreibvorgängen und D9 tablokale Toasts sind entschieden und umgesetzt. Gespeicherte Einträge werden nach Rechteänderungen gezielt gepruned.

## Freigabe-Nachweise — bisher nicht ausgeführt

Vor einer belastbaren Release-Freigabe fehlen insbesondere:

- Frontend-Typprüfung und Produktionsbuild sowie passende Backend-/Frontend-Tests.
- Timerrestzeiten, globale Pause, neue Meldungen während der Pause, Fokus, Touch, große Stapel und reduzierte Bewegung.
- Helles/dunkles Theme, schmale Ansichten, lange Übersetzungen, Dialogüberlagerung und Screenreader-Verhalten.
- Persistenz und Berechtigungen für Konten, Gast und Desktop; Identitäts-/Rechtewechsel und sichere Navigation.
- Pro integriertem Ablauf tatsächlicher Erfolg, Annahme, Warnung, Fehler, Abbruch und Wiederholungsschutz, soweit zutreffend.

Prüfumfang und Ergebnisse werden nach ausdrücklicher Beauftragung dokumentiert. Bis dahin sind diese Punkte offen.

### Layoutkorrektur nach Nutzerannotation (24. Oktober 2026)

Der Nutzer beanstandete Außenabstände und Formatierung auf Logs. Der fehlende äußere `AsyncPanel`-Rahmen wurde ergänzt, sodass die bestehenden Settings-Regeln für Oberfläche, Innenabstand und Sidebar-Anschluss greifen. Die Notification-Aufbewahrung steht jetzt als kompakte Tabellenzeile mit Tooltip und Speichern beim Verlassen des Feldes neben den anderen Retention-Werten. Der separate Vollbreitenblock mit Save-Knopf entfällt. Der Katalog verwendet dieselben exportierten Zeilen/Komponenten.

Gezielt geprüft: sichtbares helles Desktop-Layout per nativer Aufnahme; Panelposition/-breite und 20 px Innenabstand gegen App settings; gleiche 96-px-Eingabebreite in der Retention-Tabelle und vorhandene Dark-Theme-Oberfläche per DOM. Preview-Snapshots liefen zweimal in einen Timeout. Die schmale Ansicht konnte nicht bestätigt werden: Resize meldete die gewünschte Einstellung, der tatsächliche Viewport blieb 1280 px breit. Keine automatisierten Tests, kein Build, keine Änderungen an Aufbewahrungswerten.

### Weitere Logs-Annotationen (24. Oktober 2026)

Bestätigte Anpassungen: History Retention steht als erstes berechtigtes Unterpanel. Der einleitende Scan-Logs-Text sowie der Hinweistext vor dem Notification-Verlauf entfallen. Die leere Notification-Liste verwendet dieselbe `notice`-Darstellung wie „No completed scans yet“.

Vorschau-Meldungen dienen ausschließlich der Darstellungskontrolle und werden nicht mehr gespeichert. Der Provider nutzt eine explizite Vorschaukennzeichnung. Der Server ignoriert solche Schreibanforderungen und erkennt alte Demo-Payloads anhand ihrer bekannten Sprachpräfixe und exakten Demo-Zielrouten. Entsprechende Alteinträge werden vor Suche/Zählung/Paginierung ausgefiltert und im Übrigen der normalen Retention überlassen; keine direkte Datenbankbereinigung wurde ausgeführt.

Gezielte Browserkontrolle dieses Schritts: Panelreihenfolge und entfernte Hinweisabsätze bestätigt. Scan- und Notification-Leerzustand verwenden beide `div.notice` mit identischen berechneten Werten für Padding (12 px), Schriftgröße (14,4 px), Hintergrund und Rundung. Keine automatisierten Tests, kein Build und kein vollständiger Schreib-/Retrytest der Vorschau-Abgrenzung ausgeführt.

### Zufällige Vorschau-Aktionen (24. Oktober 2026)

Die Auswahlfelder für Status und Quellbereich sowie der Erklärungstext wurden aus dem Notifications-Unterpanel entfernt. An der bisherigen Aktionsposition stehen jetzt drei Schaltflächen: eine zufällige Vorschau, zehn zufällige Vorschauen und „Notifications leeren“. Zufallsauswahl umfasst Status und Quellbereich; die Meldungen bleiben als Vorschauen aus dem persönlichen Verlauf ausgeschlossen. Leeren beendet alle sichtbaren Toast-Timer und entfernt deren Karten, ohne Verlaufsdaten zu löschen.

Gezielte Browser-DOM-Kontrolle: genau drei Buttons stehen in einer 30-px-Zeile nebeneinander; Auswahlfelder und Hilfetext fehlen. Die Buttons wurden nicht ausgelöst. Keine automatisierten Tests, kein Build und keine Typprüfung.
