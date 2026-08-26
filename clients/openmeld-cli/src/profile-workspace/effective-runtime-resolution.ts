import { providerDispatchRuntimeContextSchema } from "@openmeld/schemas";
import type { ProviderDispatchRuntimeContext } from "@openmeld/schemas/types";
import { listProjectConnectionsWithStatus } from "../agent-activity/project-bindings";
import {
  type ProfileWorkspaceRuntimeResolution,
  resolveProfileWorkspaceRuntime,
} from "./runtime-resolution";

type DefaultProjectWorkingFolderResolution =
  | {
      configPath: null;
      configuredWorkspacePath: string;
      defaultProjectBindingGeneration: string;
      defaultProjectId: string;
      effectiveRuntimeWorkingDirectory: string;
      runtimeContext: ProviderDispatchRuntimeContext;
      status: "ready";
      workingFolderSource: "default_project";
      workspaceMode: null;
    }
  | {
      configPath: null;
      configuredWorkspacePath: string | null;
      defaultProjectBindingGeneration?: string;
      defaultProjectFailureReason: "folder_missing" | "missing_connection";
      defaultProjectId: string;
      reasonCode: "workspace.missing";
      reasonText: string;
      status: "missing";
      workingFolderSource: "default_project";
      workspaceMode: null;
    }
  | {
      configPath: null;
      configuredWorkspacePath: string;
      defaultProjectBindingGeneration: string;
      defaultProjectId: string;
      reasonCode: "workspace.invalid";
      reasonText: string;
      status: "invalid";
      workingFolderSource: "default_project";
      workspaceMode: null;
    };

export type EffectiveProfileWorkingFolderRuntimeResolution =
  | ProfileWorkspaceRuntimeResolution
  | DefaultProjectWorkingFolderResolution;

export async function resolveEffectiveProfileWorkingFolderRuntime(input: {
  defaultProjectId?: string | null;
  openMeldProfileId: string;
  mode: "dispatch" | "inspect";
}): Promise<EffectiveProfileWorkingFolderRuntimeResolution> {
  if (!input.defaultProjectId) {
    return await resolveProfileWorkspaceRuntime({
      mode: input.mode,
      openMeldProfileId: input.openMeldProfileId,
    });
  }

  const connections = await listProjectConnectionsWithStatus({});
  const connection = connections.find(
    (item) => item.projectId === input.defaultProjectId && item.isDefault
  );
  if (!connection) {
    return {
      configPath: null,
      configuredWorkspacePath: null,
      defaultProjectFailureReason: "missing_connection",
      defaultProjectId: input.defaultProjectId,
      reasonCode: "workspace.missing",
      reasonText: `Default Project ${input.defaultProjectId} has no local folder connection on this computer.`,
      status: "missing",
      workingFolderSource: "default_project",
      workspaceMode: null,
    };
  }
  if (connection.status === "missing") {
    return {
      configPath: null,
      configuredWorkspacePath: connection.repositoryPath,
      defaultProjectBindingGeneration: connection.bindingGeneration,
      defaultProjectFailureReason: "folder_missing",
      defaultProjectId: input.defaultProjectId,
      reasonCode: "workspace.missing",
      reasonText: `The local folder connected to Default Project ${input.defaultProjectId} is missing on this computer.`,
      status: "missing",
      workingFolderSource: "default_project",
      workspaceMode: null,
    };
  }

  const runtimeContext = providerDispatchRuntimeContextSchema.safeParse({
    providerRuntimeWorkingDirectory: connection.repositoryPath,
  });
  if (!runtimeContext.success) {
    return {
      configPath: null,
      configuredWorkspacePath: connection.repositoryPath,
      defaultProjectBindingGeneration: connection.bindingGeneration,
      defaultProjectId: input.defaultProjectId,
      reasonCode: "workspace.invalid",
      reasonText: `The local folder connected to Default Project ${input.defaultProjectId} is not a valid runtime working directory.`,
      status: "invalid",
      workingFolderSource: "default_project",
      workspaceMode: null,
    };
  }
  return {
    configPath: null,
    configuredWorkspacePath: connection.repositoryPath,
    defaultProjectBindingGeneration: connection.bindingGeneration,
    defaultProjectId: input.defaultProjectId,
    effectiveRuntimeWorkingDirectory: connection.repositoryPath,
    runtimeContext: runtimeContext.data,
    status: "ready",
    workingFolderSource: "default_project",
    workspaceMode: null,
  };
}
