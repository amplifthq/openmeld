import type { SignalEnvelope } from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import {
  redactProfileForViewer,
  redactSignalForViewer,
} from "../space/rules/privacy/agent-profile-visibility";

const createAgentSignal = (): SignalEnvelope => ({
  v: 1,
  id: "evt-agent-1",
  spaceId: "space-1",
  ts: Date.UTC(2026, 2, 5, 0, 0, 0),
  profile: {
    kind: "agent",
    profileId: "agent-1",
    profileName: "Agent One",
    owner: "owner-1",
    ownerName: "Owner One",
    agentControllerRef: "builtin:codex",
    agentControllerConversationId: "ctx-keep-1",
    workingDirectory: "/tmp/space-agent",
  },
  type: "signal.text",
  data: { text: "hello" },
});

const OWNER_ONE_LINEAGE = {
  "human-root": null,
  "agent-parent": "human-root",
  "agent-child": "agent-parent",
  "agent-sibling": "human-root",
} as const;

describe("agent profile visibility", () => {
  it("keeps agentControllerConversationId for an ancestor in the same lineage", () => {
    const signal: SignalEnvelope = {
      ...createAgentSignal(),
      profile: {
        ...createAgentSignal().profile,
        profileId: "agent-child",
      },
    };

    const profile = redactProfileForViewer({
      profile: signal.profile,
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "human-root",
      creatorProfileIdByProfileId: OWNER_ONE_LINEAGE,
    });
    const redactedSignal = redactSignalForViewer({
      signal,
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "human-root",
      creatorProfileIdByProfileId: OWNER_ONE_LINEAGE,
    });

    expect(profile.agentControllerConversationId).toBe("ctx-keep-1");
    expect(profile.workingDirectory).toBe("/tmp/space-agent");
    expect(redactedSignal.profile.agentControllerConversationId).toBe(
      "ctx-keep-1"
    );
    expect(redactedSignal.profile.workingDirectory).toBe("/tmp/space-agent");
  });

  it("hides agentControllerConversationId for a sibling viewer under the same owner", () => {
    const signal: SignalEnvelope = {
      ...createAgentSignal(),
      profile: {
        ...createAgentSignal().profile,
        profileId: "agent-child",
      },
    };

    const profile = redactProfileForViewer({
      profile: signal.profile,
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "agent-sibling",
      creatorProfileIdByProfileId: OWNER_ONE_LINEAGE,
    });
    const redactedSignal = redactSignalForViewer({
      signal,
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "agent-sibling",
      creatorProfileIdByProfileId: OWNER_ONE_LINEAGE,
    });

    expect(profile.agentControllerConversationId).toBeUndefined();
    expect(profile.workingDirectory).toBeUndefined();
    expect(profile.owner).toBe("owner-1");
    expect(profile.agentControllerRef).toBe("builtin:codex");
    expect(
      redactedSignal.profile.agentControllerConversationId
    ).toBeUndefined();
    expect(redactedSignal.profile.workingDirectory).toBeUndefined();
    expect(redactedSignal.profile.owner).toBe("owner-1");
    expect(redactedSignal.profile.agentControllerRef).toBe("builtin:codex");
  });

  it("hides agentControllerConversationId when viewer profile metadata is missing", () => {
    const signal = createAgentSignal();

    const profile = redactProfileForViewer({
      profile: signal.profile,
      viewerOwnerUserId: "owner-1",
    });

    expect(profile.agentControllerConversationId).toBeUndefined();
  });

  it("keeps agentControllerConversationId for the agent itself", () => {
    const signal = createAgentSignal();

    const profile = redactProfileForViewer({
      profile: signal.profile,
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "agent-1",
      creatorProfileIdByProfileId: OWNER_ONE_LINEAGE,
    });

    expect(profile.agentControllerConversationId).toBe("ctx-keep-1");
  });

  it("treats whitespace-only workingDirectory as an origin fact for redaction", () => {
    const signal: SignalEnvelope = {
      ...createAgentSignal(),
      profile: {
        ...createAgentSignal().profile,
        profileId: "agent-child",
        agentControllerConversationId: undefined,
        workingDirectory: " ",
      },
    };

    const ownerProfile = redactProfileForViewer({
      profile: signal.profile,
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "human-root",
      creatorProfileIdByProfileId: OWNER_ONE_LINEAGE,
    });
    const siblingProfile = redactProfileForViewer({
      profile: signal.profile,
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "agent-sibling",
      creatorProfileIdByProfileId: OWNER_ONE_LINEAGE,
    });

    expect(ownerProfile.workingDirectory).toBe(" ");
    expect(siblingProfile.workingDirectory).toBeUndefined();
  });

  it("does not change non-agent profile", () => {
    const signal: SignalEnvelope = {
      ...createAgentSignal(),
      id: "evt-human-1",
      profile: {
        kind: "human",
        profileId: "human-1",
        profileName: "Felix",
      },
    };

    const profile = redactProfileForViewer({
      profile: signal.profile,
      viewerOwnerUserId: "owner-2",
      viewerProfileId: "human-2",
    });
    const redactedSignal = redactSignalForViewer({
      signal,
      viewerOwnerUserId: "owner-2",
      viewerProfileId: "human-2",
    });

    expect(profile).toEqual(signal.profile);
    expect(redactedSignal.profile).toEqual(signal.profile);
  });
});
