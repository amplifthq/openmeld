import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import {
  serviceControlCapabilitiesSchema,
  serviceControlCarrierCapabilitySchema,
} from "@openmeld/schemas";
import { readDaemonServiceContract } from "../config/daemon-service-contract";
import { sendLocalDaemonControlPlaneRequest } from "../local-service/control-plane/client";
import {
  daemonServiceBinaryExecutablePath,
  readDaemonActiveBundleState,
  resolveAlignedDaemonActiveBundleEntryPath,
} from "../local-service/lifecycle/daemon-service-bundle";
import { resolveDaemonServiceManager } from "../local-service/lifecycle/daemon-service-manager";
import { readCurrentDaemonRuntimeContext } from "../local-service/lifecycle/daemon-service-runtime";

async function resolveCarrierProbe(
  platform: "darwin" | "win32",
  expectedVersion: string,
  binary: boolean
) {
  if (platform === "darwin") {
    return {
      executable: await realpath(daemonServiceBinaryExecutablePath()),
      canonicalEntry: null,
      protocol: "account-checked-service-control-v1",
    };
  }
  // Probe the aligned immutable GUI carrier directly. For npm, bypass the
  // repairing launcher and use its verified JS entry with Start's exact Node.
  const entry = await resolveAlignedDaemonActiveBundleEntryPath({
    expectedVersion,
  });
  return entry
    ? {
        executable: await realpath(binary ? entry : process.execPath),
        canonicalEntry: binary ? null : await realpath(entry),
        protocol: binary
          ? "account-checked-service-control-v3"
          : "account-checked-service-control-v2",
      }
    : null;
}

/** Read only: never invoke the repairing npm launcher or a lifecycle operation. */
export async function readServiceControlCapabilities(
  platform: NodeJS.Platform = process.platform
) {
  const unsupported = { deviceId: null, start: false, stop: false };
  if (platform !== "darwin" && platform !== "win32") {
    return unsupported;
  }
  const contract = await readDaemonServiceContract();
  const bundle = await readDaemonActiveBundleState();
  const binary = bundle?.bundleFormat === "binary_v1";
  if (
    contract?.serviceController !==
      (platform === "win32" ? "windows-service" : "launchd") ||
    !(
      binary ||
      (platform === "win32" && bundle?.bundleFormat === "self_contained_v1")
    )
  ) {
    return unsupported;
  }
  const manager = await resolveDaemonServiceManager(contract.serviceController);
  if (!(manager && (await manager.status()).installed)) {
    return unsupported;
  }
  // Guarded Start refreshes the supervisor command to this canonical executable.
  // Verify the executable that answered, so an old CLI delegating elsewhere
  // cannot advertise another binary's capability as its own.
  const probe = await resolveCarrierProbe(
    platform,
    contract.daemonVersion,
    binary
  );
  if (!probe) {
    return unsupported;
  }
  const { executable, canonicalEntry, protocol } = probe;
  const { stdout } = await promisify(execFile)(
    executable,
    [
      ...(canonicalEntry ? [canonicalEntry] : []),
      "service",
      "control-carrier-capability",
      "--json",
    ],
    { timeout: 10_000, maxBuffer: 16_384, windowsHide: true }
  );
  const carrier = serviceControlCarrierCapabilitySchema.safeParse(
    JSON.parse(stdout)
  );
  if (
    !carrier.success ||
    carrier.data.protocol !== protocol ||
    (await realpath(carrier.data.executable)) !== executable
  ) {
    return unsupported;
  }
  if (
    carrier.data.protocol === "account-checked-service-control-v2" &&
    (await realpath(carrier.data.entryScript)) !== canonicalEntry
  ) {
    return unsupported;
  }
  if (
    JSON.stringify(await readDaemonActiveBundleState()) !==
    JSON.stringify(bundle)
  ) {
    return unsupported;
  }
  const runtime = await readCurrentDaemonRuntimeContext();
  if (runtime.effectiveRuntimeStatus === "not_running") {
    return { deviceId: contract.deviceId, start: true, stop: false };
  }
  if (runtime.effectiveRuntimeStatus !== "running") {
    return unsupported;
  }
  const response = await sendLocalDaemonControlPlaneRequest({
    request: { v: 1, command: "account_control_capabilities" },
  });
  return serviceControlCapabilitiesSchema.parse({
    deviceId: contract.deviceId,
    start: false,
    stop:
      response.code === "service.account_control_capabilities" &&
      response.payload.supported,
  });
}
