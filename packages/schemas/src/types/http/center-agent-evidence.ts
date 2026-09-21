import type { z } from "zod/v4";

type EvidenceSchemas =
  typeof import("../../schemas/http/center-agent-evidence");

export type CenterAgentReadAuditJournalRpcInput = z.infer<
  EvidenceSchemas["centerAgentReadAuditJournalRpcInputSchema"]
>;
export type CenterAgentReadAuditJournalResponse = z.infer<
  EvidenceSchemas["centerAgentReadAuditJournalResponseSchema"]
>;
