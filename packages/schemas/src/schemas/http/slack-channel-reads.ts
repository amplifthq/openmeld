import { z } from "zod/v4";
import {
  slackReadUnavailableResponseSchema,
  slackWorkspaceDirectoryMemberSchema,
} from "./slack-workspace-directory";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const nullableTrimmedStringSchema = z.union([
  trimmedNonEmptyStringSchema,
  z.null(),
]);
const slackChannelNameSchema = trimmedNonEmptyStringSchema.max(80);
const slackCursorSchema = trimmedNonEmptyStringSchema.max(2048).optional();

export const centerAgentListSlackChannelsBodySchema = z.strictObject({
  cursor: slackCursorSchema,
  limit: z.number().int().min(1).max(200).optional(),
});

export const centerAgentReadSlackChannelMembersBodySchema = z.strictObject({
  channelName: slackChannelNameSchema,
  cursor: slackCursorSchema,
  includeChannelId: z.literal(true).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const centerAgentReadSlackChannelHistoryBodySchema = z.strictObject({
  channelName: slackChannelNameSchema,
  cursor: slackCursorSchema,
  expectedChannelId: trimmedNonEmptyStringSchema.max(80).optional(),
  limit: z.number().int().min(1).max(15).optional(),
});

export const slackChannelSummarySchema = z.strictObject({
  channelName: slackChannelNameSchema,
  isMember: z.boolean(),
  isPrivate: z.boolean(),
  memberCount: z.number().int().nonnegative().nullable(),
});

export const slackChannelListResponseSchema = z.strictObject({
  channels: z.array(slackChannelSummarySchema),
  generatedAt: ISO_DATE_TIME_SCHEMA,
  nextCursor: nullableTrimmedStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
});

export const slackChannelMembersResponseSchema = z.strictObject({
  channelId: trimmedNonEmptyStringSchema.max(80).optional(),
  channelName: slackChannelNameSchema,
  generatedAt: ISO_DATE_TIME_SCHEMA,
  members: z.array(slackWorkspaceDirectoryMemberSchema),
  nextCursor: nullableTrimmedStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
});

export const slackChannelHistoryMessageSchema = z.strictObject({
  authorDisplayName: nullableTrimmedStringSchema,
  authorSlackUserId: nullableTrimmedStringSchema,
  isAuthorBot: z.boolean(),
  messageTs: trimmedNonEmptyStringSchema,
  text: nullableTrimmedStringSchema,
});

export const slackChannelHistoryResponseSchema = z.strictObject({
  channelName: slackChannelNameSchema,
  generatedAt: ISO_DATE_TIME_SCHEMA,
  messages: z.array(slackChannelHistoryMessageSchema),
  nextCursor: nullableTrimmedStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
});

export const centerAgentListSlackChannelsResponseSchema = z.union([
  slackChannelListResponseSchema,
  slackReadUnavailableResponseSchema,
]);

export const centerAgentReadSlackChannelMembersResponseSchema = z.union([
  slackChannelMembersResponseSchema,
  slackReadUnavailableResponseSchema,
]);

export const centerAgentReadSlackChannelHistoryResponseSchema = z.union([
  slackChannelHistoryResponseSchema,
  slackReadUnavailableResponseSchema,
]);
