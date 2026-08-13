import {
  CENTER_AGENT_ORGANIZATION_UNAVAILABLE_PUBLIC_COPY,
  CENTER_AGENT_TEMPORARILY_UNAVAILABLE_PUBLIC_COPY,
} from "@openmeld/schemas";
import type { CoreBindings } from "../../lib/bindings";

export type RemoteAgentRuntimeAvailability =
  | { ok: true }
  | {
      ok: false;
      code:
        | "remote_agent.runtime_disabled"
        | "remote_agent.organization_blocked";
      message: string;
    };

export function resolveRemoteAgentRuntimeAvailability(input: {
  env: CoreBindings;
  organizationId: string;
}): RemoteAgentRuntimeAvailability {
  if (
    String(input.env.OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED ?? "") !== "true"
  ) {
    return {
      ok: false,
      code: "remote_agent.runtime_disabled",
      message: CENTER_AGENT_TEMPORARILY_UNAVAILABLE_PUBLIC_COPY,
    };
  }

  const blockedOrganizationIds = parseBlockedOrganizationIds(
    input.env.OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS
  );
  if (blockedOrganizationIds.has(input.organizationId)) {
    return {
      ok: false,
      code: "remote_agent.organization_blocked",
      message: CENTER_AGENT_ORGANIZATION_UNAVAILABLE_PUBLIC_COPY,
    };
  }

  return { ok: true };
}

function parseBlockedOrganizationIds(value: string | undefined): Set<string> {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  );
}
