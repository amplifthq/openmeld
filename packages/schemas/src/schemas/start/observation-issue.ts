import * as z from "zod/v4";
import {
  START_BOUNDED_ID_SCHEMA,
  START_BOUNDED_LABEL_SCHEMA,
  START_ISO_DATE_TIME_SCHEMA,
} from "./shared";

export const startObservationIssueSourceSchema = z.enum([
  "reply_readiness_snapshot",
  "device_projection",
  "profile_readiness",
  "session_control",
  "session_progress",
]);

export const startObservationIssueSchema = z.strictObject({
  source: startObservationIssueSourceSchema,
  code: START_BOUNDED_ID_SCHEMA,
  summary: START_BOUNDED_LABEL_SCHEMA,
  detail: z.union([START_BOUNDED_LABEL_SCHEMA, z.null()]),
  observedAt: START_ISO_DATE_TIME_SCHEMA,
});
