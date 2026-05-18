# Supported Metadata Reference

This document is the current support matrix for media analysis capabilities in MediaLyze.

Use it when deciding:

- which media kinds are already first-class
- which metadata is persisted for each media kind
- which statistics, table columns, and detail panels are available
- which gaps still exist when planning a new media type

Folder discovery, show/season recognition, bonus-content classification, and ignore rules are documented separately in [patterns.md](patterns.md).

## 1) Media Kinds And Library Types

MediaLyze currently analyzes two media kinds:

| Media Kind | Current Status | Typical Library Types |
|---|---|---|
| video | implemented | `movies`, `series`, `mixed`, `other` |
| audio / music | implemented | `music`, `mixed`, `other` |

Library types control discovery and some UI behavior:

| Library Type | Discovered Extensions | Extra Behavior |
|---|---|---|
| `movies` | video extensions only | video-focused defaults |
| `series` | video extensions only | show / season / episode recognition can be applied |
| `music` | audio extensions only | video-only table fields, statistics, and comparison axes are hidden |
| `mixed` | video + audio extensions | can contain both video and audio files; show recognition can be applied to video paths |
| `other` | video + audio extensions | generic mixed-media behavior |

### Current extension sets

| Kind | Extensions |
|---|---|
| video | `.mkv`, `.mp4`, `.avi`, `.mov`, `.m4v`, `.ts`, `.m2ts`, `.wmv` |
| audio | `.mp3`, `.flac`, `.m4a`, `.aac`, `.opus`, `.wav`, `.wma` |
| external subtitles | `.srt`, `.ass`, `.ssa`, `.sub`, `.idx` |

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
| Music tag metadata | no | yes | title, artist, album, album artist, genre, date, disc, composer |
| Internal subtitle streams | yes | yes | Technically persisted when present; mainly relevant for video |
| External subtitle sidecars | yes | yes | Sidecars are associated by file stem / prefix |
| Quality scoring | yes | optional | Music-only views hide scores unless `show_music_quality_score` is enabled |
| Duplicate detection | yes | yes | filename, hash, both, or off |
| File history snapshots | yes | yes | shared normalized storage model |
| Library history snapshots | yes | yes | shared library-level history model |
| Search / filtering | yes | yes | audio-only contexts hide fields that do not apply |
| Statistics / panels | yes | yes | music-only contexts expose a reduced set |
| Show / season / episode grouping | yes | no | only applies to video paths in `series` or `mixed` libraries |
| Broken-file diagnostics | partial | partial | scan failure summaries exist; richer diagnostics remain backlog |
| Media-type-specific recommendation workflows | planned gap | planned gap | not implemented today |

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
| title, artist, album, album artist, genre, date, disc, composer | no | yes |

### 3.4 Subtitle metadata

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

| Statistic / panel | Video contexts | Music-only contexts | Default visibility |
|---|---:|---:|---|
| file size distribution | yes | yes | on |
| quality-score distribution | yes | optional | on for video; hidden for music unless feature flag is enabled |
| comparison panel | yes | yes | on |
| video codec distribution | yes | no | on |
| resolution distribution | yes | no | on |
| video bit-depth distribution | yes | no | on when video metadata exists |
| HDR profile distribution | yes | no | on |
| duration distribution | yes | yes | on |
| bitrate distribution | yes | yes | panel on, table off by default |
| audio bitrate distribution | yes | no | panel on, hidden in music-only contexts |
| audio bit-depth distribution | yes | yes | panel on, off by default in dashboard |
| container distribution | yes | yes | on |
| audio codec distribution | yes | yes | on |
| audio spatial profile distribution | yes | yes | available, off by default |
| audio language distribution | yes | no | on for video / mixed contexts |
| subtitle language distribution | yes | no | on for video / mixed contexts |
| subtitle codec distribution | yes | no | on for video / mixed contexts |
| subtitle source distribution | yes | no | available; dashboard on, library panel off by default |

Music-only views intentionally hide:

- video codec
- resolution
- video bit depth
- HDR profile
- bitrate
- audio bitrate
- subtitle language / codec / source
- audio language

`bitrate` still remains usable in pure music contexts because the backend falls back to summed audio-stream bitrate when container bitrate is missing.

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
| ffprobe fails | file is marked failed and appears in scan failure samples |
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
| `scheduled_daily` | daily schedule | `scheduled_time` (`HH:MM`), optional `selected_paths` |
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
mp3, flac, m4a, aac, opus, wav, wma
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
