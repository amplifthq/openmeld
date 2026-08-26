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
  relevantSignals: readonly SignalEnvelope[];
  spaceId: string;
}): string {
  const updates = input.relevantSignals.map((signal) => ({
    actorProfileId: readCollaborationActorProfileId(signal),
    outcome: resolveCollaborationOutcome(signal),
    signalId: signal.id,
    text: readSignalText(signal).slice(0, SIGNAL_TEXT_LIMIT),
  }));
  return [
    "OpenMeld concurrent Space update review.",
    `Space: ${input.spaceId}`,
    "Other public collaboration messages arrived after the room state used for your proposed reply.",
    "Your previous action is an unpublished proposal.",
    "If a dispatch-scoped Space Action command said it was accepted, that only means OpenMeld recorded a replaceable proposal; it does not mean the Space published it or that you used your one public reply.",
    "You still have one public reply available for this Wake.",
    "Do not redo completed work, repeat tool calls, or repeat external side effects.",
    "A failed, stopped, or silent outcome is not a public contribution. Use it only as truthful availability and coordination context.",
    "Keep the user's full request as the goal. Reconsider only the final Space action in light of these newer messages.",
    "Replace the proposal when a distinct, useful contribution is still possible. Avoid duplicating work or a conclusion another Agent has already posted.",
    "Choose stay_silent only when no distinct, useful, non-duplicative contribution remains.",
    "Call exactly one dispatch-scoped OpenMeld Space Action tool for the final action. Use the CLI only if the tool is unavailable. Answer text never becomes an action.",
    `Previous proposed action: ${JSON.stringify(input.action)}`,
    `Newer Space messages: ${JSON.stringify(updates)}`,
  ].join("\n");
}

export async function coordinateDispatchAgentReply<T>(input: {
  action: OpenMeldSpaceEgressAction;
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

  while (observation.status === "changed") {
    const reconsidered = await input.reconsider(
      buildAgentReplyReconsiderationPrompt({
        action,
        relevantSignals: observation.relevantSignals,
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
  if (
    currentWakeTargetProfileIds.size === 0 ||
    signal.profile.kind === "human"
  ) {
    return true;
  }
  const publication = buildSpaceRoundSignalPublication(signal);
  return Boolean(
    publication?.actorProfileId &&
      currentWakeTargetProfileIds.has(publication.actorProfileId) &&
      publication.replyToSignalId === wakeSourceSignalId
  );
}

function readCollaborationActorProfileId(
  signal: SignalEnvelope
): string | null {
  return buildSpaceRoundSignalPublication(signal)?.actorProfileId ?? null;
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
