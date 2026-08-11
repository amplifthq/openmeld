import {
  readActiveCenterAgentTaskStopIntentByDeliveryId,
  readCenterAgentTaskAttemptByTaskHandle,
} from "../infrastructure/d1/center-agent-task-repo";

export type CenterAgentTaskNativeDeliveryStopIntent = {
  attemptGeneration: number;
  eventId: string;
  taskId: string;
};

export type CenterAgentTaskNativeDeliveryOwner = {
  taskId: string;
};

/** Stable Task-owned read contract for native-delivery ownership. */
export async function readCenterAgentTaskNativeDeliveryOwner(input: {
  db: D1Database;
  deliveryId: string;
  organizationId: string;
}): Promise<CenterAgentTaskNativeDeliveryOwner | null> {
  const attempt = await readCenterAgentTaskAttemptByTaskHandle({
    db: input.db,
    organizationId: input.organizationId,
    taskHandle: {
      deliveryId: input.deliveryId,
      kind: "native_delivery",
      v: 1,
    },
  });
  return attempt ? { taskId: attempt.taskId } : null;
}

/** Stable Task-owned read contract for native-delivery cancellation. */
export async function readCenterAgentTaskNativeDeliveryStopIntent(input: {
  db: D1Database;
  deliveryId: string;
}): Promise<CenterAgentTaskNativeDeliveryStopIntent | null> {
  return await readActiveCenterAgentTaskStopIntentByDeliveryId(input);
}
