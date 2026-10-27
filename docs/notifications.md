# UI notifications

The implementation provides transient frontend notifications and a **Notifications** sub-panel exclusively under **App settings**. Accounts save their own preferences to the server; Guest can also edit preferences, stored locally for that Guest browser. Direct connector connection-card actions and one-time terminal results for explicitly started scans, transcodes, connector syncs and history reconstruction are connected. The user has confirmed that transient inline success/error feedback should be replaced by notifications; remaining product flows are being migrated one area at a time. Scan banners, validation and update information are separate patterns.

The settings panel can send one or ten random transient previews to exercise status colors, source links, grouping and stacking. These previews never enter notification history. **Clear notifications** removes all active toast cards and their timers without deleting historical records.

## Settings and lifetime

The panel uses the existing `ui_preferences.notifications` contract. Accounts and Desktop use the app-settings API (`GET`/`PUT /api/app-settings`); Guest reads and writes the existing browser-local Guest preference namespace:

- `palette`: `medialyze` (default), `soft`, `contrast`
- `style`: `outline` (default), `rail`, `tint`
- `duration_seconds`: 1–10, in 0.5-second steps; default 2.5
- `grouping`: `off`, `topic` (default), `type`, `both`

Save applies the edited values to the current identity only. Save success and failure are notifications rather than inline result panels; failed saves preserve the draft. The one- and ten-message preview actions randomly choose status and source from the saved settings. They never start jobs or connection tests. The sample job reference is fictional; its arrow opens the real transcoding overview, not a fictional job detail. Clearing removes active toasts and timers only; notification history is unchanged.

Persistence follows existing UI preferences: signed-in accounts store the settings in `LocalAccount.preferences.ui_preferences.notifications`; Guest stores them in browser local storage under the existing `medialyze-identity:guest:` preference namespace. Guest can open App settings for Notifications without receiving any global app-settings rights; the global Scan, Charts and Feature settings remain hidden. Guest language and theme stay in the personal settings panel and their local Guest namespace. Desktop uses `AppSetting` key `global`, under `ui_preferences.notifications`. The legacy path without a principal also uses that global record. Every signed-in account can edit its own notification preferences independently of global app-settings rights. The access tree has no notification-specific permission; its app-settings view/edit permissions govern global controls and are labeled accordingly. There is no notification editor under My account. Changing personal preferences grants no global configuration rights. Desktop continues using App settings. The personal history extension adds a separate additive SQLite table; no browser notification permission or external service is introduced.

Settings and acknowledged personal history records survive reloads. Toast cards remain transient. See [Logs](logs.md) for the searchable history and its retention. `NotificationProvider` lives above the route suspense boundary and keeps messages across internal route changes. The existing authentication boundary remounts it on identity/revision changes. Saving a new duration resets every active card's timer to that full duration; if the host is paused, those timers remain paused and resume with the new duration. Palette/style/grouping changes also apply to active cards. Individual timers preserve remaining time during ordinary hover/focus pauses, including new arrivals and other groups. Semantic modal dialogs also pause timers; the host sits below existing modal backdrops.

The app tracks terminal results only for job IDs registered after an explicit UI start. Current sources are scans, file transcodes, accepted connector sync requests and history reconstruction. Scheduled/watch jobs and sync side effects of another action are not registered. Guest scan and history-reconstruction tracking is suppressed because shared Guest job provenance cannot establish which Guest session started a returned job. A missing read permission also prevents registration when the job result or target would not be accessible.

Cards stay separate, latest first within a topic/type stack. Collapsed stacks expose at most five card edges. Hover or keyboard focus expands the stack, with more than five cards available in a five-card scroll viewport. The overall host also scrolls within the available viewport; no messages are discarded to limit group counts. Entry/fan animations respect reduced motion. Touching a grouped deck focuses and expands it. Screenreader announcements use a stable polite status region, separate from visual regrouping.

## Connected actions and migration rule

The connector connection card sends notifications for save, connection test, activation/deactivation, sync request, cancellation request and deletion. Its former transient inline success/error panels have been removed. Each toast links to the specific connection (or the connector overview after deletion); navigating to the same page expands the referenced connection. Failed actions use localized safe wording instead of raw exceptions. A failed test keeps its redacted technical diagnosis in a collapsible detail disclosure until the next test or a saved configuration change. If the test used an unsaved server address, the disclosure labels it as the last test with an unsaved address. The toast and notification history contain only the safe summary, never that diagnosis. The disclosure uses the backend's connector-error redaction and is stored in identity-scoped browser `localStorage`, so it survives navigation, reloads, and browser restarts. Removing the connection also deletes it. It is not sent to the server.

Toasts are local to the tab where their action was triggered and are not broadcast to other open tabs. The identity's server-backed notification history remains available in each tab when loaded or refreshed.

Sync acceptance and cancellation requests are not reported as completed jobs. A successful mutation followed by a failed view refresh produces a refresh warning rather than a false mutation-failure message. Terminal sync results are sent once for accepted manual requests and link to the connection. User selection/mapping sub-panels and creation/secret dialogs are still pending migration.

History reconstruction start failures and terminal results use notifications from both the Logs retention action and the library-detail action. History-retention value save failures also use notifications. The live progress summary stays beside its action; completed/canceled/failed summaries are not repeated inline.

One-time terminal results are tracked for scan, transcode, accepted connector/Jellyfin sync, and history-reconstruction job IDs explicitly returned to the current UI session. The provider watcher survives internal route changes, polls while the page is visible, and emits one localized terminal result with a target link. Scheduled/watch jobs and sync side effects of another action are not registered. Guest scan and history-reconstruction tracking is suppressed because shared Guest job provenance cannot establish which Guest session started a returned job.

## Future call sites

Use `useNotifications()` below `NotificationProvider`. Call sites localize the message and accessible target label and provide a stable, scoped topic key when grouping is intended:

```tsx
const { notify } = useNotifications();
notify({
  type: "success", // success | info | warning | error
  message: [t("someFlow.beforeReference"), { reference: t("someFlow.job", { id }) }, t("someFlow.afterReference")],
  topicKey: `transcoding-job:${id}`,
  source: { area: "transcoding", href: `/transcoding?job=${id}`, label: t("someFlow.openJob", { id }) },
});
```

This is an API-shape example for future call sites. The current transcode target `/transcoding?job=<id>` opens that job’s expanded row; scan links open the matching item under Logs. Confirm concrete routes with each integration. Other source areas are `library`, `connectors`, and `settings`. String messages are also supported. Missing topic keys stay independent when grouping by topic; message text is never used as identity. `notify` records personal history (except inputs marked `preview: true`) and returns a transient card ID; `dismiss(id)` removes the card programmatically without erasing history. There are no extra visible card actions.

Messages and reference parts render as escaped React text; arbitrary HTML and arbitrary React elements are not accepted. Targets must be internal absolute app paths; external/protocol-relative targets, backslashes and whitespace/control characters are rejected. This does not grant access to the target: existing route and backend authorization remain responsible for it. Do not put secrets or unreviewed server diagnostics in a toast or history. Confirmed completion must precede success feedback; actionable errors still need persistent contextual explanation.

Notification history targets are checked against current rights. Account-right updates permanently delete entries whose library, job or connector target is no longer readable in the same database transaction; account disable/delete removes that account’s complete history. Guest policy changes prune each Guest session’s inaccessible entries, and disabling Guest clears all Guest histories. History reads repeat the check as a safeguard. Personal Notification-settings confirmations are stored in the submitting identity’s history and do not require global app-settings permission. Guest language and theme remain in the personal settings panel; Guest Notification preferences are edited in App settings and stored only in this browser’s Guest namespace.

## Remaining decisions and validation

- Continue transient action-feedback migration together with the user, one product area at a time, with exact target routes, permission checks, safe wording and confirmed success conditions. The connected action list and pending sources are recorded above.
- Defaults follow the current demo: MediaLyze, outline, topic. Saving a duration change resets the timer for currently visible cards as well as setting the duration for new arrivals.
- No tests were added or run, and no build or typecheck was performed. A targeted browser DOM inspection confirmed the three preview buttons fit in one row and the old selectors/helper copy are absent. The buttons were not clicked; random generation and clearing were not behaviorally exercised. Keyboard, screenreader, touch, responsive and full visual validation remain open.

The [working concept](prototyping/notifications/MediaLyze-UI-Benachrichtigungen-Featurekonzept.md) and [standalone prototype](prototyping/notifications/farbpaletten-und-stile.html) remain design references. The live visual catalog uses the exported settings fields, cards and overflow deck at `/ui-elements`; its fixture values are local and static cards have no timers.

The next-release integration is tracked with the user in [the release integration decision log](prototyping/notifications/release-integration.md). It distinguishes confirmed decisions from remaining proposals.

The user has confirmed server-side personal notification history, isolated per account and per Guest session. It is available under **Settings → Logs → Notifications**, with installation-wide notification retention under **Logs → History Retention**. Details and pending policy decisions are documented in [Logs](logs.md).
