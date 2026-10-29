import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/center-agent-knowledge");

export type CenterAgentReadSpaceGuideRequest = z.infer<
  Schemas["centerAgentReadSpaceGuideRequestSchema"]
>;
export type CenterAgentReadSpaceGuideResponse = z.infer<
  Schemas["centerAgentReadSpaceGuideResponseSchema"]
>;
