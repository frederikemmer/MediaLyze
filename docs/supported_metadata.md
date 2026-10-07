# Supported Metadata Reference

[Documentation home](README.md)

This document is the current support matrix for media analysis capabilities in MediaLyze.

Use it when deciding:

- which media kinds are already first-class
- which metadata is persisted for each media kind
- which statistics, table columns, and detail panels are available
- which gaps still exist when planning a new media type

Folder discovery, show/season recognition, bonus-content classification, and ignore rules are documented separately in [patterns.md](patterns.md).

## 1) Media Kinds And Library Types

MediaLyze analyzes video and audio files, with dedicated music and audiobook library workflows. These are library/quality-profile distinctions; coarse telemetry still groups audiobook files under `audio`.

| Media Kind | Current Status | Typical Library Types |
|---|---|---|
| video | implemented | `movies`, `series`, `mixed`, `other` |
| audio / music | implemented | `music`, `mixed`, `other` |
| audiobooks (audio with book tags and chapters) | implemented | `audiobooks`; audio files can also occur in `mixed`/`other` |

Library types control discovery and some UI behavior:

| Library Type | Discovered Extensions | Extra Behavior |
|---|---|---|
| `movies` | video extensions only | video-focused defaults |
| `series` | video extensions only | show / season / episode recognition can be applied |
| `music` | audio extensions only | video-only fields hidden; music tags, cover metadata, and audio statistics |
| `audiobooks` | audio extensions only | chapter and book-tag fields, filters, statistics, and audiobook quality profiles |
| `mixed` | video + audio extensions | can contain both video and audio files; show recognition can be applied to video paths |
| `other` | video + audio extensions | generic mixed-media behavior |

### Current extension sets

| Kind | Extensions |
|---|---|
| video | `.mkv`, `.mp4`, `.avi`, `.mov`, `.m4v`, `.ts`, `.m2ts`, `.wmv` |
| audio | `.mp3`, `.flac`, `.m4b`, `.m4a`, `.aac`, `.aa`, `.aax`, `.ogg`, `.oga`, `.opus`, `.wav`, `.wma`, `.aiff`, `.aif`, `.alac`, `.mka`, `.ape` |
| external subtitles | `.srt`, `.ass`, `.ssa`, `.sub`, `.idx` |

These sets are defined in `backend/app/core/config.py`. Accepting an extension does not guarantee decodable media; `.aa`/`.aax` may be DRM-protected and MediaLyze does not decrypt Audible DRM.

## 2) Capability Matrix By Media Kind

`yes` means the capability is currently implemented and exposed through the application surface.
`n/a` means the concept is not applicable to that media kind.
`planned gap` marks a capability that would likely need work for a future richer media type model.

| Capability | Video | Audio / Music | Notes |
|---|---:|---:|---|
| Type-aware discovery | yes | yes | Driven by library type and extension allow-lists |
| ffprobe analysis | yes | yes | Raw ffprobe payloads are persisted for both |
| Container / format metadata | yes | yes | duration, bitrate, probe score |
| Video stream metadata | yes | n/a | codec, profile, resolution, color, frame rate, HDR, bit depth |
| Audio stream metadata | yes | yes | codec, channels, language, bit depth, replay gain, immersive profile, etc. |
| Music tag metadata | when present | yes | title, artist, album, album artist, genre, date, disc, composer, track; audio-oriented UI exposure |
| Internal subtitle streams | yes | yes | Technically persisted when present; mainly relevant for video |
| External subtitle sidecars | yes | yes | Sidecars are associated by file stem / prefix |
| Quality scoring | yes | optional | Music/audiobook views hide scores unless `show_music_quality_score` is enabled |
| Duplicate detection | yes | yes | filename, hash, both, or off |
| File history snapshots | yes | yes | shared normalized storage model |
| Library history snapshots | yes | yes | shared library-level history model |
| Search / filtering | yes | yes | audio-only contexts hide fields that do not apply |
| Statistics / panels | yes | yes | music-only contexts expose a reduced set |
| Show / season / episode grouping | yes | no | only applies to video paths in `series` or `mixed` libraries |
| Broken-file diagnostics | yes | yes | classified reasons, short remedies, and copyable technical diagnostics in scan logs and File Detail; see section 6 |
| Chapters and embedded-cover metadata | yes when present | yes when present | chapter timing/title rows and cover presence/codec/dimensions; attached pictures do not become video-analysis streams |
| Explicit transcoding | yes | no | regular video stream required; no audio-only transcoding workflow |
| Media-type-specific recommendation workflows | planned gap | planned gap | not implemented today |

ffprobe failures are recorded per file and the scan continues with the remaining files. Each probe has a 120-second execution limit, a 16 MiB JSON output limit, and a 1 MiB diagnostic output limit. Exceeding a limit terminates and reaps the probe and records an analysis failure; partial metadata is not accepted. Stored raw payloads are loaded lazily during scans, and persisted analysis payloads and stream data are released as files finish processing.

Scans retain a compact identity/change/rename index and load full stored file records in batches. Filesystem inspection errors are recorded in the existing failure samples without aborting unrelated file analysis. Unavailable roots and unreadable directories are not evidence of deletion: existing records in those locations are preserved. Matching subtitle sidecars are inspected independently of unrelated neighboring media files.

Startup signature migration reads only file IDs and filenames and commits completed batches so an interrupted upgrade can resume. History storage pruning decodes one record at a time, preserves the existing canonical byte estimates and oldest-first rules, and never prunes active jobs. Quality recomputation uses bounded file batches and releases raw metadata after history persistence; unchanged history fingerprints do not reload raw metadata. These measures remove catalog-wide raw-JSON retention, but do not impose an absolute process memory cap.

Manual history reconstruction also loads raw metadata only when creating a file snapshot and releases it after persistence. Its prepared aggregate values still scale with the number of files needed to reconstruct daily library statistics.

If the backend/container restarts during a scan, startup marks the interrupted job as canceled. This does not imply a user cancellation. For Docker, inspect `docker inspect medialyze --format '{{json .State}}'` and `docker inspect medialyze --format '{{.RestartCount}}'`, plus host kernel logs such as `journalctl -k --since '1 hour ago'`, to check for OOM kills or other restart causes. An ffprobe error immediately before startup messages alone does not establish why the backend exited. Output/time limits do not cap ffprobe's internal memory use or total container memory.

## 3) Persisted Metadata

### 3.1 Shared file / format metadata

| Field Group | Video | Audio / Music |
|---|---:|---:|
| relative path, size, mtime | yes | yes |
| scan status and failure reason | yes | yes |
| raw ffprobe JSON | yes | yes |
| normalized container / format | yes | yes |
| duration | yes | yes |
| effective bitrate | yes | yes |
| duplicate filename signature / hash | yes | yes |
| quality score fields | yes | yes |

### 3.2 Video stream metadata

| Field | Video |
|---|---:|
| codec, profile | yes |
| width, height | yes |
| pixel format | yes |
| color space, transfer, primaries | yes |
| frame rate | yes |
| bitrate | yes |
| bit depth | yes |
| HDR / dynamic-range classification | yes |

Attached-picture streams such as embedded cover art are ignored as video-analysis streams.

### 3.3 Audio stream metadata

| Field | Video files with audio | Audio / Music files |
|---|---:|---:|
| codec, profile | yes | yes |
| spatial audio profile | yes | yes |
| channels, channel layout | yes | yes |
| sample rate | yes | yes |
| bitrate | yes | yes |
| bit depth | yes | yes |
| bit-rate mode, compression mode | yes | yes |
| replay gain, replay gain peak | yes | yes |
| writing library, MD5 unencoded payload | yes | yes |
| language, default, forced flags | yes | yes |
| title, artist, album, album artist, genre, date, disc, composer, track | when tags exist | yes |

### 3.4 Chapters, covers, and audiobook metadata

`MediaChapter` stores chapter index, start/end times, duration, and title. File Detail offers chapter search and CSV export, plus embedded-cover inspection/download when available. Cover metadata records presence, codec, width, and height.

Audiobook fields include narrator, author, publisher, series, series part, description, copyright, ASIN, ISBN, language, and abridged status. The parser reads recognized container tags and fills missing values from stream tags; absent tags remain empty/unknown rather than being scraped. Music metadata additionally includes track number. Search supports chapter count/title, cover presence, music tags, and book fields. Quality profiles have separate `video`, `music`, and `audiobook` types, with tag/chapter categories for audio libraries.

### 3.5 Subtitle metadata

Transcoding stream language codes are configured together for video, audio, and subtitles under Metadata settings. Container default uses ISO 639-2/B for MKV/WebM and ISO 639-2/T for MP4. Presets using the source container can request any supported stream convention; applying a preset falls back to the actual target container's default if that convention is unsupported. Filename and folder-name language formatting remains independent.

| Field | Internal subtitle stream | External subtitle sidecar |
|---|---:|---:|
| codec / format | yes | yes |
| language | yes | yes |
| default / forced flags | yes | no |
| subtitle type (`text`, `image`, `null`) | yes | no |
| relative sidecar path | no | yes |

Supported sidecar extensions are `.srt`, `.ass`, `.ssa`, `.sub`, and `.idx`.

## 4) Statistics, Panels, And Tables

### 4.1 Library and dashboard statistic support

| Statistic / panel | Video contexts | Music/audiobook contexts |
| --- | --- | --- |
| File size, duration, container, audio codec, audio bit depth, audio spatial profile | available | available |
| Quality score | available | available when `show_music_quality_score` is enabled |
| Comparison panel | available | available with type-aware axes |
| Video codec, resolution, video bit depth, HDR | available when applicable | hidden |
| Overall/audio bitrate distributions | available | hidden in the statistic-panel selector |
| Audio language, subtitle language/codec/source | available | hidden |
| Music tags, track number, channel count, sample rate, bitrate mode, cover presence | available according to field/context | available |
| Audiobook narrator/author/publisher/series/part, chapter count/title | hidden outside audiobook libraries | audiobook-library views |
| Connector user plays | available with a playback-capable provider | available with a playback-capable provider |

Panel visibility and order are edited directly on Dashboard and Library Detail and persisted per page. First-time layouts are curated in `frontend/src/lib/statistic-panel-layout.ts`; available definitions and table-column defaults are in `library-statistics-settings.ts`. A saved layout can differ from defaults. Table visibility/tooltips remain configurable in Settings.

Music and audiobook statistic views intentionally hide:

- video codec
- resolution
- video bit depth
- HDR profile
- bitrate
- audio bitrate
- subtitle language / codec / source
- audio language

The backend still computes overall `bitrate`, falling back to summed audio-stream bitrate when container bitrate is missing. This persisted value is distinct from visibility: the current audio-only UI hides its table column, statistic panel, and comparison axis; the audio-bitrate comparison axis remains available.

### 4.2 Comparison axes

| Axis | Video contexts | Music-only contexts |
|---|---:|---:|
| duration | yes | yes |
| size | yes | yes |
| quality score | yes | optional |
| bitrate | yes | no |
| audio bitrate | yes | yes |
| resolution in megapixels | yes | no |
| container | yes | yes |
| video codec | yes | no |
| resolution category | yes | no |
| HDR profile | yes | no |
| audio channels, sample rate | yes | yes |
| artist, album, genre, year, track number, bitrate mode, embedded cover | yes | yes |
| chapter count, narrator, author, publisher, series, series part | audiobook context only | audiobook libraries only |
| play count, users played | when playback data exists | when playback data exists |

Available renderers:

- heatmap for every supported axis pair
- scatter when both axes are numeric
- bar when the Y axis is numeric

### 4.3 File table columns and hover details

| Column / detail | Video contexts | Music-only contexts |
|---|---:|---:|
| path / file | yes | yes |
| size | yes | yes |
| duration | yes | yes |
| quality score | yes | optional |
| container | yes | yes |
| bitrate | yes | no |
| audio bitrate | yes | no |
| video codec | yes | no |
| resolution | yes | no |
| HDR type | yes | no |
| audio codecs | yes | yes |
| audio spatial profiles | yes | yes |
| audio languages | yes | no |
| subtitle languages | yes | no |
| subtitle codecs | yes | no |
| subtitle sources | yes | no |
| audio bit depth | yes | yes |
| music tags, track number, channels, sample rate, bitrate mode, embedded cover | type-aware | yes |
| chapter count/titles and audiobook tags | audiobook-library context | audiobook-library context |

Quality-score table cells color only the numerator in `X/10`; no score meter is shown. Series/season names are left-aligned at file-name size.

Hover-detail support currently exists for:

- video codec
- audio codecs
- audio spatial profiles
- audio languages
- subtitle languages
- subtitle codecs
- subtitle sources
- quality score

### 4.4 File detail panels

The file detail page currently has a shared panel set for all analyzed files:

| Detail Panel | Video | Audio / Music |
|---|---:|---:|
| quality breakdown | yes | yes |
| file history | yes | yes |
| format | yes | yes |
| video streams | yes | empty when not applicable |
| audio streams | yes | yes |
| subtitles | yes | yes |
| raw JSON | yes | yes |
| embedded cover | when present | when present |
| chapters with search and CSV export | when present | when present |
| preview/download | experimental, browser codecs permitting | experimental, browser codecs permitting |
| transcoding | regular video only | unavailable for audio-only files |

External-source and playback sections depend on matched capable connectors. Synchronized variant comparison includes separate transcoded output; see [Transcoding](transcoding.md#job-center-and-comparison).

## 5) Special Handling

### 5.1 HDR classification

| Output `hdr_type` | Detection basis |
|---|---|
| Dolby Vision, including profile variants | Dolby Vision metadata / signatures in side data, profile, or stream metadata |
| HLG | `color_transfer` contains `arib-std-b67` |
| HDR10+ | SMPTE 2084 plus HDR10+ / SMPTE 2094 markers |
| HDR10 | SMPTE 2084 without HDR10+ markers |
| `null` | no known HDR signature |

### 5.2 Audio spatial profile classification

| Output | Detection basis |
|---|---|
| `dolby_atmos` | known Atmos markers in profile, codec, tags, or side data |
| `dts_x` | known DTS:X markers in profile, codec, tags, or side data |
| `null` | no known immersive-audio marker |

### 5.3 Subtitle type classification

| Codec name | Derived `subtitle_type` |
|---|---|
| `subrip`, `ass`, `ssa`, `webvtt`, `mov_text` | `text` |
| `hdmv_pgs_subtitle`, `dvd_subtitle`, `xsub`, `dvb_subtitle` | `image` |
| other / unknown codecs | `null` |

## 6) Unsupported Or Partial Cases

| Input / condition | Current behavior |
|---|---|
| File extension is not allowed for the library type | skipped during discovery |
| File is ignored by an ignore pattern | skipped and included in scan ignore summaries |
| Filename ends in `_temp.mp4` | skipped when the built-in default ignore rules are active |
| ffprobe fails | file is marked failed and appears in scan failure samples |
| Analysis failure diagnostics | classified as empty file, missing MP4 metadata, invalid container/media, unavailable file, permission/I/O error, probe timeout/output limit, unrecognized stream, probable Audible DRM, internal processing error, or other ffprobe error; technical details are retained |
| Numeric metadata cannot be parsed | stored as `null` where parsing fails |
| `bits_per_sample=0` for lossy audio | treated as unknown bit depth |
| Unsupported sidecar subtitle extension | ignored |
| Sidecar subtitle does not match the media stem / prefix | ignored |

## 7) Cross-Cutting Runtime Support

These behaviors are shared across currently supported media kinds.

### 7.1 Scan modes

| Scan Mode | Meaning | Normalized `scan_config` fields |
|---|---|---|
| `manual` | scan only when user / API triggers it | optional `selected_paths` |
| `scheduled` | interval schedule | `interval_minutes` (min 5), optional `selected_paths` |
| `scheduled_daily` | daily schedule in the configured scheduler timezone | `scheduled_time` (`HH:MM`), optional `selected_paths` |
| `watch` | filesystem watcher with debounce | `debounce_seconds` (min 3), optional `selected_paths` |

Watch fallback behavior:

| Situation | Result |
|---|---|
| `watch` requested but unsupported for the path / runtime | normalized to `scheduled` with `interval_minutes=60` |
| `watch` requested together with `selected_paths` | normalized to `scheduled` |

### 7.2 Scan request types

| `scan_type` | Behavior |
|---|---|
| `full` | full traversal and analysis cycle |
| `incremental` | change detection plus required reanalysis |

### 7.3 Duplicate detection

| Mode | Behavior |
|---|---|
| `off` | duplicate processing disabled |
| `filename` | normalized filename signature |
| `filehash` | SHA-256 content hash |
| `both` | both methods are persisted and exposed |

### 7.4 Display-only container labels

Known container keys are mapped to user-facing labels for both media kinds:

```text
mkv, mp4, avi, mov, webm, ts, m2ts, wmv, flv, mpeg, mpg, ogm, asf,
mp3, flac, m4b, m4a, aac, aa, aax, ogg, oga, opus, wav, wma, aiff, aif, alac, mka, ape
```

The label map can contain keys that are not currently part of type-aware discovery.

## 8) Planning Checklist For A Future Media Type

When adding a new media type, check whether it needs:

1. discovery extensions and library-type routing
2. normalized metadata tables / schema additions
3. parser normalization from ffprobe or another analyzer
4. file table columns and filter fields
5. statistic distributions and comparison axes
6. detail panels or media-type-specific panels
7. quality-profile categories
8. duplicate-detection behavior
9. history snapshot coverage
10. translations and mixed-library visibility rules

The tables above should be extended whenever a new media kind becomes first-class.

## 9) Resource-aware scan execution

The configured scan-worker count remains the maximum. A process-wide admission gate also checks available host RAM and, on Linux, standard cgroup v1/v2 memory limits and usage. It reserves 64 MiB for backend work and budgets 128 MiB per admitted analysis worker; at least one worker can proceed. Queued work remains bounded, and waiting workers recheck memory and cancellation. Under memory pressure scans may run more slowly. These budgets are conservative scheduling estimates, not hard limits on ffprobe allocations or a guarantee against OOM. Transcoding and connector execution keep their independent scheduling.

Canceling a scan signals active analysis workers. Running ffprobe processes are killed and reaped, output pipes are closed, and file hashing checks cancellation between chunks. Cancellation is not reported as a broken file. OS filesystem calls can still take time on an unresponsive mount.

Database initialization and orphaned-job recovery still finish before startup readiness. History pruning is queued on the existing single-worker maintenance executor; the API can become available before pruning finishes, so expired history may briefly remain visible. Background retention failures are logged. Quality recomputation reuses the effective profile for each media type for the job, while reconstructed full history snapshots are inserted directly in the existing transaction and their source payloads are released per file.
