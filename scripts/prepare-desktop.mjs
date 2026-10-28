import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { productionLockfile } from './production-lock.cjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.desktop-runtime');
if (path.dirname(runtime) !== root || path.basename(runtime) !== '.desktop-runtime') throw new Error('Invalid desktop staging directory.');
if (!process.argv.includes('--stage-only')) await new Promise((resolve, reject) => {
  const build = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build'], {
    cwd: root, env: { ...process.env, NEXT_PUBLIC_BILLING_STORAGE: 'local', NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'inherit', windowsHide: true,
  });
  build.on('error', reject);
  build.on('exit', code => code === 0 ? resolve() : reject(new Error(`Billing build failed (${code}).`)));
});
// Only replace this generated staging folder, never the user's billing data.
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
const serverDirectory = path.join(runtime, 'server');
await mkdir(serverDirectory, { recursive: true });
await cp(path.join(root, '.next'), path.join(serverDirectory, '.next'), { recursive: true, filter: source => !['cache', 'standalone', 'types'].includes(path.relative(path.join(root, '.next'), source).split(path.sep)[0]) });
await cp(path.join(root, 'desktop/web-server.cjs'), path.join(serverDirectory, 'server.js'));
await cp(path.join(root, 'public'), path.join(runtime, 'server/public'), { recursive: true });
const project = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const locked = productionLockfile(yaml.load(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8')));
await writeFile(path.join(serverDirectory, 'package.json'), JSON.stringify({ name: project.name, version: project.version, private: true, dependencies: project.dependencies }, null, 2));
await writeFile(path.join(serverDirectory, 'pnpm-lock.yaml'), yaml.dump(locked, { noRefs: true, lineWidth: -1 }));
// Hoisted production dependencies are real directories: Windows needs no symlink privilege.
await new Promise((resolve, reject) => {
  const command = 'pnpm install --prod --frozen-lockfile --ignore-scripts --ignore-workspace --node-linker=hoisted';
  const install = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', command], { cwd: serverDirectory, stdio: 'inherit', windowsHide: true });
  install.on('error', reject);
  install.on('exit', code => code === 0 ? resolve() : reject(new Error(`Offline dependency packaging failed (${code}).`)));
});
await cp(process.execPath, path.join(runtime, 'node.exe'));
await cp(path.join(root, 'desktop/assets/Node-LICENSE.txt'), path.join(runtime, 'Node-LICENSE.txt'));
// Retain the bundled Node runtime's upstream license when it is supplied with it.
for (const filename of ['LICENSE', 'LICENSE.txt']) {
  try { await cp(path.join(path.dirname(process.execPath), filename), path.join(runtime, 'Node-LICENSE.txt')); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.env') || entry.name === 'billing.sqlite') throw new Error(`Private file must not be packaged: ${entry.name}`);
    if (entry.isDirectory()) await check(path.join(directory, entry.name));
  }
}
await check(runtime);
console.log(`Desktop runtime prepared at ${runtime}. No customer data or environment credential files are included.`);
