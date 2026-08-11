import {
  createSpaceMemberAgentSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSignalDispatchExecutionEvidence } from "../src/space/read-projection/dispatch-execution-evidence";

type LookupInput = NonNullable<
  Parameters<typeof buildSignalDispatchExecutionEvidence>[0]["lookup"]
>;
type LookupStatus = LookupInput["matches"][number]["status"];

function createLookup(status: string): LookupInput {
  return {
    query: {
      spaceId: "space-1",
      sourceSignalId: "sig-1",
      clientMessageId: null,
      targetProfileId: null,
    },
    matches: [
      {
        dispatchId: "dispatch-1",
        sourceSignalId: "sig-1",
        targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        status: status as LookupStatus,
        attemptCount: 1,
        latestAttemptId: null,
        latestAttemptStatus: null,
        latestAttemptErrorCode: null,
        latestAttemptErrorMessage: null,
      },
    ],
  };
}

describe("dispatch execution evidence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["queued", "dispatch_recorded"],
    ["dispatching", "dispatch_recorded"],
    ["succeeded", "dispatch_recorded"],
    ["deduped", "dispatch_recorded"],
    ["blocked", "blocked"],
    ["failed_retryable", "retrying"],
    ["failed_terminal", "failed"],
    ["cancelled", "stopped"],
  ] as const)("maps ledger status %s to %s", (dispatchStatus, expectedStatus) => {
    const evidence = buildSignalDispatchExecutionEvidence({
      lookup: createLookup(dispatchStatus),
    });

    expect(evidence?.targetDispatches[0]?.status).toBe(expectedStatus);
  });

  it("keeps unknown ledger statuses unknown and logs them", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const evidence = buildSignalDispatchExecutionEvidence({
      lookup: createLookup("unexpected_status"),
    });

    expect(evidence?.targetDispatches[0]?.status).toBe("unknown");
    expect(warnSpy).toHaveBeenCalledWith(
      "[openmeld.space.dispatch_execution.status.unknown]",
      expect.objectContaining({
        dispatchStatus: "unexpected_status",
      })
    );
  });

  it("keeps activation target order and resolves member snapshot display names", () => {
    const evidence = buildSignalDispatchExecutionEvidence({
      lookup: {
        query: {
          spaceId: "space-1",
          sourceSignalId: "sig-source",
          clientMessageId: null,
          targetProfileId: null,
        },
        matches: [
          {
            dispatchId: "dispatch-b",
            sourceSignalId: "sig-source",
            targetProfileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            status: "queued",
            attemptCount: 1,
            latestAttemptId: null,
            latestAttemptStatus: null,
            latestAttemptErrorCode: null,
            latestAttemptErrorMessage: null,
          },
          {
            dispatchId: "dispatch-a",
            sourceSignalId: "sig-source",
            targetProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            status: "queued",
            attemptCount: 1,
            latestAttemptId: null,
            latestAttemptStatus: null,
            latestAttemptErrorCode: null,
            latestAttemptErrorMessage: null,
          },
        ],
      },
      membersSnapshot: createSpaceMembersSnapshot({
        agents: [
          createSpaceMemberAgentSnapshot({
            addedAt: "2026-04-10T00:00:00.000Z",
            addedByDisplayName: null,
            addedByOwnerUserId: null,
            addedByProfileId: null,
            createdAt: "2026-04-10T00:00:00.000Z",
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: null,
            lastSeenLabel: null,
            memberSourceLabel: "Added by a member",
            ownerName: null,
            ownerUserId: null,
            profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            profileName: "Agent A",
            updatedAt: "2026-04-10T00:00:00.000Z",
            wakeabilityReasonText: "Ready",
            workingDirectory: null,
          }),
          createSpaceMemberAgentSnapshot({
            addedAt: "2026-04-10T00:00:00.000Z",
            addedByDisplayName: null,
            addedByOwnerUserId: null,
            addedByProfileId: null,
            createdAt: "2026-04-10T00:00:00.000Z",
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: null,
            lastSeenLabel: null,
            memberSourceLabel: "Added by a member",
            ownerName: null,
            ownerUserId: null,
            profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            profileName: "Agent B",
            updatedAt: "2026-04-10T00:00:00.000Z",
            wakeabilityReasonText: "Ready",
            workingDirectory: null,
          }),
        ],
        generatedAt: "2026-04-10T00:00:00.000Z",
        humans: [],
        spaceId: "space-1",
      }),
      sourceSignal: {
        v: 1,
        id: "sig-source",
        spaceId: "space-1",
        ts: 1,
        profile: {
          kind: "human",
          profileId: "hum-1",
          profileName: "Felix",
        },
        type: "signal.text",
        data: {
          text: "@Agent A(wake) @Agent B(wake)",
          messageEnvelope: {
            text: "@Agent A(wake) @Agent B(wake)",
            activationTargets: [
              "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            ],
            referenceTargets: [],
          },
        },
      },
    });

    expect(
      evidence?.targetDispatches.map((dispatch) => dispatch.targetProfileId)
    ).toEqual([
      "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
    expect(
      evidence?.targetDispatches.map((dispatch) => dispatch.targetDisplayName)
    ).toEqual(["Agent A", "Agent B"]);
  });
});
