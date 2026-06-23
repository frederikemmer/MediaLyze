# Compatibility profiles

MediaLyze compatibility profiles describe whether an analyzed media file can be
played by a specific hardware and software/client combination. Profiles are JSON
documents validated by the Pydantic models in
`backend/app/schemas/compatibility.py`.

The machine-readable JSON Schemas are stored in:

- `docs/schemas/hardware-profile.schema.json`
- `docs/schemas/software-profile.schema.json`
- `docs/schemas/compatibility-profile.schema.json`

This document is the complete human-readable contract for schema version `1`.

## Profile types and storage

MediaLyze uses three profile types:

| Type | Purpose | Official catalog | Local directory |
| --- | --- | --- | --- |
| Hardware profile | Device decode, output, container, audio, and subtitle capabilities | `backend/app/profile_catalog/hardware_profiles/` | `CONFIG_PATH/hardware_profiles/` |
| Software profile | Player/client behavior, transcoding, conditions, and combined rules | `backend/app/profile_catalog/software_profiles/` | `CONFIG_PATH/software_profiles/` |
| Combination profile | Selects exactly one hardware and one software profile for evaluation | Not shipped officially | `CONFIG_PATH/compatibility_profiles/` |

Each profile is stored as one UTF-8 JSON file named `{id}.json`. The filename
without `.json` must equal the profile `id`.

Official hardware and software profiles are read-only. Local profiles may not
reuse an official profile ID. A local hardware or software profile cannot be
deleted while a combination profile references it.

## Common metadata

All three profile types inherit the following fields.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `schema_version` | integer | Yes | `1` | Version of the JSON structure and interpretation rules. Only `1` is currently accepted. |
| `profile_version` | integer, minimum `1` | Yes | `1` | Revision of the compatibility claims for this stable profile ID. |
| `id` | string | Yes | - | Stable lowercase kebab-case identifier, 2-96 characters. |
| `name` | string | Yes | - | User-facing profile name, 1-255 characters. |
| `status` | `official` or `local` | Yes | `local` | Ownership of the profile. Catalog files must use `official`; locally written profiles are forced to `local`. |
| `verified_by` | string or `null` | No | `null` | Verification method, for example `project documentation` or `independent testing`. Maximum 255 characters. |
| `added` | ISO date | Yes | - | Date the profile was first created, formatted as `YYYY-MM-DD`. |
| `last_modified` | ISO date | Yes | - | Date the profile content was last changed. |
| `notes` | string or `null` | No | `null` | Factual profile-wide limitations or context. Maximum 4,000 characters. |
| `sources` | array of sources | Hardware/software: yes; combination: no | `[]` | Documentation or test evidence supporting the profile. |
| `base_profile_id` | profile ID or `null` | No | `null` | ID of an official or local profile from which this profile was derived. |
| `base_profile_version` | integer or `null` | No | `null` | Exact source profile revision used when creating the derivative. |

`base_profile_id` and `base_profile_version` must either both be present or both
be absent. They record provenance; they do not merge or inherit values at
runtime.

The defaults above are Pydantic parser defaults. Profile files should still
include every field marked required by the matching JSON Schema so they remain
portable and self-describing.

A source has this shape:

```json
{
  "label": "Jellyfin codec support",
  "url": "https://jellyfin.org/docs/general/clients/codec-support/"
}
```

`label` is 1-255 characters. `url` must be an absolute HTTP-compatible URL
accepted by Pydantic's `HttpUrl`.

## Versioning

### `schema_version`

`schema_version` identifies the profile document format. Increment it only when
an existing profile cannot be interpreted safely under the previous contract,
for example when:

- a field is removed or renamed;
- a field changes type or meaning;
- evaluation precedence changes incompatibly;
- a previously valid value becomes invalid;
- migration requires information that cannot be inferred.

Additive optional fields may remain in the current schema version when old
documents retain their previous meaning. A future schema version requires:

1. new Pydantic models or explicit migration logic;
2. updated JSON Schemas and this document;
3. catalog migration or backward-compatible loading;
4. API and frontend type updates;
5. tests for old and new documents;
6. a `CHANGELOG.md` entry.

### `profile_version`

`profile_version` revisions belong to one stable profile `id`. Increment it when
a compatibility claim changes, including:

- adding, removing, or changing a codec, container, subtitle, or HDR capability;
- changing a limit, condition, combined rule, fallback, or passthrough claim;
- correcting a capability based on new documentation or testing;
- changing an evaluation-relevant field.

Do not increment it for spelling, formatting, source-label, or non-semantic note
changes unless the edit changes how users should interpret compatibility.

New profiles start at `1`. Do not reset or reuse a previous profile version.
Set `last_modified` to the date of the revision and retain `added`.

Combination profiles currently reference profile IDs, not pinned profile
versions. Evaluations return the hardware and software versions that were
actually used. Updating an official or local component therefore changes future
combination results without editing the combination profile itself.

### Derived local profiles

When copying or proposing a change to an existing profile:

- assign a new local `id`;
- start the derivative's `profile_version` at `1`;
- set `base_profile_id` to the source ID;
- set `base_profile_version` to the source revision;
- set new `added` and `last_modified` dates.

This makes it possible to detect that a local derivative was based on an older
official revision.

## Identifiers and matching

Profile and rule IDs must match:

```text
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

Codec, container, HDR, and format keys are compared case-insensitively after
trimming whitespace and removing hyphens and underscores. For example, `DTS-HD`,
`dts_hd`, and `dtshd` normalize to the same comparison key.

Profile values should normally use ffprobe identifiers:

- video: `h264`, `hevc`, `vp9`, `av1`, `mpeg4`;
- audio: `aac`, `ac3`, `eac3`, `truehd`, `dts`, `opus`;
- subtitles: `subrip`, `ass`, `webvtt`, `hdmv_pgs_subtitle`;
- containers: the normalized file extension, such as `mkv`, `mp4`, or `ts`.

## Hardware profile

Required hardware-specific fields:

| Field | Type | Description |
| --- | --- | --- |
| `category` | string, 1-64 characters | Device class such as `streaming_device`, `smart_tv`, or `computer`. |
| `manufacturer` | string, 1-255 characters | Hardware manufacturer. |
| `year` | integer `1970`-`2200` or `null` | Model year when known. |
| `video` | object | Video codec keys mapped to video capabilities. |
| `audio` | object | Audio codec keys mapped to hardware support values. |
| `containers` | string array | Containers accepted by the device/output path. |
| `subtitles` | object | Subtitle format keys mapped to hardware support values. |

### Hardware video capability

Each `video` entry has:

| Field | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `hardware_decode` | boolean | Yes | - | Whether the device can decode this codec in hardware. `false` blocks direct video playback. |
| `max_resolution` | string or `null` | No | `null` | Named limit: `sd`, `720p`, `1080p`, `2k`, `4k`, or `8k`. |
| `max_width` | positive integer or `null` | No | `null` | Explicit maximum width. Takes precedence over `max_resolution`. |
| `max_height` | positive integer or `null` | No | `null` | Explicit maximum height. Takes precedence over `max_resolution`. |
| `max_fps` | positive number or `null` | No | `null` | Maximum frame rate. |
| `bit_depth` | integer array | No | `[]` | Allowed bit depths. Empty means no profile-level restriction. |
| `hdr` | string array | No | `[]` | Allowed non-SDR dynamic-range values. Empty means no profile-level restriction. |

Named resolution limits are:

| Name | Maximum dimensions |
| --- | --- |
| `sd` | 720x576 |
| `720p` | 1280x720 |
| `1080p` | 1920x1080 |
| `2k` | 2048x1080 |
| `4k` | 4096x2160 |
| `8k` | 8192x4320 |

If either explicit dimension is present, named resolution lookup is not used.
An omitted explicit dimension is unrestricted.

### Hardware audio and subtitle support

Audio and subtitle values are one of:

| Value | Meaning |
| --- | --- |
| `true` | Supported directly. |
| `false` | Not supported directly. |
| `passthrough_only` | Audio requires passthrough to a downstream receiver or display. Direct play is possible, but the evaluation adds a warning. |
| `limited` | Subtitle support is incomplete or device-dependent. The subtitle result becomes `conditional`. |

`passthrough_only` is currently meaningful for audio. `limited` is currently
meaningful for subtitles.

### Hardware example

```json
{
  "schema_version": 1,
  "profile_version": 1,
  "id": "example-device",
  "name": "Example Device",
  "category": "streaming_device",
  "manufacturer": "Example",
  "year": 2026,
  "status": "local",
  "added": "2026-06-15",
  "last_modified": "2026-06-15",
  "video": {
    "hevc": {
      "hardware_decode": true,
      "max_resolution": "4K",
      "max_fps": 60,
      "bit_depth": [8, 10],
      "hdr": ["HDR10", "HLG"]
    }
  },
  "audio": {
    "aac": true,
    "truehd": "passthrough_only"
  },
  "containers": ["mkv", "mp4"],
  "subtitles": {
    "subrip": true,
    "ass": "limited"
  },
  "sources": []
}
```

## Software/player profile

Software-specific fields:

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `category` | string, 1-64 characters | No | `player` | Software class such as `player`, `mobile_app`, or `web_browser`. |
| `developer` | string, 1-255 characters | Yes | - | Project or vendor name. |
| `platforms` | string array | No | `[]` | Supported operating systems or runtime platforms. |
| `video` | capability object | No | `{}` | Video codec capabilities. |
| `audio` | capability object | No | `{}` | Audio codec capabilities. |
| `containers` | capability object | No | `{}` | Container capabilities. |
| `subtitles` | capability object | No | `{}` | Subtitle format capabilities. |
| `rules` | rule array | No | `[]` | Combined constraints that override a basic capability when matched. |
| `server_fallback` | `unsupported` or `transcode` | No | `unsupported` | Behavior when direct support is absent. |

### Software capability

Every entry in `video`, `audio`, `containers`, and `subtitles` uses:

| Field | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `mode` | playback mode | Yes | - | Result when this capability is selected. |
| `max_resolution` | string or `null` | No | `null` | Named video resolution limit. |
| `max_width` | positive integer or `null` | No | `null` | Explicit maximum video width. |
| `max_height` | positive integer or `null` | No | `null` | Explicit maximum video height. |
| `max_fps` | positive number or `null` | No | `null` | Maximum video frame rate. |
| `bit_depth` | integer array | No | `[]` | Allowed video bit depths. |
| `hdr` | string array | No | `[]` | Allowed non-SDR dynamic-range values. |
| `profiles` | string array | No | `[]` | Allowed ffprobe video profile values, such as `High` or `Main 10`. |
| `max_channels` | positive integer or `null` | No | `null` | Maximum directly playable audio channel count. |
| `conditions` | condition array | No | `[]` | Requirements MediaLyze cannot verify from the analyzed file alone. |

Video-only fields are ignored for audio, container, and subtitle entries.
`max_channels` is evaluated for audio entries.

### Playback modes

| Mode | Container/audio/subtitle meaning | Video meaning |
| --- | --- | --- |
| `direct` | Directly usable | Directly decodable |
| `direct_stream` | Remux or non-video conversion required | Direct-stream/remux result; use for a combined video/container rule where the encoded video remains unchanged |
| `transcode` | Legacy alias for `direct_stream` | Legacy alias for `video_transcode` |
| `video_transcode` | Forces video transcoding, primarily for subtitle burn-in | Video transcoding required |
| `conditional` | Depends on one or more unverifiable requirements | Depends on one or more unverifiable requirements |
| `unsupported` | Uses `server_fallback`; otherwise unsupported | Uses `server_fallback`; otherwise unsupported |

New profiles should use `direct_stream` or `video_transcode` instead of the
legacy `transcode` value.

### Conditions

A condition documents a requirement that is not reliably derivable from the
media metadata or selected hardware profile.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `kind` | condition kind | Yes | Machine-readable category. |
| `value` | string, 1-255 characters | Yes | Required version, setting, extension, or capability. |
| `note` | string or `null`, maximum 1,000 characters | No | User-facing explanation. |

Supported condition kinds:

| Kind | Use |
| --- | --- |
| `client_version` | Minimum or specific client version. |
| `os_version` | Minimum or specific operating-system version. |
| `setting` | Client or server option that must be enabled. |
| `extension` | Required codec pack, browser extension, or OS add-on. |
| `hardware_decode` | Required hardware decoder. |
| `hdr_display` | Required HDR-capable display or output path. |
| `device_capability` | Other device-dependent capability. |
| `tested_only` | Documentation only confirms a limited tested case. |

Any capability or matching rule with conditions evaluates as `conditional`.
MediaLyze emits one `playback_condition_unverified` finding per condition. It
does not currently resolve conditions from runtime client information.

Example:

```json
{
  "mode": "conditional",
  "bit_depth": [8, 10],
  "conditions": [
    {
      "kind": "os_version",
      "value": "iOS 14+",
      "note": "HEVC requires iOS 14 or newer."
    },
    {
      "kind": "device_capability",
      "value": "Apple A8X or newer"
    }
  ]
}
```

### Combined compatibility rules

Rules express constraints involving more than one property, for example:

- HEVC direct play only in MP4/M4V/MOV;
- stereo Opus in MP4 only on a minimum OS version;
- subtitle burn-in for ASS in a specific container;
- support limited to selected codec profiles, bit depths, or channel counts.

Rule fields:

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | profile ID format | Yes | - | Stable rule identifier unique within the software profile. |
| `match` | match object | Yes | - | Media properties that must match. |
| `mode` | playback mode | Yes | - | Result produced by the rule. |
| `conditions` | condition array | No | `[]` | Unverifiable requirements. Any condition makes the result conditional. |
| `note` | string or `null` | No | `null` | Explanation used in findings. Maximum 1,000 characters. |
| `subtitle_action` | `direct`, `remux`, `convert`, `burn_in`, or `null` | No | `null` | Subtitle processing needed when the rule matches. |

The `match` object supports:

| Field | Type | Match target |
| --- | --- | --- |
| `containers` | string array | File extension/container |
| `video_codecs` | string array | Video codec |
| `audio_codecs` | string array | Audio codec |
| `subtitle_formats` | string array | Internal or external subtitle format |
| `video_profiles` | string array | ffprobe video profile |
| `bit_depths` | integer array | Video bit depth |
| `hdr` | string array | Video dynamic-range value |
| `min_audio_channels` | positive integer or `null` | Minimum audio channels |
| `max_audio_channels` | positive integer or `null` | Maximum audio channels |

Non-empty match fields are combined with logical `AND`. Values inside one array
are alternatives combined with logical `OR`. Empty fields do not constrain the
rule.

Rules are evaluated in array order. The first relevant matching rule wins for
the current scope. Place specific rules before broader rules. If no rule
matches, MediaLyze evaluates the basic capability map.

Rule scope is inferred:

- a container-only rule applies to the container evaluation;
- `video_codecs`, `video_profiles`, `bit_depths`, or `hdr` make it a video rule;
- `audio_codecs` or channel bounds make it an audio rule;
- `subtitle_formats` makes it a subtitle rule.

Example:

```json
{
  "id": "ios-hevc-container",
  "match": {
    "containers": ["mkv", "ts", "webm"],
    "video_codecs": ["hevc"]
  },
  "mode": "direct_stream",
  "note": "HEVC direct playback is limited to MP4, M4V, and MOV."
}
```

### Subtitle actions

| Action | Expected result |
| --- | --- |
| `direct` | Subtitle can remain unchanged. |
| `remux` | Subtitle is moved into another stream/container without video encoding. |
| `convert` | Subtitle format conversion is required without video encoding. |
| `burn_in` | Subtitle must be rendered into the picture and therefore requires video transcoding. |

Use a matching mode consistent with the action: `direct` for `direct`,
`direct_stream` for `remux` or `convert`, and `video_transcode` for `burn_in`.

### Server fallback

`server_fallback` controls an absent or explicitly unsupported software
capability:

| Value | Container/audio result | Video/subtitle result |
| --- | --- | --- |
| `unsupported` | `unsupported` | `unsupported` |
| `transcode` | `direct_stream` | `video_transcode` |

This is intended for media servers such as Jellyfin that can remux or transcode
unsupported input. It assumes server transcoding is available; MediaLyze does
not evaluate server performance, encoder support, or hardware acceleration.

The hardware profile still constrains direct playback. A software `direct`
claim does not override missing hardware decode or output support.

### Software example

```json
{
  "schema_version": 1,
  "profile_version": 1,
  "id": "example-player",
  "name": "Example Player",
  "category": "player",
  "developer": "Example",
  "platforms": ["Example OS"],
  "status": "local",
  "added": "2026-06-15",
  "last_modified": "2026-06-15",
  "server_fallback": "transcode",
  "video": {
    "h264": {"mode": "direct", "bit_depth": [8]},
    "hevc": {
      "mode": "conditional",
      "bit_depth": [8, 10],
      "profiles": ["Main", "Main 10"],
      "conditions": [
        {"kind": "hardware_decode", "value": "HEVC"}
      ]
    }
  },
  "audio": {
    "aac": {"mode": "direct", "max_channels": 6},
    "truehd": {"mode": "direct_stream"}
  },
  "containers": {
    "mp4": {"mode": "direct"},
    "mkv": {"mode": "direct_stream"}
  },
  "subtitles": {
    "subrip": {"mode": "direct"},
    "ass": {"mode": "video_transcode"}
  },
  "rules": [
    {
      "id": "hevc-mkv-remux",
      "match": {
        "containers": ["mkv"],
        "video_codecs": ["hevc"]
      },
      "mode": "direct_stream"
    }
  ],
  "sources": []
}
```

## Combination profile

A combination profile selects the hardware and software used for one
compatibility evaluation.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `hardware_profile_id` | profile ID | Yes | Existing hardware profile. |
| `software_profile_id` | profile ID | Yes | Existing software profile. |

Combination profiles are currently local only. Both references are validated
when the combination is created or updated.

Example:

```json
{
  "schema_version": 1,
  "profile_version": 1,
  "id": "living-room-jellyfin",
  "name": "Living room Jellyfin",
  "status": "local",
  "added": "2026-06-15",
  "last_modified": "2026-06-15",
  "hardware_profile_id": "apple-tv-4k-3rd-gen",
  "software_profile_id": "jellyfin-swiftfin-ios",
  "sources": []
}
```

## Evaluation behavior

MediaLyze evaluates four scopes independently:

- container;
- primary video stream;
- available audio streams;
- internal and external subtitles.

The API returns:

| Field | Description |
| --- | --- |
| `status` | Overall result. |
| `container_status` | Container result. |
| `video_status` | Video result. |
| `audio_status` | Selected audio-path result. |
| `subtitle_status` | Worst subtitle result. |
| `selected_audio_stream_index` | Audio stream chosen as the best playback path. |
| `findings` | Structured explanations and warnings. |
| `hardware_profile_version` | Hardware revision used. |
| `software_profile_version` | Software revision used. |

### Result statuses and precedence

From most severe to least severe:

1. `unsupported`
2. `video_transcode`
3. `conditional`
4. `direct_stream`
5. `direct_play`

The overall result is the most severe of the four scope results. An empty status
list, such as a file without subtitles, resolves to `direct_play`.

### Video evaluation

- Only the video stream with the lowest stream index is evaluated.
- A missing video codec produces `conditional` with `metadata_unknown`.
- Matching combined rules are checked before the base codec capability.
- Direct playback requires both software support and hardware decode support.
- Hardware limits are checked before software limits.
- Missing metadata required by an active limit produces `conditional`.
- Exceeded limits use the software fallback: video transcode when enabled,
  otherwise unsupported.

### Audio stream selection

Audio streams are considered with default streams first, then by stream index.
MediaLyze selects the first available path in this order:

1. `direct_play`
2. `direct_stream`
3. `conditional`
4. first remaining unsupported path

Unsupported optional streams produce warnings but do not block a better
playable stream. `passthrough_only` remains direct play with a warning.

### Subtitle evaluation

Every internal and external subtitle is evaluated. The subtitle status is the
most severe subtitle result. Subtitle findings are normally warnings because
subtitles are optional, but burn-in is marked blocking because it changes video
playback to `video_transcode`.

### Findings

Each finding contains:

| Field | Type | Description |
| --- | --- | --- |
| `code` | string | Stable machine-readable reason code. |
| `severity` | `info`, `warning`, or `error` | Presentation severity. |
| `scope` | `container`, `video`, `audio`, `subtitle`, `metadata`, or `profile` | Affected area. |
| `message` | string | Human-readable technical explanation. |
| `blocking` | boolean | Whether the issue changes the selected playback path. |
| `stream_index` | integer or `null` | Associated ffprobe stream index. |

Current reason codes include:

```text
container_unsupported
container_remux_required
video_codec_unsupported
video_transcode_required
video_resolution_unsupported
video_fps_unsupported
video_bit_depth_unsupported
video_profile_unsupported
dynamic_range_unsupported
audio_codec_unsupported
audio_transcode_required
audio_channels_transcode_required
audio_passthrough_only
subtitle_format_unsupported
subtitle_remux_required
subtitle_conversion_required
subtitle_burn_in_required
subtitle_support_limited
metadata_unknown
playback_condition_unverified
```

## Contribution rules

- Use a stable lowercase kebab-case `id`.
- Keep the filename equal to `{id}.json`.
- Start new documents with `schema_version: 1` and `profile_version: 1`.
- Increment `profile_version` for every compatibility-relevant correction.
- Keep `added` stable and update `last_modified`.
- Official profiles must use `status: "official"` and include primary sources.
- Prefer project or manufacturer documentation over assumptions.
- Describe device-, version-, setting-, and display-dependent support with
  structured `conditions`, not only free-text notes.
- Use specific combined rules before broad rules.
- Keep notes factual and avoid claiming support that the source does not prove.
- Add or update tests for every new official profile and evaluation behavior.
- Add a concise `CHANGELOG.md` entry for user-visible profile or schema changes.

## Schema change history

The history below records changes to the profile contract independently of
individual `profile_version` revisions.

| Date | Schema | Change |
| --- | --- | --- |
| 2026-06-10 | `1` | Initial hardware, software/player, and local combination profiles with versioned metadata, sources, video limits, hardware support levels, and `direct`/`transcode`/`unsupported` software modes. |
| 2026-06-15 | `1` | Added explicit `direct_stream`, `video_transcode`, and `conditional` modes; capability conditions; codec-profile and audio-channel limits; ordered combined rules; subtitle actions; `server_fallback`; per-scope evaluation statuses; and seven official Jellyfin client profiles. Legacy `transcode` remains compatible. |

These changes remain schema version `1` because the compatibility-profile
feature and catalog are unreleased and existing version-1 documents remain
loadable. After the first public release of this contract, incompatible changes
must use a new `schema_version` and migration path.
