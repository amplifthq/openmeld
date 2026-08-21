import { describe, expect, it } from "vitest";
import packageJson from "../package.json";

describe("package public bin contract", () => {
  it("publishes only production CLI entrypoints", () => {
    expect(packageJson.bin).toEqual({
      openmeld: "dist/openmeld.js",
    });
  });

  it("declares only Node releases supported by its native SQLite reader", () => {
    expect(packageJson.engines.node).toBe("20.x || >=22 <26");
  });
});
