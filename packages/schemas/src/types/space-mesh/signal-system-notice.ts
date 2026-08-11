import type { z } from "zod/v4";

type SignalSystemNoticeDataSchema =
  typeof import("../../schemas/space-mesh/signal-system-notice")["signalSystemNoticeDataSchema"];
type SignalSystemNoticeFailureStageSchema =
  typeof import("../../schemas/space-mesh/signal-system-notice")["signalSystemNoticeFailureStageSchema"];
type SignalSystemNoticeGeneratedBySchema =
  typeof import("../../schemas/space-mesh/signal-system-notice")["signalSystemNoticeGeneratedBySchema"];
type SignalSystemNoticeSchema =
  typeof import("../../schemas/space-mesh/signal-system-notice")["signalSystemNoticeSchema"];
type SignalSystemNoticeTypeSchema =
  typeof import("../../schemas/space-mesh/signal-system-notice")["signalSystemNoticeTypeSchema"];

export type SignalSystemNoticeData = z.infer<SignalSystemNoticeDataSchema>;
export type SignalSystemNoticeFailureStage =
  z.infer<SignalSystemNoticeFailureStageSchema>;
export type SignalSystemNoticeGeneratedBy =
  z.infer<SignalSystemNoticeGeneratedBySchema>;
export type SignalSystemNotice = z.infer<SignalSystemNoticeSchema>;
export type SignalSystemNoticeType = z.infer<SignalSystemNoticeTypeSchema>;
