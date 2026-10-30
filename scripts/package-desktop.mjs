import { spawn } from 'node:child_process';
import { readFile, writeFile, stat, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../desktop/updates.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version, name } = JSON.parse(await readFile(path.join(root, 'desktop/package.json'), 'utf8'));
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'), '--projectDir', 'desktop', '--config', '../electron-builder.cjs', '--win', 'nsis', '--x64'],
    { cwd: root, stdio: 'inherit', windowsHide: true });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Packaging failed (${code}).`)));
});
const filename = `Finance-Billing-Setup-${version}.exe`;
const directory = path.join(root, 'release', version);
const installer = path.join(directory, filename);
const manifest = { application: name, version, file: filename, sha256: await sha256(installer), size: (await stat(installer)).size };
await writeFile(path.join(directory, 'update.json'), JSON.stringify(manifest, null, 2));
// Publish only after the installer has finished. Readers see either complete manifest.
const latest = path.join(root, 'release', 'latest.json');
await writeFile(`${latest}.tmp`, JSON.stringify({ ...manifest, file: `${version}/${filename}` }, null, 2));
await rename(`${latest}.tmp`, latest);
console.log(`Offline update ${version} published to ${latest}`);
