import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { agentProfileIdSchema } from "../protocol/profile";

const count = z.int().nonnegative();
const location = z.strictObject({
  spaceId: z.string().min(1),
  spaceName: z.string().min(1),
});

/** A read projection of existing Wake progress and pending Space input. */
export const agentWorkloadSnapshotSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unavailable") }),
  z.strictObject({
    status: z.literal("ready"),
    activeCount: count,
    waitingCount: count,
    queuedMessageCount: count,
    pausedMessageCount: count,
    // Only source-authorized rows have locations or message previews.
    items: z.array(
      z.strictObject({
        id: z.string().min(1),
        kind: z.enum(["active", "waiting", "queued_message", "paused_message"]),
        location,
        text: z.string(),
      })
    ),
  }),
]);

/** Trusted Core-to-Space read after current Organization membership admission. */
export const spaceAgentWorkloadInputSchema = z.strictObject({
  spaceId: z.string().min(1),
  organizationId: z.string().min(1),
  targetProfileId: agentProfileIdSchema,
  context: openMeldRequestContextSchema,
});

export type AgentWorkloadSnapshot = z.infer<typeof agentWorkloadSnapshotSchema>;
export type SpaceAgentWorkloadInput = z.infer<
  typeof spaceAgentWorkloadInputSchema
>;
