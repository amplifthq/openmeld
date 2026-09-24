import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readServiceControlCapabilities } from "../src/commands/service-control-capabilities";

const owners = vi.hoisted(() => ({
  contract: vi.fn(),
  bundle: vi.fn(),
  entry: vi.fn(),
  manager: vi.fn(),
  runtime: vi.fn(),
  control: vi.fn(),
}));
vi.mock("../src/config/daemon-service-contract", () => ({
  readDaemonServiceContract: owners.contract,
}));
vi.mock("../src/local-service/lifecycle/daemon-service-bundle", () => ({
  readDaemonActiveBundleState: owners.bundle,
  resolveAlignedDaemonActiveBundleEntryPath: owners.entry,
  daemonServiceBinaryExecutablePath: () => "unused-mac-carrier",
}));
vi.mock("../src/local-service/lifecycle/daemon-service-manager", () => ({
  resolveDaemonServiceManager: owners.manager,
}));
vi.mock("../src/local-service/lifecycle/daemon-service-runtime", () => ({
  readCurrentDaemonRuntimeContext: owners.runtime,
}));
vi.mock("../src/local-service/control-plane/client", () => ({
  sendLocalDaemonControlPlaneRequest: owners.control,
}));

let root: string;
let entry: string;
const unsupported = { deviceId: null, start: false, stop: false };

beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(join(tmpdir(), "OpenMeld capability 测试 "));
  entry = join(root, "carrier.cjs");
  owners.contract.mockResolvedValue({
    serviceController: "windows-service",
    daemonVersion: "1.0.0",
    deviceId: "device-A",
  });
  owners.bundle.mockResolvedValue({
    bundleFormat: "self_contained_v1",
    bundleId: "bundle-A",
  });
  owners.entry.mockResolvedValue(entry);
  owners.manager.mockResolvedValue({
    status: async () => ({ installed: true }),
  });
  owners.runtime.mockResolvedValue({ effectiveRuntimeStatus: "not_running" });
  owners.control.mockResolvedValue({
    code: "service.account_control_capabilities",
    payload: { supported: true },
  });
  await writeProbe();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeProbe(overrides: Record<string, unknown> = {}) {
  // A real child process proves executable/entry identity; unexpected commands
  // fail rather than acting like a Service start or a repairing npm launcher.
  await writeFile(
    entry,
    `
    require('node:assert/strict').deepEqual(process.argv.slice(2), ['service','control-carrier-capability','--json']);
    console.log(JSON.stringify({ protocol:'account-checked-service-control-v2', platform:'win32', executable:process.execPath, entryScript:process.argv[1], ...${JSON.stringify(overrides)} }));
  `
  );
}

it.each(
  process.platform === "win32" ? ["npm"] : ["npm", "binary"]
)("probes the selected %s carrier without starting or repairing a stopped Service", async (distribution) => {
  if (distribution === "binary") {
    owners.bundle.mockResolvedValue({
      bundleFormat: "binary_v1",
      bundleId: "bundle-A",
    });
    // POSIX executable fixture for the product-owned capability protocol.
    // Actual Windows GUI executable evidence belongs to the native Host gate.
    await writeFile(
      entry,
      `#!/usr/bin/env node\nrequire('node:assert/strict').deepEqual(process.argv.slice(2), ['service','control-carrier-capability','--json']);\nconsole.log(JSON.stringify({ protocol:'account-checked-service-control-v3', platform:'win32', executable:__filename }));\n`
    );
    await chmod(entry, 0o700);
  }
  expect(await readServiceControlCapabilities("win32")).toEqual({
    deviceId: "device-A",
    start: true,
    stop: false,
  });
  expect(owners.entry).toHaveBeenCalledWith({ expectedVersion: "1.0.0" });
  expect(owners.control).not.toHaveBeenCalled();
  if (distribution === "binary") {
    await writeFile(
      entry,
      `#!/usr/bin/env node\nconsole.log(JSON.stringify({protocol:'account-checked-service-control-v2',platform:'win32',executable:__filename,entryScript:__filename}));\n`
    );
    expect(await readServiceControlCapabilities("win32")).toEqual(unsupported);
  }
});

it("does not confuse an older generic capability response with Windows admission support", async () => {
  await writeFile(
    entry,
    "console.log(JSON.stringify({protocol:'account-checked-service-control-v1',executable:process.execPath}))"
  );
  expect(await readServiceControlCapabilities("win32")).toEqual(unsupported);
});

it("rejects a responding script from another entry even when Node is identical", async () => {
  const other = join(root, "other.cjs");
  await writeFile(other, "// not the selected carrier");
  await writeProbe({ entryScript: other });
  expect(await readServiceControlCapabilities("win32")).toEqual(unsupported);
});

it("rejects missing, incompatible or concurrently replaced bundle evidence", async () => {
  owners.entry.mockResolvedValueOnce(null);
  expect(await readServiceControlCapabilities("win32")).toEqual(unsupported);
  owners.bundle.mockResolvedValueOnce({ bundleFormat: "legacy_linked_v1" });
  expect(await readServiceControlCapabilities("win32")).toEqual(unsupported);
  owners.bundle.mockResolvedValueOnce({
    bundleFormat: "self_contained_v1",
    bundleId: "before-replacement",
  });
  expect(await readServiceControlCapabilities("win32")).toEqual(unsupported);
});

it.each([
  false,
  true,
])("requires the actual running carrier's authenticated support: %s", async (supported) => {
  owners.runtime.mockResolvedValue({ effectiveRuntimeStatus: "running" });
  owners.control.mockResolvedValue({
    code: "service.account_control_capabilities",
    payload: { supported },
  });
  expect(await readServiceControlCapabilities("win32")).toEqual({
    deviceId: "device-A",
    start: false,
    stop: supported,
  });
  expect(owners.control).toHaveBeenCalledWith({
    request: { v: 1, command: "account_control_capabilities" },
  });
});

it("never enables controls for missing registration or uncertain runtime state", async () => {
  owners.manager.mockResolvedValueOnce(null);
  expect(await readServiceControlCapabilities("win32")).toEqual(unsupported);
  owners.runtime.mockResolvedValue({ effectiveRuntimeStatus: "unknown" });
  expect(await readServiceControlCapabilities("win32")).toEqual(unsupported);
  expect(owners.control).not.toHaveBeenCalled();
});
