import {
  pluginRuntimeRequestSchema,
  pluginRuntimeResponseSchema,
} from "@openmeld/schemas";
import type { PluginRuntimeResponse } from "@openmeld/schemas/types";
import {
  type ConnectorExecutionConfig,
  listOpenConnectorActions,
  OpenConnectorActionError,
  OpenConnectorOperationPendingError,
  requireOpenConnectorAction,
  runOpenConnectorAction,
} from "./open-connector-runtime";

// Internal service-binding entrypoint. Core admits and audits the operation;
// this worker owns provider credentials and verifies the action metadata again.
export async function executePluginRuntime(
  input: unknown,
  connectorExecution: ConnectorExecutionConfig
): Promise<PluginRuntimeResponse> {
  const parsed = pluginRuntimeRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid plugin runtime request.");
  }
  const request = parsed.data;
  if (request.operation === "list") {
    return {
      status: "catalog",
      actions: await listOpenConnectorActions({
        ...request,
        connectorExecution,
      }),
    };
  }
  const action = await requireOpenConnectorAction({
    ...request,
    connectorExecution,
  });
  if ((action.effect ?? "unspecified") !== request.authorizedEffect) {
    return {
      status: "failed",
      error: "The action permissions changed. Review the action and try again.",
      providerExecutionId: null,
    };
  }
  try {
    const result = await runOpenConnectorAction({
      ...request,
      connectorExecution,
    });
    return pluginRuntimeResponseSchema.parse({
      status: "completed",
      ...result,
    });
  } catch (error) {
    if (error instanceof OpenConnectorOperationPendingError) {
      return {
        status: "pending",
        error: error.message,
        providerExecutionId: null,
      };
    }
    if (error instanceof OpenConnectorActionError) {
      return {
        status: error.outcome,
        error: error.message,
        providerExecutionId: error.providerExecutionId,
      };
    }
    // Invalid provider responses can follow a completed side effect.
    return {
      status: "outcome_unknown",
      error:
        error instanceof Error
          ? error.message
          : "The provider did not return a valid result.",
      providerExecutionId: null,
    };
  }
}
