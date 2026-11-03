import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export function verifyCashBookPreviewDirectory(root, configured) {
  const expected = path.resolve(root, 'tmp', 'cashbook-website-demo');
  if (!configured || path.resolve(configured) !== expected) throw new Error('Cash-book preview requires the explicit synthetic sample directory; real ledger fallback is forbidden.');
  if (realpathSync(expected) !== expected || readFileSync(path.join(expected, '.cashbook-demo'), 'utf8') !== 'synthetic-cashbook-preview-v1') throw new Error('Missing or invalid cash-book demo directory marker.');
  return expected;
}

