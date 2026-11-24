// Copies the host page's static files next to the compiled JavaScript.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src', 'renderer');
const to = join(root, 'dist', 'renderer');
mkdirSync(to, { recursive: true });
for (const file of ['host.html', 'host.css']) {
  cpSync(join(from, file), join(to, file));
}
