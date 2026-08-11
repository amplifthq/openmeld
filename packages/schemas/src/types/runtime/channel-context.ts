import type { z } from "zod/v4";

type ChannelContextSchema =
  typeof import("../../schemas/runtime/channel-context")["channelContextSchema"];
type ChannelContextAuthorSchema =
  typeof import("../../schemas/runtime/channel-context")["channelContextAuthorSchema"];
type ChannelContextMessageSchema =
  typeof import("../../schemas/runtime/channel-context")["channelContextMessageSchema"];
type ChannelContextSyncSchema =
  typeof import("../../schemas/runtime/channel-context")["channelContextSyncSchema"];

export type ChannelContext = z.infer<ChannelContextSchema>;
export type ChannelContextAuthor = z.infer<ChannelContextAuthorSchema>;
export type ChannelContextMessage = z.infer<ChannelContextMessageSchema>;
export type ChannelContextSync = z.infer<ChannelContextSyncSchema>;
