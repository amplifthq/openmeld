import {
  runDaemonBackgroundStartForDecision,
  runDaemonInstall,
} from "../commands/service";
import { getDaemonStatus } from "../config/daemon-state";
import { resolveCurrentDaemonExpectedVersion } from "../local-service/lifecycle/current-daemon-version";
import {
  resolveDaemonRuntimeContractCompatibility,
  toStartBackgroundHelperExecutionCompatibility,
} from "../local-service/lifecycle/daemon-runtime-contract-compatibility";
import { readCurrentObservedDaemonRuntimeStatus } from "../local-service/lifecycle/daemon-service-runtime";
import { resolveLocalServiceDemand } from "../local-service/lifecycle/local-service-demand";
import type { StartReadinessSnapshot } from "./readiness-types";

export function collectStartLocalBackgroundHelperReadiness(): Promise<
  StartReadinessSnapshot["service"]
> {
  const expectedVersion = resolveCurrentDaemonExpectedVersion();
  return getDaemonStatus()
    .then((status) => {
      if (!status.installed) {
        return {
          status: "not_installed" as const,
          installedVersion: null,
          expectedVersion,
          runtime: null,
        };
      }
      return {
        status: "installed_current" as const,
        installedVersion: status.state.daemonVersion,
        expectedVersion,
      };
    })
    .then(async (service) => {
      const runtime = await readCurrentObservedDaemonRuntimeStatus().catch(
        () => null
      );
      const executionCompatibility =
        await resolveDaemonRuntimeContractCompatibility({
          runtimeStatus: runtime?.status ?? "unknown",
        });
      return {
        ...service,
        executionCompatibility: toStartBackgroundHelperExecutionCompatibility(
          executionCompatibility
        ),
        runtime,
      };
    })
    .catch((error) => ({
      status: "unknown" as const,
      installedVersion: null,
      expectedVersion,
      runtime: null,
      error:
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "service readiness unavailable",
    }));
}

export async function resolveStartLocalBackgroundHelperDemand(input: {
  ownerUserId?: string | null;
}): Promise<Awaited<ReturnType<typeof resolveLocalServiceDemand>>> {
  return await resolveLocalServiceDemand(input);
}

export async function runStartLocalBackgroundHelperInstall(input: {
  view?: string;
}): Promise<void> {
  await runDaemonInstall({
    view: input.view,
  });
}

export async function runStartLocalBackgroundHelperBackgroundStart(input: {
  view?: string;
}): Promise<Awaited<ReturnType<typeof runDaemonBackgroundStartForDecision>>> {
  return await runDaemonBackgroundStartForDecision({
    view: input.view,
  });
}
