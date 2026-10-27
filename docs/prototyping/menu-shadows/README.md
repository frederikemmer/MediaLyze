# Menü-Schattenvergleich

**Status:** Zwischenstufe ausgewählt und in gemeinsame Menü- und Auswahlstile übernommen  
**Datum:** 2026-10-24

Die [HTML-Demo](vergleich.html) stellt dem aktuellen Zustand eine rechnerische Zwischenstufe und drei ruhigere Ansätze gegenüber. Die Zwischenstufe interpoliert Panel- und Auswahl-Schatten jeweils mittig zwischen IST und A. Sie zeigt das Menü, die `Permissions / Account`-Tabs aus dem Anmerkungs-Screenshot und eine ausgewählte Zeile im Berechtigungsmenü. Die Auswahl kann pro Beispiel angeklickt werden.

## Varianten

| Variante | Flächen und Auswahl |
| --- | --- |
| Aktuell | Deutlicher Panelschatten; aktive Auswahl ist erhaben. |
| Zwischenstufe · IST/A | Schattenwerte liegen jeweils mittig zwischen dem aktuellen Zustand und A. |
| A · Leichter | Panel- und Auswahl-Schatten sind sichtbar abgeschwächt. |
| B · Kontur statt Schatten | Schatten entfallen weitgehend; eine feine Kontur markiert die Auswahl. |
| C · Flach und ruhig | Keine Schlagschatten; eine dezente Akzentfläche zeigt die Auswahl. |

Schrift, Flächenfarben, Abstände, Rundungen und Inhalte bleiben zwischen den Ansichten gleich. Fokus bleibt unabhängig von der gewählten Behandlung mit einer Akzentkontur sichtbar. Die Demo speichert nichts und greift nicht auf das Backend zu.

Ausgewählt wurde die Zwischenstufe zwischen IST und A. Sie übernimmt die mittleren Schattenwerte für Panel, gruppierte Steuerelemente und ausgewählte Elemente. Zugehörige Menüs und Popovers folgen derselben abgestuften Reduktion. Die Umsetzung liegt in `frontend/globals.css` und `frontend/src/medialyze.css`; die verbleibenden Varianten bleiben hier als Vergleich dokumentiert.
