import * as z from "../../lazy-zod";

// Captured by the Space owner of truth. Never accepted from message content.
export const spaceCallerContextSchema = z.strictObject({
  relationship: z.enum([
    "internal",
    "external",
    "anonymous",
    "agent",
    "system",
  ]),
  spaceRole: z.enum(["owner", "member", "visitor"]),
  audience: z.enum(["organization", "external"]),
});
