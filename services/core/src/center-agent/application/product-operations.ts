import {
  buildLocalAgentConnectionCandidateId,
  getAgentControllerModelCatalogId,
  parseAgentControllerRef,
} from "@openmeld/agent-runtime";
import { resolvePublicAgentFailureRecovery } from "@openmeld/schemas";
import type {
  AgentProfileCreationPreferenceSelection,
  CenterAgentCheckAgentProfileReadinessResponse,
  CenterAgentComputerSetupOption,
  CenterAgentConnectAgentProfileToLocalAgentBody,
  CenterAgentConnectAgentProfileToLocalAgentResponse,
  CenterAgentCreateAgentProfileResponse,
  CenterAgentCreateConfiguredAgentProfileBody,
  CenterAgentListLocalAgentConnectionCandidatesResponse,
  CenterAgentLocalAgentConnectionCandidate,
  CenterAgentUpdateAgentProfileRuntimeSettingsBody,
  CenterAgentUpdateAgentProfileRuntimeSettingsResponse,
  EnsureAgentProfilePrimaryBindingResponse,
  ModelCatalog,
  PeopleComputersResponse,
  SetCurrentAgentProfileWorkspaceResponse,
} from "@openmeld/schemas/types";
import { readSafeRpcFailureReasonCode } from "../../shared/rpc/rpc-json";

type OperationStep =
  CenterAgentConnectAgentProfileToLocalAgentResponse["steps"][number];

type RuntimeSettingsInput = Pick<
  CenterAgentConnectAgentProfileToLocalAgentBody,
  | "agentControllerCollaborationMode"
  | "agentControllerPermissionMode"
  | "modelId"
  | "openCodePermission"
  | "reasoningLevel"
>;

type LocalFolderSaveReceipt = {
  agentProfileId: string;
  bindingTarget?: import("../../agent-profile-binding/application/agent-profile-binding-target").AgentProfileBindingTarget;
  status: "updated";
  target?: import("@openmeld/schemas/types").PeopleComputerTarget;
};

export type CenterAgentProductOperationDeps = {
  addAgentProfileToSpace(input: {
    agentProfileId: string;
    onBehalfOf?: CenterAgentCreateConfiguredAgentProfileBody["onBehalfOf"];
    spaceId: string;
  }): Promise<void>;
  checkAgentProfileReadiness(input: {
    agentProfileId: string;
  }): Promise<CenterAgentCheckAgentProfileReadinessResponse>;
  createAgentProfile(input: {
    onBehalfOf?: CenterAgentCreateConfiguredAgentProfileBody["onBehalfOf"];
    profileName: string;
  }): Promise<CenterAgentCreateAgentProfileResponse>;
  enableAgentProfile(input: {
    agentProfileId: string;
    onBehalfOf?: CenterAgentCreateConfiguredAgentProfileBody["onBehalfOf"];
  }): Promise<void>;
  ensureAgentProfilePrimaryBinding(input: {
    agentProfileId: string;
    candidate: CenterAgentLocalAgentConnectionCandidate;
    settings: RuntimeSettingsInput;
  }): Promise<EnsureAgentProfilePrimaryBindingResponse>;
  listLocalAgentConnectionCandidates(): Promise<CenterAgentListLocalAgentConnectionCandidatesResponse>;
  rememberAgentProfileCreationDefaults?(input: {
    agentControllerRef: string;
    configuration: AgentProfileCreationPreferenceSelection;
  }): Promise<void>;
  setAgentProfileDefaultProject?(input: {
    agentProfileId: string;
    defaultProjectId: string | null;
    expectedBindingTarget?: import("../../agent-profile-binding/application/agent-profile-binding-target").AgentProfileBindingTarget;
  }): Promise<void>;
  setAgentProfileWorkspace?(input: {
    agentProfileId: string;
    workspaceMode: NonNullable<
      CenterAgentUpdateAgentProfileRuntimeSettingsBody["workspaceMode"]
    >;
    workspacePath?: CenterAgentUpdateAgentProfileRuntimeSettingsBody["workspacePath"];
  }): Promise<
    SetCurrentAgentProfileWorkspaceResponse & {
      target?: import("@openmeld/schemas/types").PeopleComputerTarget;
      bindingTarget?: import("../../agent-profile-binding/application/agent-profile-binding-target").AgentProfileBindingTarget;
    }
  >;
  /** Sets the default folder by id after checking Core's folder projection. */
  setAgentProfileDefaultFolder?(input: {
    agentProfileId: string;
    folderId: string;
  }): Promise<LocalFolderSaveReceipt>;
  updateAgentControllerCollaborationMode(input: {
    agentControllerCollaborationMode: NonNullable<
      CenterAgentUpdateAgentProfileRuntimeSettingsBody["agentControllerCollaborationMode"]
    >;
    agentProfileId: string;
  }): Promise<EnsureAgentProfilePrimaryBindingResponse>;
  updateAgentControllerPermissionMode(input: {
    agentControllerPermissionMode: NonNullable<
      CenterAgentUpdateAgentProfileRuntimeSettingsBody["agentControllerPermissionMode"]
    >;
    agentProfileId: string;
  }): Promise<EnsureAgentProfilePrimaryBindingResponse>;
  updateModelSelection(input: {
    agentProfileId: string;
    modelId: NonNullable<
      CenterAgentUpdateAgentProfileRuntimeSettingsBody["modelId"]
    >;
    reasoningLevel?: CenterAgentUpdateAgentProfileRuntimeSettingsBody["reasoningLevel"];
  }): Promise<EnsureAgentProfilePrimaryBindingResponse>;
  updateOpenCodePermission(input: {
    agentProfileId: string;
    openCodePermission: NonNullable<
      CenterAgentUpdateAgentProfileRuntimeSettingsBody["openCodePermission"]
    >;
  }): Promise<EnsureAgentProfilePrimaryBindingResponse>;
};

export function projectCenterAgentLocalAgentConnectionCandidates(input: {
  modelCatalog?: ModelCatalog;
  peopleComputers: PeopleComputersResponse;
  organizationId: string;
}): CenterAgentListLocalAgentConnectionCandidatesResponse {
  const candidates: CenterAgentLocalAgentConnectionCandidate[] = [];
  for (const computer of input.peopleComputers.computers) {
    for (const target of computer.executionTargets) {
      if (!target.openMeldServiceRuntimeId) {
        continue;
      }
      for (const capability of target.capabilities) {
        const connection = computer.connection.sessions.find(
          (session) =>
            session.deviceId === target.deviceId &&
            session.runtimeLane === target.runtimeLane
        );
        const connectionReady =
          computer.connection.status === "connected" &&
          connection?.executionCompatibility.status === "compatible" &&
          !connection.serviceUpdate.wakeBlocked;
        const freshness = resolveCandidateFreshness(capability.status);
        const agentDisplayName =
          capability.agentControllerInterface?.displayName ??
          formatAgentControllerRef(capability.agentControllerRef);
        const candidate = {
          agentControllerRef: capability.agentControllerRef,
          agentDisplayName,
          candidateId: buildLocalAgentConnectionCandidateId({
            agentControllerRef: capability.agentControllerRef,
            deviceId: target.deviceId,
            runtimeLane: target.runtimeLane,
            openMeldServiceRuntimeId: target.openMeldServiceRuntimeId.value,
          }),
          connectable:
            connectionReady &&
            capability.enabled &&
            capability.status === "ready" &&
            target.status !== "stale",
          deviceDisplayName: computer.deviceDisplayName,
          deviceId: target.deviceId,
          freshness,
          lastObservedAtMs: target.lastObservedAtMs,
          ...readCandidateModelOptions(
            capability.agentControllerRef,
            input.modelCatalog
          ),
          reasonCodes: [
            ...new Set([
              ...computer.connection.reasonCodes,
              ...(connection?.serviceUpdate.reasonCodes ?? []),
              ...(connectionReady ? [] : ["computer.connection.not_ready"]),
              // Target reasons aggregate all controllers on this Runtime.
              // Only this capability can establish its controller blockers.
              ...capability.reasonCodes,
            ]),
          ],
          runtimeLane: target.runtimeLane,
          status: capability.status,
          openMeldServiceRuntimeId: target.openMeldServiceRuntimeId,
        };
        candidates.push(candidate);
      }
    }
  }

  return {
    candidates: candidates.sort((left, right) =>
      left.deviceDisplayName === right.deviceDisplayName
        ? left.agentDisplayName.localeCompare(right.agentDisplayName)
        : left.deviceDisplayName.localeCompare(right.deviceDisplayName)
    ),
    organizationId: input.organizationId,
  };
}

function readCandidateModelOptions(
  agentControllerRef: string,
  catalog: ModelCatalog | undefined
) {
  const ref = parseAgentControllerRef(agentControllerRef);
  const modelOptions =
    ref && catalog
      ? catalog.agentControllers[getAgentControllerModelCatalogId(ref)]
      : undefined;
  return modelOptions ? { modelOptions } : {};
}

export function projectCenterAgentComputerSetupOptions(
  peopleComputers: PeopleComputersResponse
): CenterAgentComputerSetupOption[] {
  return peopleComputers.computers
    .map((computer) => {
      const reasonCodes = [
        ...new Set([
          ...computer.connection.reasonCodes,
          ...computer.connection.sessions.flatMap(
            (session) => session.serviceUpdate.reasonCodes
          ),
          ...computer.executionTargets.flatMap((target) => [
            ...target.reasonCodes,
            ...target.capabilities.flatMap(
              (capability) => capability.reasonCodes
            ),
          ]),
        ]),
      ];
      const connectedComputerId = computer.connectedComputerId ?? null;
      const hasRequiredUpdate =
        computer.connection.sessions.some(
          (session) => session.serviceUpdate.wakeBlocked
        ) || reasonCodes.some(isServiceUpdateReasonCode);
      let recommendedMode: CenterAgentComputerSetupOption["recommendedMode"] =
        null;
      let status: CenterAgentComputerSetupOption["status"] = "connected";

      if (computer.connection.status === "unknown") {
        status = "unknown";
      } else if (
        computer.connection.status === "connected" &&
        !hasRequiredUpdate
      ) {
        // A connected Service with no discovered local agents is still connected.
        status = "connected";
      } else if (connectedComputerId === null) {
        recommendedMode = "setup";
        status = "not_connected";
      } else if (hasRequiredUpdate) {
        recommendedMode = "update_service";
        status = "needs_attention";
      } else if (computer.connection.status === "disconnected") {
        recommendedMode = "reconnect";
        status = "needs_attention";
      }

      return {
        connectedComputerId,
        deviceDisplayName: computer.deviceDisplayName,
        deviceId: computer.deviceId,
        // The hosted caller has no evidence of the human's physical computer.
        isCurrent: false,
        lastObservedAtMs: computer.lastObservedAtMs,
        reasonCodes,
        recommendedMode,
        status,
      };
    })
    .sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) {
        return left.isCurrent ? -1 : 1;
      }
      return left.deviceDisplayName.localeCompare(right.deviceDisplayName);
    });
}

function isServiceUpdateReasonCode(reasonCode: string): boolean {
  return (
    reasonCode === "service.update_required" ||
    reasonCode === "background_helper.update_required"
  );
}

export async function listLocalAgentConnectionCandidatesOperation(input: {
  deps: Pick<
    CenterAgentProductOperationDeps,
    "listLocalAgentConnectionCandidates"
  >;
}): Promise<CenterAgentListLocalAgentConnectionCandidatesResponse> {
  return await input.deps.listLocalAgentConnectionCandidates();
}

export async function checkAgentProfileReadinessOperation(input: {
  agentProfileId: string;
  deps: Pick<CenterAgentProductOperationDeps, "checkAgentProfileReadiness">;
}): Promise<CenterAgentCheckAgentProfileReadinessResponse> {
  return await input.deps.checkAgentProfileReadiness({
    agentProfileId: input.agentProfileId,
  });
}

export async function connectAgentProfileToLocalAgentOperation(input: {
  deps: Pick<
    CenterAgentProductOperationDeps,
    | "checkAgentProfileReadiness"
    | "ensureAgentProfilePrimaryBinding"
    | "listLocalAgentConnectionCandidates"
  >;
  request: CenterAgentConnectAgentProfileToLocalAgentBody;
}): Promise<CenterAgentConnectAgentProfileToLocalAgentResponse> {
  const connection = await connectAgentProfileToLocalAgentMutation(input);
  if (connection.status !== "completed") {
    return connection;
  }

  const steps = [...connection.steps];
  let readiness: CenterAgentCheckAgentProfileReadinessResponse;
  try {
    readiness = await input.deps.checkAgentProfileReadiness({
      agentProfileId: input.request.agentProfileId,
    });
  } catch (error) {
    steps.push(failedStep("check_agent_profile_readiness", error));
    return blockedConnectionResponse({
      agentProfileId: input.request.agentProfileId,
      binding: connection.binding,
      candidate: connection.candidate,
      organizationId: connection.organizationId,
      steps,
    });
  }
  steps.push({
    name: "check_agent_profile_readiness",
    status: readiness.canReply ? "completed" : "failed",
    ...(readiness.canReply
      ? { message: "Agent Profile can reply now." }
      : {
          message: readiness.summary,
          nextAction:
            "Use the readiness blockers to finish setup before waking this Agent Profile.",
        }),
  });

  return {
    ...connection,
    canReply: readiness.canReply,
    readiness,
    status: readiness.canReply ? "completed" : "blocked",
    steps,
  };
}

async function connectAgentProfileToLocalAgentMutation(input: {
  candidates?: CenterAgentListLocalAgentConnectionCandidatesResponse;
  deps: Pick<
    CenterAgentProductOperationDeps,
    "ensureAgentProfilePrimaryBinding" | "listLocalAgentConnectionCandidates"
  >;
  request: CenterAgentConnectAgentProfileToLocalAgentBody;
}): Promise<CenterAgentConnectAgentProfileToLocalAgentResponse> {
  const steps: OperationStep[] = [];
  const candidates =
    input.candidates ?? (await input.deps.listLocalAgentConnectionCandidates());
  const candidate = candidates.candidates.find(
    (item) => item.candidateId === input.request.candidateId
  );
  if (!candidate) {
    steps.push({
      name: "select_local_agent_connection_candidate",
      nextAction:
        "List local agent connection candidates again and choose a current candidate.",
      status: "failed",
      message: "Local agent connection candidate was not found.",
    });
    return blockedConnectionResponse({
      agentProfileId: input.request.agentProfileId,
      organizationId: candidates.organizationId,
      steps,
    });
  }
  steps.push({
    name: "select_local_agent_connection_candidate",
    status: "completed",
    message: `Selected ${candidate.agentDisplayName} on ${candidate.deviceDisplayName}.`,
  });

  if (!candidate.connectable) {
    steps.push({
      name: "connect_agent_profile_to_local_agent",
      nextAction:
        "Refresh local agents on that computer, then choose a ready candidate.",
      status: "failed",
      message: "The selected local agent is not ready to connect.",
    });
    return blockedConnectionResponse({
      agentProfileId: input.request.agentProfileId,
      candidate,
      organizationId: candidates.organizationId,
      steps,
    });
  }

  let binding: EnsureAgentProfilePrimaryBindingResponse;
  try {
    binding = await input.deps.ensureAgentProfilePrimaryBinding({
      agentProfileId: input.request.agentProfileId,
      candidate,
      settings: pickRuntimeSettings(input.request),
    });
  } catch (error) {
    steps.push(failedStep("connect_agent_profile_to_local_agent", error));
    return blockedConnectionResponse({
      agentProfileId: input.request.agentProfileId,
      candidate,
      organizationId: candidates.organizationId,
      steps,
    });
  }
  if (binding.status !== "accepted") {
    steps.push({
      name: "connect_agent_profile_to_local_agent",
      nextAction:
        "Review the returned Binding reason codes, then reconnect this Agent Profile.",
      status: "failed",
      message: `Binding was rejected: ${binding.reasonCodes.join(", ") || "unknown reason"}.`,
    });
    return blockedConnectionResponse({
      agentProfileId: input.request.agentProfileId,
      binding,
      candidate,
      organizationId: candidates.organizationId,
      steps,
    });
  }
  steps.push({
    name: "connect_agent_profile_to_local_agent",
    status: "completed",
    message: "Agent Profile Binding was written.",
  });

  return {
    agentProfileId: input.request.agentProfileId,
    binding,
    canReply: false,
    candidate,
    organizationId: candidates.organizationId,
    status: "completed",
    steps,
  };
}

export async function updateAgentProfileRuntimeSettingsOperation(input: {
  deps: Pick<
    CenterAgentProductOperationDeps,
    | "checkAgentProfileReadiness"
    | "setAgentProfileDefaultFolder"
    | "setAgentProfileDefaultProject"
    | "setAgentProfileWorkspace"
    | "updateAgentControllerCollaborationMode"
    | "updateAgentControllerPermissionMode"
    | "updateModelSelection"
    | "updateOpenCodePermission"
  >;
  organizationId: string;
  request: CenterAgentUpdateAgentProfileRuntimeSettingsBody;
}): Promise<CenterAgentUpdateAgentProfileRuntimeSettingsResponse> {
  const steps: OperationStep[] = [];
  let binding: EnsureAgentProfilePrimaryBindingResponse | undefined;
  let workspace: LocalFolderSaveReceipt | undefined;

  const collaborationModeResult =
    await applyAgentControllerCollaborationModeUpdate(input, steps);
  if (collaborationModeResult?.blockedResponse) {
    return collaborationModeResult.blockedResponse;
  }
  binding = collaborationModeResult?.binding;

  if (input.request.modelId !== undefined) {
    const result = await applyBindingSettingUpdate({
      agentProfileId: input.request.agentProfileId,
      execute: () =>
        input.deps.updateModelSelection({
          agentProfileId: input.request.agentProfileId,
          modelId: input.request.modelId as NonNullable<
            CenterAgentUpdateAgentProfileRuntimeSettingsBody["modelId"]
          >,
          ...(input.request.reasoningLevel === undefined
            ? {}
            : { reasoningLevel: input.request.reasoningLevel }),
        }),
      organizationId: input.organizationId,
      steps,
    });
    if (result.blockedResponse) {
      return result.blockedResponse;
    }
    binding = result.binding;
  }

  if (input.request.agentControllerPermissionMode !== undefined) {
    const result = await applyBindingSettingUpdate({
      agentProfileId: input.request.agentProfileId,
      execute: () =>
        input.deps.updateAgentControllerPermissionMode({
          agentControllerPermissionMode: input.request
            .agentControllerPermissionMode as NonNullable<
            CenterAgentUpdateAgentProfileRuntimeSettingsBody["agentControllerPermissionMode"]
          >,
          agentProfileId: input.request.agentProfileId,
        }),
      organizationId: input.organizationId,
      steps,
    });
    if (result.blockedResponse) {
      return result.blockedResponse;
    }
    binding = result.binding;
  }

  if (input.request.openCodePermission !== undefined) {
    const result = await applyBindingSettingUpdate({
      agentProfileId: input.request.agentProfileId,
      execute: () =>
        input.deps.updateOpenCodePermission({
          agentProfileId: input.request.agentProfileId,
          openCodePermission: input.request.openCodePermission as NonNullable<
            CenterAgentUpdateAgentProfileRuntimeSettingsBody["openCodePermission"]
          >,
        }),
      organizationId: input.organizationId,
      steps,
    });
    if (result.blockedResponse) {
      return result.blockedResponse;
    }
    binding = result.binding;
  }

  const saveLocalFolder = resolveLocalFolderSave(input);
  if (saveLocalFolder) {
    const result = await updateAgentProfileWorkspaceMutation({
      agentProfileId: input.request.agentProfileId,
      saveLocalFolder,
      setAgentProfileDefaultProject: input.deps.setAgentProfileDefaultProject,
      steps,
    });
    if (result.status === "failed") {
      return blockedSettingsResponse({
        agentProfileId: input.request.agentProfileId,
        binding,
        organizationId: input.organizationId,
        steps,
        workspace: result.workspace,
      });
    }
    workspace = result.workspace;
  }

  let readiness: CenterAgentCheckAgentProfileReadinessResponse;
  try {
    readiness = await input.deps.checkAgentProfileReadiness({
      agentProfileId: input.request.agentProfileId,
    });
  } catch (error) {
    steps.push(failedStep("check_agent_profile_readiness", error));
    return blockedSettingsResponse({
      agentProfileId: input.request.agentProfileId,
      binding,
      organizationId: input.organizationId,
      steps,
      workspace,
    });
  }
  steps.push({
    name: "check_agent_profile_readiness",
    status: readiness.canReply ? "completed" : "failed",
    message: readiness.summary,
  });

  return {
    agentProfileId: input.request.agentProfileId,
    ...(binding === undefined ? {} : { binding }),
    canReply: readiness.canReply,
    organizationId: input.organizationId,
    readiness,
    status: readiness.canReply ? "completed" : "blocked",
    steps,
    ...(workspace === undefined
      ? {}
      : { workspace: projectWorkspaceMutation(workspace) }),
  };
}

type LocalFolderSave = {
  savedMessage: string;
  save?: () => Promise<LocalFolderSaveReceipt>;
};

/**
 * A workspace mode or a default folder id saves the local folder first. Both
 * then clear Default Project, so future tasks use the saved folder.
 */
function resolveLocalFolderSave(input: {
  deps: Pick<
    CenterAgentProductOperationDeps,
    "setAgentProfileDefaultFolder" | "setAgentProfileWorkspace"
  >;
  request: CenterAgentUpdateAgentProfileRuntimeSettingsBody;
}): LocalFolderSave | null {
  const request = input.request;
  const { setAgentProfileDefaultFolder, setAgentProfileWorkspace } = input.deps;
  const defaultFolderId = request.defaultFolderId;
  if (defaultFolderId !== undefined) {
    return {
      savedMessage: "Default folder was saved on the local Computer.",
      ...(setAgentProfileDefaultFolder
        ? {
            save: () =>
              setAgentProfileDefaultFolder({
                agentProfileId: request.agentProfileId,
                folderId: defaultFolderId,
              }),
          }
        : {}),
    };
  }
  const workspaceMode = request.workspaceMode;
  if (workspaceMode === undefined) {
    return null;
  }
  return {
    savedMessage: "Working folder was saved on the local Computer.",
    ...(setAgentProfileWorkspace
      ? {
          save: () =>
            setAgentProfileWorkspace({
              agentProfileId: request.agentProfileId,
              workspaceMode,
              ...(request.workspacePath === undefined
                ? {}
                : { workspacePath: request.workspacePath }),
            }),
        }
      : {}),
  };
}

async function updateAgentProfileWorkspaceMutation(input: {
  agentProfileId: string;
  saveLocalFolder: LocalFolderSave;
  setAgentProfileDefaultProject?: CenterAgentProductOperationDeps["setAgentProfileDefaultProject"];
  steps: OperationStep[];
}): Promise<
  | { status: "completed"; workspace: LocalFolderSaveReceipt }
  | { status: "failed"; workspace?: LocalFolderSaveReceipt }
> {
  if (!input.setAgentProfileDefaultProject) {
    input.steps.push({
      name: "update_agent_profile_default_project",
      status: "failed",
      message: "Working folder settings require the Agent's owner.",
      nextAction: "Open Agent settings in the owner's private conversation.",
    });
    return { status: "failed" };
  }
  const save = input.saveLocalFolder.save;
  if (!save) {
    input.steps.push({
      name: "update_agent_profile_workspace",
      nextAction:
        "Connect a local OpenMeld Service that supports Project folder changes.",
      status: "failed",
      message: "Project folder changes are unavailable.",
    });
    return { status: "failed" };
  }
  let workspace: LocalFolderSaveReceipt;
  try {
    workspace = await save();
  } catch (error) {
    input.steps.push(
      failedWorkingFolderStep("update_agent_profile_workspace", error)
    );
    return { status: "failed" };
  }
  input.steps.push({
    name: "update_agent_profile_workspace",
    status: "completed",
    message: input.saveLocalFolder.savedMessage,
  });
  // Second of two ordered writes; a failure here reports partial setup.
  try {
    await input.setAgentProfileDefaultProject({
      agentProfileId: input.agentProfileId,
      defaultProjectId: null,
      ...(workspace.bindingTarget
        ? { expectedBindingTarget: workspace.bindingTarget }
        : {}),
    });
  } catch (error) {
    input.steps.push(
      failedWorkingFolderStep("update_agent_profile_default_project", error)
    );
    return { status: "failed", workspace };
  }
  input.steps.push({
    name: "update_agent_profile_default_project",
    status: "completed",
    message:
      "Default Project was cleared. New tasks use the selected working folder.",
  });
  return { status: "completed", workspace };
}

export function buildCenterAgentReadinessResponse(input: {
  organizationId: string;
  readiness: import("@openmeld/schemas/types").GetAgentExecutionReadinessResponse;
}): CenterAgentCheckAgentProfileReadinessResponse {
  const reasonCodes = input.readiness.agentExecutionReadiness.reasonCodes;
  return {
    agentProfileId: input.readiness.agentProfileId,
    blockers: reasonCodes.map((reasonCode) => ({
      explanation: reasonCode,
      reasonCode,
    })),
    canReply: input.readiness.agentExecutionReadiness.displayState === "ready",
    organizationId: input.organizationId,
    readiness: input.readiness,
    summary: input.readiness.agentWakeAvailability.summary,
  };
}

async function applyAgentControllerCollaborationModeUpdate(
  input: {
    deps: Pick<
      CenterAgentProductOperationDeps,
      "updateAgentControllerCollaborationMode"
    >;
    organizationId: string;
    request: CenterAgentUpdateAgentProfileRuntimeSettingsBody;
  },
  steps: OperationStep[]
) {
  if (input.request.agentControllerCollaborationMode === undefined) {
    return null;
  }
  return await applyBindingSettingUpdate({
    agentProfileId: input.request.agentProfileId,
    execute: () =>
      input.deps.updateAgentControllerCollaborationMode({
        agentControllerCollaborationMode: input.request
          .agentControllerCollaborationMode as NonNullable<
          CenterAgentUpdateAgentProfileRuntimeSettingsBody["agentControllerCollaborationMode"]
        >,
        agentProfileId: input.request.agentProfileId,
      }),
    organizationId: input.organizationId,
    steps,
  });
}

function pickRuntimeSettings(
  input: RuntimeSettingsInput
): RuntimeSettingsInput {
  return {
    ...(input.agentControllerCollaborationMode === undefined
      ? {}
      : {
          agentControllerCollaborationMode:
            input.agentControllerCollaborationMode,
        }),
    ...(input.agentControllerPermissionMode === undefined
      ? {}
      : { agentControllerPermissionMode: input.agentControllerPermissionMode }),
    ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    ...(input.openCodePermission === undefined
      ? {}
      : { openCodePermission: input.openCodePermission }),
    ...(input.reasoningLevel === undefined
      ? {}
      : { reasoningLevel: input.reasoningLevel }),
  };
}

function blockedConnectionResponse(input: {
  agentProfileId: string;
  binding?: EnsureAgentProfilePrimaryBindingResponse;
  candidate?: CenterAgentLocalAgentConnectionCandidate;
  organizationId: string;
  steps: OperationStep[];
}): CenterAgentConnectAgentProfileToLocalAgentResponse {
  return {
    agentProfileId: input.agentProfileId,
    ...(input.binding === undefined ? {} : { binding: input.binding }),
    canReply: false,
    ...(input.candidate === undefined ? {} : { candidate: input.candidate }),
    organizationId: input.organizationId,
    status: "blocked",
    steps: input.steps,
  };
}

async function applyBindingSettingUpdate(input: {
  agentProfileId: string;
  execute(): Promise<EnsureAgentProfilePrimaryBindingResponse>;
  organizationId: string;
  steps: OperationStep[];
}): Promise<{
  binding?: EnsureAgentProfilePrimaryBindingResponse;
  blockedResponse?: CenterAgentUpdateAgentProfileRuntimeSettingsResponse;
}> {
  let binding: EnsureAgentProfilePrimaryBindingResponse;
  try {
    binding = await input.execute();
  } catch (error) {
    input.steps.push(
      failedStep("update_agent_profile_runtime_settings", error)
    );
    return {
      blockedResponse: blockedSettingsResponse({
        agentProfileId: input.agentProfileId,
        organizationId: input.organizationId,
        steps: input.steps,
      }),
    };
  }
  input.steps.push(
    toBindingStep(binding, "update_agent_profile_runtime_settings")
  );
  if (binding.status !== "accepted") {
    return {
      binding,
      blockedResponse: blockedSettingsResponse({
        agentProfileId: input.agentProfileId,
        binding,
        organizationId: input.organizationId,
        steps: input.steps,
      }),
    };
  }
  return { binding };
}

function blockedSettingsResponse(input: {
  agentProfileId: string;
  binding?: EnsureAgentProfilePrimaryBindingResponse;
  organizationId: string;
  steps: OperationStep[];
  workspace?: LocalFolderSaveReceipt;
}): CenterAgentUpdateAgentProfileRuntimeSettingsResponse {
  return {
    agentProfileId: input.agentProfileId,
    ...(input.binding === undefined ? {} : { binding: input.binding }),
    canReply: false,
    organizationId: input.organizationId,
    status: "blocked",
    steps: input.steps,
    ...(input.workspace === undefined
      ? {}
      : { workspace: projectWorkspaceMutation(input.workspace) }),
  };
}

function projectWorkspaceMutation(workspace: LocalFolderSaveReceipt) {
  return {
    agentProfileId: workspace.agentProfileId,
    status: workspace.status,
    ...(workspace.target ? { target: workspace.target } : {}),
    // The existing Service write receipt does not report a configuration
    // version. Keep that uncertainty instead of using a Binding revision.
    configurationVersion: null,
  };
}

function failedWorkingFolderStep(
  name: OperationStep["name"],
  error: unknown
): OperationStep {
  const reasonCode = readSafeRpcFailureReasonCode(error);
  const recovery = resolvePublicAgentFailureRecovery({
    errorCode: reasonCode,
    includeUnknown: false,
  });
  return {
    name,
    status: "failed",
    ...(reasonCode ? { reasonCode } : {}),
    message:
      recovery?.body ??
      (name === "update_agent_profile_default_project"
        ? "The folder was saved, but Default Project could not be cleared. New tasks may still use the Project."
        : "The working folder could not be saved on the target Computer."),
    nextAction: "Review Working folder in Agent settings, then retry setup.",
  };
}
function toBindingStep(
  binding: EnsureAgentProfilePrimaryBindingResponse,
  name: OperationStep["name"]
): OperationStep {
  return binding.status === "accepted"
    ? {
        name,
        status: "completed",
        message: "Agent Profile runtime setting was updated.",
      }
    : {
        name,
        nextAction:
          "Review the returned Binding reason codes, then reconnect this Agent Profile.",
        status: "failed",
        message: `Binding update was rejected: ${binding.reasonCodes.join(", ") || "unknown reason"}.`,
      };
}

function failedStep(
  name: OperationStep["name"],
  error: unknown
): OperationStep {
  return {
    name,
    nextAction: "Review this failed step, then retry the operation.",
    status: "failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

function resolveCandidateFreshness(
  status: CenterAgentLocalAgentConnectionCandidate["status"]
): CenterAgentLocalAgentConnectionCandidate["freshness"] {
  if (status === "stale") {
    return "stale";
  }
  if (status === "unknown") {
    return "unknown";
  }
  return "fresh";
}

function formatAgentControllerRef(agentControllerRef: string): string {
  const [, rawId = agentControllerRef] = agentControllerRef.split(":");
  return rawId
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
