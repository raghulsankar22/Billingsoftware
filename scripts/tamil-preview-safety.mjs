import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export function verifyTamilPreviewDirectory(root, configured) {
  const expected = path.resolve(root, 'tmp', 'tamil-website-demo');
  if (!configured || path.resolve(configured) !== expected) throw new Error('Tamil preview requires the explicit synthetic sample directory; real ledger fallback is forbidden.');
  if (realpathSync(expected) !== expected || readFileSync(path.join(expected, '.tamil-demo'), 'utf8') !== 'synthetic-tamil-preview-v1') throw new Error('Missing or invalid Tamil demo directory marker.');
  return expected;
}
