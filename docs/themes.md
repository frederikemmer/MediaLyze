# Color Themes

MediaLyze supports three color theme preferences: **System** (default), **Light**, and **Dark**.

## Where to change it

Open **Settings → App Settings → Color theme** and select your preference from the dropdown.
The change is applied immediately and persists across page refreshes.

## How it works

### Preference storage

The selected preference (`system`, `light`, or `dark`) is stored in the browser's `localStorage` under the key `medialyze-theme`. It defaults to `system` when no preference has been saved.

### Theme resolution

| Preference | Effective theme |
|------------|----------------|
| `system`   | Follows the OS/browser `prefers-color-scheme` media query. Updates live if the OS theme changes. |
| `light`    | Always light. |
| `dark`     | Always dark. |

### Application

The resolved theme is applied as a `data-theme` attribute on the `<html>` element:

```html
<html data-theme="dark">
```

All dark mode overrides are scoped to `html[data-theme="dark"]` CSS selectors.

### CSS architecture

Dark mode overrides are appended at the bottom of two CSS files:

- `frontend/globals.css` — CSS variable overrides (`--bg`, `--ink`, `--panel`, …) and resets for `html` background gradients and global element styles (`input`, `select`, `button.secondary`, etc.)
- `frontend/src/medialyze.css` — component-level overrides that target hardcoded `rgba(255,255,255,x)` whites, `rgba(31,28,22,x)` ink overlays, and teal accent text (`#0e6b62` → `#3ec5b8`)

### React context

Theme logic lives in `frontend/src/lib/theme.tsx`:

- `ThemeProvider` — reads the stored preference, applies the `data-theme` attribute on mount and whenever the preference changes, and listens for OS theme changes when in `system` mode.
- `useTheme()` — returns `{ preference, setPreference }` for any component that needs to read or update the active preference.

`ThemeProvider` wraps the entire application in `App.tsx` as the outermost provider.
