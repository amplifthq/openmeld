import type { OpenClawGatewayVisibility } from "@openmeld/local-service";
import { providerDispatchRuntimeContextSchema } from "@openmeld/schemas";
import type { ProviderDispatchRuntimeContext } from "@openmeld/schemas/types";
import { listProjectConnectionsWithStatus } from "../../agent-activity/project-bindings";
import { resolveProfileWorkspaceRuntime } from "../../profile-workspace/runtime-resolution";
import {
  type ProviderRuntimePreparationDetails,
  prepareProviderRuntime,
} from "../../provider-hosts/prepare-provider-runtime";
import { DaemonServiceRunError } from "../core/types";

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
  if (input.defaultProjectId) {
    return await resolveDefaultProjectRuntimeContext(input.defaultProjectId);
  }
  const resolution = await resolveProfileWorkspaceRuntime({
    openMeldProfileId: input.openMeldProfileId,
    mode: "dispatch",
  });
  if (resolution.status === "ready") {
    return resolution.runtimeContext;
  }
  if (resolution.status === "missing") {
    throw new DaemonServiceRunError({
      code: "profile.workspace.missing",
      message: `profile.workspace.missing: ${resolution.reasonText}`,
    });
  }
  throw new DaemonServiceRunError({
    code: "profile.workspace.invalid",
    message: `profile.workspace.invalid: ${resolution.reasonText}`,
  });
}

async function resolveDefaultProjectRuntimeContext(
  projectId: string
): Promise<ProviderDispatchRuntimeContext> {
  const connections = await listProjectConnectionsWithStatus({});
  const defaultConnection = connections.find(
    (connection) => connection.projectId === projectId && connection.isDefault
  );
  if (!defaultConnection) {
    throw new DaemonServiceRunError({
      code: "project.local_connection.missing",
      message: "project.local_connection.missing",
      projectFailureContext: { projectId },
    });
  }
  if (defaultConnection.status === "missing") {
    throw new DaemonServiceRunError({
      code: "project.local_connection.folder_missing",
      message: "project.local_connection.folder_missing",
      projectFailureContext: {
        bindingGeneration: defaultConnection.bindingGeneration,
        projectId,
      },
    });
  }
  return parseDispatchRuntimeContextOrThrow({
    providerRuntimeWorkingDirectory: defaultConnection.repositoryPath,
    source: `Default Project ${projectId}`,
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
