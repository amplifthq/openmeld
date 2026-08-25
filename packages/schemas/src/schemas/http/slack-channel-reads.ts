import * as z from "zod/v4";
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
export const CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES = 5_242_880;
export const CENTER_AGENT_SLACK_FILE_MAX_BASE64_CHARACTERS =
  Math.ceil(CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES / 3) * 4;
const slackFileContentBase64Schema = z
  .string()
  .max(CENTER_AGENT_SLACK_FILE_MAX_BASE64_CHARACTERS)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);

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
  includeFiles: z.literal(true).optional(),
  limit: z.number().int().min(1).max(15).optional(),
});

export const centerAgentReadSlackFileBodySchema = z.union([
  z.strictObject({
    channelName: slackChannelNameSchema,
    fileId: trimmedNonEmptyStringSchema.max(256),
  }),
  z.strictObject({
    channelId: trimmedNonEmptyStringSchema.max(80),
    fileId: trimmedNonEmptyStringSchema.max(256),
  }),
]);

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

export const slackFileMetadataSchema = z.strictObject({
  fileId: trimmedNonEmptyStringSchema.max(256),
  mimeType: nullableTrimmedStringSchema,
  name: nullableTrimmedStringSchema,
  permalink: z.union([z.url({ protocol: /^https$/u }), z.null()]),
  sizeBytes: z.number().int().nonnegative().nullable(),
});

export const slackChannelHistoryMessageSchema = z.strictObject({
  authorDisplayName: nullableTrimmedStringSchema,
  authorSlackUserId: nullableTrimmedStringSchema,
  isAuthorBot: z.boolean(),
  messageTs: trimmedNonEmptyStringSchema,
  files: z.array(slackFileMetadataSchema).optional(),
  text: nullableTrimmedStringSchema,
});

export const slackChannelHistoryResponseSchema = z.strictObject({
  channelName: slackChannelNameSchema,
  generatedAt: ISO_DATE_TIME_SCHEMA,
  messages: z.array(slackChannelHistoryMessageSchema),
  nextCursor: nullableTrimmedStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
});

export const slackFileReadResponseSchema = z.strictObject({
  channelName: slackChannelNameSchema.optional(),
  contentBase64: slackFileContentBase64Schema,
  file: slackFileMetadataSchema,
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

export const centerAgentReadSlackFileResponseSchema = z.union([
  slackFileReadResponseSchema,
  slackReadUnavailableResponseSchema,
]);
