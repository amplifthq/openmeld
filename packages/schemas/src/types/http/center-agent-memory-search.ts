import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/center-agent-memory-search");
export type CenterAgentSearchMemoryRpcInput = z.infer<
  Schemas["centerAgentSearchMemoryRpcInputSchema"]
>;
export type CenterAgentSearchMemoryResponse = z.infer<
  Schemas["centerAgentSearchMemoryResponseSchema"]
>;
export type CenterAgentMemorySourceReference = z.infer<
  Schemas["centerAgentMemorySourceReferenceSchema"]
>;
