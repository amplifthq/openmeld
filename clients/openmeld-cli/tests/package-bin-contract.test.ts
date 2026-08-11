import { describe, expect, it } from "vitest";
import packageJson from "../package.json";

describe("package public bin contract", () => {
  it("publishes only production CLI entrypoints", () => {
    expect(packageJson.bin).toEqual({
      openmeld: "dist/openmeld.js",
    });
  });
});
