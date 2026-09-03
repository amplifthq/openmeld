import type { OpenClawGatewayVisibility } from "@openmeld/local-service";
import { providerDispatchRuntimeContextSchema } from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchControllerSnapshot,
  ProviderDispatchRuntimeContext,
  RuntimeTransportDeliveryExecutionIdentity,
} from "@openmeld/schemas/types";
import {
  resolveCurrentEffectiveProfileWorkingFolderRuntime,
  resolveEffectiveProfileWorkingFolderRuntime,
} from "../../profile-workspace/effective-runtime-resolution";
import {
  type ProviderRuntimePreparationDetails,
  prepareProviderRuntime,
} from "../../provider-hosts/prepare-provider-runtime";
import type { DaemonProfileRouteConfig } from "../core/types";
import { DaemonServiceRunError } from "../core/types";

// A healthy session re-observes the route at most every 45 seconds. Keep the
// compatibility launch fence aligned with the current route-lease freshness
// window so a transient catalog read failure can preserve a genuinely current
// route without allowing historical folder state to launch new work.
export const CURRENT_ROUTE_WORKING_FOLDER_FRESHNESS_MS = 200_000;

export type DispatchRuntimePreparation = {
  effectiveRuntimeContext: ProviderDispatchRuntimeContext;
  runtimePreparationDetails: ProviderRuntimePreparationDetails;
  runtimeEnvOverrides: Record<string, string | undefined> | undefined;
  runtimeOpenClawGatewayVisibility: OpenClawGatewayVisibility | null;
};

export async function resolveDispatchRuntimeContext(input: {
  defaultProjectId?: string | null;
  openMeldProfileId: string;
}): Promise<ProviderDispatchRuntimeContext> {
  const resolution = await resolveEffectiveProfileWorkingFolderRuntime({
    defaultProjectId: input.defaultProjectId,
    openMeldProfileId: input.openMeldProfileId,
    mode: "dispatch",
  });
  if (resolution.status === "ready") {
    return resolution.runtimeContext;
  }
  if (resolution.status === "missing") {
    if (
      "workingFolderSource" in resolution &&
      resolution.workingFolderSource === "default_project" &&
      resolution.defaultProjectId
    ) {
      const folderMissing =
        resolution.defaultProjectFailureReason === "folder_missing";
      throw new DaemonServiceRunError({
        code: folderMissing
          ? "project.local_connection.folder_missing"
          : "project.local_connection.missing",
        message: folderMissing
          ? "project.local_connection.folder_missing"
          : "project.local_connection.missing",
        projectFailureContext: {
          ...(resolution.defaultProjectBindingGeneration
            ? {
                bindingGeneration: resolution.defaultProjectBindingGeneration,
              }
            : {}),
          projectId: resolution.defaultProjectId,
        },
      });
    }
    throw new DaemonServiceRunError({
      code: "profile.workspace.missing",
      message: `profile.workspace.missing: ${resolution.reasonText}`,
    });
  }
  if (
    "workingFolderSource" in resolution &&
    resolution.workingFolderSource === "default_project" &&
    resolution.defaultProjectId
  ) {
    throw new DaemonServiceRunError({
      code: "project.local_connection.invalid",
      message: "project.local_connection.invalid",
      projectFailureContext: {
        ...(resolution.defaultProjectBindingGeneration
          ? {
              bindingGeneration: resolution.defaultProjectBindingGeneration,
            }
          : {}),
        projectId: resolution.defaultProjectId,
      },
    });
  }
  throw new DaemonServiceRunError({
    code: "profile.workspace.invalid",
    message: `profile.workspace.invalid: ${resolution.reasonText}`,
  });
}

export async function resolveDispatchWorkingFolderRuntimeContext(input: {
  controllerSnapshot: OpenMeldDaemonDispatchControllerSnapshot;
  defaultProjectId: string | null;
  defaultProjectIdWasProvided: boolean;
  executionIdentity: RuntimeTransportDeliveryExecutionIdentity;
  nowMs?: number;
  onCurrentWorkingFolderFactRejected?: () => void;
  routeConfig: DaemonProfileRouteConfig | null;
  targetProfileId: string;
}): Promise<ProviderDispatchRuntimeContext> {
  const route = input.routeConfig;
  const workingFolderRuntime = route?.workingFolderRuntime;
  if (!(route && workingFolderRuntime)) {
    rejectCurrentWorkingFolderFact(
      input,
      "missing",
      "the current route has no working-folder observation"
    );
  }
  if (
    input.defaultProjectIdWasProvided &&
    input.defaultProjectId !==
      workingFolderRuntime.workingFolderFact.defaultProjectId
  ) {
    rejectCurrentWorkingFolderFact(
      input,
      "identity_mismatch",
      "the delivered Default Project does not match the current route observation"
    );
  }
  const identity = input.executionIdentity.core;
  const controllerSnapshot = input.controllerSnapshot;
  if (
    route.profileId !== input.targetProfileId ||
    identity.targetProfileId !== input.targetProfileId ||
    route.bindingId !== identity.bindingId ||
    controllerSnapshot.bindingId !== identity.bindingId ||
    typeof route.configurationRevision !== "number" ||
    typeof controllerSnapshot.configurationRevision !== "number" ||
    route.configurationRevision !== controllerSnapshot.configurationRevision ||
    route.agentControllerRef !== identity.agentControllerRef ||
    controllerSnapshot.agentControllerRef !== identity.agentControllerRef ||
    route.openMeldServiceRuntimeId !== identity.openMeldServiceRuntimeId.value
  ) {
    rejectCurrentWorkingFolderFact(
      input,
      "identity_mismatch",
      "the current route does not match the accepted dispatch identity"
    );
  }
  const observedAtMs = workingFolderRuntime.workingFolderFact.observedAtMs;
  const nowMs = input.nowMs ?? Date.now();
  if (
    observedAtMs > nowMs ||
    nowMs - observedAtMs >= CURRENT_ROUTE_WORKING_FOLDER_FRESHNESS_MS
  ) {
    rejectCurrentWorkingFolderFact(
      input,
      "stale",
      "the current route working-folder observation has expired"
    );
  }
  const currentWorkingFolder =
    await resolveCurrentEffectiveProfileWorkingFolderRuntime({
      defaultProjectId: workingFolderRuntime.workingFolderFact.defaultProjectId,
      mode: "dispatch",
      openMeldProfileId: input.targetProfileId,
    });
  const currentFact = currentWorkingFolder.workingFolderFact;
  if (
    currentWorkingFolder.status !== "ready" ||
    currentFact.source !== workingFolderRuntime.workingFolderFact.source ||
    currentFact.defaultProjectId !==
      workingFolderRuntime.workingFolderFact.defaultProjectId ||
    currentFact.localProjectBindingGeneration !==
      workingFolderRuntime.workingFolderFact.localProjectBindingGeneration ||
    currentWorkingFolder.runtimeContext.providerRuntimeWorkingDirectory !==
      workingFolderRuntime.runtimeContext.providerRuntimeWorkingDirectory
  ) {
    rejectCurrentWorkingFolderFact(
      input,
      "changed",
      "the effective working folder changed after this route was observed"
    );
  }
  return workingFolderRuntime.runtimeContext;
}

function rejectCurrentWorkingFolderFact(
  input: { onCurrentWorkingFolderFactRejected?: () => void },
  reason: "changed" | "identity_mismatch" | "missing" | "stale",
  detail: string
): never {
  input.onCurrentWorkingFolderFactRejected?.();
  throwCurrentWorkingFolderFactError(reason, detail);
}

function throwCurrentWorkingFolderFactError(
  reason: "changed" | "identity_mismatch" | "missing" | "stale",
  detail: string
): never {
  throw new DaemonServiceRunError({
    code: `profile.working_folder.current_fact_${reason}`,
    message: `profile.working_folder.current_fact_${reason}: ${detail}`,
  });
}

export async function resolveDispatchRuntimeEnvOverrides(input: {
  daemonWorkingDirectory: string;
  parsedTask: {
    agentControllerRef: string;
    targetProfileId: string;
  };
  profileName: string | null;
  providerRuntimeWorkingDirectory?: string;
}): Promise<Record<string, string | undefined> | undefined> {
  return (
    await prepareProviderRuntime({
      agentControllerRef: input.parsedTask.agentControllerRef,
      daemonWorkingDirectory: input.daemonWorkingDirectory,
      mode: "dispatch",
      profileName: input.profileName,
      runtimeContext: parseDispatchRuntimeContextOrThrow({
        providerRuntimeWorkingDirectory:
          input.providerRuntimeWorkingDirectory ?? input.daemonWorkingDirectory,
        source: `dispatch runtime env overrides for ${input.parsedTask.targetProfileId}`,
      }),
      targetProfileId: input.parsedTask.targetProfileId,
    })
  ).envOverrides;
}

export async function prepareDispatchRuntimeExecution(input: {
  agentControllerRef: string;
  daemonWorkingDirectory: string;
  dispatchRuntimeContext: ProviderDispatchRuntimeContext;
  profileName: string | null;
  targetProfileId: string;
}): Promise<DispatchRuntimePreparation> {
  const runtimePreparation = await prepareProviderRuntime({
    agentControllerRef: input.agentControllerRef,
    daemonWorkingDirectory: input.daemonWorkingDirectory,
    mode: "dispatch",
    profileName: input.profileName,
    runtimeContext: input.dispatchRuntimeContext,
    targetProfileId: input.targetProfileId,
  });
  const openClawPreparation =
    runtimePreparation.preparationDetails.kind === "openclaw"
      ? runtimePreparation.preparationDetails
      : null;

  return {
    effectiveRuntimeContext: runtimePreparation.runtimeContext,
    runtimePreparationDetails: runtimePreparation.preparationDetails,
    runtimeEnvOverrides: runtimePreparation.envOverrides,
    runtimeOpenClawGatewayVisibility:
      openClawPreparation?.openClawGatewayVisibility ?? null,
  };
}

function parseDispatchRuntimeContextOrThrow(input: {
  providerRuntimeWorkingDirectory: string;
  source: string;
}): ProviderDispatchRuntimeContext {
  const parsed = providerDispatchRuntimeContextSchema.safeParse({
    providerRuntimeWorkingDirectory: input.providerRuntimeWorkingDirectory,
  });
  if (parsed.success) {
    return parsed.data;
  }
  throw new DaemonServiceRunError({
    code: "controller.runtime_context.invalid",
    message: `controller.runtime_context.invalid: invalid provider runtime working directory from ${input.source}`,
  });
}
