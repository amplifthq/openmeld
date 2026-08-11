import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import type { RuntimeAgentControllerReportSubmission } from "../local-service/reporting/runtime-agent-controller-reporting-submission";
import {
  type AgentProfileRuntimeBindingEnsureResult,
  syncAgentProfileRuntimeBindingFromCurrentReadiness,
} from "./ensure-agent-profile-runtime-binding";

export const FORMAL_AGENT_BINDING_NOT_READY_REASON_TEXT =
  "OpenMeld could not finish connecting this Agent Profile to this computer.";

export type FormalAgentBindingBackstopResult = {
  agentProfileBindingEnsure: AgentProfileRuntimeBindingEnsureResult;
  reasonCodes: string[];
  reasonText: string | null;
  runtimeReportSubmission: RuntimeAgentControllerReportSubmission;
  status: "ready" | "not_ready";
};

export async function ensureFormalAgentBindingForReadyLocalProfile(input: {
  profile: OpenMeldProfile;
}): Promise<FormalAgentBindingBackstopResult> {
  const result = await syncAgentProfileRuntimeBindingFromCurrentReadiness({
    profile: input.profile,
  });
  const bindingEnsure = result.agentProfileBindingEnsure;
  if (bindingEnsure.status === "accepted" && bindingEnsure.routable) {
    return {
      agentProfileBindingEnsure: bindingEnsure,
      reasonCodes: bindingEnsure.reasonCodes,
      reasonText: null,
      runtimeReportSubmission: result.runtimeReportSubmission,
      status: "ready",
    };
  }

  return {
    agentProfileBindingEnsure: bindingEnsure,
    reasonCodes:
      bindingEnsure.reasonCodes.length > 0
        ? [...bindingEnsure.reasonCodes]
        : ["agent_profile_binding.unavailable"],
    reasonText: FORMAL_AGENT_BINDING_NOT_READY_REASON_TEXT,
    runtimeReportSubmission: result.runtimeReportSubmission,
    status: "not_ready",
  };
}
