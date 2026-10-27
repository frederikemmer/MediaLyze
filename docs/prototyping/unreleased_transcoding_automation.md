# Unreleased transcoding automation implementation notes

[Documentation home](../README.md)

Status: Transcoding automation is implemented in the backend but its management
UI is hidden in the shipped frontend by
`frontend/src/lib/release-visibility.ts` (`automationRules: false`). Hiding the
UI does not disable the API or scan-triggered automation. Saved presets and
manual per-file transcoding remain available. New rules are always created
disabled; any already enabled rule can still be applied by the backend.

To expose automation in a later release, enable the `automationRules` switch,
promote the relevant behavior into the fixed documentation, and include the
feature in release validation. The rule, inventory, and run-history APIs are
already registered; they do not require a separate network listener or
automation-specific environment variable.

## Release promotion checklist

When automation is approved for a release, carry its supported contract into
the permanent documentation:

- Add the scan-triggered inventory flow, eligibility rules, persistence, and
  executor ownership to [Architecture](../architecture.md).
- Check [Environment](../environment.md) for any configuration variables or
  listener/port changes introduced before release. The current implementation
  has no automation-specific variables or listener; document that only if it
  remains relevant to deployment guidance.
- Add the released management workflow to [Transcoding](../transcoding.md),
  including rule and preset management, condition matching, output policies,
  replacement approval, inventory, history, and cancellation.
- Update the [documentation home](../README.md) to list the released guide
  with current user documentation; reclassify or remove this internal note.
- Verify the release visibility switch, API behavior, scan triggers, and
  documented safety limits against the implementation shipped in that release.

## Rules and presets

Each rule has a name, an explicit selection of one or more libraries, an
optional condition tree, a priority, a saved transcoding preset, an output
mode, and an optional output subfolder. Presets contain the structured plan
settings for stream handling, codecs, container, metadata, and formatting; the
automation service materializes a file-specific plan and passes it through the
same server-side capability and output validation used by manual transcoding.
Built-in presets cannot be edited or deleted; duplicate one to make an editable
copy.

New rules start disabled regardless of the submitted `enabled` value. Enabled
rules are considered in ascending priority order, with rule ID as a stable
tie-breaker. The first enabled rule whose library and conditions match wins.
With no condition tree, a rule matches every eligible video file in its
selected libraries.

Condition trees support nested `AND` and `OR` groups. Conditions can inspect
path, container, size, duration, quality score, video and audio bitrate, audio
bit depth, channels, sample rate, chapter count and titles, video codec,
resolution, HDR type, audio codecs, spatial audio profiles and languages,
audio tags, embedded-cover presence, and subtitle languages, codecs, and
sources. The available operators are `equals`, `not_equals`, `contains`,
`not_contains`, `starts_with`, `ends_with`, `in`, `not_in`, numeric comparisons
(`>`, `>=`, `<`, `<=`), `exists`, and `missing`. Numeric size, duration, and
bitrate conditions accept the same human-readable units as file search.

## Output and replacement safety

Rules support three output modes:

- `transcode_output`: write below the configured `Transcode_Output` root;
- `same_directory`: write a linked variant beside the source;
- `replace_original`: replace the source only after explicit approval.

An optional output subfolder is accepted only for `transcode_output` and is
normalized and checked so it cannot escape the output root. Same-directory and
replace-original rules do not accept a rule subfolder. Output collisions and
invalid plans are reported as skipped or blocked decisions instead of being
published.

Replacement approval is tied to the current rule version. A replace-original
rule stays disabled until that version is approved. Changing its matching
conditions, library selection, preset, output mode, or output subfolder creates
a new version and clears approval. Editing a referenced preset definition also
disables replace-original rules and requires renewed approval. Reordering rules
can change which rule wins, but preserves an existing replacement approval.
Original replacement has the same no-byte-for-byte-backup limitation described
in [Transcoding](../transcoding.md#execution-safety).

## Matching and inventory runs

Only analyzed primary video files are candidates; same-directory transcode
variants are excluded. A manual inventory can be previewed and started for
selected rules, libraries, or source file IDs. The preview reports matched,
blocked, skipped, and unmatched decisions before queueing. Inventory defaults
to a 5,000-file preview limit; runs process candidates in persisted pages of
50.

After a scan completes with no file-level errors, the runtime starts an
inventory for newly analyzed or changed primary video files in that library.
Failed, canceled, or partially failed scans do not trigger automation. The
variant reconciliation step runs before source selection so a generated
same-directory variant cannot become a new automation source.

Each inventory run and each source/rule/preset version decision is persisted in
SQLite. The source identity, size, modification time, rule version, and preset
version prevent duplicate work for an already processed source state. Failed
or canceled records are not retried implicitly; set `retry_failed` on a manual
run to retry them. The inventory uses its own single-worker executor and hands
valid jobs to the normal transcode runtime, independently of scan discovery
workers.

Run cancellation stops further inventory work and cancels jobs that are still
queued for that run. An FFmpeg job already running retains its job snapshot and
uses the ordinary transcode-job cancellation control. On startup, orphaned
queued or running inventory runs are marked canceled instead of resumed.

## Automation API

The API remains available while the management UI is hidden. With the default
`API_PREFIX=/api`, the rule endpoints are:

- `GET` / `POST /api/transcoding/rules`
- `GET` / `PATCH` / `DELETE /api/transcoding/rules/{rule_id}`
- `POST /api/transcoding/rules/reorder`
- `POST /api/transcoding/rules/{rule_id}/replacement-approval`

Inventory and run-history endpoints are:

- `POST /api/transcoding/automation/preview`
- `POST /api/transcoding/automation/start`
- `GET /api/transcoding/automation/status`
- `GET /api/transcoding/automation/runs?limit={n}`
- `GET /api/transcoding/automation/{run_id}`
- `POST /api/transcoding/automation/{run_id}/cancel`

The `start` endpoint creates a durable run and returns while the runtime
processes it. Run status is `queued`, `running`, `completed`, `failed`, or
`canceled`; the run also reports per-file totals for matched, queued, blocked,
skipped, unmatched, completed, failed, and canceled work.
