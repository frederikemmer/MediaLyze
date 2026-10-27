# Logs

Settings has one **Logs** navigation item (also named “Logs” in translated interfaces). It groups independent collapsible sub-panels:

- **History Retention:** first when permitted; existing retention settings, forecasts and reconstruction controls, with their existing view/edit/scan rights. It also includes notification history retention in days.
- **Scan logs:** existing scan summaries, details and paging, available with readable libraries. History reconstruction and its accuracy tooltip belong to History Retention, not this panel.
- **Transcoding history:** the existing library/status/date filters and expandable job details, moved out of History Retention. It is available with transcoding viewing rights. The job-center History tab remains part of the operational transcoding screen.
- **Notifications:** the current identity's searchable notification history, available independently of global settings rights. Its empty state uses the same notice as Scan logs. Redundant scan/notification helper paragraphs are omitted.

Existing `section=scan-logs`, `history-retention`, `recentScanLogs` and `historyRetention` links/preferences map to Logs. New deep links may use `section=notification-history` or `section=transcode-history`; canonical navigation uses `section=logs`. Settings-search targets open/focus the corresponding sub-panel. No unrelated access rights are broadened by the shared navigation entry.

## Personal notification history

Notifications emitted through the provider are recorded through authenticated `POST /api/notification-history`. `GET /api/notification-history` returns only the current identity's entries, newest recorded first. It searches the complete retained personal history, with literal case-folded text matching, and returns bounded cursor pages (50 by default, maximum 100).

The server derives ownership from the authenticated request; clients cannot specify the account receiving a record. Accounts retain their history across browser sessions/devices. Guest histories are scoped to a digest of the individual login-session cookie, not the shared Guest identity. Desktop has its own local identity in its local database. Even an installation owner receives only their personal records from this API.

The additive SQLite table `notification_history` contains owner/event IDs, server recording time, type, original localized message/reference parts, safe internal target metadata and a folded search string. Its indexes support owner/cursor listing, time retention and idempotent retries. This is client-reported UI feedback, **not a trusted security/audit log**. The table is created through the existing startup schema creation; there is no destructive migration. The original language is preserved; historical messages are not retranslated.

Toast expiry and history retention are independent. A toast's `dismiss()` only removes the transient card. History begins with this implementation; previously expired messages cannot be reconstructed. Settings previews set `preview: true`, so they remain transient and never enter the history write queue. The endpoint also ignores explicitly marked previews and the old settings-demo payloads. Legacy preview records are excluded before search, counting and paging using their known localized prefixes plus exact demo target routes; they remain physically stored until normal retention removes them. This does not record events from product flows that have not yet been integrated.

Failed writes remain in an in-memory provider queue with stable retry IDs; reconnecting, focusing the app, another notification or the history retry button can retry them while the same identity session remains open. Per the confirmed session-exit policy, closing/reloading the app or changing identity before acknowledgment discards unsaved queued items; they are not restored or resent under another identity. They are not durable until the server acknowledges storage. The UI reports pending write failures; it does not recursively generate more notifications for archive failures. The history Refresh control retrieves newly recorded events without resetting an older loaded page on every arriving toast.

## Retention

`app_settings` key `global` stores `history_retention.notification_history_days`. It defaults to **30 days**; **0 means unlimited**. Changing it requires existing global app-settings edit rights and applies installation-wide to all personal notification histories. Each account still reads only its own history.

Reads immediately exclude expired entries. Startup/daily history maintenance physically prunes old records in batches of at most 500; changing retention also invokes the existing maintenance path. Once removed, history cannot be recovered by increasing the retention period. Notification history currently has an age setting; it is not an additional category in the existing logical-byte forecast/storage-budget table.

Before returning history, the server checks each saved internal target against the identity's current rights and permanently deletes entries whose library, transcode job or connector target is no longer readable. Account-right changes prune affected entries in the same database transaction as the policy update. Disabling or deleting an account removes all of its history; changing Guest rights prunes every Guest-session history, and disabling Guest removes them all. These removals are irreversible and apply only to targets whose access changed; other personal history is retained. History is not a security/audit log, and no cross-user view or export is introduced.

## Validation state

No automated tests, build, typecheck or full accessibility/functional validation have been performed. Following the user’s layout annotation, Logs was visually inspected in the running desktop preview and compared with App settings through computed layout measurements. Both use the shared AsyncPanel frame with 20 px padding at the inspected desktop width. Notification retention now uses the same table row/input sizing and blur-to-save behavior as the other retention settings. Narrow-width verification could not be completed because the preview resize setting did not change the reported viewport. Release readiness still requires checks of the additive schema, account/session isolation, paging/search, retry/deduplication, retention cleanup, old links, permissions, light/dark themes and narrow layouts.

## Source map

- Navigation, compatibility aliases and layout: `frontend/src/lib/settings-panel-state.ts`, `frontend/src/pages/LibrariesPage.tsx`, `frontend/src/components/LogsSection.tsx`.
- Notification history UI/retention editor and transport: `frontend/src/components/NotificationHistoryPanel.tsx`, `frontend/src/lib/notification-history.ts`, `frontend/src/lib/notifications.tsx`, `frontend/src/lib/api.ts`, `frontend/src/lib/app-data.tsx`.
- Existing transcode history reused: `frontend/src/components/TranscodeHistorySettingsPanel.tsx`.
- Persistence, endpoints and access registration: `backend/app/models/entities.py`, `backend/app/api/notification_routes.py`, `backend/app/api/routes.py`, `backend/app/api/access_inventory.json`, `backend/app/api/access_policy.py`, `backend/app/services/notification_access.py`.
- Retention configuration/cleanup: `backend/app/schemas/app_settings.py`, `backend/app/services/app_settings.py`, `backend/app/services/history_retention.py`.
- Shared catalog/layout and translations: `frontend/src/pages/UiElementsPage.tsx`, `frontend/src/medialyze.css`, `frontend/locales/{en,de,es,uk}/common.json`.
- Current docs/index/changelog and decision history: `docs/logs.md`, `docs/notifications.md`, `docs/README.md`, `docs/prototyping/notifications/`, `AGENTS.md`, `CHANGELOG.md`.
