import * as z from "zod/v4";
import { createSpaceBodySchema } from "./space-create";

export const walkthroughStepSchema = z.enum([
  "create-space",
  "add-center-agent",
  "first-task",
  "local-agent",
  "add-local-agent",
  "local-task",
  "review-replies",
  "options",
  "complete",
]);

export const firstWorkRecordSchema = z.strictObject({
  organizationId: z.string().min(1),
  profileId: z.string().min(1),
  spaceId: z.string().regex(/^[a-f0-9]{64}$/u),
  runId: z.uuid(),
  revision: z.number().int().nonnegative(),
  iteration: z.number().int().positive(),
  step: walkthroughStepSchema,
  paused: z.boolean(),
});

export const firstWorkResponseSchema = z.strictObject({
  record: firstWorkRecordSchema.nullable(),
  // Account-level admission is separate from the current workspace's run.
  hasStartedTutorial: z.boolean(),
});

export const firstWorkActionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("start"),
    runId: z.uuid(),
    previousRunId: z.uuid().nullable(),
  }),
  z.strictObject({
    action: z.literal("progress"),
    runId: z.uuid(),
    revision: z.number().int().nonnegative(),
    step: walkthroughStepSchema,
    paused: z.boolean(),
  }),
  z.strictObject({
    action: z.literal("create"),
    runId: z.uuid(),
    space: createSpaceBodySchema,
  }),
]);

export type WalkthroughStep = z.infer<typeof walkthroughStepSchema>;

export type FirstWorkRecord = z.infer<typeof firstWorkRecordSchema>;
export type FirstWorkResponse = z.infer<typeof firstWorkResponseSchema>;
export type FirstWorkAction = z.infer<typeof firstWorkActionSchema>;
