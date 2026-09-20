import type { z } from "zod/v4";
export type SpaceFilePinMutation = z.infer<
  typeof import("../../schemas/http/space-message-pins").spaceFilePinMutationSchema
>;
export type SpaceFilePinsResponse = z.infer<
  typeof import("../../schemas/http/space-message-pins").spaceFilePinsResponseSchema
>;

export type SpaceMessagePinMutation = z.infer<
  typeof import("../../schemas/http/space-message-pins").spaceMessagePinMutationSchema
>;
export type SpaceMessagePinsResponse = z.infer<
  typeof import("../../schemas/http/space-message-pins").spaceMessagePinsResponseSchema
>;
