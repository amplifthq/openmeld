import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { connectorActionVerificationEvidenceSchema } from "@openmeld/schemas";
import type { CenterAgentConnectorActionExecutionConnection } from "@openmeld/schemas/types";
import {
  type CenterAgentConnectorActionOperationScope,
  readCenterAgentConnectorActionOperationForRecovery,
} from "../center-agent/connector-action-operation-repository";
import { createCoreRpcHttpError } from "../rpc/errors";

/** Associates read evidence with an original operation; never finalizes it. */
export async function requireConnectorVerificationRead(input: {
  db: PostgresDatabase;
  scope: CenterAgentConnectorActionOperationScope;
  reference: { operationId: string; actionId: string } | undefined;
  effect: string | undefined;
  connection: CenterAgentConnectorActionExecutionConnection | undefined;
  connectionUpdatedAtMs: number | null | undefined;
}) {
  if (!input.reference) {
    return undefined;
  }
  const invalid = () =>
    createCoreRpcHttpError({
      status: 409,
      code: "plugin.verification_scope_mismatch",
      reason:
        "Verification must use a read action with the original operation's unchanged account.",
    });
  if (
    input.effect !== "read" ||
    !input.connection ||
    input.reference.operationId === input.scope.operationId
  ) {
    throw invalid();
  }
  const operation = await readCenterAgentConnectorActionOperationForRecovery({
    db: input.db,
    scope: { ...input.scope, operationId: input.reference.operationId },
    actionId: input.reference.actionId,
    service: input.connection.service,
  });
  const original = operation?.executionConnection;
  if (
    !(operation && original) ||
    operation.connectionUpdatedAtMs === null ||
    operation.connectionUpdatedAtMs !== input.connectionUpdatedAtMs ||
    original.connectionName !== input.connection.connectionName ||
    original.ownerUserId !== input.connection.ownerUserId ||
    original.scope !== input.connection.scope
  ) {
    throw invalid();
  }
  return connectorActionVerificationEvidenceSchema.parse({
    operationId: operation.operationId,
    actionId: operation.actionId,
    requestSignature: operation.requestSignature,
    status: operation.status,
    connection: original,
    interpretation: "read_evidence_only",
  });
}
