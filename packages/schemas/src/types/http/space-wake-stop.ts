import type { z } from "zod/v4";

type SpaceWakeStopSelectorSchema =
  typeof import("../../schemas/http/space-wake-stop")["spaceWakeStopSelectorSchema"];
type PostSpaceWakeStopBodySchema =
  typeof import("../../schemas/http/space-wake-stop")["postSpaceWakeStopBodySchema"];
type PostSpaceWakeStopInputSchema =
  typeof import("../../schemas/http/space-wake-stop")["postSpaceWakeStopInputSchema"];
type PostSpaceWakeStopResponseSchema =
  typeof import("../../schemas/http/space-wake-stop")["postSpaceWakeStopResponseSchema"];

export type SpaceWakeStopSelector = z.infer<SpaceWakeStopSelectorSchema>;
export type PostSpaceWakeStopBody = z.infer<PostSpaceWakeStopBodySchema>;
export type PostSpaceWakeStopInput = z.infer<PostSpaceWakeStopInputSchema>;
export type PostSpaceWakeStopResponse =
  z.infer<PostSpaceWakeStopResponseSchema>;
