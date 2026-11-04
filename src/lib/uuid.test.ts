import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { newUuid } from "./uuid";

const realCrypto = globalThis.crypto;
afterEach(() => vi.unstubAllGlobals());

describe("newUuid", () => {
  it("returns a valid version-4 UUID without crypto.randomUUID, as on a phone using plain http", () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => realCrypto.getRandomValues(bytes) });
    const seen = new Set<string>();
    for (let index = 0; index < 200; index++) {
      const id = newUuid();
      expect(z.string().uuid().safeParse(id).success, id).toBe(true);
      expect(id[14]).toBe("4");
      expect("89ab").toContain(id[19]);
      seen.add(id);
    }
    expect(seen.size).toBe(200);
  });

  it("uses the browser's own generator when it exists", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
    expect(newUuid()).toBe("11111111-1111-4111-8111-111111111111");
  });
});
