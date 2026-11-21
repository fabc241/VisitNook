// Packs p2p/worker.js into p2p/build (a Bare worklet the app starts), then
// checks that every native addon it needs is already linked into the iOS app.
//
// The P2P worklet does not link addons of its own: it reuses the ones the QVAC
// Expo plugin links for the QVAC worker (ios/QvacBareKit/Frameworks). If a
// version ever differs, the worklet would fail on the phone, so this fails here.
//
// Run with `npm run p2p:pack` (also runs after `npm install`).

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'p2p', 'build');
const frameworks = path.join(root, 'ios', 'QvacBareKit', 'Frameworks');

// Pack into a scratch folder, then copy over p2p/build file by file. Deleting
// and recreating the folder can make Metro's watcher keep serving the old bundle.
const scratch = mkdtempSync(path.join(tmpdir(), 'visit-notes-p2p-'));
// bare-stow names the package after its folder, so it must be a valid name.
const packed = path.join(scratch, 'build');
try {
  execFileSync(
    process.execPath,
    [path.join(root, 'node_modules', 'bare-stow', 'bin.js'), 'pack', '--target', 'react-native', '--out', packed, path.join(root, 'p2p', 'worker.js')],
    { cwd: root, stdio: 'inherit' },
  );
  mkdirSync(out, { recursive: true });
  for (const name of readdirSync(packed)) copyFileSync(path.join(packed, name), path.join(out, name));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const bundle = readFileSync(path.join(out, 'index.bundle.mjs'), 'utf8');
const needed = [...new Set([...bundle.matchAll(/linked:([^"\\/]+)\.framework\//g)].map((m) => m[1]))].sort();

if (!existsSync(frameworks)) {
  console.warn(`[p2p] packed. ios/ not generated yet, so the addons (${needed.join(', ')}) were not checked.`);
  process.exit(0);
}

const linked = new Set(readdirSync(frameworks).map((name) => name.replace(/\.xcframework$/, '')));
const missing = needed.filter((name) => !linked.has(name));
if (missing.length > 0) {
  console.error(
    `[p2p] These addons are not linked into the iOS app: ${missing.join(', ')}.\n` +
      '      Pin the P2P packages to the versions the QVAC worker uses, or link them in prebuild.',
  );
  process.exit(1);
}
console.log(`[p2p] packed; all ${needed.length} addons are already linked: ${needed.join(', ')}`);
