import { z } from "zod/v4";
import { MAX_TEXT_LENGTH } from "../protocol/constants";

// Provider presentation receipts only. The existing six-card budget leaves
// at most five retired cards; pending text includes bounded provider notices.
export const messageChannelCardHistorySchema = z
  .object({
    v: z.literal(1),
    firstIndex: z.number().int().min(0).max(5),
    cards: z
      .array(
        z
          .object({
            cardId: z.string().min(1).max(512),
            textHash: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .strict()
      )
      .max(5),
    legacySuperseded: z.boolean().optional(),
    pendingSnapshot: z
      .string()
      .max(MAX_TEXT_LENGTH + 1024)
      .optional(),
  })
  .strict();

export type MessageChannelCardHistory = z.infer<
  typeof messageChannelCardHistorySchema
>;
