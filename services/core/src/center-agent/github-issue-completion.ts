import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { spaceTaskGitHubIssueOperationId } from "@openmeld/schemas";
import type { CenterAgentRecordConnectorActionOperationBody } from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError, readCoreRpcHttpStatus } from "../rpc/errors";
import { resolveSpaceStub } from "../rpc/space-ref";
import { readSafeRpcFailureReasonCode } from "../shared/rpc/rpc-json";
import { listActiveSpaceTaskGitHubIssueLinks } from "../space/infrastructure/postgresql/space-task-github-issue-link-repo";
import type { CenterAgentConnectorActionOperationRecord } from "./connector-action-operation-repository";

/** Only the trusted connector completion adapter supplies provider evidence. */
export async function verifyGitHubIssueCompletion(
  request: CenterAgentRecordConnectorActionOperationBody
) {
  const completion = request.githubIssueCompletion;
  if (!completion) {
    return undefined;
  }
  const { actionInput, githubActor, observation } = completion;
  const signature = await digestCanonicalJson({
    actionId: request.actionId,
    connectionName: request.connectionName,
    githubActor,
    input: actionInput,
    service: request.service,
  });
  if (
    signature !== request.requestSignature ||
    actionInput.owner !== observation.owner ||
    actionInput.repo !== observation.repo ||
    actionInput.issueNumber !== observation.number
  ) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "github.issue_evidence_mismatch",
      reason: "The GitHub issue result does not match the recorded operation.",
    });
  }
  return observation;
}

/** Uses the frozen operation and original attempted provenance, never a new caller's Space. */
export async function syncCompletedGitHubIssue(input: {
  env: CoreBindings;
  db: PostgresDatabase;
  operation: CenterAgentConnectorActionOperationRecord;
  sourceSpaceId: string | null;
}) {
  const { operation } = input;
  const observation = operation.githubIssueObservation;
  if (
    operation.status !== "completed" ||
    !observation ||
    !input.sourceSpaceId
  ) {
    return undefined;
  }
  try {
    const links = await listActiveSpaceTaskGitHubIssueLinks({
      db: input.db,
      ...observation,
    });
    const closedTaskIds: string[] = [];
    for (const link of links) {
      if (
        link.organizationId !== operation.organizationId ||
        link.spaceId !== input.sourceSpaceId
      ) {
        continue;
      }
      const stub = resolveSpaceStub(input.env.OPENMELD_SPACES, link.spaceId);
      if (!stub) {
        throw new Error(
          "Space is unavailable for GitHub result synchronization."
        );
      }
      const result = await stub.rpcApplyGitHubIssueObservation({
        identity: observation,
        spaceId: link.spaceId,
        taskId: link.taskId,
        observedAt: observation.updatedAt,
        observedState: observation.state,
        observedStateReason: observation.stateReason,
        observeOperationId: spaceTaskGitHubIssueOperationId(
          observation.state === "closed" ? "observe-closed" : "observe-open",
          observation,
          link.taskId,
          operation.id
        ),
      });
      if (result.task?.phase === "done" || result.task?.phase === "canceled") {
        closedTaskIds.push(result.task.taskId);
      }
    }
    return { status: "settled" as const, closedTaskIds };
  } catch (error) {
    // The provider completion is already durable. Retrying the same operation
    // only repairs this projection and must not grant another provider write.
    console.error("[github.issue_task_sync_pending]", {
      operationId: operation.operationId,
      status: readCoreRpcHttpStatus(error),
      reasonCode: readSafeRpcFailureReasonCode(error),
    });
    return { status: "pending" as const, closedTaskIds: [] };
  }
}
