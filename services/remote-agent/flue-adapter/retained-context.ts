import type { CompactionConfig } from "@flue/runtime";
import { remoteAgentReadToolResultResponseSchema } from "@openmeld/schemas";
import { literal, looseObject, number, string } from "zod/v4";
import type {
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import { createRemoteAgentReadToolResultDefinition } from "./retained-tool-results";

const completedPreview = looseObject({
  toolName: string(),
  toolExecution: literal("returned"),
  resultMetadata: looseObject({ status: literal("completed") }),
  presentation: looseObject({
    kind: literal("partial"),
    continuation: looseObject({
      tool: literal("openmeld_read_tool_result"),
      resultId: string().regex(/^[a-f0-9]{64}$/u),
      expiresAtMs: number(),
    }),
  }),
  resultPreview: looseObject({ format: literal("json_excerpts") }),
});

/** Called only by Flue under context pressure, outside its protected recent tail.
 * Originals stay in Flue; this owner only authorizes recoverable display reduction.
 */
export function createRetainedToolResultReducer(input: {
  storage: RemoteAgentStorage;
  submissionId: string;
  coreWorker?: RemoteAgentCoreWorkerBinding;
}): NonNullable<CompactionConfig["reduceToolResultPreviews"]> {
  const reader = createRemoteAgentReadToolResultDefinition(input);
  return async (results, signal) => {
    const candidates = results.flatMap((result) => {
      if (
        result.isError ||
        result.content.length !== 1 ||
        result.content[0]?.type !== "text"
      ) {
        return [];
      }
      let value: unknown;
      try {
        value = JSON.parse(result.content[0].text);
      } catch {
        return [];
      }
      const parsed = completedPreview.safeParse(value);
      if (!parsed.success || parsed.data.toolName !== result.toolName) {
        return [];
      }
      const metadata = parsed.data.resultMetadata;
      if (
        metadata.success === false ||
        metadata.errorCode ||
        metadata.error ||
        (typeof metadata.exitCode === "number" && metadata.exitCode !== 0)
      ) {
        return [];
      }
      return [{ result, value: parsed.data }];
    });
    const replacements = new Map<string, string>();
    if (!candidates.length) {
      return replacements;
    }
    signal?.throwIfAborted();
    // The existing listing rechecks current execution and source permissions.
    // It does not expose chunks or create an index, lease, or retention extension.
    const listing = remoteAgentReadToolResultResponseSchema.parse(
      await reader.execute({}, { signal })
    );
    if (listing.kind !== "list") {
      throw new Error("Expected retained-result listing");
    }
    const available = new Map(
      listing.results.map((result) => [result.resultId, result])
    );
    signal?.throwIfAborted();
    for (const { result, value } of candidates) {
      const reference = value.presentation.continuation;
      const retained = available.get(reference.resultId);
      if (
        !retained ||
        retained.toolName !== result.toolName ||
        retained.expiresAtMs <= Date.now() ||
        reference.expiresAtMs <= Date.now()
      ) {
        continue;
      }
      const { resultPreview: _preview, ...receipt } = value;
      replacements.set(result.toolCallId, JSON.stringify(receipt));
    }
    return replacements;
  };
}
