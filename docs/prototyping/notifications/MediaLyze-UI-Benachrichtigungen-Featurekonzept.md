# Featurekonzept: UI-Benachrichtigungen für MediaLyze

**Status:** Arbeitskonzept mit abgestimmter Einstellungsrichtung  
**Ausgangspunkt:** Toast-Benachrichtigung in Variante A der Nutzerverwaltung  
**Stand:** 22. Oktober 2026

## Ergänzung: Logs und Notification-Verlauf (24. Oktober 2026)

Die frühere Beschränkung auf flüchtige Meldungen ohne Verlauf ist durch die aktuelle Nutzerentscheidung erweitert: **Logs** bündelt Scan-Logs, Transcoding History, Notifications und History Retention als auf-/zuklappbare Unterpanels. Notifications erhalten einen persönlichen serverseitigen Verlauf mit Suche und eigener Aufbewahrungsdauer; Gäste bleiben je Sitzung getrennt. Verbindlicher aktueller Implementierungsstand und Grenzen: [Logs](../../logs.md). Die folgenden älteren Abschnitte dokumentieren den vorherigen Arbeitsstand.

## Fortschreibung vom 24. Oktober 2026

Die gemeinsame Ereignisregel und die Ablösung flüchtiger Inline-Erfolgs-/Fehlermeldungen sind bestätigt. Die direkten Aktionen der Connector-Verbindungskarte sind als erster Block angeschlossen; andere Bereiche und spätere Jobergebnisse stehen aus. Der aktuelle Stand und die verbleibenden Entscheidungen stehen im [Integrationsprotokoll](release-integration.md). Das ersetzt die frühere Vorgabe, zunächst gar keine echten Ereignisse anzuschließen. Tests und Laufzeitprüfung sind weiterhin nicht beauftragt.

## Implementierungsstand vom 23. Oktober 2026

Das Grundsystem ist im bestehenden `dev`-Arbeitsstand ergänzt: Provider/Host, kompakte Einzelkarten und Stapel, globale Timerpause, Einstellungen als App-Settings-Unterpanel, gezielte Vorschau und UI-Katalog. Die Implementierung ist noch nicht durch Tests, Build oder Browser geprüft. Die [Implementierungsnotiz](../../notifications.md) beschreibt API, Persistenz und verbleibende Entscheidungen.

Die aktuelle Beauftragung ersetzt die ältere Integrationsreihenfolge dieses Dokuments: **Kein echter Connector-, Scan-, Transcode- oder sonstiger Produktablauf ist angeschlossen.** Diese Integrationen werden anschließend gemeinsam Bereich für Bereich eingeführt. Der Dauerbereich ist jetzt 1–10 Sekunden in 0,5-Schritten mit Startwert 2,5 Sekunden. Die Speicherung folgt `ui_preferences.notifications` im bestehenden App-Settings-Pfad (Kontopräferenz für angemeldete Konten, globaler Pfad für Desktop/Legacy). Änderungen der Dauer gelten zunächst nur für neue Meldungen. MediaLyze/Kontur/Thema folgen als Anfangswerte der Demo; ein fachliches Limit paralleler Gruppen bleibt offen.

## Kurzbeschreibung

MediaLyze soll kurze, nicht-blockierende Rückmeldungen zu Aktionen anzeigen. Die Benachrichtigung erscheint über der aktuellen Seite und unterbricht den Arbeitsablauf nicht. Ihre Anzeigedauer wird in den App-Einstellungen festgelegt. Das Muster aus Variante A dient als visueller und funktionaler Startpunkt.

Gemeint sind flüchtige UI-Hinweise (Toasts), kein dauerhaftes Benachrichtigungszentrum und keine Browser-, E-Mail- oder Push-Mitteilungen.

## Ziel

- Eine Aktion bekommt unmittelbar eine klare Rückmeldung.
- Die Rückmeldung bleibt sichtbar, auch wenn der betroffene Bereich gerade nicht im Blick ist.
- Erfolgreiche Aktionen, Hinweise, Warnungen und Fehler bekommen jeweils eine passende Statusfarbe. Der kurze Text benennt den Zustand zusätzlich und die Meldung wird höflich für Screenreader angekündigt.
- Das Muster fügt sich in MediaLyze ein und funktioniert in hellem, dunklem und schmalem Layout.

## Aktuelle Designrichtung

Die Randplatzierung aus Variante A ist bevorzugt: unten rechts, kompakt und nicht-blockierend. Erfolg, Info, Warnung und Fehler erhalten passende Statusfarben. In den App-Einstellungen soll man Farbpalette, leichte Formvariante und Anzeigedauer wählen können. Außerdem kann man wiederkehrende Meldungen stapeln und auswählen, ob nach Thema, Art oder beidem gruppiert wird. Gruppierte Meldungen erscheinen als kompakter Kartenstapel, der sich beim Hovern eng auffächert. Jede Karte beginnt mit einem zum Herkunftsbereich passenden Lucide-Symbol, dessen Farbe den Notification-Status zeigt; ein separater farbiger Statuspunkt entfällt. Die Kartenfläche erhält eine neutrale, feine Kontur ohne auffälligen Schatten. Die Palette und Grundform bleiben auswählbar; die Stapelinteraktion zeigt die interaktive [Einstellungs- und Verhaltensdemo](farbpaletten-und-stile.html).

## App-Einstellungen und Stapelverhalten

Die Notification-Sektion gehört als eigene Sektion in die App-Einstellungen. Die HTML-Demo bildet diese Einstellungsseite konzeptionell nach; sie speichert noch keine Auswahl dauerhaft.

- **Farbpalette:** Ein einfaches Dropdown bietet MediaLyze, Sanft & ruhig sowie Klar & kontrastreich. Die Karten mit Farbbeschreibungen sind entfernt. Die gewählte Palette bildet alle vier Statusarten ab und besitzt passende helle und dunkle Farben.
- **Darstellung:** Kontur, Akzentsteg oder sanfte Flächentönung werden im Prototyp über ein einfaches Dropdown gewählt. Die kompakte Randplatzierung und Geometrie aus Variante A bleiben die Basis; die Kontur ist neutral und ohne auffälligen Schatten.
- **Anzeigedauer:** Die Demo bietet 1 bis 10 Sekunden in 0,5-Sekunden-Schritten und startet mit 2,5 Sekunden. Das ist ein erkundbarer Wertebereich, noch kein abschließend festgelegter Produktbereich.
- **Gruppieren nach:** Ein einfaches Dropdown bietet „Aus“, „Thema“, „Art“ und „Thema und Art“. Ohne Gruppierung erscheint jede Meldung als eigene Toast-Karte. „Thema“ gruppiert etwa Ereignisse eines bestimmten Scanlaufs oder Transcode-Jobs auch dann, wenn ihre Art abweicht. „Art“ gruppiert zum Beispiel Fehler aus verschiedenen Bereichen. „Thema und Art“ fasst nur Meldungen zusammen, die beides teilen.
- **Gruppenschlüssel:** Die aufrufende Aktion muss dafür einen stabilen fachlichen Schlüssel liefern, zum Beispiel `transcoding-job:314` oder `library-scan:movies`. Der sichtbare Text allein ist kein zuverlässiger Gruppenschlüssel.
- **Stapel-Darstellung:** Jede Notification bleibt eine eigene Karte. Karten mit demselben Gruppenschlüssel liegen im Ruhezustand um etwa 5 px vertikal versetzt; die neueste liegt vorne. Im Ruhezustand sind höchstens fünf Karten sichtbar. Weitere Meldungen bleiben bis zu ihrem individuellen Ablauf im Stapel erhalten. Beim Hovern oder Tastaturfokus wird ein größerer Stapel vollständig in einem fünf Karten hohen Scrollbereich zugänglich. Die Scrollfläche ist per Tab erreichbar und lässt sich mit Maus, Touchpad oder Tastatur durchlaufen; es gibt keine Obergrenze für Meldungen pro Stapel. Der Stapel zeigt keine zusätzliche Anzahlmarke; die einzelnen Kartenkanten bleiben sichtbar. Meldungen mit einem anderen Gruppenschlüssel erscheinen in einem eigenen Stapel. Zwischen getrennten Stapeln oder einzeln angezeigten Meldungen liegen 4 px.
- **Aufgefächerter Zustand:** Beim Hovern über den Stapel oder beim Tastaturfokus auf einer seiner Karten fächern sich die einheitlich 42 px hohen Karten mit einer 300-ms-Animation und gleichmäßig 46 px Abstand ihrer Oberkanten auf. Zwischen allen Karten bleibt dadurch dieselbe enge Lücke von 4 px. Ein kurzer Versatz zwischen den Karten lässt den Fächer weich aufgehen; beim Verlassen schließt er sanft zurück. Die kompakte Textbegrenzung bleibt auch im aufgefächerten Zustand bei höchstens zwei Zeilen, damit der Stapel eng bleibt.
- **Bereichs- und Statussymbol:** Links steht statt eines Statuspunkts ein zum Zielbereich passendes Lucide-Symbol, etwa Film für Transkodierung und Ordner für Bibliothek/Scan. Palette und Notification-Art bestimmen dessen Statusfarbe. Das Symbol ist nicht der einzige Bedeutungsträger; der Nachrichtentext bleibt eindeutig.
- **Kompakte Notification:** Der Stapel ist höchstens 324 px breit. Karten haben eine neutrale feine Kontur und keinen auffälligen Schatten. Einzige sichtbare Aktion ist das 22-px-Lucide-Icon arrow-right als Symbol-Link ganz rechts; sein zugänglicher Name und Tooltip benennen das Ziel.
- **Erscheinungsanimation:** Neue Notifications verwenden fest „Sanft anheben“: Sie blenden kurz ein und bewegen sich leicht nach oben. Weitere Animationsvarianten und eine Animationseinstellung sind aus dem Prototyp entfernt. Eintritt und Fächer-Animation beim Hovern sind getrennt; `prefers-reduced-motion` wird berücksichtigt.
- **Inline-Referenz:** Kennungen wie „Job #314“ werden innerhalb des Meldungstextes als sanft gefüllte, neutrale Pille mit Monospace-Schrift hervorgehoben (ausgewählte Darstellung: Variante 2). Die Pille ist nicht anklickbar und verwendet keine Statusfarbe; der Pfeil bleibt die Navigationsaktion. Der Prototyp erkennt zunächst das Muster `Job #<Zahl>`. In der Produktumsetzung soll die Referenz als strukturierter Nachrichtenteil übergeben werden, damit Übersetzungen Wortstellung und Beschriftung korrekt anpassen können.
- **Lebensdauer im Stapel:** Jede Meldung hat ihren eigenen Ablaufzeitpunkt. Läuft eine Meldung ab, wird sie aus der Gruppe entfernt; die Gruppe verschwindet, wenn keine Meldungen mehr übrig sind. Sobald sich der Mauszeiger über einer Notification im Notification-Bereich befindet, pausieren global die Timer aller Meldungen und Stapel. Das gilt auch beim Lesen und Scrollen. Tastaturfokus innerhalb des Bereichs pausiert ebenfalls alle Timer. Neu eintreffende Meldungen bleiben solange stehen. Nach Verlassen des Bereichs laufen alle Meldungen mit ihrer jeweils gespeicherten Restzeit weiter.
- **Zielnavigation:** Jede Karte erhält rechts einen Symbol-Link mit dem Lucide-Icon `arrow-right`. Er führt zum betroffenen Bereich und möglichst direkt zum Element. Auch wenn mehrere Karten denselben Stapel bilden, bleibt der Ziel-Link jeder einzelnen Notification erhalten.
- **Beispiele in der Demo:** Drei Testknöpfe erzeugen eine zufällige einzelne Testnotification, zehn zufällige Testnotifications mit verschiedenen Statusarten und Themen oder leeren den Notification-Stapel. Transcode-Notifications führen zur Transkodierungsübersicht und zum jeweiligen Job; Scanmeldungen öffnen die Einstellungen der betroffenen Bibliothek. Die Prototyp-Routen simulieren diese Ziele.

Die Testknöpfe erzeugen entweder eine einzelne zufällige Notification oder zehn zufällig gewählte Kombinationen aus vier Statusarten und sechs Themen (zwei Transcode-Jobs und vier Bibliotheksscans). Dadurch lässt sich die Gruppierung mit unterschiedlichen Wiederholungen und Quellbereichen beobachten.

Die Dauersteuerung setzt in der Demo beim Verändern den Timer bereits sichtbarer Meldungen auf den neuen Wert zurück. Damit ist die Auswahl unmittelbar beobachtbar. Produktseitig ist noch zu entscheiden, ob eine Einstellungsänderung aktive Meldungen ebenfalls neu taktet oder erst für neu erzeugte Meldungen gilt.

## Stand im Prototyp Variante A

Variante A enthält ein einzelnes, global positioniertes Toast-Element:

- unten rechts fixiert; maximal 360 px breit, mit 18 px Abstand zum Viewportrand
- warme Panel-Oberfläche, 1-px-türkise Kontur, 10-px-Rundung und vorhandener Schatten
- kompakte Schriftgröße von 0,74 rem
- Einblendung mit 160-ms-Überblendung und 7-px-Bewegung
- `role="status"` und `aria-live="polite"`
- automatisch ausgeblendet nach 2,5 Sekunden
- es wird nur ein Toast angezeigt: Eine neue Meldung ersetzt die vorherige und startet den Timer neu
- nur eine kurze Textmeldung; kein Typ-Label, Symbol, Schließen-Knopf oder Aktionsknopf
- nicht anklickbar (`pointer-events: none`)

Die Meldungen im Prototyp werden durch `notify(message)` ausgelöst. Das HTML speichert keine Nachrichten und ist nicht an API oder Backend angebunden.

### Im Prototyp abgedeckte Situationen

| Aktion oder Zustand | Rückmeldung im Prototyp | Einordnung für die Weiterentwicklung |
| --- | --- | --- |
| Geschütztes Besitzerkonto ausgewählt | Konto hat automatisch alle Rechte und kann nicht geändert werden | Informativ; wiederholte Meldungen beim Kontowechsel können störend sein |
| Gastprofil ausgewählt | Standardmäßig deaktiviert und rein lesend | Informativ; eventuell besser dauerhaft am Profil anzeigen |
| Änderungen übernehmen | Änderungen seien in der Vorschau übernommen | Erfolg, in der echten App erst nach bestätigtem Speichern |
| Änderungen verwerfen | Demoänderungen seien zurückgesetzt | Bestätigung |
| Pflichtfelder beim Anlegen fehlen | Anzeigename und Benutzername eingeben | Fehler; im Produkt zusätzlich Feldvalidierung direkt am Formular erwägen |
| Demo-Nutzer angelegt | Konto sei lokal in der Vorschau angelegt | Erfolg, in der echten App erst nach bestätigter Erstellung |
| Nutzer aktiviert oder deaktiviert | Statuswechsel wird bestätigt | Erfolg; Deaktivierung kann je nach Folge auch eine erklärende Meldung brauchen |
| Passwortreset bestätigt | Demoaktion wird bestätigt; es wurde kein Passwort geändert | In der echten App keine Passwörter oder Geheimnisse in der Meldung anzeigen |

## Erstumsetzung: Verhalten und Design (Arbeitsstand)

Die folgenden Festlegungen machen aus dem Prototyp ein wiederverwendbares Frontend-Muster. Sie beschreiben den erwarteten Umfang der ersten Produktumsetzung. Die älteren HTML-Varianten vergleichen zusätzlich eine ausführlichere Toast-Karte und kontextnahe Rückmeldung; die inzwischen gewünschte Einstellungs- und Stapelvariante ist in der aktuellen Demo beschrieben.

### Umfang und Einbauort

- Das erste Release ist eine Frontend-Funktion für die laufende MediaLyze-Oberfläche. Benachrichtigungsereignisse werden nicht serverseitig gespeichert; es gibt keine Historie oder Zustellung, wenn MediaLyze geschlossen ist. Die konfigurierbaren App-Einstellungen sollen gespeichert werden; Ort und Reichweite dieser Präferenzen sind noch offen.
- Ein gemeinsamer Notification-Provider verwaltet die Meldung im App-Lebenszyklus. Die Toast-Fläche wird einmal im `AppShell` gerendert und bleibt bei internen Routenwechseln erhalten. Ein vollständiger Reload oder das Schließen der App verwirft die Meldung.
- Die Fläche sitzt wie im Original unten rechts. Sie ist höchstens 360 px breit, hat 18 px Randabstand und berücksichtigt auf schmalen Ansichten `env(safe-area-inset-*)`.
- Der Toast liegt über dem Seiteninhalt, aber unter modalen Dialogen und deren Backdrops. Ist ein modaler Dialog offen, bleibt die aktuelle Meldung erhalten; die Ablaufzeit pausiert bis zum Schließen.
- Das Toast-System ersetzt weder das bestehende Scan-/Job-Banner noch Statusanzeigen, Formularvalidierung, Dialoge, Release Notes oder Desktop-/Docker-Updatehinweise.

### Meldungsablauf und Anzeigeverhalten

- Eine Notification wird nur durch ein konkretes Nutzerereignis ausgelöst, nicht durch Polling oder jede Statusänderung eines laufenden Jobs.
- Erfolg wird erst gemeldet, wenn die maßgebliche Aktion bestätigt wurde. Bei einem Ergebnis mit Status wie `queued` oder `running` beschreibt der Text nur, dass der Auftrag angenommen oder gestartet wurde; er behauptet keinen abgeschlossenen Scan oder Transcode.
- Ohne aktiviertes Stapeln erscheint jede Meldung als eigene Toast-Karte. Wenn Stapeln aktiviert ist, werden Meldungen entsprechend der gewählten Regel gruppiert. Polling und wiederholte Statusabfragen bleiben ungültige Auslöser.
- Die Anzeigedauer wird konfiguriert. Der Startwert der Demo ist 2,5 Sekunden; unterschiedliche Dauern je Statusart sind nicht Teil der bisherigen Auswahl.
- Sobald sich der Mauszeiger über einer Notification im gemeinsamen Notification-Bereich befindet, pausieren die Timer sämtlicher sichtbarer Meldungen und Stapel. Die Pause bleibt während des Lesens und Scrollens aktiv; auch neu eintreffende Meldungen starten zunächst pausiert. Nach Verlassen des Bereichs läuft jede Meldung mit ihrer Restzeit weiter. Tastaturfokus innerhalb des Notification-Bereichs pausiert ebenfalls alle Timer; Maus- und Fokuszustand werden unabhängig verfolgt, damit der Timer erst weiterläuft, wenn beides den Bereich verlassen hat.
- Jeder Toast erhält einen `arrow-right`-Link zum passenden Quellbereich. Aktions- und Navigationslinks führen gezielt zu einem Bereich beziehungsweise Job oder einer betroffenen Bibliothek. Sonstige Aktionen wie „Rückgängig“ bleiben außerhalb dieses Konzepts.
- Ein Fehler, der eine Erklärung oder weitere Handlung braucht, bleibt zusätzlich im betroffenen Bereich sichtbar. Der Toast ist dafür nicht die einzige Informationsquelle.

### Erster Integrationsablauf

Als erster echter Ablauf dient **Connector Settings → Verbindung testen**. Das ist eine kurze Aktion mit einem eindeutigen Serverergebnis und ersetzt keine Nutzerverwaltung; MediaLyze verwaltet derzeit keine internen Nutzerkonten.

- Bei `result.success === true` wird der bisherige lokale Erfolgshinweis durch einen globalen Erfolgstoast ersetzt, zum Beispiel „Verbindung zu {{name}} erfolgreich getestet.“
- Bei einem fehlgeschlagenen Test bleibt die bestehende kontextbezogene Fehleranzeige samt technischer Diagnose im Connector-Bereich. Es erscheint in diesem ersten Ablauf kein zweiter, inhaltlich gleicher Fehlertoast.
- Verbindungsdaten, Tokens und andere Geheimnisse werden nie in einem Toast ausgegeben.
- Weitere Aktionen werden erst nach dieser ersten Integration einzeln bewertet. Vorhandene Notices werden nicht pauschal in Toasts umgewandelt.

### Aufruf und Texte

Der Aufruf übergibt Typ, bereits lokalisierten kurzen Text, Themenkennung für Gruppierung sowie Zielbereich und Zielroute. `source.area` (zum Beispiel `connectors`, `transcoding` oder `library`) wählt das passende Lucide-Bereichssymbol; Notification-Typ und aktive Palette bestimmen dessen Farbe. Jede Notification hat ein Ziel für den rechten Quelllink. Die Übersetzung erfolgt am Aufrufort mit `useTranslation`; rohe `Error.message`-Texte werden nicht ungeprüft in globale Meldungen übernommen.

```ts
notify({
  type: "success",
  message: t("connectors.testSucceeded", { name }),
  source: { area: "connectors", href: "/settings/connectors", label: t("connectors.openSettings") },
});
```

Für gruppierbare Meldungen kann der Aufruf zusätzlich einen fachlichen `topicKey` übergeben. Der zentrale Toast-Renderer kümmert sich um Darstellung, Zeitablauf und den `arrow-right`-Quelllink. Er kennt keine API-Fehlerdetails und trifft keine Entscheidung darüber, ob eine Aktion erfolgreich war.

## Nachrichtentypen

Die erste Schnittstelle unterstützt vier Typen:

- **Erfolg:** eine kurze Aktion wurde bestätigt.
- **Hinweis:** eine Information ohne Fehler oder Risiko.
- **Warnung:** eine konkrete Folge oder ein Risiko ist zu beachten.
- **Fehler:** eine Aktion ist fehlgeschlagen. Eine für die Behebung nötige Diagnose bleibt im passenden Seitenbereich.

Die Typen erhalten je eine Statusfarbe, die in der gewählten Palette abgestimmt wird. Statt eines farbigen Punkts zeigt ein zum Herkunftsbereich passendes Lucide-Symbol diese Farbe (zum Beispiel Film bei Transkodierung und Ordner bei Bibliotheks-Scans). Ein separates Typ-Label ist nicht vorgesehen; der Meldungstext benennt den Zustand auch ohne Farbe. Die Darstellungseinstellung steuert zusätzlich Kontur, schmalen Akzentsteg oder dezente Flächentönung.

## Gestaltung und Barrierefreiheit

- Die Toast-Geometrie übernimmt die kompakte Randplatzierung aus dem ursprünglichen Nutzerverwaltungsprototyp: warme Panel-Fläche, 9-px-Rundung, neutrale feine Kontur und kein auffälliger Schatten. Der Kartenstapel bleibt höchstens 324 px breit. Nutzer wählen Statuspalette und eine leichte Darstellung: Kontur, Akzentsteg oder sanfte Flächentönung.
- Helles und dunkles Theme unterstützen; ausreichenden Textkontrast sicherstellen.
- Auf Mobilgeräten den verfügbaren Rand und die Safe Area beachten. Der Toast darf wichtige Bedienelemente nicht verdecken.
- Bewegung respektiert `prefers-reduced-motion`.
- Die Meldung erhält keinen Tastaturfokus und stiehlt keinen Fokus.
- Toast-Links sind regulär per Tastatur erreichbar. Solange der Tastaturfokus innerhalb des Notification-Bereichs liegt, pausieren die Timer aller Meldungen.
- Toasts werden höflich angekündigt (`role="status"`, `aria-live="polite"`). `role="alert"` ist nicht der Standard für Fehler-Toasts; dringende oder handlungsbedürftige Fehler bleiben als passende Inline- oder Dialogmeldung bestehen.
- Die Statusregion bleibt stabil im DOM und aktualisiert ihren Text, damit neue Meldungen ohne Fokuswechsel angekündigt werden können. Screenreader sollen nicht bei jedem Fortschritt oder Polling erneut unterbrochen werden.
- Animation und Farbe sind nicht die alleinigen Informationsträger. Der Nachrichtentext benennt die Rückmeldung.
- Die einstellbare Dauer muss mit langen sowie übersetzten Meldungen geprüft werden. Meldungen, die eine Aktion erfordern, dürfen sich nicht allein auf einen kurz sichtbaren Toast verlassen.

## Einordnung in die bestehende UI

Bei einer kurzen Suche im Frontend- und Backend-Code am 20. Oktober 2026 waren seitengebundene Status- und Erfolgshinweise vorhanden, zum Beispiel in `frontend/src/pages/TranscodingPage.tsx` und `frontend/src/components/ConnectorSettingsPanel.tsx`. Ein gemeinsames, schwebendes Toast-Muster wurde dabei nicht gefunden.

Ein neues Toast-Muster ersetzt oder ergänzt lokale Hinweise nur gezielt. Insbesondere werden bestehende Lade-, Fortschritts-, Formular- und Diagnosemeldungen nicht pauschal migriert. Scan-/Transcode-Fortschritt bleibt in den bestehenden Jobflächen sichtbar; ein Toast kann höchstens eine kurze Annahme- oder Abschlussmeldung ergänzen.

Für die Nutzerverwaltung gibt es im aktuellen Produkt keinen echten Ablauf, an den der Prototyp angeschlossen werden könnte. Der erste Produktablauf ist deshalb der Verbindungstest in den Connector Settings. Die App-Version- und Release-Notes-Anzeigen im App-Shell sind ein unabhängiger Update-Informationsfluss und gehören nicht in das Toast-System.

## HTML-Explorationen

Unter [notifications/README.md](README.md) liegen eigenständige HTML-Prototypen für Toast-Verhalten und -Platzierung. Die [Einstellungs- und Verhaltensdemo](farbpaletten-und-stile.html) ist in die bestehende MediaLyze-App-Shell eingebettet: mit Kopfzeile, Hauptnavigation, dem echten Einstellungs-Seitenmenü und „App-Einstellungen“ als aktivem Bereich. Die Seitenüberschrift lautet „Benachrichtigungen“. Die Farbpalette ist knapp mit „Farbpalette“ überschrieben; zusätzliche Einleitungstexte bei Farbpalette, Einstellungen und Testmeldungen entfallen. Anzeigedauer und Regler stehen in einer Zeile. Die Gruppierung ist als „Gruppieren nach“ beschriftet und bietet „Aus“, „Thema“, „Art“ und „Thema und Art“. Die Demo übernimmt die Struktur aus `AppShell.tsx` und `LibrariesPage.tsx` sowie Tokens und CSS-Muster aus `frontend/globals.css` und `frontend/src/medialyze.css`; alle für die Standalone-Demo nötigen Regeln sind in die HTML-Datei kopiert. Die weiteren Einstellungen enthalten ein Dropdown für die Darstellung. Drei Testknöpfe erzeugen eine einzelne zufällige Meldung, zehn verschiedene zufällige Meldungen oder leeren den Stapel. Die Eintrittsanimation „Sanft anheben“ ist fest eingestellt; Animationsvergleiche sind entfernt. Job-Referenzen werden mit einer neutralen Pille inline markiert. Die Demo zeigt den kompakten Kartenstapel mit links stehendem, statusfarbigem Bereichssymbol, neutraler Kontur ohne auffälligen Schatten, 5-px-Versatz im Ruhezustand und 46-px-Abstand der Kartenoberkanten (gleichmäßige 4-px-Lücke) beim Auffächern mit kurzer, gestaffelter Animation per Hover oder Tastaturfokus. Im Ruhezustand sind höchstens fünf Karten sichtbar; alle Meldungen bleiben bis zum individuellen Ablauf erhalten und lassen sich beim Auffächern in einem fünf Karten hohen Scrollbereich durchsehen. Quelllinks führen zum jeweiligen Testjob oder zu den Bibliothekseinstellungen. Die Demo persistiert keine Einstellungen.

## Offene Entscheidungen

- Welcher Wertebereich und welcher Standard für die Anzeigedauer sind im Produkt sinnvoll? Reichen eine gemeinsame Dauer für alle Typen und die Demo-Spanne von 1 bis 10 Sekunden?
- Wie und wo werden die Einstellungen gespeichert, und gelten sie für den lokalen Browser, ein Desktop-Profil oder gemeinsam für die MediaLyze-Instanz?
- Soll das Ändern der Dauer auch bereits sichtbare Meldungen neu takten oder nur neue Meldungen beeinflussen?
- Wie viele unterschiedliche Stapel dürfen gleichzeitig Platz beanspruchen, und sollen sehr viele parallele Gruppen global begrenzt, gescrollt oder zusammengefasst werden?
- Welche Aktionen und Fehlerzustände sollen einen direkten `arrow-right`-Link erhalten, und wie genau wird das Ziel bei Scan- und Transcode-Jobs adressiert?
- Welche bestehenden lokalen Statusmeldungen profitieren von globalem Aktionsfeedback?

## Mögliche Umsetzungsschritte

1. In der interaktiven Demo Palette und Grundform auswählen; Dauerbereich und Speicherung festlegen. Die Kartenstapel- und Auffächerinteraktion ist die aktuelle Designrichtung.
2. Den Notification-Provider, konfigurierbaren Toast-Renderer, Gruppenschlüssel, unabhängige Timer und Hover-/Fokus-Pausierung konzipieren.
3. Den `arrow-right`-Quelllink als Teil des Meldungsmodells festlegen und Routen für die ersten Anwendungsfälle bestimmen.
4. Den Verbindungstest als ersten einfachen Integrationsablauf festlegen; Fehlerdiagnose zunächst im Kontext belassen.
5. Danach gezielt Scan- und Transcode-Anwendungsfälle anbinden, inklusive sinnvoller Zielroute und Gruppenschlüssel pro Job oder Bibliothek.
6. Helles/dunkles Theme, schmale Ansichten, Safe Areas, Dialogüberlagerung, reduzierte Bewegung, Fokus und Screenreader-Verhalten prüfen.
7. Texte für Englisch, Deutsch, Spanisch und Ukrainisch ergänzen sowie einen repräsentativen Eintrag in `/ui-elements` und einen knappen `vUnreleased`-Changelog-Eintrag hinzufügen.

## Referenzen

- Prototyp: `Desktop/MediaLyze-Nutzerverwaltung-Prototyp/variante-a-kontenliste.html`
- Projektfarben und Basisstile: `frontend/globals.css`
- Feature- und Layoutstile: `frontend/src/medialyze.css`
- Bestehende lokale Statushinweise: `frontend/src/pages/TranscodingPage.tsx`, `frontend/src/components/ConnectorSettingsPanel.tsx`
