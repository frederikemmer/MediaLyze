# MediaLyze – Nutzerverwaltung und Zugriff

Temporäre Entscheidungsnotiz · begonnen am 19.10.2026

## Arbeitsweise und Stand

- Grundlage ist der vom Nutzer vorgelegte Entwurf „Nutzerverwaltung und konfigurierbarer Zugriff für MediaLyze“.
- Der Entwurf wird schrittweise gemeinsam präzisiert. Vorschläge gelten erst nach Bestätigung als beschlossen.
- Diese Notiz liegt außerhalb des Projekts. Keine Implementierung beauftragt; keine Änderungen am Repository.
- Der grundlegende Entwurf ist tragfähig. Die folgenden Punkte konkretisieren offene Regeln.

## Bereits im Entwurf festgelegt

- Aktuelle Richtung: ein Kontotyp „Nutzer“ mit individuell vergebenen Rechten, ohne getrennte Admin-/Nutzergruppen. Rechte werden als Baum gruppiert; ganze Bereiche lassen sich gemeinsam auswählen. Genau ein Nutzer ist der geschützte Besitzer mit automatisch vollständigen, unveränderbaren Rechten. Ein separates Gastprofil ermöglicht anonymen Zugriff.
- Keine Selbstregistrierung, externen Logins oder E-Mail-Wiederherstellung in V1.
- Gastzugriff startet gesperrt; angemeldete Konten erben keine Gastrechte.
- Zentrale serverseitige Prüfung für API, direkte URLs und Medienzugriff.
- Bibliotheksfreigaben: alle einschließlich zukünftiger Bibliotheken oder feste Auswahl.
- Owner-Einrichtung, Docker-Vorgaben, widerrufbare Sitzungen und nativer Desktop-Vertrauensweg gemäß Ausgangsentwurf.
- Persönliche Einstellungen pro Konto; Gäste speichern Darstellungsoptionen im Browser.
- Umsetzung beginnt mit einer verbindlichen Rechte- und Endpunktmatrix.

## 1. Kontomodell und Rechtebaum

Status: beschlossen; ersetzt die zuvor bestätigte Einteilung in Admins und Nutzer.

- Es gibt einen regulären Kontotyp: Nutzer.
- Rechte werden individuell pro Konto vergeben; keine unterschiedlichen Benutzergruppen oder feste Admin-Rolle.
- Der Rechteeditor gruppiert Rechte in einer Baumstruktur nach Bereichen und Unterbereichen.
- Ganze Bereiche können auf einen Schlag ausgewählt beziehungsweise abgewählt werden; einzelne Rechte bleiben gezielt einstellbar.
- Die Gruppierung vereinfacht die Vergabe. Sie ersetzt nicht die verbindliche Prüfung der einzelnen Rechte im Backend.

Aussage des Nutzers: „Es gibt nur Nutzer und man gibt diesen verschiedene Rechte welche wie ein Tree gruppiert sind, sodass man ganze Bereiche auf einen Schlag vergeben kann und es nicht unterschiedliche Benutzergruppen geben muss.“

### Besitzer

Status: beschlossen.

- Genau ein Nutzer ist als Besitzer gekennzeichnet; dies ist keine zusätzliche Benutzergruppe.
- Nur der Besitzer hat automatisch alle Rechte. Seine Rechte sind nicht änderbar; auch neu eingeführte Rechte stehen ihm automatisch zu.
- Alle anderen Nutzer erhalten ausschließlich ausdrücklich vergebene Rechte. Sie können sämtliche aktuell vergebbaren Rechte erhalten, haben aber keinen automatischen Vollzugriff und erhalten neue Rechte nicht automatisch.
- Andere Nutzer dürfen den Besitzer weder ändern, löschen, deaktivieren noch einschränken. Die eigenen Zugangsdaten kann der Besitzer gemäß Ausgangsentwurf ändern, soweit diese nicht durch Environment-Variablen gesperrt sind.
- Nur das Besitzerkonto kann über die Environment-Variablen MEDIALYZE_OWNER_USERNAME und MEDIALYZE_OWNER_PASSWORD eingerichtet beziehungsweise aktualisiert werden. Andere Konten können darüber nicht gesetzt werden.
- Die bereits beschriebenen Regeln für Environment-Abgleich, Feldsperren, Validierung und Sitzungswiderruf bleiben bestehen.

Bestätigung des Nutzers: „Ja es soll weiterhin genau einen Besitzer geben, dies ist auch der einzige welcher über die Environment variablen gesetzt werden kann. Außerdem ist er der einzige welche automatisch und nicht änderbar alle Rechte hat.“

### Nutzerverwaltung im neuen Modell

Status: Begrenzung der Rechtevergabe, Kontoverwaltung und Bibliotheksfreigaben sowie unabhängige Speicherung pro Konto beschlossen.

- Nutzerverwaltung ist ein ausdrücklich vergebbares Recht für angemeldete Nutzer; es gibt keine Admin-Gruppe.
- Ein Nutzer darf nur über Rechte verfügen beziehungsweise Rechte vergeben, die er selbst besitzt. Das Recht zur Nutzerverwaltung erlaubt keine Vergabe darüber hinausgehender Rechte.
- Auch bei Auswahl ganzer Bereiche im Rechtebaum gilt diese Grenze; sie muss serverseitig geprüft werden.
- Der Besitzer bleibt vor Änderungen durch andere Nutzer geschützt.
- Die bisher bestätigte Sperre der Nutzerverwaltung für Gäste bleibt bestehen.
- Konten mit mindestens einem Recht außerhalb der eigenen Berechtigungen dürfen nicht bearbeitet, deaktiviert, gelöscht oder per Passwortreset übernommen werden. Ein vermeintlich insgesamt geringerer Rechteumfang reicht nicht: Entscheidend ist, dass sämtliche Rechte des Zielkontos von den eigenen Rechten abgedeckt sind. Zusätzlich muss das jeweilige Verwaltungsrecht vorliegen.
- Ein Nutzer darf nur Bibliotheken weitergeben, auf die er selbst Zugriff hat. Konten mit darüber hinausgehenden Bibliotheksfreigaben darf er nicht verwalten.
- „Alle, auch zukünftige Bibliotheken“ darf nur vergeben werden, wenn der vergebende Nutzer selbst diese Freigabe hat. Eine feste Auswahl aller aktuell bestehenden Bibliotheken reicht dafür nicht.
- Rechte und Bibliotheksfreigaben werden unabhängig pro Konto gespeichert. Späterer Rechteentzug beim vergebenden Nutzer verändert keine bereits anderen Konten zugewiesenen Berechtigungen. Für weitere Vergaben und Kontoverwaltung gelten seine aktuellen Berechtigungen; es gibt keine automatische Entzugskaskade.

Bestätigung des Nutzers zur Reichweite der Verwaltung: „Dieser kann dann nur über Rechte verfügen welche er auch selber hat.“

Bestätigung des Nutzers zum Schutz weitergehend berechtigter Konten: „Ja“. Dadurch lässt sich die Vergabegrenze nicht über einen Passwortreset oder Änderungen an einem solchen Konto umgehen.

Bestätigung des Nutzers zur gleichen Grenze für Bibliotheksfreigaben einschließlich zukünftiger Bibliotheken: „Ja passt“.

Bestätigung des Nutzers zur unabhängigen Speicherung ohne automatische Entzugskaskade: „Ja klingt gut“.

### Auswahl ganzer Bereiche und nicht vergebbare Rechte

Status: beschlossen.

- Die Auswahl eines Bereichs vergibt dessen aktuell enthaltene Einzelrechte, soweit der vergebende Nutzer sie selbst vergeben darf.
- Später hinzugefügte Rechte bleiben für alle anderen Konten gesperrt, bis sie ausdrücklich vergeben werden. Ein ausgewählter Bereich ist keine dauerhafte Freigabe zukünftiger Rechte. Nur der Besitzer erhält neue Rechte automatisch.
- Rechte, die der vergebende Nutzer nicht selbst besitzt und deshalb nicht vergeben darf, bleiben im Baum sichtbar, sind aber ausgegraut und nicht auswählbar.
- Beim Darüberfahren erklärt ein Hinweis den Grund, zum Beispiel: „Du kannst dieses Recht nicht vergeben, weil du es selbst nicht besitzt.“ Der Hinweis muss entsprechend den ursprünglichen Anforderungen auch per Tastatur und auf Touch-Geräten erreichbar sein.
- Davon zu unterscheiden: Ein dem bearbeiteten Konto noch nicht zugewiesenes Recht bleibt auswählbar, sofern der vergebende Nutzer es selbst vergeben darf.

Bestätigung des Nutzers: „Ja, die nicht vergebenen Rechte auch innerhalb des Baums trotzdem anzeigen, aber ausgraben und beim govern darüber dann erklären warum man es nicht auswählen kann.“ Im Kontext als ausgegraute Anzeige mit Erklärung beim Darüberfahren verstanden.

## 2. Gemeinsame Einstellungen und Profile

### Qualitäts- und Hardwareprofile

Status: beschlossen.

- Qualitätsprofile und Hardwareprofile sind installationsweit gemeinsam, nicht auf einzelne Nutzer oder Bibliotheken begrenzt.
- Ansichts- und Bearbeitungsrechte werden im Rechtebaum für den jeweiligen gesamten Profilbereich vergeben, nicht pro einzelnem Profil und nicht je Bibliothek.
- Wer das entsprechende Bearbeitungsrecht besitzt, kann die gemeinsamen Profile installationsweit bearbeiten, auch bei begrenzter eigener Bibliotheksfreigabe.
- Der Editor weist auf die installationsweite Wirkung hin.
- Die allgemeine Vergabegrenze bleibt bestehen: Nur selbst vorhandene Rechte können weitergegeben werden.

Bestätigung des Nutzers: „Ja, die qualitäts/Hardware Profile sind übergreifend und die Rechte für die werden da komplett vergeben.“

### Weitere gemeinsame Konfigurationen

Status: beschlossen.

- Das gleiche Modell gilt für Transcoding-Presets, Connectoren und globale App-Einstellungen: jeweils eigene Ansichts- und Bearbeitungsrechte im Rechtebaum, installationsweit und unabhängig von Bibliotheksfreigaben.
- Die Rechte gelten für den jeweiligen gesamten Konfigurationsbereich. Der Editor erklärt die installationsweite Wirkung.
- Persönliche Einstellungen wie Sprache, Theme und Layouts bleiben unabhängig davon.

Bestätigung des Nutzers: „Ja“.

## 3. Bibliotheksanlage und Pfadänderungen

### Eigene Bibliotheksanlage

Status: beschlossen.

- Ein angemeldeter Nutzer mit dem Recht zur Bibliotheksanlage erhält eine selbst neu angelegte Bibliothek automatisch in seiner festen Bibliotheksauswahl.
- Bei „Alle, auch zukünftige“ ist dieser Zugriff ohnehin enthalten.
- Die Aufnahme ändert keine anderen Funktionsrechte und erweitert keine festen Auswahlen anderer Nutzer oder des Gastprofils. Bestehende Freigaben „Alle, auch zukünftige“ gelten weiterhin auch für diese Bibliothek.

Bestätigung des Nutzers: „Ja“.

### Änderungen an Roots und Pfaden

Status: beschlossen.

- Eigenes Recht „Bibliothekspfade verwalten“ für das Hinzufügen, Ändern und Entfernen von Roots/Pfaden bestehender Bibliotheken.
- Das normale Bearbeitungsrecht für beispielsweise Name und Scanoptionen erlaubt allein keine Pfadänderungen.
- Bibliotheksfreigaben und serverseitige Pfadgrenzen gelten weiterhin.
- Hintergrund: Ein geänderter Bibliothekspfad kann eine bestehende Freigabe auf andere Serverinhalte ausweiten.

Bestätigung des Nutzers: „Ja“.

### Pfadauswahl und Dateisystem-Browsing

Status: beschlossen.

- Kein separates Recht „Medienordner durchsuchen“. Der Pfadbrowser wird im Rahmen des jeweils erlaubten Vorgangs verwendet: beim Anlegen über „Bibliotheken anlegen“, bei Änderungen bestehender Bibliotheken über „Bibliothekspfade verwalten“.
- „Bibliothekspfade verwalten“ erlaubt Ordnerauswahl/Dateisystem-Browsing sowie das Hinzufügen, Ändern und Entfernen von Roots/Pfaden bestehender Bibliotheken.
- Bibliotheksfreigaben gelten weiterhin für Änderungen an bestehenden Bibliotheken. Serverseitige Pfadgrenzen (insbesondere MEDIA_ROOT im Serverbetrieb) werden nicht erweitert.
- Der Editor erklärt, dass der Pfadbrowser auch Ordnernamen außerhalb bereits freigegebener Bibliotheken zeigen kann.

Entscheidung des Nutzers zum vorgeschlagenen separaten Browsing-Recht: „Dass kann mir zu dem Recht die Pfade zu ändern dazu gezählt werden“.

### Frühere Entscheidung: unabhängige Rechte auf derselben Ebene

Status: hinsichtlich der Unabhängigkeit durch die neue Voraussetzung in Abschnitt 14 ersetzt. Die Rechte bleiben getrennte Einträge; „Bibliotheken anlegen“ setzt nun Bearbeitungs- und Pfadrechte voraus.

- „Bibliotheken anlegen“ und „Bibliothekspfade verwalten“ stehen auf derselben Ebene im Rechtebaum und sind unabhängig vergebbar.
- „Bibliotheken anlegen“ setzt „Bibliothekspfade verwalten“ nicht voraus; keine automatische Mitvergabe oder API-Abhängigkeit zwischen diesen Rechten.
- „Bibliotheken anlegen“ umfasst die erstmalige Ordnerauswahl beim Anlegen. Dafür ist „Bibliothekspfade verwalten“ nicht erforderlich. Änderungen an Roots/Pfaden bestehender Bibliotheken benötigen dagegen das Pfadverwaltungsrecht.

Entscheidung des Nutzers zur vorgeschlagenen Abhängigkeit: „Nein, kann im Baum auf der selben Ebene sein“.

Bestätigung des Nutzers zur Abgrenzung einschließlich Ordnerauswahl beim Anlegen: „Ja“. Die serverseitigen Pfadgrenzen gelten in beiden Fällen.

Gast-Bibliotheksanlage und der native Desktop-Picker müssen im späteren Vertrag ebenfalls ausdrücklich eingeordnet werden.

## 4. Sensible Informationen

### Wiedergabedaten unter Connectoren

Status: beschlossen.

- Eigenes Recht „Wiedergabedaten ansehen“ unter dem Bereich „Connectoren“ im Rechtebaum.
- Es schützt persönliche Wiedergabeverläufe aus Connectoren sowie daraus abgeleitete Wiedergabezahlen, Filter, Sortierungen und Statistiken, unabhängig davon, auf welcher Seite diese angezeigt werden.
- Ohne dieses Recht werden Wiedergabedaten serverseitig ausgeschlossen. Technische Mediendaten bleiben gemäß den übrigen Berechtigungen sichtbar.
- Bibliotheksfreigaben gelten zusätzlich. Das Leserecht erteilt keine Bearbeitungsrechte für Connector-Konfigurationen.

Entscheidung des Nutzers zum vorgeschlagenen Recht: „Unter connectoren kann das als extra recht aufgeführt werden“.

### Absolute Serverpfade

Status: beschlossen; separates Leserecht verworfen.

- In V1 gibt es kein eigenes Recht „Absolute Serverpfade ansehen“.
- Absolute Pfade werden über das jeweilige Ansichtsrecht des betreffenden Bereichs zugänglich, soweit sie dort angezeigt werden. Bibliotheksfreigaben gelten weiterhin.
- Die im Ausgangsentwurf vorgesehene separate Berechtigung für absolute Pfade entfällt.

Entscheidung des Nutzers: „Nein, braucht es nicht.“

### Granularität in V1

Status: beschlossen als allgemeine Leitlinie.

- Zusammengehörige Funktionen dürfen in V1 unter gemeinsamen Rechten zusammengefasst werden. Nicht für jede Information oder Aktion ist ein separates Recht erforderlich.
- Die Rechteprüfung muss zentral und anhand stabiler Berechtigungskennungen erfolgen, sodass gemeinsame Rechte später in feinere Einzelrechte aufgeteilt werden können.
- Bei späterer Aufteilung muss die Migration bestehender Freigaben ausdrücklich geregelt werden; daraus folgt keine automatische Vergabe neuer Rechte.
- Bereits bestätigte Grenzen (Besitzer-Schutz, begrenzte Rechtevergabe, Bibliotheksgrenzen, Schutz weitergehend berechtigter Konten) bleiben verbindlich. Bereits bestätigte Einzelrechte werden dadurch nicht pauschal aufgehoben.

Aussage des Nutzers: „Generell kann bei der ersten implementation bei ein paar Stellen etwas zusammen gefasst werden solange man das später alles gut verfeinern kann.“

### Technische Rohdaten und Diagnosen

Status: beschlossen.

- Technische Rohdaten einer freigegebenen Datei und Diagnosedetails eines sichtbaren Jobs fallen in V1 unter das jeweilige Datei-/Job-Ansichtsrecht; kein zusätzliches Diagnose-Leserecht.
- Zugangsdaten und Sitzungstoken bleiben unabhängig davon geschützt; Bibliotheksgrenzen gelten unverändert.
- Globale Betriebsdiagnosen werden dadurch nicht automatisch über ein Datei-Ansichtsrecht freigegeben.

Bestätigung des Nutzers: „Ja“.

## 5. Browser- und Desktop-Zugriff

Status: technische Ausarbeitung auf Grundlage des Ausgangsentwurfs noch ausstehend.

Die bereits vorgesehenen Sitzungs-, CSRF-, Origin- und Desktop-Schutzmechanismen bleiben technische Anforderungen. Sie benötigen keine zusätzlichen Rechte oder Sicherheitsoptionen im Rechtebaum. Konkrete Umsetzung und Tests sind im späteren Implementierungsplan zu spezifizieren.

## 6. Jobs und Auslöser

### Kontolöschung und bereits laufende Jobs

Status: beschlossen.

- Bereits laufende Jobs laufen bei Deaktivierung oder Löschung ihres auslösenden Kontos fertig.
- Noch wartende Jobs dieses Nutzers werden abgebrochen. In den Jobdetails wird eine verständliche Begründung angezeigt, beispielsweise „Abgebrochen, weil das auslösende Konto deaktiviert wurde“ beziehungsweise „… gelöscht wurde“.
- Andere entsprechend berechtigte Nutzer dürfen laufende Jobs weiterhin abbrechen.
- Die Herkunft bleibt als Nutzerjob erkennbar, auch nach Kontolöschung; keine Umwandlung in Systemarbeit.
- Die im Ausgangsentwurf vorgesehene erneute Rechteprüfung vor Ausführung wartender Jobs und das Weiterlaufen bereits gestarteter Jobs bei Rechteentzug bleiben bestehen.

Bestätigung nach Rückfrage zur Unterscheidung laufend/wartend: „Ja“.

### Systemjobs

Status: beschlossen.

- Automatisch durch bestehende Zeitpläne, Watchdog oder Wartung ausgelöste Jobs laufen als Systemjobs unabhängig von Nutzerkonten weiter.
- Wird das Konto gelöscht oder deaktiviert, das einen Zeitplan eingerichtet hat, bleibt der Zeitplan aktiv.
- Bereits manuell gestartete Nutzerjobs werden dadurch nicht zu Systemjobs.
- Berechtigte Nutzer dürfen automatische Arbeit weiterhin über die dafür vorgesehenen Verwaltungsrechte ändern oder abschalten.

Bestätigung des Nutzers: „Ja klingt gut“.

## 7. Sitzungsdauer und technische Sicherheitsparameter

### Inaktivitätslimit

Status: beschlossen.

Ausgangsentwurf: 24 Stunden Inaktivitätslimit und maximal sieben Tage Sitzungsdauer.

V1-Regel: Inaktivität wird anhand authentifizierter Anfragen bestimmt. Automatische Statusabfragen zählen als Aktivität; ein geöffneter Tab mit laufendem Polling kann die Anmeldung deshalb bis zum absoluten Sieben-Tage-Limit erhalten. Nach 24 Stunden ohne solche Anfragen oder spätestens sieben Tagen nach Anmeldung ist eine neue Anmeldung nötig. Beide Grenzen werden serverseitig geprüft. Keine zusätzliche Erfassung von Mausbewegungen oder Tastatureingaben in V1.

Bestätigung des Nutzers nach Einordnung als Komfortentscheidung: „Ja gerne“. Weitere technische Parameter sind im späteren Implementierungsplan konkret festzulegen; sie benötigen keine zusätzlichen Rechte im Baum.

### Einordnung der Sitzungsempfehlung

Auf Nachfrage am 19.10.2026 anhand der aktuellen OWASP Session Management Cheat Sheet geprüft:

- Serverseitig durchgesetzte Inaktivitäts- und absolute Zeitlimits sind empfohlen. OWASP beschreibt Inaktivität anhand der letzten HTTP-Anfrage; das unterstützt die vorgeschlagene anfragebasierte Umsetzung. Polling zählt in unserem Vorschlag ausdrücklich mit und ist kein Nachweis tatsächlicher Bedienung.
- Die Werte 24 Stunden Inaktivität und sieben Tage absolut sind keine allgemeine OWASP-Empfehlung. OWASP nennt als typische Inaktivitätswerte 15–30 Minuten für risikoarme Anwendungen und 2–5 Minuten für besonders schutzbedürftige Anwendungen. Als Beispiel für ganztägige Büroanwendungen nennt OWASP 4–8 Stunden absolute Sitzungsdauer; die Werte sind an Nutzung und Risiko anzupassen.
- Empfehlung für diesen Entwurf: 24 Stunden / sieben Tage als bewusst komfortorientierte V1-Produktentscheidung beibehalten, nicht als strengen Sicherheitsstandard darstellen. Ein offen gelassener Browser kann entsprechend lange angemeldet bleiben.
- Nach der Nachfrage zur üblichen Empfehlung und der obigen Einordnung hat der Nutzer die Werte und das Verfahren mit „Ja gerne“ bestätigt.

Quelle: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#session-expiration

## 8. Gastprofil – Standard und Konfigurierbarkeit

Status: lesender Standard, konfigurierbare Rechte und anfänglich deaktivierter Gastzugriff beschlossen.

- Das Gastprofil ist standardmäßig rein lesend ausgelegt.
- Gäste dürfen standardmäßig keine Bibliotheken anlegen oder bearbeiten, Profile ändern oder vergleichbare schreibende Verwaltungsaktionen ausführen.
- Diese Einschränkungen sind Standardwerte, keine dauerhaft festgelegte Gastrolle: Die einzelnen Gastrechte können gezielt geändert und um Schreibrechte erweitert werden.
- Die zuvor ausdrücklich bestätigte Ausnahme bleibt bestehen: Nutzerverwaltung und Rechtevergabe bleiben angemeldeten entsprechend berechtigten Nutzern vorbehalten; der Besitzer bleibt geschützt.
- Aus der Konfigurierbarkeit folgt keine pauschale Freigabe aller Lesebereiche oder Bibliotheken. Der konkrete Leseumfang ist noch festzulegen.

Aussage des Nutzers: „Nein, Gäste sollen standardmäßig keine Bibliothek bearbeiten, anlegen, Profile ändernd usw. Können. Sie sind standardmäßig rein ‚lesend‘ ausgelegt, können aber beliebig verändert werden, also deren Rechte.“

### Aktivierung des Gastzugriffs

Status: beschlossen.

- Gastzugriff ist standardmäßig deaktiviert; unauthentifizierte Besucher sehen zunächst die Anmeldung.
- Bei ausdrücklicher Aktivierung startet das Gastprofil mit rein lesenden Standardrechten.
- Ein später hinzukommender Einrichtungsworkflow soll bei der ersten Einrichtung ausdrücklich abfragen, ob Gastzugriff aktiviert werden soll. Ohne ausdrückliche Aktivierung bleibt er deaktiviert.
- Der Einrichtungsworkflow ist eine zukünftige Ergänzung, keine zusätzliche V1-Implementierungsanforderung dieses Beschlusses.

Bestätigung des Nutzers: „Ja, standardmäßig deaktiviert. Soll bei einem später dazukommenden Einrichtungs Workflow beim ersten einrichten dann gleich mit abgefragt werden, ob man ihn aktivieren möchte.“

### Standardmäßige Bibliotheksfreigabe für Gäste

Status: beschlossen.

- Auch nach Aktivierung startet das Gastprofil ohne freigegebene Bibliotheken.
- Eine berechtigte Person muss ausdrücklich einzelne Bibliotheken oder „Alle, auch zukünftige“ freigeben.
- Rein lesende Funktionsrechte allein veröffentlichen keine Bibliothek.

Bestätigung des Nutzers: „Ja“.

### Umfang des rein lesenden Gaststandards

Status: beschlossen.

- Der lesende Standard erlaubt technische Metadaten, Statistiken und technische Datei-/Bibliothekshistorie innerhalb ausdrücklich freigegebener Bibliotheken.
- Vorschau, Mediendownload und Export bleiben standardmäßig ausgeschaltet und können gezielt aktiviert werden.
- Wiedergabedaten aus Connectoren bleiben gemäß dem bereits beschlossenen separaten Recht gesondert geschützt.
- Daraus folgt keine zusätzliche standardmäßige Freigabe von Joblisten oder gemeinsamen Konfigurationen; deren Standardumfang ist noch zu konkretisieren.

Bestätigung des Nutzers: „Ja“.

### Bibliotheksanlage bei ausdrücklich erweitertem Gastprofil

Status: beschlossen.

- Das Anlegerecht ist für Gäste standardmäßig ausgeschaltet, kann aber ausdrücklich aktiviert werden.
- Ist die Gastfreigabe auf „Alle, auch zukünftige“ gestellt, umfasst sie auch neu durch Gäste angelegte Bibliotheken.
- Bei fester Gast-Auswahl wird eine neu angelegte Bibliothek nicht automatisch hinzugefügt; ihre Freigabe muss ausdrücklich erfolgen.
- Dies ist eine Ausnahme zur automatischen eigenen Freigabe für angemeldete Nutzer, die Bibliotheken anlegen. Gäste teilen ein gemeinsames Profil und erhalten keine persönliche Erstellerfreigabe.
- Feste Freigaben anderer Nutzer bleiben unverändert; deren Freigabe „Alle, auch zukünftige“ umfasst die neue Bibliothek weiterhin.

Entscheidung des Nutzers: „Wenn ‚Alle, auch zukünftige‘ oder ähnliches wording ausgewählt ja.“

## 9. Persönliche Einstellungen und Layouts

### Eigene Layouts und Ausgangslayout

Status: beschlossen; ersetzt die optionale Übernahme bestehender Browserlayouts aus dem Ausgangsentwurf.

- Jeder Nutzer hat eigene Layouts.
- Neue Nutzer starten mit dem Standardlayout; keine Übernahme vorhandener Browserlayouts und kein entsprechendes Übernahmeangebot.
- Layoutänderungen werden im jeweiligen Nutzerkonto gespeichert und geräteübergreifend synchronisiert, wie im Ausgangsentwurf vorgesehen.
- Layouts anderer Nutzer und bestehende Gast-/Browserlayouts werden nicht als Ausgangslayout übernommen.
- Bereits gespeicherte persönliche Layouts werden beim Login wieder geladen, nicht bei jeder Anmeldung auf Standard zurückgesetzt.
- Die neue Entscheidung betrifft Layouts; bestehende Regeln für Sprache, Theme und Passwortänderung bleiben davon unberührt.

Entscheidung des Nutzers: „Jeder nutzer hat seine eigenen Layouts und starten beim Standartmäßigen Layout.“

## 10. Sitzungsablauf und Anmeldung

Status: beschlossen.

- Läuft eine Sitzung ab, werden geladene Kontodaten und kontobezogene Caches geleert; laufende Anfragen werden abgebrochen beziehungsweise verspätete Antworten verworfen, wie im Ausgangsentwurf für Identitätswechsel vorgesehen.
- Die Oberfläche zeigt den Anmeldebereich. Kein automatischer Wechsel in den Gastmodus.
- Der Anmeldebereich bietet auch nach Sitzungsablauf wie sonst die Option „Als Gast fortfahren“, sofern Gastzugriff aktiviert ist.
- Der Wechsel in den Gastmodus erfolgt ausdrücklich und lädt ausschließlich die für das Gastprofil freigegebenen Daten und Funktionen.
- Bei deaktiviertem Gastzugriff wird kein Gastwechsel angeboten.

Bestätigung des Nutzers: „Ja, zusammen mit der Option in den Gästemodus zu gehen wie sonst auch immer beim Anmeldebereich.“

## 11. Administrativer Passwortreset

Status: beschlossen.

- Ein zur Verwaltung des Zielkontos berechtigter Nutzer setzt ein vorläufiges Passwort.
- Beim nächsten Login muss der betroffene Nutzer ein eigenes Passwort vergeben, bevor er die regulären Funktionen nutzen kann.
- Die bereits beschlossenen Grenzen für Kontoverwaltung gelten auch hier: nur entsprechend berechtigte Konten verwalten, kein Zugriff auf weitergehend berechtigte Konten und kein Reset des Besitzers durch andere Nutzer.
- Ein Passwortreset widerruft vorhandene Sitzungen des Zielkontos, wie im Ausgangsentwurf vorgesehen.
- Passwörter erscheinen weder in Logs noch in API-Antworten. Das vorläufige Passwort wird vom verwaltenden Nutzer eingegeben; kein automatischer Passwortversand in V1.

Bestätigung des Nutzers zum vorläufigen Passwort mit erzwungener Änderung beim nächsten Login: „Ja“.

### Erstmalige Kontoanlage

Status: beschlossen.

- Bei administrativ neu angelegten Nutzerkonten wird ebenfalls ein vorläufiges Passwort vergeben.
- Beim ersten Login muss der neue Nutzer ein eigenes Passwort setzen, bevor reguläre Funktionen zugänglich sind.
- Besitzer-Einrichtung und Environment-Vorgaben bleiben separat geregelt; das Besitzerkonto wird nicht wie ein normales Konto durch andere Nutzer angelegt oder zurückgesetzt.

Bestätigung des Nutzers: „Ja“.

## 12. Konkreter Rechtebaum – V1-Entwurf zur gemeinsamen Prüfung

Status: Alle vorgeschlagenen Bereiche einschließlich Bibliotheken & Dateien bestätigt. Die zusätzliche bibliotheksbezogene Baumdarstellung ist in Abschnitt 13 festgehalten. Bereits beschlossene Einzelregeln bleiben maßgeblich.

- Übersicht: Gemeinsamer Bereich mit drei einzeln vergebbaren Unterrechten: Dashboard einschließlich technischer Statistiken/Historie ansehen; Dateivergleich nutzen; Storage Map nutzen. Die Auswahl des übergeordneten Eintrags wählt alle drei gemeinsam aus, soweit die vergebende Person sie vergeben darf. Bestätigt am 20.10.2026 mit „ja“.
- Bibliotheken und Dateien: Metadaten einschließlich Rohdaten und technischer Historie ansehen; Vorschau; Download; Export; Scans starten/abbrechen (in V1 zusammengefasst); Bibliotheken anlegen; Bibliotheken bearbeiten; Bibliothekspfade verwalten; Bibliotheken löschen. Anlegen und Pfadverwaltung sind getrennte Einträge mit jeweils passender Ordnerauswahl. Neuere Entscheidung aus Abschnitt 14: Anlegen setzt Bearbeitungs- und Pfadrechte voraus, nicht das Löschrecht.
- Transcoding: Jobs ansehen; Pläne erstellen und Jobs starten (in V1 zusammengefasst); eigene Jobs abbrechen; fremde einschließlich Systemjobs abbrechen; sichtbare Jobhistorie bereinigen; Originaldateien ersetzen (separat). Details der jeweiligen Ansichtsabhängigkeiten werden in der Matrix festgelegt.
- Einstellungen: pro gemeinsamem Konfigurationsbereich eigene Ansichts-/Bearbeitungsrechte; insbesondere Qualitätsprofile, Hardwareprofile, Transcoding-Presets und globale App-Einstellungen. Persönliche Einstellungen bleiben für jeden angemeldeten Nutzer zugänglich.
- Connectoren: Konfiguration ansehen; Konfiguration und Synchronisierung verwalten (V1-Bündelung); Wiedergabedaten ansehen (separat).
- Nutzer und Zugriffe: Konten und Rechte verwalten (V1-Bündelung mit allen bereits beschlossenen Vergabe- und Zielkontogrenzen); Gastprofil verwalten (eigener Unterpunkt, nur für angemeldete Nutzer, innerhalb der eigenen vergebbaren Rechte und Bibliotheksfreigaben). Der Besitzer bleibt geschützt.

Für bibliotheksbezogene Funktionen gilt das in Abschnitt 13 bestätigte Modell: Rechte je Bibliothek oder ein gemeinsamer Baum für aktuelle beziehungsweise aktuelle und zukünftige Bibliotheken. Gemeinsame Konfigurationsrechte wirken dagegen installationsweit. Die Platzierung eines Rechts im Baum gewährt allein keine API-Freigabe.

Bestätigung des Nutzers: „Vergleich & storage map zusammen mit Dashboard unter ‚Übersicht‘. Transcoding finde ich gut so. Einstellungen auch gut so. Connectoren auch gut so. Nutzer & Zugriffe auch gut so.“

Bestätigung des Nutzers zu Bibliotheken & Dateien: „sieht gut aus“, ergänzt um die drei Darstellungs-/Geltungsmodi aus Abschnitt 13. Anschließend vollständige Route-/Methodenmatrix aus dem aktuellen Code ableiten; diese Skizze ist keine abgeschlossene Endpunktprüfung.

## 13. Bibliotheksbezogener Rechtebaum mit Modusauswahl

Status: Dropdown, Darstellungsmodi und unterschiedliche Funktionsrechte je Bibliothek bestätigt.

- Im Rechteeditor gibt es ein Dropdown mit „Per library“, „All libraries“ und „All and future libraries“ (endgültige lokalisierte UI-Bezeichnungen später festlegen).
- „Per library“: eigener Unterbaum pro Bibliothek.
- „All libraries“: ein gemeinsamer Rechtebaum für alle aktuell bestehenden Bibliotheken, ohne automatische Freigabe später neu angelegter Bibliotheken.
- „All and future libraries“: ein gemeinsamer Rechtebaum für alle bestehenden und später neu angelegten Bibliotheken.
- Die bereits bestätigte installationsweite Reichweite von Qualitäts-/Hardwareprofilen, Presets, Connectoren und globalen App-Einstellungen bleibt bestehen; diese Konfigurationsrechte werden nicht pro Bibliothek vervielfacht.
- Die bestätigten Vergabegrenzen gelten weiterhin: Nur eigene Rechte und eigene Bibliothekszugriffe dürfen weitergegeben werden; „All and future libraries“ erfordert diese Reichweite auch beim vergebenden Nutzer.
- Bei „All libraries“ darf der Modus keine Bibliotheken außerhalb der eigenen vergebbaren Zugriffe freigeben. Wie der Editor einen solchen nicht vergebbaren Modus kennzeichnet, folgt dem beschlossenen Sichtbar-/Ausgegraut-/Erklärungsmuster.

Aussage des Nutzers: „sieht gut aus, im Baum dann noch ein dropdown anzeigen mit dem man ‚per library‘, ‚all libraries‘, ‚all and future libraries‘ auswählt, entsprechend sieht man dann einen Baum der für alles gilt oder einen Unterbaum für jeden Library“.

### Unterschiedliche Funktionsrechte je Bibliothek

Status: beschlossen.

„Per library“ erlaubt unterschiedliche Funktionsrechte je Bibliothek, zum Beispiel Bibliothek A nur ansehen, Bibliothek B ansehen und Scans starten. Dies ersetzt für bibliotheksbezogene Funktionen das frühere Modell globaler Funktionsrechte plus reiner Bibliotheksauswahl. Persistenz, effektive Rechte und die Vergabe-/Kontoverwaltungsgrenzen müssen entsprechend auf Kombinationen aus Bibliothek und Aktion ausgelegt werden. Ein Recht in Bibliothek A erlaubt nicht dessen Vergabe für Bibliothek B.

Bestätigung des Nutzers: „ja“.

Die Darstellung ist damit vorgegeben; Regeln für verlustbehaftete Moduswechsel und Rechte ohne vorhandene Zielbibliothek (insbesondere Bibliotheksanlage) sind vor Umsetzung noch konkret auszuarbeiten.

### Wechsel von Einzelrechten zum gemeinsamen Baum

Status: beschlossen.

- Beim Wechsel von „Per library“ zu einem gemeinsamen Baum werden nur Rechte vorausgewählt, die in allen vom Zielmodus umfassten bestehenden Bibliotheken bereits gelten (Schnittmenge).
- Bibliotheken ohne Freigabe gehen mit einer leeren Rechtemenge in diese Schnittmenge ein.
- Weitergehende gemeinsame Rechte müssen ausdrücklich ausgewählt werden; keine automatische Vereinigung unterschiedlicher Freigaben.
- Beim Wechsel zu „All and future libraries“ wird die zusätzliche Reichweite auf zukünftige Bibliotheken ausdrücklich angezeigt.
- Beim Speichern gelten weiterhin die Vergabegrenzen.

Bestätigung des Nutzers: „ja“.

### Technisch noch auszuarbeiten

- Vollständige Route-/Methodenmatrix für die beschlossenen Rechte einschließlich Legacy- und Maschinenendpunkten, Medienantworten und Exporten.
- Behandlung von Rechten ohne vorhandene Zielbibliothek, insbesondere Bibliotheksanlage, im Modell mit bibliotheksbezogenen Bäumen.
- Verlustfreier Wechsel vom gemeinsamen Baum zu Einzelbäumen und genaue Migration beim späteren Aufteilen bestehender Rechte.
- Konkrete Persistenz, Abhängigkeiten und Cache-/Aggregatkontexte für Kombinationen aus Bibliothek und Aktion.

Diese Punkte sind noch keine implementierte oder vollständig geprüfte Zugriffspolitik. Änderungen am Projekt bleiben außerhalb dieses Dokumentationsauftrags.


## 14. Weitere Sonderfälle – schrittweise Prüfung

### Voraussetzungen für „Bibliotheken anlegen“

Status: Voraussetzungen und Beschränkung auf „All and future libraries“ beschlossen.

- „Bibliotheken anlegen“ ist nur auswählbar, wenn alle benötigten Bibliotheks-Bearbeitungs- und Pfadrechte bereits aktiv sind.
- Das Recht „Bibliotheken löschen“ ist ausdrücklich keine Voraussetzung.
- Die frühere Entscheidung, Anlegen und Pfadverwaltung unabhängig vergeben zu können, ist damit ersetzt. Getrennte Einträge im Baum bleiben möglich; zwischen ihnen besteht nun eine Voraussetzung.
- Die API muss dieselben Voraussetzungen prüfen wie der Editor. Nicht auswählbare Rechte bleiben gemäß der bisherigen Entscheidung sichtbar und erklären den Grund.
- Gemeint sind Bearbeitungs-/Pfadrechte; Vorschau, Download, Export oder Transcoding-Rechte werden durch diese Vorgabe nicht automatisch zu Voraussetzungen erklärt.

Aussage des Nutzers: „‚Bibliotheken anlegen‘ soll nur auswählbar sein wenn alle anderen Rechte zur bearbeitung und Pfaden bei Bilbiotheken schonn aktiv sind, einziges was nicht nötig ist für dieses Recht ist das löschen von Bibliotheken, das löst das Problem denke ich oder?“

### Reichweite der Voraussetzungen

Status: beschlossen.

- „Bibliotheken anlegen“ ist nur im Modus „All and future libraries“ auswählbar, wenn im gemeinsamen Baum die benötigten Bearbeitungs- und Pfadrechte aktiv sind.
- Im Modus „Per library“ oder „All libraries“ kann das Anlegerecht nicht aktiviert werden. Die gesperrte Auswahl erklärt die fehlende Voraussetzung.
- Durch den gemeinsamen Baum gelten die vorhandenen Rechte auch für die neu angelegte Bibliothek; ein separater Ersteller-Rechtebaum ist nicht erforderlich.
- Das Löschrecht bleibt optional.
- Die zuvor vorgesehene automatische Aufnahme selbst angelegter Bibliotheken in eine feste Auswahl angemeldeter Nutzer wird damit für V1 gegenstandslos: Mit fester Auswahl ist Anlegen nicht verfügbar. Der ältere Beschluss bleibt nur als Verlauf dokumentiert.
- Für ein ausdrücklich um das Anlegerecht erweitertes Gastprofil gilt dieselbe Modusvoraussetzung. Der Gaststandard bleibt unverändert: deaktiviert, nach Aktivierung rein lesend und zunächst ohne Bibliotheksfreigaben.

Bestätigung des Nutzers zur Beschränkung auf „All and future libraries“ mit erforderlichen Bearbeitungs-/Pfadrechten: „ja klingt sinnvoll“.

### Wegfall einer Voraussetzung

Status: beschlossen.

- Wird der Modus von „All and future libraries“ auf einen anderen Modus geändert oder eine erforderliche Bearbeitungs-/Pfadberechtigung entfernt, wird „Bibliotheken anlegen“ im Editor ebenfalls ausgeschaltet.
- Die Oberfläche erklärt die Folge vor dem Speichern.
- Die API lehnt widersprüchliche Zustände ab; vor jeder tatsächlichen Bibliotheksanlage werden die aktuellen Voraussetzungen erneut geprüft.

Bestätigung des Nutzers zum automatischen Ausschalten: „ja“.

### Wechsel vom gemeinsamen Baum zu „Per library“

Status: beschlossen.

- Beim Wechsel von „All libraries“ oder „All and future libraries“ zu „Per library“ werden die bisherigen gemeinsamen Rechte in die Einzelbäume aller aktuell davon erfassten Bibliotheken übernommen.
- Dadurch ändert sich der Zugriff auf diese bestehenden Bibliotheken zunächst nicht; anschließend können die Rechte einzeln angepasst werden.
- Eine bisherige Freigabe zukünftiger Bibliotheken entfällt. Das Anlegerecht entfällt ebenfalls, sofern es aktiv war, gemäß der oben bestätigten Voraussetzung.
- Der Editor zeigt diese Auswirkungen vor dem Speichern an. Die allgemeinen Vergabegrenzen gelten weiterhin.

Bestätigung des Nutzers zum Übernehmen der bestehenden Freigaben in Einzelbäume und Entfallen von Zukunftsfreigabe/Anlegerecht: „ja“.

### Globale Sammelaktionen bei unterschiedlichen Bibliotheksrechten

Status: beschlossen.

Eine Sammelaktion wie „Alle Scans abbrechen“ betrifft nur Jobs in Bibliotheken, für die der anfragende Nutzer das entsprechende Scanrecht besitzt. Scans anderer Bibliotheken laufen unverändert weiter. Anzeige und Ergebnis der Aktion dürfen keine verborgenen Bibliotheken oder Jobs offenlegen. Dies wird serverseitig auf die aktuelle Identität und ihre effektiven Rechte begrenzt; eine globale Schaltfläche hebt Bibliotheksgrenzen nicht auf.

Bestätigung des Nutzers zur begrenzten Reichweite von Sammelaktionen: „ja“.

### Stand nach der Prüfung weiterer Sonderfälle

Die zusätzlich besprochenen Entscheidungen sind bestätigt: Voraussetzungen und Modus für Bibliotheksanlage, Entzug abhängiger Anlegerechte, Wechsel zwischen gemeinsamen und einzelnen Bibliotheksbäumen sowie Begrenzung globaler Sammelaktionen.

Vor der Implementierung technisch auszuarbeiten: vollständige Endpunktmatrix, Voraussetzungen jedes Rechts, bibliotheksbezogene SQL-Abfragen und Cachekontexte, Schutz von Legacy-/Maschinenzugängen und Medienantworten sowie passende Negativtests. Das Repository wurde im Rahmen dieser Dokumentation nicht geändert.
