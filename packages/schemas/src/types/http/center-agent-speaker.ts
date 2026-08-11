import type { z } from "zod/v4";

type SpeakerSchemas = typeof import("../../schemas/http/center-agent-speaker");

export type CenterAgentAnonymousMemberToolName = z.infer<
  SpeakerSchemas["centerAgentAnonymousMemberToolNameSchema"]
>;
export type CenterAgentAnonymousMemberToolSpeaker = z.infer<
  SpeakerSchemas["centerAgentAnonymousMemberToolSpeakerSchema"]
>;
export type CenterAgentAuthorizeAnonymousMemberToolRpcInput = z.infer<
  SpeakerSchemas["centerAgentAuthorizeAnonymousMemberToolRpcInputSchema"]
>;
export type CenterAgentAuthorizeAnonymousMemberToolResponse = z.infer<
  SpeakerSchemas["centerAgentAuthorizeAnonymousMemberToolResponseSchema"]
>;
export type CenterAgentToolSpeaker = z.infer<
  SpeakerSchemas["centerAgentToolSpeakerSchema"]
>;
export type CenterAgentVerifiedMemberToolSpeaker = z.infer<
  SpeakerSchemas["centerAgentVerifiedMemberToolSpeakerSchema"]
>;
