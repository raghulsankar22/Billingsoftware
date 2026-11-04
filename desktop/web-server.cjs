// Installed beside the production .next build, never inside Electron's renderer.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const next = require('next');
const { phonePort, phoneHeader, isPrivateAddress, isAllowedHost, phoneAccessEnabled } = require('./phone-access.cjs');
const port = Number(process.env.PORT || 3100);
const hostname = '127.0.0.1';
const dataDirectory = path.resolve(process.env.LOCAL_DATA_DIR || path.resolve(process.cwd(), 'data'));
// Only the phone listener knows this value, so a request cannot claim to have come through it.
const phoneSecret = randomBytes(32).toString('hex');
process.env.BILLING_PHONE_SECRET = phoneSecret;
const conf = JSON.parse(fs.readFileSync('.next/required-server-files.json', 'utf8')).config;
const application = next({ dev: false, dir: process.cwd(), hostname, port, conf });
const handler = application.getRequestHandler();

application.prepare().then(() => {
  // Everything on the normal listener is treated as this computer: the header is always removed first.
  const server = http.createServer((request, response) => { delete request.headers[phoneHeader]; handler(request, response); });
  server.on('error', error => { console.error(error); process.exit(1); });
  server.listen(port, hostname, () => console.log(`Offline billing ready on http://${hostname}:${port}`));

  // Optional second listener for phones on the shop Wi-Fi or a private network such as Tailscale.
  let phoneServer = null;
  const phoneSockets = new Set();
  function startPhoneServer() {
    if (phoneServer) return;
    const listener = http.createServer((request, response) => {
      const source = request.socket.remoteAddress;
      if (!isPrivateAddress(source) || !isAllowedHost(request.headers.host)) {
        response.writeHead(403, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
        response.end('Billing is available only on the shop network.');
        return;
      }
      request.headers[phoneHeader] = phoneSecret;
      handler(request, response);
    });
    listener.on('connection', socket => { phoneSockets.add(socket); socket.on('close', () => phoneSockets.delete(socket)); });
    listener.on('error', error => { console.error(`Phone access could not start: ${error.message}`); if (phoneServer === listener) phoneServer = null; });
    listener.listen(phonePort, '0.0.0.0', () => console.log(`Phone access is on (port ${phonePort}).`));
    phoneServer = listener;
  }
  function stopPhoneServer() {
    if (!phoneServer) return;
    const closing = phoneServer; phoneServer = null;
    closing.close();
    for (const socket of phoneSockets) socket.destroy();
    console.log('Phone access is off.');
  }
  function syncPhoneAccess() {
    if (!dataDirectory) return;
    if (phoneAccessEnabled(dataDirectory)) startPhoneServer(); else stopPhoneServer();
  }
  syncPhoneAccess();
  // The administrator's switch writes phone-access.json; checking every two seconds avoids a restart.
  const watcher = setInterval(syncPhoneAccess, 2000); watcher.unref();

  const stop = () => { stopPhoneServer(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}).catch(error => { console.error(error); process.exit(1); });
