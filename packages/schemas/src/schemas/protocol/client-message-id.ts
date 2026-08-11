import { z } from "zod/v4";

export const clientMessageIdSchema = z.string().trim().min(1).max(200);

export const parseOptionalClientMessageId = (value: unknown): string | null => {
  const parsed = clientMessageIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};
