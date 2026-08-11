import { continuitySchema } from "@openmeld/schemas";
import type { Continuity } from "@openmeld/schemas/types";

export function deriveContinuity(input: {
  messagesSinceThen: number;
  higherAuthorityUpdateCount: number;
}): Continuity {
  const parsed = continuitySchema.safeParse({
    messagesSinceThen: input.messagesSinceThen,
    higherAuthorityUpdates: input.higherAuthorityUpdateCount > 0,
  });
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(parsed.error.issues[0]?.message ?? "continuity is invalid");
}
