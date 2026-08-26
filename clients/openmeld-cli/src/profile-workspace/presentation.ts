import type { EffectiveProfileWorkingFolderRuntimeResolution } from "./effective-runtime-resolution";

export type ProfileWorkspacePresentation =
  | {
      configuredWorkspace: string;
      configuredWorkspaceDisplay: string;
      effectiveRuntimeWorkingDirectory: string;
      effectiveRuntimeWorkingDirectoryDisplay: string;
      reasonCode: null;
      reasonText: null;
      status: "openmeld_managed" | "custom" | "default_project";
      workspace: "OpenMeld-managed" | "Custom" | "Default Project";
      workspaceSource: "OpenMeld-managed" | "Custom" | "Default Project";
    }
  | {
      configuredWorkspace: string | null;
      configuredWorkspaceDisplay: string;
      effectiveRuntimeWorkingDirectory: string | null;
      effectiveRuntimeWorkingDirectoryDisplay: string;
      reasonCode: "workspace.missing" | "workspace.invalid";
      reasonText: string;
      status: "invalid" | "missing";
      workspace: "Invalid" | "Missing";
      workspaceSource: "OpenMeld-managed" | "Custom" | "Invalid" | "Missing";
    };

type WorkspaceRow = {
  label: string;
  value: string;
};

export function buildProfileWorkspacePresentation(
  resolution: EffectiveProfileWorkingFolderRuntimeResolution | null
): ProfileWorkspacePresentation | null {
  if (!resolution) {
    return null;
  }
  if (resolution.status === "ready") {
    if (
      "workingFolderSource" in resolution &&
      resolution.workingFolderSource === "default_project"
    ) {
      return {
        configuredWorkspace: resolution.configuredWorkspacePath,
        configuredWorkspaceDisplay: resolution.configuredWorkspacePath,
        effectiveRuntimeWorkingDirectory:
          resolution.effectiveRuntimeWorkingDirectory,
        effectiveRuntimeWorkingDirectoryDisplay:
          resolution.effectiveRuntimeWorkingDirectory,
        reasonCode: null,
        reasonText: null,
        status: "default_project",
        workspace: "Default Project",
        workspaceSource: "Default Project",
      };
    }
    if (resolution.workspaceMode === null) {
      throw new Error("Default Project working folder source is missing.");
    }
    const label =
      resolution.workspaceMode === "openmeld_managed"
        ? "OpenMeld-managed"
        : "Custom";
    return {
      configuredWorkspace: resolution.configuredWorkspacePath,
      configuredWorkspaceDisplay: resolution.configuredWorkspacePath,
      effectiveRuntimeWorkingDirectory:
        resolution.effectiveRuntimeWorkingDirectory,
      effectiveRuntimeWorkingDirectoryDisplay:
        resolution.effectiveRuntimeWorkingDirectory,
      reasonCode: null,
      reasonText: null,
      status: resolution.workspaceMode,
      workspace: label,
      workspaceSource: label,
    };
  }
  if (resolution.status === "missing") {
    return {
      configuredWorkspace: null,
      configuredWorkspaceDisplay: "Missing",
      effectiveRuntimeWorkingDirectory: null,
      effectiveRuntimeWorkingDirectoryDisplay: "Missing",
      reasonCode: resolution.reasonCode,
      reasonText: resolution.reasonText,
      status: "missing",
      workspace: "Missing",
      workspaceSource: "Missing",
    };
  }
  const workspaceSource = resolveInvalidWorkspaceSourceLabel(
    resolution.workspaceMode
  );
  return {
    configuredWorkspace: resolution.configuredWorkspacePath ?? null,
    configuredWorkspaceDisplay: resolution.configuredWorkspacePath ?? "Invalid",
    effectiveRuntimeWorkingDirectory: null,
    effectiveRuntimeWorkingDirectoryDisplay: "Invalid",
    reasonCode: resolution.reasonCode,
    reasonText: resolution.reasonText,
    status: "invalid",
    workspace: "Invalid",
    workspaceSource,
  };
}

export function buildProfileWorkspaceRows(
  presentation: ProfileWorkspacePresentation | null
): WorkspaceRow[] {
  if (!presentation) {
    return [];
  }
  return [
    { label: "Workspace", value: presentation.workspace },
    { label: "Workspace Type", value: presentation.workspaceSource },
    {
      label: "Workspace Folder",
      value: presentation.configuredWorkspaceDisplay,
    },
    {
      label: "Current Working Folder",
      value: presentation.effectiveRuntimeWorkingDirectoryDisplay,
    },
  ];
}

function resolveInvalidWorkspaceSourceLabel(
  workspaceMode: "openmeld_managed" | "custom" | null | undefined
): "OpenMeld-managed" | "Custom" | "Invalid" {
  if (workspaceMode === "openmeld_managed") {
    return "OpenMeld-managed";
  }
  if (workspaceMode === "custom") {
    return "Custom";
  }
  return "Invalid";
}
