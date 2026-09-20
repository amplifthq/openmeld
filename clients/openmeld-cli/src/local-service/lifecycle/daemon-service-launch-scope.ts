import { realpath } from "node:fs/promises";
import {
  isPublishedOpenMeldHome,
  type OpenMeldPathResolutionInput,
  resolveOpenMeldEnvPreset,
} from "../../config/paths";
import { isOpenMeldManagedBinaryPath } from "./daemon-managed-binary-path";

/** Reject borrowing the installed production executable for isolated smoke.
 * A home override alone does not change its process-inventory identity.
 * This is an entry guard, not execution ownership or account authorization.
 */
export async function assertDaemonServiceLaunchScope(
  input: OpenMeldPathResolutionInput & { executablePath?: string } = {}
): Promise<void> {
  if (
    isPublishedOpenMeldHome(input) &&
    resolveOpenMeldEnvPreset(input) === "prod"
  ) {
    return;
  }
  const executablePath = input.executablePath ?? process.execPath;
  const resolvedExecutable = await realpath(executablePath).catch(
    () => executablePath
  );
  const productionPaths = {
    ...input,
    env: {
      ...(input.env ?? process.env),
      OPENMELD_ENV_PRESET: "prod",
      OPENMELD_HOME: "",
    },
  };
  if (
    isOpenMeldManagedBinaryPath(executablePath, productionPaths) ||
    isOpenMeldManagedBinaryPath(resolvedExecutable, productionPaths)
  ) {
    throw new Error(
      "Cannot start an isolated Service with the installed Production executable. Use openmeld-dev for local development or the official Staging Canary Setup command. OPENMELD_HOME alone does not isolate the Service."
    );
  }
}
