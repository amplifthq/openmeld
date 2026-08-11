import type { RuntimeTransportSetLocalAgentEnabledResponse } from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "./errors";

type AcceptedLocalAgentControlPayload = Omit<
  Extract<
    RuntimeTransportSetLocalAgentEnabledResponse,
    { status: "accepted" }
  >["payload"],
  "accepted" | "status"
> & {
  accepted: true;
  status: "updated" | "unchanged";
};

export function requireAcceptedLocalAgentControlPayload(
  transportResult: RuntimeTransportSetLocalAgentEnabledResponse
): AcceptedLocalAgentControlPayload {
  if (transportResult.status !== "accepted") {
    throw createCoreRpcHttpError({
      status:
        transportResult.reasonCode === "local_agent_control.timeout"
          ? 504
          : 409,
      reason: transportResult.message,
      code: transportResult.reasonCode,
    });
  }
  if (
    !transportResult.payload.accepted ||
    transportResult.payload.status === "rejected"
  ) {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        transportResult.payload.message ??
        "The current local OpenMeld Service rejected the local agent change.",
      code:
        transportResult.payload.reasonCode ?? "local_agent_control.rejected",
    });
  }
  return transportResult.payload as AcceptedLocalAgentControlPayload;
}
