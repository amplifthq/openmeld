import { connectorConnectionScopeAllowed } from "@openmeld/schemas";
import type { ConnectorConnectionScope } from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../rpc/errors";

export function requirePluginConnectionScope(
  service: string,
  scope: ConnectorConnectionScope
): void {
  if (!connectorConnectionScopeAllowed(service, scope)) {
    throw createCoreRpcHttpError({
      code: "plugin.connection_scope_forbidden",
      reason:
        "This Plugin is personal-only. Connect it under Personal and choose which Agents may use your account.",
      status: 403,
    });
  }
}
