import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/space-human-mentions");
export type SpaceHumanMentionTarget = z.infer<
  Schemas["spaceHumanMentionTargetSchema"]
>;
export type RemoteAgentResolveReplyMentionsRequest = z.infer<
  Schemas["remoteAgentResolveReplyMentionsRequestSchema"]
>;
export type RemoteAgentResolveReplyMentionsResponse = z.infer<
  Schemas["remoteAgentResolveReplyMentionsResponseSchema"]
>;
