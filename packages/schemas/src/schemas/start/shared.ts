import { z } from "zod/v4";
import {
  replyReadinessLevelSchema,
  replyReadinessReasonCodeSchema,
} from "../daemon/reply-readiness";

export const START_ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
export const START_TRIMMED_NON_EMPTY_STRING_SCHEMA = z.string().trim().min(1);
export const START_BOUNDED_ID_SCHEMA =
  START_TRIMMED_NON_EMPTY_STRING_SCHEMA.max(256);
export const START_BOUNDED_LABEL_SCHEMA =
  START_TRIMMED_NON_EMPTY_STRING_SCHEMA.max(256);
export const START_BOUNDED_VERSION_SCHEMA =
  START_TRIMMED_NON_EMPTY_STRING_SCHEMA.max(128);
export const START_NULLABLE_COMPLETION_TIME_SCHEMA = z.union([
  START_ISO_DATE_TIME_SCHEMA,
  z.null(),
]);

export const startReplyReadinessSummarySchema = z.strictObject({
  level: replyReadinessLevelSchema,
  reasonCodes: z.array(replyReadinessReasonCodeSchema),
});

export function toStartTimestampMs(value: string): number {
  return Date.parse(value);
}
