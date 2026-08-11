import type {
  OpenMeldDaemonTaskResultEnvelope,
  OpenMeldDaemonTaskResultPayload,
} from "@openmeld/schemas";
import {
  OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
  openMeldDaemonTaskResultEnvelopeWriteSchema,
} from "@openmeld/schemas";

export const buildTaskResultEnvelope = (
  payload: OpenMeldDaemonTaskResultPayload
): OpenMeldDaemonTaskResultEnvelope => {
  const parsed = openMeldDaemonTaskResultEnvelopeWriteSchema.safeParse({
    v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
    code: "service.task_result",
    payload,
  });
  if (!parsed.success) {
    throw new Error("invalid daemon task result envelope");
  }
  return parsed.data;
};
