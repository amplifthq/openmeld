import * as z from "../../lazy-zod";
import { agentProfileIdSchema } from "../protocol/profile";
import {
  profileFolderIdSchema,
  profileFolderOperationSchema,
  profileFolderProjectionSchema,
} from "../protocol/profile-folders";
import { agentProfileBindingTargetSchema } from "./agent-profile-binding";
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

/**
 * Owner folder change from Profile settings. A custom path travels to the
 * Agent's Computer only for add_custom and is never stored by Core. The
 * default changes only through set_default, so removing a folder never
 * picks a new default.
 */
export const manageAgentProfileFoldersBodySchema = z
  .strictObject({
    expectedBindingTarget: agentProfileBindingTargetSchema,
    operation: profileFolderOperationSchema,
  })
  .superRefine((value, context) => {
    if (value.operation.operation === "list") {
      context.addIssue({
        code: "custom",
        message: "Read folders with GET.",
        path: ["operation"],
      });
    }
    if (
      value.operation.operation === "remove" &&
      value.operation.nextDefaultFolderId !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Make another folder the default before removing this one.",
        path: ["operation", "nextDefaultFolderId"],
      });
    }
  });

export const manageAgentProfileFoldersResponseSchema = z.strictObject({
  agentProfileId: agentProfileIdSchema,
  folderId: profileFolderIdSchema.optional(),
  observedAtMs: z.number().int().nonnegative(),
  projection: profileFolderProjectionSchema,
  target: peopleComputerTargetSchema,
});
