// Release file names use the same MAJOR.MINOR.PATCH version as the macOS edition and the git tags
// (for example 1.0.0), so the release assets match on every platform.
const { version } = require('./package.json');

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.danielcamposlozada.XDeckMulti',
  productName: 'XDeck Multi',
  copyright: 'Copyright © 2023 Shintaro Morikawa, © 2026 Daniel Campos Lozada',
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**/*', '!dist/**/*.map', 'build/icon-512.png', 'package.json'],
  extraResources: [{ from: '../shared', to: 'shared', filter: ['**/*', '!README.md'] }],
  publish: null,
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Network',
    executableName: 'xdeck-multi',
    syncDesktopName: true,
    icon: 'build/icon.png',
    synopsis: 'Multi-account, TweetDeck-style X client',
    description: 'XDeck Multi shows several X timelines side by side, each column with its own account. A fork of XDeck.',
  },
  appImage: { artifactName: `XDeck-Multi-${version}-x86_64.AppImage` },
  deb: { artifactName: `xdeck-multi_${version}_amd64.deb` },
  win: { target: ['nsis'], icon: 'build/icon.png' },
  nsis: {
    artifactName: `XDeck-Multi-Setup-${version}.exe`,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
};
