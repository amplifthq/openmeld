import type { z } from "zod/v4";

type CenterAgentInteractionSourceSchema =
  typeof import("../../schemas/protocol/center-agent-interaction-source")["centerAgentInteractionSourceSchema"];

export type CenterAgentInteractionSource =
  z.infer<CenterAgentInteractionSourceSchema>;
