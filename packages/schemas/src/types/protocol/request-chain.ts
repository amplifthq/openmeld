import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/protocol/request-chain");
export type RequestChain = z.infer<Schemas["requestChainSchema"]>;
export type RequestChainEntry = z.infer<Schemas["requestChainEntrySchema"]>;
export type RequestChainAgentEntry = z.infer<
  Schemas["requestChainAgentEntrySchema"]
>;
export type RequestChainSourceEntry = z.infer<
  Schemas["requestChainSourceEntrySchema"]
>;
