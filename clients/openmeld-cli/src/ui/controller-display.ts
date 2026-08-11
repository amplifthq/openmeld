import { parseAgentControllerRef } from "@openmeld/schemas";
import { listBuiltinAgentsRegistryEntries } from "../agents/registry-source";
import { sanitizeTerminalDisplayText } from "./terminal-safe-text";

const MULTI_SPACE_PATTERN = /\s+/g;

export function resolveControllerDisplayName(
  agentControllerRef: string | null | undefined
): string {
  const normalized = sanitizeTerminalDisplayText(
    agentControllerRef,
    "single-line"
  )
    .trim()
    .replace(MULTI_SPACE_PATTERN, " ");
  if (!normalized) {
    return "";
  }
  return normalized.startsWith("builtin:")
    ? normalized.slice("builtin:".length)
    : normalized;
}

export function resolveHumanControllerDisplayName(input: {
  agentControllerRef: string | null | undefined;
}): string {
  const normalized = resolveControllerDisplayName(input.agentControllerRef);
  if (!normalized) {
    return "";
  }

  const builtinAgentId = resolveBuiltinAgentId(input);
  if (!builtinAgentId) {
    return normalized;
  }

  const builtinEntry = listBuiltinAgentsRegistryEntries().find(
    (entry) => entry.id === builtinAgentId
  );
  return builtinEntry?.displayName ?? normalized;
}

function resolveBuiltinAgentId(input: {
  agentControllerRef: string | null | undefined;
}): string | null {
  const parsed = parseAgentControllerRef(input.agentControllerRef);
  return parsed?.kind === "builtin" ? parsed.id : null;
}
