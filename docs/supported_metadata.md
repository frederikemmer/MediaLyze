# Supported Metadata Reference

This document describes the currently implemented support matrix in MediaLyze (dev branch) for:

- library modes and types
- scan modes and scan job behavior
- supported file extensions and sidecar subtitles
- parsed stream metadata (video, audio, subtitles)
- special codec/HDR handling
- behavior for unsupported or invalid input

All details below are based on the current backend implementation.

## 1) Library Types And Allowed Media Extensions

Media file discovery is type-aware. Only files with extensions allowed for the library type are discovered and scanned.

| Library Type | Allowed Media Extensions |
|---|---|
| movies | .mkv, .mp4, .avi, .mov, .m4v, .ts, .m2ts, .wmv |
| series | .mkv, .mp4, .avi, .mov, .m4v, .ts, .m2ts, .wmv |
| music | .mp3, .flac, .m4a, .aac, .opus, .wav, .wma |
| mixed | all video + all audio extensions listed above |
| other | all video + all audio extensions listed above |

### Behavior for non-matching extensions

| Situation | Behavior |
|---|---|
| File extension is not allowed for the library type | File is skipped during discovery (no analysis, no DB media row for that file) |
| File is allowed by extension but later ffprobe/parsing fails | File is marked as failed (`scan_status=failed`) and included in scan failure samples |

## 2) Library Scan Modes

| Scan Mode | Meaning | Normalized `scan_config` fields |
|---|---|---|
| manual | Scan only when user/API triggers it | optional `selected_paths` |
| scheduled | Interval schedule | `interval_minutes` (min 5), optional `selected_paths` |
| scheduled_daily | Daily schedule | `scheduled_time` (`HH:MM`), optional `selected_paths` |
| watch | Filesystem watcher with debounce | `debounce_seconds` (min 3), optional `selected_paths` |

### Watch fallback behavior

| Situation | Behavior |
|---|---|
| `watch` requested but not supported for path/runtime | Automatically normalized to `scheduled` with `interval_minutes=60` |
| `watch` requested with `selected_paths` | Automatically normalized to `scheduled` |

## 3) Scan Request Modes

| Scan Request `scan_type` | Behavior |
|---|---|
| full | Full traversal and analysis cycle |
| incremental | Incremental traversal/change detection and required reanalysis |

## 4) Duplicate Detection Modes

| Mode | Behavior |
|---|---|
| off | Duplicate processing disabled |
| filename | Uses normalized filename signature |
| filehash | Uses SHA-256 content hash |
| both | Uses both signature and hash |

## 5) Ignore Pattern Defaults

These default ignore patterns are seeded unless `DISABLE_DEFAULT_IGNORE_PATTERNS=true` is set.

| Default Pattern |
|---|
| */.DS_Store |
| */._* |
| */@eaDir/* |
| */#recycle/* |
| */.deletedByTMM/* |
| */.recycle/* |
| */Thumbs.db |
| */Desktop.ini |
| */$RECYCLE.BIN/* |
| */.thumbnails/* |
| *.part |
| *.tmp |
| *.temp |
| *thumbs.db |

## 6) External Subtitle Sidecar Support

External subtitle detection supports sidecar files in the same folder with matching stem/prefix.

| Supported Sidecar Extensions |
|---|
| .srt |
| .ass |
| .ssa |
| .sub |
| .idx |

### Behavior for unsupported sidecar extensions

| Situation | Behavior |
|---|---|
| Sidecar extension not in supported list | Sidecar is ignored (not persisted in `external_subtitles`) |
| Sidecar matches extension but not media stem/prefix | Sidecar is ignored |

## 7) Parsed Stream Metadata (Normalized)

### 7.1 Format-Level Fields

| Field | Source |
|---|---|
| container_format | ffprobe `format.format_name` |
| duration | ffprobe `format.duration` |
| bit_rate | ffprobe `format.bit_rate` |
| probe_score | ffprobe `format.probe_score` |

### 7.2 Video Stream Fields

| Field | Source |
|---|---|
| stream_index | ffprobe `streams[].index` |
| codec | ffprobe `codec_name` |
| profile | ffprobe `profile` |
| width / height | ffprobe `width` / `height` |
| pix_fmt | ffprobe `pix_fmt` |
| color_space / color_transfer / color_primaries | ffprobe color fields |
| frame_rate | parsed from `avg_frame_rate` or `r_frame_rate` |
| bit_rate | ffprobe `bit_rate` |
| bit_depth | ffprobe `bits_per_raw_sample` or `bits_per_sample` |
| hdr_type | derived from transfer/side-data/profile parsing |

Attached picture streams (for example embedded cover art) are ignored as video analysis streams.

### 7.3 Audio Stream Fields

| Field | Source |
|---|---|
| stream_index | ffprobe `streams[].index` |
| codec | ffprobe `codec_name` |
| profile | ffprobe `profile` |
| spatial_audio_profile | derived (Dolby Atmos, DTS:X) |
| channels / channel_layout | ffprobe channel fields |
| sample_rate | ffprobe `sample_rate` |
| bit_rate | ffprobe `bit_rate` |
| bit_depth | ffprobe `bits_per_raw_sample` or `bits_per_sample` (0 treated as unknown) |
| bit_rate_mode / compression_mode | ffprobe tags |
| replay_gain / replay_gain_peak | ffprobe tags |
| writing_library | ffprobe `encoder` or `writing_library` tag |
| md5_unencoded | ffprobe MD5-related tag values |
| language | normalized language tag |
| default_flag / forced_flag | ffprobe disposition flags |
| title / artist / album / album_artist / genre / date / disc / composer | optional music tags |

### 7.4 Subtitle Stream Fields

| Field | Source |
|---|---|
| stream_index | ffprobe `streams[].index` |
| codec | ffprobe `codec_name` |
| language | normalized language tag |
| default_flag / forced_flag | ffprobe disposition flags |
| subtitle_type | derived from codec (text/image/unknown) |

## 8) Codec/HDR/Subtitles Special Handling

### 8.1 HDR Classification

| Output `hdr_type` | Detection Rule |
|---|---|
| Dolby Vision (including profile variants) | Dolby Vision metadata/signatures in side-data/profile/stream metadata |
| HLG | `color_transfer` contains `arib-std-b67` |
| HDR10+ | SMPTE 2084 transfer with HDR10+ / SMPTE 2094 dynamic metadata markers |
| HDR10 | SMPTE 2084 transfer without HDR10+ markers |
| null | no HDR signature detected |

### 8.2 Audio Spatial Profile Derivation

| Output `spatial_audio_profile` | Detection Basis |
|---|---|
| dolby_atmos | markers in profile/codec/tags/side-data indicating Atmos |
| dts_x | markers in profile/codec/tags/side-data indicating DTS:X |
| null | no known immersive marker detected |

### 8.3 Subtitle Type Derivation

| Codec Name | Derived `subtitle_type` |
|---|---|
| subrip, ass, ssa, webvtt, mov_text | text |
| hdmv_pgs_subtitle, dvd_subtitle, xsub, dvb_subtitle | image |
| other/unknown codecs | null |

### 8.4 HEVC Video Codec Bucketization (Statistics)

For codec distribution, HEVC (`hevc`, `h265`, `x265`) is split by bit depth.

| Input | Distribution Label |
|---|---|
| HEVC + bit depth 8 | `hevc_8bit` |
| HEVC + bit depth 10 | `hevc_10bit` |
| HEVC + other positive bit depth | `hevc_<N>bit` |
| HEVC + unknown/non-positive bit depth | `hevc_unknown_bit_depth` |
| non-HEVC codec | normalized codec name |

## 9) Container Labels (Display Layer)

MediaLyze stores/uses normalized container keys and maps known keys to user-friendly labels.

| Key | Label |
|---|---|
| mkv | MKV |
| mp4 | MP4 |
| avi | AVI |
| mov | MOV |
| webm | WebM |
| ts | TS |
| m2ts | M2TS |
| wmv | WMV |
| flv | FLV |
| mpeg | MPEG |
| mpg | MPG |
| ogm | OGM |
| asf | ASF |
| mp3 | MP3 |
| flac | FLAC |
| m4a | M4A |
| aac | AAC |
| opus | Opus |
| wav | WAV |
| wma | WMA |

Note: This label map can include keys that are not currently part of type-aware discovery for specific library types.

## 10) Behavior Matrix For Unsupported/Invalid Input

| Input/Condition | Result |
|---|---|
| File extension not allowed for library type | silently skipped in discovery |
| File filtered by ignore pattern | skipped and counted in ignore summary |
| ffprobe execution error | file marked failed, reason included in scan summary |
| ffprobe returns non-parseable numeric metadata | value stored as null where parsing fails |
| audio `bits_per_sample=0` (common for lossy codecs like MP3/AAC/Opus) | treated as unknown (`bit_depth=null`) |
| unknown subtitle codec for type derivation | subtitle stream stored, `subtitle_type=null` |
| unsupported external subtitle sidecar extension | sidecar ignored |
| invalid scan mode value in API payload | rejected by schema validation |
| invalid library type value in API payload | rejected by schema validation |

## 11) Notes On Scope

| Topic | Current Scope |
|---|---|
| Codec support | MediaLyze stores ffprobe-reported codec names broadly; only certain codec families have special classification logic |
| Bit depth semantics | Bit depth is stored when meaningful/available; lossy audio often has no meaningful fixed bit depth |
| Non-media files | Not analyzed unless extension is in allowed set for the library type |
