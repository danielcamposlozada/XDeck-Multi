# Changelog

All notable changes to XDeck Multi are documented here. XDeck Multi is a fork of [XDeck](https://github.com/morishin/XDeck) 3.3.

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
