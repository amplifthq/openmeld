import type { SignalEnvelope } from "@openmeld/protocol";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
  DispatchResult,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { buildSignalIndex } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import type { Presenter } from "../src/runtime/presenter/types";
import { emitSpaceDispatchResultHumanOutput } from "../src/space/result-output";

const MEMBERS_SNAPSHOT: SpaceMembersSnapshot = createSpaceMembersSnapshot({
  agents: [
    createSpaceMemberAgentSnapshot({
      addedAt: "2026-04-02T00:00:00.000Z",
      addedByDisplayName: null,
      addedByOwnerUserId: null,
      addedByProfileId: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      firstEnteredAt: null,
      lastEnteredAt: null,
      lastSeenAt: null,
      lastSeenLabel: null,
      memberSourceLabel: "Added by member",
      ownerName: "Felix",
      ownerUserId: "user-felix",
      profileId: "agt_22222222-2222-2222-2222-222222222222",
      profileName: "Phase 2a Agent",
      updatedAt: "2026-04-02T00:00:00.000Z",
      wakeabilityReasonText: "Ready",
      workingDirectory: null,
    }),
  ],
  generatedAt: "2026-04-02T00:00:00.000Z",
  humans: [],
  spaceId: "space-1",
});

function createPresenter(): {
  presenter: Presenter;
  lines: string[];
} {
  const lines: string[] = [];
  return {
    presenter: {
      view: "human",
      data: () => undefined,
      event: () => undefined,
      line: (input) => {
        lines.push(input.text);
      },
    },
    lines,
  };
}

describe("result output", () => {
  it("reads reply-to signal from shared projection built from archived messageEnvelope", () => {
    const result: DispatchResult = {
      resultRef: "result-1",
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
      actorName: "Phase 2a Agent",
      resultKind: "text",
      finalText: "Final reply body",
      messageEnvelope: {
        text: "Final reply body",
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-origin",
      },
      publicOutcome: "post_message",
      createdAt: "2026-04-02T00:00:00.000Z",
    };
    const { lines, presenter } = createPresenter();

    emitSpaceDispatchResultHumanOutput({
      presenter,
      result,
      membersSnapshot: MEMBERS_SNAPSHOT,
    });

    expect(lines.join("\n")).toContain("Reply-to signal");
    expect(lines.join("\n")).toContain("sig-origin");
  });

  it("renders human reply summaries and relation rows from shared read projection", () => {
    const sourceSignal: SignalEnvelope = {
      v: 1,
      id: "sig-origin",
      spaceId: "space-1",
      ts: Date.UTC(2026, 3, 2, 0, 0, 0),
      profile: {
        kind: "human" as const,
        profileId: "11111111-1111-1111-1111-111111111111",
        profileName: "Phase 2a Human",
      },
      type: "signal.text" as const,
      data: {
        text: "@Phase 2a Agent(wake) Please help.",
        messageEnvelope: {
          text: "@Phase 2a Agent(wake) Please help.",
          activationTargets: ["agt_22222222-2222-2222-2222-222222222222"],
          referenceTargets: [],
        },
      },
    };
    const result: DispatchResult = {
      resultRef: "result-2",
      dispatchId: "dispatch-2",
      spaceId: "space-1",
      actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
      actorName: "Phase 2a Agent",
      resultKind: "text",
      finalText: "Final reply body",
      messageEnvelope: {
        text: "Final reply body",
        activationTargets: ["agt_22222222-2222-2222-2222-222222222222"],
        referenceTargets: ["11111111-1111-1111-1111-111111111111"],
        replyToSignalId: "sig-origin",
      },
      publicOutcome: "post_message",
      createdAt: "2026-04-02T00:00:00.000Z",
    };
    const { lines, presenter } = createPresenter();

    emitSpaceDispatchResultHumanOutput({
      presenter,
      result,
      membersSnapshot: {
        ...MEMBERS_SNAPSHOT,
        humans: [
          {
            profileId: "11111111-1111-1111-1111-111111111111",
            profileName: "Phase 2a Human",
            profileKind: "human",
            status: "active",
            memberSource: "joined_directly",
            memberSourceLabel: "Joined directly",
            addedAt: "2026-04-02T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-04-02T00:00:00.000Z",
            updatedAt: "2026-04-02T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: null,
            lastSeenLabel: null,
            liveNow: false,
            mentionAlias: null,
            ownerUserId: "user-felix",
            ownerName: "Felix",
          },
        ],
        summary: {
          ...MEMBERS_SNAPSHOT.summary,
          totalCount: 2,
          humanCount: 1,
        },
      },
      signalIndex: buildSignalIndex([sourceSignal]),
    });

    const output = lines.join("\n");
    expect(output).toContain("Workflow");
    expect(output).toContain("A public reply message was written back.");
    expect(output).toContain("Reply to");
    expect(output).toContain("Phase 2a Human · wake: Phase 2a Agent");
    expect(output).toContain("Wake");
    expect(output).toContain("Reference");
    expect(output).toContain("Read scope");
    expect(output).toContain(
      "`space result` reads archived dispatch results only."
    );
  });

  it("explains stay_silent as a public system notice, not a public reply message", () => {
    const result: DispatchResult = {
      resultRef: "result-stay-silent",
      dispatchId: "dispatch-stay-silent",
      spaceId: "space-1",
      actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
      actorName: "Phase 2a Agent",
      resultKind: "text",
      finalText: "Private archived reply body",
      publicOutcome: "stay_silent",
      publishedSignalId: "sig-notice-1",
      createdAt: "2026-04-02T00:00:00.000Z",
    };
    const { lines, presenter } = createPresenter();

    emitSpaceDispatchResultHumanOutput({
      presenter,
      result,
      membersSnapshot: MEMBERS_SNAPSHOT,
    });

    const output = lines.join("\n");
    expect(output).toContain("Workflow");
    expect(output).toContain(
      "A public stay-silent system notice was written back."
    );
    expect(output).toContain("Published signal");
    expect(output).toContain("signal.system_notice · sig-notice-1");
    expect(output.match(/Published signal/g)).toHaveLength(1);
    expect(output).toContain("Read scope");
  });

  it("shows agent controller conversation and dispatch execution facts when the archived result includes them", () => {
    const result: DispatchResult = {
      resultRef: "result-conversation-facts",
      dispatchId: "dispatch-conversation-facts",
      spaceId: "space-1",
      actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
      actorName: "Phase 2a Agent",
      resultKind: "text",
      finalText: "Final reply body",
      publicOutcome: "post_message",
      agentControllerConversation: {
        agentControllerRef: "builtin:codex",
        agentControllerConversationKind: "thread",
        agentControllerConversationId: "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
      },
      runtimeWorkspace: {
        path: "/tmp/openmeld-demo-workspace",
        fingerprint: "sha256:runtime-workspace-1",
      },
      dispatchExecution: {
        agentControllerConversationResume: {
          status: "continued",
        },
        localRuntimeContext: {
          status: "reused",
          reason: null,
        },
        bootstrap: {
          status: "applied",
          reason: null,
        },
      },
      createdAt: "2026-04-02T00:00:00.000Z",
    };
    const { lines, presenter } = createPresenter();

    emitSpaceDispatchResultHumanOutput({
      presenter,
      result,
      membersSnapshot: MEMBERS_SNAPSHOT,
    });

    const output = lines.join("\n");
    expect(output).toContain("Agent controller conversation");
    expect(output).toContain(
      "codex thread 019d8ac0-46e2-78e2-9f4a-a41b3a6674c8"
    );
    expect(output).toContain("Agent controller conversation resume");
    expect(output).toContain("continued");
    expect(output).toContain("Runtime workspace");
    expect(output).toContain("/tmp/openmeld-demo-workspace");
    expect(output).toContain("Local runtime context");
    expect(output).toContain("reused");
    expect(output).toContain("Bootstrap");
    expect(output).toContain("applied");
  });

  it("shows runtime workspace even when dispatch execution facts are absent", () => {
    const result: DispatchResult = {
      actorName: "Phase 2a Agent",
      actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
      createdAt: "2026-04-02T00:00:00.000Z",
      dispatchId: "dispatch-runtime-workspace-only",
      finalText: "Final reply body",
      publicOutcome: "post_message",
      resultKind: "text",
      resultRef: "result-runtime-workspace-only",
      runtimeWorkspace: {
        fingerprint: "sha256:runtime-workspace-2",
        path: "/tmp/openmeld-runtime-only",
      },
      spaceId: "space-1",
    };
    const { lines, presenter } = createPresenter();

    emitSpaceDispatchResultHumanOutput({
      presenter,
      result,
      membersSnapshot: MEMBERS_SNAPSHOT,
    });

    const output = lines.join("\n");
    expect(output).toContain("Runtime workspace");
    expect(output).toContain("/tmp/openmeld-runtime-only");
  });

  it("keeps member snapshot-based relation names even when result.actorName is present", () => {
    const result: DispatchResult = {
      resultRef: "result-actor-name-snapshot",
      dispatchId: "dispatch-actor-name-snapshot",
      spaceId: "space-1",
      actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
      actorName: "Phase 2a Agent",
      resultKind: "text",
      finalText: "Final reply body",
      messageEnvelope: {
        text: "Final reply body",
        activationTargets: [],
        referenceTargets: ["11111111-1111-1111-1111-111111111111"],
      },
      publicOutcome: "post_message",
      createdAt: "2026-04-02T00:00:00.000Z",
    };
    const { lines, presenter } = createPresenter();

    emitSpaceDispatchResultHumanOutput({
      presenter,
      result,
      membersSnapshot: {
        ...MEMBERS_SNAPSHOT,
        humans: [
          {
            profileId: "11111111-1111-1111-1111-111111111111",
            profileName: "Referenced Human",
            profileKind: "human",
            status: "active",
            memberSource: "joined_directly",
            memberSourceLabel: "Joined directly",
            addedAt: "2026-04-02T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-04-02T00:00:00.000Z",
            updatedAt: "2026-04-02T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: null,
            lastSeenLabel: null,
            liveNow: false,
            mentionAlias: null,
            ownerUserId: "11111111-1111-1111-1111-111111111111",
            ownerName: "Referenced Human",
          },
        ],
        summary: {
          ...MEMBERS_SNAPSHOT.summary,
          totalCount: 2,
          humanCount: 1,
        },
      },
    });

    const output = lines.join("\n");
    expect(output).toContain("Reference");
    expect(output).toContain("Referenced Human");
    expect(output).not.toContain("11111111-1111-1111-1111-111111111111");
  });

  it("keeps removed member names readable in dispatch result relation rows", () => {
    const result: DispatchResult = {
      resultRef: "result-removed",
      dispatchId: "dispatch-removed",
      spaceId: "space-1",
      actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
      actorName: "Phase 2a Agent",
      resultKind: "text",
      finalText: "Final reply body",
      messageEnvelope: {
        text: "Final reply body",
        activationTargets: ["agt_33333333-3333-3333-3333-333333333333"],
        referenceTargets: [],
      },
      publicOutcome: "post_message",
      createdAt: "2026-04-02T00:00:00.000Z",
    };
    const { lines, presenter } = createPresenter();

    emitSpaceDispatchResultHumanOutput({
      presenter,
      result,
      membersSnapshot: {
        ...MEMBERS_SNAPSHOT,
        summary: {
          ...MEMBERS_SNAPSHOT.summary,
          totalCount: 2,
          agentCount: 2,
        },
        agents: [
          ...MEMBERS_SNAPSHOT.agents,
          createSpaceMemberAgentSnapshot({
            addedAt: "2026-04-02T00:00:00.000Z",
            addedByDisplayName: null,
            addedByOwnerUserId: null,
            addedByProfileId: null,
            createdAt: "2026-04-02T00:00:00.000Z",
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: null,
            lastSeenLabel: null,
            memberSourceLabel: "Added by member",
            ownerName: "Removed Agent",
            ownerUserId: "user-removed-agent",
            profileId: "agt_33333333-3333-3333-3333-333333333333",
            profileName: "Removed Agent",
            removalReason: "Removed",
            removedAt: "2026-04-03T00:00:00.000Z",
            status: "removed",
            updatedAt: "2026-04-03T00:00:00.000Z",
            wakeabilityReasonCodes: ["profile.unbound"],
            wakeabilityReasonText: "Blocked",
            wakeabilityStatus: "blocked",
            workingDirectory: null,
          }),
        ],
      },
    });

    expect(lines.join("\n")).toContain("Removed Agent");
    expect(lines.join("\n")).not.toContain(
      "agt_33333333-3333-3333-3333-333333333333"
    );
  });

  it("keeps removed member names readable from signal history when the current snapshot is active-only", () => {
    const joinNotice: SignalEnvelope = {
      v: 1,
      id: "sig-join-notice",
      spaceId: "space-1",
      ts: Date.UTC(2026, 3, 2, 0, 0, 0),
      profile: {
        kind: "agent",
        profileId: "agt_22222222-2222-2222-2222-222222222222",
        profileName: "Phase 2a Agent",
      },
      type: "signal.text",
      data: {
        text: "Phase 2a Agent added Removed Agent to this space.",
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: "agt_33333333-3333-3333-3333-333333333333",
          targetProfileName: "Removed Agent",
          targetProfileKind: "agent",
        },
      },
    };
    const removeNotice: SignalEnvelope = {
      v: 1,
      id: "sig-remove-notice",
      spaceId: "space-1",
      ts: Date.UTC(2026, 3, 2, 0, 5, 0),
      profile: {
        kind: "agent",
        profileId: "agt_22222222-2222-2222-2222-222222222222",
        profileName: "Phase 2a Agent",
      },
      type: "signal.text",
      data: {
        text: "Phase 2a Agent removed Removed Agent from this space.",
        meta: {
          purpose: "space_membership_remove_notice",
          targetProfileId: "agt_33333333-3333-3333-3333-333333333333",
          targetProfileName: "Removed Agent",
          targetProfileKind: "agent",
        },
      },
    };
    const result: DispatchResult = {
      resultRef: "result-removed-history",
      dispatchId: "dispatch-removed-history",
      spaceId: "space-1",
      actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
      actorName: "Phase 2a Agent",
      resultKind: "text",
      finalText: "Final reply body",
      messageEnvelope: {
        text: "Final reply body",
        activationTargets: ["agt_33333333-3333-3333-3333-333333333333"],
        referenceTargets: [],
      },
      publicOutcome: "post_message",
      createdAt: "2026-04-02T00:00:00.000Z",
    };
    const { lines, presenter } = createPresenter();

    emitSpaceDispatchResultHumanOutput({
      presenter,
      result,
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([joinNotice, removeNotice]),
    });

    expect(lines.join("\n")).toContain("Removed Agent");
    expect(lines.join("\n")).not.toContain(
      "agt_33333333-3333-3333-3333-333333333333"
    );
  });

  it("does not render dispatch execution summary rows in result output", () => {
    const result: DispatchResult = {
      resultRef: "result-execution",
      dispatchId: "dispatch-execution",
      spaceId: "space-1",
      actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
      actorName: "Phase 2a Agent",
      resultKind: "text",
      finalText: "Final reply body",
      messageEnvelope: {
        text: "Final reply body",
        activationTargets: ["agt_22222222-2222-2222-2222-222222222222"],
        referenceTargets: [],
      },
      publicOutcome: "post_message",
      createdAt: "2026-04-02T00:00:00.000Z",
    };
    const { lines, presenter } = createPresenter();

    emitSpaceDispatchResultHumanOutput({
      presenter,
      result,
    });

    const output = lines.join("\n");
    expect(output).not.toContain("Dispatch execution");
    expect(output).not.toContain("1 blocked");
    expect(output).not.toContain("route.not_registered");
  });
});
