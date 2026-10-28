import { centerAgentWorkTargetResponseSchema } from "@openmeld/schemas";
import type { RemoteAgentCallbackContext } from "../../agent-core/callback-context";

/** A Human has explicitly selected this repository before the tested action. */
export function selectedRepositoryWorkTarget(
  context: RemoteAgentCallbackContext,
  repository: { owner: string; repo: string }
) {
  return centerAgentWorkTargetResponseSchema.parse({
    selectionRequired: false,
    record: {
      target: {
        requestGoal: "Publish the tested repository change",
        codeRepositories: [repository],
        issueDestinations: [],
      },
      revision: 1,
      sourceSignalId: context.triggerMessageId,
      sourceRevision: 0,
      sourceProfileId: "22222222-2222-4222-8222-222222222222",
      selectionSignalId: context.triggerMessageId,
      selectionRevision: 0,
      selectedByProfileId: "22222222-2222-4222-8222-222222222222",
      selectionKind: "select",
    },
  });
}
