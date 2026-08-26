import { describe, expect, it } from "vitest";
import { accountProfileWorkspacePath } from "../src/config/paths";
import {
  buildProfileWorkspacePresentation,
  buildProfileWorkspaceRows,
} from "../src/profile-workspace/presentation";

describe("profile workspace presentation", () => {
  it("shows the Default Project folder as the current working folder", () => {
    const projectFolder = "/Users/felix/Desktop/work/openmeld";
    const presentation = buildProfileWorkspacePresentation({
      configPath: null,
      configuredWorkspacePath: projectFolder,
      defaultProjectBindingGeneration: "binding-project-openmeld",
      defaultProjectId: "project-openmeld",
      effectiveRuntimeWorkingDirectory: projectFolder,
      runtimeContext: {
        providerRuntimeWorkingDirectory: projectFolder,
      },
      status: "ready",
      workingFolderSource: "default_project",
      workspaceMode: null,
    });

    expect(presentation).toMatchObject({
      configuredWorkspace: projectFolder,
      effectiveRuntimeWorkingDirectory: projectFolder,
      status: "default_project",
      workspace: "Default Project",
      workspaceSource: "Default Project",
    });
    expect(buildProfileWorkspaceRows(presentation)).toContainEqual({
      label: "Current Working Folder",
      value: projectFolder,
    });
  });

  it("renders OpenMeld-managed workspace facts with one vocabulary", () => {
    const workspacePath = accountProfileWorkspacePath(
      {
        hostKey: "localhost_8788",
        userKey: "user-owner",
      },
      "agt-demo"
    );

    const presentation = buildProfileWorkspacePresentation({
      configPath: "/tmp/local-meta.json",
      configuredWorkspacePath: workspacePath,
      effectiveRuntimeWorkingDirectory: workspacePath,
      runtimeContext: {
        providerRuntimeWorkingDirectory: workspacePath,
      },
      status: "ready",
      workspaceMode: "openmeld_managed",
    });

    expect(presentation).toMatchObject({
      workspace: "OpenMeld-managed",
      workspaceSource: "OpenMeld-managed",
      configuredWorkspace: workspacePath,
      configuredWorkspaceDisplay: workspacePath,
      effectiveRuntimeWorkingDirectory: workspacePath,
      effectiveRuntimeWorkingDirectoryDisplay: workspacePath,
      reasonCode: null,
      reasonText: null,
      status: "openmeld_managed",
    });
    expect(buildProfileWorkspaceRows(presentation)).toEqual([
      { label: "Workspace", value: "OpenMeld-managed" },
      { label: "Workspace Type", value: "OpenMeld-managed" },
      { label: "Workspace Folder", value: workspacePath },
      {
        label: "Current Working Folder",
        value: workspacePath,
      },
    ]);
  });

  it("keeps the configured custom path visible when the workspace is invalid", () => {
    const configuredWorkspace = "/tmp/custom-repo";

    const presentation = buildProfileWorkspacePresentation({
      configPath: "/tmp/local-meta.json",
      configuredWorkspacePath: configuredWorkspace,
      reasonCode: "workspace.invalid",
      reasonText: "This profile workspace on this device is invalid.",
      status: "invalid",
      workspaceMode: "custom",
    });

    expect(presentation).toMatchObject({
      workspace: "Invalid",
      workspaceSource: "Custom",
      configuredWorkspace,
      configuredWorkspaceDisplay: configuredWorkspace,
      effectiveRuntimeWorkingDirectory: null,
      effectiveRuntimeWorkingDirectoryDisplay: "Invalid",
      reasonCode: "workspace.invalid",
      reasonText: "This profile workspace on this device is invalid.",
      status: "invalid",
    });
    expect(buildProfileWorkspaceRows(presentation)).toEqual([
      { label: "Workspace", value: "Invalid" },
      { label: "Workspace Type", value: "Custom" },
      { label: "Workspace Folder", value: configuredWorkspace },
      {
        label: "Current Working Folder",
        value: "Invalid",
      },
    ]);
  });

  it("renders missing workspace as explicit missing facts", () => {
    const presentation = buildProfileWorkspacePresentation({
      configPath: "/tmp/local-meta.json",
      reasonCode: "workspace.missing",
      reasonText: "This profile is missing its local workspace on this device.",
      status: "missing",
    });

    expect(presentation).toMatchObject({
      workspace: "Missing",
      workspaceSource: "Missing",
      configuredWorkspace: null,
      configuredWorkspaceDisplay: "Missing",
      effectiveRuntimeWorkingDirectory: null,
      effectiveRuntimeWorkingDirectoryDisplay: "Missing",
      reasonCode: "workspace.missing",
      status: "missing",
    });
  });
});
