import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDesktopCommandEnv,
  executableNamesForPlatform,
} from "../src/main/cli/path-search";
import { installedCommandEnvironment } from "../src/main/installed-environment";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
beforeEach(() =>
  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  })
);
afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, "platform", originalPlatform);
  }
});

describe("Windows Desktop command environment", () => {
  it("retains a copied Path and prefers Windows entries over a POSIX npm shim", () => {
    const env = buildDesktopCommandEnv({
      Path: "C:\\Node",
      PATHEXT: ".EXE;.CMD",
    });
    expect(env.PATH).toBe("C:\\Node");
    expect(env).not.toHaveProperty("Path");
    expect(executableNamesForPlatform("openmeld", env)).toEqual([
      "openmeld.exe",
      "openmeld.cmd",
      "openmeld",
    ]);
  });

  it("preserves required Windows runtime locations in the installed app's curated environment", () => {
    const original = process.env;
    process.env = {
      Path: "C:\\Node",
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\Test",
      APPDATA: "C:\\Users\\Test\\AppData\\Roaming",
      TEMP: "C:\\Temp",
      PRIVATE_SECRET: "not-forwarded",
    };
    try {
      const { env, openMeldBin } = installedCommandEnvironment(
        { kind: "production", webOrigin: "https://openmeld.ai" } as Parameters<
          typeof installedCommandEnvironment
        >[0],
        "unused"
      );
      expect(env).toMatchObject({
        PATH: "C:\\Node",
        SystemRoot: "C:\\Windows",
        USERPROFILE: process.env.USERPROFILE,
        APPDATA: process.env.APPDATA,
        TEMP: "C:\\Temp",
      });
      expect(openMeldBin).toBeUndefined(); // Windows must discover npm/JS, not a fixed Mac binary.
      expect(env).not.toHaveProperty("PRIVATE_SECRET");
    } finally {
      process.env = original;
    }
  });
});
