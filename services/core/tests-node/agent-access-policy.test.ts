import type { SignalEnvelope } from "@openmeld/protocol";
import { listAgentAccessDecisions } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { decideAgentAccess } from "../src/agent-access/application/agent-access-policy";
import type { SpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";

const feature = vi.hoisted(() => ({ enabled: true }));
vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => feature.enabled,
  isRequestChainEnforced: () => feature.enabled,
}));

const { evaluateSpaceAgentAccessGate } = await import(
  "../src/space/application/space-agent-access-gate"
);

const member = { kind: "member" as const, userId: "tali" };
const external = { kind: "external" as const, userId: "sam" };
const none = { always: false, session: false };

describe("Agent access policy (member-agent-program.md §4.6)", () => {
  it("never asks the owner as root", () => {
    expect(
      decideAgentAccess({
        directMessage: true,
        grants: none,
        ownerUserId: "felix",
        root: { kind: "member", userId: "felix" },
      })
    ).toEqual({ outcome: "allowed" });
  });

  it("asks before a colleague's Direct Message without consent", () => {
    expect(
      decideAgentAccess({
        directMessage: true,
        grants: none,
        ownerUserId: "felix",
        root: member,
      })
    ).toEqual({ outcome: "hold", kind: "direct_message" });
    for (const grants of [
      { always: true, session: false },
      { always: false, session: true },
    ]) {
      expect(
        decideAgentAccess({
          directMessage: true,
          grants,
          ownerUserId: "felix",
          root: member,
        })
      ).toEqual({ outcome: "allowed" });
    }
  });

  it("lets members use an Agent already in a group Space", () => {
    expect(
      decideAgentAccess({
        directMessage: false,
        grants: none,
        ownerUserId: "felix",
        root: member,
      })
    ).toEqual({ outcome: "allowed" });
  });

  it("asks every time for an external root, whatever was granted", () => {
    for (const directMessage of [true, false]) {
      expect(
        decideAgentAccess({
          directMessage,
          grants: { always: true, session: true },
          ownerUserId: "felix",
          root: external,
        })
      ).toEqual({ outcome: "hold", kind: "external_message" });
    }
  });

  it("offers external users Allow once and Decline only", () => {
    expect(
      listAgentAccessDecisions({
        kind: "external_message",
        requesterKind: "external",
      })
    ).toEqual(["allow_once", "decline"]);
    expect(
      listAgentAccessDecisions({
        kind: "direct_message",
        requesterKind: "member",
      })
    ).toEqual(["allow_once", "always_allow", "decline"]);
    expect(
      listAgentAccessDecisions({ kind: "space_join", requesterKind: "member" })
    ).toEqual(["join", "ignore"]);
  });
});

describe("Space consent gate entrance", () => {
  const signal: SignalEnvelope = {
    v: 1,
    id: "signal-1",
    ts: 1,
    spaceId: "space-1",
    profile: { kind: "human", profileId: "anon-profile", profileName: "Guest" },
    type: "signal.text",
    data: { text: "Hello" },
  };
  const agent = {
    profileId: "agt_felix",
    profileKindSnapshot: "agent",
    ownerUserIdSnapshot: "felix",
    status: "active",
  } as SpaceMemberRecord;

  it("holds nothing for an anonymous caller; the request chain rejects it", async () => {
    const db = { query: vi.fn() };
    await expect(
      evaluateSpaceAgentAccessGate({
        activeMembers: [agent],
        db: db as never,
        directMessage: true,
        organizationId: "org-1",
        relationship: "anonymous",
        signal,
        spaceId: "space-1",
      })
    ).resolves.toEqual(new Map());
    expect(db.query).not.toHaveBeenCalled();
  });

  it("does nothing while MemberAgents are off", async () => {
    feature.enabled = false;
    try {
      const db = { query: vi.fn() };
      await expect(
        evaluateSpaceAgentAccessGate({
          activeMembers: [agent],
          db: db as never,
          directMessage: true,
          organizationId: "org-1",
          signal,
          spaceId: "space-1",
        })
      ).resolves.toEqual(new Map());
      expect(db.query).not.toHaveBeenCalled();
    } finally {
      feature.enabled = true;
    }
  });

  it("never reads Core when every Agent belongs to the author", async () => {
    const db = { query: vi.fn() };
    await expect(
      evaluateSpaceAgentAccessGate({
        activeMembers: [
          {
            profileId: "felix-human",
            profileKindSnapshot: "human",
            ownerUserIdSnapshot: "felix",
            status: "active",
          } as SpaceMemberRecord,
          agent,
        ],
        db: db as never,
        directMessage: true,
        organizationId: "org-1",
        signal: {
          ...signal,
          profile: {
            kind: "human",
            profileId: "felix-human",
            profileName: "Felix",
          },
        },
        spaceId: "space-1",
      })
    ).resolves.toEqual(new Map());
    expect(db.query).not.toHaveBeenCalled();
  });
});
