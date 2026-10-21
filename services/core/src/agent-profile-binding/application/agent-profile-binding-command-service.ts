import {
  type AgentProfileBindingOwnerAuthorizationResult,
  type AgentProfileBindingProfileOwnerValidationResult,
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  parseAgentControllerRef,
  type RuntimeAgentControllerReport,
  type RuntimeLookupInput,
  resolveAgentProfileBindingCommandEligibility,
  resolveNativeAgentControllerCollaborationModeForController,
  resolveNativeAgentControllerPermissionModeForController,
} from "@openmeld/agent-runtime";
import {
  agentControllerCollaborationModeSchema,
  agentControllerPermissionModeSchema,
  isHostedAgentControllerRef,
  openCodePermissionConfigSchema,
  resolveBuiltinAgentControllerConversationCapability,
} from "@openmeld/schemas";
import type {
  AgentControllerCollaborationMode,
  AgentControllerPermissionMode,
  AgentProfileBindingWriteMode,
  GatewayErrorCode,
  LocalComponentsReleaseManifest,
  ModelCatalog,
  OpenCodePermissionConfig,
} from "@openmeld/schemas/types";
import { validateAgentModelSelection } from "../../config/agent-model-availability";
import { readAuthoredModelCatalog as readCoreModelCatalog } from "../../config/model-catalog";
import { assertAgentControllerPermissionModeReleased } from "../../local-components/runtime-contract-rollout";
import type { AcceptedRuntimeAgentControllerReport } from "../../runtime-registry/application/runtime-agent-controller-report-service";
import {
  lookupRuntime,
  type RuntimeLookupStore,
} from "../../runtime-registry/application/runtime-lookup-service";

export type AgentProfileBindingOwner = {
  id: string;
  kind: "owner_account";
};

type RejectedOwnerAuthorizationEvidence = Exclude<
  AgentProfileBindingOwnerAuthorizationResult,
  { status: "allowed" }
>;

type RejectedProfileOwnerValidationEvidence = Exclude<
  AgentProfileBindingProfileOwnerValidationResult,
  { status: "valid" }
>;

export type AgentProfileBindingOwnerAuthorizationEvidence =
  | (Extract<
      AgentProfileBindingOwnerAuthorizationResult,
      { status: "allowed" }
    > & {
      owner: AgentProfileBindingOwner;
    })
  | RejectedOwnerAuthorizationEvidence;

export type AgentProfileBindingProfileOwnerValidationEvidence =
  | (Extract<
      AgentProfileBindingProfileOwnerValidationResult,
      { status: "valid" }
    > & {
      owner: AgentProfileBindingOwner;
    })
  | RejectedProfileOwnerValidationEvidence;

export type AgentProfileBindingCommandRecordInput = {
  agentProfileId: string;
  bindingId: string;
  agentControllerConversationId?: string | null;
  agentControllerRef: string;
  createdAtMs: number;
  createdByProfileId?: string | null;
  owner: AgentProfileBindingOwner;
  reasonCode?: string | null;
  openMeldServiceRuntimeId: string;
  agentControllerCollaborationMode?: string | null;
  agentControllerPermissionMode?: string | null;
  modelId?: string | null;
  openCodePermission?: OpenCodePermissionConfig | null;
  reasoningLevel?: string | null;
  updatedAtMs: number;
};

export type AgentProfileBindingCommandRecord = Omit<
  AgentProfileBindingCommandRecordInput,
  "owner"
> & {
  owner: { id: string; kind: "owner_account" | "organization" };
  bindingState: "enabled_primary" | "disabled_historical";
  disabledAtMs: number | null;
};

export type { AgentProfileBindingWriteMode } from "@openmeld/schemas/types";
export type AgentProfileBindingModelSelectionPatch = {
  modelId: string | null;
  reasoningLevel: string | null;
};
export type AgentProfileBindingAgentControllerPermissionModePatch = {
  agentControllerPermissionMode: AgentControllerPermissionMode;
};
export type AgentProfileBindingAgentControllerCollaborationModePatch = {
  agentControllerCollaborationMode: AgentControllerCollaborationMode;
};
export type AgentProfileBindingOpenCodePermissionPatch = {
  openCodePermission: OpenCodePermissionConfig | null;
};

export type AgentProfileBindingModelSelectionValidationErrorCode = Extract<
  GatewayErrorCode,
  `agent_profile_binding.${string}`
>;

export class AgentProfileBindingModelSelectionValidationError extends Error {
  readonly code: AgentProfileBindingModelSelectionValidationErrorCode;

  constructor(input: {
    code: AgentProfileBindingModelSelectionValidationErrorCode;
    message: string;
  }) {
    super(input.message);
    this.name = "AgentProfileBindingModelSelectionValidationError";
    this.code = input.code;
  }
}

// A Binding write would move a Profile that belongs to a MemberAgent to
// another harness (developing/product/agent-profiles.md, MemberAgent Layer).
export const AGENT_PROFILE_BINDING_MEMBER_AGENT_HARNESS_LOCKED =
  "agent_profile_binding.member_agent_harness_locked";

export type AgentProfileBindingWriteResult =
  | {
      binding: AgentProfileBindingCommandRecord;
      outcome: "created" | "reused" | "reconnected";
      status: "accepted";
    }
  | {
      existingBinding?: AgentProfileBindingCommandRecord;
      reason:
        | "controller_conversation_conflict"
        | "member_agent_harness_locked"
        | "primary_conflict"
        | "session_resume_unavailable";
      status: "rejected";
    };

export type AgentProfileBindingSettingsWriteResult =
  | {
      binding: AgentProfileBindingCommandRecord;
      status: "unchanged" | "updated";
    }
  | {
      binding: AgentProfileBindingCommandRecord;
      status: "conflict";
    }
  | {
      binding: null;
      status: "missing";
    };

export type AgentProfileBindingCommandStore = {
  readPrimaryBinding: (input: {
    agentProfileId: string;
    owner: AgentProfileBindingOwner;
  }) => Promise<AgentProfileBindingCommandRecord | null>;
  ensurePrimaryBinding: (input: {
    initializeOnly?: boolean;
    agentControllerCollaborationModePatch?: AgentProfileBindingAgentControllerCollaborationModePatch;
    agentControllerPermissionModePatch?: AgentProfileBindingAgentControllerPermissionModePatch;
    modelSelectionPatch?: AgentProfileBindingModelSelectionPatch;
    openCodePermissionPatch?: AgentProfileBindingOpenCodePermissionPatch;
    record: AgentProfileBindingCommandRecordInput;
  }) => Promise<AgentProfileBindingWriteResult>;
  reconnectPrimaryBinding: (input: {
    agentControllerCollaborationModePatch?: AgentProfileBindingAgentControllerCollaborationModePatch;
    agentControllerPermissionModePatch?: AgentProfileBindingAgentControllerPermissionModePatch;
    modelSelectionPatch?: AgentProfileBindingModelSelectionPatch;
    openCodePermissionPatch?: AgentProfileBindingOpenCodePermissionPatch;
    record: AgentProfileBindingCommandRecordInput;
  }) => Promise<AgentProfileBindingWriteResult>;
  updatePrimaryBindingAgentControllerPermissionMode: (input: {
    agentProfileId: string;
    agentControllerPermissionModePatch: AgentProfileBindingAgentControllerPermissionModePatch;
    owner: AgentProfileBindingOwner;
    updatedAtMs: number;
  }) => Promise<AgentProfileBindingSettingsWriteResult>;
  updatePrimaryBindingAgentControllerCollaborationMode: (input: {
    agentProfileId: string;
    agentControllerCollaborationModePatch: AgentProfileBindingAgentControllerCollaborationModePatch;
    owner: AgentProfileBindingOwner;
    updatedAtMs: number;
  }) => Promise<AgentProfileBindingSettingsWriteResult>;
  updatePrimaryBindingModelSelection: (input: {
    agentProfileId: string;
    modelSelectionPatch: AgentProfileBindingModelSelectionPatch;
    owner: AgentProfileBindingOwner;
    updatedAtMs: number;
  }) => Promise<AgentProfileBindingSettingsWriteResult>;
  updatePrimaryBindingOpenCodePermission: (input: {
    agentProfileId: string;
    openCodePermissionPatch: AgentProfileBindingOpenCodePermissionPatch;
    owner: AgentProfileBindingOwner;
    updatedAtMs: number;
  }) => Promise<AgentProfileBindingSettingsWriteResult>;
};

export type RuntimeAgentControllerReportReadStore = {
  readCurrentReport: (input: {
    agentControllerRef: string;
    openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  }) => Promise<AcceptedRuntimeAgentControllerReport | null>;
};

export type AgentProfileBindingCommandResult =
  | {
      binding: AgentProfileBindingCommandRecord;
      outcome: "created" | "reused" | "reconnected";
      reasonCodes: readonly string[];
      routable: true;
      status: "accepted";
    }
  | {
      existingBinding?: AgentProfileBindingCommandRecord;
      reasonCodes: readonly string[];
      routable: false;
      status: "rejected";
    };

type LocalBindingCommandEvidence =
  | {
      agentControllerConversationId?: string;
      agentControllerRef: string;
      owner: AgentProfileBindingOwner;
      openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
      status: "accepted";
    }
  | {
      result: AgentProfileBindingCommandResult;
      status: "rejected";
    };

type AgentControllerPermissionModePatchResolution =
  | {
      status: "accepted";
      patch: AgentProfileBindingAgentControllerPermissionModePatch;
    }
  | {
      status: "missing";
    }
  | {
      reasonCode: "agent_profile_binding.agent_controller_permission_mode_invalid";
      status: "rejected";
    };

type AgentControllerCollaborationModePatchResolution =
  | {
      status: "accepted";
      patch: AgentProfileBindingAgentControllerCollaborationModePatch;
    }
  | {
      status: "missing";
    }
  | {
      reasonCode: "agent_profile_binding.agent_controller_collaboration_mode_invalid";
      status: "rejected";
    };

type AgentControllerModePatchesResolution =
  | {
      record: Pick<
        AgentProfileBindingCommandRecordInput,
        "agentControllerCollaborationMode" | "agentControllerPermissionMode"
      >;
      status: "accepted";
      writePatches: {
        agentControllerCollaborationModePatch?: AgentProfileBindingAgentControllerCollaborationModePatch;
        agentControllerPermissionModePatch?: AgentProfileBindingAgentControllerPermissionModePatch;
      };
    }
  | {
      reasonCode:
        | "agent_profile_binding.agent_controller_collaboration_mode_invalid"
        | "agent_profile_binding.agent_controller_permission_mode_invalid";
      status: "rejected";
    };

type OpenCodePermissionPatchResolution =
  | {
      status: "accepted";
      patch: AgentProfileBindingOpenCodePermissionPatch;
    }
  | {
      status: "missing";
    }
  | {
      reasonCode: "agent_profile_binding.open_code_permission_invalid";
      status: "rejected";
    };

export async function ensurePrimaryAgentProfileBinding(input: {
  agentProfileId: string;
  // Published release; gates writes the released Service cannot honor.
  localComponentsManifest: LocalComponentsReleaseManifest | null;
  bindingStore: AgentProfileBindingCommandStore;
  agentControllerConversationId?: string | null;
  agentControllerRef: string;
  createBindingId?: () => string;
  createdByProfileId?: string | null;
  agentControllerCollaborationMode?: string | null;
  agentControllerPermissionMode?: string | null;
  modelId?: string | null;
  nowMs: number;
  openCodePermission?: OpenCodePermissionConfig | null;
  ownerAuthorization: AgentProfileBindingOwnerAuthorizationEvidence;
  profileOwnerValidation: AgentProfileBindingProfileOwnerValidationEvidence;
  readModelCatalog?: () => ModelCatalog;
  reasoningLevel?: string | null;
  runtimeAgentControllerReportStore: RuntimeAgentControllerReportReadStore;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  runtimeLookupInput: RuntimeLookupInput;
  runtimeLookupStore: RuntimeLookupStore;
  writeMode?: AgentProfileBindingWriteMode;
}): Promise<AgentProfileBindingCommandResult> {
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT profile-binding
  // This binds a user-confirmed Agent Profile to a concrete Execution Target.
  // Wake should follow this binding instead of selected-profile or route guesses.
  const localEvidence = resolveLocalBindingCommandEvidence(input);
  if (localEvidence.status === "rejected") {
    return localEvidence.result;
  }

  const runtimeLookupRejection = await resolveRuntimeLookupRejection({
    openMeldServiceRuntimeId: localEvidence.openMeldServiceRuntimeId,
    runtimeLookupInput: input.runtimeLookupInput,
    runtimeLookupStore: input.runtimeLookupStore,
  });
  if (runtimeLookupRejection) {
    return runtimeLookupRejection;
  }

  const currentReport = await readMatchingAgentControllerReport({
    agentControllerRef: localEvidence.agentControllerRef,
    runtimeAgentControllerReportStore: input.runtimeAgentControllerReportStore,
    openMeldServiceRuntimeId: localEvidence.openMeldServiceRuntimeId,
  });
  if (currentReport.status === "rejected") {
    return currentReport.result;
  }

  const currentBinding = await input.bindingStore.readPrimaryBinding({
    agentProfileId: input.agentProfileId,
    owner: localEvidence.owner,
  });
  if (isHostedAgentControllerRef(currentBinding?.agentControllerRef)) {
    return rejectWith(["agent_profile_binding.primary_conflict"]);
  }
  const agentControllerConversationId =
    resolveCommandAgentControllerConversationId({
      agentControllerRef: localEvidence.agentControllerRef,
      currentBinding,
      requestedAgentControllerConversationId:
        localEvidence.agentControllerConversationId,
    });
  if (
    resolveBuiltinAgentControllerConversationCapability(
      parseAgentControllerRef(localEvidence.agentControllerRef)?.id ?? ""
    )?.conversationScope === "account_shared" &&
    !agentControllerConversationId
  ) {
    // Reconnect can reuse the existing confirmed conversation, but cannot
    // initialize a shared Bot or switch controllers without a connection.
    return rejectWith(["agent_profile_binding.session_resume_unavailable"]);
  }
  const eligibility = resolveAgentProfileBindingCommandEligibility({
    agentProfileId: input.agentProfileId,
    now: new Date(input.nowMs),
    ownerAuthorization: input.ownerAuthorization,
    profileOwnerValidation: input.profileOwnerValidation,
    executionTarget: {
      agentControllerConversationId,
      agentControllerRef: localEvidence.agentControllerRef,
      openMeldServiceRuntimeId: localEvidence.openMeldServiceRuntimeId,
      runtimeLookupInput: input.runtimeLookupInput,
    },
    runtimeAgentControllerReport: currentReport.report
      ? mapAgentControllerReportToContract(currentReport.report)
      : undefined,
    runtimeOwnerMatches: true,
  });
  if (!(eligibility.bindable && eligibility.routable)) {
    return rejectWith(eligibility.reasonCodes);
  }

  const requestedSettings = resolveBindingWriteSettings(
    input,
    currentBinding,
    localEvidence.agentControllerRef
  );
  const modelSelectionPatch = resolveModelSelectionPatch({
    agentControllerRef: localEvidence.agentControllerRef,
    currentReport: currentReport.report,
    nowMs: input.nowMs,
    openMeldServiceRuntimeId: localEvidence.openMeldServiceRuntimeId.value,
    modelId: requestedSettings.modelId,
    readModelCatalog: input.readModelCatalog,
    reasoningLevel: requestedSettings.reasoningLevel,
  });
  const agentControllerModePatches = resolveAgentControllerModePatches({
    localComponentsManifest: input.localComponentsManifest,
    agentControllerCollaborationMode:
      requestedSettings.agentControllerCollaborationMode,
    agentControllerRef: localEvidence.agentControllerRef,
    agentControllerPermissionMode:
      requestedSettings.agentControllerPermissionMode,
  });
  if (agentControllerModePatches.status === "rejected") {
    return rejectWith([agentControllerModePatches.reasonCode]);
  }
  const openCodePermissionPatch = resolveOpenCodePermissionPatch({
    agentControllerRef: localEvidence.agentControllerRef,
    openCodePermission: requestedSettings.openCodePermission,
  });
  if (openCodePermissionPatch.status === "rejected") {
    return rejectWith([openCodePermissionPatch.reasonCode]);
  }
  const currentControllerSettings =
    currentBinding?.agentControllerRef === localEvidence.agentControllerRef
      ? currentBinding
      : null;
  const agentControllerSettings = resolveBindingControllerSettings({
    agentControllerModePatches,
    currentControllerSettings,
    modelSelectionPatch,
    openCodePermissionPatch,
  });
  const record = {
    agentProfileId: input.agentProfileId,
    agentControllerConversationId,
    bindingId: (input.createBindingId ?? createOpaqueBindingId)(),
    agentControllerRef: localEvidence.agentControllerRef,
    createdAtMs: input.nowMs,
    createdByProfileId: input.createdByProfileId ?? null,
    owner: localEvidence.owner,
    reasonCode: eligibility.reasonCodes[0] ?? null,
    openMeldServiceRuntimeId: localEvidence.openMeldServiceRuntimeId.value,
    ...agentControllerSettings,
    updatedAtMs: input.nowMs,
  };
  const writeResult = await (input.writeMode === "reconnect"
    ? input.bindingStore.reconnectPrimaryBinding
    : input.bindingStore.ensurePrimaryBinding)({
    ...(input.writeMode === "initialize" ? { initializeOnly: true } : {}),
    ...agentControllerModePatches.writePatches,
    ...(modelSelectionPatch ? { modelSelectionPatch } : {}),
    ...(openCodePermissionPatch.status === "accepted"
      ? { openCodePermissionPatch: openCodePermissionPatch.patch }
      : {}),
    record,
  });

  return resolveWriteResult({
    reasonCodes: eligibility.reasonCodes,
    writeResult,
  });
}

function resolveBindingWriteSettings(
  requested: Pick<
    AgentProfileBindingCommandRecordInput,
    | "modelId"
    | "reasoningLevel"
    | "agentControllerCollaborationMode"
    | "agentControllerPermissionMode"
    | "openCodePermission"
  > & { writeMode?: AgentProfileBindingWriteMode },
  currentBinding: AgentProfileBindingCommandRecord | null,
  agentControllerRef: string
) {
  if (
    requested.writeMode !== "initialize" ||
    currentBinding?.agentControllerRef !== agentControllerRef
  ) {
    return requested;
  }
  return {
    modelId: currentBinding.modelId,
    reasoningLevel: currentBinding.reasoningLevel,
    agentControllerCollaborationMode:
      currentBinding.agentControllerCollaborationMode ?? undefined,
    agentControllerPermissionMode:
      currentBinding.agentControllerPermissionMode ?? undefined,
    openCodePermission: currentBinding.openCodePermission ?? undefined,
  };
}

function resolveBindingControllerSettings(input: {
  agentControllerModePatches: Extract<
    AgentControllerModePatchesResolution,
    { status: "accepted" }
  >;
  currentControllerSettings: AgentProfileBindingCommandRecord | null;
  modelSelectionPatch: AgentProfileBindingModelSelectionPatch | null;
  openCodePermissionPatch: Extract<
    OpenCodePermissionPatchResolution,
    { status: "accepted" | "missing" }
  >;
}): Pick<
  AgentProfileBindingCommandRecordInput,
  | "agentControllerCollaborationMode"
  | "agentControllerPermissionMode"
  | "modelId"
  | "openCodePermission"
  | "reasoningLevel"
> {
  const current = input.currentControllerSettings;
  return {
    agentControllerCollaborationMode: input.agentControllerModePatches
      .writePatches.agentControllerCollaborationModePatch
      ? input.agentControllerModePatches.record.agentControllerCollaborationMode
      : (current?.agentControllerCollaborationMode ?? null),
    agentControllerPermissionMode: input.agentControllerModePatches.writePatches
      .agentControllerPermissionModePatch
      ? input.agentControllerModePatches.record.agentControllerPermissionMode
      : (current?.agentControllerPermissionMode ?? null),
    modelId: input.modelSelectionPatch
      ? input.modelSelectionPatch.modelId
      : (current?.modelId ?? null),
    openCodePermission:
      input.openCodePermissionPatch.status === "accepted"
        ? input.openCodePermissionPatch.patch.openCodePermission
        : (current?.openCodePermission ?? null),
    reasoningLevel: input.modelSelectionPatch
      ? input.modelSelectionPatch.reasoningLevel
      : (current?.reasoningLevel ?? null),
  };
}

export async function updatePrimaryAgentProfileBindingAgentControllerPermissionMode(input: {
  agentProfileId: string;
  localComponentsManifest: LocalComponentsReleaseManifest | null;
  agentControllerPermissionMode: string;
  bindingStore: AgentProfileBindingCommandStore;
  nowMs: number;
  ownerAuthorization: AgentProfileBindingOwnerAuthorizationEvidence;
  profileOwnerValidation: AgentProfileBindingProfileOwnerValidationEvidence;
}): Promise<AgentProfileBindingCommandResult> {
  if (input.ownerAuthorization.status !== "allowed") {
    return rejectWith([input.ownerAuthorization.reasonCode]);
  }
  if (input.profileOwnerValidation.status !== "valid") {
    return rejectWith([input.profileOwnerValidation.reasonCode]);
  }
  if (
    !ownersEqual(
      input.ownerAuthorization.owner,
      input.profileOwnerValidation.owner
    )
  ) {
    return rejectWith(["agent_profile_binding.owner_mismatch"]);
  }

  const currentBinding = await input.bindingStore.readPrimaryBinding({
    agentProfileId: input.agentProfileId,
    owner: input.profileOwnerValidation.owner,
  });
  if (!currentBinding) {
    return rejectWith(["agent_profile_binding.primary_missing"]);
  }

  const agentControllerPermissionModePatch =
    resolveAgentControllerPermissionModePatch({
      localComponentsManifest: input.localComponentsManifest,
      agentControllerPermissionMode: input.agentControllerPermissionMode,
      agentControllerRef: currentBinding.agentControllerRef,
    });
  if (agentControllerPermissionModePatch.status !== "accepted") {
    return rejectWith([
      agentControllerPermissionModePatch.status === "rejected"
        ? agentControllerPermissionModePatch.reasonCode
        : "agent_profile_binding.agent_controller_permission_mode_invalid",
    ]);
  }

  const writeResult =
    await input.bindingStore.updatePrimaryBindingAgentControllerPermissionMode({
      agentProfileId: input.agentProfileId,
      agentControllerPermissionModePatch:
        agentControllerPermissionModePatch.patch,
      owner: input.profileOwnerValidation.owner,
      updatedAtMs: input.nowMs,
    });
  return resolveSettingsWriteCommandResult(writeResult);
}

export async function updatePrimaryAgentProfileBindingAgentControllerCollaborationMode(input: {
  agentProfileId: string;
  agentControllerCollaborationMode: string;
  bindingStore: AgentProfileBindingCommandStore;
  nowMs: number;
  ownerAuthorization: AgentProfileBindingOwnerAuthorizationEvidence;
  profileOwnerValidation: AgentProfileBindingProfileOwnerValidationEvidence;
}): Promise<AgentProfileBindingCommandResult> {
  if (input.ownerAuthorization.status !== "allowed") {
    return rejectWith([input.ownerAuthorization.reasonCode]);
  }
  if (input.profileOwnerValidation.status !== "valid") {
    return rejectWith([input.profileOwnerValidation.reasonCode]);
  }
  if (
    !ownersEqual(
      input.ownerAuthorization.owner,
      input.profileOwnerValidation.owner
    )
  ) {
    return rejectWith(["agent_profile_binding.owner_mismatch"]);
  }

  const currentBinding = await input.bindingStore.readPrimaryBinding({
    agentProfileId: input.agentProfileId,
    owner: input.profileOwnerValidation.owner,
  });
  if (!currentBinding) {
    return rejectWith(["agent_profile_binding.primary_missing"]);
  }

  const agentControllerCollaborationModePatch =
    resolveAgentControllerCollaborationModePatch({
      agentControllerCollaborationMode: input.agentControllerCollaborationMode,
      agentControllerRef: currentBinding.agentControllerRef,
    });
  if (agentControllerCollaborationModePatch.status !== "accepted") {
    return rejectWith([
      agentControllerCollaborationModePatch.status === "rejected"
        ? agentControllerCollaborationModePatch.reasonCode
        : "agent_profile_binding.agent_controller_collaboration_mode_invalid",
    ]);
  }

  const writeResult =
    await input.bindingStore.updatePrimaryBindingAgentControllerCollaborationMode(
      {
        agentProfileId: input.agentProfileId,
        agentControllerCollaborationModePatch:
          agentControllerCollaborationModePatch.patch,
        owner: input.profileOwnerValidation.owner,
        updatedAtMs: input.nowMs,
      }
    );
  return resolveSettingsWriteCommandResult(writeResult);
}

export async function updatePrimaryAgentProfileBindingModelSelection(input: {
  runtimeAgentControllerReportStore?: RuntimeAgentControllerReportReadStore;
  agentProfileId: string;
  bindingStore: AgentProfileBindingCommandStore;
  modelId: string;
  nowMs: number;
  ownerAuthorization: AgentProfileBindingOwnerAuthorizationEvidence;
  profileOwnerValidation: AgentProfileBindingProfileOwnerValidationEvidence;
  readModelCatalog?: () => ModelCatalog;
  reasoningLevel?: string | null;
}): Promise<AgentProfileBindingCommandResult> {
  if (input.ownerAuthorization.status !== "allowed") {
    return rejectWith([input.ownerAuthorization.reasonCode]);
  }
  if (input.profileOwnerValidation.status !== "valid") {
    return rejectWith([input.profileOwnerValidation.reasonCode]);
  }
  if (
    !ownersEqual(
      input.ownerAuthorization.owner,
      input.profileOwnerValidation.owner
    )
  ) {
    return rejectWith(["agent_profile_binding.owner_mismatch"]);
  }

  const currentBinding = await input.bindingStore.readPrimaryBinding({
    agentProfileId: input.agentProfileId,
    owner: input.profileOwnerValidation.owner,
  });
  if (!currentBinding) {
    return rejectWith(["agent_profile_binding.primary_missing"]);
  }

  let currentReport: AcceptedRuntimeAgentControllerReport | null = null;
  if (
    input.runtimeAgentControllerReportStore &&
    !isHostedAgentControllerRef(currentBinding.agentControllerRef)
  ) {
    const evidence = await readMatchingAgentControllerReport({
      agentControllerRef: currentBinding.agentControllerRef,
      openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
        openMeldServiceRuntimeId: currentBinding.openMeldServiceRuntimeId,
        source: "runtime_registry_authority",
      }),
      runtimeAgentControllerReportStore:
        input.runtimeAgentControllerReportStore,
    });
    if (evidence.status === "rejected") {
      return evidence.result;
    }
    currentReport = evidence.report;
  }

  const modelSelectionPatch = resolveModelSelectionPatch({
    agentControllerRef: currentBinding.agentControllerRef,
    currentReport,
    nowMs: input.nowMs,
    openMeldServiceRuntimeId: currentBinding.openMeldServiceRuntimeId,
    modelId: input.modelId,
    readModelCatalog: input.readModelCatalog,
    reasoningLevel: input.reasoningLevel,
  });
  if (!modelSelectionPatch?.modelId) {
    return rejectWith(["agent_profile_binding.model_selection_invalid"]);
  }

  const writeResult =
    await input.bindingStore.updatePrimaryBindingModelSelection({
      agentProfileId: input.agentProfileId,
      modelSelectionPatch,
      owner: input.profileOwnerValidation.owner,
      updatedAtMs: input.nowMs,
    });
  return resolveSettingsWriteCommandResult(writeResult);
}

export async function updatePrimaryAgentProfileBindingOpenCodePermission(input: {
  agentProfileId: string;
  bindingStore: AgentProfileBindingCommandStore;
  nowMs: number;
  openCodePermission: OpenCodePermissionConfig | null;
  ownerAuthorization: AgentProfileBindingOwnerAuthorizationEvidence;
  profileOwnerValidation: AgentProfileBindingProfileOwnerValidationEvidence;
}): Promise<AgentProfileBindingCommandResult> {
  if (input.ownerAuthorization.status !== "allowed") {
    return rejectWith([input.ownerAuthorization.reasonCode]);
  }
  if (input.profileOwnerValidation.status !== "valid") {
    return rejectWith([input.profileOwnerValidation.reasonCode]);
  }
  if (
    !ownersEqual(
      input.ownerAuthorization.owner,
      input.profileOwnerValidation.owner
    )
  ) {
    return rejectWith(["agent_profile_binding.owner_mismatch"]);
  }

  const currentBinding = await input.bindingStore.readPrimaryBinding({
    agentProfileId: input.agentProfileId,
    owner: input.profileOwnerValidation.owner,
  });
  if (!currentBinding) {
    return rejectWith(["agent_profile_binding.primary_missing"]);
  }

  const openCodePermissionPatch = resolveOpenCodePermissionPatch({
    agentControllerRef: currentBinding.agentControllerRef,
    openCodePermission: input.openCodePermission,
  });
  if (openCodePermissionPatch.status !== "accepted") {
    return rejectWith([
      openCodePermissionPatch.status === "rejected"
        ? openCodePermissionPatch.reasonCode
        : "agent_profile_binding.open_code_permission_invalid",
    ]);
  }

  const writeResult =
    await input.bindingStore.updatePrimaryBindingOpenCodePermission({
      agentProfileId: input.agentProfileId,
      openCodePermissionPatch: openCodePermissionPatch.patch,
      owner: input.profileOwnerValidation.owner,
      updatedAtMs: input.nowMs,
    });
  return resolveSettingsWriteCommandResult(writeResult);
}

function resolveSettingsWriteCommandResult(
  result: AgentProfileBindingSettingsWriteResult
): AgentProfileBindingCommandResult {
  if (result.status === "missing") {
    return rejectWith(["agent_profile_binding.primary_missing"]);
  }
  if (result.status === "conflict") {
    return rejectWith(["agent_profile_binding.settings_conflict"]);
  }
  return {
    binding: result.binding,
    outcome: "reused",
    reasonCodes: ["agent_profile_binding.command_eligible"],
    routable: true,
    status: "accepted",
  };
}

function resolveModelSelectionPatch(input: {
  agentControllerRef: string;
  currentReport?: AcceptedRuntimeAgentControllerReport | null;
  nowMs: number;
  openMeldServiceRuntimeId?: string | null;
  modelId?: string | null;
  readModelCatalog?: () => ModelCatalog;
  reasoningLevel?: string | null;
}): AgentProfileBindingModelSelectionPatch | null {
  if (input.modelId === undefined && input.reasoningLevel === undefined) {
    return null;
  }
  const modelId = normalizeOptionalText(input.modelId) ?? null;
  const reasoningLevel = modelId
    ? (normalizeOptionalText(input.reasoningLevel) ?? null)
    : null;
  if (modelId) {
    const issue = validateAgentModelSelection({
      ...input,
      modelId,
      reasoningLevel,
      catalog: (input.readModelCatalog ?? readCoreModelCatalog)(),
    });
    if (issue) {
      throw new AgentProfileBindingModelSelectionValidationError({
        code: issue.code,
        message: issue.reason,
      });
    }
  }
  return {
    modelId,
    reasoningLevel,
  };
}

function resolveAgentControllerModePatches(input: {
  localComponentsManifest: LocalComponentsReleaseManifest | null;
  agentControllerCollaborationMode?: string | null;
  agentControllerPermissionMode?: string | null;
  agentControllerRef: string;
}): AgentControllerModePatchesResolution {
  const collaborationMode = resolveAgentControllerCollaborationModePatch(input);
  if (collaborationMode.status === "rejected") {
    return collaborationMode;
  }
  const permissionMode = resolveAgentControllerPermissionModePatch(input);
  if (permissionMode.status === "rejected") {
    return permissionMode;
  }
  return {
    record: {
      agentControllerCollaborationMode:
        collaborationMode.status === "accepted"
          ? collaborationMode.patch.agentControllerCollaborationMode
          : null,
      agentControllerPermissionMode:
        permissionMode.status === "accepted"
          ? permissionMode.patch.agentControllerPermissionMode
          : null,
    },
    status: "accepted",
    writePatches: {
      ...(collaborationMode.status === "accepted"
        ? { agentControllerCollaborationModePatch: collaborationMode.patch }
        : {}),
      ...(permissionMode.status === "accepted"
        ? { agentControllerPermissionModePatch: permissionMode.patch }
        : {}),
    },
  };
}

function resolveAgentControllerCollaborationModePatch(input: {
  agentControllerCollaborationMode?: string | null;
  agentControllerRef: string;
}): AgentControllerCollaborationModePatchResolution {
  if (input.agentControllerCollaborationMode === undefined) {
    return { status: "missing" };
  }
  const parsed = agentControllerCollaborationModeSchema.safeParse(
    input.agentControllerCollaborationMode
  );
  if (!parsed.success) {
    return {
      reasonCode:
        "agent_profile_binding.agent_controller_collaboration_mode_invalid",
      status: "rejected",
    };
  }
  const nativeCollaborationMode =
    resolveNativeAgentControllerCollaborationModeForController(parsed.data, {
      agentControllerRef: input.agentControllerRef,
    });
  if (nativeCollaborationMode !== parsed.data) {
    return {
      reasonCode:
        "agent_profile_binding.agent_controller_collaboration_mode_invalid",
      status: "rejected",
    };
  }
  return {
    patch: {
      agentControllerCollaborationMode: parsed.data,
    },
    status: "accepted",
  };
}

function resolveAgentControllerPermissionModePatch(input: {
  localComponentsManifest: LocalComponentsReleaseManifest | null;
  agentControllerPermissionMode?: string | null;
  agentControllerRef: string;
}): AgentControllerPermissionModePatchResolution {
  if (input.agentControllerPermissionMode === undefined) {
    return { status: "missing" };
  }
  const parsed = agentControllerPermissionModeSchema.safeParse(
    input.agentControllerPermissionMode
  );
  if (!parsed.success) {
    return {
      reasonCode:
        "agent_profile_binding.agent_controller_permission_mode_invalid",
      status: "rejected",
    };
  }
  const nativePermissionMode =
    resolveNativeAgentControllerPermissionModeForController(parsed.data, {
      agentControllerRef: input.agentControllerRef,
    });
  if (nativePermissionMode !== parsed.data) {
    return {
      reasonCode:
        "agent_profile_binding.agent_controller_permission_mode_invalid",
      status: "rejected",
    };
  }
  assertAgentControllerPermissionModeReleased(
    parsed.data,
    input.localComponentsManifest
  );
  return {
    patch: {
      agentControllerPermissionMode: parsed.data,
    },
    status: "accepted",
  };
}

function resolveOpenCodePermissionPatch(input: {
  agentControllerRef: string;
  openCodePermission?: OpenCodePermissionConfig | null;
}): OpenCodePermissionPatchResolution {
  if (input.openCodePermission === undefined) {
    return { status: "missing" };
  }
  if (!isOpenCodeAgentControllerRef(input.agentControllerRef)) {
    return {
      reasonCode: "agent_profile_binding.open_code_permission_invalid",
      status: "rejected",
    };
  }
  if (input.openCodePermission === null) {
    return {
      patch: { openCodePermission: null },
      status: "accepted",
    };
  }
  const parsed = openCodePermissionConfigSchema.safeParse(
    input.openCodePermission
  );
  if (!parsed.success) {
    return {
      reasonCode: "agent_profile_binding.open_code_permission_invalid",
      status: "rejected",
    };
  }
  return {
    patch: { openCodePermission: parsed.data },
    status: "accepted",
  };
}

function resolveLocalBindingCommandEvidence(input: {
  agentProfileId: string;
  agentControllerConversationId?: string | null;
  agentControllerRef: string;
  ownerAuthorization: AgentProfileBindingOwnerAuthorizationEvidence;
  profileOwnerValidation: AgentProfileBindingProfileOwnerValidationEvidence;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  runtimeLookupInput: RuntimeLookupInput;
}): LocalBindingCommandEvidence {
  if (input.ownerAuthorization.status !== "allowed") {
    return rejectEvidence([input.ownerAuthorization.reasonCode]);
  }
  if (input.profileOwnerValidation.status !== "valid") {
    return rejectEvidence([input.profileOwnerValidation.reasonCode]);
  }
  const agentControllerRef = parseAgentControllerRef(input.agentControllerRef);
  if (!agentControllerRef) {
    return rejectEvidence([
      "agent_profile_binding.agent_controller_report_invalid",
    ]);
  }

  const authorityRuntimeId = resolveAuthorityOpenMeldServiceRuntimeId({
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    runtimeLookupInput: input.runtimeLookupInput,
  });
  if (!authorityRuntimeId) {
    return rejectEvidence([
      "agent_profile_binding.agent_controller_report_invalid",
    ]);
  }
  if (
    !ownersEqual(
      input.ownerAuthorization.owner,
      input.profileOwnerValidation.owner
    )
  ) {
    return rejectEvidence(["agent_profile_binding.owner_mismatch"]);
  }
  if (
    !ownersEqual(
      input.profileOwnerValidation.owner,
      input.runtimeLookupInput.owner
    )
  ) {
    return rejectEvidence(["agent_profile_binding.runtime_owner_mismatch"]);
  }

  return {
    ...(normalizeOptionalText(input.agentControllerConversationId)
      ? {
          agentControllerConversationId: normalizeOptionalText(
            input.agentControllerConversationId
          ),
        }
      : {}),
    agentControllerRef: agentControllerRef.ref,
    owner: input.profileOwnerValidation.owner,
    openMeldServiceRuntimeId: authorityRuntimeId,
    status: "accepted",
  };
}

function resolveCommandAgentControllerConversationId(input: {
  agentControllerRef: string;
  currentBinding: AgentProfileBindingCommandRecord | null;
  requestedAgentControllerConversationId?: string | null;
}): string | undefined {
  const requested = normalizeOptionalText(
    input.requestedAgentControllerConversationId
  );
  if (requested) {
    return requested;
  }

  if (input.currentBinding?.agentControllerRef !== input.agentControllerRef) {
    return undefined;
  }
  return normalizeOptionalText(
    input.currentBinding.agentControllerConversationId
  );
}

function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isOpenCodeAgentControllerRef(agentControllerRef: string): boolean {
  const parsed = parseAgentControllerRef(agentControllerRef);
  return parsed?.kind === "builtin" && parsed.id === "opencode";
}

function ownersEqual(
  left: AgentProfileBindingOwner,
  right: RuntimeLookupInput["owner"]
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

async function resolveRuntimeLookupRejection(input: {
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  runtimeLookupInput: RuntimeLookupInput;
  runtimeLookupStore: RuntimeLookupStore;
}): Promise<AgentProfileBindingCommandResult | null> {
  const runtimeLookupResult = await lookupRuntime({
    runtimeLookupInput: input.runtimeLookupInput,
    store: input.runtimeLookupStore,
  });
  if (runtimeLookupResult.status === "invalid_identity") {
    return rejectWith([
      "agent_profile_binding.openmeld_service_runtime_identity_invalid",
    ]);
  }
  if (runtimeLookupResult.status === "missing") {
    return rejectWith(["agent_profile_binding.runtime_missing"]);
  }
  if (runtimeLookupResult.status === "conflict") {
    return rejectWith(["agent_profile_binding.runtime_lookup_conflict"]);
  }
  if (
    runtimeLookupResult.openMeldServiceRuntimeId.value !==
    input.openMeldServiceRuntimeId.value
  ) {
    return rejectWith([
      "agent_profile_binding.openmeld_service_runtime_id_mismatch",
    ]);
  }

  return null;
}

async function readMatchingAgentControllerReport(input: {
  agentControllerRef: string;
  runtimeAgentControllerReportStore: RuntimeAgentControllerReportReadStore;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
}): Promise<
  | {
      report: AcceptedRuntimeAgentControllerReport | null;
      status: "accepted";
    }
  | {
      result: AgentProfileBindingCommandResult;
      status: "rejected";
    }
> {
  const currentReport =
    await input.runtimeAgentControllerReportStore.readCurrentReport({
      agentControllerRef: input.agentControllerRef,
      openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    });
  if (
    currentReport &&
    (currentReport.openMeldServiceRuntimeId.value !==
      input.openMeldServiceRuntimeId.value ||
      currentReport.agentControllerRef !== input.agentControllerRef)
  ) {
    return rejectEvidence([
      "agent_profile_binding.agent_controller_report_missing",
    ]);
  }

  return {
    status: "accepted",
    report: currentReport,
  };
}

function resolveWriteResult(input: {
  reasonCodes: readonly string[];
  writeResult: AgentProfileBindingWriteResult;
}): AgentProfileBindingCommandResult {
  if (input.writeResult.status === "rejected") {
    const reasonCode = (() => {
      switch (input.writeResult.reason) {
        case "controller_conversation_conflict":
          return "agent_profile_binding.controller_conversation_conflict";
        case "session_resume_unavailable":
          return "agent_profile_binding.session_resume_unavailable";
        case "member_agent_harness_locked":
          return AGENT_PROFILE_BINDING_MEMBER_AGENT_HARNESS_LOCKED;
        default:
          return "agent_profile_binding.primary_conflict";
      }
    })();
    return {
      ...(input.writeResult.existingBinding
        ? { existingBinding: input.writeResult.existingBinding }
        : {}),
      reasonCodes: [reasonCode],
      routable: false,
      status: "rejected",
    };
  }

  return {
    binding: input.writeResult.binding,
    outcome: input.writeResult.outcome,
    reasonCodes: input.reasonCodes,
    routable: true,
    status: "accepted",
  };
}

function resolveAuthorityOpenMeldServiceRuntimeId(input: {
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  runtimeLookupInput: RuntimeLookupInput;
}): AuthorityOpenMeldServiceRuntimeId | null {
  try {
    return createAuthorityOpenMeldServiceRuntimeId({
      lookupInput: input.runtimeLookupInput,
      openMeldServiceRuntimeId: input.openMeldServiceRuntimeId.value,
      source: input.openMeldServiceRuntimeId.source,
    });
  } catch {
    return null;
  }
}

function mapAgentControllerReportToContract(
  report: AcceptedRuntimeAgentControllerReport
): RuntimeAgentControllerReport {
  return {
    agentControllerRef: report.agentControllerRef,
    expiresAt: new Date(report.expiresAtMs).toISOString(),
    observedAt: new Date(report.observedAtMs).toISOString(),
    reasonCodes: report.reasonCodes,
    status: report.status,
  };
}

function rejectWith(
  reasonCodes: readonly string[]
): AgentProfileBindingCommandResult {
  return {
    reasonCodes,
    routable: false,
    status: "rejected",
  };
}

function rejectEvidence(reasonCodes: readonly string[]): {
  result: AgentProfileBindingCommandResult;
  status: "rejected";
} {
  return {
    result: rejectWith(reasonCodes),
    status: "rejected",
  };
}

function createOpaqueBindingId(): string {
  return `binding_${crypto.randomUUID()}`;
}
