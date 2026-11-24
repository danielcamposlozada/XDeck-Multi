# XDeck Multi for Windows and Linux

The Windows and Linux edition of XDeck Multi: a port of the macOS app to Electron and TypeScript, with the same columns, the same `settings.json` and the same scripts (from [`../shared`](../shared)).

## Requirements

- Node.js 22.12 or newer (CI uses Node 24)
- Linux: the usual Electron libraries (GTK 3, NSS). The AppImage needs FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04 and Linux Mint 22).

## Develop

```sh
cd desktop
npm ci
npm start          # build and open the app
npm run check      # type check, lint and unit tests
npm run smoke      # open the app and quit once the first screen is ready
```

Development-only environment variables (ignored in packaged builds):

| Variable | Effect |
|---|---|
| `XDECK_CONFIG_DIR=/some/folder` | Reads `settings.json` from that folder instead of the real one. |
| `XDECK_SKIP_LOGINS=1` | Goes straight to the columns, as if every login was skipped. |
| `XDECK_CAPTURE_DIR=/some/folder` | After `XDECK_CAPTURE_DELAY` seconds (15 by default), saves a PNG of each visible view and quits. |

`Ctrl+Shift+I` opens the developer tools of the focused page in development builds.

## Package

```sh
npm run dist:linux   # release/XDeck-Multi-<version>-x86_64.AppImage and release/xdeck-multi_<version>_amd64.deb
npm run dist:win     # release/XDeck-Multi-Setup-<version>.exe (run it on Windows, or let CI do it)
```

`npm run icons` renders `build/icon*.png` from [`../xdeck-icon.svg`](../xdeck-icon.svg). The PNG files are committed, so packaging doesn't need it.

## Layout

| Path | What it is |
|---|---|
| `src/main/main.ts` | Entry point: settings folder, user agent, single instance. |
| `src/main/deck.ts` | The window: login screens, columns, toolbar actions, shortcuts. |
| `src/main/config.ts` | `settings.json`, account keys and column URLs. |
| `src/main/layout.ts` | Column widths, the same math as the macOS `ContentView`. |
| `src/main/scripts.ts` | Builds each page's script from `shared/scripts`. |
| `src/preload/column.ts` | Gives the shared scripts `webkit.messageHandlers.handler` and runs them. |
| `src/preload/host.ts`, `src/renderer/` | The host page: toolbar, login banner and scroll bar. |
| `test/` | Unit tests (Vitest), including a check that `shared/` matches the macOS edition. |

How it works is explained in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
