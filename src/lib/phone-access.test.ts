import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAllowedHost, isPrivateAddress, phoneAccessEnabled, phoneAddresses, phoneHeader, phonePort, setPhoneAccess } from "../../desktop/phone-access.cjs";
import { localRequestAllowed, phoneRequest } from "./local-request";

const made: string[] = [];
const originalSecret = process.env.BILLING_PHONE_SECRET;
afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
  if (originalSecret === undefined) delete process.env.BILLING_PHONE_SECRET; else process.env.BILLING_PHONE_SECRET = originalSecret;
});

describe("which connections may reach billing from a phone", () => {
  it("accepts this computer, home and office networks and Tailscale, and refuses the public internet", () => {
    for (const address of ["127.0.0.1", "::1", "10.0.0.5", "172.16.4.1", "172.31.255.255", "192.168.1.20", "100.64.0.1", "100.127.255.254", "::ffff:192.168.1.20", "fd7a:115c:a1e0::1", "fe80::1"]) expect(isPrivateAddress(address), address).toBe(true);
    for (const address of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "100.63.255.255", "100.128.0.1", "192.169.1.1", "11.0.0.1", "2001:4860:4860::8888", "::ffff:8.8.8.8", "", "not-an-address", "999.1.1.1", undefined, 5]) expect(isPrivateAddress(address as string), String(address)).toBe(false);
  });

  it("accepts an IP address, this computer's name or a private-network name in the address bar, but no public site name", () => {
    for (const host of ["192.168.1.20:3120", "100.101.102.103:3120", "[fd7a:115c:a1e0::1]:3120", "shop-pc:3120", "shop-pc.tail1234.ts.net:3120", "shop-pc.local", "shop.home.arpa"]) expect(isAllowedHost(host), host).toBe(true);
    for (const host of ["billing.example.com", "evil.com:3120", "", undefined, "x".repeat(300)]) expect(isAllowedHost(host as string), String(host)).toBe(false);
  });

  it("lists the addresses to type on the phone, Tailscale first, and skips unusable adapters", () => {
    const interfaces = {
      "Wi-Fi": [{ address: "192.168.1.20", family: "IPv4", internal: false }, { address: "fe80::1", family: "IPv6", internal: false }],
      Tailscale: [{ address: "100.101.102.103", family: "IPv4", internal: false }],
      Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      Vpn: [{ address: "8.8.4.4", family: "IPv4", internal: false }],
      Unplugged: [{ address: "169.254.10.10", family: "IPv4", internal: false }],
    } as never;
    expect(phoneAddresses(interfaces)).toEqual([
      { kind: "tailscale", adapter: "Tailscale", url: `http://100.101.102.103:${phonePort}` },
      { kind: "wifi", adapter: "Wi-Fi", url: `http://192.168.1.20:${phonePort}` },
    ]);
  });

  it("stays off until an administrator turns it on, and remembers the choice", () => {
    const directory = mkdtempSync(join(tmpdir(), "billing-phone-")); made.push(directory);
    expect(phoneAccessEnabled(directory)).toBe(false);
    setPhoneAccess(directory, true);
    expect(phoneAccessEnabled(directory)).toBe(true);
    setPhoneAccess(directory, false);
    expect(phoneAccessEnabled(directory)).toBe(false);
    expect(phoneAccessEnabled(join(directory, "missing"))).toBe(false);
  });
});

describe("how the website treats a request that came through the phone listener", () => {
  const secret = "a".repeat(64);
  const phone = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers: { [phoneHeader]: secret, host: new URL(url).host, ...headers } });

  it("recognises the phone listener only by its secret", () => {
    process.env.BILLING_PHONE_SECRET = secret;
    expect(phoneRequest(phone("http://100.101.102.103:3120/api/bills"))).toBe(true);
    expect(phoneRequest(new Request("http://100.101.102.103:3120/api/bills", { headers: { [phoneHeader]: "b".repeat(64) } }))).toBe(false);
    expect(phoneRequest(new Request("http://100.101.102.103:3120/api/bills", { headers: { [phoneHeader]: "short" } }))).toBe(false);
    expect(phoneRequest(new Request("http://100.101.102.103:3120/api/bills"))).toBe(false);
    delete process.env.BILLING_PHONE_SECRET;
    expect(phoneRequest(phone("http://100.101.102.103:3120/api/bills"))).toBe(false);
  });

  it("lets a phone use the address it opened, and nothing else", () => {
    process.env.BILLING_PHONE_SECRET = secret;
    expect(localRequestAllowed(phone("http://100.101.102.103:3120/api/bills"))).toBe(true);
    expect(localRequestAllowed(phone("http://100.101.102.103:3120/api/bills", { origin: "http://100.101.102.103:3120" }))).toBe(true);
    expect(localRequestAllowed(phone("http://100.101.102.103:3120/api/bills", { origin: "http://evil.example" }))).toBe(false);
    expect(localRequestAllowed(phone("http://100.101.102.103:3120/api/bills", { origin: "http://100.101.102.103:3111" }))).toBe(false);
    expect(localRequestAllowed(phone("http://100.101.102.103:3120/api/bills", { origin: "not a url" }))).toBe(false);
    expect(localRequestAllowed(phone("http://100.101.102.103:3120/api/bills", { "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("still refuses a network address on the normal listener, even with a guessed header", () => {
    process.env.BILLING_PHONE_SECRET = secret;
    const guess = new Request("http://192.168.1.20:3100/api/bills", { headers: { [phoneHeader]: "c".repeat(64) } });
    expect(localRequestAllowed(guess)).toBe(false);
    expect(localRequestAllowed(new Request("http://127.0.0.1:3100/api/bills"))).toBe(true);
    expect(localRequestAllowed(new Request("http://localhost:3100/api/bills", { headers: { origin: "http://localhost:3100" } }))).toBe(true);
  });
});
