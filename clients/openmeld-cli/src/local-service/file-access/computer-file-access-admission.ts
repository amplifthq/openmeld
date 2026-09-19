import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type {
  AdapterComputerFileAccessBoundary,
  AdapterComputerFileAccessVerificationResult,
  AdapterInteractionCallback,
  AdapterTransportMode,
  AgentControllerPermissionMode,
} from "@openmeld/adapter-core";
import { COMPUTER_FILE_ACCESS_OWNER_CANCELLED_REASON_CODE } from "@openmeld/schemas";
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
  ) => Promise<AdapterComputerFileAccessVerificationResult>;
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

  const verification = await input.verifyBoundary?.(input.policy);
  if (verification?.supported) {
    return { boundary: input.policy, bypassedForThisRun: false };
  }

  const launchRejected =
    verification?.reasonCode === "computer.file_access.launch_rejected";
  const response = await input.onInteractionRequest({
    description: launchRejected
      ? "The local agent could not start with the requested file access settings. Cancel and check the selected agent’s version and configuration. Running once without this boundary removes the Computer file access restriction for this Wake."
      : "OpenMeld can’t verify that this local agent can enforce this computer’s file access boundary. Run this Wake once without the boundary, or cancel it.",
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

  if (
    response.kind !== "permission" ||
    response.optionId !== CANCEL_OPTION_ID
  ) {
    const code =
      response.kind === "cancel"
        ? "computer.file_access.interaction_cancelled"
        : "computer.file_access.response_invalid";
    throw new DaemonServiceRunError({
      code,
      message: `${code}: the file access decision did not authorize this run`,
    });
  }
  throw new DaemonServiceRunError({
    code: COMPUTER_FILE_ACCESS_OWNER_CANCELLED_REASON_CODE,
    message: `${COMPUTER_FILE_ACCESS_OWNER_CANCELLED_REASON_CODE}: the Computer owner declined running this Wake without the configured file access boundary`,
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
