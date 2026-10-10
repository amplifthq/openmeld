import {
  type SpaceWorkHandoff,
  spaceWorkHandoffSchema,
} from "@openmeld/schemas";
import type { SpaceApi, SpaceRequestInput } from "./types";

const briefLabels: Record<string, string> = {
  completed: "Current state",
  nextSteps: "Next steps",
  evidence: "Verified evidence",
  attemptedApproaches: "Approaches already tried",
  decisions: "Accepted decisions",
  constraints: "Constraints",
  openQuestions: "Open questions",
  completionCriteria: "Completion criteria",
};

/** One existing Message/Thread publication owns both the handoff and its Wake. */
export async function postSpaceWorkHandoff(
  api: SpaceApi,
  input: SpaceRequestInput & {
    clientMessageId: string;
    targetProfileId: string;
    threadId?: string;
    handoff: SpaceWorkHandoff;
  }
) {
  const handoff = spaceWorkHandoffSchema.parse(input.handoff);
  const text =
    handoff.schemaVersion === 2
      ? [
          handoff.work.goal,
          `Published commit: ${handoff.code.commit}`,
          ...Object.entries(handoff.work)
            .filter(([key]) => key !== "goal")
            .map(
              ([key, value]) =>
                `${briefLabels[key]}:\n${Array.isArray(value) ? value.map((item) => `- ${item}`).join("\n") || "Not supplied" : value}`
            ),
        ].join("\n\n")
      : `${handoff.work.goal}\n\n${handoff.work.nextSteps}`;
  const files = handoff.files.map((file) => ({
    fileId: file.fileId,
    revision: file.revision,
    name: file.relativePath.split("/").at(-1) ?? file.relativePath,
    mimeType: "application/octet-stream",
    sizeBytes: 0,
  }));
  const messageEnvelope = {
    text,
    activationTargets: [input.targetProfileId],
    mentionTargets: [],
    referenceTargets: [],
    ...(handoff.schemaVersion === 2
      ? { replyToSignalId: handoff.sourceSignalId }
      : {}),
  };
  const contextSelection =
    handoff.schemaVersion === 2
      ? {
          mode: "new" as const,
          ...handoff.execution,
          projectWork: handoff.code,
        }
      : {
          mode: "new" as const,
          access: "space_context" as const,
          workspace: "isolated" as const,
        };
  const common = {
    spaceId: input.spaceId,
    requestContext: input.requestContext,
    spacePassword: input.spacePassword,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  };
  if (input.threadId) {
    return await api.postThreadSignal({
      ...common,
      threadId: input.threadId,
      body: {
        text,
        files,
        messageEnvelope,
        contextSelection,
        clientMessageId: input.clientMessageId,
        workHandoff: handoff,
      },
    });
  }
  return await api.postNormalMessage({
    ...common,
    text,
    files,
    messageEnvelope,
    contextSelection,
    meta: { clientMessageId: input.clientMessageId, workHandoff: handoff },
  });
}
