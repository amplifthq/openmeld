import * as z from "../../lazy-zod";
import { agentProfileIdSchema } from "../protocol/profile";
import { profileFolderProjectionSchema } from "../protocol/profile-folders";
import { peopleComputerTargetSchema } from "./people-computers";

// Contract: developing/product/agent-profiles.md (Working Folder Configuration
// And Default Project). Owner-only folder read; folders carry no path.
export const getAgentProfileFoldersRouteParamsSchema = z.strictObject({
  agentProfileId: agentProfileIdSchema,
});

export const getAgentProfileFoldersResponseSchema = z.discriminatedUnion(
  "status",
  [
    // Read from the Agent's Computer just now.
    z.strictObject({
      agentProfileId: agentProfileIdSchema,
      status: z.literal("current"),
      target: peopleComputerTargetSchema,
      observedAtMs: z.number().int().nonnegative(),
      projection: profileFolderProjectionSchema,
    }),
    // The Computer did not answer; this is the last folder save Core recorded.
    z.strictObject({
      agentProfileId: agentProfileIdSchema,
      status: z.literal("recorded"),
      target: peopleComputerTargetSchema,
      observedAtMs: z.number().int().nonnegative(),
      projection: profileFolderProjectionSchema,
      reasonCode: z.string().trim().min(1).max(256),
    }),
    z.strictObject({
      agentProfileId: agentProfileIdSchema,
      status: z.literal("unavailable"),
      target: peopleComputerTargetSchema,
      reasonCode: z.string().trim().min(1).max(256),
      message: z.string().trim().min(1).max(1000),
    }),
  ]
);
