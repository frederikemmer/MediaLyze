# UI notifications

The implementation provides transient frontend notifications and a **Notifications** sub-panel exclusively under **App settings**. Accounts save their own preferences to the server; Guest can also edit preferences, stored locally for that Guest browser. Direct connector connection-card actions and one-time terminal results for explicitly started scans, transcodes, connector syncs and history reconstruction are connected. Scan banners, validation and update information are separate patterns.

The settings panel can send one or ten random transient previews to exercise status colors, source links, grouping and stacking. These previews never enter notification history. **Clear notifications** removes all active toast cards and their timers without deleting historical records.

## Settings and lifetime

The panel uses the existing `ui_preferences.notifications` contract. Accounts and Desktop use the app-settings API (`GET`/`PUT /api/app-settings`); Guest reads and writes the existing browser-local Guest preference namespace:

- `palette`: `medialyze` (default), `soft`, `contrast`
- `style`: `outline` (default), `rail`, `tint`
- `duration_seconds`: 1–10, in 0.5-second steps; default 2.5
- `grouping`: `off`, `topic` (default), `type`, `both`

Each change autosaves to the current identity after 350 ms without another setting change; rapid slider movement is coalesced. Save success and failure are notifications rather than inline result panels. A failed save preserves the draft and asks the user to change a setting to retry. The account-scoped preferences never overwrite global settings. The one- and ten-message preview actions randomly choose status and source from the saved settings. They never start jobs or connection tests. The sample job reference is fictional; its arrow opens the real transcoding overview, not a fictional job detail. Clearing removes active toasts and timers only; notification history is unchanged.

Persistence follows existing UI preferences: signed-in accounts store the settings in `LocalAccount.preferences.ui_preferences.notifications`; Guest stores them in browser local storage under the existing `medialyze-identity:guest:` preference namespace. Guest can open App settings for Notifications without receiving any global app-settings rights; the global Scan, Charts and Feature settings remain hidden. Guest language and theme stay in the personal settings panel and their local Guest namespace. Desktop uses `AppSetting` key `global`, under `ui_preferences.notifications`. The legacy path without a principal also uses that global record. Every signed-in account can edit its own notification preferences independently of global app-settings rights. The access tree has no notification-specific permission; its app-settings view/edit permissions govern global controls and are labeled accordingly. There is no notification editor under My account. Changing personal preferences grants no global configuration rights. Desktop continues using App settings. The personal history extension adds a separate additive SQLite table; no browser notification permission or external service is introduced.

Settings and acknowledged personal history records survive reloads. Toast cards remain transient. See [Personal notification history](#personal-notification-history) for search and retention. `NotificationProvider` lives above the route suspense boundary and keeps messages across internal route changes. The existing authentication boundary remounts it on identity/revision changes. Saving a new duration resets every active card's timer to that full duration; if the host is paused, those timers remain paused and resume with the new duration. Palette/style/grouping changes also apply to active cards. Individual timers preserve remaining time during ordinary hover/focus pauses, including new arrivals and other groups. Semantic modal dialogs also pause timers; the host sits below existing modal backdrops.

The app tracks terminal results only for job IDs registered after an explicit UI start. Current sources are scans, file transcodes, accepted connector sync requests and history reconstruction. Scheduled/watch jobs and sync side effects of another action are not registered. Guest scan and history-reconstruction tracking is suppressed because shared Guest job provenance cannot establish which Guest session started a returned job. A missing read permission also prevents registration when the job result or target would not be accessible.

Cards stay separate, latest first within a topic/type stack. Collapsed stacks expose at most five card edges. Hover or keyboard focus expands the stack, with more than five cards available in a five-card scroll viewport. The overall host also scrolls within the available viewport; no messages are discarded to limit group counts. Entry/fan animations respect reduced motion. Touching a grouped deck focuses and expands it. Screenreader announcements use a stable polite status region, separate from visual regrouping.

## Connected actions

The connector connection card sends notifications for save, connection test, activation/deactivation, sync request, cancellation request and deletion. Its former transient inline success/error panels have been removed. Each toast links to the specific connection (or the connector overview after deletion); navigating to the same page expands the referenced connection. Failed actions use localized safe wording instead of raw exceptions. A failed test keeps its redacted technical diagnosis in a collapsible detail disclosure until the next test or a saved configuration change. If the test used an unsaved server address, the disclosure labels it as the last test with an unsaved address. The toast and notification history contain only the safe summary, never that diagnosis. The disclosure uses the backend's connector-error redaction and is stored in identity-scoped browser `localStorage`, so it survives navigation, reloads, and browser restarts. Removing the connection also deletes it. It is not sent to the server.

Toasts are local to the tab where their action was triggered and are not broadcast to other open tabs. The identity's server-backed notification history remains available in each tab when loaded or refreshed.

Sync acceptance and cancellation requests are not reported as completed jobs. A successful mutation followed by a failed view refresh produces a refresh warning rather than a false mutation-failure message. Terminal sync results are sent once for accepted manual requests and link to the connection.

History reconstruction start failures and terminal results use notifications from both the Logs retention action and the library-detail action. History-retention value save failures also use notifications. The live progress summary stays beside its action; completed/canceled/failed summaries are not repeated inline.

One-time terminal results are tracked for scan, transcode, accepted connector/Jellyfin sync, and history-reconstruction job IDs explicitly returned to the current UI session. The provider watcher survives internal route changes, polls while the page is visible, and emits one localized terminal result with a target link. Scheduled/watch jobs and sync side effects of another action are not registered. Guest scan and history-reconstruction tracking is suppressed because shared Guest job provenance cannot establish which Guest session started a returned job.

## Personal notification history

**Settings → Logs** groups history retention, scan logs, transcoding history and searchable personal notifications. Older scan-log and retention links remain compatible. Notification history is available under **Logs → Notifications**, independently of global settings rights.

Authenticated `POST /api/notification-history` records provider notifications; `GET` returns only the current identity’s entries, with case-folded search and cursor pagination. Accounts retain history across sessions and devices; Guest history is isolated per login session, and Desktop has its own local identity. Entries retain their original language. This client-reported history is not a security audit log. Preview notifications are excluded.

Unacknowledged writes are queued in memory and may be retried while the same identity session remains open. Reloading, closing the app or changing identity discards unacknowledged entries. Toast dismissal and history retention are independent.

**Logs → History Retention** sets `history_retention.notification_history_days` installation-wide (default 30 days; 0 means unlimited), requiring global app-settings edit rights. Expired entries are excluded on reads and removed by maintenance. Entries whose targets are no longer accessible are pruned; disabling or deleting an account removes its history, and disabling Guest removes Guest histories.
