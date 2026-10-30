import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalUsers } from "./local-users";
import { withLocalSession } from "./local-request";
import { scopedDataDirectory } from "./local-session-context";

const originalRoot = process.env.LOCAL_DATA_DIR, originalMode = process.env.BILLING_MULTI_USER;
const directories: string[] = [];
afterEach(() => { if (originalRoot === undefined) delete process.env.LOCAL_DATA_DIR; else process.env.LOCAL_DATA_DIR = originalRoot; if (originalMode === undefined) delete process.env.BILLING_MULTI_USER; else process.env.BILLING_MULTI_USER = originalMode; for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
it("rejects unsigned requests and isolates concurrent user storage contexts", async () => {
  const root = mkdtempSync(join(tmpdir(), "billing-session-")); directories.push(root); process.env.LOCAL_DATA_DIR = root; process.env.BILLING_MULTI_USER = "1";
  const users = createLocalUsers(root);
  try {
    await users.create("owner", "password one"); const owner = await users.login("owner", "password one");
    const father = await users.create("father", "password two", owner.token); const other = await users.login("father", "password two");
    const handler = withLocalSession(async (_request: Request) => { await new Promise(resolve => setTimeout(resolve, 2)); return Response.json({ directory: scopedDataDirectory() }); });
    expect((await handler(new Request("http://localhost:3100/api/profile"))).status).toBe(401);
    expect((await handler(new Request("http://localhost:3100/api/profile", { headers: { cookie: `billing_session=${owner.token}`, origin: "https://evil.example" } }))).status).toBe(403);
    const responses = await Promise.all([owner.token, other.token].map(token => handler(new Request("http://localhost:3100/api/profile", { headers: { cookie: `billing_session=${token}` } }))));
    const values = await Promise.all(responses.map(response => response.json()));
    expect(values[0].directory).toBe(root); expect(values[1].directory).toBe(join(root, "users", father.id));
    expect(() => scopedDataDirectory()).toThrow("Sign in is required");
  } finally { users.close(); }
});
it("requires the session wrapper on every billing-data API handler", () => {
  const root = join(process.cwd(), "src/app/api");
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { if (!["health", "local-auth", "onedrive"].includes(entry.name)) visit(file); continue; }
      if (entry.name !== "route.ts") continue;
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/export async function (GET|POST|PATCH|DELETE)\(/);
      expect(source, file).toMatch(/export const (GET|POST|PATCH|DELETE) = withLocalSession\(/);
    }
  }
  visit(root);
});
