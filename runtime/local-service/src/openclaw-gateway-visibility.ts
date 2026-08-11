import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas/types";

export type OpenClawGatewayVisibility = NonNullable<
  OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"]
>;

export function mergeOpenClawGatewayVisibility(input: {
  primary?: OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"] | null;
  fallback?:
    | OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"]
    | null;
}): OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"] | undefined {
  const source = input.primary ?? input.fallback;
  if (!source) {
    return undefined;
  }
  return {
    agentId: source.agentId,
    gatewayRestartAttempted: source.gatewayRestartAttempted,
    gatewayVisibility: source.gatewayVisibility,
  };
}
