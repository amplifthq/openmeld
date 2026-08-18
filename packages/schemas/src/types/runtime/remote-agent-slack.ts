import type { z } from "zod/v4";

type RemoteAgentSlackAppMentionEventSchema =
  typeof import("../../schemas/runtime/remote-agent-slack")["remoteAgentSlackAppMentionEventSchema"];
type RemoteAgentSlackEventCallbackPayloadSchema =
  typeof import("../../schemas/runtime/remote-agent-slack")["remoteAgentSlackEventCallbackPayloadSchema"];
type RemoteAgentSlackEventsApiPayloadSchema =
  typeof import("../../schemas/runtime/remote-agent-slack")["remoteAgentSlackEventsApiPayloadSchema"];
type RemoteAgentSlackEventQueueMessageSchema =
  typeof import("../../schemas/runtime/remote-agent-slack")["remoteAgentSlackEventQueueMessageSchema"];
type RemoteAgentSlackUrlVerificationPayloadSchema =
  typeof import("../../schemas/runtime/remote-agent-slack")["remoteAgentSlackUrlVerificationPayloadSchema"];

export type RemoteAgentSlackAppMentionEvent =
  z.infer<RemoteAgentSlackAppMentionEventSchema>;
type RemoteAgentSlackDirectMessageEventSchema =
  typeof import("../../schemas/runtime/remote-agent-slack")["remoteAgentSlackDirectMessageEventSchema"];
export type RemoteAgentSlackDirectMessageEvent =
  z.infer<RemoteAgentSlackDirectMessageEventSchema>;
export type RemoteAgentSlackEventCallbackPayload =
  z.infer<RemoteAgentSlackEventCallbackPayloadSchema>;
export type RemoteAgentSlackEventsApiPayload =
  z.infer<RemoteAgentSlackEventsApiPayloadSchema>;
export type RemoteAgentSlackEventQueueMessage =
  z.infer<RemoteAgentSlackEventQueueMessageSchema>;
export type RemoteAgentSlackUrlVerificationPayload =
  z.infer<RemoteAgentSlackUrlVerificationPayloadSchema>;
