import type { SignalEnvelope } from "@openmeld/protocol";
import type { MessageEnvelope } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildSignalIndex,
  buildSpaceRoundReadProjection,
  type SpaceRoundReadTargetDispatchEvidence,
} from "../src";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const READY_AGENT_PROFILE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BLOCKED_AGENT_PROFILE_ID = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FAILED_AGENT_PROFILE_ID = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REFERENCE_AGENT_PROFILE_ID = "agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SECOND_REFERENCE_AGENT_PROFILE_ID =
  "agt_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function createSourceSignal(input?: {
  messageEnvelope?: Partial<MessageEnvelope>;
}): SignalEnvelope {
  const text =
    "@Ready Agent(wake) @Blocked Agent(wake) @Failed Agent(wake) @Reference Agent(reference) @Observer(reference) Please respond.";
  return {
    v: 1,
    id: "sig-source",
    spaceId: "space-1",
    ts: Date.UTC(2026, 3, 27, 0, 0, 0),
    profile: {
      kind: "human",
      profileId: HUMAN_PROFILE_ID,
      profileName: "Mira",
    },
    type: "signal.text",
    data: {
      text,
      messageEnvelope: {
        text,
        activationTargets: [
          READY_AGENT_PROFILE_ID,
          BLOCKED_AGENT_PROFILE_ID,
          FAILED_AGENT_PROFILE_ID,
        ],
        referenceTargets: [
          REFERENCE_AGENT_PROFILE_ID,
          SECOND_REFERENCE_AGENT_PROFILE_ID,
        ],
        ...input?.messageEnvelope,
      },
    },
  };
}

function createReplySignal(input: {
  dispatchId: string;
  id: string;
  profileId: string;
  profileName: string;
  text: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-1",
    ts: Date.UTC(2026, 3, 27, 0, 0, 1),
    profile: {
      kind: "agent",
      profileId: input.profileId,
      profileName: input.profileName,
    },
    type: "signal.text",
    data: {
      text: input.text,
      meta: { dispatchId: input.dispatchId },
      messageEnvelope: {
        text: input.text,
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-source",
      },
    },
  };
}

function createStaySilentSignal(input: {
  dispatchId: string;
  id: string;
  profileId: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-1",
    ts: Date.UTC(2026, 3, 27, 0, 0, 2),
    profile: {
      kind: "system",
      profileId: "system",
      profileName: "OpenMeld System",
    },
    type: "signal.system_notice",
    data: {
      actorProfileId: input.profileId,
      dispatchId: input.dispatchId,
      generatedBy: "openmeld",
      noticeType: "stay_silent",
      text: "Ready Agent chose to stay silent.",
      replyTo: {
        signalId: "sig-source",
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "Mira",
        previewText: "Please respond.",
      },
    },
  };
}

function createDispatchExecution() {
  return {
    sourceSignalId: "sig-source",
    targetDispatches: [
      {
        dispatchId: "dispatch-ready",
        dispatchStatus: "succeeded",
        latestAttemptStatus: "succeeded",
        reasonCode: null,
        reasonText: null,
        status: "dispatch_recorded" as const,
        targetDisplayName: "Ready Agent",
        targetProfileId: READY_AGENT_PROFILE_ID,
      },
      {
        dispatchId: "dispatch-blocked",
        dispatchStatus: "blocked",
        latestAttemptStatus: "blocked",
        reasonCode: "route.not_registered",
        reasonText: "Route is not registered.",
        status: "blocked" as const,
        targetDisplayName: "Blocked Agent",
        targetProfileId: BLOCKED_AGENT_PROFILE_ID,
      },
      {
        dispatchId: "dispatch-failed",
        dispatchStatus: "failed_terminal",
        latestAttemptStatus: "failed_terminal",
        reasonCode: "runtime.failed",
        reasonText: "Runtime failed.",
        status: "failed" as const,
        targetDisplayName: "Failed Agent",
        targetProfileId: FAILED_AGENT_PROFILE_ID,
      },
    ],
  };
}

function getReadyTargetDispatchFixture(): SpaceRoundReadTargetDispatchEvidence {
  const readyTargetDispatch = createDispatchExecution().targetDispatches[0];
  if (!readyTargetDispatch) {
    throw new Error("Expected ready target dispatch fixture");
  }

  return readyTargetDispatch;
}

describe("space round read projection", () => {
  it("projects a wake target that wrote a public reply", () => {
    const sourceSignal = createSourceSignal();
    const replySignal = createReplySignal({
      dispatchId: "dispatch-ready",
      id: "sig-reply",
      profileId: READY_AGENT_PROFILE_ID,
      profileName: "Ready Agent",
      text: "Here is the rollout plan.",
    });

    const projection = buildSpaceRoundReadProjection({
      sourceSignalId: "sig-source",
      sourceSignal,
      dispatchExecution: createDispatchExecution(),
      signals: [replySignal],
      signalIndex: buildSignalIndex([sourceSignal, replySignal]),
    });

    expect(projection.targets[0]).toMatchObject({
      profileId: READY_AGENT_PROFILE_ID,
      relation: "wake",
      dispatchState: "dispatch_recorded",
      publicOutcome: "post_message",
      dispatchId: "dispatch-ready",
      publishedSignalId: "sig-reply",
      publishedSignalType: "signal.text",
      finalPreview: "Here is the rollout plan.",
    });
  });

  it("keeps blocked wake targets as execution state without public outcome", () => {
    const sourceSignal = createSourceSignal();

    const projection = buildSpaceRoundReadProjection({
      sourceSignalId: "sig-source",
      sourceSignal,
      dispatchExecution: createDispatchExecution(),
      signalIndex: buildSignalIndex([sourceSignal]),
    });

    expect(
      projection.targets.find(
        (target) => target.profileId === BLOCKED_AGENT_PROFILE_ID
      )
    ).toMatchObject({
      relation: "wake",
      dispatchState: "blocked",
      publicOutcome: null,
      reasonCode: "route.not_registered",
    });
  });

  it("keeps failed wake targets as execution state without public outcome", () => {
    const sourceSignal = createSourceSignal();

    const projection = buildSpaceRoundReadProjection({
      sourceSignalId: "sig-source",
      sourceSignal,
      dispatchExecution: createDispatchExecution(),
      signalIndex: buildSignalIndex([sourceSignal]),
    });

    expect(
      projection.targets.find(
        (target) => target.profileId === FAILED_AGENT_PROFILE_ID
      )
    ).toMatchObject({
      relation: "wake",
      dispatchState: "failed",
      publicOutcome: null,
      reasonCode: "runtime.failed",
    });
  });

  it("derives no_dispatch for every Reference target", () => {
    const sourceSignal = createSourceSignal();

    const projection = buildSpaceRoundReadProjection({
      sourceSignalId: "sig-source",
      sourceSignal,
      dispatchExecution: createDispatchExecution(),
      signalIndex: buildSignalIndex([sourceSignal]),
    });

    expect(
      projection.targets.find(
        (target) => target.profileId === REFERENCE_AGENT_PROFILE_ID
      )
    ).toMatchObject({
      relation: "reference",
      dispatchState: "no_dispatch",
      publicOutcome: null,
    });
    expect(
      projection.targets.find(
        (target) => target.profileId === SECOND_REFERENCE_AGENT_PROFILE_ID
      )
    ).toMatchObject({
      relation: "reference",
      dispatchState: "no_dispatch",
      publicOutcome: null,
    });
  });

  it("preserves unresolved target resolution evidence in round targets", () => {
    const sourceSignal = createSourceSignal({
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: ["agt_88888888-8888-4888-8888-888888888888"],
      },
    });

    const projection = buildSpaceRoundReadProjection({
      sourceSignalId: "sig-source",
      sourceSignal,
      signalIndex: buildSignalIndex([sourceSignal]),
    });

    expect(projection.targets).toEqual([
      expect.objectContaining({
        profileId: "agt_88888888-8888-4888-8888-888888888888",
        relation: "reference",
        dispatchState: "no_dispatch",
        targetResolutionReasonCode: "addressing.target_unresolved",
        targetResolutionStatus: "unresolved",
      }),
    ]);
  });

  it("treats stay_silent as public outcome without turning it into failure", () => {
    const sourceSignal = createSourceSignal({
      messageEnvelope: {
        activationTargets: [READY_AGENT_PROFILE_ID],
        referenceTargets: [],
      },
    });
    const staySilentSignal = createStaySilentSignal({
      dispatchId: "dispatch-ready",
      id: "sig-stay-silent",
      profileId: READY_AGENT_PROFILE_ID,
    });
    const readyTargetDispatch = getReadyTargetDispatchFixture();

    const projection = buildSpaceRoundReadProjection({
      sourceSignalId: "sig-source",
      sourceSignal,
      dispatchExecution: {
        sourceSignalId: "sig-source",
        targetDispatches: [readyTargetDispatch],
      },
      signals: [staySilentSignal],
      signalIndex: buildSignalIndex([sourceSignal, staySilentSignal]),
    });

    expect(projection.targets[0]).toMatchObject({
      relation: "wake",
      dispatchState: "dispatch_recorded",
      publicOutcome: "stay_silent",
      publishedSignalId: "sig-stay-silent",
      publishedSignalType: "signal.system_notice",
    });
  });
});
