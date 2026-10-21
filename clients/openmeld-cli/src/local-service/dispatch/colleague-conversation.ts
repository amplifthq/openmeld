import { createHash } from "node:crypto";
import type { ParsedDispatchTask } from "../core/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A colleague's Wake on a harness without Execution Contexts. Core decides
 * it from the request chain root and marks the delivery; this Service then
 * neither resumes nor records the Binding conversation or the Profile's
 * shared ledger conversation (member-agent-program.md §4.3).
 */
export function usesSeparateColleagueConversation(
  task: Pick<ParsedDispatchTask, "separateRequesterConversation">
): boolean {
  return task.separateRequesterConversation === true;
}

/**
 * The colleague Wake's own ledger scope, derived from its dispatch so every
 * attempt of the Wake shares it and no other Wake ever reads it. The ledger
 * accepts only UUIDs here.
 */
export function resolveColleagueLedgerScopeId(
  task: Pick<ParsedDispatchTask, "dispatchId" | "separateRequesterConversation">
): string | undefined {
  if (!usesSeparateColleagueConversation(task)) {
    return undefined;
  }
  if (UUID_PATTERN.test(task.dispatchId)) {
    return task.dispatchId.toLowerCase();
  }
  const hex = createHash("sha256")
    .update(`colleague-wake:${task.dispatchId}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The Binding conversation to resume; a colleague's Wake never resumes it. */
export function resolveDispatchBindingConversationId(
  task: Pick<
    ParsedDispatchTask,
    "agentControllerConversationId" | "separateRequesterConversation"
  >
): string | null {
  return usesSeparateColleagueConversation(task)
    ? null
    : task.agentControllerConversationId;
}
