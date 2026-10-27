# Local users and access on dev

This describes the implementation on the current development branch.

## Entering the application

When guest access is enabled, unauthenticated visitors enter the application automatically with the configured Guest permissions, including after sign-out or session expiry. The header account menu offers **Login**, which opens `/login`; this explicit login page stays open while browsing as Guest. **Continue as guest** returns to the originating page. With Guest disabled, the authentication gate shows login (or first-owner setup) before mounting application data providers. Successful authentication always starts a fresh status request and invalidates older polls, so the application opens immediately after account preferences are loaded. Login and setup share the application header. Only first-owner setup explains accounts introduced in 0.20 and automatic carry-over of existing installations; subsequent Login panels start directly with the form without a visible heading or introductory text. Release notes do not require a telemetry choice from identities without global app-settings edit permission, so they cannot block Guest entry.

On a new server installation, Guest is disabled. Its default policy grants dashboard, comparison and Storage Map access plus metadata read access to all existing and future libraries. This includes library statistics, file details, covers and scan progress/diagnostics; it does not permit starting scans, media preview or download, exports, transcoding or administration. An owner can enable Guest and change its permissions under **Settings → Users & access**. Existing installations retain their saved Guest policy.

Set `GUEST_ENABLED=true` or `false` in the process/Compose environment to set Guest's enabled state at startup, including interactive owner setup. This preserves the saved Guest policy; changes in the UI can be made during runtime but the environment value is applied again on restart. Remove the variable to leave the saved state under UI control. Disabling Guest revokes Guest sessions and removes Guest notification histories. Guest access makes the granted metadata available without a login.

For an explicitly account-free server, set `NO_USERS=true` and restart. Every visitor has full Owner-equivalent access, including changes to media and settings; restrict network access accordingly. User-management and login endpoints are unavailable, while existing accounts and Guest settings remain stored. Remove the variable or set it to `false` and restart to restore normal account access; an installation without an existing owner then requires setup. Owner and Guest environment settings are not applied while this mode is active. Browser writes still require same-origin and CSRF checks.

The desktop application also requires no user accounts, but uses a private Electron process credential; setting desktop runtime mode alone does not provide anonymous browser access to a server.

## Setup and upgrade

Server startup adds identity tables without replacing media, library or job tables. Until a single owner exists, interactive APIs require setup. `/api/health` returns only `{"status":"ok"}`. The anonymous HTML/compiled assets contain the login/setup application, not media data. The first visitor can create the owner without an installation code; expose an unconfigured installation only where that first-visitor setup is intended.

Alternatively set both `OWNER_USERNAME` and `OWNER_PASSWORD` in the process/Compose environment for the first startup. Usernames contain 1–64 ASCII letters/digits and `_.@-`, starting with a letter/digit. Passwords contain at least 5 characters and at least one number or special character. Whitespace alone does not satisfy the latter requirement. There is no registration, e-mail reset or external login. The standard Compose file passes explicitly configured owner fields through without inventing empty defaults; the ENV variant reads them from its existing `env_file`.

For an existing owner, each supplied variable is reconciled separately on every startup. Invalid values or a username collision stop startup. Identical credentials retain sessions; a changed username/password revokes them. Remove a variable and restart to unlock that field in the UI; its last value remains stored. No default password is generated or logged. The owner cannot be deleted, disabled, reset or assigned a restricted policy through account administration. Its own credentials can be changed under **Settings → Users & access → your account → Account**, subject to environment locks.

## Passkeys

Passkeys provide an additional login method for local MediaLyze accounts. Password login and password-based recovery remain available. Guest, Desktop and `NO_USERS` operation have no personal passkey management.

### Enable in Docker Compose

Configure the exact external HTTPS origin, without a path:

```yaml
services:
  medialyze:
    environment:
      PUBLIC_URL: https://medialyze.example.com
```

The supplied Compose file also accepts `PUBLIC_URL` from its environment/`.env` interpolation. Recreate the container after changing the value. `PUBLIC_URL` is the public browser address, not the container's `hostname:`. A hostname without the scheme, an IP address, embedded credentials, a path, query or fragment is rejected. Empty/unset disables passkeys. `http://localhost:<port>` is allowed only for local development.

The reverse proxy must preserve Host, terminate HTTPS correctly and have its explicit address configured in `MEDIALYZE_TRUSTED_PROXY_IPS`; see [Environment](environment.md#local-accounts-and-trusted-proxies). Do not trust arbitrary forwarded headers. Requests must use exactly the configured origin, including a non-default port. Passkeys use its hostname as the relying-party ID. Moving to a different hostname requires creating new passkeys; changing the port still requires the newly configured exact origin.

Without this configuration, the own Account tab still shows the collapsed Passkeys panel, grayed out. Its header tooltip explains `PUBLIC_URL`. Access through a different origin or an unsupported/insecure browser also disables its actions.

### Manage your own passkeys

Open **Settings → Users & access → your account → Account → Passkeys**. Every fully signed-in local account can manage its own passkeys without account-management rights. Other people's account editors never expose them.

**+ Passkey** opens fields for a name and the current password. After password verification, the browser asks the authenticator to create a discoverable credential with user verification (for example a device PIN or biometrics). MediaLyze stores only the public credential and metadata. Private keys remain with the authenticator/password manager.

Each entry shows its name, creation date and last use. Rename edits that entry inline. Deleting requires confirmation and revokes sessions originally authenticated with that passkey; deleting the key used for the current session therefore signs that session out. Password-authenticated sessions and sessions using other keys remain active. Each account can register at most 20 passkeys. Removing a server record does not remove its copy from the device's password manager.

At login, **Login with passkey** opens the browser's credential picker; no username is required. Disabled/deleted accounts and accounts with a mandatory temporary-password change cannot use passkeys to bypass that state.

### Verification boundary

Registration requires a full own-account session and its current password. All writes retain exact Origin and CSRF checks. Five-minute challenges are browser-bound, registration additionally binds the account, its revision and exact session. Challenges are consumed before validation, including failed attempts. The server checks the fixed configured origin/RP ID, signature, user presence/verification, user handle and signature counter. Cross-origin iframe ceremonies are rejected. Session changes discard browser responses from earlier identities; pending registration is aborted when its panel unmounts. Authentication attempts use the existing throttling infrastructure.

`account_passkeys` and `passkey_challenges` are additive SQLite tables. `login_sessions.passkey_id` is nullable for existing/password sessions and records which passkey authenticated a new session. Account deletion cascades credentials/challenges; credential deletion revokes its linked sessions. Existing account/library/media records are retained.

The explicitly inventoried endpoints are:

- `GET /api/me/passkeys`
- `POST /api/me/passkeys/options`, `POST /api/me/passkeys/verify`
- `PATCH /api/me/passkeys/{passkey_id}`, `DELETE /api/me/passkeys/{passkey_id}`
- `POST /api/auth/passkeys/options`, `POST /api/auth/passkeys/verify`

The implementation uses [py_webauthn](https://duo-labs.github.io/py_webauthn/) and [SimpleWebAuthn Browser](https://simplewebauthn.dev/docs/packages/browser), following the [WebAuthn standard](https://www.w3.org/TR/webauthn-3/).

## Sessions and browser boundary

Passwords use Argon2id through `argon2-cffi`. Sessions use random 384-bit bearer tokens; only SHA-256 token hashes are persisted. Cookies are HttpOnly, SameSite=Strict, scoped to `/`, and Secure for HTTPS requests. The server enforces 24 hours without an authenticated request and seven days from login; authenticated polling updates activity. Logout revokes the current session. Password changes/resets, disabling and deleting an account revoke its sessions. Temporary account/reset passwords allow only status, password change and logout until replaced.

State-changing browser requests require an exact same-origin `Origin` and `X-CSRF-Token`. `/api/auth/status` supplies the CSRF value; anonymous requests also require the matching HttpOnly pre-authentication cookie. Login/setup/logout and guest writes use the same boundary. There is no wildcard CORS or cross-origin credential allowlist. Login limits are stored in SQLite and shared across application processes (15-minute buckets: 40 attempts per client IP, 20 per normalized username, 500 installation-wide). Setup has an IP/global throttle too. Validation errors omit submitted values.

The supported launcher trusts **no proxy by default**. For a TLS reverse proxy, set `MEDIALYZE_TRUSTED_PROXY_IPS` to the explicit proxy IPs accepted by Uvicorn and preserve the original Host and HTTPS scheme. Do not set `*` on a publicly reachable backend. Without that configuration a proxy HTTPS origin will fail the exact-origin check. Direct local HTTP remains supported. The Docker command uses the same launcher. TLS termination and deployment-specific proxy behavior still require deployment verification.

## Permissions and supported projections

`backend/app/api/access_inventory.json` pins the current method/path/name inventory. `access_middleware.py` gates the main application, framework routes, mounts, redirects and the separate Federation listener. New routes/methods default to denial, including for Owner, until reviewed and inventoried. There are no interactive WebSocket routes; all WebSocket upgrades are rejected. Owner and the proved native desktop process have all permission rights on inventoried interactive routes. Existing path validation remains in force.

Other accounts receive explicit global rights and library/action pairs. `per_library` stores individual trees. `all` stores a reviewed snapshot of concrete IDs and rejects a changed inventory on save. `future` stores a symbolic shared scope. Delegation compares sets, including symbolic future scope and the complete target account's existing policy, rather than counts. A subsequent change at the granting account does not cascade to other accounts. Inaccessible target policies are redacted in account lists. Guest cannot administer accounts/access even if such permissions are submitted manually.

As a conservative technical prerequisite, file/library operations require `library.read`; delegated shared edits require the corresponding view right, and connector management requires connector view. Creation requires future scope plus read/edit/paths. These are restrictive implementation prerequisites, not implicit grants.

Supported restricted-account operations include:

- scoped library lists, summaries, technical statistics, histories/bounds, series/groups, file tables/search/raw probe/streams/quality, dashboard/comparisons and Storage Map;
- preview, download and CSV/chapter export with independent action checks, including Range/416 and boolean download aliases;
- library creation/edit/path changes/deletion and scan start/cancel; bulk cancellation only touches libraries with the scan action;
- local file transcoding, scoped job totals/pages/details and history cleanup, account-owned versus other/system cancellation, effective output-mode replacement checks, and source-library checks for variants even after source deletion;
- shared quality/hardware/preset configuration, safe connector configuration and synchronization, own account/preferences, and durable automation rule CRUD scoped to wholly authorized target libraries. Partial global rule reordering is denied;
- explicit per-file connector playback and table/statistic playback only with `connector.playback`, restricted to matched permitted local files. Playback fields are excluded without the right; playback filter/sort/comparison selections are rejected.

Restricted HTTP sessions receive SQL criteria before aggregate/count/pagination operations. The request scope does not attach to internal maintenance sessions. Restricted responses never use shared statistics caches or shared in-flight results. Owner/system caching remains unchanged. UI app-configuration projections omit global operational data when its view right is absent; stored telemetry payloads/install IDs require the confirmed global app-settings view right. Explicit operational endpoints (history storage and telemetry preview/send) use installation-wide aggregate scope after authorization; ordinary media routes retain their library scope.

Unknown IDs outside the action's permitted resource scope return 404; missing global functions return 403; missing/expired sessions return 401. The shell is public so it can display login. Canonical frontend containment and distribution suffix restrictions prevent the fallback/assets from becoming a database/export file server. Sensitive/API responses use `no-store`.

## Jobs and desktop/machine trust

`job_authorities` stores the initiating account UUID/name and required actions without a cascading account foreign key. Scan/transcode/connector/legacy-sync/automation queues recheck current authority before execution. Account deletion/deactivation or lost permissions cancel waiting persisted work; running work is allowed to finish. Transcode jobs recheck after resource-slot waits and retain origin for automation-generated children. Scheduled/watch/maintenance and authorized shared-configuration follow-up jobs use their independent system context. Legacy manual jobs retain legacy origin rather than acquiring a fabricated account. History reconstruction captures explicit scan-authorized library IDs and initiating authority; the executor rechecks the original requirements before starting. Revoked waiting work is marked canceled. New grants or libraries never widen queued work. Scans/quality work for selected libraries wait until reconstruction ends, without discarding jobs; unrelated libraries remain independent.

Electron generates a random per-start process proof and passes it only to its backend subprocess. An ephemeral Electron session injects it only into requests from the app window to the exact backend origin/port, covering images/video/Range. Headers are removed for other destinations, and external top-level navigation is blocked. Node health/update-status calls carry the proof. Loopback, a desktop mode flag and browser cookies alone do not grant native access. Browser account setup on the desktop listener is intentionally unavailable; unproved browser access stays closed.

The Federation protocol keeps its existing member-envelope/pairing authentication and opt-in gates. Neither browser cookies, Origin-bearing requests nor the desktop proof grant machine authority. Framework documentation and unknown routes are closed on its separate listener.

## UI and personal preferences

Personal settings live under Settings → Users & access → the signed-in account → Account. They remain available without account-management rights; the former My account section links resolve to Users & access. Other accounts retain their management controls, and Owner rights remain read-only while the signed-in Owner can edit their own unlocked credentials in Account.

Managed account and Guest editors use borderless Delete, Save and Close header icons instead of a footer action row. Save stays in the current editor/tab and updates its saved baseline, including the returned ID for newly created accounts. Close asks for confirmation only when the managed draft has unsaved changes. Save failures retain the draft and allow retry; temporary passwords are cleared after successful saves. Personal credential forms retain their own Save/Sign out controls.

The account overview gives each user and Guest a separate compact panel using the shared `media-card` surface. Each entire card opens the selected account editor and retains keyboard focus feedback.

The Settings panel uses shared profile rows, `toggle-switch`, `SlidingTogglePill`, `TooltipTrigger`, 32px borderless icon primitives and 26px chevrons. Account selection disappears while editing inline; Guest is last without a subtitle. Rights search retains library hierarchy, opens matches temporarily and disables bulk changes while searching. The Libraries & files header switch selects or clears all delegable library rights in the current scope; future scope also includes library creation when the actor can delegate it. Its checked/partial state reflects the editable rights, and search, read-only views and empty/nondelegable scopes disable bulk changes. Scope changes use intersection; returning to individual scope removes future/create permission. EN/DE/ES/UK copy is maintained. `/ui-elements` embeds the real account component with disposable fixtures; its controls never write real access state.

History-retention forecasts remain visible with `settings.app.view`, while the editable retention table is rendered only with `settings.app.edit`. The bulk reconstruction action is rendered only when the account can both read and scan at least one library; the API resolves the authorized library set again at request time.

Account language/theme/layout serializers use one account-scoped storage adapter and `/api/me/preferences`. New accounts start empty, without importing old browser layouts. Guest preferences remain browser-local. Identity changes clear session caches, abort old API/download requests, remount data providers and load account preferences before exposing views. An identity response header detects cross-tab identity/revision changes. Expired sessions return to Guest when enabled, otherwise to login. Status is refreshed every 15 seconds on visible tabs and on focus. Unsaved editor changes are discarded by an identity/revision remount.

## Current access details and restrictions

- Scan and quality job progress, history and diagnostics follow `library.read`; starting or canceling scans requires `library.scan`. Guest receives no shared configuration or transcode-job viewing by default; explicit grants are possible.
- Guest jobs belong to the shared Guest profile. Canceling them requires `transcode.cancel_other`, library read and job-view rights; separate Guest sessions do not establish personal job ownership.
- Connector viewing includes the external catalog and sanitized provider metadata. Local matches and playback remain scoped to readable libraries; playback also requires `connector.playback`. Legacy Jellyfin mappings are shown only when fully within readable roots; writes require connector management and read/path rights for every installed library. Legacy sync diagnostics remain Owner-only.
- Compatibility profile catalogs use `settings.hardware.view/edit`; file evaluation also requires access to the file's library. Hiding or restoring duplicate groups requires `library.edit`; embedded cover display and download require metadata read access.
- History reconstruction requires per-library scan access. Global app-settings view permits installation-wide performance, history-storage and telemetry diagnostics; manual telemetry sending also requires app-settings edit.
- Manual automation preview, inventory, run views, cancellation and partial rule reordering remain Owner-only. Some page controls may still offer actions rejected by the backend.
- Federation is hidden and its interactive operations remain Owner-only; its machine protocol uses separate authentication. Federation-specific account permissions remain deferred.
