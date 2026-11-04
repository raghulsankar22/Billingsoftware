// Regenerates the phone home-screen icons from the business logo: node scripts/make-app-icons.mjs
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logo = path.join(root, 'public/business-logo.jpg');
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  // The logo sits on a white square with a margin so Android can round the corners without clipping it.
  const inner = Math.round(size * 0.8);
  const mark = await sharp(logo).resize(inner, inner, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background: '#ffffff' } })
    .composite([{ input: mark, gravity: 'centre' }]).png().toFile(path.join(root, 'public/icons', name));
}
console.log('Icons written to public/icons');
