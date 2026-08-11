import type { z } from "zod/v4";

type SignalStatusGeneratedBySchema =
  typeof import("../../schemas/space-mesh/signal-status")["signalStatusGeneratedBySchema"];
type SignalStatusDataSchema =
  typeof import("../../schemas/space-mesh/signal-status")["signalStatusDataSchema"];
type SignalStatusSchema =
  typeof import("../../schemas/space-mesh/signal-status")["signalStatusSchema"];
type SpaceStatusSchema =
  typeof import("../../schemas/space-mesh/signal-status")["spaceStatusSchema"];

export type SignalStatusGeneratedBy = z.infer<SignalStatusGeneratedBySchema>;
export type SignalStatusData = z.infer<SignalStatusDataSchema>;
export type SignalStatus = z.infer<SignalStatusSchema>;
export type SpaceStatus = z.infer<SpaceStatusSchema>;
