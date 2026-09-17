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
} from "../local-service/lifecycle/daemon-service-bundle";
import { resolveDaemonServiceManager } from "../local-service/lifecycle/daemon-service-manager";
import { readCurrentDaemonRuntimeContext } from "../local-service/lifecycle/daemon-service-runtime";

/** Read only: never invoke the repairing npm launcher or a lifecycle operation. */
export async function readServiceControlCapabilities() {
  const unsupported = { deviceId: null, start: false, stop: false };
  if (process.platform !== "darwin") {
    return unsupported;
  }
  const contract = await readDaemonServiceContract();
  const bundle = await readDaemonActiveBundleState();
  if (
    contract?.serviceController !== "launchd" ||
    bundle?.bundleFormat !== "binary_v1"
  ) {
    return unsupported;
  }
  const manager = await resolveDaemonServiceManager("launchd");
  if (!(manager && (await manager.status()).installed)) {
    return unsupported;
  }
  // Guarded Start refreshes the supervisor command to this canonical executable.
  // Verify the executable that answered, so an old CLI delegating elsewhere
  // cannot advertise another binary's capability as its own.
  const executable = await realpath(daemonServiceBinaryExecutablePath());
  const { stdout } = await promisify(execFile)(
    executable,
    ["service", "control-carrier-capability", "--json"],
    { timeout: 5000, maxBuffer: 16_384 }
  );
  const carrier = serviceControlCarrierCapabilitySchema.safeParse(
    JSON.parse(stdout)
  );
  if (
    !carrier.success ||
    (await realpath(carrier.data.executable)) !== executable
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
