import { describe, expect, it } from "vitest";
const { productionLockfile } = require("../../scripts/production-lock.cjs");

describe("offline production dependency packaging", () => {
  it("retains pinned production dependencies, peers, optional packages and integrity without development tools", () => {
    const source = {
      lockfileVersion: "9.0", importers: { ".": { dependencies: { runtime: { specifier: "1.0.0", version: "1.0.0(peer@2.0.0)" } }, devDependencies: { electron: { version: "45.1.0" } } } },
      packages: { "runtime@1.0.0": { resolution: { integrity: "runtime-hash" } }, "peer@2.0.0": {}, "optional@3.0.0": {}, "electron@45.1.0": {} },
      snapshots: { "runtime@1.0.0(peer@2.0.0)": { dependencies: { peer: "2.0.0" }, optionalDependencies: { optional: "3.0.0" } }, "peer@2.0.0": {}, "optional@3.0.0": {}, "electron@45.1.0": {} },
    };
    const result = productionLockfile(source);
    expect(result.importers["."].devDependencies).toBeUndefined();
    expect(result.packages["electron@45.1.0"]).toBeUndefined();
    expect(Object.keys(result.snapshots)).toHaveLength(3);
    expect(result.packages["runtime@1.0.0"].resolution.integrity).toBe("runtime-hash");
    expect(source.importers["."].devDependencies.electron.version).toBe("45.1.0");
  });
  it("rejects a missing transitive dependency instead of generating an incomplete lockfile", () => {
    expect(() => productionLockfile({ importers: { ".": { dependencies: { missing: { version: "1.0.0" } } } }, snapshots: {}, packages: {} })).toThrow("Missing locked production dependency");
  });
});
