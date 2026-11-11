import type { z as Zod } from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import {
  githubRepositoryTargetSchema,
  projectIssueDestinationSchema,
} from "./projects";

export const centerAgentWorkTargetSchema = z.strictObject({
  requestGoal: z.string().trim().min(1).max(2000),
  codeRepositories: z.array(githubRepositoryTargetSchema).max(8),
  issueDestinations: z.array(projectIssueDestinationSchema).max(8),
});
export const centerAgentWorkTargetSelectionSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("inherit") }),
    z.strictObject({
      kind: z.literal("select"),
      relationship: z.enum(["new_request", "correction"]),
      target: centerAgentWorkTargetSchema,
    }),
  ]
);
export const centerAgentWorkTargetRecordSchema = z.strictObject({
  target: centerAgentWorkTargetSchema,
  revision: z.number().int().positive(),
  sourceSignalId: z.string().min(1),
  sourceRevision: z.number().int().nonnegative(),
  sourceProfileId: z.string().min(1),
  sourceProfileKind: z.enum(["human", "agent"]),
});
export const centerAgentWorkTargetRequestSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  referenceSourceSignalId: z.string().min(1).max(512).optional(),
  selection: z
    .strictObject({
      expectedRevision: z.number().int().nonnegative(),
      expectedSourceSignalId: z.string().min(1).nullable(),
      choice: centerAgentWorkTargetSelectionSchema,
    })
    .optional(),
});
export const centerAgentWorkTargetResponseSchema = z.strictObject({
  record: centerAgentWorkTargetRecordSchema.nullable(),
  selectionRequired: z.boolean(),
});
// Private Core-to-Space projection, derived from the admitted execution.
export const centerAgentWorkTargetSourceInputSchema = z.strictObject({
  logicalConversationId: z.string().min(1).max(1024),
  sourceSignalId: z.string().min(1).max(512),
  sourceAuthorProfileId: z.string().min(1).max(512).nullable(),
  sourceOwnerUserId: z.string().min(1).max(512).nullable(),
  executorProfileId: z.string().min(1).max(512),
  referenceSourceSignalId: z.string().min(1).max(512).optional(),
  admittedAtMs: z.number().int().nonnegative(),
  selection: centerAgentWorkTargetRequestSchema.shape.selection,
});
export type CenterAgentWorkTargetSourceInput = Zod.infer<
  typeof centerAgentWorkTargetSourceInputSchema
>;
export type CenterAgentWorkTarget = Zod.infer<
  typeof centerAgentWorkTargetSchema
>;
export type CenterAgentWorkTargetRecord = Zod.infer<
  typeof centerAgentWorkTargetRecordSchema
>;
export type CenterAgentWorkTargetSelection = Zod.infer<
  typeof centerAgentWorkTargetSelectionSchema
>;
export type CenterAgentWorkTargetRequest = Zod.infer<
  typeof centerAgentWorkTargetRequestSchema
>;
export type CenterAgentWorkTargetResponse = Zod.infer<
  typeof centerAgentWorkTargetResponseSchema
>;
