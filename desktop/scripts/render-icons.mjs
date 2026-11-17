// Renders the app icon (../xdeck-icon.svg) to the PNG files electron-builder needs.
// electron-builder makes the Windows .ico and the Linux icon set from build/icon.png.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, '..', 'xdeck-icon.svg'));
for (const [name, size] of [['icon.png', 1024], ['icon-512.png', 512], ['icon-256.png', 256]]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(root, 'build', name), png);
  console.log(`build/${name} (${size}×${size})`);
}
