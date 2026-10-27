# Passkeys

Passkeys provide an additional login method for local MediaLyze accounts. Password login and password-based recovery remain available. Guest, Desktop and `NO_USERS` operation have no personal passkey management.

## Enable in Docker Compose

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

## Manage your own passkeys

Open **Settings → Users & access → your account → Account → Passkeys**. Every fully signed-in local account can manage its own passkeys without account-management rights. Other people's account editors never expose them.

**+ Passkey** opens fields for a name and the current password. After password verification, the browser asks the authenticator to create a discoverable credential with user verification (for example a device PIN or biometrics). MediaLyze stores only the public credential and metadata. Private keys remain with the authenticator/password manager.

Each entry shows its name, creation date and last use. Rename edits that entry inline. Deleting requires confirmation and revokes sessions originally authenticated with that passkey; deleting the key used for the current session therefore signs that session out. Password-authenticated sessions and sessions using other keys remain active. Each account can register at most 20 passkeys. Removing a server record does not remove its copy from the device's password manager.

At login, **Login with passkey** opens the browser's credential picker; no username is required. Disabled/deleted accounts and accounts with a mandatory temporary-password change cannot use passkeys to bypass that state.

## Verification boundary

Registration requires a full own-account session and its current password. All writes retain exact Origin and CSRF checks. Five-minute challenges are browser-bound, registration additionally binds the account, its revision and exact session. Challenges are consumed before validation, including failed attempts. The server checks the fixed configured origin/RP ID, signature, user presence/verification, user handle and signature counter. Cross-origin iframe ceremonies are rejected. Session changes discard browser responses from earlier identities; pending registration is aborted when its panel unmounts. Authentication attempts use the existing throttling infrastructure.

`account_passkeys` and `passkey_challenges` are additive SQLite tables. `login_sessions.passkey_id` is nullable for existing/password sessions and records which passkey authenticated a new session. Account deletion cascades credentials/challenges; credential deletion revokes its linked sessions. Existing account/library/media records are retained.

The explicitly inventoried endpoints are:

- `GET /api/me/passkeys`
- `POST /api/me/passkeys/options`, `POST /api/me/passkeys/verify`
- `PATCH /api/me/passkeys/{passkey_id}`, `DELETE /api/me/passkeys/{passkey_id}`
- `POST /api/auth/passkeys/options`, `POST /api/auth/passkeys/verify`

The implementation uses [py_webauthn](https://duo-labs.github.io/py_webauthn/) and [SimpleWebAuthn Browser](https://simplewebauthn.dev/docs/packages/browser), following the [WebAuthn standard](https://www.w3.org/TR/webauthn-3/).
