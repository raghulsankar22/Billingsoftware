import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import path from "node:path";

const { isAppUrl, isBillingHealth } = require("../../desktop/security.cjs");
const { ensureBillingServer, probeServer } = require("../../desktop/server.cjs");
const openServers: Server[] = [];
const dataDirectory = path.resolve("tmp/desktop-unit-data");

async function fakeServer(body: unknown) {
  const server = createServer((_request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); });
  openServers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  return address.port;
}
afterEach(async () => { await Promise.all(openServers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });

describe("offline desktop security and server lifecycle", () => {
  it("allows only the billing origin and its download blobs", () => {
    const origin = "http://127.0.0.1:3100";
    expect(isAppUrl(`${origin}/api/bills`, origin)).toBe(true);
    expect(isAppUrl(`blob:${origin}/download`, origin)).toBe(true);
    for (const url of ["https://example.com", "http://127.0.0.1:3101", "http://127.0.0.1.evil.test:3100", "file:///D:/app/data/billing.sqlite", "javascript:alert(1)", "bad-url"]) expect(isAppUrl(url, origin)).toBe(false);
  });
  it("requires a local server using the same billing data folder", () => {
    const health = { application: "finance-billing", storage: "local", dataDirectory };
    expect(isBillingHealth(health, dataDirectory)).toBe(true);
    expect(isBillingHealth({ ...health, storage: "cloud" }, dataDirectory)).toBe(false);
    expect(isBillingHealth({ ...health, dataDirectory: path.resolve("other-data") }, dataDirectory)).toBe(false);
    expect(isBillingHealth(null, dataDirectory)).toBe(false);
  });
  it("reuses the correct existing server and does not stop it when the app closes", async () => {
    const port = await fakeServer({ application: "finance-billing", storage: "local", dataDirectory });
    const server = await ensureBillingServer({ runtimeDirectory: "missing-runtime", dataDirectory, port });
    expect(server.owned).toBe(false);
    server.stop();
    expect(await probeServer(server.origin, dataDirectory)).toBe("ready");
  });
  it("refuses to attach to an unrelated or different-data server", async () => {
    const port = await fakeServer({ application: "other-program" });
    await expect(ensureBillingServer({ runtimeDirectory: "missing-runtime", dataDirectory, port })).rejects.toThrow("already in use");
  });
});
