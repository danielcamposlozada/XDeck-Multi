# Architecture

XDeck Multi shows X (x.com) in several columns, each one a full web page, and changes those pages with small injected scripts. It doesn't use X's API and has no server.

There are two editions of the app in this repository:

| | macOS | Windows and Linux |
|---|---|---|
| Folder | `XDeck/`, `XDeck.xcodeproj` | `desktop/` |
| Language | Swift, SwiftUI | TypeScript (strict) |
| Web engine | WebKit (`WKWebView`) | Chromium (Electron `WebContentsView`) |
| Session per account | `WKWebsiteDataStore(forIdentifier:)` | `session.fromPartition('persist:account-<key>')` |
| Settings | `~/.config/XDeckMulti/settings.json` (inside the app container) | `~/.config/XDeckMulti/settings.json`, `%APPDATA%\XDeckMulti\settings.json` |

Both read the same `settings.json` format and run the same scripts from [`shared/`](../shared).

## Columns

`settings.json` lists the columns:

```json
{
  "columnWidth": 400,
  "columns": [
    { "type": "following" },
    { "type": "notifications" },
    { "type": "following", "account": "work" },
    { "type": "profile", "account": "work" }
  ]
}
```

| `type` | Page |
|---|---|
| `forYou` | `x.com/home`, then a script clicks the "For you" tab |
| `following` | `x.com/home`, then a script clicks the "Following" tab |
| `notifications` | `x.com/notifications` |
| `profile` | The profile of the column's account |
| `custom` | Any `url` (lists, searches, other sites) |

Without `columnWidth`, the columns share the window's width.

## Accounts

The `account` of a column names an X account. The **account key** is that name trimmed and in lowercase, so `"Work"` and `" work "` are the same account; a column without `account` (or with an empty one) uses the **default session**.

Each account key gets its own persistent browser session: its own cookies and storage, so each account stays signed in on its own.

- macOS: the default session is `WKWebsiteDataStore.default()`, as in XDeck, so existing logins keep working. Other accounts use `WKWebsiteDataStore(forIdentifier:)` with a UUID derived from the key (SHA-256), which needs macOS 14. On macOS 13 they use a session that lasts until the app quits.
- Windows and Linux: `persist:default` and `persist:account-<key>`.

### Login

On launch the app goes through the accounts the X columns need, in the order they first appear, and shows X's login page for each one in its session. When the page shows the signed-in user's profile link, a script reports the user name (`findUserName.js`). The app keeps the profile URL and moves to the next account, so accounts that are already signed in pass through on their own.

With more than one account, the login screen names the account and offers **Skip for now**. A skipped account's columns show X's own login page, where you can still sign in.

### Side navigation

X's side navigation (the menu, the Post button and the avatar) stays on the first X column of each account and is hidden on the rest (`hideSideHeader.js`, `hidePostArea.js`). That way each account can post, and you can see whose columns are whose. Those two scripts give their styles ids (`xdeck-hide-side-header`, `xdeck-hide-post-area`), so when moving columns changes which one is first, the app adds or removes the styles on the open page instead of reloading it.

## Moving columns

Every column has an id that stays the same while the app runs; moving, adding or removing columns never rebuilds the pages of the columns that stay. Dragging a column by its title bar moves the whole column with the pointer, and the others slide aside once it passes their middle. The order is saved to `settings.json` on drop, keeping the file's other keys. The **Columns** window does the same with a list, and adds search columns (`https://x.com/search?q=…&f=live`).

## Scripts

The scripts in `shared/scripts/` run inside x.com and talk back to the app with `webkit.messageHandlers.handler.postMessage(json)`:

| Script | Runs | Does |
|---|---|---|
| `console.js`, `getElementsByXPath.js`, `waitForElement.js` | At page start | Forwards errors to the app; helpers. |
| `detectMediaOverlay.js` | At page start | Reports when a photo or video opens, so its column fills the window. |
| `findUserName.js` | After load (login) | Reports the signed-in user name. |
| `findThemeColor.js` | After load (every X column, login) | Reports X's theme color; the app follows it (light or dark). |
| `clickForYouTab.js`, `clickFollowingTab.js` | After load | Selects the timeline tab. |
| `hideSideHeader.js`, `hidePostArea.js` | After load | Hides the side navigation and the post box. |
| `hideAds.js`, `showAds.js` | After load, or on toggle | Hides or shows promoted posts. |
| `setNightMode.js` | On toggle | Sets X's `night_mode` cookie and reloads. |

On macOS they are `WKUserScript`s. In the Windows and Linux edition, a sandboxed preload (`desktop/src/preload/column.ts`) defines the same `webkit.messageHandlers.handler.postMessage` with `contextBridge` and sends the messages over IPC, so the scripts run unchanged.

The macOS edition still embeds its own copy of the scripts in `WebViewConfigurations.swift`. `desktop/test/shared.test.ts` fails if the two copies differ.

## Windows and Linux edition

- One `BaseWindow`. A **host page** (`desktop/src/renderer/`) fills it and draws the column title bars, the toolbar, the Columns window, the login banner and the horizontal scroll bar. While a column is dragged, the host page animates the title bars and reports each frame (`xdeck:host-drag-frame`), and the main process moves the web views to match. The Columns window hides the web views while it's open, since they sit above the host page. Each column is a `WebContentsView` placed on top of the host page: the host page reports where its columns area is and how far it's scrolled, and the main process positions the views (`layout.ts`).
- Sideways scrolling over a column (touchpad, Shift + wheel) is forwarded to the host page's scroll bar.
- The user agent is Chrome's, without "Electron".
- Pages run with `contextIsolation` and `sandbox` on and no Node.js. Links to other sites open in the default browser. Only clipboard and full-screen permissions are granted.
- Keyboard shortcuts (`Ctrl` +/−/./R/F/,) are handled in the main process (`before-input-event`), so they work wherever the focus is.

## Known limitations

- **Passkeys** don't work inside an embedded web view. Sign in with your password (and 2FA code).
- **"Continue with Google/Apple"** may fail; user name and password always work.
- **x.com changes**: the scripts rely on X's markup (`data-testid` and similar). If X changes it, a feature can break until the scripts are updated.
- **Memory**: every column is a full X page.
