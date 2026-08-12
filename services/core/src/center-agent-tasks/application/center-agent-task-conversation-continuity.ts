import { listCenterAgentTaskEventsBefore } from "../infrastructure/d1/center-agent-task-repo";

export type CenterAgentTaskConversationContinuityEntry = {
  authorKind: "agent" | "human" | "system";
  eventId: string;
  occurredAt: string;
  taskId: string;
  text: string;
};

export class CenterAgentTaskConversationContinuityAnchorNotFoundError extends Error {
  readonly code = "center_agent_task.continuity.trigger_not_found";

  constructor() {
    super("The exact Center Agent Task continuity trigger is unavailable.");
    this.name = "CenterAgentTaskConversationContinuityAnchorNotFoundError";
  }
}

export async function readCenterAgentTaskConversationContinuity(input: {
  db: D1Database;
  limit: number;
  organizationId: string;
  taskId: string;
  triggerEventId: string;
}): Promise<{
  entries: CenterAgentTaskConversationContinuityEntry[];
  truncated: boolean;
}> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError(
      "Center Agent Task continuity limit must be an integer from 1 to 100."
    );
  }
  const events = await listCenterAgentTaskEventsBefore({
    beforeEventId: input.triggerEventId,
    db: input.db,
    limit: input.limit + 1,
    organizationId: input.organizationId,
    taskId: input.taskId,
  });
  if (events === null) {
    throw new CenterAgentTaskConversationContinuityAnchorNotFoundError();
  }
  const truncated = events.length > input.limit;
  return {
    entries: events.slice(-input.limit).map((event) => ({
      authorKind: resolveCenterAgentTaskEventAuthorKind(event.actor),
      eventId: event.id,
      occurredAt: event.occurredAt,
      taskId: event.taskId,
      text: event.text,
    })),
    truncated,
  };
}

function resolveCenterAgentTaskEventAuthorKind(
  actor: "center_agent" | "requester" | "system"
): "agent" | "human" | "system" {
  if (actor === "requester") {
    return "human";
  }
  return actor === "center_agent" ? "agent" : "system";
}
