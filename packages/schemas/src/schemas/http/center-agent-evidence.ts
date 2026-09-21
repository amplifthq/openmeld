import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import {
  listCenterAgentAuditJournalQuerySchema,
  listCenterAgentAuditJournalResponseSchema,
} from "./center-agent";
import { centerAgentVerifiedMemberToolSpeakerSchema } from "./center-agent-speaker";

export const centerAgentReadAuditJournalRpcInputSchema =
  listCenterAgentAuditJournalQuerySchema.extend({
    context: openMeldRequestContextSchema,
    speakerMember: centerAgentVerifiedMemberToolSpeakerSchema,
  });

export const centerAgentReadAuditJournalResponseSchema =
  listCenterAgentAuditJournalResponseSchema.extend({
    coverage: z.strictObject({
      kind: z.literal("bounded_recent_journal"),
      references: z.literal("authorized_space_references_only"),
      contextDetails: z.literal("not_included"),
      historicalCompleteness: z.literal("not_claimed"),
    }),
  });
