import { describe, expect, it } from "vitest";
import {
  compareAgentControllerVersions,
  supportsAgentControllerVersion,
} from "../src/agent-controller-version";

describe("controller version evidence", () => {
  it.each([
    ["0.159.0-alpha.12.1", "0.150.1", 1],
    ["0.150.1-alpha.1", "0.150.1", -1],
    ["v0.150.1+desktop.12", "0.150.1", 0],
    ["2.1.285-rc.1", "2.1.285", -1],
    ["1.0.0-beta.10", "1.0.0-beta.2", 1],
    ["1.0.0-alpha", "1.0.0-Z", 1],
    ["1.0.0-alpha..1", "1.0.0", null],
    ["1.0.0-01", "1.0.0", null],
    ["2026.07.16-899851b", "1.0.0", null],
    ["unknown", "1.0.0", null],
  ])("compares %s against %s without losing evidence", (left, right, expected) => {
    const comparison = compareAgentControllerVersions(left, right);
    expect(comparison === null ? null : Math.sign(comparison)).toBe(expected);
  });

  it.each([
    ["0.159.0-alpha.12.1", ">=0.150.1", true],
    ["0.150.1-alpha.1", ">=0.150.1", false],
    ["1.18.32-beta.1", ">=1.18.31", true],
    ["1.18.31-rc.1", ">=1.18.31", false],
    ["1.2.10-beta.1", ">=1.2.9 <1.3.0-0", true],
    ["1.3.0-alpha.1", ">=1.2.9 <1.3.0-0", false],
    ["1.0.41-beta.1", ">=1.0.40 <1.1.0-0", true],
    ["1.1.0-alpha.1", ">=1.0.40 <1.1.0-0", false],
    [null, ">=0.150.1", false],
    ["0.159.0garbage", ">=0.150.1", false],
  ])("admits %s only within %s", (version, range, expected) => {
    expect(supportsAgentControllerVersion(version, range)).toBe(expected);
  });
});
