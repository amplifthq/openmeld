import * as z from "zod/v4";
import { remoteAgentWorkerExecutionQuerySchema } from "./remote-agent-worker";

const inputIdentity = {
  target: remoteAgentWorkerExecutionQuerySchema,
  inputId: z.string().min(1).max(256),
};

/** Core authorizes the sender before forwarding this exact-execution input. */
export const remoteAgentWorkerExecutionInputRequestSchema = z.strictObject({
  ...inputIdentity,
  authorProfileId: z.string().min(1),
  sourceSignalId: z.string().min(1),
  text: z.string().trim().min(1).max(100_000),
});

export const remoteAgentWorkerExecutionInputQuerySchema =
  z.strictObject(inputIdentity);

export const remoteAgentWorkerExecutionInputReceiptSchema = z.strictObject({
  ...inputIdentity,
  receivedAtMs: z.number().int().nonnegative(),
  appliedAtMs: z.number().int().nonnegative().nullable(),
});

export const remoteAgentWorkerExecutionInputResponseSchema = z.union([
  z.strictObject({
    status: z.enum(["received", "applied", "unconfirmed"]),
    receipt: remoteAgentWorkerExecutionInputReceiptSchema,
  }),
  z.strictObject({
    status: z.literal("rejected"),
    reason: z.enum([
      "target_unavailable",
      "authority_mismatch",
      "input_conflict",
    ]),
  }),
  z.strictObject({ status: z.literal("not_found") }),
]);
