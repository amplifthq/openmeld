import * as z from "zod/v4";

const identifier = z.string().min(1).max(512);
const status = identifier.nullable();
const failureKind = z.enum(["attempt", "publication"]);
const reasonCode = identifier.nullable();

/** Privileged operator discovery; never execution truth or Space authorization. */
export const wakeFailureListSchema = z.strictObject({
  v: z.literal(1),
  since: z.iso.datetime(),
  until: z.iso.datetime(),
  summaryScope: z.literal("page"),
  groups: z
    .array(
      z.strictObject({
        failureKind,
        status,
        reasonCode,
        failureCount: z.number().int().positive(),
        affectedWakes: z.number().int().positive(),
      })
    )
    .max(200),
  failures: z
    .array(
      z.strictObject({
        recordId: z.string().min(1).max(1024),
        failureKind,
        runtimeCoordinatorExecutionId: identifier.nullable(),
        attemptId: identifier.nullable(),
        dispatchId: identifier.nullable(),
        attemptNo: z.number().int().nonnegative().nullable(),
        status,
        reasonCode,
        observedAtMs: z.number().int().nonnegative(),
        spaceId: identifier.nullable(),
        sourceSignalId: identifier.nullable(),
        clientMessageId: identifier.nullable(),
        targetProfileId: identifier.nullable(),
        currentDispatchStatus: identifier.nullable(),
      })
    )
    .max(200),
  nextCursor: z.string().max(4096).nullable(),
});
