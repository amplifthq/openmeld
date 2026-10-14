// biome-ignore lint/performance/noNamespaceImport: Worker-safe Zod import avoids bundling unused locales.
import * as z from "zod/v4";

// Public BDK 0.2.24 wire contract, captured against an existing Bot.
export const grokBotConversationIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,256}$/u);

export const grokBotEntriesSchema = z.object({
  entries: z.array(
    z.object({
      seq: z.string(),
      updatedSeq: z.string(),
      kind: z.string(),
      role: z.string().optional(),
      text: z.string().optional(),
      createdAtMs: z.number(),
    })
  ),
  latestUpdatedSeq: z.string().regex(/^(?:-1|\d+)$/u),
  turn: z.object({
    idle: z.boolean(),
    inFlight: z.boolean(),
    queued: z.number().int().nonnegative(),
  }),
});

export const grokBotMessageReceiptSchema = z.object({
  messageId: z.string(),
  delivery: z.enum(["accepted_temporal", "duplicate"]),
});

export const grokBotStoredCredentialSchema = z.object({
  backendUrl: z.literal("https://api2.cursor.sh"),
  apiKey: z.string().min(1),
});

export const grokBotAccountSchema = z.object({
  email: z.string().email().nullable(),
  authId: z.string().min(1),
});
