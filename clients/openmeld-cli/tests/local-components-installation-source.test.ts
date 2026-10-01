import { describe, expect, it } from "vitest";
import { resolveLocalComponentsInstallationSource } from "../src/local-components/installation-source";

describe("local component installation source", () => {
  const installed = { version: "0.3.231", binaryPath: "managed-cli-fixture" };
  const input = { platform: "win32", arch: "x64", binaryDistribution: true,
    root: "isolated-fixture", readInstallation: async () => installed };
  it("uses the managed installation's explicit preview choice, including retained carriers", async () => {
    expect(await resolveLocalComponentsInstallationSource({ ...input,
      readWindowsInstallation: async () => ({ version: installed.version, releaseChannel: "windows-preview" }),
    })).toEqual({ distribution: "binary", channel: "windows-preview", platform: "windows-x64" });
  });
  it("reports stable Windows only from a valid non-preview managed record", async () => {
    expect(await resolveLocalComponentsInstallationSource({ ...input,
      readWindowsInstallation: async () => ({ version: installed.version }),
    })).toEqual({ distribution: "binary", channel: "stable", platform: "windows-x64" });
  });
  it.each(["missing", "mismatched", "invalid"] as const)("keeps %s provenance unreported", async (kind) => {
    expect(await resolveLocalComponentsInstallationSource({ ...input,
      readWindowsInstallation: async () => {
        if (kind === "invalid") throw new Error("invalid installation record");
        return kind === "missing" ? null : { version: "0.3.230", releaseChannel: "windows-preview" };
      },
    })).toBeUndefined();
  });
  it("does not invent a source for an unmanaged binary", async () => {
    expect(await resolveLocalComponentsInstallationSource({ ...input,
      readInstallation: async () => null,
    })).toBeUndefined();
  });
  it("reports npm independently from binary preview state", async () => {
    expect(await resolveLocalComponentsInstallationSource({ ...input,
      binaryDistribution: false,
    })).toEqual({ distribution: "npm", channel: "stable", platform: "windows-x64" });
  });
});
