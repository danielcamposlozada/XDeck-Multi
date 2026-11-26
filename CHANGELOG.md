# Changelog

All notable changes to XDeck Multi are documented here. XDeck Multi is a fork of [XDeck](https://github.com/morishin/XDeck) 3.3.

## 1.2.1

### Fixed
- Moving a column no longer reloads pages. When a column becomes (or stops being) an account's first column, 𝕏's side navigation now appears or hides in place (macOS).

## 1.2.0

### Added
- Search columns from the Columns window: pick **Search**, type a query such as `from:NASA`, and the column shows the latest posts (macOS).
- Right-click a column's title bar to **Move Left** or **Move Right**, also available to VoiceOver (macOS).
- The sign-in screen shows which account comes next ("Account 2 of 3").
- A clear error screen with an **Open Settings Folder** button when `settings.json` can't be read (macOS).

### Changed
- Dragging a column now moves the whole column: it follows the cursor, the others slide out of its way, and the slot it will land in stays marked. No column reloads until the drop. Honors **Reduce motion** (macOS).
- Redesigned bottom toolbar: real buttons with icons and tooltips for zoom, refresh, fit and settings instead of shortcut labels, the zoom level as a percentage (click to reset), and grouped controls (macOS).
- Zoom moves in 10% steps between 50% and 250%.
- Search columns are named after their query, with a magnifying glass, in the title bars and the Columns window (macOS).
- The Hide Ads and dark mode switches respond to clicks on their label too and work with VoiceOver (macOS).
- Clearer wording in the settings prompt.

### Fixed
- macOS's window tab bar no longer takes space above the columns.

## 1.1.0

### Added
- Drag a column by its title bar and drop it on another column's title bar to move it, right in the main window (macOS). A line shows where it will land, and the new order is saved to `settings.json`.

## 1.0.0

### Added
- Multiple 𝕏 accounts in the same window: each column can use a different account through the `account` field in `settings.json`.
- Isolated, persistent login session per account.
- Guided sign-in for each account, with a banner showing which account is being signed in and a "Skip for now" option.
- **Columns** button in the bottom toolbar to add, remove and reorder columns without editing `settings.json` (macOS). Changes apply right away.
- A title bar on each column with its type and the account's @handle (macOS).
- `search` column type: 𝕏's Explore page, with its search box.
- Windows and Linux edition (Electron + TypeScript) with the same settings and the same page scripts.

### Changed
- Renamed to XDeck Multi, with its own bundle identifier (`com.danielcamposlozada.XDeckMulti`) so it can be installed next to the original XDeck.
- Settings now live in `~/.config/XDeckMulti/`.
- The update check and the GitHub button point to this fork.
- 𝕏's iPhone-style navigation bar at the bottom of narrow columns is hidden, and only the first column of each account keeps the floating Post button.
- Fewer redraws: the console messages 𝕏 writes no longer redraw every column, and a removed column frees its memory.

### Fixed
- The app no longer stays on the login screen after signing in: 𝕏 removed the attributes the app used to find the profile link.

### Removed
- The "Buy me a coffee" button.
