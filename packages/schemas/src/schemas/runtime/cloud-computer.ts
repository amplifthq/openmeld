import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

/** Account identity is independent of a provider's resource address. */
export const cloudComputerSchema = z.strictObject({
  id: z.string().min(1),
  ownerUserId: z.string().min(1),
  provider: z.literal("cloudflare"),
  createdAtMs: z.number().int().nonnegative(),
});

export type CloudComputer = zod.infer<typeof cloudComputerSchema>;

const path = z.string().min(1).max(4096);
const key = z.string().min(1).max(256);
export const cloudComputerCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("start"),
    key,
    command: z.string().min(1).max(64_000),
    timeoutSeconds: z.number().int().min(1).max(3600).optional(),
  }),
  z.strictObject({
    action: z.literal("poll"),
    key,
    after: z.number().nonnegative().optional(),
    waitSeconds: z.number().int().min(0).max(20).optional(),
  }),
  z.strictObject({ action: z.literal("stop"), key }),
  z.strictObject({ action: z.literal("list") }),
]);
export const cloudComputerOperationSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("read"), path }),
  z.strictObject({
    action: z.literal("write"),
    path,
    content: z.string().max(2_000_000),
    expectedContent: z.string().max(2_000_000).optional(),
  }),
  z.strictObject({
    action: z.literal("edit"),
    path,
    oldText: z.string().min(1).max(2_000_000),
    newText: z.string().max(2_000_000),
    replaceAll: z.boolean().optional(),
  }),
  z.strictObject({ action: z.literal("list"), path }),
  z.strictObject({
    action: z.literal("command"),
    invocationId: key,
    cwd: path.optional(),
    command: cloudComputerCommandSchema,
  }),
]);
export type CloudComputerOperation = zod.infer<
  typeof cloudComputerOperationSchema
>;

export const cloudComputerRpcRequestSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  operation: cloudComputerOperationSchema.optional(),
});
export const cloudComputerWorkerRequestSchema = z.strictObject({
  computer: cloudComputerSchema,
  operation: cloudComputerOperationSchema,
});
export const cloudComputerOperationResultSchema = z.union([
  z.strictObject({ path, content: z.string() }),
  z.strictObject({ path, written: z.literal(true) }),
  z.strictObject({ path, replacements: z.number().int().positive() }),
  z.strictObject({ path, entries: z.array(z.string()) }),
  z.array(z.strictObject({ id: key, key, createdAt: z.number() })),
  z.object({
    id: key,
    key,
    status: z.enum(["running", "completed", "stop_requested"]),
    exitCode: z.number().nullable().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    after: z.number().optional(),
    outputPending: z.literal(true).optional(),
    nextAction: z.string().optional(),
  }),
]);
export const cloudComputerResponseSchema = z.strictObject({
  computer: cloudComputerSchema,
  observedAtMs: z.number().int(),
  result: cloudComputerOperationResultSchema.optional(),
});

export const cloudComputerCleanupResultSchema = z.strictObject({
  unfinished: z.number().int().nonnegative(),
  lostDuringCleanup: z.boolean(),
});
