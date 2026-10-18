import * as z from "zod/v4";
import { resolveBuiltinAgentControllerConversationCapability } from "./agent-controller-conversation-capability";
import {
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  parseAgentControllerRef,
} from "./agent-controller-ref";

// One kind per builtin Agent Controller id, plus `hosted` for Remote Agents.
// Keep the builtin ids aligned with the builtin controller capability table.
export const HARNESS_KINDS = [
  "claude-code",
  "codex",
  "grok-build",
  "grok-bot",
  "cursor",
  "opencode",
  "antigravity",
  "openclaw",
  "hosted",
] as const;

export const harnessKindSchema = z.enum(HARNESS_KINDS);
export type HarnessKind = z.infer<typeof harnessKindSchema>;

export const HOSTED_HARNESS_KIND = "hosted" as const satisfies HarnessKind;

/**
 * Map an Agent Controller ref to the Harness that runs it. `custom`
 * controllers, unknown builtin ids, and the organization-owned Center Agent
 * have no Harness, so they return null instead of a guessed kind.
 */
export function harnessKindFromAgentControllerRef(
  agentControllerRef: string | null | undefined
): HarnessKind | null {
  const parsed = parseAgentControllerRef(agentControllerRef);
  if (!parsed) {
    return null;
  }
  if (parsed.ref === HOSTED_REMOTE_AGENT_CONTROLLER_REF) {
    return HOSTED_HARNESS_KIND;
  }
  if (
    parsed.kind !== "builtin" ||
    !resolveBuiltinAgentControllerConversationCapability(parsed.id)
  ) {
    return null;
  }
  const harnessKind = harnessKindSchema.safeParse(parsed.id);
  return harnessKind.success ? harnessKind.data : null;
}
