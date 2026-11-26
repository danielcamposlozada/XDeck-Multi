# Changelog

All notable changes to XDeck Multi are documented here. XDeck Multi is a fork of [XDeck](https://github.com/morishin/XDeck) 3.3.

## 1.4.1

### Changed
- **You can follow every video download.** The ⬇︎ button turns into a ring with the percentage while the video downloads, a green ✓ when it's saved and an orange ⚠︎ if it fails (click it to try again).
- The bottom toolbar shows a progress bar with the percentage and megabytes ("45% · 12.0 MB of 40.0 MB"), then **Saved to Downloads** with the file name and **Show in Finder** (or **Show in folder**).
- When a download finishes, the Downloads stack in the Dock bounces and, if XDeck Multi is in the background, its icon asks for attention once (macOS). Windows and Linux show the progress on the taskbar and flash the window when it's done.

## 1.4.0

### Added
- **Download videos and GIFs.** Each video and GIF in an 𝕏 column gets a ⬇︎ button. The app saves the best quality 𝕏 offers to your Downloads folder, named after the account and the post (`x-NASA-1234567890.mp4`), and a notice in the toolbar shows the file. Only files from 𝕏's video server are downloaded, and nothing is overwritten.

## 1.3.0

The Windows and Linux edition catches up with macOS.

### Added
- A title bar on each column with its type, its name (a search shows its query) and its account (Windows and Linux).
- Drag a column by its title bar to move it: the whole column follows the pointer, the others slide out of its way, and the slot it will land in stays marked. Honors reduced motion. Right-click a title bar for **Move Left**, **Move Right** and **Edit Columns…**, or press Alt+← / Alt+→ on a focused title bar (Windows and Linux).
- **Columns** window to add, remove and reorder columns, with search columns from a query such as `from:NASA` and new accounts. Changes apply right away and are saved to `settings.json` (Windows and Linux).
- The sign-in screen shows which account comes next ("Account 2 of 3") (Windows and Linux).

### Changed
- Redesigned bottom toolbar, as on macOS: icon buttons with tooltips, the zoom level as a percentage, grouped controls (Windows and Linux).
- Zoom moves in 10% steps between 50% and 250% (Windows and Linux).
- Moving, adding or removing columns never reloads the pages of the columns that stay; 𝕏's side navigation moves to the new first column in place (Windows and Linux).
- Clearer settings prompt and error screen (Windows and Linux).

### Removed
- The "Buy me a coffee" button from the Windows and Linux toolbar, as on macOS since 1.0.0.

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
