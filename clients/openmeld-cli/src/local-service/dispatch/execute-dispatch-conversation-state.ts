import {
  removeConversationExecutionState,
  upsertConversationExecutionState,
} from "@openmeld/local-execution";
import type { ConversationExecutionState } from "@openmeld/schemas/types";

export function upsertConversationExecutionStateForLookupKey(input: {
  executionState: ConversationExecutionState;
  replacedLookupKey?: string | null;
  state: Parameters<typeof upsertConversationExecutionState>[0]["state"];
  targetLookupKey: string;
}) {
  let nextState = input.state;
  const staleLookupKeys = new Set<string>();
  if (input.executionState.agentContextLookupKey !== input.targetLookupKey) {
    staleLookupKeys.add(input.executionState.agentContextLookupKey);
  }
  if (
    input.replacedLookupKey &&
    input.replacedLookupKey !== input.targetLookupKey
  ) {
    staleLookupKeys.add(input.replacedLookupKey);
  }
  for (const agentContextLookupKey of staleLookupKeys) {
    nextState = removeConversationExecutionState({
      agentContextLookupKey,
      state: nextState,
    });
  }
  return upsertConversationExecutionState({
    state: nextState,
    executionState: {
      ...input.executionState,
      agentContextLookupKey: input.targetLookupKey,
    },
  });
}
