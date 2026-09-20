import { describe, expect, it } from "vitest";
import {
  assertMacProductionBundleIdentity,
  assertMacUpdateBundlePath,
  readMacAppBundlePath,
} from "../src/main/update/mac-bundle-path";

describe("macOS Desktop bundle path", () => {
  it("reads the installed application folder from the packaged executable", () => {
    expect(
      readMacAppBundlePath("/Applications/OpenMeld.app/Contents/MacOS/OpenMeld")
    ).toBe("/Applications/OpenMeld.app");
  });

  it("allows only the stable production filesystem name for Squirrel updates", () => {
    expect(assertMacUpdateBundlePath("/Applications/OpenMeld.app")).toBe(
      "/Applications/OpenMeld.app"
    );
    expect(() => assertMacUpdateBundlePath(null)).toThrow("cannot determine");
    expect(() =>
      assertMacUpdateBundlePath("/Applications/OpenMeld Desktop.app")
    ).toThrow("cannot update safely");
    expect(() =>
      assertMacUpdateBundlePath("/Applications/OpenMeld Preview.app")
    ).toThrow("application folder name");
  });

  it("pins the production package identity that installed update clients depend on", () => {
    expect(() =>
      assertMacProductionBundleIdentity({
        appId: "sh.openmeld.desktop",
        productName: "OpenMeld",
      })
    ).not.toThrow();
    expect(() =>
      assertMacProductionBundleIdentity({
        appId: "sh.openmeld.desktop",
        productName: "OpenMeld Desktop",
      })
    ).toThrow("identity changed");
  });
});
