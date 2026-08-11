import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/slack-channel-reads");

export type CenterAgentListSlackChannelsBody = z.infer<
  Schemas["centerAgentListSlackChannelsBodySchema"]
>;
export type CenterAgentReadSlackChannelMembersBody = z.infer<
  Schemas["centerAgentReadSlackChannelMembersBodySchema"]
>;
export type CenterAgentReadSlackChannelHistoryBody = z.infer<
  Schemas["centerAgentReadSlackChannelHistoryBodySchema"]
>;
export type SlackChannelSummary = z.infer<Schemas["slackChannelSummarySchema"]>;
export type SlackChannelListResponse = z.infer<
  Schemas["slackChannelListResponseSchema"]
>;
export type SlackChannelMembersResponse = z.infer<
  Schemas["slackChannelMembersResponseSchema"]
>;
export type SlackChannelHistoryMessage = z.infer<
  Schemas["slackChannelHistoryMessageSchema"]
>;
export type SlackChannelHistoryResponse = z.infer<
  Schemas["slackChannelHistoryResponseSchema"]
>;
