import { existsSync, readFileSync } from "node:fs";

const settings = { ...process.env };
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !settings[match[1]]) settings[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const missing = [];
if (settings.NEXT_PUBLIC_BILLING_STORAGE !== 'cloud') {
  console.log('Local billing is enabled. No Supabase or Google credentials are required.');
  console.log(`Data directory: ${settings.LOCAL_DATA_DIR || 'data (inside the app folder)'}`);
  process.exit(0);
}
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'BILLING_OWNER_EMAIL', 'GOOGLE_CLIENT_SECRET']) {
  if (!settings[key]) missing.push(key);
}
if (!settings.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
if ((settings.TOKEN_ENCRYPTION_KEY?.length ?? 0) < 32) missing.push('TOKEN_ENCRYPTION_KEY (at least 32 characters)');
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_APP_URL']) {
  if (settings[key]) {
    try { if (!['http:', 'https:'].includes(new URL(settings[key]).protocol)) throw new Error(); }
    catch { missing.push(`${key} (valid HTTP/HTTPS URL)`); }
  }
}
if (missing.length) {
  console.error(`Configuration incomplete:\n${missing.map(key => `- ${key}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Required Supabase and Google settings are present. Live access still needs verification.');
  console.log(`Register this Google Web callback: ${new URL(settings.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').origin}/api/google-drive/callback`);
}
