# Changelog

All notable changes to XDeck Multi are documented here. XDeck Multi is a fork of [XDeck](https://github.com/morishin/XDeck) 3.3.

## 1.0

### Added
- Multiple 𝕏 accounts in the same window: each column can use a different account through the `account` field in `settings.json`.
- Isolated, persistent login session per account.
- Guided sign-in for each account, with a banner showing which account is being signed in and a "Skip for now" option.

### Changed
- Renamed to XDeck Multi, with its own bundle identifier (`com.danielcamposlozada.XDeckMulti`) so it can be installed next to the original XDeck.
- Settings now live in `~/.config/XDeckMulti/`.
- The update check and the GitHub button point to this fork.

### Removed
- The "Buy me a coffee" button.
