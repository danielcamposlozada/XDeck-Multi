# Contributing

Thanks for helping with XDeck Multi.

- **Bugs:** open an issue with your system, the app version, what you did and a screenshot. 𝕏 changes its website often, so say which column type shows the problem.
- **Ideas:** open an issue before a large pull request, so we can agree on the approach.
- **Pull requests:** keep them small and in the style of the code around them. Work on a branch named `feature/<topic>` or `fix/<topic>`.

## Before you open a pull request

- macOS: the app builds with Xcode 26 without new warnings (see the README for the command).
- Windows and Linux: `npm run check` passes in `desktop/`.
- If you change a page script, change it in `XDeck/WebViewConfigurations.swift` and in `shared/scripts/` alike. `npm run check` fails when they differ.
- Add a line to `CHANGELOG.md`.
