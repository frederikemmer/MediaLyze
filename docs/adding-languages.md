# Adding a new interface language

MediaLyze ships the web interface in multiple languages through i18next. This
guide describes the required steps for adding another UI language without
breaking fallback behavior, settings persistence, or existing translation keys.

Use English as the canonical source language. A new language is complete only
when it contains the same key structure as `frontend/locales/en/common.json`.

## 1. Choose the language code

Use a stable BCP 47 language code that i18next and browsers understand. Prefer
the short ISO language code when no regional variant is needed, for example:

- `fr` for French
- `it` for Italian
- `nl` for Dutch
- `uk` for Ukrainian
- `pt-BR` only when the regional variant is intentionally required

The same code must be used in the locale directory, frontend resource map,
language selector, app settings schema, and persisted UI preference handling.

## 2. Add the locale file

Create a new locale directory and copy the English key structure:

```bash
mkdir -p frontend/locales/<language-code>
cp frontend/locales/en/common.json frontend/locales/<language-code>/common.json
```

Translate only the string values. Keep these details unchanged:

- JSON keys and nesting
- interpolation placeholders such as `{{name}}`, `{{count}}`, or `{{value}}`
- pluralization keys such as `_one` and `_other`
- embedded technical identifiers, API values, and file extensions
- intentionally empty strings, if any exist

Validate the JSON after editing:

```bash
python3 -m json.tool frontend/locales/<language-code>/common.json >/dev/null
```

## 3. Add language display labels

Every shipped locale must be able to display the new language in the language
selector. Add a `language.<language-code>` entry to all locale files:

- `frontend/locales/en/common.json`
- `frontend/locales/de/common.json`
- `frontend/locales/es/common.json`
- `frontend/locales/uk/common.json`
- `frontend/locales/<language-code>/common.json`

Example:

```json
{
  "language": {
    "en": "English",
    "de": "German",
    "es": "Spanish",
    "uk": "Ukrainian",
    "<language-code>": "<Language name>"
  }
}
```

Use the translated display name in each language where possible.

## 4. Register the language in the frontend

Update `frontend/src/i18n.ts`:

- import the new `common.json`
- add the language to the `resources` object
- include the language code in the `getInitialLanguage()` return type
- include the language code in the local-storage whitelist in
  `languageChanged`

Update the settings language selector in `frontend/src/pages/LibrariesPage.tsx`:

- add an `<option>` for the new language
- widen the `updateInterfaceLanguage(...)` type so the new code can be saved

Update frontend API typing in `frontend/src/lib/api.ts` so
`ui_preferences.interface_language` accepts the new language code.

If tests or helper factories use a narrow language union, update those test
types and fixtures as well.

## 5. Register the language in the backend

The selected UI language is persisted as part of app settings. Update the
backend so the new code is accepted instead of falling back to English.

Required files:

- `backend/app/schemas/app_settings.py`
- `backend/app/services/app_settings.py`

In the schema, extend the `interface_language` `Literal[...]` type. In the
settings service, extend the accepted-language check used when deserializing UI
preferences.

Do not add a database migration for a new language. The value is stored in the
existing app settings JSON payload.

## 6. Check translation completeness

Run this comparison before opening a PR:

```bash
python3 - <<'PY'
import json
from pathlib import Path

def flatten(value, prefix=""):
    if isinstance(value, dict):
        result = set()
        for key, child in value.items():
            next_prefix = f"{prefix}.{key}" if prefix else key
            result |= flatten(child, next_prefix)
        return result
    return {prefix}

base_path = Path("frontend/locales/en/common.json")
base_keys = flatten(json.loads(base_path.read_text()))

for locale_path in sorted(Path("frontend/locales").glob("*/common.json")):
    keys = flatten(json.loads(locale_path.read_text()))
    missing = sorted(base_keys - keys)
    extra = sorted(keys - base_keys)
    if missing or extra:
        print(locale_path)
        if missing:
            print("  missing:", ", ".join(missing[:40]))
            if len(missing) > 40:
                print(f"  ... and {len(missing) - 40} more")
        if extra:
            print("  extra:", ", ".join(extra[:40]))
            if len(extra) > 40:
                print(f"  ... and {len(extra) - 40} more")
PY
```

The output should be empty. Extra keys usually mean the locale has drifted from
the canonical English structure. Missing keys mean users will see fallback text
or raw translation keys.

## 7. Review quality

Before merging a new language, check:

- the app starts without i18next warnings
- the new language appears in Settings under App settings
- changing the language updates the UI immediately
- the selected language survives a page reload
- no visible text is truncated in common layouts
- placeholders still render correctly in dynamic strings
- technical terms remain consistent with the existing UI

## 8. Run tests

At minimum, run:

```bash
cd frontend && npm run build
cd frontend && npm test
```

If backend language persistence changed, also run the backend test suite:

```bash
uv run pytest
```

For translation-only PRs, mention in the PR description which language was
added, whether the key-completeness script is clean, and which tests were run.
