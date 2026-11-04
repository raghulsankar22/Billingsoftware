// Shared by the billing server (desktop/web-server.cjs) and the website's admin screen.
// Phone access is off until an administrator turns it on. When it is on, a second listener accepts
// connections only from this computer's own network and from private networks such as Tailscale.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const phonePort = 3120;
const settingsName = 'phone-access.json';
// A header only the phone listener may set. The server removes it from every incoming request first.
const phoneHeader = 'x-billing-phone';

function ipv4Parts(address) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(part => part <= 255) ? parts : null;
}

/** Loopback, home/office networks (10.x, 172.16-31.x, 192.168.x), link-local and Tailscale's 100.64.0.0/10 range. */
function isPrivateAddress(raw) {
  if (typeof raw !== 'string') return false;
  let address = raw.trim().toLowerCase();
  if (address.startsWith('::ffff:')) address = address.slice(7);
  const parts = ipv4Parts(address);
  if (parts) {
    const [a, b] = parts;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (address === '::1') return true;
  return /^f[cd][0-9a-f]{2}:/.test(address) || /^fe[89ab][0-9a-f]:/.test(address);
}

/** Blocks DNS-rebinding: the address bar must show an IP address, this computer's name, or a private-network name. */
function isAllowedHost(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader || hostHeader.length > 255) return false;
  const host = hostHeader.startsWith('[') ? hostHeader.slice(1, hostHeader.indexOf(']')) : hostHeader.replace(/:\d+$/, '');
  if (!host) return false;
  if (ipv4Parts(host) || host.includes(':')) return true;
  const name = host.toLowerCase();
  return !name.includes('.') || /\.(ts\.net|local|lan|home\.arpa)$/.test(name);
}

function settingsPath(directory) { return path.join(directory, settingsName); }
function phoneAccessEnabled(directory) {
  try { return JSON.parse(fs.readFileSync(settingsPath(directory), 'utf8')).enabled === true; } catch { return false; }
}
function setPhoneAccess(directory, enabled) {
  const target = settingsPath(directory);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify({ enabled: enabled === true, changedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(`${target}.tmp`, target);
}

/** Addresses a phone could type, labelled so the owner can tell the shop Wi-Fi from Tailscale. */
function phoneAddresses(interfaces = os.networkInterfaces(), port = phonePort) {
  const found = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const item of addresses ?? []) {
      if (item.family !== 'IPv4' || item.internal || !isPrivateAddress(item.address) || item.address.startsWith('169.254.')) continue;
      const parts = ipv4Parts(item.address);
      const tailscale = parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
      found.push({ kind: tailscale ? 'tailscale' : 'wifi', adapter: name, url: `http://${item.address}:${port}` });
    }
  }
  return found.sort((left, right) => (left.kind === right.kind ? left.url.localeCompare(right.url) : left.kind === 'tailscale' ? -1 : 1));
}

module.exports = { phonePort, phoneHeader, isPrivateAddress, isAllowedHost, phoneAccessEnabled, setPhoneAccess, phoneAddresses };
