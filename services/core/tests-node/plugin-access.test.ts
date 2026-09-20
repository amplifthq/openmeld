import { describe, expect, it } from "vitest";
import {
  pluginPermissionAllows,
  resolvePluginAccessPolicy,
} from "../src/connectors/plugin-access";

describe("Plugin connection access", () => {
  it("preserves existing consumers without granting new Agents access", () => {
    expect(resolvePluginAccessPolicy("member", null)).toEqual({
      center_agent: "write",
      local_agent: "none",
      remote_agent: "none",
    });
    expect(resolvePluginAccessPolicy("shared", null)).toEqual({
      center_agent: "write",
      local_agent: "none",
      remote_agent: "write",
    });
  });

  it.each([
    ["none", "read", false],
    ["none", "write", false],
    ["read", "read", true],
    ["read", "write", false],
    ["read", "destructive", false],
    ["read", "unspecified", false],
    ["write", "write", true],
    ["write", "destructive", true],
  ] as const)("%s access with %s effect allows=%s", (permission, effect, allowed) => {
    expect(pluginPermissionAllows(permission, effect)).toBe(allowed);
  });

  it("rejects corrupt policy instead of restoring legacy access", () => {
    expect(() => resolvePluginAccessPolicy("shared", "{}")).toThrow();
    expect(() => resolvePluginAccessPolicy("shared", "broken")).toThrow();
  });
});
