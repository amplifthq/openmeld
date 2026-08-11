import { isCancel, select } from "@clack/prompts";
import {
  buildAgentControllerRef,
  resolveSelectableCandidates,
} from "@openmeld/agent-runtime";
import { resolveLocalRegistryAgentIdFromAgentControllerRef } from "../agents/controller-identity";
import {
  type AgentTargetState,
  listAgentTargetStates,
  updateAgentRegistrations,
} from "../agents/registry";
import {
  createDefaultRuntimeAgentControllerSettings,
  type RuntimeAgentTransportMode,
} from "../config/runtime-config";
import { promptSearchSelect, type SearchSelectItem } from "../ui/search-select";

const AGENT_PROFILE_SETUP_SKIP = "__agent_profile_setup_skip__";
const AGENT_PROFILE_SETUP_BACK = "__agent_profile_setup_back__";
const AGENT_PROFILE_RESPONSE_POLICY_MENTION_ONLY = "mention_only";

type EnabledBuiltinControllerCandidate = AgentTargetState & {
  targetKind: "builtin";
};

type EnabledBuiltinControllerCandidatesResolution = {
  candidates: EnabledBuiltinControllerCandidate[];
  error?: string;
};

export type AgentProfileSetupResult =
  | {
      status: "configured";
      agentControllerRef: string;
      controllerDisplayName: string;
      transportMode: RuntimeAgentTransportMode;
      responsePolicy: "mention_only";
      selectionMode: "interactive" | "auto_first_available";
    }
  | {
      status: "skipped_no_enabled_controllers";
      reason?: string;
    }
  | {
      status: "skipped_by_user";
    }
  | {
      status: "back";
    }
  | {
      status: "cancelled";
    };

type AgentControllerSelectionResult =
  | {
      status: "selected";
      candidate: EnabledBuiltinControllerCandidate;
      selectionMode: "interactive" | "auto_first_available";
    }
  | {
      status: "skipped";
    }
  | {
      status: "back";
    }
  | {
      status: "cancelled";
    };

type AgentTransportModeSelectionResult =
  | {
      status: "submitted";
      transportMode: RuntimeAgentTransportMode;
      prompted: boolean;
    }
  | {
      status: "back";
    }
  | {
      status: "cancelled";
    };

type AgentResponsePolicySelectionResult =
  | {
      status: "submitted";
      responsePolicy: "mention_only";
    }
  | {
      status: "back";
    }
  | {
      status: "cancelled";
    };

export async function resolveAgentProfileSetup(input: {
  interactive: boolean;
  useAutoSelectionWhenNonInteractive: boolean;
  selectControllerMessage?: string;
  selectTransportModeMessage?: string;
  selectResponsePolicyMessage?: string;
  skipControllerOptionLabel?: string;
  allowBackToCaller?: boolean;
}): Promise<AgentProfileSetupResult> {
  const enabledCandidates = await resolveEnabledBuiltinCandidatesForSetup();

  if (enabledCandidates.candidates.length === 0) {
    return {
      status: "skipped_no_enabled_controllers",
      ...(enabledCandidates.error ? { reason: enabledCandidates.error } : {}),
    };
  }

  while (true) {
    const selectedController = await resolveAgentControllerSelection({
      interactive: input.interactive,
      useAutoSelectionWhenNonInteractive:
        input.useAutoSelectionWhenNonInteractive,
      candidates: enabledCandidates.candidates,
      message:
        input.selectControllerMessage ??
        "Choose which agent controller this profile should use.",
      skipOptionLabel: input.skipControllerOptionLabel ?? "Skip for now",
      allowBack: input.allowBackToCaller === true,
    });
    if (selectedController.status === "cancelled") {
      return {
        status: "cancelled",
      };
    }
    if (selectedController.status === "back") {
      return {
        status: "back",
      };
    }
    if (selectedController.status === "skipped") {
      return {
        status: "skipped_by_user",
      };
    }

    const configuredController = await resolveConfiguredAgentController({
      interactive: input.interactive,
      selectedController,
      selectTransportModeMessage:
        input.selectTransportModeMessage ??
        "How should this profile connect to its agent controller?",
      selectResponsePolicyMessage:
        input.selectResponsePolicyMessage ??
        "When should this profile auto-reply?",
      allowResponsePolicyBack: input.allowBackToCaller === true,
    });
    if (configuredController.status === "retry_controller") {
      continue;
    }
    return configuredController.result;
  }
}

export async function persistAgentTransportSelection(input: {
  agentControllerRef: string;
  transportMode: RuntimeAgentTransportMode;
}): Promise<void> {
  const localAgentId =
    resolveLocalRegistryAgentIdFromAgentControllerRef({
      agentControllerRef: input.agentControllerRef,
    }) ?? input.agentControllerRef;
  await updateAgentRegistrations((current) => {
    const index = current.findIndex(
      (controller) => controller.agentId === localAgentId
    );
    if (index < 0) {
      return current;
    }
    const controller = current[index];
    if (!controller || controller.transportMode === input.transportMode) {
      return current;
    }
    const next = [...current];
    next[index] = {
      ...controller,
      transportMode: input.transportMode,
      updatedAt: new Date().toISOString(),
    };
    return next;
  });
}

export function resolveEnabledBuiltinControllerCandidates(
  states: AgentTargetState[]
): EnabledBuiltinControllerCandidatesResolution {
  return {
    candidates: resolveSelectableCandidates(states),
  };
}

async function resolveEnabledBuiltinCandidatesForSetup(): Promise<EnabledBuiltinControllerCandidatesResolution> {
  return await listAgentTargetStates()
    .then((states) => resolveEnabledBuiltinControllerCandidates(states))
    .catch((error) => ({
      candidates: [],
      error:
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "agents registry unavailable",
    }));
}

async function resolveConfiguredAgentController(input: {
  interactive: boolean;
  selectedController: Extract<
    AgentControllerSelectionResult,
    { status: "selected" }
  >;
  selectTransportModeMessage: string;
  selectResponsePolicyMessage: string;
  allowResponsePolicyBack: boolean;
}): Promise<
  | {
      status: "retry_controller";
    }
  | {
      status: "resolved";
      result: AgentProfileSetupResult;
    }
> {
  while (true) {
    const transportMode = await resolveAgentTransportModeSelection({
      interactive: input.interactive,
      candidate: input.selectedController.candidate,
      message: input.selectTransportModeMessage,
    });
    if (transportMode.status === "cancelled") {
      return {
        status: "resolved",
        result: {
          status: "cancelled",
        },
      };
    }
    if (transportMode.status === "back") {
      return {
        status: "retry_controller",
      };
    }

    const responsePolicy = await resolveAgentResponsePolicy({
      interactive: input.interactive,
      message: input.selectResponsePolicyMessage,
      allowBack: input.allowResponsePolicyBack,
    });
    if (responsePolicy.status === "cancelled") {
      return {
        status: "resolved",
        result: {
          status: "cancelled",
        },
      };
    }
    if (responsePolicy.status === "back") {
      if (!transportMode.prompted) {
        return {
          status: "retry_controller",
        };
      }
      continue;
    }

    return {
      status: "resolved",
      result: {
        status: "configured",
        agentControllerRef: buildAgentControllerRef({
          kind: "builtin",
          id: input.selectedController.candidate.agentId,
        }),
        controllerDisplayName: input.selectedController.candidate.displayName,
        transportMode: transportMode.transportMode,
        responsePolicy: responsePolicy.responsePolicy,
        selectionMode: input.selectedController.selectionMode,
      },
    };
  }
}

async function resolveAgentControllerSelection(input: {
  interactive: boolean;
  useAutoSelectionWhenNonInteractive: boolean;
  candidates: EnabledBuiltinControllerCandidate[];
  message: string;
  skipOptionLabel: string;
  allowBack: boolean;
}): Promise<AgentControllerSelectionResult> {
  if (!input.interactive) {
    if (!input.useAutoSelectionWhenNonInteractive) {
      return {
        status: "skipped",
      };
    }
    const candidate = input.candidates[0] ?? null;
    if (!candidate) {
      return {
        status: "skipped",
      };
    }
    return {
      status: "selected",
      candidate,
      selectionMode: "auto_first_available",
    };
  }

  const choice = await promptSearchSelect({
    message: input.message,
    items: [
      ...input.candidates.map(buildAgentControllerSearchItem),
      {
        value: AGENT_PROFILE_SETUP_SKIP,
        label: input.skipOptionLabel,
        detail: "Continue without controller setup.",
        searchText: `${input.skipOptionLabel} Continue without controller setup`,
      },
    ],
    maxVisible: 8,
    allowBack: input.allowBack,
    backLabel: "Back",
  });
  if (choice.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  if (choice.status === "back") {
    return {
      status: "back",
    };
  }
  if (choice.status !== "submitted") {
    return {
      status: "skipped",
    };
  }
  if (choice.value === AGENT_PROFILE_SETUP_SKIP) {
    return {
      status: "skipped",
    };
  }

  const selectedId = String(choice.value).trim();
  const candidate =
    input.candidates.find((item) => item.agentId === selectedId) ?? null;
  if (!candidate) {
    return {
      status: "skipped",
    };
  }

  return {
    status: "selected",
    candidate,
    selectionMode: "interactive",
  };
}

function buildAgentControllerSearchItem(
  candidate: EnabledBuiltinControllerCandidate
): SearchSelectItem<string> {
  const defaultTransportMode = resolveCandidateDefaultTransportMode(candidate);
  return {
    value: candidate.agentId,
    label: candidate.displayName,
    detail: `ID ${candidate.agentId} · default transport: ${defaultTransportMode}`,
    searchText: [
      candidate.displayName,
      candidate.agentId,
      defaultTransportMode,
    ].join(" "),
  };
}

async function resolveAgentTransportModeSelection(input: {
  interactive: boolean;
  candidate: EnabledBuiltinControllerCandidate;
  message: string;
}): Promise<AgentTransportModeSelectionResult> {
  const defaultTransportMode = resolveCandidateDefaultTransportMode(
    input.candidate
  );
  if (input.candidate.transportModes.length <= 1) {
    return {
      status: "submitted",
      transportMode: defaultTransportMode,
      prompted: false,
    };
  }
  if (!input.interactive) {
    return {
      status: "submitted",
      transportMode: defaultTransportMode,
      prompted: false,
    };
  }

  const selected = await select({
    message: input.message,
    options: [
      ...input.candidate.transportModes.map((transportMode) => ({
        value: transportMode.mode,
        label: transportMode.label,
        hint: transportMode.description,
      })),
      {
        value: AGENT_PROFILE_SETUP_BACK,
        label: "Back",
      },
    ],
    initialValue: defaultTransportMode,
  });
  if (isCancel(selected)) {
    return {
      status: "cancelled",
    };
  }
  if (selected === AGENT_PROFILE_SETUP_BACK) {
    return {
      status: "back",
    };
  }

  const selectedMode = String(selected).trim();
  const matched = input.candidate.transportModes.find(
    (transportMode) => transportMode.mode === selectedMode
  );
  return {
    status: "submitted",
    transportMode: matched?.mode ?? defaultTransportMode,
    prompted: true,
  };
}

async function resolveAgentResponsePolicy(input: {
  interactive: boolean;
  message: string;
  allowBack: boolean;
}): Promise<AgentResponsePolicySelectionResult> {
  if (!input.interactive) {
    return {
      status: "submitted",
      responsePolicy: AGENT_PROFILE_RESPONSE_POLICY_MENTION_ONLY,
    };
  }

  const selected = await select({
    message: input.message,
    options: [
      {
        value: AGENT_PROFILE_RESPONSE_POLICY_MENTION_ONLY,
        label: "Only When Mentioned (Default)",
        hint: "Auto-reply only when someone explicitly mentions this profile.",
      },
      ...(input.allowBack
        ? [
            {
              value: AGENT_PROFILE_SETUP_BACK,
              label: "Back",
            },
          ]
        : []),
    ],
    initialValue: AGENT_PROFILE_RESPONSE_POLICY_MENTION_ONLY,
  });
  if (isCancel(selected)) {
    return {
      status: "cancelled",
    };
  }
  if (selected === AGENT_PROFILE_SETUP_BACK) {
    return {
      status: "back",
    };
  }
  return {
    status: "submitted",
    responsePolicy: AGENT_PROFILE_RESPONSE_POLICY_MENTION_ONLY,
  };
}

function resolveCandidateDefaultTransportMode(input: {
  agentId: string;
  defaultTransportMode?: RuntimeAgentTransportMode;
  transportModes: Array<{ mode: RuntimeAgentTransportMode }>;
}): RuntimeAgentTransportMode {
  if (input.defaultTransportMode) {
    return input.defaultTransportMode;
  }
  return (
    input.transportModes[0]?.mode ??
    createDefaultRuntimeAgentControllerSettings(input.agentId).transportMode
  );
}
