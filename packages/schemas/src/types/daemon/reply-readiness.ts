import type { z } from "zod/v4";

type ReplyReadinessLevelSchema =
  typeof import("../../schemas/daemon/reply-readiness")["replyReadinessLevelSchema"];
type ReplyReadinessReasonCodeSchema =
  typeof import("../../schemas/daemon/reply-readiness")["replyReadinessReasonCodeSchema"];

export type ReplyReadinessLevel = z.infer<ReplyReadinessLevelSchema>;
export type ReplyReadinessReasonCode = z.infer<ReplyReadinessReasonCodeSchema>;
