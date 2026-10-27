# Notification-Prototypen

**Status:** Designreferenzen; das Grundsystem und die ersten direkten Connector-Aktionen sind im Arbeitsstand implementiert; weitere Bereiche und spätere Jobergebnisse stehen aus.

Die aktuelle Implementierung, Persistenz, API und offenen Prüfungen stehen in [UI notifications](../../notifications.md). Die folgenden Abschnitte dokumentieren weiterhin die historische Prototyp-Exploration; neuere Vorgaben und die Implementierungsnotiz gehen bei Abweichungen vor.  
**Ziel:** Verhalten, Platzierung und Rückmeldung am Connector-Verbindungstest vergleichen.

Alle HTML-Dateien sind eigenständige Demos ohne Backend-Anbindung. Sie können direkt im Browser geöffnet werden. Die Interaktionen sind lokal simuliert; sie speichern keine Daten.

## Aktuelle Richtung

Die Randplatzierung aus Variante A gefällt am besten. In den App-Einstellungen soll es eine eigene Notification-Sektion geben. Dort kann der Nutzer Statuspalette und leichte Darstellung auswählen, die Anzeigedauer einstellen und festlegen, ob Meldungen nach gleichem Thema, gleicher Art oder beidem gestapelt werden. Gruppierte Meldungen bleiben einzelne kompakte, einheitlich 42 px hohe Karten, die im Ruhezustand um jeweils 5 px versetzt hintereinander liegen und sich beim Hovern mit kurzer, gestaffelter Animation auf 46 px Abstand der Kartenoberkanten (4 px sichtbare Lücke) auffächern. Im Ruhezustand sind höchstens fünf Karten eines Stapels sichtbar. Alle Meldungen bleiben bis zu ihrem individuellen Ablauf erhalten; beim Auffächern sind größere Stapel in einem fünf Karten hohen Scrollbereich mit Maus, Touchpad, Touchscreen oder Tastatur durchsehbar. Links zeigt ein zum Bereich passendes Lucide-Symbol (zum Beispiel Film für Transkodierung oder Ordner für Bibliotheken) die Statusfarbe; ein zusätzlicher farbiger Punkt entfällt. Die sichtbaren Kartenkanten machen den Stapel erkennbar; eine zusätzliche Anzahlmarke gibt es nicht. Andere Gruppenschlüssel bleiben eigene Kartenstapel. Zwischen getrennten Stapeln oder einzeln angezeigten Meldungen liegen 4 px. Job-Referenzen wie „Job #314“ werden als sanft gefüllte, neutrale Pille mit Monospace-Schrift hervorgehoben; diese zweite der gezeigten Varianten ist ausgewählt. Die Pille ist kein Link, der Pfeil bleibt die Navigationsaktion. Die Karten haben eine zurückhaltende neutrale Kontur ohne auffälligen Schatten. Die interaktive [Einstellungs- und Verhaltensdemo](farbpaletten-und-stile.html) zeigt das Verhalten und löst Testmeldungen aus. „Sanft anheben“ ist als feste Eintrittsanimation gesetzt: Die Karte blendet ein und bewegt sich leicht nach oben; die Bewegung ist unabhängig vom Auffächern beim Hovern.

Sobald sich der Mauszeiger im Notification-Bereich befindet, pausieren die Timer aller Notifications und Stapel gleichzeitig. Das gilt auch während des Lesens und Scrollens; neue Meldungen bleiben ebenfalls stehen. Tastaturfokus innerhalb des Bereichs pausiert alle Timer genauso. Nach Verlassen des Bereichs laufen die Meldungen mit ihrer jeweiligen Restzeit weiter. Jede kompakte Karte hat rechts einen Symbol-Link mit dem Lucide-Icon `arrow-right`; weitere Linktexte erscheinen nicht. In der Demo führen Transcode-Fehler direkt zu Job #314 und Scanprobleme zu den Einstellungen der Bibliothek Movies. Noch offen sind die voreingestellte Farbpalette, der endgültige Wertebereich der Anzeigedauer und die Persistenz der Einstellungen. Die Anzahl der Meldungen pro Stapel ist nicht begrenzt; größere Stapel lassen sich im aufgefächerten Scrollbereich durchsehen; die maximale Anzahl unterschiedlicher Stapel gleichzeitig bleibt offen.

Neue Notifications verwenden fest die Eintrittsanimation „Sanft anheben“: Sie blenden kurz ein und bewegen sich leicht nach oben. Weitere Animationen und eine Animationseinstellung sind aus dem Prototyp entfernt. Die Eintrittsanimation ist unabhängig vom Auffächern beim Hovern und respektiert `prefers-reduced-motion`.

Die Einstellungsdemo verwendet „Benachrichtigungen“ als Seitenüberschrift und hält die Abschnittstitel knapp: „Farbpalette“, „Darstellung und Verhalten“ sowie „Testmeldungen“. Die drei Farbpaletten werden in einem Dropdown ausgewählt; Farbbeschreibungen und zusätzliche Erklärungstexte entfallen. Anzeigedauer und Regler stehen in einer Zeile. Die Gruppierung heißt „Gruppieren nach“ und bietet „Aus“, „Thema“, „Art“ oder „Thema und Art“.

## Gemeinsames visuelles Muster

Die Varianten folgen derselben visuellen Sprache wie der ursprüngliche Nutzerverwaltungsprototyp: warme Panel-Fläche, kompakte Rundungen und zurückhaltende Oberflächen. Die aktuelle Demo ist in die App-Shell mit MediaLyze-Kopfzeile, Hauptnavigation, Einstellungs-Seitenmenü und aktivem Eintrag „App-Einstellungen“ eingebettet. Dafür übernimmt sie die Struktur aus `AppShell.tsx` und `LibrariesPage.tsx` sowie Design-Tokens und CSS-Muster aus `frontend/globals.css` und `frontend/src/medialyze.css`; die benötigten Regeln sind in der eigenständigen HTML-Datei eingebettet, damit sie direkt geöffnet und später in React übertragen werden kann. Die aktuelle Stapelrichtung nutzt eine neutrale feine Kontur ohne auffälligen Schatten; Statusfarbe sitzt primär am Bereichssymbol. Die älteren HTML-Dateien bleiben Vergleichsartefakte für drei Notification-Ansätze: das Original, eine ausführlichere Toast-Karte und eine Meldung direkt im betroffenen Bereich.

## Varianten

| Datei | Verhalten | Was wir damit entscheiden können |
| --- | --- | --- |
| [Variante A – Original Toast](variante-a-einzel-toast.html) | Einzeilige Toast-Meldung unten rechts. Eine neue Meldung ersetzt die vorige. Fehler bleiben im Connector-Bereich. | Bevorzugte Randplatzierung und Startpunkt für das Notification-Muster. |
| [Variante B – Ausführliche Toast-Karte](variante-b-toast-stapel.html) | Sichtbare Typmarkierung, Überschrift, Nachrichtentext und Schließen-Knopf. Bis zu drei Meldungen bleiben gestapelt; weitere warten. | Helfen mehr Hierarchie und manuelles Schließen, oder wirkt das für kurze Rückmeldungen zu schwer? |
| [Variante C – Kontextmeldung](variante-c-kontext.html) | Erfolg und Fehler erscheinen direkt unter den Aktionen in der Connector-Karte. Fehlerdiagnose und Rückmeldung bleiben am Auslöser; es gibt keinen schwebenden Toast. | Ist eine direkt zugeordnete Rückmeldung klarer als eine globale Toast-Fläche? |

## Gemeinsame Bedienung

- Die älteren Varianten A–C haben eine Theme-Schaltfläche. Die neue Einstellungsdemo zeigt nur die Notification-Einstellungen.
- Die Aktionsknöpfe im Connector-Bereich lösen den Testablauf aus.
- Variante A übernimmt die Originaldarstellung: einzeiliger Text, keine Typmarkierung oder Schaltfläche, Ausblendung nach 2,5 Sekunden.
- Variante B zeigt Typ, Titel und Nachricht in einer größeren Karte. Sie bietet einen Schließen-Knopf, bleibt bis zu 5 Sekunden sichtbar und stapelt bis zu drei Meldungen.
- Variante C zeigt jede Rückmeldung im Connector-Bereich und lässt sie dort stehen, bis eine neue Aktion sie ersetzt.
- In Variante A kann ein Dialog geöffnet und währenddessen eine Meldung ausgelöst werden, um die Überlagerung zu beurteilen. Die Ablaufzeit pausiert, solange der Dialog offen ist.
- In Variante B erzeugt „Vier Meldungen auslösen“ einen Stapel mit Warteschlange.
- In der neuen Einstellungsdemo erzeugt „Eine Testnotification“ eine zufällige Meldung; „10 Testnotifications“ zeigt eine zufällige Mischung aus Statusarten und Themen. „Alle leeren“ setzt den Notification-Stapel zurück.
- In Variante C zeigen beide Verbindungstest-Knöpfe, wie Erfolg und Fehler direkt unter den Aktionen erscheinen.

## Gesprächspunkte

1. Wie viele unterschiedliche Stapel dürfen gleichzeitig Platz beanspruchen, wenn viele verschiedene Gruppenschlüssel eintreffen, und sollen parallele Stapel dann global scrollen oder zusammengefasst werden?
2. Soll ein fehlgeschlagener Verbindungstest nur dort erklärt werden, wo er passiert, oder zusätzlich global kurz gemeldet werden?
3. Reicht die knappe Originalmeldung, oder braucht es Typ, Titel und manuelles Schließen?
4. Soll Rückmeldung global schweben oder direkt im betroffenen Bereich stehen bleiben?
5. Welche Variante bleibt auf schmalen Ansichten gut lesbar und verdeckt wenig Inhalt?
6. Welche Palette und Toast-Gestaltung soll voreingestellt sein, wenn Nutzer ihre Auswahl noch nicht angepasst haben?

Der schriftliche Arbeitsstand, die Einstellungen, die Gruppierungsregeln und der geplante Integrationsablauf stehen in [MediaLyze-UI-Benachrichtigungen-Featurekonzept.md](MediaLyze-UI-Benachrichtigungen-Featurekonzept.md). Die HTML-Demo ist ein lokaler Prototyp ohne Speicherung oder Backend-Anbindung.

## Einbindung für das nächste Release

Der [Integrationsplan und das Entscheidungsprotokoll](release-integration.md) führt die nächsten Bereiche, offenen Fragen und noch fehlenden Freigabe-Nachweise auf. Vorschläge werden erst durch ausdrückliche Bestätigung zu Produktentscheidungen.

Der Nutzer hat außerdem die Zusammenführung unter **Logs** und persönlichen, serverseitigen Notification-Verlauf bestätigt. Der aktuelle Umfang und die Aufbewahrung stehen in [Logs](../../logs.md).
