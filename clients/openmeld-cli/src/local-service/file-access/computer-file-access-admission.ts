import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type {
  AdapterComputerFileAccessBoundary,
  AdapterInteractionCallback,
  AdapterTransportMode,
  AgentControllerPermissionMode,
} from "@openmeld/adapter-core";
import type { ComputerFileAccessPolicy } from "@openmeld/schemas/types";
import { DaemonServiceRunError } from "../core/types";

const RUN_ONCE_OPTION_ID = "run_once_without_computer_file_access_boundary";
const CANCEL_OPTION_ID = "cancel_computer_file_access_run";

export async function resolveComputerFileAccessAdmission(input: {
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  agentControllerRef: string;
  onInteractionRequest: AdapterInteractionCallback;
  policy: ComputerFileAccessPolicy;
  providerRuntimeWorkingDirectory: string;
  transportMode: AdapterTransportMode;
  verifyBoundary?: (
    boundary: AdapterComputerFileAccessBoundary
  ) => Promise<boolean>;
}): Promise<{
  boundary: AdapterComputerFileAccessBoundary | null;
  bypassedForThisRun: boolean;
}> {
  if (input.policy.mode === "local_agent_settings") {
    return { boundary: null, bypassedForThisRun: false };
  }

  await assertComputerFileAccessWorkingDirectoryAllowed({
    boundary: input.policy,
    providerRuntimeWorkingDirectory: input.providerRuntimeWorkingDirectory,
  });

  if (input.verifyBoundary && (await input.verifyBoundary(input.policy))) {
    return { boundary: input.policy, bypassedForThisRun: false };
  }

  const response = await input.onInteractionRequest({
    description:
      "OpenMeld can’t verify that this local agent can enforce this computer’s file access boundary. Run this Wake once without the boundary, or cancel it.",
    kind: "permission",
    options: [
      {
        intent: "allow_once",
        label: "Run once without this boundary",
        optionId: RUN_ONCE_OPTION_ID,
      },
      {
        intent: "deny",
        label: "Cancel run",
        optionId: CANCEL_OPTION_ID,
      },
    ],
    subject: {
      resource: "Computer file access boundary",
      type: "additional_permissions",
    },
    title: "File access needs your decision",
  });

  if (
    response.kind === "permission" &&
    response.optionId === RUN_ONCE_OPTION_ID
  ) {
    return { boundary: null, bypassedForThisRun: true };
  }

  throw new DaemonServiceRunError({
    code: "computer.file_access.owner_cancelled",
    message:
      "computer.file_access.owner_cancelled: the Computer owner cancelled this Wake instead of running without the configured file access boundary",
  });
}

export async function assertComputerFileAccessWorkingDirectoryAllowed(input: {
  boundary: AdapterComputerFileAccessBoundary;
  providerRuntimeWorkingDirectory: string;
}): Promise<void> {
  const workingDirectory = await realpath(
    input.providerRuntimeWorkingDirectory
  );
  const matchesConfiguredFolder = input.boundary.folders.some((folder) =>
    isSameOrDescendant(workingDirectory, folder)
  );
  const allowed =
    input.boundary.mode === "only_selected_folders"
      ? matchesConfiguredFolder
      : !matchesConfiguredFolder;
  if (allowed) {
    return;
  }

  throw new DaemonServiceRunError({
    code: "computer.file_access.working_directory_denied",
    message:
      "computer.file_access.working_directory_denied: this Wake’s working folder is outside the Computer file access boundary",
  });
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  const relativePath = relative(parent, candidate);
  return (
    relativePath === "" ||
    !(relativePath.startsWith("..") || isAbsolute(relativePath))
  );
}
