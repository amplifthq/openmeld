import {
  type RemoteAgentResultSource,
  remoteAgentExecutionScopeKey,
  remoteAgentResultSourcesSchema,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import { digestCanonicalJson } from "@openmeld/utils";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentStorage,
} from "../agent-core/callback-context";

type SourceInput = {
  context: RemoteAgentCallbackContext;
  storage: RemoteAgentStorage;
};
async function sourceKey(input: SourceInput) {
  return `computer-data-sources:v1:${await digestCanonicalJson(remoteAgentExecutionScopeKey(resolveRemoteAgentExecutionScope(input.context)))}`;
}

/** Data provenance, not an authorization grant. Keep it with the durable
 * Computer, not the shorter Git-operation TTL: expiry must not unlock bytes. */
export async function readComputerDataSources(input: SourceInput) {
  return remoteAgentResultSourcesSchema.parse(
    (await input.storage.get(await sourceKey(input))) ?? []
  );
}

export async function recordComputerDataSource(
  input: SourceInput & { source: RemoteAgentResultSource }
) {
  const key = await sourceKey(input);
  await input.storage.putIfAbsent(key, []);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const previous = remoteAgentResultSourcesSchema.parse(
      await input.storage.get(key)
    );
    if (
      previous.some(
        (source) =>
          source.connectionName === input.source.connectionName &&
          source.connectionUpdatedAtMs === input.source.connectionUpdatedAtMs &&
          source.service === input.source.service
      )
    ) {
      return;
    }
    const next = remoteAgentResultSourcesSchema.safeParse([
      ...previous,
      input.source,
    ]);
    if (!next.success) {
      throw new Error(
        "remote_agent.computer_source_limit: Start a fresh conversation before adding another data source."
      );
    }
    if (await input.storage.compareAndSet(key, previous, next.data)) {
      return;
    }
  }
  throw new Error(
    "remote_agent.computer_sources_changed: Retry after concurrent file imports finish."
  );
}
