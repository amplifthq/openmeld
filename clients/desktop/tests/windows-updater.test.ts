import { afterEach, expect, it, vi } from "vitest";
import { verifyWindowsDesktopSignature } from "../src/main/update/windows-signature";
import { assertWindowsUpdaterConfiguration } from "../src/main/update/windows-updater-configuration";

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getVersion: () => "0.1.4",
    getPath: () => "/unused",
  },
}));
const publisherName = "CN=Fixture Publisher, O=Fixture Organization, C=US";
const configuration = {
  provider: "generic",
  url: "https://openmeld.ai/desktop/updates/windows-x64",
  publisherName: [publisherName],
};
const windows = { platform: "windows-x64", publisherName };
afterEach(() => vi.unstubAllEnvs());

it("accepts only the packaged platform, fixed feed and exact configured publisher", () => {
  expect(
    assertWindowsUpdaterConfiguration({ configuration, windows, arch: "x64" })
  ).toEqual(windows);
});
it.each([
  { configuration: { ...configuration, publisherName: undefined } },
  { configuration: { ...configuration, publisherName: [] } },
  {
    configuration: {
      ...configuration,
      publisherName: [publisherName, "Other Publisher"],
    },
  },
  { configuration: { ...configuration, publisherName: "Other Publisher" } },
  { configuration: { ...configuration, url: "https://other.invalid/updates" } },
  {
    configuration: {
      ...configuration,
      url: "https://openmeld.ai/desktop/updates",
    },
  },
  { windows: undefined },
  { arch: "arm64" },
  { arch: "ia32" },
])("rejects missing, ambiguous or mismatched updater metadata: %o", (override) => {
  expect(() =>
    assertWindowsUpdaterConfiguration({
      configuration,
      windows,
      arch: "x64",
      ...override,
    })
  ).toThrow();
});

it("passes paths and publisher as data to bounded system PowerShell, never interpolated shell text", async () => {
  vi.stubEnv("SystemRoot", "C:\\Windows");
  vi.stubEnv("PSModulePath", "C:\\untrusted-override");
  const path = "C:\\Users\\中文 % PATH & 'user\\pending\\update.exe";
  const execute = vi.fn<
    NonNullable<Parameters<typeof verifyWindowsDesktopSignature>[2]>
  >(() =>
    Promise.resolve({
      stdout: "OPENMELD_AUTHENTICODE_VERIFIED",
      stderr: "",
    })
  );
  await verifyWindowsDesktopSignature(path, publisherName, execute);
  const [file, args, options] = execute.mock.calls[0] ?? [];
  expect(file).toBe(
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  );
  expect(args?.join(" ")).not.toContain(path);
  expect(options).toMatchObject({
    timeout: 30_000,
    maxBuffer: 16_384,
    windowsHide: true,
  });
  expect(options?.env).not.toHaveProperty("PSMODULEPATH");
  const payload = JSON.parse(
    Buffer.from(
      options?.env.OPENMELD_SIGNATURE_REQUEST ?? "",
      "base64"
    ).toString("utf8")
  );
  expect(payload).toEqual({ path, publisherName });
});
it.each([
  { stdout: "", stderr: "" },
  { stdout: "null", stderr: "" },
  {
    stdout: "OPENMELD_AUTHENTICODE_VERIFIED",
    stderr: "OS verification warning",
  },
])("does not accept missing/malformed/warned signature evidence: %o", async (result) => {
  vi.stubEnv("SystemRoot", "C:\\Windows");
  await expect(
    verifyWindowsDesktopSignature(
      "C:\\update.exe",
      publisherName,
      async () => result
    )
  ).rejects.toThrow();
});
it("fails closed for unavailable PowerShell and invalid paths", async () => {
  vi.stubEnv("SystemRoot", "C:\\Windows");
  const execute = vi.fn(() =>
    Promise.reject(new Error("PowerShell unavailable"))
  );
  await expect(
    verifyWindowsDesktopSignature("C:\\update.exe", publisherName, execute)
  ).rejects.toThrow();
  execute.mockClear();
  await expect(
    verifyWindowsDesktopSignature("relative.exe", publisherName, execute)
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
