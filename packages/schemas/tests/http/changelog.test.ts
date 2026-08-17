import { describe, expect, it } from "vitest";
import {
  CHANGELOG_QUERY_MAX_LIMIT,
  CHANGELOG_QUERY_MAX_OFFSET,
  centerAgentReadChangelogToolRpcInputSchema,
  changelogIndexSchema,
  changelogQuerySchema,
} from "../../src";

const PUBLISHED_ENTRY = {
  areas: ["center-agent"],
  audiences: ["members"],
  body: "Members can ask what changed.",
  evidence: ["pr:100"],
  id: "center-agent-changelog",
  kind: "new" as const,
  publishedAt: "2026-08-18",
  title: "Ask what changed",
};

describe("Changelog contracts", () => {
  it("parses the generated index and applies the bounded default query", () => {
    expect(
      changelogIndexSchema.parse({
        entries: [PUBLISHED_ENTRY],
        schemaVersion: 1,
      })
    ).toEqual({ entries: [PUBLISHED_ENTRY], schemaVersion: 1 });
    expect(changelogQuerySchema.parse({})).toEqual({});
  });

  it("rejects drafts and unknown projection versions at runtime", () => {
    expect(
      changelogIndexSchema.safeParse({
        entries: [{ ...PUBLISHED_ENTRY, evidence: [], publishedAt: undefined }],
        schemaVersion: 1,
      }).success
    ).toBe(false);
    expect(
      changelogIndexSchema.safeParse({
        entries: [PUBLISHED_ENTRY],
        schemaVersion: 2,
      }).success
    ).toBe(false);
  });

  it("keeps the Center Agent RPC query strict and bounded", () => {
    const context = {
      activeOrganizationId: "org-1",
      actorContext: {
        agentControllerRef: "hosted:center-agent",
        callerPrincipalId: "user-1",
        ownerUserId: "user-1",
        profileKind: "agent" as const,
        requestId: "request-changelog",
        openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
      },
    };
    expect(
      centerAgentReadChangelogToolRpcInputSchema.parse({
        areas: ["channels"],
        context,
        offset: 10,
        since: "2026-08-01",
        speakerMember: { memberId: "member-1", userId: "user-1" },
      })
    ).toMatchObject({ areas: ["channels"], offset: 10 });
    expect(
      centerAgentReadChangelogToolRpcInputSchema.safeParse({
        context,
        limit: CHANGELOG_QUERY_MAX_LIMIT + 1,
        speakerMember: { memberId: "member-1", userId: "user-1" },
      }).success
    ).toBe(false);
    expect(
      centerAgentReadChangelogToolRpcInputSchema.safeParse({
        context,
        offset: CHANGELOG_QUERY_MAX_OFFSET + 1,
        speakerMember: { memberId: "member-1", userId: "user-1" },
      }).success
    ).toBe(false);
  });
});
