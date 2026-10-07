import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/daemon/session-history");
export type SessionHistoryPolicy = z.infer<
  Schemas["sessionHistoryPolicySchema"]
>;
export type SessionHistoryRequester = z.infer<
  Schemas["sessionHistoryRequesterSchema"]
>;
export type SessionHistoryAudit = z.infer<Schemas["sessionHistoryAuditSchema"]>;
export type SessionHistoryResult = z.infer<
  Schemas["sessionHistoryResultSchema"]
>;
export type SessionHistoryOperation = z.infer<
  Schemas["sessionHistoryOperationSchema"]
>;
export type SessionHistoryRpcInput = z.infer<
  Schemas["sessionHistoryRpcInputSchema"]
>;
export type SessionHistoryServiceRequest = z.infer<
  Schemas["sessionHistoryServiceRequestSchema"]
>;
export type SessionHistoryRequestFrame = z.infer<
  Schemas["sessionHistoryRequestFrameSchema"]
>;
export type SessionHistoryAgentRpcInput = z.infer<
  Schemas["sessionHistoryAgentRpcInputSchema"]
>;
