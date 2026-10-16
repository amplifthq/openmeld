import {
  maxLength,
  minLength,
  pipe,
  strictObject,
  string,
  trim,
} from "valibot";
import type {
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import { getRemoteAgentResponseInputId } from "./execution-context";
import { remoteAgentStreamPublisher } from "./stream-publisher-instance";
import {
  isRemoteAgentStreamEligible,
  type RemoteAgentStreamPublisher,
  resolveRemoteAgentStreamContext,
} from "./streaming";

export const HOSTED_PUBLIC_PROGRESS_TOOL_NAME = "openmeld_report_progress";

const publicProgressInputSchema = strictObject({
  update: pipe(string(), trim(), minLength(1), maxLength(600)),
});

export function createHostedPublicProgressTool(input: {
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  streamPublisher?: RemoteAgentStreamPublisher;
  submissionId: string;
}): RemoteAgentToolDefinition {
  return {
    name: HOSTED_PUBLIC_PROGRESS_TOOL_NAME,
    description:
      "Share one brief, concrete progress update with everyone who can view this OpenMeld Space conversation. Updates remain visible with a successfully published reply. Use it when you start meaningful work, confirm a finding, change approach, or begin verification. Say what you are doing or what you verified; do not include private reasoning, protected information, raw tool inputs, credentials, file paths, or speculative success. Do not call on a timer or repeat an unchanged update. This is not the final reply.",
    input: publicProgressInputSchema,
    execute: async (payload) => {
      const responseInputId = getRemoteAgentResponseInputId();
      const context = await resolveRemoteAgentStreamContext({
        storage: input.storage,
        submissionId: input.submissionId,
      });
      if (
        !(context && isRemoteAgentStreamEligible(context)) ||
        context.turnEnvelope?.trigger.source === "message_channel" ||
        context.workLoopCheckpoint
      ) {
        return { shown: false };
      }
      const publisher = input.streamPublisher ?? remoteAgentStreamPublisher;
      const update = String(payload.update).trim();
      const pushed = await publisher.push({
        context,
        coreWorker: input.coreWorker,
        delta: `${update}\n\n`,
        kind: "progress",
        observedAtMs: Date.now(),
        responseInputId,
        storage: input.storage,
      });
      const result =
        "contentKind" in pushed && pushed.contentKind === "progress"
          ? pushed
          : await publisher.flush({
              context,
              coreWorker: input.coreWorker,
              observedAtMs: Date.now(),
              storage: input.storage,
            });
      return {
        shown:
          result.status === "published" && result.contentKind === "progress",
      };
    },
  };
}
