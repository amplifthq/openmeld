import { resolveStartupCommandCapability } from "@openmeld/local-service";
import { describe, expect, it } from "vitest";

describe("startup command capability", () => {
  it("treats uninstall as a startup-safe command", () => {
    expect(resolveStartupCommandCapability("uninstall")).toEqual({
      skipDaemonStartupCheck: true,
      skipStartupUpgradeCheck: true,
      skipDevAutoStartGuard: false,
    });
  });

  it("treats prompt as a startup-safe command", () => {
    expect(resolveStartupCommandCapability("prompt")).toEqual({
      skipDaemonStartupCheck: true,
      skipStartupUpgradeCheck: true,
      skipDevAutoStartGuard: false,
    });
  });
});
