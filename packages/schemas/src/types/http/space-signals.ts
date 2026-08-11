import type { z } from "zod/v4";

type PostNormalMessageBodySchema =
  typeof import("../../schemas/http/space-signals")["postNormalMessageBodySchema"];
type PostNormalMessageResponseSchema =
  typeof import("../../schemas/http/space-signals")["postNormalMessageResponseSchema"];
type SpaceSignalAuthoringPolicySchema =
  typeof import("../../schemas/http/space-signals")["spaceSignalAuthoringPolicySchema"];

export type PostNormalMessageBody = z.infer<PostNormalMessageBodySchema>;
export type PostNormalMessageResponse =
  z.infer<PostNormalMessageResponseSchema>;
export type SpaceSignalAuthoringPolicy =
  z.infer<SpaceSignalAuthoringPolicySchema>;
