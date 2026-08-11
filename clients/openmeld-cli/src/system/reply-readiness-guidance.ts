import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import type { OpenClawLocalDiagnostics } from "../provider-hosts/openclaw/diagnostics";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import { resolveGatewayChainRepairGuidance } from "./gateway-chain-readiness";
import { resolveOpenClawDiagnosticsGuidance } from "./provider-diagnostics/openclaw/guidance";
import type {
  AgentReplyReadinessStatus,
  ReplyReadinessReasonCode,
} from "./reply-readiness";
import {
  REPLY_READINESS_COPY,
  resolveReplyReadinessGuidanceSummaryCopy,
} from "./reply-readiness-copy";
import { resolveServiceParticipationReadiness } from "./service-participation-readiness";

export type ReplyReadinessGuidance = {
  primaryReasonCode: ReplyReadinessReasonCode | null;
  summary: string;
  nextSteps: string[];
};

export function buildReplyReadinessGuidance(input: {
  openClawLocalDiagnostics?: OpenClawLocalDiagnostics | null;
  profile: OpenMeldProfile;
  replyReadiness: AgentReplyReadinessStatus;
}): ReplyReadinessGuidance {
  if (input.replyReadiness.replyReadiness === "ready") {
    return {
      primaryReasonCode: null,
      summary: REPLY_READINESS_COPY.guidance.readySummary,
      nextSteps: [
        formatOpenMeldCliCommand("openmeld space join YOUR_SPACE_ID"),
        REPLY_READINESS_COPY.guidance.readyMentionInstruction,
      ],
    };
  }

  const primaryReasonCode =
    input.replyReadiness.reasonCodes[0] ?? "route.not_registered";
  const serviceGuidance = buildServiceReplyReadinessGuidance({
    primaryReasonCode,
    replyReadiness: input.replyReadiness,
  });

  if (serviceGuidance) {
    return serviceGuidance;
  }

  const openClawGuidance = buildOpenClawReplyReadinessGuidance({
    diagnostics: input.openClawLocalDiagnostics ?? null,
    primaryReasonCode,
    profile: input.profile,
  });
  if (openClawGuidance) {
    return openClawGuidance;
  }

  return {
    primaryReasonCode,
    summary: buildReplyReadinessGuidanceSummary(primaryReasonCode),
    nextSteps: buildReplyReadinessNextSteps({
      localAgentId: input.replyReadiness.localAgentId,
      profile: input.profile,
      reasonCode: primaryReasonCode,
    }),
  };
}

function buildOpenClawReplyReadinessGuidance(input: {
  diagnostics: OpenClawLocalDiagnostics | null;
  primaryReasonCode: ReplyReadinessReasonCode;
  profile: OpenMeldProfile;
}): ReplyReadinessGuidance | null {
  if (
    !input.diagnostics ||
    (input.primaryReasonCode !== "controller.bootstrap.failed" &&
      input.primaryReasonCode !== "controller.gateway.unhealthy")
  ) {
    return null;
  }
  const guidance = resolveOpenClawDiagnosticsGuidance({
    diagnostics: input.diagnostics,
    profileId: input.profile.openMeldProfileId,
  });
  return {
    primaryReasonCode: input.primaryReasonCode,
    summary: guidance.summary,
    nextSteps: guidance.nextCommands.map((command) =>
      formatOpenMeldCliCommand(command)
    ),
  };
}

function buildServiceReplyReadinessGuidance(input: {
  primaryReasonCode: ReplyReadinessReasonCode;
  replyReadiness: AgentReplyReadinessStatus;
}): ReplyReadinessGuidance | null {
  switch (input.primaryReasonCode) {
    case "service.not_installed":
    case "service.drifted":
    case "service.not_running":
    case "dispatch.storage_not_ready":
    case "service.gateway_chain_unhealthy": {
      const serviceParticipationReadiness =
        resolveServiceParticipationReadiness({
          deviceReplyReadiness: input.replyReadiness.deviceReplyReadiness,
        });
      return {
        primaryReasonCode: input.primaryReasonCode,
        summary: serviceParticipationReadiness.detailText,
        nextSteps: serviceParticipationReadiness.nextSteps,
      };
    }
    default:
      return null;
  }
}

function buildReplyReadinessGuidanceSummary(
  reasonCode: ReplyReadinessReasonCode
): string {
  return resolveReplyReadinessGuidanceSummaryCopy(reasonCode);
}

function buildReplyReadinessNextSteps(input: {
  localAgentId?: string | null;
  profile: OpenMeldProfile;
  reasonCode: ReplyReadinessReasonCode;
}): string[] {
  const profileId = input.profile.openMeldProfileId;

  switch (input.reasonCode) {
    case "local_agents.none_needed":
      return [
        formatOpenMeldCliCommand("openmeld start"),
        formatOpenMeldCliCommand("openmeld service install"),
        formatOpenMeldCliCommand("openmeld service start"),
      ];
    case "profile.inactive":
      return [
        formatOpenMeldCliCommand("openmeld profile list"),
        formatOpenMeldCliCommand("openmeld profile set <agent-profile-id>"),
      ];
    case "profile.unbound":
      return [REPLY_READINESS_COPY.guidance.selectProfileAgentInstruction];
    case "controller.binding.disabled":
      return [REPLY_READINESS_COPY.guidance.turnOnProfileAgentInstruction];
    case "projection.missing":
      return [
        formatOpenMeldCliCommand(
          `openmeld service status --profile ${profileId}`
        ),
      ];
    case "controller.registry.disabled":
      return [
        formatOpenMeldCliCommand("openmeld agents enable --agent <agent-id>"),
        formatOpenMeldCliCommand("openmeld agents list"),
      ];
    case "controller.launch.choice_required":
      return buildLocalAgentInstallChoiceNextSteps({
        localAgentId: input.localAgentId,
      });
    case "controller.launch.needs_repair":
      return buildLocalAgentLaunchRepairNextSteps({
        localAgentId: input.localAgentId,
      });
    case "workspace.missing":
    case "workspace.invalid":
      return buildLocalAgentLaunchRepairNextSteps({
        localAgentId: input.localAgentId,
      });
    case "runtime.adapter.unsupported":
      return [
        formatOpenMeldCliCommand("openmeld agents detect"),
        formatOpenMeldCliCommand("openmeld agents list"),
      ];
    case "controller.bootstrap.failed":
      return [
        ...buildLocalAgentLaunchRepairNextSteps({
          localAgentId: input.localAgentId,
        }),
        formatOpenMeldCliCommand("openclaw agents list"),
      ];
    case "controller.gateway.unhealthy":
      return [
        ...buildLocalAgentLaunchRepairNextSteps({
          localAgentId: input.localAgentId,
        }),
        formatOpenMeldCliCommand("openclaw health --json"),
      ];
    case "route.offline":
      return [
        formatOpenMeldCliCommand(
          `openmeld service status --profile ${profileId}`
        ),
        formatOpenMeldCliCommand("openmeld service repair"),
      ];
    case "route.not_registered":
      return [
        formatOpenMeldCliCommand(
          `openmeld service status --profile ${profileId}`
        ),
        formatOpenMeldCliCommand("openmeld doctor --repair"),
      ];
    case "service.gateway_chain_unhealthy":
      return resolveGatewayChainRepairGuidance({}).nextSteps;
    case "dispatch.storage_not_ready":
      return resolveGatewayChainRepairGuidance({
        failureKind: "dispatch_storage_not_ready",
      }).nextSteps;
    default:
      return [formatOpenMeldCliCommand("openmeld doctor --repair")];
  }
}

function buildLocalAgentInstallChoiceNextSteps(input: {
  localAgentId?: string | null;
}): string[] {
  const agentId = normalizeOptionalText(input.localAgentId);
  if (!agentId) {
    return [
      formatOpenMeldCliCommand("openmeld agents enable --agent <agent-id>"),
      formatOpenMeldCliCommand("openmeld agents list"),
    ];
  }

  return [
    formatOpenMeldCliCommand(`openmeld agents enable --agent ${agentId}`),
    formatOpenMeldCliCommand(`openmeld agents repair --agent ${agentId}`),
  ];
}

function buildLocalAgentLaunchRepairNextSteps(input: {
  localAgentId?: string | null;
}): string[] {
  const agentId = normalizeOptionalText(input.localAgentId);
  if (!agentId) {
    return [
      formatOpenMeldCliCommand("openmeld agents repair --agent <agent-id>"),
      formatOpenMeldCliCommand("openmeld agents list"),
    ];
  }

  return [
    formatOpenMeldCliCommand(`openmeld agents repair --agent ${agentId}`),
  ];
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
