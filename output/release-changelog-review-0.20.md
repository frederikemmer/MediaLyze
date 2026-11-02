# Changelog-Redaktion für 0.20.0

Ausgangspunkt ist der am 28.10.2026 über GitHub bestätigte letzte Release [v0.19.2](https://github.com/frederikemmer/MediaLyze/releases/tag/v0.19.2). Die Versionsdateien bleiben vorerst auf 0.19.2; der Entwurf steht weiterhin unter `vUnreleased`. Der Nutzer hat v0.19.2 → v0.20.0 als Vergleich ausdrücklich bestätigt.

## Was im Release stehen bleibt

- Neue Funktionen: lokale Accounts und granulare Rechte, optionaler Guest, Passkeys, persönliche Notifications mit Verlauf.
- Sichtbare Verbesserungen: Logs als gemeinsamer Einstieg, gespeicherte persönliche Präferenzen, neu gegliederte Einstellungen und Resolution-Kategorien.
- Für bestehende Installationen relevante Fixes: doppelte Root-Aliase, Auto-CPU-Parallelität beim Speichern, Desktop-Präferenzen nach Neustart, Reihenfolge beim Videovergleich und offene Scan-Log-Details beim Kopieren.
- Relevante Betriebsänderungen: geringerer Speicherbedarf und klarerer Status bei History-Rekonstruktion, vollständige Übersetzungsschlüssel, aktualisierte CA-/Build-Abhängigkeiten.
- Upgrade-Hinweise: erster Owner, optionale Umgebungsvariablen, bewusst accountfreier Betrieb und HTTPS-/Proxy-Voraussetzungen für Passkeys.

## Was zusammengefasst oder weggelassen wurde

- Einzelne Entwicklungsrunden zu Abständen, Schatten, Icons, Labelpositionen, Tooltipgrößen, Zeilenhöhen und Buttonnamen.
- Fehlerkorrekturen an Accounts/Passkeys/Notifications, die bereits vor ihrer ersten Veröffentlichung behoben wurden: beschrieben wird das fertige Feature.
- Doppelte Einträge zu Notifications, Logs, Account-Editor und Rechtebaum: je Thema nur das endgültige Verhalten.
- Interne API-/SQL-/Testsuite-Details und einzelne CI-Reparaturen. Sie gehören in Code, Tests und technische Dokumentation.
- Versteckte Automation-/Federation-Funktionen und dokumentierter Backlog: keine Ankündigung als fertige Release-Features.

Die vollständige Entwicklungshistorie bleibt im Git-Verlauf erhalten; die vor dieser Redaktion vorhandene Unreleased-Fassung liegt zusätzlich unter `/tmp/medialyze-unreleased-before-polish.md`. Die veröffentlichten Abschnitte ab v0.19.2 bleiben bytegenau unverändert.

## Credits und Belege

- Read-only-Zugriff: [Issue #169](https://github.com/frederikemmer/MediaLyze/issues/169), angefragt von [@Rooster212](https://github.com/Rooster212).
- Doppelte Root-Aliase: [Issue #197](https://github.com/frederikemmer/MediaLyze/issues/197), gemeldet von [@cbol848](https://github.com/cbol848), behoben durch [@Rahul-cs50](https://github.com/Rahul-cs50) in [PR #198](https://github.com/frederikemmer/MediaLyze/pull/198).
- Auto-CPU-Parallelität: [Issue #199](https://github.com/frederikemmer/MediaLyze/issues/199), gemeldet von [@Der-Penz](https://github.com/Der-Penz), behoben durch [@Rahul-cs50](https://github.com/Rahul-cs50) in [PR #200](https://github.com/frederikemmer/MediaLyze/pull/200).
- **New Contributors:** Rahul-cs50 mit erstem Beitrag #198; #200 ist ebenfalls genannt. Git-Verlauf und die abgerufenen PR-Metadaten bestätigen den erstmaligen Beitrag nach v0.19.2.

Alle vorher vorhandenen Issue-/PR-Links und Contributor-Credits wurden gegen den ursprünglichen Unreleased-Abschnitt geprüft und beibehalten. Issue-/PR-Status wurde nicht geändert.

## Validierung dieser Runde

- Frontend: 634 Tests in 62 Dateien bestanden (178,70 s).
- Nach der abschließenden Verschiebung des Owner-Hinweises innerhalb des bestehenden Formularfelds: 5 gezielte Rechte-/Katalogtests bestanden.
- Desktop-Packaging: 31 Tests bestanden; Installation der Build-Werkzeuge mit `npm ci --ignore-scripts`. Native Installer und GUI-Neustartprüfung sind wie vereinbart vom Nutzer vorgesehen.
- Produktionsbuild mit Vite 6.4.5 erfolgreich; alle 76 Brotli-/Gzip-Assets ergeben exakt die Originalbytes.
- Beide npm-Audits einschließlich Entwicklungsabhängigkeiten: keine bekannten Schwachstellen. Saubere `npm ci`-Installationen erfolgreich.
- Übersetzungen: keine fehlenden Schlüssel, unerwarteten Zusatzschlüssel oder abweichenden i18next-Interpolationsvariablen. Zusätzliche ukrainische Pluralformen bleiben erhalten.
- Release-Metadatenvalidator erfolgreich für die weiterhin unveränderte Version 0.19.2; 5 Tests des Validators bestanden.
- `git diff --check` sauber; generierte TypeScript-Buildinformationen auf ihren vorherigen Stand zurückgesetzt.
- Keine visuelle Browserprüfung durchgeführt. Das Formular verwendet bestehende Disabled-/Hinweisstile; die zugänglichen Beschreibungen und der Katalogzustand sind automatisiert geprüft.
- Keine Backend-Laufzeitänderungen in dieser Runde; die vollständige Backend-Suite wurde hier nicht erneut gestartet. Vorhandene parallele History-/Performance-Änderungen wurden erhalten.
- Kein Commit, Push, Versionsbump oder Release ausgelöst. Die neue GitHub-CI wird nach dem vom Nutzer geplanten Push geprüft.

Prüfprotokolle: `/tmp/medialyze-release-polish-frontend-tests.log`, `/tmp/medialyze-release-polish-final-controls.log`, `/tmp/medialyze-release-polish-desktop-tests.log`, `/tmp/medialyze-release-polish-build.log`, `/tmp/medialyze-release-polish-frontend-audit.json`, `/tmp/medialyze-release-polish-desktop-audit.json`, `/tmp/medialyze-release-polish-metadata-tests.log`.
