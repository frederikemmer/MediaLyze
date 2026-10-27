# Ersteinrichtung und erstes Onboarding

**Status:** Arbeitsstand zur gemeinsamen Planung; keine Produktentscheidung ist durch diesen Entwurf bestätigt.  
**Stand:** 24. Oktober 2026  
**Prototyp:** [Interaktiver HTML-Vergleich](onboarding-vergleich.html)

## Ziel

Neue Installationen sollen nach dem ersten Start ohne lange Suche eine erste MediaLyze-Library anlegen und einen ersten Scan starten können. Dadurch sehen neue Nutzer einen klaren nächsten Schritt und erhalten nach dem Scan erste brauchbare Inhalte im Dashboard.

## Ausgangslage aus dem aktuellen Arbeitsstand

- Im Serverbetrieb erstellt die erste Person beim Setup das Owner-Konto und wird danach angemeldet. Das geschieht über die vorhandene lokale Konto-Einrichtung.
- Desktop arbeitet ohne lokales Benutzerkonto und kann direkt mit der Library-Einrichtung beginnen.
- Eine Library anzulegen und einen Scan zu starten sind aktuell getrennte Aktionen. Der Library-Endpunkt erstellt die Library; ein Scan wird danach über den separaten Scan-Ablauf gestartet.
- Serverpfade werden sicher innerhalb von MEDIA_ROOT ausgewählt. Desktop verwendet die native Ordnerauswahl und absolute Pfade.
- Library-Typen sind Filme, Serien, Musik, Hörbücher, Gemischt und Sonstiges. Mehrere Wurzeln pro Library werden unterstützt.

Der HTML-Prototyp ist eine reine Bedienungsdemo. Konto, Library, Verzeichniswahl und Scan werden nicht mit dem Backend verbunden; Scanstatus und Beispieldaten sind simuliert.

## Gemeinsamer Ablauf als Arbeitshypothese

1. Server: vorhandenes Owner-Konto wird fertig eingerichtet; danach öffnet sich der Library-Einstieg. Desktop: startet direkt beim Library-Einstieg.
2. Name und Library-Typ eingeben.
3. Einen oder mehrere Medienordner auswählen.
4. Library anlegen und den ersten vollständigen Scan gezielt starten.
5. Scanfortschritt verständlich zeigen und anschließend zum Dashboard führen.

Der Scan ist eine technische Voraussetzung für aussagekräftige Statistiken. Ob Nutzer bis zum Scanende im Onboarding bleiben oder schon währenddessen ins Dashboard wechseln können, ist noch offen.

## Vergleichsrichtungen

Der Prototyp zeigt dieselben Grundaufgaben in drei Anordnungen:

- **Geführter Ablauf:** Name und Typ, Medienordner und erster Scan liegen in einzelnen Schritten.
- **Dashboard-Checkliste:** Die leere Übersicht erklärt die drei Schritte und führt nacheinander durch sie.
- **Libraries-Formular:** Die Einrichtung findet als ein zusammenhängendes Formular im bestehenden Library-Bereich statt.

Die Varianten sind Gesprächsgrundlagen, keine Auswahl oder Freigabe. Die Demo-Steuerung oben im HTML wechselt Richtung, Server/Desktop-Voraussetzung und helles/dunkles Theme.

## Gestaltung und Bedienung

Der Prototyp greift aktuelle MediaLyze-Farben, Space-Grotesk-Typografie, helle Panel-Flächen, Rundungen und Navigationsdichte auf. Er bleibt eine einzelne HTML-Datei unter diesem Ordner und ändert keine App-Dateien.

Tastaturbedienung, sichtbare Fokusmarkierungen, beschriftete Formularfelder, Statusmeldungen und eine reduzierte Bewegungsvariante sind berücksichtigt. Die Ordnerauswahl ist eine lokale Simulation. Im späteren Produkt muss der Server weiterhin nur zulässige MEDIA_ROOT-Pfade anbieten; Desktop muss weiterhin den nativen Picker verwenden.

## Offene Produktfragen

1. **Auslöser:** Nur beim ersten Setup einer Installation ohne Libraries oder auch später bei einem Konto, das noch keine zugängliche Library hat? Bei eingeschränkten Konten darf eine fehlende Sichtberechtigung nicht wie eine leere Installation behandelt werden.
2. **Überspringen:** Kann man die Einrichtung schließen und später fortsetzen? Falls ja, wo liegt der gut sichtbare Wiedereinstieg und wie wird der Hinweis pro Installation oder Konto gespeichert?
3. **Erster Scan:** Soll die Library direkt mit dem ersten Scan angelegt werden, oder soll der Nutzer nach der Library-Erstellung noch ausdrücklich „Scan starten“ wählen?
4. **Während des Scans:** Soll die Person auf der Scan-Seite bleiben oder schon ins Dashboard wechseln können, während der Scan weiterläuft?
5. **Ordner:** Im ersten Schritt nur ein Medienordner oder direkt mehrere Wurzeln pro Library anbieten?
6. **Library-Typ:** Soll die Typauswahl neutral bleiben, oder möchten wir für Erstnutzer einen sinnvollen Vorschlag zeigen?
7. **Wiederkehr:** Soll Onboarding an der Installation, am ersten Owner-Login oder an einem dauerhaft gespeicherten Einrichtungsstatus hängen?

## Mögliche Integration nach der Konzeptauswahl

- Nach erfolgreichem Server-Setup beziehungsweise beim ersten Desktop-Start den vorhandenen Identitäts- und Library-Ladezustand auswerten.
- Den Onboarding-Einstieg nur für den bestätigten Installationszustand anzeigen; nicht allein aus einer nutzerspezifisch leeren Library-Liste ableiten.
- Die Library mit dem bestehenden API-Vertrag erstellen und den vollständigen Scan als separaten Scanauftrag starten.
- Den vorhandenen Jobstatus und Scan-Banner wiederverwenden, damit Fortschritt und Abbruch konsistent bleiben.
- Den letzten Schritt erst nach bestätigter Anlage ausblenden; Fehler müssen im aktuellen Schritt sichtbar bleiben und Wiederholen erlauben.
- Für Server, Desktop und responsive Ansichten die jeweilige Pfadauswahl beibehalten.

Diese Punkte sind technische Vorschläge. Produktablauf, Überspringen, Wiederaufnahme und Scanübergang brauchen noch gemeinsame Entscheidungen.
