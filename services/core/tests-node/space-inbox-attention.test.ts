import type { SignalEnvelope } from "@openmeld/protocol";
import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { buildSpaceInboxProjectionOutboxRecord } from "../src/space/application/space-inbox-projection";
import { selectSpaceInboxRecipients } from "../src/space/application/space-inbox-projection-outbox-service";
import type { SpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";

describe("Space Inbox recipient and addressing boundaries", () => {
  it("delivers one threaded Agent reply notification to the requester and each Human mention", async () => {
    const reply = {
      ...message({ mentionTargets: ["felix"] }),
      profile: {
        kind: "agent" as const,
        profileId: "codex",
        profileName: "Codex",
      },
      data: {
        ...message({ mentionTargets: ["felix"] }).data,
        meta: { dispatchId: "dispatch-1" },
      },
    };
    const record = buildSpaceInboxProjectionOutboxRecord({
      ...projectionInput(reply),
      signalContext: {
        threadContext: { threadId: "thread-1", rootSignalId: "root-1" },
        threadPlacement: "thread",
      },
      threadParticipantProfileIds: ["monica"],
      threadRootAuthorUserId: "monica",
      wakeRequesterUserId: "monica",
    });
    const recipients = await selectSpaceInboxRecipients(
      record?.candidates ?? [],
      async () => true
    );
    expect(recipients.map((item) => item.recipientUserId).sort()).toEqual([
      "felix",
      "monica",
    ]);
    expect(
      recipients.every(
        (item) =>
          item.sourceTarget.kind === "space" &&
          item.sourceTarget.threadRootSignalId === "root-1"
      )
    ).toBe(true);
  });
  it("does not turn unrelated Space conversation into personal-Agent activity", async () => {
    const record = project(message({}), [
      member("monica", "monica", "human"),
      member("felix", "felix", "human"),
      member("codex", "felix", "agent"),
      member("absent-owner-agent", "absent-owner", "agent"),
    ]);
    const recipients = await selectSpaceInboxRecipients(
      record?.candidates ?? [],
      async () => true
    );
    expect(recipients.map((item) => item.recipientUserId)).toEqual(["felix"]);
    expect(recipients[0]).toMatchObject({
      kind: "space_message",
      importance: "normal",
    });
    expect(recipients[0]?.sourceTarget).not.toHaveProperty(
      "agentOwnerActivity"
    );
  });

  it("preserves a direct Human mention when the same account also owns the addressed Agent", async () => {
    const record = project(
      message({ activationTargets: ["codex"], mentionTargets: ["felix"] })
    );
    for (const candidates of [
      record?.candidates ?? [],
      [...(record?.candidates ?? [])].reverse(),
    ]) {
      const recipients = await selectSpaceInboxRecipients(
        candidates,
        async () => true
      );
      expect(recipients).toHaveLength(1);
      expect(recipients[0]).toMatchObject({
        recipientUserId: "felix",
        kind: "space_mention",
        importance: "normal",
        sourceFacts: {
          recipientReasons: expect.arrayContaining([
            "human_mention",
            "agent_owner",
          ]),
          mentionedAgentProfileIds: ["codex"],
        },
      });
    }
  });

  it("admits an explicitly addressed Agent's owner to the exact Thread without subscribing other owners", async () => {
    const record = buildSpaceInboxProjectionOutboxRecord({
      ...projectionInput(message({ activationTargets: ["codex"] })),
      activeMemberRecords: [
        member("monica", "monica", "human"),
        member("codex", "felix", "agent"),
        member("other-agent", "other-owner", "agent"),
      ],
      signalContext: {
        threadContext: { threadId: "thread-1", rootSignalId: "root-1" },
        threadPlacement: "thread",
      },
      threadParticipantProfileIds: ["monica"],
    });
    const recipients = await selectSpaceInboxRecipients(
      record?.candidates ?? [],
      async () => true
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      recipientUserId: "felix",
      sourceTarget: {
        spaceId: "space-1",
        threadRootSignalId: "root-1",
        agentOwnerActivity: true,
      },
      sourceFacts: {
        personalAgentProfileIds: ["codex"],
        mentionedAgentProfileIds: ["codex"],
      },
    });
  });

  it("keeps Reference as genuine mention relevance without treating it as a new work request", async () => {
    const signal = message({ referenceTargets: ["codex"] });
    const record = project(signal);
    const recipients = await selectSpaceInboxRecipients(
      record?.candidates ?? [],
      async () => true
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      importance: "normal",
      sourceFacts: { mentionedAgentProfileIds: ["codex"] },
    });
    expect(
      recipients[0]?.sourceFacts?.firstContactAgentProfileIds ?? []
    ).toEqual([]);
    expect(signal.data.messageEnvelope?.activationTargets).toEqual([]);
  });

  it("never creates another person's Agent-contact reminder for a second Human Profile of the same account", async () => {
    const record = buildSpaceInboxProjectionOutboxRecord({
      ...projectionInput(message({ activationTargets: ["codex"] })),
      directMessage: true,
      activeMemberRecords: [
        member("monica", "felix", "human"),
        member("codex", "felix", "agent"),
      ],
    });
    expect(
      await selectSpaceInboxRecipients(
        record?.candidates ?? [],
        async () => true
      )
    ).toEqual([]);
  });

  it("does not lose independent Human mention eligibility when the addressed Agent is managed or transferred", async () => {
    const record = project(
      message({ activationTargets: ["codex"], mentionTargets: ["felix"] })
    );
    const recipients = await selectSpaceInboxRecipients(
      record?.candidates ?? [],
      async () => false
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      kind: "space_mention",
      recipientUserId: "felix",
    });
    expect(recipients[0]?.sourceTarget).not.toHaveProperty(
      "agentOwnerActivity"
    );
  });

  it("does not silently merge unrelated source identities for the same recipient", async () => {
    const record = project(message({ mentionTargets: ["felix"] }));
    const original = record?.candidates[0];
    expect(original).toBeDefined();
    await expect(
      selectSpaceInboxRecipients(
        [
          original as InboxSourceCandidate,
          {
            ...(original as InboxSourceCandidate),
            sourceKey: "different-message",
          },
        ],
        async () => true
      )
    ).rejects.toThrow("source identity");
  });
});

function projectionInput(
  signal: Extract<SignalEnvelope, { type: "signal.text" }>
) {
  return {
    activeMemberRecords: [
      member("monica", "monica", "human"),
      member("felix", "felix", "human"),
      member("codex", "felix", "agent"),
    ],
    nowMs: 2000,
    organizationId: "org-1",
    signal,
    spaceName: "Design",
  };
}

function project(
  signal: Extract<SignalEnvelope, { type: "signal.text" }>,
  members?: SpaceMemberRecord[]
) {
  return buildSpaceInboxProjectionOutboxRecord({
    ...projectionInput(signal),
    ...(members ? { activeMemberRecords: members } : {}),
  });
}

function message(input: {
  activationTargets?: string[];
  mentionTargets?: string[];
  referenceTargets?: string[];
}): Extract<SignalEnvelope, { type: "signal.text" }> {
  return {
    v: 1,
    id: "message-1",
    spaceId: "space-1",
    ts: 1000,
    type: "signal.text",
    profile: { kind: "human", profileId: "monica", profileName: "Monica" },
    data: {
      text: "Please take a look.",
      meta: { authorHasRead: true },
      messageEnvelope: {
        text: "Please take a look.",
        activationTargets: input.activationTargets ?? [],
        mentionTargets: input.mentionTargets ?? [],
        referenceTargets: input.referenceTargets ?? [],
      },
    },
  };
}

function member(
  profileId: string,
  ownerUserIdSnapshot: string,
  profileKindSnapshot: "agent" | "human"
): SpaceMemberRecord {
  return {
    addedAt: new Date(1000).toISOString(),
    addedByDisplayNameSnapshot: null,
    addedByOwnerUserId: null,
    addedByProfileId: null,
    controllerRefSnapshot: null,
    createdAt: new Date(1000).toISOString(),
    firstEnteredAt: null,
    lastEnteredAt: null,
    memberSource: "joined_directly",
    ownerNameSnapshot: ownerUserIdSnapshot,
    ownerUserIdSnapshot,
    profileId,
    profileKindSnapshot,
    profileNameSnapshot: profileId,
    removalReason: null,
    removedAt: null,
    removedByOwnerUserId: null,
    removedByProfileId: null,
    spaceId: "space-1",
    status: "active",
    updatedAt: new Date(1000).toISOString(),
  };
}
