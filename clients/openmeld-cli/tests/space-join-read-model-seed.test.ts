import type { SignalEnvelope } from "@openmeld/protocol";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
  MessageEnvelope,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSpaceJoinReadModelSeed } from "../src/space/join-read-model-seed";
import { buildFormalSignalReadPayload } from "../src/space/read-projection/formal-message-read-output";
import { buildSpaceSessionProfileIdentity } from "../src/space/session-profile";
import { buildHumanTranscriptItemFromEvent } from "../src/space/transcript/transcript-item-builder";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const SPACE_ID = "ops-room";
const HUMAN_PROFILE_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_PROFILE_ID = "agt_44444444-4444-4444-4444-444444444444";

function createMembersSnapshot(input?: {
  humanOwnerName?: string | null;
  agentOwnerName?: string | null;
}): SpaceMembersSnapshot {
  return createSpaceMembersSnapshot({
    agents: [
      createSpaceMemberAgentSnapshot({
        addedAt: "2026-04-10T00:00:00.000Z",
        addedByDisplayName: null,
        addedByOwnerUserId: null,
        addedByProfileId: null,
        agentControllerRef: "builtin:ops-bot",
        createdAt: "2026-04-10T00:00:00.000Z",
        liveNow: true,
        memberSource: "joined_directly",
        memberSourceLabel: "Joined directly",
        mentionAlias: "ops-bot",
        ownerName: input?.agentOwnerName ?? null,
        ownerUserId: "user-1",
        profileId: AGENT_PROFILE_ID,
        profileName: "ops-bot",
        updatedAt: "2026-04-10T00:00:00.000Z",
      }),
    ],
    generatedAt: "2026-04-11T00:00:00.000Z",
    humans: [
      createSpaceMemberHumanSnapshot({
        addedAt: "2026-04-10T00:00:00.000Z",
        createdAt: "2026-04-10T00:00:00.000Z",
        firstEnteredAt: "2026-04-10T00:00:00.000Z",
        lastEnteredAt: "2026-04-10T00:00:00.000Z",
        lastSeenAt: "2026-04-10T00:00:00.000Z",
        lastSeenLabel: "Seen now",
        ownerName: input?.humanOwnerName ?? "Felix",
        ownerUserId: "user-1",
        profileId: HUMAN_PROFILE_ID,
        profileName: "Felix",
        updatedAt: "2026-04-10T00:00:00.000Z",
      }),
    ],
    spaceId: SPACE_ID,
  });
}

function createSignalEnvelope(input: {
  id: string;
  profileId: string;
  profileName: string;
  profileKind: "human" | "agent" | "system";
  text: string;
  messageEnvelope?: MessageEnvelope;
  ownerUserId?: string;
  ownerName?: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: SPACE_ID,
    ts: Date.UTC(2026, 3, 11, 10, 0, 0),
    type: "signal.text",
    profile: {
      kind: input.profileKind,
      profileId: input.profileId,
      profileName: input.profileName,
      ...(input.ownerUserId ? { owner: input.ownerUserId } : {}),
      ...(input.ownerName ? { ownerName: input.ownerName } : {}),
    },
    data: {
      text: input.text,
      ...(input.messageEnvelope
        ? { messageEnvelope: input.messageEnvelope }
        : {}),
    },
  };
}

function createSeed() {
  return resolveSpaceJoinReadModelSeed({
    baseUrl: "https://example.com",
    ownerDisplayNameByUserId: new Map([["user-1", "Felix"]]),
    profileIdentity: buildSpaceSessionProfileIdentity({
      openMeldProfile: createTestOpenMeldProfile({
        openMeldProfileId: "agt_55555555-5555-4555-8555-555555555555",
        profileKind: "agent",
        profileName: "Join Seed",
        ownerUserId: "user-1",
        ownerName: "Felix",
      }),
    }),
    space: SPACE_ID,
  });
}

function createMembersResponse(input = createMembersSnapshot()): Response {
  return new Response(JSON.stringify(input), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("space join read model seed", () => {
  it("enriches owner names before seeding the initial members snapshot", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createMembersResponse(
        createMembersSnapshot({
          humanOwnerName: null,
          agentOwnerName: null,
        })
      )
    );

    const seed = createSeed();
    const snapshot = await seed.ensureMembersSnapshotLoaded();

    expect(snapshot?.humans[0]?.ownerName).toBe("Felix");
    expect(snapshot?.agents[0]?.ownerName).toBe("Felix");
    expect(seed.getMembersSnapshot()?.humans[0]?.ownerName).toBe("Felix");
    expect(seed.getMembersSnapshot()?.agents[0]?.ownerName).toBe("Felix");
    expect(seed.getMentionHighlightIndex()).not.toBeNull();
  });

  it("keeps an empty seed state when the initial snapshot fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));

    const seed = createSeed();

    await expect(seed.ensureMembersSnapshotLoaded()).rejects.toThrow("boom");
    expect(seed.getMembersSnapshot()).toBeNull();
    expect(seed.getMentionHighlightIndex()).toBeNull();
    expect([...seed.getSignalIndex().values()]).toEqual([]);
  });

  it("loads the startup members snapshot only once until an explicit refresh is requested", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        createMembersResponse(createMembersSnapshot())
      );

    const seed = createSeed();

    const firstSnapshot = await seed.ensureMembersSnapshotLoaded();
    const secondSnapshot = await seed.ensureMembersSnapshotLoaded();

    expect(firstSnapshot).toBe(secondSnapshot);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await seed.refreshMembersSnapshot();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("updates the snapshot and mention highlight index together", () => {
    const seed = createSeed();

    seed.applyMembersSnapshot(createMembersSnapshot({ agentOwnerName: null }));
    expect(seed.getMembersSnapshot()?.agents[0]?.ownerName).toBe("Felix");
    expect(seed.getMentionHighlightIndex()).not.toBeNull();

    seed.applyMembersSnapshot(null);
    expect(seed.getMembersSnapshot()).toBeNull();
    expect(seed.getMentionHighlightIndex()).toBeNull();
  });

  it("reuses the remembered signal index for reply readback", () => {
    const seed = createSeed();
    seed.applyMembersSnapshot(createMembersSnapshot());

    const source = createSignalEnvelope({
      id: "sig-source",
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileName: "ops-bot",
      text: "Earlier source",
      ownerUserId: "user-1",
    });
    const reply = createSignalEnvelope({
      id: "sig-reply",
      profileId: HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Felix",
      text: "Reply body",
      messageEnvelope: {
        text: "Reply body",
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-source",
      },
    });

    seed.rememberSignal(source);
    seed.rememberSignal(reply);

    const payload = buildFormalSignalReadPayload({
      signal: reply,
      membersSnapshot: seed.getMembersSnapshot(),
      signalIndex: seed.getSignalIndex(),
    });

    expect(payload.messageReadProjection?.replyToSignalId).toBe("sig-source");
    expect(payload.messageReadProjection?.replyToContext).toMatchObject({
      actorDisplayName: "ops-bot",
      actorProfileId: AGENT_PROFILE_ID,
      signalId: "sig-source",
    });
  });

  it("uses the refreshed snapshot identity for later transcript items", () => {
    const seed = createSeed();
    const event = createSignalEnvelope({
      id: "sig-agent",
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileName: "ops-bot",
      text: "hello",
      ownerUserId: "user-1",
    });

    seed.applyMembersSnapshot(
      createMembersSnapshot({ agentOwnerName: "Felix" })
    );
    const beforeRefresh = buildHumanTranscriptItemFromEvent({
      event,
      ownerDisplayNameByUserId: new Map(),
      selfProfileId: HUMAN_PROFILE_ID,
      sessionProfileIdentity: {
        kind: "human",
        openMeldProfileId: HUMAN_PROFILE_ID,
        ownerUserId: "user-1",
        ownerName: "Felix",
      },
      signalIndex: seed.getSignalIndex(),
      spaceMembersSnapshot: seed.getMembersSnapshot(),
    });

    seed.applyMembersSnapshot(
      createMembersSnapshot({ agentOwnerName: "Alicia" })
    );
    const afterRefresh = buildHumanTranscriptItemFromEvent({
      event,
      ownerDisplayNameByUserId: new Map(),
      selfProfileId: HUMAN_PROFILE_ID,
      sessionProfileIdentity: {
        kind: "human",
        openMeldProfileId: HUMAN_PROFILE_ID,
        ownerUserId: "user-1",
        ownerName: "Felix",
      },
      signalIndex: seed.getSignalIndex(),
      spaceMembersSnapshot: seed.getMembersSnapshot(),
    });

    expect(beforeRefresh?.profile?.ownerName).toBe("Felix");
    expect(afterRefresh?.profile?.ownerName).toBe("Alicia");
  });
});
