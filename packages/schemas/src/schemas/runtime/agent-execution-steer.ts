import * as z from "zod/v4";

/** The caller must resolve and authorize the exact live execution's task. */
export const agentExecutionSteerRequestSchema = z.strictObject({
  taskId: z.string().min(1),
  inputId: z.string().min(1),
  text: z.string().trim().min(1).max(100_000),
});

export const agentExecutionSteerResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("applied"),
      taskId: z.string().min(1),
      threadId: z.string().min(1),
      turnId: z.string().min(1),
    }),
    z.strictObject({
      status: z.literal("not_applied"),
      taskId: z.string().min(1),
      reasonCode: z.enum([
        "execution_input.target_unavailable",
        "execution_input.unsupported",
        "execution_input.rejected",
      ]),
    }),
    z.strictObject({
      status: z.literal("unconfirmed"),
      taskId: z.string().min(1),
      reasonCode: z.literal("execution_input.application_unconfirmed"),
    }),
  ]
);
