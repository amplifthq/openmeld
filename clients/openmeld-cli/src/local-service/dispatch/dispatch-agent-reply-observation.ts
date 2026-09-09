import type { SignalEnvelope } from "@openmeld/protocol";
import type {
  OpenMeldRequestContext,
  OpenMeldSpaceEgressAction,
  SpaceThreadContext,
} from "@openmeld/schemas/types";
import {
  buildSpaceRoundSignalPublication,
  isWakeClosingSystemNoticeType,
} from "@openmeld/space";
import {
  SPACE_COLLABORATION_CONTEXT_RULE,
  SPACE_PERSONAL_CONTRIBUTION_RULE,
} from "@openmeld/space-mesh";
import { resolveBaseUrl } from "../../config/base-url";
import { createCliSpaceApi } from "../../space/cli-space-api";
import { fetchSpaceUpdates } from "../../space/updates-api";

const OBSERVATION_LIMIT = 20;
const SIGNAL_TEXT_LIMIT = 2000;

export type DispatchAgentReplyObservation = {
  observedThroughSignalId: string;
  relevantSignals: SignalEnvelope[];
  status: "changed" | "current";
};

export async function readDispatchAgentReplyObservation(input: {
  currentWakeTargetProfileIds?: readonly string[];
  requestContext: OpenMeldRequestContext;
  sourceSignalId: string;
  spaceId: string;
  spacePassword: string | null;
  threadContext: SpaceThreadContext | null;
  wakeSourceSignalId: string;
}): Promise<DispatchAgentReplyObservation> {
  const baseUrl = await resolveBaseUrl();
  const candidates = input.threadContext
    ? await readThreadSignalsAfterSource({
        baseUrl,
        requestContext: input.requestContext,
        sourceSignalId: input.sourceSignalId,
        spaceId: input.spaceId,
        spacePassword: input.spacePassword,
        threadId: input.threadContext.threadId,
      })
    : (
        await fetchSpaceUpdates({
          afterSignalId: input.sourceSignalId,
          baseUrl,
          limit: OBSERVATION_LIMIT,
          requestContext: input.requestContext,
          space: input.spaceId,
          ...(input.spacePassword ? { password: input.spacePassword } : {}),
        })
      ).signals;
  return resolveDispatchAgentReplyObservation({
    candidates,
    currentWakeTargetProfileIds: input.currentWakeTargetProfileIds,
    sourceSignalId: input.sourceSignalId,
    wakeSourceSignalId: input.wakeSourceSignalId,
  });
}

export function resolveDispatchAgentReplyObservation(input: {
  candidates: readonly SignalEnvelope[];
  currentWakeTargetProfileIds?: readonly string[];
  sourceSignalId: string;
  wakeSourceSignalId?: string;
}): DispatchAgentReplyObservation {
  const currentWakeTargetProfileIds = new Set(
    (input.currentWakeTargetProfileIds ?? []).map((profileId) =>
      profileId.trim()
    )
  );
  const relevantSignals = input.candidates
    .filter(
      (signal) =>
        isRelevantCollaborationSignal(signal) &&
        isSignalInCurrentWakeScope(
          signal,
          currentWakeTargetProfileIds,
          input.wakeSourceSignalId ?? input.sourceSignalId
        )
    )
    .slice(0, OBSERVATION_LIMIT);
  const observedThroughSignalId =
    input.candidates.at(-1)?.id ?? input.sourceSignalId;
  return {
    observedThroughSignalId,
    relevantSignals,
    status: relevantSignals.length > 0 ? "changed" : "current",
  };
}

export function attachAgentReplyObservation(input: {
  action: OpenMeldSpaceEgressAction;
  observedThroughSignalId: string;
}): OpenMeldSpaceEgressAction {
  if (input.action.type !== "post_message") {
    return input.action;
  }
  return {
    ...input.action,
    observedThroughSignalId: input.observedThroughSignalId,
  };
}

export function buildAgentReplyReconsiderationPrompt(input: {
  action: OpenMeldSpaceEgressAction;
  originalWake: {
    sourceSignalId: string;
    targetProfileId: string;
    text: string;
  };
  relevantSignals: readonly SignalEnvelope[];
  omittedThroughSignalId?: string;
  spaceId: string;
}): string {
  const updates = input.relevantSignals.map((signal) => ({
    actorProfileId: readCollaborationActorProfileId(signal),
    authorKind: signal.profile.kind,
    outcome: resolveCollaborationOutcome(signal),
    signalId: signal.id,
    text: readSignalText(signal).slice(0, SIGNAL_TEXT_LIMIT),
    truncated: readSignalText(signal).length > SIGNAL_TEXT_LIMIT,
  }));
  return [
    "OpenMeld concurrent Space update review.",
    `Space: ${input.spaceId}`,
    "Continue the original Wake, not a new assignment: do not run activation-intent classification against the newer messages. Another Agent's reply does not turn you into a reference or candidate or transfer your assignment.",
    `Original Wake (the assignment being completed): ${JSON.stringify(input.originalWake)}`,
    "This bounded view includes earlier review facts as well as new public messages, in publication order. Prior review turns may not be present in this conversation.",
    SPACE_COLLABORATION_CONTEXT_RULE,
    "Your previous action is an unpublished proposal.",
    "An accepted action acknowledgement does not mean the Space published it. You still have one public reply available for this Wake.",
    "Do not redo completed work or repeat external side effects.",
    "A failed, stopped, or silent outcome is not a public contribution. Use it only as truthful availability and coordination context.",
    "Keep the user's full request as the goal. Reconsider only the final Space action in light of these newer messages.",
    "If a follow-up needs work that this review cannot perform, say what remains undone; do not imply that acknowledging it starts or queues that work.",
    SPACE_PERSONAL_CONTRIBUTION_RULE,
    "For dependent contributions, follow the user's shared constraints and confirmed contributions. In an ordered sequence, contribute only the next valid step, not a future step with unpublished prerequisites. A participant list or proposed division of work is not evidence that earlier steps happened. Avoid duplicating completed work, not requested personal answers.",
    "Call exactly one dispatch-scoped OpenMeld Space Action tool for the final action and inspect its acknowledgement. Discover the tool before concluding it is unavailable; use the provided CLI only if unavailable. Answer text never becomes an action.",
    "Record the final action even if you keep the same answer.",
    ...(input.omittedThroughSignalId
      ? [
          `Earlier review messages through signal ${JSON.stringify(input.omittedThroughSignalId)} were omitted from this bounded view. Absence is not evidence that nothing happened. Read the originating Space or thread history if those facts affect your action.`,
        ]
      : []),
    "A truncated message is an excerpt; read its original when omitted details affect your action.",
    `Previous proposed action: ${JSON.stringify(input.action)}`,
    `Observed Space messages: ${JSON.stringify(updates)}`,
  ].join("\n");
}

export async function coordinateDispatchAgentReply<T>(input: {
  action: OpenMeldSpaceEgressAction;
  originalWake: {
    sourceSignalId: string;
    targetProfileId: string;
    text: string;
  };
  currentValue: T;
  observation: DispatchAgentReplyObservation;
  reconsider: (
    prompt: string,
    observation: DispatchAgentReplyObservation
  ) => Promise<{
    action: OpenMeldSpaceEgressAction | undefined;
    value: T;
  }>;
  refreshObservation?: (
    observedThroughSignalId: string
  ) => Promise<DispatchAgentReplyObservation>;
  spaceId: string;
}): Promise<{
  action: OpenMeldSpaceEgressAction | undefined;
  reconsiderationCount: number;
  reconsidered: boolean;
  value: T;
}> {
  let action: OpenMeldSpaceEgressAction | undefined = input.action;
  let observation = input.observation;
  let reconsiderationCount = 0;
  let value = input.currentValue;
  // Repair forks preserve canonical identity, not the previous fork's memory.
  // Retain a bounded public view only for this coordination call, never a
  // private transcript or a second source of Space/execution truth.
  const observedSignals = new Map<string, SignalEnvelope>();
  let omittedThroughSignalId: string | undefined;

  while (observation.status === "changed") {
    for (const signal of observation.relevantSignals) {
      observedSignals.set(signal.id, signal);
      if (observedSignals.size > OBSERVATION_LIMIT) {
        const oldestId = observedSignals.keys().next().value;
        if (oldestId) {
          observedSignals.delete(oldestId);
          omittedThroughSignalId = oldestId;
        }
      }
    }
    const reconsidered = await input.reconsider(
      buildAgentReplyReconsiderationPrompt({
        action,
        originalWake: input.originalWake,
        relevantSignals: [...observedSignals.values()],
        omittedThroughSignalId,
        spaceId: input.spaceId,
      }),
      observation
    );
    action = reconsidered.action;
    value = reconsidered.value;
    reconsiderationCount += 1;
    if (
      !action ||
      action.type !== "post_message" ||
      !input.refreshObservation
    ) {
      break;
    }
    observation = await input.refreshObservation(
      observation.observedThroughSignalId
    );
  }

  return {
    action: action
      ? attachAgentReplyObservation({
          action,
          observedThroughSignalId: observation.observedThroughSignalId,
        })
      : undefined,
    reconsiderationCount,
    reconsidered: reconsiderationCount > 0,
    value,
  };
}

function isRelevantCollaborationSignal(signal: SignalEnvelope): boolean {
  if (signal.type === "signal.system_notice") {
    return isWakeClosingSystemNoticeType(signal.data.noticeType);
  }
  return (
    (signal.type === "signal.text" || signal.type === "signal.status") &&
    (signal.type !== "signal.text" || signal.data.meta?.transient !== true)
  );
}

function readSignalText(signal: SignalEnvelope): string {
  return signal.type === "signal.text" ||
    signal.type === "signal.status" ||
    signal.type === "signal.system_notice"
    ? signal.data.text
    : "";
}

function isSignalInCurrentWakeScope(
  signal: SignalEnvelope,
  currentWakeTargetProfileIds: ReadonlySet<string>,
  wakeSourceSignalId: string
): boolean {
  if (signal.profile.kind === "human") {
    return !isNewHumanWake(signal);
  }
  if (currentWakeTargetProfileIds.size === 0) {
    return true;
  }
  const publication = buildSpaceRoundSignalPublication(signal);
  return Boolean(
    publication?.actorProfileId &&
      currentWakeTargetProfileIds.has(publication.actorProfileId) &&
      publication.replyToSignalId === wakeSourceSignalId
  );
}

function isNewHumanWake(signal: SignalEnvelope): boolean {
  return Boolean(
    signal.type === "signal.text" &&
      signal.data.messageEnvelope?.activationTargets.length
  );
}

function readCollaborationActorProfileId(
  signal: SignalEnvelope
): string | null {
  return signal.profile.kind === "human"
    ? signal.profile.profileId
    : (buildSpaceRoundSignalPublication(signal)?.actorProfileId ?? null);
}

function resolveCollaborationOutcome(
  signal: SignalEnvelope
): "contribution" | "failed" | "silent" | "stopped" | "status" {
  if (signal.type === "signal.text") {
    return "contribution";
  }
  if (signal.type === "signal.status") {
    return "status";
  }
  switch (signal.data.noticeType) {
    case "stay_silent":
      return "silent";
    case "wake_stopped":
      return "stopped";
    default:
      return "failed";
  }
}

async function readThreadSignalsAfterSource(input: {
  baseUrl: string;
  requestContext: OpenMeldRequestContext;
  sourceSignalId: string;
  spaceId: string;
  spacePassword: string | null;
  threadId: string;
}): Promise<SignalEnvelope[]> {
  const response = await createCliSpaceApi(input.baseUrl).listThreadSignals({
    afterSignalId: input.sourceSignalId,
    limit: OBSERVATION_LIMIT,
    requestContext: input.requestContext,
    spaceId: input.spaceId,
    threadId: input.threadId,
    ...(input.spacePassword ? { spacePassword: input.spacePassword } : {}),
  });
  return response.signals;
}
