# MediaLyze: Performance-Report vom 01.10.2026

[Documentation home](../README.md)

Die ausgewählten Verbesserungen in den zehn Bereichen des [Arbeitsplans](../performance-plan.md) sind umgesetzt und geprüft; die bewusst zurückgestellten Erweiterungen sind unten benannt. Die größten gemessenen Gewinne betreffen Vergleichsdiagramme, Speicherverbrauch und unnötige Hintergrundabfragen. Zum Zeitpunkt der Messung lagen die Änderungen lokal und bereits vorhandene Änderungen wurden beibehalten. Der Bericht beschreibt den Stand vom 2026-10-01; er trifft keine Aussage zum heutigen Commit-, Veröffentlichungs- oder Teststatus.

## Messverfahren

Verglichen wurde der Arbeitsstand zu Beginn dieser Performance-Umsetzung mit dem fertigen Stand. Die bereits vorhandenen Scan-Verbesserungen zu [Issue #184](issue-184-followup.md) gehören zur Baseline; ihre früheren Ergebnisse werden hier nicht erneut als Gewinne dieser Änderungen gezählt. Basis-Commit: `e5e7661e1104a53f901fcdf15532921edc19e207` plus damalige lokale Änderungen; [Quelldatei-Hashes](results/performance-2026-10-01/source-sha256.json) dokumentieren die beiden Stände.

Die Service-Messungen verwenden 100.000 synthetische Dateien, die produktiven SQLite-Indizes und WAL/NORMAL. Pro Zeitmessung wurden drei Wiederholungen nacheinander auf demselben macOS-arm64-System ausgeführt, ohne parallel laufende Tests oder Builds. Enthalten ist die JSON-Serialisierung, nicht HTTP-Übertragung oder Browser-Rendering. Ein Cache-Miss leert den Anwendungscache, nicht den Betriebssystemcache. Python 3.12.13, SQLite 3.51.2. Der zusätzliche Speicherlauf nutzt `tracemalloc` und misst Python-Allokationen außerhalb der Fixture-Erzeugung; diese Werte sind weder Prozess-RSS noch Container-RAM.

## Gemessene Ergebnisse

| Aufgabe | Vorher | Nachher | Veränderung |
| --- | ---: | ---: | ---: |
| Transcoding-Historie, 200 Jobs | 40,71 ms | 17,30 ms | 57,5 % kürzer |
| Spitzenallokation dieser Historie | 26,150 MiB | 2,071 MiB | 92,1 % weniger |
| Numerische Heatmap, 100.000 Dateien, Cache-Miss | 1.048,60 ms | 96,99 ms | 90,8 % kürzer |
| Spitzenallokation Heatmap | 57,548 MiB | 0,122 MiB | 99,8 % weniger |
| Numerischer Scatter, 100.000 Dateien, Cache-Miss | 1.203,06 ms | 229,30 ms | 80,9 % kürzer |
| Spitzenallokation Scatter | 97,971 MiB | 5,066 MiB | 94,8 % weniger |
| Storage Map, Wurzel, Cache-Miss | 3.102,38 ms | 2.401,59 ms | 22,6 % kürzer |
| Spitzenallokation Storage Map | 120,214 MiB | 25,375 MiB | 78,9 % weniger |
| Breiter technischer Statistikabruf, Cache-Miss | 2.446,22 ms | 2.428,04 ms | praktisch unverändert |
| Dieselbe Statistik nach Connector-Änderung | 2.413,74 ms | 0,055 ms | erneute Berechnung entfällt durch Cache-Erhalt |
| ECharts-JavaScript, gzip | 308.084 Bytes | 150.176 Bytes | 51,3 % kleiner |
| Haupt-JavaScript-Chunk, gzip | 195.295 Bytes | 74.385 Bytes | 61,9 % kleiner |
| Alle erzeugten JavaScript-Chunks zusammen, gzip | 977.831 Bytes | 814.414 Bytes | 16,7 % kleiner |
| Resultatcache bei zwölf Abfragen mit jeweils 4.000 Zeilen | 48.000 Zeilen | 4.000 Zeilen | 91,7 % weniger gespeicherte Zeilen |

Die Service-Antworten haben für alle gemessenen Fälle identische SHA-256-Prüfsummen. Bei der Historie werden ausschließlich die zwischen Fixture-Erzeugungen unterschiedlichen Erstellungs-/Änderungszeitpunkte aus dem Vergleich entfernt. Bundle-Summen enthalten auch spätere Routen und den Entwicklungskatalog; sie sind keine Messung des anfänglichen Netzwerktransfers. Der kleinere Haupt-Chunk und weniger gleichzeitig benötigte Sprachressourcen versprechen daher keinen pauschalen Seitenladezeit-Faktor. Cache-Zeilen sind ebenfalls keine gemessenen Browser-Heap-Bytes.

## Umsetzung, Erwartung und UX je Schritt

| Schritt | Änderung und Wirkung | Erwartung gegenüber Ergebnis |
| --- | --- | --- |
| 1. Kompakte Transcoding-Abfragen | Joblisten laden nur Codec/HDR der Quelldateien statt kompletter Medienobjekte samt Rohdaten. Historie und Status belasten RAM und API weniger; Details bleiben erhalten. | Ziel mindestens 80 % weniger Allokationen: **92,1 % erreicht**. Der vorherige Prototyp lag bei etwa 26,5 ms/2,45 MiB; die fertige Variante erreicht 17,3 ms/2,07 MiB im neuen Messverfahren. Die Zeitwerte der beiden Verfahren sind nur eingeschränkt direkt vergleichbar. |
| 2. Weniger Polling | Ein Endpunkt ersetzt Connectorliste plus einzelne Statusabrufe. Aktive Intervalle bleiben bei 5 s für Connectoren und 2,5 s für Transcoding. Sichtbare ruhende Tabs prüfen alle 30–60 s; unsichtbare Tabs pausieren. Historie wird bei Abschluss, Rückkehr/Fokus und spätestens beim langsamen Kontrollabruf erneuert. | Bei vier Connectoren rechnerisch 60 auf 12 Requests/min aktiv, **80 % weniger**; ruhend 1–2/min, versteckt 0. Die Transcoding-Historie sinkt von 24 auf ungefähr 1–2 Abrufe/min während unverändert laufender Jobs, zusätzlich bei Ereignissen. Fake-Clock-Tests prüfen das Verhalten. Neu gestartete Jobs können in ruhenden Tabs entsprechend bis zu 30–60 s später erscheinen. |
| 3. Modulare Diagramme | Nur benötigte Diagramme, Komponenten und Canvas-/SVG-Renderer werden registriert. Bestehende Charts, Interaktionen und Tooltips verwenden dieselben Komponenten. | Ziel mindestens 40 % weniger ECharts-gzip: **51,3 % erreicht**, entsprechend dem frühen Prototyp. |
| 4. Passende Cache-Invalidierung | Connector-/Playback-Änderungen verwerfen abhängige Ansichten, lassen technische Statistiken und technische Vergleiche warm. Medienänderungen invalidieren weiterhin vollständig. | Ziel erreicht: der technische Kontrollabruf bleibt ein Cache-Hit. Die teure allgemeine Statistikberechnung selbst wurde erwartungsgemäß nicht schneller. Inflight-/Cache-Regressionen prüfen die Trennung. |
| 5. Begrenzte Vergleichsberechnung | SQLite zählt numerische Heatmap-Bins und wählt den deterministischen Scatter-Sample über Rangpositionen. Andere Achsen werden gestreamt. Kein vollständiger Katalog bleibt als Python-Zeilenliste liegen. | Ziel exakte Ergebnisse mit weniger Speicher erreicht; Zeitgewinne **90,8 %/80,9 %**. 49 numerische Achsenpaare prüfen fehlende/ungültige Werte, Bin-Grenzen, Counts, Balkenmittel und Sampling. Große Sample-Limits umgehen das SQLite-Parameterlimit. |
| 6. Storage Map | Quelldaten streamen in 500er-Batches; Ordner-Akkumulatoren entstehen einmal, Auflösungsklassifikationen werden lokal mit maximal 512 Einträgen wiederverwendet. Der vorhandene Cache pro Pfad bleibt bestehen. | Ziel Speicherreduktion erreicht; **78,9 % weniger Allokationen**, Laufzeit nur **22,6 % kürzer**. Neue persistente Ordnersummen wurden zugunsten dieser einfacheren Änderung zurückgestellt. Jeder ungecachte Pfad aggregiert weiterhin seine passenden Dateien; Wurzelabrufe bleiben relativ teuer. |
| 7. Ressourcen bei Bedarf | Englisch bleibt als Fallback gebündelt; Deutsch, Spanisch und Ukrainisch laden bei Bedarf. Die erste Darstellung wartet auf die gewählte Sprache. Vergleichs-/Verteilungsdiagramme mounten erst innerhalb von 300 px zum sichtbaren Bereich. | Haupt-Chunk **61,9 % kleiner**; Sprachwechsel und spätes Eintreffen von Chartdaten getestet. Ein Wechsel kann beim ersten Laden kurz warten. Die Viewport-Grenze reduziert Canvas-Arbeit; nicht jeder Chartimport wird damit erst beim Scrollen geladen. Zusätzlich wurde das bereits in der Baseline reproduzierbare Schrumpfproblem gerenderter Charts behoben. |
| 8. Begrenzte Tabellen-Caches | Normaler und gruppierter Resultatcache erhalten jeweils ein Budget von 5.000 Zeilen, neben zwölf Einträgen und bestehender TTL. Überlange aktive Listen werden nicht zusätzlich gecacht. | Das Cache-Budget ist überprüft; im Beispiel **48.000 auf 4.000 Zeilen**. Die aktive Tabelle bleibt vollständig erhalten. Das Entfernen entfernter aktiver Scroll-Seiten wurde bewusst zurückgestellt: dafür braucht es ein eigenes Scroll-/Nachlade-Konzept. Lange aktive Listen können weiterhin wachsen. |
| 9. Hintergrundressourcen | Zwei Connector-Worker bleiben unabhängig von Scan-Limits. Nur ausführende FFmpeg-Prozesse erhalten möglichst Hintergrundpriorität; bereits niedrigere Priorität bleibt erhalten. Explizite Job-/CPU-/GPU-Limits bleiben bestehen. | Entkopplung und tatsächliches Linux-nice 10 bestätigt. Ein zusätzlicher Prioritätsgewinn allein ist in diesem Versuch **nicht belastbar nachgewiesen**. Encoder-/Scan-Durchsatz wurde nicht als verbessert behauptet. |
| 10. Messbarkeit | Opt-in-Diagnose liefert aggregierte Route-/SQL-Zeiten, Cache-Lookups, Antwortgrößen und Queue-Wartezeiten. Pro Familie maximal 64 Labels, pro Route/Queue 256 Samples. Ohne Schalter gibt es keine zusätzliche Request-Middleware, SQL-Listener oder Executor-Wrapper. | Funktion, Grenzen und Queue-Messung getestet. Die Diagnose dient der weiteren Optimierung, sie ist selbst kein Geschwindigkeitsgewinn. Aktivierter Mess-Overhead ist mit der kleinen Stichprobe nicht zuverlässig quantifiziert. |

## API unter echter FFmpeg-Last

Drei aufeinanderfolgende Vorher/Nachher-Paare liefen in derselben Linux-arm64-Validierungsimage, jeweils begrenzt auf zwei CPUs (`--cpuset-cpus=0,1 --cpus=2`) und 512 MiB RAM ohne Swap. Während einer tatsächlichen FFmpeg/libx264-Kodierung von synthetischem 1080p-Material wurden je 40 HTTP-Aufrufe des numerischen Vergleichs-Endpunkts mit 5.000 Dateien ausgeführt. Jeder Abruf war ein Anwendungscache-Miss. Die Tabelle zeigt den Median der drei jeweiligen Lauf-p95-Werte, keinen gepoolten p95.

| HTTP-Latenz | Vorher | Nachher |
| --- | ---: | ---: |
| p95 ohne Kodierung | 80,51 ms | 8,03 ms |
| p95 mit FFmpeg-Kodierung | 103,86 ms | 8,22 ms |

Unter FFmpeg-Last ist der untersuchte Endpunkt damit etwa **92,1 % schneller im p95**. Das Ergebnis umfasst insbesondere die SQL-Optimierung. Ein zusätzlicher einzelner Lauf der neuen Implementierung mit FFmpeg-nice 0 statt 10 ergab 8,43 ms; daraus folgt kein belastbarer isolierter Prioritätsgewinn. Mit aktivierter Diagnose lag ein einzelner Lauf bei 8,96 ms und erfasste 83 Requests mit 332 SQL-Abfragen. Andere Endpunkte, reale Mediendateien, NAS-Latenzen, GPU-Transcodes und Scan-Durchsatz sind damit nicht vermessen.

## Regressionen und Prüfung

- Baseline: **723 Backend-Tests**, **515 Frontend-Tests** erfolgreich.
- Fertiger Stand: **739 Backend-Tests**, **520 Frontend-Tests in 49 Dateien** erfolgreich. Backend: drei bestehende Abhängigkeitswarnungen.
- Vollständige Linux-Docker-Suite nach allen Änderungen: **739 Tests** erfolgreich bei **512 MiB RAM ohne Swap**, zwei Abhängigkeitswarnungen, 56,44 s. Die gleiche lokale Validierungsimage wurde verwendet; pytest wurde nur im temporären Testcontainer ergänzt.
- Zusätzliche Prüfung nach der kleinen Responsive-CSS-Korrektur: **30 gezielte Frontend-Tests** erfolgreich; Produktions-Build erneut erfolgreich.
- Vorher- und Nachher-Produktions-Build erfolgreich; `git diff --check` ohne Fehler.
- Scan-, ffprobe-, Cancellation-, Maintenance-, Connector-, API-, Cache- und Transcoding-Regressionsprüfungen sind Bestandteil der vollständigen Backend-Suite. Plattformzweige der Prozesspriorität werden einschließlich Windows-Idle/Below-normal-Priorität getestet; native Windows-Ausführung wurde nicht durchgeführt.
- Browserprüfung: Heatmap/Scatter/Balken und die echte Library-History-Linie in Light/Dark bei 1280/375 px; Verteilungschart und SVG-Geschwindigkeitslinie mit nichtleeren Renderern. Sprachwechsel En/De/Es/Uk laden genau den benötigten zusätzlichen Sprach-Chunk. [Browserdaten](results/performance-2026-10-01/browser-charts.json), [History-Daten](results/performance-2026-10-01/browser-history.json), [Sprachdaten](results/performance-2026-10-01/browser-languages.json).
- Bei der damaligen Browserprüfung wurden lokale Screenshots in Light/Dark und bei 375/1280 px geprüft. Diese Dateien lagen unter dem nicht versionierten `output/playwright/` und sind keine veröffentlichten Bericht-Artefakte; die versionierten Browser-JSON-Daten oben dokumentieren den Messlauf. Der Produktbrowser konnte zunächst DOM/Interaktionen prüfen, scheiterte bei Screenshots und verlor anschließend die Verbindung. Nach seiner expliziten Unverfügbarkeitsmeldung wurde die Prüfung mit Playwright abgeschlossen.
- Ein zusätzlicher temporärer Browser-Katalog enthält drei echte WAV-Dateien; ihr ffprobe-Scan schloss erfolgreich ab. Die History-Prüfung wählt die passende Files-Metrik, da Audiodateien keine Auflösungswerte besitzen.

## Diagnose und Reproduktion

`MEDIALYZE_PERFORMANCE_METRICS=true` aktiviert `/api/performance`; ohne Schalter ist die Route nicht registriert. Erfasst werden Route-Templates ohne SQL-Text, Dateipfade oder Request-Parameter. Antwortbytes sind Anwendungspayloads vor Kompression; SQL-Zeiten decken die Cursor-Ausführung ab, nicht die vollständige ORM-/JSON-Verarbeitung. Cache-Zähler sind interne Lookup-Zähler, keine vollständigen Request-Hit-Raten. Alle Werte leben nur im Prozess und starten nach Neustart neu.

```sh
.venv/bin/python docs/benchmarks/benchmark_application_performance.py --items 100000 --repeats 3
node docs/benchmarks/benchmark_frontend_cache.mjs
```

Dasselbe Benchmarkskript muss in beiden zu vergleichenden Quellständen liegen. Der Mischlast-Test benötigt eine Python-3.12-Umgebung mit Projektabhängigkeiten und FFmpeg/libx264; die hier verwendete lokale Image war `medialyze-validation:macos-m1-max-20260903`:

```sh
docker run --rm --cpuset-cpus=0,1 --cpus=2 --memory=512m --memory-swap=512m \
  -v "$PWD:/workspace:ro" -w /workspace --entrypoint python \
  medialyze-validation:macos-m1-max-20260903 \
  docs/benchmarks/benchmark_mixed_performance.py
```

`--foreground` isoliert die bisherige FFmpeg-Priorität in der aktuellen Implementierung; `--observed` aktiviert Messungen im Benchmark. [Rohdaten, Wiederholungen, Bundle-Größen und Quell-Hashes](results/performance-2026-10-01/) liegen im Repository. Wiederholte Messungen auf einer realen NAS-/Docker-Installation sind für absolute UX-Zeiten aussagekräftiger als diese synthetischen lokalen Fixtures.
