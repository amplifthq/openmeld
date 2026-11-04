import { z } from "zod/v4";
import { channelContextSchema } from "./schemas/runtime/channel-context";

const providerId = z.string().trim().min(1).max(512);
export const feishuGroupHistoryReadSchema = z.strictObject({
  lookbackMinutes: z.number().int().min(1).max(120).default(30),
});
export const feishuGroupHistoryResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("read"),
    scope: z.literal("requester_top_level_messages"),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
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
