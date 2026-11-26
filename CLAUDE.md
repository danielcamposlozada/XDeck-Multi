# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

XDeck is a native macOS desktop app — a TweetDeck-style X/Twitter client with ad-blocking. It renders X.com inside WKWebView columns and injects JavaScript to customize the UI (hide ads, detect themes, extract usernames).

## Build & Run

- **Open in Xcode**: `open XDeck.xcodeproj`
- **Build**: `xcodebuild -scheme XDeck -configuration Debug build` (or Cmd+B in Xcode)
- **Run**: Cmd+R in Xcode
- **Deployment target**: macOS 13.3+
- **No external dependencies** — uses only Apple frameworks (SwiftUI, WebKit, AppKit)
- **No test targets** exist in the project

## Architecture

MVVM pattern with JavaScript injection for web content manipulation.

### Key flows

1. **Login**: `XDeckApp` → `LoginView` (WKWebView on x.com/login) → on successful login, username is extracted via JS and stored in `@AppStorage`
2. **Main UI**: `ContentView` manages a horizontal `ScrollView` of `WebView` columns, each loading a different X.com URL based on `AppConfig`
3. **JS Injection**: `WebViewConfigurations` builds `WKWebViewConfiguration` with multiple `WKUserScript`s injected at document end — handles ad hiding, theme detection, UI element removal, and message passing back to Swift via `WKScriptMessageHandler`
4. **Multiple accounts**: a column can set `account` in `settings.json`. Each account key (trimmed, lowercased; `""` is the default session) maps to its own persistent `WKWebsiteDataStore` via `AccountSessions` in `WebViewConfigurations.swift` (`WKWebsiteDataStore(forIdentifier:)` with a UUID derived from the key; the default session stays `.default()`). On launch `ContentView` shows `LoginView` once per account key, in column order (`pendingLoginAccountKey`; accounts already signed in pass through, others can be skipped), and stores each account's profile URL in `profileUrls`. The first X column of each account keeps X's side header; the others hide it.

### Important files

- `XDeck/XDeckApp.swift` — App entry point, loads config
- `XDeck/View/ContentView.swift` — Multi-column layout, keyboard shortcuts, toolbar
- `XDeck/View/WebView.swift` — `NSViewRepresentable` WKWebView wrapper with custom user agent
- `XDeck/WebViewConfigurations.swift` — All JavaScript injection logic (ad blocking, theme detection, username extraction)
- `XDeck/Config/AppConfig.swift` — JSON config model (`~/.config/XDeckMulti/settings.json`)

### Configuration

User settings live at `~/.config/XDeckMulti/settings.json`. Schema at `~/.config/XDeckMulti/schema.json`. Column types: `forYou`, `following`, `notifications`, `profile`, `search` (𝕏's Explore page, with its search box), `custom` (arbitrary URL). The **Columns** button in the bottom toolbar (`ColumnsSheet`) adds, removes and reorders columns and writes them back with `AppConfig.saveColumns`, keeping the file's other keys. Columns can also be dragged by their title bar onto another column's title bar (`ColumnDropDelegate` in `ContentView.swift`); drops are only accepted on title bars because the WKWebViews take text drags themselves.

## public/

Static landing page website — separate from the macOS app. Not part of the Xcode build.

## Release

Releases are built by `.github/workflows/release.yml`, triggered by pushing a version tag.

- **Tag format**: plain `MAJOR.MINOR.PATCH` (e.g. `1.0.0`), **no `v` prefix**. The tags `1.0` to `3.3` in this fork belong to the original XDeck, so XDeck Multi always uses three numbers. Both editions' update checks (`XDeck/View/UpdateButton.swift`, `desktop/src/main/version.ts`) parse the version from the `releases/latest` redirect.
- **What it builds**: the macOS app (ad-hoc signed, `XDeck-Multi-<version>-macOS.zip`), the Windows installer and the Linux AppImage and .deb, then a **draft** release with every file and its SHA-256. Publish the draft by hand after checking it.
- **Runner requirement**: the macOS job runs on `macos-26` with Xcode 26 explicitly selected. `XDeck/XDeck.icon` uses the Icon Composer (`.icon`) format introduced in Xcode 26; older Xcode versions ship an app with no icon. GitHub's macOS runners are sometimes unavailable ("not acquired by Runner"); re-run the job, or build the zip locally with the README command and attach it.
- **No Apple or Microsoft signing**: the README explains the first launch on each system.

To release: set `MARKETING_VERSION` in `project.pbxproj` (CI overrides it from the tag anyway), add the version to `CHANGELOG.md`, then `git tag X.Y.Z && git push origin X.Y.Z`.
