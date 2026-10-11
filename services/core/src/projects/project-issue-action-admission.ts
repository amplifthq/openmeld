import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type {
  CenterAgentConnectorActionExecutionConnection,
  CenterAgentRecordConnectorActionOperationBody,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { readPluginAccess } from "../connectors/plugin-access";
import { preparePluginActionRequest } from "../connectors/plugin-action-requests";
import type { CoreBindings } from "../lib/bindings";
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
  const resolution = await resolveAdmittedProjectIssueAction(input.env, {
    context: input.context,
    proposedDestination: destination,
  });
  const issueRoutingDecision = projectIssueRoutingDecisionForClaim(resolution);
  if (issueRoutingDecision) {
    return { issueRoutingDecision, sourceRequestKey: input.sourceRequestKey };
  }
  if (!input.userId) {
    throw createCoreRpcHttpError({
      code: "project.issue_confirmation_required",
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
      connection,
      connectionUpdatedAtMs,
      accessRevision: access.revision,
      service: connection.service,
      actionId: operation.actionId,
      effect: "write",
      input: {
        ...resolution.destination,
        requestSignature: operation.requestSignature,
      },
    },
  });
  if (!authorization.root) {
    throw createCoreRpcHttpError({
      code: "project.issue_confirmation_required",
      status: 409,
      reason: `Open your OpenMeld Inbox to confirm the exact issue destination (request ${authorization.request.requestId}), then retry the same operation ID and unchanged input. No issue was created.`,
    });
  }
  return {
    executionGuard: authorization.executionGuard,
    sourceRequestKey: authorization.root,
  };
}
