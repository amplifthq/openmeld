import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { connectorServiceSchema } from "../http/connector-connections";

export const REMOTE_AGENT_RETAINED_RESULT_MAX_BYTES = 8 * 1024 * 1024;
export const REMOTE_AGENT_RETAINED_RESULT_TTL_MS = 60 * 60 * 1000;
export const REMOTE_AGENT_RETAINED_RESULT_READ_MAX_CHARS = 12_000;
export const REMOTE_AGENT_RETAINED_RESULT_MAX_PER_EXECUTION = 16;

export const remoteAgentResultSourceSchema = z.strictObject({
  kind: z.literal("plugin_connection"),
  connectionName: z.string().trim().min(1).max(512),
  service: connectorServiceSchema,
  connectionUpdatedAtMs: z.number().int().nonnegative().optional(),
});
export const remoteAgentResultSourcesSchema = z
  .array(remoteAgentResultSourceSchema)
  .max(16);
export type RemoteAgentResultSource = zod.infer<
  typeof remoteAgentResultSourceSchema
>;

export const remoteAgentReadToolResultRequestSchema = z
  .strictObject({
    resultId: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(REMOTE_AGENT_RETAINED_RESULT_READ_MAX_CHARS)
      .optional(),
    query: z.string().min(1).max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      !value.resultId &&
      (value.offset !== undefined ||
        value.limit !== undefined ||
        value.query !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Provide resultId for a result read or search; omit all fields to list recoverable references.",
      });
    }
  });

const resultSlice = {
  resultId: z.string().regex(/^[a-f0-9]{64}$/u),
  format: z.literal("json"),
  offsetUnit: z.literal("utf16"),
  totalChars: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
};
export const remoteAgentReadToolResultResponseSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("list"),
      results: z
        .array(
          z.strictObject({
            resultId: z.string().regex(/^[a-f0-9]{64}$/u),
            toolName: z.string().min(1),
            totalChars: z.number().int().nonnegative(),
            expiresAtMs: z.number().int().nonnegative(),
          })
        )
        .max(REMOTE_AGENT_RETAINED_RESULT_MAX_PER_EXECUTION),
    }),
    z.strictObject({
      ...resultSlice,
      kind: z.literal("read"),
      offset: z.number().int().nonnegative(),
      text: z.string().max(REMOTE_AGENT_RETAINED_RESULT_READ_MAX_CHARS),
    }),
    z.strictObject({
      ...resultSlice,
      kind: z.literal("search"),
      query: z.string().min(1).max(200),
      matches: z
        .array(
          z.strictObject({
            offset: z.number().int().nonnegative(),
            excerptOffset: z.number().int().nonnegative(),
            text: z.string().max(650),
          })
        )
        .max(20),
    }),
  ]
);
