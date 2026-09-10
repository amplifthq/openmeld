import * as z from "../../lazy-zod";
import { uuidProfileIdSchema } from "../protocol/profile";

export const HUMAN_PRESENCE_HEARTBEAT_MS = 30_000;
export const HUMAN_PRESENCE_LEASE_MS = 90_000;
export const HUMAN_PRESENCE_IDLE_MS = 5 * 60_000;

// Identity and all timestamps are assigned by Core, never by a page.
export const organizationMemberPresenceBodySchema = z.strictObject({
  sessionId: z.string().uuid(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  foreground: z.boolean(),
  interaction: z.boolean(),
});

export const organizationMemberPresenceSchema = z.strictObject({
  userId: z.string().trim().min(1),
  profileId: uuidProfileIdSchema.nullable(),
  status: z.enum(["online", "offline"]),
});

export const organizationMemberPresenceResponseSchema = z.strictObject({
  organizationId: z.string().trim().min(1),
  generatedAt: z.iso.datetime({ offset: true }),
  members: z.array(organizationMemberPresenceSchema),
});

export const organizationMemberPresenceWriteResponseSchema = z.strictObject({
  organizationId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
});
