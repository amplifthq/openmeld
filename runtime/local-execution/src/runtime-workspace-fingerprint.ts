import { createHash } from "node:crypto";
import { normalize } from "node:path";

const SHA256_PREFIX = "sha256:";

function normalizeWorkspacePath(workspacePath: string): string {
  const trimmed = workspacePath.trim();
  if (!trimmed) {
    throw new Error("runtime workspace path must not be empty");
  }
  return normalize(trimmed);
}

export function buildRuntimeWorkspaceFingerprint(
  workspacePath: string
): string {
  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
  return `${SHA256_PREFIX}${createHash("sha256").update(normalizedWorkspacePath).digest("hex")}`;
}
