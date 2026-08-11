export type LocalServiceDiagnosticsPayload = {
  localServiceDiagnostics: {
    source: "local_service_diagnostics";
    scope: "diagnostic_only";
    authoritative: false;
    verdict: "not_wake_readiness";
    meaning: string;
    useInstead: readonly string[];
    deviceEvidence: unknown;
    agentEvidence: unknown;
  };
};

export function buildLocalServiceDiagnosticsPayload(input: {
  deviceEvidence: unknown;
  agentEvidence: unknown;
}): LocalServiceDiagnosticsPayload {
  // OPENMELD_SERVICE_THIN_CORE: diagnostics-only projection.
  // Keep this payload useful for agents, but never let it become final Wake
  // readiness, Binding truth, RuntimeCoordinator truth, or Space outcome truth.
  return {
    localServiceDiagnostics: {
      source: "local_service_diagnostics",
      scope: "diagnostic_only",
      authoritative: false,
      verdict: "not_wake_readiness",
      meaning:
        "Diagnostic-only local service evidence. It can explain local problems, but it is not the final Wake availability verdict and not a Space Wake outcome. Use daemonRouteObservation for current route evidence and service trace for a concrete Wake delivery.",
      useInstead: ["daemonRouteObservation", "openmeld service trace"],
      deviceEvidence: input.deviceEvidence,
      agentEvidence: input.agentEvidence,
    },
  };
}
