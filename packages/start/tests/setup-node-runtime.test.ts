import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OPENMELD_NODE_ENGINE_RANGE,
  unsupportedNodeRuntimeMessage,
} from "../src/setup-node-runtime";

describe("npm CLI Node runtime policy", () => {
  it.each([
    "22.0.0",
    "v22.0.0",
    "v24.0.0",
    "23.0.0",
    "24.0.0",
    "25.0.0",
  ])("accepts supported Node %s", (version) =>
    expect(unsupportedNodeRuntimeMessage(version)).toBeNull());

  it.each([
    "18.20.0",
    "20.19.2",
    "v20.19.2",
    "21.7.0",
    "26.0.0",
    "unknown",
  ])("gives an upgrade instruction for Node %s", (version) => {
    const message = unsupportedNodeRuntimeMessage(version);
    expect(message).toContain(">=22 <26");
    expect(message).toContain(version);
    expect(message).toContain("Install Node.js 24 (recommended)");
  });

  it("keeps npm's declared engines aligned with setup and startup", () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL("../../../clients/openmeld-cli/package.json", import.meta.url),
        "utf8"
      )
    );
    expect(manifest.engines.node).toBe(OPENMELD_NODE_ENGINE_RANGE);
  });
});
