import type { z } from "zod/v4";

type CenterAgentDirectMessageSpaceProjectionSchema =
  typeof import("../../schemas/http/center-agent-direct-message-space")["centerAgentDirectMessageSpaceProjectionSchema"];
type GetCenterAgentDirectMessageSpaceProjectionResponseSchema =
  typeof import("../../schemas/http/center-agent-direct-message-space")["getCenterAgentDirectMessageSpaceProjectionResponseSchema"];

export type CenterAgentDirectMessageSpaceProjection =
  z.infer<CenterAgentDirectMessageSpaceProjectionSchema>;
export type GetCenterAgentDirectMessageSpaceProjectionResponse =
  z.infer<GetCenterAgentDirectMessageSpaceProjectionResponseSchema>;
