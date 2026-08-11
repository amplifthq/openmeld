import { cancel, confirm, isCancel } from "@clack/prompts";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import type { LocalServiceDemand } from "../local-service/lifecycle/local-service-demand";
import type { Presenter } from "../runtime/presenter/types";
import { runDaemonServiceParticipationGate } from "../system/local-service-participation-gate";
import type {
  ActionParticipationPlan,
  LocalParticipationOrchestratorOutcome,
} from "./action-participation-planner";
import { prepareLocalAgentReadiness } from "./local-agent-readiness-preparation";

export async function runLocalParticipationOrchestrator(input: {
  intent: "start" | "space_join" | "space_create_join" | "space_add_members";
  plan: ActionParticipationPlan;
  presenter: Presenter;
  resolvedView: "human" | "agent";
  allowPrompt: boolean;
  gatewayUrl?: string;
  localDemand?: LocalServiceDemand | null;
  forceServicePrompt?: boolean;
  profilesToPrepare?: readonly OpenMeldProfile[];
  view?: string;
}): Promise<LocalParticipationOrchestratorOutcome> {
  if (input.plan.hasAgentPreparationWork) {
    if (
      input.resolvedView !== "human" ||
      !input.allowPrompt ||
      !input.profilesToPrepare ||
      input.profilesToPrepare.length === 0
    ) {
      return {
        status: "continued",
      };
    }

    const prepareNow = await confirm({
      message: buildAgentPreparationPromptMessage(input.profilesToPrepare),
      active: "Set up now",
      inactive: "Not now",
      initialValue: true,
    });
    if (isCancel(prepareNow)) {
      cancel("Cancelled.");
      return {
        status: "cancelled",
      };
    }
    if (!prepareNow) {
      return {
        status: "continued",
      };
    }

    const preparationResult = await prepareLocalAgentReadiness({
      profiles: input.profilesToPrepare,
      interactive: true,
      view: input.view,
    });
    if (preparationResult.status === "cancelled") {
      return {
        status: "cancelled",
      };
    }
    if (preparationResult.status === "prepared") {
      return {
        status: "recheck_required",
      };
    }
  }

  if (!input.plan.shouldOfferServiceGate) {
    return {
      status: "continued",
    };
  }

  const gateResult = await runDaemonServiceParticipationGate({
    intent: input.intent,
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    allowPrompt: input.allowPrompt,
    gatewayUrl: input.gatewayUrl,
    localDemand: input.localDemand ?? null,
    forcePrompt: input.forceServicePrompt,
    view: input.view,
  });
  if (gateResult.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  return {
    status: gateResult.status === "aligned" ? "recheck_required" : "continued",
  };
}

function buildAgentPreparationPromptMessage(
  profiles: readonly Pick<OpenMeldProfile, "profileName">[]
): string {
  if (profiles.length === 1) {
    return `${profiles[0]?.profileName ?? "This agent"} still needs local setup on this device before it can wake or reply in the background. Set it up now?`;
  }
  return `${String(profiles.length)} local agent profiles still need setup on this device before they can wake or reply in the background. Set them up now?`;
}
