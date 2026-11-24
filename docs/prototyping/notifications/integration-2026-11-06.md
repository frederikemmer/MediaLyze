# Notification integration onto current dev

The October working changes were integrated onto `3c670440426b1b4fcfc97dd6616bd08ec62633f1` on 2026-11-06. The original work remains in the local Git stash named `notification integration backup before origin dev update 2026-11-06`; this integration does not commit or publish it.

## Reconciliation

- Account and Desktop preference feedback observes serialized `PATCH /api/me/preferences` persistence. Existing `services/personal_preferences.py` remains the single atomic partial-write implementation. The old account-only helper was superseded; legacy PUT replacement semantics remain unchanged.
- Notification editors submit changed fields only. Guest updates merge with the latest browser-local settings. Debounced Notification changes flush on departure and never flush into a changed identity.
- The current username/email autosave and separate password dialog are retained. Profile refresh failure is distinguished from successful persistence; confirmed password changes return to sign-in with safe acknowledgement or refresh-failure wording.
- Account/Desktop favorites wait for server persistence before a successful departure summary. Guest favorites use their local-write result.
- Quick scan retains permission checks and avoids requesting unauthorized connector syncs. Remote removal of library-detail history reconstruction is preserved; Logs remains its entry point.
- Consolidated remote documentation is retained. October reports are historical evidence, with explicit notices pointing to current documentation.
- Frontend dependencies were installed from the current lockfile (`npm ci`), including Vite 6.4.5.

## Validation

Commands use disposable `/tmp/medialyze-integration-config` and `/tmp/medialyze-integration-media` paths for backend state. Current checks and counts are recorded after completion below. October test counts in adjacent documents are not current results.

No fresh browser, native Electron, hardware-transcoding or external-connector run was performed for this integration. Automated component/API tests and build checks do not certify those environments.

Completed validation on the integrated checkout:

- Full backend suite: **1,022 passed** (`CONFIG_PATH=/tmp/medialyze-integration-config MEDIA_ROOT=/tmp/medialyze-integration-media uv run pytest -q`).
- Full frontend suite after lockfile installation: **703 passed in 67 files** (`npm test --prefix frontend`).
- TypeScript/Vite production build: passed (`npm run build --prefix frontend`).
- Build verification: **76 compressed JS/CSS assets** checked (`npm run verify:build --prefix frontend`).
- EN/DE/ES/UK action translation keys: **146 matching keys** in each language.
- `git diff --check`: passed; no unresolved merge entries. Local `dev` HEAD and the live remote `dev` both resolve to the base hash above; integrated work remains uncommitted.
