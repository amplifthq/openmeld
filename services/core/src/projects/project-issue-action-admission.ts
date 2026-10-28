import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type {
  CenterAgentConnectorActionExecutionConnection,
  CenterAgentRecordConnectorActionOperationBody,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { readPluginAccess } from "../connectors/plugin-access";
import {
  preparePluginActionRequest,
  preparePluginActionRequestAbsenceGuard,
} from "../connectors/plugin-action-requests";
import type { CoreBindings } from "../lib/bindings";
import { isNativeDeliveryExecutingStatus } from "../remote-agent/application/native-delivery-execution-status";
import { authorizeRemoteAgentExecutionAccess } from "../remote-agent/application/remote-agent-execution-access";
import { readRemoteAgentNativeDeliveryByDeliveryId } from "../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { createCoreRpcHttpError } from "../rpc/errors";
import { projectIssueRoutingDecisionForClaim } from "./project-issue-action-routing";
import { resolveAdmittedProjectIssueAction } from "./project-rpc";

// Routing preferences do not grant execution. Call only after the action owner
// verifies its caller and current exact connection and write permission.
export async function prepareProjectIssueActionAdmission(input: {
  db: PostgresDatabase;
  organizationId: string;
  actorProfileId: string;
  userId: string | null;
  operation: CenterAgentRecordConnectorActionOperationBody;
  existingOperation: boolean;
  env: CoreBindings;
  context: OpenMeldRequestContext;
  sourceRequestKey?: string;
  sourceSpaceId?: string | null;
  sourceNativeDeliveryId?: string | null;
  connection?: CenterAgentConnectorActionExecutionConnection;
  connectionUpdatedAtMs?: number | null;
  personalExecution: boolean;
}) {
  const { operation, connection, connectionUpdatedAtMs } = input;
  if (
    operation.outcome !== "attempted" ||
    ![
      "github.create_issue",
      "openmeld.github.create_issue_batch",
      "linear.create_linear_issue",
    ].includes(operation.actionId)
  ) {
    return { sourceRequestKey: input.sourceRequestKey };
  }
  const destination = operation.issueDestination;
  const provider =
    operation.actionId === "linear.create_linear_issue" ? "linear" : "github";
  if (operation.service !== provider || operation.effect !== "write") {
    throw createCoreRpcHttpError({
      code: "project.issue_target_required",
      status: 409,
      reason:
        "This issue action requires its complete structured target and current connection. Update the action caller before retrying.",
    });
  }
  if (input.existingOperation) {
    return { sourceRequestKey: input.sourceRequestKey };
  }
  if (
    !destination ||
    destination.provider !== provider ||
    !connection ||
    connectionUpdatedAtMs == null
  ) {
    throw createCoreRpcHttpError({
      code: "project.issue_target_required",
      status: 409,
      reason:
        "The complete issue destination must match its provider before a new operation is accepted.",
    });
  }
  const explicitIssueRequest = await authorizeExplicitIssueRequest(input);
  const requestAbsenceGuard = input.userId
    ? await preparePluginActionRequestAbsenceGuard({
        db: input.db,
        organizationId: input.organizationId,
        userId: input.userId,
        actorProfileId: input.actorProfileId,
        operationId: operation.operationId,
      })
    : undefined;
  // Once a request exists, neither a new declaration nor a Project edit can
  // replace its decision. Fresh direct/default claims guard absence atomically.
  if (requestAbsenceGuard !== null) {
    if (explicitIssueRequest) {
      return {
        executionGuard: requestAbsenceGuard,
        sourceRequestKey: input.sourceRequestKey,
      };
    }
    const resolution = await resolveAdmittedProjectIssueAction(input.env, {
      context: input.context,
      proposedDestination: destination,
    });
    const issueRoutingDecision =
      projectIssueRoutingDecisionForClaim(resolution);
    if (issueRoutingDecision) {
      return {
        issueRoutingDecision,
        executionGuard: requestAbsenceGuard,
        sourceRequestKey: input.sourceRequestKey,
      };
    }
  }
  if (!input.userId) {
    throw createCoreRpcHttpError({
      code: "project.issue_confirmation_unavailable",
      status: 409,
      reason:
        "This issue needs an interactive requester to confirm its exact destination in OpenMeld.",
    });
  }
  const access = await readPluginAccess({
    db: input.db,
    organizationId: input.organizationId,
    connectionName: connection.connectionName,
    activeOnly: true,
  });
  const authorization = await preparePluginActionRequest({
    db: input.db,
    intent: {
      purpose: "issue_destination",
      consumer: input.personalExecution ? "remote_agent" : "center_agent",
      organizationId: input.organizationId,
      userId: input.userId,
      actorProfileId: input.actorProfileId,
      operationId: operation.operationId,
      sourceRequestKey: input.sourceRequestKey ?? null,
      sourceSpaceId: input.sourceSpaceId,
      sourceNativeDeliveryId: input.sourceNativeDeliveryId,
      connection,
      connectionUpdatedAtMs,
      accessRevision: access.revision,
      service: connection.service,
      actionId: operation.actionId,
      effect: "write",
      input: {
        ...destination,
        requestSignature: operation.requestSignature,
      },
    },
  });
  if (!authorization.root) {
    if (authorization.request.state !== "pending") {
      throw createCoreRpcHttpError({
        code: "project.issue_confirmation_unavailable",
        status: 409,
        reason: `This issue destination request is ${authorization.request.state}. It cannot be approved or retried. No issue was created.`,
      });
    }
    throw createCoreRpcHttpError({
      code: "project.issue_confirmation_required",
      status: 409,
      reason: `Confirm the exact issue destination in the originating conversation or your OpenMeld Inbox (request ${authorization.request.requestId}). Approval continues the original request. No issue was created.`,
    });
  }
  return {
    executionGuard: authorization.executionGuard,
    sourceRequestKey: authorization.root,
  };
}

async function authorizeExplicitIssueRequest(
  input: Parameters<typeof prepareProjectIssueActionAdmission>[0]
): Promise<boolean> {
  if (
    input.operation.issueDestinationAuthority !== "explicit_request" ||
    !input.userId ||
    !input.sourceNativeDeliveryId
  ) {
    return false;
  }
  const delivery = await readRemoteAgentNativeDeliveryByDeliveryId({
    db: input.db,
    deliveryId: input.sourceNativeDeliveryId,
  });
  const sender = (
    delivery?.executionRecoverySubmitRequest ?? delivery?.workerSubmitRequest
  )?.turnEnvelope.sender;
  if (
    !(delivery && isNativeDeliveryExecutingStatus(delivery.status)) ||
    delivery.organizationId !== input.organizationId ||
    delivery.profileId !== input.actorProfileId ||
    delivery.submissionId !== input.context.agentControllerConversationId ||
    sender?.kind !== "member" ||
    !sender.verified ||
    sender.ownerUserId !== input.userId ||
    "kind" in input.operation.speakerMember ||
    sender.id !== input.operation.speakerMember.memberId
  ) {
    return false;
  }
  // Intent is interpreted semantically by the Agent. Core verifies the request
  // identity and existing decisions; Project metadata supplies neither fact.
  // Explicit destinations skip Project routing, never current execution access.
  await authorizeRemoteAgentExecutionAccess(input.env, {
    context: input.context,
    submissionId: input.context.agentControllerConversationId,
    effect: "write",
  });
  return true;
}
