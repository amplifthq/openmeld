export function normalizeControllerDisplayLabel(
  agentControllerRef: string | null | undefined
): string | null {
  const normalized = String(agentControllerRef ?? "").trim();
  if (!normalized) {
    return null;
  }

  const withoutBuiltinPrefix = normalized.startsWith("builtin:")
    ? normalized.slice("builtin:".length)
    : normalized;

  return withoutBuiltinPrefix.length > 0 ? withoutBuiltinPrefix : null;
}
