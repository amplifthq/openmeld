import { providerDispatchRuntimeContextSchema } from "@openmeld/schemas";
import type { ProviderDispatchRuntimeContext } from "@openmeld/schemas/types";
import { listProjectConnectionsWithStatus } from "../agent-activity/project-bindings";
import type { OpenMeldAccountKey } from "../config/paths";
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

export type CurrentEffectiveProfileWorkingFolderRuntimeResolution =
  | (ProfileWorkspaceRuntimeResolution & {
      workingFolderFact: ProfileWorkingFolderFact;
      workingFolderSource: "profile_workspace";
    })
  | (DefaultProjectWorkingFolderResolution & {
      workingFolderFact: ProfileWorkingFolderFact;
    });

export type ProfileWorkingFolderFact = {
  defaultProjectId: string | null;
  localProjectBindingGeneration: string | null;
  observedAtMs: number;
  reasonCode:
    | "profile.workspace.invalid"
    | "profile.workspace.missing"
    | "project.local_connection.folder_missing"
    | "project.local_connection.invalid"
    | "project.local_connection.missing"
    | null;
  source: "default_project" | "profile_workspace";
  status: "invalid" | "missing" | "ready";
};

export async function resolveEffectiveProfileWorkingFolderRuntime(input: {
  account?: OpenMeldAccountKey;
  defaultProjectId?: string | null;
  openMeldProfileId: string;
  mode: "dispatch" | "inspect";
}): Promise<EffectiveProfileWorkingFolderRuntimeResolution> {
  const current =
    await resolveCurrentEffectiveProfileWorkingFolderRuntime(input);
  if (current.workingFolderSource === "profile_workspace") {
    const {
      workingFolderFact: _workingFolderFact,
      workingFolderSource: _workingFolderSource,
      ...profileWorkspaceResolution
    } = current;
    return profileWorkspaceResolution;
  }
  const { workingFolderFact: _workingFolderFact, ...defaultProjectResolution } =
    current;
  return defaultProjectResolution;
}

export async function resolveCurrentEffectiveProfileWorkingFolderRuntime(input: {
  account?: OpenMeldAccountKey;
  defaultProjectId?: string | null;
  openMeldProfileId: string;
  mode: "dispatch" | "inspect";
}): Promise<CurrentEffectiveProfileWorkingFolderRuntimeResolution> {
  if (!input.defaultProjectId) {
    const resolution = await resolveProfileWorkspaceRuntime({
      ...(input.account ? { account: input.account } : {}),
      mode: input.mode,
      openMeldProfileId: input.openMeldProfileId,
    });
    return {
      ...resolution,
      workingFolderFact: {
        defaultProjectId: null,
        localProjectBindingGeneration: null,
        observedAtMs: Date.now(),
        reasonCode: resolveProfileWorkspaceFactReasonCode(resolution.status),
        source: "profile_workspace",
        status: resolution.status,
      },
      workingFolderSource: "profile_workspace",
    };
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
      workingFolderFact: {
        defaultProjectId: input.defaultProjectId,
        localProjectBindingGeneration: null,
        observedAtMs: Date.now(),
        reasonCode: "project.local_connection.missing",
        source: "default_project",
        status: "missing",
      },
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
      workingFolderFact: {
        defaultProjectId: input.defaultProjectId,
        localProjectBindingGeneration: connection.bindingGeneration,
        observedAtMs: Date.now(),
        reasonCode: "project.local_connection.folder_missing",
        source: "default_project",
        status: "missing",
      },
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
      workingFolderFact: {
        defaultProjectId: input.defaultProjectId,
        localProjectBindingGeneration: connection.bindingGeneration,
        observedAtMs: Date.now(),
        reasonCode: "project.local_connection.invalid",
        source: "default_project",
        status: "invalid",
      },
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
    workingFolderFact: {
      defaultProjectId: input.defaultProjectId,
      localProjectBindingGeneration: connection.bindingGeneration,
      observedAtMs: Date.now(),
      reasonCode: null,
      source: "default_project",
      status: "ready",
    },
    workingFolderSource: "default_project",
    workspaceMode: null,
  };
}

function resolveProfileWorkspaceFactReasonCode(
  status: ProfileWorkspaceRuntimeResolution["status"]
): ProfileWorkingFolderFact["reasonCode"] {
  if (status === "ready") {
    return null;
  }
  return status === "missing"
    ? "profile.workspace.missing"
    : "profile.workspace.invalid";
}
