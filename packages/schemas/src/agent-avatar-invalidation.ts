import * as z from "zod/v4";
import { agentProfileIdSchema } from "./schemas/protocol/profile";

// Browser tabs share a refresh hint, never Profile data or authorization.
export const agentAvatarInvalidationSchema = z.strictObject({
  type: z.literal("agent.avatar.changed"),
  ownerAccountId: z.string().min(1),
  organizationId: z.string().min(1),
  profileId: agentProfileIdSchema,
});
export type AgentAvatarInvalidation = z.infer<
  typeof agentAvatarInvalidationSchema
>;
