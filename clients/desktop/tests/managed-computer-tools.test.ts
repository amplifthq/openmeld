import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installComputerTools } from "../src/main/cli/computer-tools";
import { installedCommandEnvironment } from "../src/main/installed-environment";

const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }) };
});
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const originalArch = Object.getOwnPropertyDescriptor(process, "arch");
let origin = "https://windows-tools-fixture.invalid";
const cli = Buffer.from("synthetic CLI artifact bytes");
const helper = Buffer.from("synthetic process helper bytes");
const artifact = (name: string, bytes: Buffer) => ({
  url: `${origin}/${name}`,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  sizeBytes: bytes.length,
});
let root: string;
let manifest: ReturnType<typeof buildManifest>;
let returnedHelper: Buffer;
let installedBytes: { cli: Buffer; helper: Buffer; args: string[] } | undefined;
const fetchMock = vi.fn();
function buildManifest() {
  return {
    schemaVersion: 1,
    channels: {
      stable: {
        version: "0.3.220",
        platforms: {
          "windows-x64": {
            ...artifact("cli.exe", cli),
            windows: {
              publisherName: "OpenMeld fixture publisher",
              processHelper: artifact("helper.exe", helper),
            },
          },
        },
      },
    },
  };
}
beforeEach(async () => {
  origin = "https://windows-tools-fixture.invalid";
  root = await mkdtemp(join(tmpdir(), "openmeld-desktop-tools-"));
  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  });
  Object.defineProperty(process, "arch", { value: "x64", configurable: true });
  vi.stubEnv("SystemRoot", process.env.SystemRoot ?? "C:\\Windows");
  manifest = buildManifest();
  returnedHelper = helper;
  installedBytes = undefined;
  execute.mockReset();
  execute.mockImplementation(async (file: string, args: string[]) => {
    // Real OS verification is covered by windows-signature.native.test.ts.
    // Here only its captured success receipt is supplied at the process boundary.
    if (
      basename(file).toLowerCase() === "powershell.exe" ||
      file.endsWith("\\powershell.exe")
    ) {
      return { stdout: "OPENMELD_AUTHENTICODE_VERIFIED", stderr: "" };
    }
    installedBytes = {
      cli: await readFile(file),
      helper: await readFile(
        join(dirname(file), "openmeld-windows-process.exe")
      ),
      args,
    };
    return {
      stdout: JSON.stringify({
        schemaVersion: 1,
        type: "cli.install_self",
        result: "noop_newer_present",
        version: "0.3.220",
        platform: "windows-x64",
        managedBinaryPath: join(root, "versions", "0.3.221", "openmeld.exe"),
        currentPointerPath: join(root, "bin", "openmeld.exe"),
        previousVersion: "0.3.221",
        forced: false,
      }),
      stderr: "",
    };
  });
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string | URL) => {
    const href = String(url);
    if (
      href === `${origin}/cli/manifest.json` ||
      (origin === "https://openmeld.ai" &&
        href === "https://app.openmeld.ai/cli/manifest.json")
    ) {
      return Promise.resolve(Response.json(manifest));
    }
    if (href === `${origin}/cli.exe`) {
      return Promise.resolve(new Response(cli));
    }
    if (href === `${origin}/helper.exe`) {
      return Promise.resolve(new Response(new Uint8Array(returnedHelper)));
    }
    throw new Error(`Unexpected fixture download: ${href}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (originalPlatform) {
    Object.defineProperty(process, "platform", originalPlatform);
  }
  if (originalArch) {
    Object.defineProperty(process, "arch", originalArch);
  }
  await rm(root, { recursive: true, force: true });
});

it.each([
  { preset: "prod", installedOrigin: undefined },
  { preset: "dev-local", installedOrigin: undefined },
  { preset: "prod", installedOrigin: "https://app.openmeld.ai" },
  { preset: "prod", installedOrigin: "https://openmeld.ai" },
])("installs the verified bundle from $preset / $installedOrigin", async ({
  preset,
  installedOrigin,
}) => {
  const webOrigin =
    installedOrigin ??
    (preset === "prod" ? origin : "http://wt-0bb4f2da9c6d.localhost:29728");
  if (installedOrigin) {
    // Captured production manifest on 2026-10-16: both official manifest
    // endpoints return artifact URLs under https://openmeld.ai/cli/download/.
    origin = "https://openmeld.ai";
    manifest = buildManifest();
  }
  if (preset === "dev-local") {
    origin = "http://127.0.0.1:29732";
    manifest = buildManifest();
  }
  const command = await installComputerTools(webOrigin, {
    env: {
      OPENMELD_ENV_PRESET: preset,
      PATH: "",
      OPENMELD_CLI_BINARY_MANIFEST_URL: `${origin}/cli/manifest.json`,
      OPENMELD_CLI_BINARY_DEV_PORT: "29732",
      ...(installedOrigin
        ? installedCommandEnvironment(
            {
              kind: "production",
              webOrigin: installedOrigin as
                | "https://app.openmeld.ai"
                | "https://openmeld.ai",
              authScheme: "sh.openmeld.desktop",
              clientId: "openmeld-desktop",
              appId: "sh.openmeld.desktop",
              dataDirectory: "OpenMeld Desktop",
            },
            root
          ).env
        : {}),
      OPENMELD_HOME: root,
    },
  });
  expect(command).toBe(join(root, "bin", "openmeld.exe"));
  expect(installedBytes).toEqual({
    cli,
    helper,
    args: ["install-self", "--json"],
  });
  expect(execute).toHaveBeenCalledTimes(3); // Two OS signature checks, then install-self.
  expect(execute.mock.calls.at(-1)?.[2]).toMatchObject({
    env: { OPENMELD_HOME: root },
    windowsHide: true,
  });
});

it.each([
  [
    "prod",
    "https://app.openmeld.ai",
    "https://untrusted.invalid/cli/manifest.json",
  ],
  ["prod", "https://app.openmeld.ai", "http://openmeld.ai/cli/manifest.json"],
  [
    "prod",
    "http://localhost:29728",
    "http://127.0.0.1:29732/cli/manifest.json",
  ],
  [
    "dev-local",
    "https://app.example.test",
    "http://127.0.0.1:29732/cli/manifest.json",
  ],
  [
    "dev-local",
    "http://localhost:29728",
    "https://remote.example.test/cli/manifest.json",
  ],
  [
    "dev-local",
    "http://localhost:29728",
    "http://127.0.0.1:29733/cli/manifest.json",
  ],
])("rejects a distribution outside the selected lane: %s %s %s", async (preset, webOrigin, manifestUrl) => {
  await expect(
    installComputerTools(webOrigin, {
      env: {
        OPENMELD_HOME: root,
        OPENMELD_ENV_PRESET: preset,
        OPENMELD_CLI_BINARY_MANIFEST_URL: manifestUrl,
        OPENMELD_CLI_BINARY_DEV_PORT: "29732",
      },
    })
  ).rejects.toThrow("unexpected download location");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});

it("does not execute the installer after a companion integrity failure", async () => {
  returnedHelper = Buffer.from("tampered");
  await expect(
    installComputerTools(origin, {
      env: { OPENMELD_HOME: root, OPENMELD_ENV_PRESET: "prod" },
    })
  ).rejects.toThrow();
  expect(execute.mock.calls.some((call) => call[1][0] === "install-self")).toBe(
    false
  );
});

it("does not download a companion from a different origin", async () => {
  manifest.channels.stable.platforms["windows-x64"].windows.processHelper.url =
    "https://different.invalid/helper.exe";
  await expect(
    installComputerTools(origin, {
      env: { OPENMELD_HOME: root, OPENMELD_ENV_PRESET: "prod" },
    })
  ).rejects.toThrow();
  expect(
    fetchMock.mock.calls.some((call) =>
      String(call[0]).includes("different.invalid")
    )
  ).toBe(false);
  expect(execute.mock.calls.some((call) => call[1][0] === "install-self")).toBe(
    false
  );
});

it("does not advertise an unverified Windows architecture", async () => {
  Object.defineProperty(process, "arch", {
    value: "arm64",
    configurable: true,
  });
  await expect(installComputerTools(origin, {})).rejects.toThrow(
    "64-bit Windows PCs"
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
