// A candidate identifies one controller on one reported Service runtime.
// It carries selection, not authorization; Core revalidates it before binding.
export function buildLocalAgentConnectionCandidateId(input: {
  agentControllerRef: string;
  deviceId: string;
  runtimeLane: string;
  openMeldServiceRuntimeId: string;
}): string {
  return [
    "local-agent",
    input.deviceId,
    input.runtimeLane,
    input.openMeldServiceRuntimeId,
    input.agentControllerRef,
  ]
    .map(encodeURIComponent)
    .join(":");
}
