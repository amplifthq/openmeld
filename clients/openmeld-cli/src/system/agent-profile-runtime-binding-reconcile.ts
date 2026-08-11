import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import {
  type AgentProfileRuntimeBindingEnsureResult,
  syncAgentProfileRuntimeBindingFromCurrentReadiness,
} from "./ensure-agent-profile-runtime-binding";

export async function syncAgentProfileRuntimeBindingIfRunnable(input: {
  profile: OpenMeldProfile;
}): Promise<AgentProfileRuntimeBindingEnsureResult | null> {
  if (
    input.profile.profileKind !== "agent" ||
    input.profile.status !== "active"
  ) {
    return null;
  }

  const result = await syncAgentProfileRuntimeBindingFromCurrentReadiness({
    profile: input.profile,
  });
  return result.agentProfileBindingEnsure;
}
