import * as z from "zod/v4";
import { profileSchema } from "./profile";

export const helloCapabilitiesSchema = z.object({
  agentReplyPlacement: z.boolean().optional(),
  liveSignalHistory: z.boolean().optional(),
  spaceMessageAddressing: z.boolean().optional(),
});

export const helloSchema = z.object({
  type: z.literal("hello"),
  profile: profileSchema,
  capabilities: helloCapabilitiesSchema.optional(),
});

export const helloAckSchema = z.object({
  type: z.literal("system.hello.ack"),
  profile: profileSchema,
});
