import * as z from "zod/v4";
import { executionRecoveryActionSchema } from "../http/execution-recovery";
import { workingLanguageTagSchema } from "./working-language";

const identifier = z.string().trim().min(1).max(512);
export const agentExecutionConfirmationSchema = z.enum([
  "not_executed",
  "executed",
  "unknown",
]);
const result = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unknown") }),
  z.strictObject({ status: z.literal("not_started") }),
  z.strictObject({ status: z.literal("unavailable") }),
  z.strictObject({ status: z.literal("retained"), resultRef: identifier }),
  z.strictObject({ status: z.literal("published"), resultRef: identifier }),
]);

/** Owner-supplied read projection. It grants no retry or recovery authority. */
export const agentFailureFactsSchema = z
  .strictObject({
    v: z.literal(1),
    reasonCode: identifier,
    stage: z.enum(["preparation", "admission", "execution", "publication"]),
    // This is independent of result availability. Missing or unfamiliar
    // confirmation evidence must never be interpreted as "not executed".
    executionConfirmation: agentExecutionConfirmationSchema
      .catch("unknown")
      .default("unknown"),
    result,
    // Verified published child results are not this failed turn's own result.
    completedResults: z
      .array(z.strictObject({ resultRef: identifier, url: identifier }))
      .max(10)
      .optional(),
    retry: z
      .strictObject({
        status: z.enum(["none", "scheduled", "in_progress", "exhausted"]),
        attempt: z.number().int().positive().optional(),
        maxAttempts: z.number().int().positive().optional(),
        nextAttemptAtMs: z.number().int().nonnegative().optional(),
      })
      .superRefine((value, context) => {
        if (
          value.attempt !== undefined &&
          value.maxAttempts !== undefined &&
          value.attempt > value.maxAttempts
        ) {
          context.addIssue({
            code: "custom",
            path: ["attempt"],
            message: "Attempt exceeds the owner's retry limit.",
          });
        }
        if (
          value.nextAttemptAtMs !== undefined &&
          value.status !== "scheduled"
        ) {
          context.addIssue({
            code: "custom",
            path: ["nextAttemptAtMs"],
            message: "Only a scheduled retry has a next attempt time.",
          });
        }
      }),
    recovery: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("none") }),
      z.strictObject({
        status: z.literal("in_progress"),
        operationId: identifier,
      }),
      z.strictObject({
        status: z.literal("recovered"),
        operationId: identifier,
        resultRef: identifier,
      }),
    ]),
    recoveryActions: z
      .array(
        z.union([
          executionRecoveryActionSchema,
          z.enum([
            "review_agent_permissions",
            "continue_task_continuation",
            "restart_task_continuation",
          ]),
        ])
      )
      .max(6),
    diagnosticReference: z
      .strictObject({
        spaceId: identifier,
        dispatchId: identifier,
        attemptId: identifier.optional(),
      })
      .nullable(),
    // Resolved display language: prefer a trusted response decision; owners
    // may explicitly use Organization preference as a labelled fallback.
    // Never derive this from text detection. Absent language uses English.
    languageTag: workingLanguageTagSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.executionConfirmation === "executed" &&
        value.result.status === "not_started") ||
      (value.executionConfirmation === "not_executed" &&
        (value.result.status === "retained" ||
          value.result.status === "published"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["executionConfirmation"],
        message: "Execution confirmation conflicts with the confirmed result.",
      });
    }
    if (
      value.recovery.status === "recovered" &&
      (!("resultRef" in value.result) ||
        value.result.resultRef !== value.recovery.resultRef)
    ) {
      context.addIssue({
        code: "custom",
        path: ["recovery"],
        message: "Recovery requires the same confirmed result reference.",
      });
    }
  });

export type AgentFailureFacts = z.infer<typeof agentFailureFactsSchema>;
