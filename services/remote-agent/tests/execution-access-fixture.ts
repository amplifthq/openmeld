import {
  remoteAgentExecutionAccessRequestSchema,
  remoteAgentExecutionAccessResponseSchema,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import type { RemoteAgentCallbackContext } from "../agent-core/callback-context";

/** Models the public Core response contract; authorization failures are injected by the test. */
export function executionAccessFixture(context: RemoteAgentCallbackContext) {
  return async (value: unknown) => {
    const request = remoteAgentExecutionAccessRequestSchema.parse(value);
    if (request.submissionId !== context.submissionId) {
      throw new Error("wrong fixture execution");
    }
    return await Promise.resolve(
      remoteAgentExecutionAccessResponseSchema.parse({
        submissionId: context.submissionId,
        scope: resolveRemoteAgentExecutionScope(context),
      })
    );
  };
}
