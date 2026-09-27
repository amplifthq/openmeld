import { describe, expect, it } from "vitest";
import {
  daemonServiceExecutableWrapperPath,
  daemonServiceLegacyWrapperPath,
} from "../src/local-service/lifecycle/daemon-service-bundle";
import { extractDaemonCommandEntryPath } from "../src/local-service/lifecycle/daemon-service-command-path";

describe("local service command path parsing", () => {
  it.each([
    "/",
    "\\",
  ])("extracts a native Service bundle path using %s separators", (separator) => {
    const entryPath = [
      "C:",
      "Users",
      "fixture",
      ".openmeld",
      "runtime",
      "daemon",
      "bundles",
      "0.3.226-fixture",
      "openmeld.exe",
    ].join(separator);
    expect(
      extractDaemonCommandEntryPath(
        `"${entryPath}" service run --mode foreground`
      )
    ).toBe(entryPath);
  });

  it.each([
    "openmeld",
    "openmeld.exe",
  ])("extracts the managed %s version path before service run", (binaryName) => {
    const entryPath = `/Users/dev/.openmeld/versions/0.2.14/${binaryName}`;

    expect(
      extractDaemonCommandEntryPath(
        `${entryPath} service run --mode foreground`,
        {
          env: { OPENMELD_ENV_PRESET: "prod" },
          homeDir: "/Users/dev",
        }
      )
    ).toBe(entryPath);
    expect(
      extractDaemonCommandEntryPath(
        `${entryPath}-not-owned service run --mode foreground`,
        { env: { OPENMELD_ENV_PRESET: "prod" }, homeDir: "/Users/dev" }
      )
    ).toBeNull();
  });

  it("extracts a managed binary pointer path before service run", () => {
    const binaryName =
      process.platform === "win32" ? "openmeld.exe" : "openmeld";
    const entryPath = `/Users/dev/.openmeld-dev/bin/${binaryName}`;

    expect(
      extractDaemonCommandEntryPath(
        `${entryPath} service run --mode foreground`,
        {
          env: { OPENMELD_ENV_PRESET: "dev-local" },
          homeDir: "/Users/dev",
        }
      )
    ).toBe(entryPath);
  });

  it("extracts the macOS display wrapper path when ps output leaves spaces unquoted", () => {
    const wrapperPath = daemonServiceExecutableWrapperPath();

    expect(
      extractDaemonCommandEntryPath(
        `${wrapperPath} service run --mode foreground`
      )
    ).toBe(wrapperPath);
  });

  it("extracts the macOS wrapper path when launchd invokes it through the system shell", () => {
    const wrapperPath = daemonServiceExecutableWrapperPath();

    expect(
      extractDaemonCommandEntryPath(
        `/bin/sh ${wrapperPath} service run --mode foreground`
      )
    ).toBe(wrapperPath);
  });

  it("does not extract a path that only starts with the macOS wrapper path", () => {
    const wrapperPath = daemonServiceExecutableWrapperPath();

    expect(
      extractDaemonCommandEntryPath(
        `/bin/sh ${wrapperPath}-not-owned service run --mode foreground`
      )
    ).toBeNull();
  });

  it("continues to recognize the legacy executable wrapper name", () => {
    const legacyWrapperPath = daemonServiceLegacyWrapperPath();

    expect(
      extractDaemonCommandEntryPath(
        `${legacyWrapperPath} service run --mode foreground`
      )
    ).toBe(legacyWrapperPath);
  });
});
