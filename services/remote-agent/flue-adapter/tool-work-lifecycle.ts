import type {
  AgentStreamToolPart,
  AgentWorkActivity,
} from "@openmeld/schemas/types";
import type { RemoteAgentStorage } from "../agent-core/callback-context";
import type { FlueToolLifecyclePart } from "./observation";

const TOOL_WORK_LIFECYCLE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TOOL_WORK_LIFECYCLE_PREFIX = "openmeld:remote-agent:tool-work-lifecycle:";

type StoredToolWorkLifecycle = {
  toolName: string;
  work: AgentWorkActivity;
};

export async function preserveToolWorkThroughCompletion(input: {
  storage: RemoteAgentStorage;
  toolPart: FlueToolLifecyclePart;
}): Promise<AgentStreamToolPart> {
  const { part } = input.toolPart;
  const key = buildToolWorkLifecycleKey(input.toolPart);

  if (part.state === "input-available") {
    if (part.work) {
      await input.storage.putExpiring<StoredToolWorkLifecycle>(
        key,
        { toolName: part.toolName, work: part.work },
        input.toolPart.observedAtMs + TOOL_WORK_LIFECYCLE_MAX_AGE_MS
      );
    }
    return part;
  }

  const started = await input.storage.takeUnexpired<StoredToolWorkLifecycle>(
    key,
    input.toolPart.observedAtMs
  );
  if (!started) {
    return part;
  }
  if (started.toolName !== part.toolName) {
    throw new Error("Tool work lifecycle changed toolName for one toolCallId.");
  }
  assertCompatibleTerminalWork(started.work, part.work);
  return {
    ...part,
    work: {
      ...started.work,
      ...(input.toolPart.workOutcome
        ? { outcome: input.toolPart.workOutcome }
        : {}),
    },
  };
}

function buildToolWorkLifecycleKey(toolPart: FlueToolLifecyclePart): string {
  return [
    TOOL_WORK_LIFECYCLE_PREFIX,
    toolPart.submissionId,
    ":",
    toolPart.part.toolCallId,
  ].join("");
}

function assertCompatibleTerminalWork(
  started: AgentWorkActivity,
  completed: AgentWorkActivity | undefined
): void {
  if (!completed) {
    return;
  }
  if (started.v !== completed.v || started.key !== completed.key) {
    throw new Error("Tool work lifecycle changed work for one toolCallId.");
  }
  if (
    completed.subject &&
    (started.subject?.kind !== completed.subject.kind ||
      started.subject.label !== completed.subject.label)
  ) {
    throw new Error("Tool work lifecycle changed subject for one toolCallId.");
  }
}
