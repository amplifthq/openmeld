import { buildAgentControllerRef } from "@openmeld/agent-runtime";
import type { LocalDaemonAdapterContainer } from "@openmeld/local-service";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import type { LocalControllerInstallStatus } from "../../agents/local-controller-install";
import type {
  AgentTargetSelectableReason,
  AgentTargetState,
} from "../../agents/registry";
import { listAgentTargetStates } from "../../agents/registry";
import type { LocalParticipationState } from "../../system/action-participation-planner";
import { resolveLocalRuntimeControllerSupport } from "../routing/resolve-controller-support";
import {
  type AgentControllerInterfaceProbePolicy,
  resolveAgentControllerInterfaceSnapshot,
} from "./agent-controller-interface";

export type LocalAgentControllerLaunchability =
  | "blocked"
  | "launchable"
  | "needs_choice"
  | "needs_repair"
  | "not_detected"
  | "not_supported";

export type LocalAgentControllerInventoryItem = {
  agentId: string;
  blockerReasonCodes: readonly string[];
  agentControllerRef: string;
  agentControllerInterface?: AgentControllerInterfaceSnapshot;
  detected: boolean;
  displayName: string;
  enabled: boolean;
  launchability: LocalAgentControllerLaunchability;
  launchStatus: LocalControllerInstallStatus;
  launchStatusDetail: string | null;
  lifecycleStatus: AgentTargetState["lifecycleStatus"];
  registered: boolean;
  selectable: boolean;
  selectableReason: AgentTargetSelectableReason | null;
};

export type LocalAgentControllerInventory = {
  capabilities: LocalAgentControllerInventoryItem[];
};

export type LocalAgentControllerReportDecision = {
  localParticipationState: LocalParticipationState;
  reasonCodes: readonly string[];
};

type LocalAgentControllerReportDecisionCapability = Pick<
  LocalAgentControllerInventoryItem,
  | "agentControllerInterface"
  | "blockerReasonCodes"
  | "enabled"
  | "launchability"
  | "selectable"
  | "selectableReason"
>;

const CONTROLLER_AUTH_UNAUTHENTICATED_REASON_CODES = [
  "provider_account.access_required",
  "controller.auth.unauthenticated",
] as const;

const CONTROLLER_INTERFACE_ERROR_REASON_CODES = [
  "controller.interface.error",
] as const;
const CONTROLLER_INTERFACE_CHECK_FAILED_REASON_CODES = [
  "controller.interface.check_failed",
] as const;

export async function collectLocalAgentControllerInventory(
  input: {
    concurrency?: number;
    includeControllerInterface?: boolean;
    localAdapterContainer?: LocalDaemonAdapterContainer;
    probePolicy?: AgentControllerInterfaceProbePolicy;
    agentIds?: readonly string[];
    reconcileNewRegistrations?: boolean;
    onCapability?: (
      capability: LocalAgentControllerInventoryItem
    ) => Promise<void>;
  } = {}
): Promise<LocalAgentControllerInventory> {
  // OPENMELD_SERVICE_THIN_CORE: LocalAgentControllerInventory fact source.
  // This is local computer evidence only: detected controllers, launchability,
  // and local blockers. It must not become Profile, Binding, Space, Wake, or
  // final outcome truth.
  const collectCapability = async (
    state: AgentTargetState & { targetKind: "builtin" }
  ) => {
    const capability = await resolveLocalAgentControllerInventoryItem({
      includeControllerInterface: input.includeControllerInterface === true,
      localAdapterContainer: input.localAdapterContainer,
      probePolicy: input.probePolicy,
      state,
    });
    await input.onCapability?.(capability);
    return capability;
  };

  const capabilityByAgentId = new Map<
    string,
    LocalAgentControllerInventoryItem
  >();
  const states = await listAgentTargetStates({
    agentIds: input.agentIds,
    // Each controller is checked and reported as soon as its own check ends;
    // there is no full-machine scan barrier.
    concurrency: input.concurrency,
    reconcileNewRegistrations: input.reconcileNewRegistrations,
    onState: async (state) => {
      if (state.targetKind === "builtin") {
        capabilityByAgentId.set(
          state.agentId,
          await collectCapability({ ...state, targetKind: "builtin" })
        );
      }
    },
  });
  return {
    capabilities: states.flatMap((state) => {
      const capability = capabilityByAgentId.get(state.agentId);
      return capability ? [capability] : [];
    }),
  };
}

export async function resolveLocalAgentControllerInventoryItem(input: {
  includeControllerInterface?: boolean;
  localAdapterContainer?: LocalDaemonAdapterContainer;
  probePolicy?: AgentControllerInterfaceProbePolicy;
  state: AgentTargetState & { targetKind: "builtin" };
}): Promise<LocalAgentControllerInventoryItem> {
  const item = resolveLocalAgentControllerInventoryItemBase(input);
  if (
    input.includeControllerInterface !== true ||
    !input.state.registered ||
    !input.state.enabled
  ) {
    return item;
  }
  return {
    ...item,
    agentControllerInterface: await resolveAgentControllerInterfaceSnapshot({
      agentControllerRef: item.agentControllerRef,
      probePolicy: input.probePolicy,
      state: input.state,
    }),
  };
}

export function resolveLocalAgentControllerInventoryItemBase(input: {
  localAdapterContainer?: LocalDaemonAdapterContainer;
  state: AgentTargetState & { targetKind: "builtin" };
}): LocalAgentControllerInventoryItem {
  const agentControllerRef = buildAgentControllerRef({
    kind: "builtin",
    id: input.state.agentId,
  });
  const adapterSupport = input.localAdapterContainer
    ? resolveLocalRuntimeControllerSupport({
        agentControllerRef,
        localAdapterContainer: input.localAdapterContainer,
      })
    : null;
  const launchStatus =
    input.state.launchStatus ??
    (input.state.selectable ? "ready" : "not_available");
  const launchability = resolveLocalAgentControllerLaunchability({
    adapterSupported: adapterSupport?.supported ?? true,
    detected: input.state.detected,
    launchStatus,
    runtimeSupported: input.state.runtimeSupported,
    selectable: input.state.selectable,
    selectableReason: input.state.selectableReason,
  });

  return {
    agentId: input.state.agentId,
    blockerReasonCodes: resolveLocalAgentControllerBlockerReasonCodes({
      launchability,
      selectableReason: input.state.selectableReason,
    }),
    agentControllerRef,
    detected: input.state.detected,
    displayName: input.state.displayName,
    enabled: input.state.enabled,
    launchability,
    launchStatus,
    launchStatusDetail: input.state.launchStatusDetail ?? null,
    lifecycleStatus: input.state.lifecycleStatus,
    registered: input.state.registered,
    selectable: input.state.selectable,
    selectableReason: input.state.selectableReason,
  };
}

export function resolveLocalAgentControllerReportDecision(
  capability: LocalAgentControllerReportDecisionCapability,
  input: {
    requireEnabled: boolean;
  }
): LocalAgentControllerReportDecision {
  if (input.requireEnabled && !capability.enabled) {
    return {
      localParticipationState: "needs_agent_prepare",
      reasonCodes: ["local_agent_preparation.not_enabled"],
    };
  }

  if (capability.launchability !== "launchable" || !capability.selectable) {
    return {
      localParticipationState: "needs_agent_prepare",
      reasonCodes:
        capability.blockerReasonCodes.length > 0
          ? capability.blockerReasonCodes
          : [
              capability.selectableReason
                ? `local_agent_preparation.${capability.selectableReason}`
                : "local_agent_preparation.not_selectable",
            ],
    };
  }

  const interfaceReasonCodes = resolveAgentControllerInterfaceReasonCodes(
    capability.agentControllerInterface
  );
  if (interfaceReasonCodes.length > 0) {
    return {
      localParticipationState: "needs_agent_prepare",
      reasonCodes: interfaceReasonCodes,
    };
  }

  return {
    localParticipationState: "ready",
    reasonCodes: [],
  };
}

function resolveAgentControllerInterfaceReasonCodes(
  agentControllerInterface: AgentControllerInterfaceSnapshot | undefined
): readonly string[] {
  if (!agentControllerInterface) {
    return [];
  }
  if (agentControllerInterface.check?.status === "failed") {
    return CONTROLLER_INTERFACE_CHECK_FAILED_REASON_CODES;
  }
  if (agentControllerInterface.auth.status === "unauthenticated") {
    return CONTROLLER_AUTH_UNAUTHENTICATED_REASON_CODES;
  }
  if (agentControllerInterface.status === "error") {
    return CONTROLLER_INTERFACE_ERROR_REASON_CODES;
  }
  return [];
}

export function resolveLocalAgentControllerLaunchability(input: {
  adapterSupported?: boolean;
  detected: boolean;
  launchStatus: LocalControllerInstallStatus;
  runtimeSupported: boolean;
  selectable: boolean;
  selectableReason: AgentTargetSelectableReason | null;
}): LocalAgentControllerLaunchability {
  if (!input.detected) {
    return "not_detected";
  }
  if (
    !input.runtimeSupported ||
    input.selectableReason === "not_supported_yet"
  ) {
    return "not_supported";
  }
  if (input.launchStatus === "needs_choice") {
    return "needs_choice";
  }
  if (input.launchStatus === "needs_repair") {
    return "needs_repair";
  }
  if (
    input.launchStatus === "ready" &&
    input.selectable &&
    input.adapterSupported !== false
  ) {
    return "launchable";
  }
  return "blocked";
}

export function resolveLocalAgentControllerBlockerReasonCodes(input: {
  launchability: LocalAgentControllerLaunchability;
  selectableReason: AgentTargetSelectableReason | null;
}): readonly string[] {
  if (input.launchability === "launchable") {
    return [];
  }
  if (input.launchability === "needs_choice") {
    return ["controller.launch.choice_required"];
  }
  if (input.launchability === "needs_repair") {
    return ["controller.launch.needs_repair"];
  }
  if (input.launchability === "not_detected") {
    return ["local_agent_preparation.not_detected"];
  }
  if (input.launchability === "not_supported") {
    return ["local_agent_preparation.not_supported_yet"];
  }
  if (input.selectableReason) {
    return [`local_agent_preparation.${input.selectableReason}`];
  }
  return ["local_agent_preparation.not_enabled"];
}
