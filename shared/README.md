# shared

Files used by both editions of XDeck Multi.

| File | What it is |
|---|---|
| `schema.json` | JSON Schema of `settings.json` (copied next to the user's settings on every launch). |
| `settings.json` | The `settings.json` created on first launch. |
| `scripts/*.js` | The scripts injected into x.com, one per feature. |

The scripts are the same ones the macOS edition embeds in `XDeck/WebViewConfigurations.swift`. Placeholders:

- `__COLUMN_INDEX__` (`detectMediaOverlay.js`): the column's index.
- `__NIGHT_MODE__` (`setNightMode.js`): `1` for dark mode, `0` for light mode.

Until the macOS edition loads them from here, `desktop/test/shared.test.ts` checks that both copies stay identical. If you change a script, change it in both places.
