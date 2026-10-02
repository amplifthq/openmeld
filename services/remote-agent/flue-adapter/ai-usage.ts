import { getCloudflareContext } from "@flue/runtime/cloudflare";
import { createMeteredRemoteFetch } from "../agent-core/ai-usage";
import { readRemoteAgentCallbackContext } from "../agent-core/callback-context";
import { getRemoteAgentExecutionSubmissionId } from "./execution-context";
import { createRemoteAgentSqlStorage } from "./storage";

// Resolve attribution inside each invocation, never from a cached model registration.
export function createFlueMeteredFetch(input: {
  coreWorker: unknown;
  model: string;
  fetch?: typeof globalThis.fetch;
}): typeof globalThis.fetch {
  return async (url, init) => {
    const submissionId = getRemoteAgentExecutionSubmissionId();
    if (!submissionId) {
      throw new Error("Remote AI usage requires an active submission.");
    }
    const storage = createRemoteAgentSqlStorage(
      getCloudflareContext().storage.sql
    );
    const context = await readRemoteAgentCallbackContext(storage, submissionId);
    if (!context) {
      throw new Error(
        "Remote AI usage requires durable execution attribution."
      );
    }
    return createMeteredRemoteFetch({
      ...input,
      storage,
      scope: {
        organizationId: context.organizationId,
        purpose: "agent",
        agentProfileId: context.agentProfileId,
        spaceId: context.spaceId,
        taskId: context.taskId ?? null,
        dispatchId: context.dispatchId,
        attemptId: context.submissionId,
      },
    })(url, init);
  };
}
