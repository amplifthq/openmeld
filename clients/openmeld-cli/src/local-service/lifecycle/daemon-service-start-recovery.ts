import type { OpenMeldDistribution } from "../../runtime/distribution";
import { ensureDaemonSystemServiceCommandFiles } from "./daemon-service-command-spec";
import type {
  DaemonServiceCommandSpec,
  DaemonServiceManager,
} from "./daemon-service-manager";

const ROOT_ERROR_PATTERN =
  /\s*Try re-running the command as root for richer errors\.?/i;

export async function startDaemonSystemServiceWithAutoRepair(input: {
  serviceCommandSpec: DaemonServiceCommandSpec;
  systemManager: DaemonServiceManager;
  distribution?: OpenMeldDistribution;
  onAutoRepairAttempt?: () => Promise<void> | void;
  onAutoRepairRecovered?: () => Promise<void> | void;
}): Promise<{
  autoRepairAttempted: boolean;
}> {
  let autoRepairAttempted = false;
  try {
    await input.systemManager.start();
    return {
      autoRepairAttempted,
    };
  } catch (error) {
    if (
      !shouldAttemptLaunchdAutoRepair({
        controller: input.systemManager.controller,
        error,
      })
    ) {
      throw error;
    }

    autoRepairAttempted = true;
    await input.onAutoRepairAttempt?.();
    try {
      await input.systemManager.uninstall();
      await input.systemManager.waitUntilAbsent();
      await ensureDaemonSystemServiceCommandFiles({
        controller: input.systemManager.controller,
        distribution: input.distribution,
      });
      await input.systemManager.install(input.serviceCommandSpec);
      await input.systemManager.start();
      await input.onAutoRepairRecovered?.();
      return {
        autoRepairAttempted,
      };
    } catch (retryError) {
      throw buildLaunchdAutoRepairFailureError({
        initialError: error,
        retryError,
      });
    }
  }
}

function sanitizeSystemServiceErrorMessage(message: string): string {
  return message.replace(ROOT_ERROR_PATTERN, "");
}

function isLaunchdBootstrapIosError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("bootstrap failed") &&
    normalized.includes("input/output error")
  );
}

function shouldAttemptLaunchdAutoRepair(input: {
  controller: DaemonServiceManager["controller"];
  error: unknown;
}): boolean {
  if (input.controller !== "launchd") {
    return false;
  }
  const message = sanitizeSystemServiceErrorMessage(
    toErrorMessage(input.error)
  );
  return isLaunchdBootstrapIosError(message);
}

function buildLaunchdAutoRepairFailureError(input: {
  initialError: unknown;
  retryError: unknown;
}): Error {
  return new Error(
    [
      "launchd auto-repair retry failed.",
      `initial error: ${toErrorMessage(input.initialError)}`,
      `retry error: ${toErrorMessage(input.retryError)}`,
    ].join(" ")
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
