import {
  type AgentContextLookupKeyInput,
  type AgentContextScopeInput,
  isAgentContextCompatibleWithLookupKeyInput,
  isAgentContextCompatibleWithScopeInput,
  listCompatibleAgentContextLookupKeys,
  type OpenMeldDaemonAgentContextState,
  type OpenMeldDaemonLedgerState,
  resolveAgentContextByLookupKey,
  resolveConversationExecutionStateByLookupKey,
} from "@openmeld/local-execution";
import type { ConversationExecutionState } from "@openmeld/schemas/types";

export type CompatibleAgentContextMatch = {
  agentContext: OpenMeldDaemonAgentContextState;
  agentContextLookupKey: string;
};

export type ScopedConversationExecutionStateMatch = {
  agentContext: OpenMeldDaemonAgentContextState;
  agentContextLookupKey: string;
  executionState: ConversationExecutionState;
};

const listOrderedCompatibleLookupKeys = (input: {
  key: AgentContextLookupKeyInput;
  preferredLookupKey?: string | null;
}): string[] => {
  const lookupKeys = listCompatibleAgentContextLookupKeys(input.key);
  if (!input.preferredLookupKey) {
    return lookupKeys;
  }
  return [input.preferredLookupKey, ...lookupKeys].filter(
    (lookupKey, index, values) => values.indexOf(lookupKey) === index
  );
};

const listCompatibleAgentContextMatches = (input: {
  key: AgentContextLookupKeyInput;
  state: OpenMeldDaemonLedgerState;
}): CompatibleAgentContextMatch[] =>
  Object.values(input.state.agentContextByLookupKey)
    .filter(
      (agentContext) =>
        isAgentContextCompatibleWithLookupKeyInput({
          agentContext,
          key: input.key,
        }) &&
        listCompatibleAgentContextLookupKeys({
          ...input.key,
          spaceId: agentContext.spaceId,
        }).includes(agentContext.agentContextLookupKey)
    )
    .sort((left, right) => {
      if (left.updatedAtMs !== right.updatedAtMs) {
        return right.updatedAtMs - left.updatedAtMs;
      }
      if (left.createdAtMs !== right.createdAtMs) {
        return right.createdAtMs - left.createdAtMs;
      }
      return right.agentContextLookupKey.localeCompare(
        left.agentContextLookupKey
      );
    })
    .map((agentContext) => ({
      agentContext,
      agentContextLookupKey: agentContext.agentContextLookupKey,
    }));

export const resolveCompatibleAgentContextMatch = (input: {
  key: AgentContextLookupKeyInput;
  state: OpenMeldDaemonLedgerState;
}): CompatibleAgentContextMatch | null => {
  for (const agentContextLookupKey of listCompatibleAgentContextLookupKeys(
    input.key
  )) {
    const agentContext = resolveAgentContextByLookupKey({
      agentContextLookupKey,
      state: input.state,
    });
    if (
      !(
        agentContext &&
        isAgentContextCompatibleWithLookupKeyInput({
          agentContext,
          key: input.key,
        })
      )
    ) {
      continue;
    }
    return {
      agentContext,
      agentContextLookupKey,
    };
  }
  return listCompatibleAgentContextMatches(input)[0] ?? null;
};

export const resolveCompatibleConversationExecutionState = (input: {
  key: AgentContextLookupKeyInput;
  preferredLookupKey?: string | null;
  state: OpenMeldDaemonLedgerState;
}): ConversationExecutionState | null => {
  for (const agentContextLookupKey of listOrderedCompatibleLookupKeys(input)) {
    const agentContext = resolveAgentContextByLookupKey({
      agentContextLookupKey,
      state: input.state,
    });
    if (
      agentContext &&
      !isAgentContextCompatibleWithLookupKeyInput({
        agentContext,
        key: input.key,
      })
    ) {
      continue;
    }
    const executionState = resolveConversationExecutionStateByLookupKey({
      agentContextLookupKey,
      state: input.state,
    });
    if (executionState) {
      return executionState;
    }
  }
  for (const match of listCompatibleAgentContextMatches(input)) {
    const executionState = resolveConversationExecutionStateByLookupKey({
      agentContextLookupKey: match.agentContextLookupKey,
      state: input.state,
    });
    if (executionState) {
      return executionState;
    }
  }
  return null;
};

export const resolveLatestScopedConversationExecutionState = (input: {
  scope: AgentContextScopeInput;
  state: OpenMeldDaemonLedgerState;
}): ScopedConversationExecutionStateMatch | null => {
  const scopedAgentContexts = Object.values(input.state.agentContextByLookupKey)
    .filter((agentContext) =>
      isAgentContextCompatibleWithScopeInput({
        agentContext,
        scope: input.scope,
      })
    )
    .sort((left, right) => {
      if (left.updatedAtMs !== right.updatedAtMs) {
        return right.updatedAtMs - left.updatedAtMs;
      }
      if (left.createdAtMs !== right.createdAtMs) {
        return right.createdAtMs - left.createdAtMs;
      }
      return right.agentContextLookupKey.localeCompare(
        left.agentContextLookupKey
      );
    });

  for (const agentContext of scopedAgentContexts) {
    const executionState = resolveConversationExecutionStateByLookupKey({
      agentContextLookupKey: agentContext.agentContextLookupKey,
      state: input.state,
    });
    if (!executionState) {
      continue;
    }
    return {
      agentContext,
      agentContextLookupKey: agentContext.agentContextLookupKey,
      executionState,
    };
  }

  return null;
};
