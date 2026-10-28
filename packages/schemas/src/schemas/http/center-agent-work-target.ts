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
  selectedByProfileId: z.string().min(1),
  selectionSignalId: z.string().min(1),
  selectionRevision: z.number().int().nonnegative(),
  selectionKind: z.enum(["inherit", "select"]),
});
export const centerAgentWorkTargetRequestSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  selection: z
    .strictObject({
      expectedRevision: z.number().int().nonnegative(),
      choice: centerAgentWorkTargetSelectionSchema,
    })
    .optional(),
});
export const centerAgentWorkTargetResponseSchema = z.strictObject({
  record: centerAgentWorkTargetRecordSchema.nullable(),
  selectionRequired: z.boolean(),
});
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
