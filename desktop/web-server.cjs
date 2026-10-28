// Installed beside the production .next build, never inside Electron's renderer.
const http = require('node:http');
const fs = require('node:fs');
const next = require('next');
const port = Number(process.env.PORT || 3100);
const hostname = '127.0.0.1';
const conf = JSON.parse(fs.readFileSync('.next/required-server-files.json', 'utf8')).config;
const application = next({ dev: false, dir: process.cwd(), hostname, port, conf });
const handler = application.getRequestHandler();
application.prepare().then(() => {
  const server = http.createServer((request, response) => handler(request, response));
  server.on('error', error => { console.error(error); process.exit(1); });
  server.listen(port, hostname, () => console.log(`Offline billing ready on http://${hostname}:${port}`));
  const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}).catch(error => { console.error(error); process.exit(1); });
