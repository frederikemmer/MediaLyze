# Pattern Rules

MediaLyze supports two different pattern systems:

- regular expressions for series and season folder recognition
- glob patterns for bonus-content detection and ignored paths

Both operate on normalized paths below the library root. MediaLyze uses `/` as the separator internally.
Matching is case-insensitive.

## Which Pattern Type To Use

Use regex when you want to parse information out of a folder name:

- series title
- release year
- season number

Use glob patterns when you only want to match paths by shape:

- everything in an `Extras` folder
- files ending in `-trailer`
- temporary or metadata files such as `*.nfo`

Important: regex and glob are not interchangeable. A regex like `^Season \d+$` will not work in glob fields, and a glob like `*/Extras/*` will not work in regex fields.

## Series And Season Regexes

Series recognition is only attempted for libraries of type `series` or `mixed`.

A file is classified as an episode when all of these are true:

- some folder in its path matches a configured season folder regex
- the folder directly above that season folder matches a configured series folder regex
- the file itself is a supported video file

Example:

```text
Example Show (2024)/Season 01/Episode 01.mkv
```

Here:

- `Example Show (2024)` is tested against the series folder regex list
- `Season 01` is tested against the season folder regex list

MediaLyze does not require a user-configurable episode filename regex. Every video inside a recognized season folder is treated as an episode. If the filename contains markers such as `S01E02`, `1x02`, `Episode 02`, or `Folge 02`, MediaLyze may additionally extract episode numbers and titles.

## Regex Syntax

MediaLyze uses Python regular expressions via `re.search(..., re.IGNORECASE)`.

That means:

- matching is case-insensitive
- patterns are searched inside the folder name, not automatically forced to match the whole string
- if you want to match the complete folder name, you should usually start with `^` and end with `$`

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
^(?:Season|Staffel)\s*(?P<season>\d{1,3})$
```

This matches folders such as:

```text
Season 1
Season 01
Staffel 2
```

## Practical Regex Examples

### Match simple series folders

```text
^(?P<title>.+?)$
```

Matches:

```text
Breaking Bad
Dark
The Office US
```

### Match series folders with year

```text
^(?P<title>.+?)\s+\((?P<year>\d{4})\)$
```

Matches:

```text
Battlestar Galactica (2004)
Doctor Who (2005)
```

### Match season folders with words

```text
^(?:Season|Staffel)\s*(?P<season>\d{1,3})$
```

Matches:

```text
Season 1
Season 12
Staffel 03
```

### Match numeric season folders only

```text
^(?P<season>\d{1,2})$
```

Matches:

```text
1
01
12
```

### Match `S01`-style season folders

```text
^S(?P<season>\d{1,2})$
```

Matches:

```text
S1
S01
S12
```

## Recommended Workflow For Creating Regexes

1. Start with one real folder name from your library.
2. Write the narrowest pattern that matches exactly that folder naming style.
3. Add `^` and `$` unless you intentionally want partial matches.
4. Add named groups only for data you want MediaLyze to extract.
5. Save the pattern and test it against a few real examples from your folders.
6. If your library uses multiple naming styles, add multiple regexes instead of one huge expression.

Good approach:

```text
^(?P<title>.+?)\s+\((?P<year>\d{4})\)$
^(?P<title>.+?)$
```

Less maintainable approach:

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

Example:

```text
Season
```

This can match many unintended names. Prefer:

```text
^Season\s*(?P<season>\d{1,3})$
```

### Making one regex do everything

If your library contains both `Season 01` and `S01`, it is usually clearer to store two season regexes:

```text
^(?:Season|Staffel)\s*(?P<season>\d{1,3})$
^S(?P<season>\d{1,2})$
```

## Bonus Glob Patterns

Bonus patterns use glob syntax, not regex syntax.

When bonus analysis is enabled, matching files are scanned and stored with the `bonus` content category. When bonus analysis is disabled, matching files or folders are skipped during discovery.

Common folder patterns:

```text
extras/*
*/trailers/*
*/Season 00/*
```

Common file patterns:

```text
*-trailer.*
*-sample.*
*-featurette.*
```

## Ignore Glob Patterns

Ignore patterns use the same glob rules as bonus patterns, but ignored files are never indexed or analyzed.

Examples:

```text
*.nfo
*/.DS_Store
*/@eaDir/*
*.part
*.tmp
```

See [ignore_files_folders.md](ignore_files_folders.md) for more ignore-pattern examples.

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

## External References

Official Python documentation:

- Python `re` regular expressions: https://docs.python.org/3/library/re.html
- Python `fnmatch` glob matching: https://docs.python.org/3/library/fnmatch.html

If you want to experiment with regexes outside MediaLyze, make sure the tool uses Python regex syntax and not a different flavor.
