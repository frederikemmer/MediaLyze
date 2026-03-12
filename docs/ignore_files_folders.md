# Ignore Files And Folders

MediaLyze ignore rules use glob patterns.

They are matched against the normalized path relative to the library root.

The settings UI separates:

- custom ignore patterns
- default ignore patterns

Both sections are fully editable and removable.

Examples:

- `movie.nfo`
- `Season 1/Extras/behind-the-scenes.mkv`
- `Samples/trailer-1080p.mkv`

## Built-in defaults

MediaLyze preloads these default ignore patterns on fresh installations:

```text
*/.DS_Store
*/._*
*/@eaDir/*
*/#recycle/*
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

Set `DISABLE_DEFAULT_IGNORE_PATTERNS=true` to skip preloading this built-in list. The defaults section remains visible in the UI so you can still add or edit entries manually.

## Common patterns

Ignore all files with one extension:

```text
*.nfo
```

Ignore everything below one top-level folder:

```text
Extras/*
Sample/*
```

Ignore folders by name anywhere in the library:

```text
*/Sample/*
```

Ignore paths that contain a word:

```text
*trailer*
```

## How matching works

- Matching is done against the relative path inside the library, not just the filename.
- `/` is used as the path separator.
- `*` matches any number of characters.
- Patterns can match files, folders, or both depending on the path.
- Folder patterns such as `*/Extras/*` skip the whole folder and everything below it.

## Practical examples

Ignore metadata sidecar files:

```text
*.nfo
*.png
```

Ignore extra material:

```text
Extras/*
*/Sample/*
*trailer*
```

Ignore generated subtitle index files:

```text
*.idx
*.sub
```
