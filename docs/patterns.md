# Pattern Rules

MediaLyze supports two pattern systems:

- folder-depth or regex-based recognition for series and season folders
- glob patterns for bonus-content detection and ignored paths

All matching runs on normalized paths below the library root. MediaLyze internally uses `/` as the separator and matches case-insensitively.

## Start Here

Use this quick guide first:

- Choose `Folder depth` if your library mostly looks like `Series/Season/Episodes`.
- Choose `Regex` if you need to extract season numbers from unusual folder names such as `S01`, `01`, or custom naming styles.
- Use `Bonus folder patterns` when you want extras to stay indexed, but marked as bonus material.
- Use `Ignore patterns` when files or folders should never be indexed at all.

If you only want one recommendation: start with `Folder depth`, keep the defaults, run one scan, then only add patterns for the cases that still do not classify the way you want.

## Common Real-World Setups

### Standard TV layout

```text
Breaking Bad/Season 01/Episode 01.mkv
Dark/Staffel 2/Folge 03.mkv
```

Recommended:

- recognition mode: `Folder depth`
- series folder depth: `1`
- season folder depth: `2`

### TV folders below one extra parent folder

```text
Shows/Breaking Bad/Season 01/Episode 01.mkv
TV/Dark/Staffel 2/Folge 03.mkv
```

Recommended:

- recognition mode: `Folder depth`
- series folder depth: `2`
- season folder depth: `3`

### Mixed season naming

```text
Show Name/Season 01/Episode 01.mkv
Show Name/S01/Episode 02.mkv
Show Name/01/Episode 03.mkv
```

Recommended:

- recognition mode: `Regex`
- season regex list with multiple small patterns instead of one oversized pattern

### Extras should remain visible as bonus material

```text
Show Name/Season 01/Episode 01.mkv
Show Name/Extras/Behind the scenes.mkv
Show Name/Season 00/Special.mkv
```

Recommended:

- keep `Bonus folder patterns` enabled
- use glob patterns such as `*/Extras/*` or `*/Season 00/*`

### Metadata and junk files should disappear completely

```text
movie.nfo
Thumbs.db
Show Name/Season 01/poster.jpg
Show Name/Season 01/video.part
```

Recommended:

- use `Ignore patterns`
- examples: `*.nfo`, `*/Thumbs.db`, `*.part`

## Choosing The Right Tool

### Folder depth

Use folder depth when the path structure already tells MediaLyze what is a series and what is a season.

Example:

```text
Library Root/Series Name/Season 01/Episode.mkv
```

Here MediaLyze only needs to know:

- which depth contains the series folder
- which depth contains the season folder

Folder depth is usually easier to understand, easier to maintain, and the better default for clean libraries.

### Regex

Use regex when the season folder name itself must be parsed.

Typical reasons:

- season folders are named `S01`
- season folders are just `01`
- series folders include year or extra tags
- your library mixes several naming styles

Regex is more flexible, but also easier to misconfigure.

### Glob patterns

Use glob patterns when you only want to match path shapes, not extract values.

Use glob for:

- `*/Extras/*`
- `*.nfo`
- `*/Sample/*`

Do not use regex syntax in glob fields.

## Folder Depth Recognition

Series recognition is only attempted for libraries of type `series` or `mixed`.

With folder depth, MediaLyze looks at fixed path levels below the library root.

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
- every video inside a recognized season folder is treated as an episode
- MediaLyze still tries to extract episode numbers from filenames such as `S01E02`, `1x02`, `Episode 02`, or `Folge 02`
- default season parsing still expects recognizable season names such as `Season 01`, `Staffel 2`, or similar forms with suffix metadata

Supported default season examples:

```text
Season 1
Season 01
Staffel 2
Staffel 4 (2026)
Staffel 4 (2026) [1080p, SDR, h264] [ger, eng]
```

## Regex Recognition

Regex mode is useful when folder depth alone is not enough.

A file is classified as an episode when all of these are true:

- some folder in its path matches a configured season folder regex
- the folder directly above that season folder matches a configured series folder regex
- the file itself is a supported video file

Example:

```text
Example Show (2024)/Season 01/Episode 01.mkv
```

Here:

- `Example Show (2024)` is tested against the series regex list
- `Season 01` is tested against the season regex list

## Regex Syntax

MediaLyze uses Python regular expressions via `re.search(..., re.IGNORECASE)`.

That means:

- matching is case-insensitive
- patterns are searched inside the folder name unless you anchor them
- if you want an exact match, usually start with `^` and end with `$`

Recommended:

```text
^(?P<title>.+?) \((?P<year>\d{4})\)$
```

Usually too broad:

```text
Season
```

Because MediaLyze uses Python regex syntax, named groups must use `(?P<name>...)`, not `(?<name>...)`.

Correct:

```text
^(?P<season>\d{1,3})$
```

Incorrect:

```text
^(?<season>\d{1,3})$
```

## Named Capture Groups

MediaLyze recognizes these named groups in the regex fields:

- `title`: optional series title from the series folder
- `year`: optional four-digit year from the series folder
- `season`: required numeric season value from the season folder

Notes:

- `title` is optional. If you do not capture it, MediaLyze falls back to the full series folder name.
- `year` is optional.
- `season` should be present in season regexes. If MediaLyze cannot parse a season number, the folder cannot be classified as a season.

## Default Regexes

Default series folder regex:

```text
^(?P<title>.+?)(?:\s+\((?P<year>\d{4})\))?(?:\s+\[[^\]]+\])?$
```

This matches folders such as:

```text
Example Show
Example Show (2024)
Example Show (2024) [tmdb-12345]
```

Default season folder regex:

```text
^(?:Season|Staffel)\s*(?P<season>\d{1,3})(?:\s+\([^)]*\))?(?:\s+\[[^\]]+\])*$
```

This matches folders such as:

```text
Season 1
Season 01
Staffel 2
Staffel 4 (2026)
Staffel 4 (2026) [1080p, SDR, h264]
```

## Practical Regex Examples

### Simple series folders

```text
^(?P<title>.+?)$
```

Matches:

```text
Breaking Bad
Dark
The Office US
```

### Series folders with year

```text
^(?P<title>.+?)\s+\((?P<year>\d{4})\)$
```

Matches:

```text
Battlestar Galactica (2004)
Doctor Who (2005)
```

### Season folders using words

```text
^(?:Season|Staffel)\s*(?P<season>\d{1,3})$
```

### Numeric season folders only

```text
^(?P<season>\d{1,2})$
```

### `S01`-style season folders

```text
^S(?P<season>\d{1,2})$
```

### Two season styles in one library

Store both:

```text
^(?:Season|Staffel)\s*(?P<season>\d{1,3})$
^S(?P<season>\d{1,2})$
```

## Recommended Workflow For Regexes

1. Take one real folder name from your library.
2. Write the smallest exact pattern for that naming style.
3. Add `^` and `$` unless you really want partial matches.
4. Add named groups only for values MediaLyze should extract.
5. Test against a few real folder names.
6. If your library uses multiple styles, add multiple patterns.

Good:

```text
^(?P<title>.+?)\s+\((?P<year>\d{4})\)$
^(?P<title>.+?)$
```

Less maintainable:

```text
^(?P<title>.+?)(?:\s+\((?P<year>\d{4})\))?(?:\s+-\s+.+)?(?:\s+\[[^\]]+\])?(?:\s+\{.*\})?$
```

## Common Regex Mistakes

### Using the wrong named-group syntax

Use:

```text
(?P<title>...)
```

Not:

```text
(?<title>...)
```

### Forgetting anchors

Without `^` and `$`, a regex can match only part of a folder name.

Prefer:

```text
^Season\s*(?P<season>\d{1,3})$
```

### Making one regex do everything

If your library contains several styles, use several small regexes.

## Bonus Folder Patterns

Bonus patterns use glob syntax, not regex syntax.

Bonus matches stay indexed, but are categorized as `bonus` instead of normal main content.

Typical use cases:

- `Extras` folders
- `Trailers` folders
- `Season 00`
- featurettes, interviews, deleted scenes

Common patterns:

```text
Extras/*
*/Extras/*
*/trailers/*
*/Season 00/*
```

Choose bonus patterns when you still want the files visible in MediaLyze.

Choose ignore patterns instead if those files should disappear completely.

## Ignore Patterns

Ignore patterns use the same glob rules as bonus patterns, but ignored files are never indexed or analyzed.

Typical use cases:

- metadata sidecars such as `.nfo`
- temporary download leftovers
- NAS-generated system folders
- images or assets you never want inside the media library

Examples:

```text
*.nfo
*/.DS_Store
*/@eaDir/*
*.part
*.tmp
```

See [ignore_files_folders.md](ignore_files_folders.md) for an additional ignore-only reference list.

## Glob Syntax Quick Reference

MediaLyze matches bonus and ignore patterns with shell-style wildcards.

- `*` matches any number of characters
- `?` matches a single character
- `[seq]` matches one character from a set
- `[!seq]` matches one character not in a set

Examples:

```text
*.nfo
*/Extras/*
movie-??.mkv
```

Folder patterns such as `*/Extras/*` affect everything below that folder. A leading `/` is optional, so `Extras/*` and `/Extras/*` can both match the same top-level normalized path.

## How To Decide: Bonus Or Ignore

Use `Bonus` if:

- you still want the files searchable and visible
- you want them classified separately from main episodes or movies

Use `Ignore` if:

- the files should never appear in MediaLyze
- they are junk, sidecars, temp files, or non-media clutter

## Pattern Cookbook

### Ignore metadata sidecars

```text
*.nfo
*.jpg
*.png
```

### Ignore temp and download leftovers

```text
*.part
*.tmp
*.temp
```

### Ignore NAS and system folders

```text
*/@eaDir/*
*/#recycle/*
*/.deletedByTMM/*
```

### Keep specials as bonus content

```text
*/Season 00/*
*/Specials/*
```

### Keep trailers and extras as bonus content

```text
*/Extras/*
*/trailers/*
```

## External References

Official Python documentation:

- Python `re` regular expressions: https://docs.python.org/3/library/re.html
- Python `fnmatch` glob matching: https://docs.python.org/3/library/fnmatch.html

If you test regexes outside MediaLyze, make sure the tool uses Python regex syntax and not a different flavor.
