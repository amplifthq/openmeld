import type { z } from "zod/v4";

type GatewayErrorCodeSchema =
  typeof import("../../schemas/http/gateway-error")["gatewayErrorCodeSchema"];
type GatewayErrorEnvelopeSchema =
  typeof import("../../schemas/http/gateway-error")["gatewayErrorEnvelopeSchema"];

export type GatewayErrorCode = z.infer<GatewayErrorCodeSchema>;
export type GatewayErrorEnvelope = z.infer<GatewayErrorEnvelopeSchema>;
