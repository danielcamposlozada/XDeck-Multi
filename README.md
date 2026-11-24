# XDeck

[![license](https://img.shields.io/npm/l/svelte.svg)](LICENSE)

<img width="120" height="120" alt="XDeck-iOS-Default-1024x1024@1x" src="https://github.com/user-attachments/assets/b0076952-c7b4-4024-a337-8df37c05f88c" />

An 𝕏 client app for macOS as a TweetDeck alternative (with Ad-Blocking).

[Download](https://github.com/morishin/XDeck/releases/latest)

![スクリーンショット 2024-06-14 0 25 40](https://github.com/morishin/XDeck/assets/1413408/855cbc09-8b2e-4f68-8f7d-1952f3daf060)

## Installation

Download from [Releases](https://github.com/morishin/XDeck/releases/latest), or install via [Homebrew](https://brew.sh/):

```sh
brew install --cask xdeck
```

## Configuration

Click **Columns** in the bottom toolbar to add, remove and reorder columns. Changes apply right away and are saved to `settings.json`. Each column shows its type and account at the top.

Column types: `forYou`, `following`, `notifications`, `profile`, `search` (𝕏's Explore page, with the search box) and `custom` (any URL, such as a list).

For everything else, press `⌘,` and edit `settings.json`.

Example

```json
{
  "$schema": "./schema.json",
  "columnWidth": 450,
  "columns": [
    {
      "type": "following"
    },
    {
      "type": "forYou"
    },
    {
      "type": "notifications"
    },
    {
      "type": "profile"
    },
    {
      "type": "custom",
      "url": "https://x.com/i/lists/123456789"
    }
  ]
}
```

### Multiple accounts

Add `"account"` to a column to show it with another 𝕏 account. Columns with the same account name share one login; columns without one use the default login. Account names are case-insensitive.

```json
{
  "$schema": "./schema.json",
  "columnWidth": 400,
  "columns": [
    { "type": "following" },
    { "type": "notifications" },
    { "type": "following", "account": "work" },
    { "type": "notifications", "account": "work" },
    { "type": "profile", "account": "work" }
  ]
}
```

On launch, XDeck shows a login screen for each account that isn't signed in yet, one at a time (accounts that are already signed in pass through on their own). "Skip for now" leaves an account signed out; its columns then show 𝕏's own login page. The first column of each account keeps 𝕏's side navigation, so every account has its own Post button. Each account's session is kept separately on disk (requires macOS 14 or later; on older versions it lasts until the app quits).
