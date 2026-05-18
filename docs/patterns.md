# Discovery, Folder Recognition, And Pattern Rules

This is the central reference for:

- which folders are visible in the path browser
- which files are discovered for each library type
- how show / season / episode recognition works
- how bonus-content classification works
- how ignore patterns work

Metadata, statistics, and UI capability coverage by media kind are documented in [supported_metadata.md](supported_metadata.md).

## 1) Discovery Pipeline

For each scan, MediaLyze currently applies discovery logic in this order:

1. choose the library root and any configured `selected_paths`
2. traverse the selected roots deterministically
3. skip ignored directories and files
4. keep only file extensions allowed for the library type
5. classify matching bonus paths
6. recognize show / season / episode structure where applicable
7. analyze the remaining media files with `ffprobe`

All path matching uses normalized library-relative paths with `/` separators.

## 2) Library Roots And Folder Visibility

### 2.1 Server mode

In server mode, library paths must stay below `MEDIA_ROOT`.

Current behavior:

- paths outside `MEDIA_ROOT` are rejected
- symlinks that resolve outside `MEDIA_ROOT` are hidden from the browser
- entries are sorted with folders first, then by case-insensitive name
- top-level container placeholder folders named `cdrom`, `floppy`, or `usb` are hidden when they are only empty shadow directories created inside a non-mounted media root
- explicit mounts remain visible, even if they use otherwise common mount-style names

The placeholder-folder suppression is intentionally narrow:

- only the names `cdrom`, `floppy`, and `usb`
- only directly below the media root
- only when the media root itself is not a mount
- only when the entry is a plain directory and not a mount

### 2.2 Desktop mode

Desktop builds do not use the backend browse tree for picking libraries. They use the native OS folder picker plus absolute-path validation.

Desktop-specific behavior:

- library paths must be absolute
- local paths support `watch`
- network paths fall back from `watch` to scheduled scanning

### 2.3 Selected scan roots

A library can be created from multiple selected directories when they share a common parent. Internally:

- the shared parent becomes the stored library root
- the chosen subdirectories are stored in `scan_config.selected_paths`
- scanning only traverses those selected roots
- relative media paths keep the selected directory names

## 3) Type-Aware File Discovery

| Library Type | Discovered Extensions |
|---|---|
| `movies` | `.mkv`, `.mp4`, `.avi`, `.mov`, `.m4v`, `.ts`, `.m2ts`, `.wmv` |
| `series` | `.mkv`, `.mp4`, `.avi`, `.mov`, `.m4v`, `.ts`, `.m2ts`, `.wmv` |
| `music` | `.mp3`, `.flac`, `.m4a`, `.aac`, `.opus`, `.wav`, `.wma` |
| `mixed` | all video + all audio extensions above |
| `other` | all video + all audio extensions above |

Files with non-matching extensions are skipped during discovery and never become media rows.

## 4) Pattern Systems At A Glance

MediaLyze uses three pattern families:

| Pattern Family | Syntax | Purpose |
|---|---|---|
| show / season recognition | folder depth or Python regex | extract show / season structure |
| bonus-content matching | glob | keep media indexed but classify it as bonus |
| ignore matching | glob | skip files or folders entirely |

Use:

- `Folder depth` when your show library mostly follows a regular structure such as `Series/Season/Episode`
- `Regex` when season folder names themselves must be parsed, for example `S01` or `01`
- `Bonus folder patterns` when extras should stay indexed but be marked as bonus content
- `Ignore patterns` when paths should never be indexed or analyzed

## 5) Show, Season, And Episode Recognition

Recognition is attempted for video paths in `series` and `mixed` libraries.

### 5.1 Folder-depth recognition

Folder depth is the default recognition mode.

Example with series depth `1` and season depth `2`:

```text
Example Show/Season 01/Episode 01.mkv
```

Meaning:

- `Example Show` is the series folder
- `Season 01` is the season folder

Example with series depth `2` and season depth `3`:

```text
TV/Example Show/Season 01/Episode 01.mkv
```

Meaning:

- `TV/Example Show` is treated as the series path
- `TV/Example Show/Season 01` is treated as the season path

Important:

- season depth must be greater than series depth
- every supported video inside a recognized season folder is treated as an episode
- MediaLyze still tries to extract episode numbers from filenames such as `S01E02`, `1x02`, `Episode 02`, and `Folge 02`
- default season parsing expects recognizable season names such as `Season 01` or `Staffel 2`

Supported default season examples:

```text
Season 1
Season 01
Staffel 2
Staffel 4 (2026)
Staffel 4 (2026) [1080p, SDR, h264] [ger, eng]
```

### 5.2 Regex recognition

Regex mode is useful when folder depth alone is not enough.

A file is classified as an episode when all of these are true:

- some folder in its path matches a configured season-folder regex
- the folder directly above that season folder matches a configured series-folder regex
- the file itself is a supported video file

Example:

```text
Example Show (2024)/Season 01/Episode 01.mkv
```

Here:

- `Example Show (2024)` is tested against the series regex list
- `Season 01` is tested against the season regex list

### 5.3 Regex syntax

MediaLyze uses Python regular expressions via `re.search(..., re.IGNORECASE)`.

That means:

- matching is case-insensitive
- patterns are searched inside the folder name unless you anchor them
- named groups must use Python syntax such as `(?P<title>...)`

Recognized named groups:

- `title`: optional series title
- `year`: optional four-digit series year
- `season`: numeric season value

Default series-folder regex:

```text
^(?P<title>.+?)(?:\s+\((?P<year>\d{4})\))?(?:\s+\[[^\]]+\])?$
```

Default season-folder regex:

```text
^(?:Season|Staffel)\s*(?P<season>\d{1,3})(?:\s+\([^)]*\))?(?:\s+\[[^\]]+\])*$
```

Useful alternatives:

```text
^(?P<season>\d{1,2})$
^S(?P<season>\d{1,2})$
```

## 6) Bonus Content

Bonus matching uses glob patterns, not regex.

Bonus matches:

- remain indexed
- are classified as `bonus`

Default bonus-folder names currently include:

```text
behind the scenes
deleted scenes
interviews
scenes
samples
shorts
featurettes
clips
other
extras
trailers
theme-music
backdrops
Specials
Season 00
```

For each name, MediaLyze seeds four effective folder patterns:

```text
Name/
Name/*
*/Name/
*/Name/*
```

Typical user patterns:

```text
Extras/*
*/Extras/*
*/trailers/*
*/Season 00/*
```

Use bonus matching when files should stay searchable and visible, but should be separated from main content.

## 7) Ignore Patterns

Ignore rules use glob syntax and are matched against normalized library-relative paths.

Ignored paths:

- are not indexed
- are not analyzed
- are counted in scan ignore summaries

The settings UI stores:

- `user_ignore_patterns`
- `default_ignore_patterns`
- merged effective `ignore_patterns`

### 7.1 Built-in defaults

Fresh installations seed these defaults unless `DISABLE_DEFAULT_IGNORE_PATTERNS=true` is set:

```text
*/.DS_Store
*/._*
*/@eaDir/*
*/#recycle/*
*/.deletedByTMM/*
*/.recycle/*
*/Thumbs.db
*/Desktop.ini
*/$RECYCLE.BIN/*
*/.thumbnails/*
*.part
*.tmp
*.temp
*thumbs.db
```

When seeding is disabled, the default-pattern list starts empty. The UI still allows manual entries.

### 7.2 Common ignore patterns

Ignore one extension everywhere:

```text
*.nfo
```

Ignore one top-level folder:

```text
Extras/*
Sample/*
```

Ignore a folder name anywhere:

```text
*/Sample/*
```

Ignore every path containing a word:

```text
*trailer*
```

### 7.3 Practical examples

Metadata sidecars:

```text
*.nfo
*.png
```

Extra material that should disappear completely:

```text
Extras/*
*/Sample/*
*trailer*
```

Generated subtitle index files:

```text
*.idx
*.sub
```

## 8) Glob Matching Rules

Bonus and ignore patterns both use shell-style glob matching.

- `*` matches any number of characters
- `?` matches one character
- `[seq]` matches one character from a set
- `[!seq]` matches one character not in a set

Examples:

```text
*.nfo
*/Extras/*
movie-??.mkv
```

Matching details:

- paths are normalized to use `/`
- matching is done against the library-relative path, not only the filename
- ignore matching is case-sensitive
- bonus matching is case-insensitive because candidate paths and patterns are normalized to lowercase before comparison
- for directories, MediaLyze checks candidates with and without a trailing slash
- a leading `/` is optional because candidates are tested both with and without it

## 9) Bonus Or Ignore?

Use `bonus` if:

- files should remain searchable
- files should remain visible in MediaLyze
- you want them separated from normal main content

Use `ignore` if:

- files should never appear in MediaLyze
- they are temporary, generated, sidecar, or clutter paths

## 10) Related Behavior

### External subtitle sidecars

External subtitle sidecars are not discovered through the normal media-extension allow-list. They are detected near a media file when the filename stem / prefix matches and the extension is one of:

```text
.srt
.ass
.ssa
.sub
.idx
```

Adding or removing a detected sidecar causes the associated media file to be reanalyzed on the next scan even if the media file itself did not change.

### Supported analysis surface

For the current metadata/statistics/panel matrix by media kind, see [supported_metadata.md](supported_metadata.md).
