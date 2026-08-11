import type { FlueObservation } from "@flue/runtime";
import {
  getRemoteAgentExecutionSubmissionId,
  runWithRemoteAgentSubmissionExecution,
} from "./execution-context";

type CenterAgentObservationDispatcherOptions = {
  handle: (event: FlueObservation) => Promise<void>;
  scheduleBackground: (task: Promise<void>) => void;
};

export function createCenterAgentObservationDispatcher(
  options: CenterAgentObservationDispatcherOptions
): (event: FlueObservation) => Promise<void> {
  const tailByAgentInstance = new Map<string, Promise<void>>();

  return (event) => {
    const executionSubmissionId = getRemoteAgentExecutionSubmissionId();
    const ownerKey = resolveObservationOwnerKey(event, executionSubmissionId);
    const previous = tailByAgentInstance.get(ownerKey) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        if (!executionSubmissionId) {
          await options.handle(event);
          return;
        }
        await runWithRemoteAgentSubmissionExecution(
          executionSubmissionId,
          async () => await options.handle(event)
        );
      });
    const tracked = current.finally(() => {
      if (tailByAgentInstance.get(ownerKey) === tracked) {
        tailByAgentInstance.delete(ownerKey);
      }
    });
    tailByAgentInstance.set(ownerKey, tracked);
    options.scheduleBackground(tracked.catch(() => undefined));
    return tracked;
  };
}

function resolveObservationOwnerKey(
  event: FlueObservation,
  executionSubmissionId: string | null
): string {
  const instanceId =
    "instanceId" in event && typeof event.instanceId === "string"
      ? event.instanceId
      : null;
  if (instanceId) {
    return `agent:${event.agentName ?? "unknown"}:${instanceId}`;
  }
  const runId =
    "runId" in event && typeof event.runId === "string" ? event.runId : null;
  if (runId) {
    return `run:${event.agentName ?? "unknown"}:${runId}`;
  }
  if (executionSubmissionId) {
    return `submission:${executionSubmissionId}`;
  }
  if (
    typeof event.submissionId === "string" &&
    event.submissionId.trim().length > 0
  ) {
    return `submission:${event.submissionId}`;
  }
  return `agent:${event.agentName ?? "unknown"}`;
}
