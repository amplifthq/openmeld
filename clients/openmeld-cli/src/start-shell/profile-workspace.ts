import { note } from "@clack/prompts";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildProfileWorkspacePresentation } from "../profile-workspace/presentation";
import {
  type ProfileWorkspaceRuntimeResolution,
  resolveProfileWorkspaceRuntime,
} from "../profile-workspace/runtime-resolution";
import { ensureOpenMeldManagedProfileWorkspace } from "../profile-workspace/service";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import type { createPresenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";

type StartPresenter = ReturnType<typeof createPresenter>;

export async function resolveStartSelectedProfileWorkspace(input: {
  profile: OpenMeldProfile;
}): Promise<ProfileWorkspaceRuntimeResolution | null> {
  if (input.profile.profileKind !== "agent") {
    return null;
  }

  let resolution = await resolveProfileWorkspaceRuntime({
    openMeldProfileId: input.profile.openMeldProfileId,
    mode: "inspect",
  });
  if (resolution.status === "missing") {
    await ensureOpenMeldManagedProfileWorkspace({
      openMeldProfileId: input.profile.openMeldProfileId,
    });
    resolution = await resolveProfileWorkspaceRuntime({
      openMeldProfileId: input.profile.openMeldProfileId,
      mode: "inspect",
    });
  }
  return resolution;
}

export function emitStartSelectedProfileWorkspace(input: {
  presenter: StartPresenter;
  profile: OpenMeldProfile;
  resolvedView: RuntimeContext["resolvedView"];
  resolution: ProfileWorkspaceRuntimeResolution | null;
}): void {
  if (!input.resolution) {
    return;
  }

  const workspace = buildProfileWorkspacePresentation(input.resolution);
  if (!workspace) {
    return;
  }

  const changeCommand = formatOpenMeldCliCommand(
    `openmeld profiles update --profile ${input.profile.openMeldProfileId} --workspace-mode custom --workspace-path /absolute/path`
  );
  const repairCommand = formatOpenMeldCliCommand("openmeld doctor --repair");
  const summary = resolveStartWorkspaceSummary(workspace.status);

  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "start.profile.workspace",
      payload: {
        changeCommand,
        repairCommand,
        summary,
        workspace,
      },
    });
    return;
  }

  note(
    buildStartWorkspaceLines({
      changeCommand,
      repairCommand,
      summary,
      workspace,
    }).join("\n"),
    "Profile Workspace",
    {
      format: (value) => value,
    }
  );
}

function buildStartWorkspaceLines(input: {
  changeCommand: string;
  repairCommand: string;
  summary: string;
  workspace: NonNullable<ReturnType<typeof buildProfileWorkspacePresentation>>;
}): string[] {
  if (input.workspace.reasonCode === "workspace.invalid") {
    return [
      input.summary,
      `Workspace Folder: ${input.workspace.configuredWorkspaceDisplay}`,
      `Next: Run ${input.repairCommand}, then re-check with ${formatOpenMeldCliCommand("openmeld service status --profile <profile-id>")}.`,
    ];
  }

  if (input.workspace.reasonCode === "workspace.missing") {
    return [
      input.summary,
      `Next: Run ${input.repairCommand}, then re-check with ${formatOpenMeldCliCommand("openmeld service status --profile <profile-id>")}.`,
    ];
  }

  return [
    input.summary,
    `Workspace Folder: ${input.workspace.configuredWorkspaceDisplay}`,
    `You can switch this profile to another folder later with ${input.changeCommand}.`,
  ];
}

function resolveStartWorkspaceSummary(
  status: NonNullable<
    ReturnType<typeof buildProfileWorkspacePresentation>
  >["status"]
): string {
  switch (status) {
    case "openmeld_managed":
      return "This profile uses an OpenMeld workspace.";
    case "custom":
      return "This profile uses a custom workspace.";
    case "missing":
      return "This profile is missing its local workspace on this computer.";
    case "invalid":
      return "This profile's local workspace is broken on this computer.";
    default:
      return "This profile's workspace needs attention on this computer.";
  }
}
