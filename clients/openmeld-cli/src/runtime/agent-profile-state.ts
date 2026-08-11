import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { formatDaemonRouteObservationLabel } from "../local-service/status/daemon-route-observation-presentation";
import {
  buildProfileWorkspacePresentation,
  buildProfileWorkspaceRows,
  type ProfileWorkspacePresentation,
} from "../profile-workspace/presentation";
import {
  type OpenClawLocalDiagnostics,
  resolveOpenClawLocalDiagnosticsValue,
} from "../provider-hosts/openclaw/diagnostics";
import {
  type DaemonRouteObservation,
  resolveCurrentReplyReadinessSnapshot,
} from "../system/current-reply-readiness-snapshot";
import {
  formatOpenClawAuthDisplay,
  formatOpenClawBootstrapDisplay,
  formatOpenClawGatewayHealthDisplay,
  formatOpenClawGatewayVisibilityDisplay,
} from "../system/provider-diagnostics/openclaw/presentation";
import {
  formatAgentReplyReadinessLabel,
  mapAgentReplyReadinessToLegacyAutoReply,
} from "../system/reply-readiness";
import { resolveHumanControllerDisplayName } from "../ui/controller-display";
import { formatTransportModeDisplay } from "../ui/transport-mode-display";

const RAW_NOT_CONFIGURED = "not configured";
const DISPLAY_UNKNOWN = "Unknown";

type AgentProfileCardRow = {
  label: string;
  value: string;
};

type AgentProfileRuntimeState = {
  wakeRouteEvidence: DaemonRouteObservation | null;
  openClawLocalDiagnostics: OpenClawLocalDiagnostics | null;
  transportMode: string;
  autoReplyReady: boolean;
  autoReplyReason: string | null;
  replyReadiness: "ready" | "blocked" | "degraded" | "unknown";
  replyReadinessLabel: string;
  replyReadinessReasonCodes: string[];
  replyReadinessReasonText: string | null;
  localAgentId: string | null;
  localAgentDisplayName: string | null;
  localAgentEnabled: boolean | null;
  workspace: ProfileWorkspacePresentation | null;
};

type AgentProfileRuntimeReplyState = Pick<
  AgentProfileRuntimeState,
  | "autoReplyReady"
  | "autoReplyReason"
  | "replyReadiness"
  | "replyReadinessLabel"
  | "replyReadinessReasonCodes"
  | "replyReadinessReasonText"
>;

export function buildAgentProfileStateRows(
  profile: OpenMeldProfile
): AgentProfileCardRow[] {
  if (profile.profileKind !== "agent") {
    return [];
  }

  return [];
}

export function buildAgentProfileStateData(
  _profile: OpenMeldProfile
): Record<string, never> {
  return {};
}

export async function resolveAgentProfileRuntimeState(
  profile: OpenMeldProfile,
  _input: {
    includeDaemonRouteObservation?: boolean;
  } = {}
): Promise<AgentProfileRuntimeState | null> {
  if (profile.profileKind !== "agent") {
    return null;
  }
  const currentReplyReadiness = await resolveCurrentReplyReadinessSnapshot({
    checkGatewayChain: true,
    includeDaemonRouteObservation: true,
    openClawDiagnosticsMode: "inspect",
    ownerUserId: profile.ownerUserId,
    profile,
  });
  const agentReplyReadiness = currentReplyReadiness.agentReplyReadiness;
  const workspace = buildProfileWorkspacePresentation(
    currentReplyReadiness.profileWorkspaceRuntimeResolution
  );

  const replyState = resolveReplyState(agentReplyReadiness);
  const localAgentId = agentReplyReadiness?.localAgentId ?? null;
  const localAgentDisplayName = localAgentId
    ? resolveHumanControllerDisplayName({
        agentControllerRef: `builtin:${localAgentId}`,
      }) || localAgentId
    : null;
  const localAgentEnabled =
    localAgentId && agentReplyReadiness
      ? !agentReplyReadiness.reasonCodes.includes(
          "controller.registry.disabled"
        )
      : null;

  return {
    wakeRouteEvidence: currentReplyReadiness.daemonRouteObservation,
    openClawLocalDiagnostics: resolveOpenClawLocalDiagnosticsValue(
      currentReplyReadiness.openClawLocalDiagnostics
    ),
    transportMode: agentReplyReadiness?.transportMode ?? RAW_NOT_CONFIGURED,
    ...replyState,
    localAgentId,
    localAgentDisplayName,
    localAgentEnabled,
    workspace,
  };
}

function resolveReplyState(
  agentReplyReadiness: Awaited<
    ReturnType<typeof resolveCurrentReplyReadinessSnapshot>
  >["agentReplyReadiness"]
): AgentProfileRuntimeReplyState {
  if (!agentReplyReadiness) {
    return {
      autoReplyReady: false,
      autoReplyReason: "reply readiness is not available",
      replyReadiness: "unknown",
      replyReadinessLabel: "unknown (reply readiness is not available)",
      replyReadinessReasonCodes: [],
      replyReadinessReasonText: "reply readiness is not available",
    };
  }

  const readiness =
    mapAgentReplyReadinessToLegacyAutoReply(agentReplyReadiness);
  return {
    autoReplyReady: readiness.ready,
    autoReplyReason: readiness.reason,
    replyReadiness: agentReplyReadiness.replyReadiness,
    replyReadinessLabel: formatAgentReplyReadinessLabel(agentReplyReadiness),
    replyReadinessReasonCodes: [...agentReplyReadiness.reasonCodes],
    replyReadinessReasonText: agentReplyReadiness.reasonText,
  };
}

export function buildAgentProfileRuntimeRows(
  runtimeState: AgentProfileRuntimeState | null
): AgentProfileCardRow[] {
  if (!runtimeState) {
    return [];
  }

  return [
    ...buildSelectedLocalAgentRows(runtimeState),
    {
      label: "Connection Type",
      value: formatTransportModeDisplay(runtimeState.transportMode),
    },
    {
      label: "Can Reply in Space",
      value: formatHumanReplyReadinessLabel(runtimeState.replyReadinessLabel),
    },
    ...(runtimeState.wakeRouteEvidence
      ? [
          {
            label: "Server Can Reach This Device",
            value: formatDaemonRouteObservationLabel(
              runtimeState.wakeRouteEvidence
            ),
          },
        ]
      : []),
    ...buildProfileWorkspaceRows(runtimeState.workspace),
    ...buildOpenClawRuntimeRows(runtimeState.openClawLocalDiagnostics),
  ];
}

export function buildAgentProfileRuntimeData(
  runtimeState: AgentProfileRuntimeState | null
): {
  openClawLocalDiagnostics?: OpenClawLocalDiagnostics | null;
  wakeRouteEvidence?: DaemonRouteObservation | null;
  transportMode?: string | null;
  replyReadiness?: AgentProfileRuntimeState["replyReadiness"] | null;
  replyReadinessLabel?: string | null;
  replyReadinessReasonCodes?: string[] | null;
  replyReadinessReasonText?: string | null;
  autoReplyReady?: boolean | null;
  autoReplyReason?: string | null;
  localAgent?: {
    id: string;
    displayName: string | null;
    enabled: boolean | null;
  } | null;
  workspace?: ProfileWorkspacePresentation | null;
} {
  if (!runtimeState) {
    return {};
  }

  return {
    wakeRouteEvidence: runtimeState.wakeRouteEvidence,
    transportMode: runtimeState.transportMode,
    replyReadiness: runtimeState.replyReadiness,
    replyReadinessLabel: runtimeState.replyReadinessLabel,
    replyReadinessReasonCodes: runtimeState.replyReadinessReasonCodes,
    replyReadinessReasonText: runtimeState.replyReadinessReasonText,
    autoReplyReady: runtimeState.autoReplyReady,
    autoReplyReason: runtimeState.autoReplyReason,
    localAgent: runtimeState.localAgentId
      ? {
          id: runtimeState.localAgentId,
          displayName: runtimeState.localAgentDisplayName,
          enabled: runtimeState.localAgentEnabled,
        }
      : null,
    workspace: runtimeState.workspace,
    openClawLocalDiagnostics: runtimeState.openClawLocalDiagnostics,
  };
}

function buildSelectedLocalAgentRows(
  runtimeState: AgentProfileRuntimeState
): AgentProfileCardRow[] {
  if (!runtimeState.localAgentId) {
    return [];
  }
  return [
    {
      label: "Local agent selection",
      value: "Selected",
    },
    {
      label: "Agent",
      value: runtimeState.localAgentDisplayName ?? runtimeState.localAgentId,
    },
    {
      label: "Agent On",
      value: formatAgentOnDisplay(runtimeState.localAgentEnabled),
    },
  ];
}

function formatAgentOnDisplay(enabled: boolean | null): string {
  if (enabled === null) {
    return DISPLAY_UNKNOWN;
  }
  return enabled ? "On" : "Off";
}

function buildOpenClawRuntimeRows(
  diagnostics: OpenClawLocalDiagnostics | null
): AgentProfileCardRow[] {
  if (!diagnostics) {
    return [];
  }
  return [
    {
      label: "Local OpenClaw Status",
      value: "Current local state",
    },
    {
      label: "OpenClaw Agent",
      value: diagnostics.agentId ?? DISPLAY_UNKNOWN,
    },
    {
      label: "Bootstrap Status",
      value: formatOpenClawBootstrapDisplay({
        diagnostics,
        mode: "inspect",
      }),
    },
    {
      label: "Auth Status",
      value: formatOpenClawAuthDisplay({
        diagnostics,
        mode: "inspect",
      }),
    },
    {
      label: "Gateway",
      value: formatOpenClawGatewayHealthDisplay(diagnostics),
    },
    {
      label: "Agent Visibility",
      value: formatOpenClawGatewayVisibilityDisplay(diagnostics),
    },
  ];
}

function formatHumanReplyReadinessReason(reason: string): string {
  if (reason === "local agent connection is missing") {
    return "can't reply from Space yet; you can still join and send manually";
  }
  if (
    reason ===
    "local device runtime projection is missing (run `openmeld doctor --repair`)"
  ) {
    return "OpenMeld is still setting up this device (run `openmeld doctor --repair`)";
  }
  if (reason === "reply readiness is not available") {
    return "OpenMeld can't tell yet whether this profile can reply";
  }
  return reason;
}

function formatHumanReplyReadinessLabel(label: string): string {
  const normalized = label.trim();
  if (normalized === "ready") {
    return "Can reply";
  }
  if (normalized === "blocked") {
    return "Blocked";
  }
  if (normalized === "degraded") {
    return "Limited";
  }
  if (normalized === "unknown") {
    return "Unknown";
  }
  if (normalized.startsWith("blocked (") && normalized.endsWith(")")) {
    return `Blocked (${formatHumanReplyReadinessReason(normalized.slice(9, -1))})`;
  }
  if (normalized.startsWith("degraded (") && normalized.endsWith(")")) {
    return `Limited (${formatHumanReplyReadinessReason(normalized.slice(10, -1))})`;
  }
  if (normalized.startsWith("unknown (") && normalized.endsWith(")")) {
    return `Unknown (${formatHumanReplyReadinessReason(normalized.slice(9, -1))})`;
  }
  return label;
}
