import { z } from "zod/v4";
import { resolveBuiltinAgentControllerConversationCapability } from "./agent-controller-conversation-capability";

const BUILTIN_AGENT_CONTROLLER_REF_PREFIX = "builtin:";
const AGENT_CONTROLLER_REF_SEPARATOR = ":";
export const HOSTED_CENTER_AGENT_CONTROLLER_REF =
  "hosted:center-agent" as const;
export const HOSTED_CENTER_AGENT_CONTROLLER_REF_ID = "center-agent" as const;

export type AgentControllerRefKind =
  | "builtin"
  | "custom"
  | "hosted:center-agent";

export type AgentControllerRef = {
  kind: AgentControllerRefKind;
  id: string;
  ref: string;
};

export const agentControllerRefSchema = z
  .string()
  .transform((value, context) => {
    const parsed = parseAgentControllerRef(value);
    if (!parsed) {
      context.addIssue({
        code: "custom",
        message: "Agent Controller ref is invalid",
      });
      return z.NEVER;
    }
    return parsed.ref;
  });

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBuiltinControllerId(
  agentControllerRef: string
): string | null {
  const normalized = normalizeOptionalText(agentControllerRef);
  if (!normalized) {
    return null;
  }
  if (
    normalized.includes(":") &&
    !normalized.startsWith(BUILTIN_AGENT_CONTROLLER_REF_PREFIX)
  ) {
    return null;
  }
  const builtinId = normalized.startsWith(BUILTIN_AGENT_CONTROLLER_REF_PREFIX)
    ? normalized.slice(BUILTIN_AGENT_CONTROLLER_REF_PREFIX.length)
    : normalized;
  if (builtinId.length === 0 || builtinId.includes(":")) {
    return null;
  }
  return builtinId;
}

export function normalizeKnownBuiltinAgentControllerId(
  agentControllerRef: string
): string | null {
  const builtinId = normalizeBuiltinControllerId(agentControllerRef);
  return builtinId &&
    resolveBuiltinAgentControllerConversationCapability(builtinId)
    ? builtinId
    : null;
}

export function normalizeBuiltinAgentControllerId(
  agentControllerRef: string
): string | null {
  return normalizeBuiltinControllerId(agentControllerRef);
}

export function isExplicitBuiltinAgentControllerRef(
  agentControllerRef: string
): boolean {
  const normalized = normalizeOptionalText(agentControllerRef);
  return (
    normalized?.startsWith(BUILTIN_AGENT_CONTROLLER_REF_PREFIX) === true &&
    normalizeKnownBuiltinAgentControllerId(normalized) !== null
  );
}

export function parseAgentControllerRef(
  agentControllerRef: string | null | undefined
): AgentControllerRef | null {
  const normalized = normalizeOptionalText(agentControllerRef);
  if (!normalized) {
    return null;
  }

  if (normalized === HOSTED_CENTER_AGENT_CONTROLLER_REF) {
    return {
      kind: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      id: HOSTED_CENTER_AGENT_CONTROLLER_REF_ID,
      ref: HOSTED_CENTER_AGENT_CONTROLLER_REF,
    };
  }

  for (const kind of ["builtin", "custom"] as const) {
    const prefix = `${kind}${AGENT_CONTROLLER_REF_SEPARATOR}`;
    if (!normalized.startsWith(prefix)) {
      continue;
    }
    const id = normalized.slice(prefix.length).trim();
    if (id.length === 0 || id.includes(AGENT_CONTROLLER_REF_SEPARATOR)) {
      return null;
    }
    return {
      kind,
      id,
      ref: `${kind}${AGENT_CONTROLLER_REF_SEPARATOR}${id}`,
    };
  }

  return null;
}

export function canonicalizeAgentControllerRef(
  agentControllerRef: string | null | undefined
): string | null {
  return parseAgentControllerRef(agentControllerRef)?.ref ?? null;
}

export function buildAgentControllerRoutingKey(
  agentControllerRef: string | null | undefined
): string | null {
  return canonicalizeAgentControllerRef(agentControllerRef);
}

export function canonicalizeBuiltinAgentControllerRef(
  agentControllerRef: string
): string | null {
  const builtinId = normalizeBuiltinControllerId(agentControllerRef);
  return builtinId
    ? `${BUILTIN_AGENT_CONTROLLER_REF_PREFIX}${builtinId}`
    : null;
}

export function areBuiltinAgentControllerRefsEquivalent(
  left: string,
  right: string
): boolean {
  const parsedLeft = parseAgentControllerRef(left);
  const parsedRight = parseAgentControllerRef(right);
  if (!(parsedLeft?.kind === "builtin" && parsedRight?.kind === "builtin")) {
    return false;
  }
  return parsedLeft.ref === parsedRight.ref;
}

export function isHostedCenterAgentControllerRef(
  agentControllerRef: string | null | undefined
): boolean {
  return (
    parseAgentControllerRef(agentControllerRef)?.kind ===
    HOSTED_CENTER_AGENT_CONTROLLER_REF
  );
}
