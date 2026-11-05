import { z } from "zod/v4";
import { channelContextSchema } from "./schemas/runtime/channel-context";

const providerId = z.string().trim().min(1).max(512);
export const feishuGroupHistoryReadSchema = z.strictObject({
  lookbackMinutes: z.number().int().min(1).max(120).default(30),
});
// The projection flag belongs to the RPC caller, never to model-supplied input.
export const feishuGroupHistoryCallSchema = z.object({
  request: feishuGroupHistoryReadSchema,
  includeCoverage: z.literal(true).optional(),
});
export type FeishuGroupHistoryCall = z.output<
  typeof feishuGroupHistoryCallSchema
>;
const feishuHistoryGapSchema = z.enum([
  "page_limit",
  "result_limit",
  "invalid_page",
  "rate_limited",
  "provider_unavailable",
  "revision_unavailable",
  "unreadable_message",
]);
export type FeishuHistoryGap = z.output<typeof feishuHistoryGapSchema>;
export const feishuGroupHistoryResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("read"),
    scope: z.literal("requester_top_level_messages"),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    coverage: z
      .strictObject({
        // Conservative lower bound of the examined suffix ending at endMs.
        // null means no safe time boundary can be reported.
        examinedFromMs: z.number().int().nonnegative().nullable(),
        gaps: z.array(feishuHistoryGapSchema),
      })
      .optional(),
    context: channelContextSchema,
  }),
  z.strictObject({
    status: z.enum(["disabled", "forbidden", "unavailable", "rate_limited"]),
  }),
]);
export const feishuHistoryGroupsQuerySchema = z.strictObject({
  connectionId: providerId,
  pageToken: providerId.optional(),
});
export const feishuHistoryGroupSettingSchema = z.strictObject({
  connectionId: providerId,
  generation: z.number().int().positive(),
  chatId: providerId,
  pageToken: providerId.optional(),
  enabled: z.boolean(),
});
export const feishuHistoryAuthorizationRequestSchema = z.strictObject({
  connectionId: providerId,
});
export const feishuHistoryAuthorizationSchema = z.strictObject({
  authorizationUrl: z
    .string()
    .trim()
    .max(16_384)
    .url()
    .refine((value) => {
      let u: URL;
      try {
        u = new URL(value);
      } catch {
        return false;
      }
      return (
        u.origin === "https://open.feishu.cn" &&
        !u.username &&
        !u.password &&
        !u.hash &&
        u.pathname === "/page/launcher" &&
        u.searchParams.getAll("clientID").length === 1 &&
        Boolean(u.searchParams.get("clientID")?.trim()) &&
        u.searchParams.getAll("user_code").length === 1 &&
        Boolean(u.searchParams.get("user_code")?.trim())
      );
    }),
});
export type FeishuHistoryAuthorizationRequest = z.output<
  typeof feishuHistoryAuthorizationRequestSchema
>;

// Retained for older Gateway clients during rolling deployment. The retired
// per-group endpoints return an explicit error and never change policy.
export const feishuHistoryGroupSettingResultSchema = z.union([
  feishuHistoryGroupSettingSchema,
  feishuHistoryAuthorizationSchema.extend({
    status: z.literal("permission_required"),
  }),
]);
export type FeishuHistoryGroupSettingResult = z.output<
  typeof feishuHistoryGroupSettingResultSchema
>;
export const feishuHistoryGroupsSchema = z.strictObject({
  generation: z.number().int().positive(),
  groups: z
    .array(
      z.strictObject({
        chatId: providerId,
        name: providerId,
        enabled: z.boolean(),
      })
    )
    .max(50),
  nextPageToken: providerId.nullable(),
});
export type FeishuGroupHistoryRead = z.output<
  typeof feishuGroupHistoryReadSchema
>;
export type FeishuGroupHistoryResult = z.output<
  typeof feishuGroupHistoryResultSchema
>;
export type FeishuHistoryGroupsQuery = z.output<
  typeof feishuHistoryGroupsQuerySchema
>;
export type FeishuHistoryGroups = z.output<typeof feishuHistoryGroupsSchema>;
export type FeishuHistoryGroupSetting = z.output<
  typeof feishuHistoryGroupSettingSchema
>;
