import { describe, expect, it } from "vitest";
import {
  centerAgentPostSlackChannelMessageBodySchema,
  centerAgentPostSlackChannelMessageResponseSchema,
  listCenterAgentAuditJournalQuerySchema,
} from "../../src";

describe("Center Agent Slack channel message contracts", () => {
  it("requires a verified member speaker", () => {
    expect(
      centerAgentPostSlackChannelMessageBodySchema.parse({
        channelName: "release",
        speakerMember: { memberId: "member_123", userId: "user_123" },
        text: "The release is ready.",
      })
    ).toEqual({
      channelName: "release",
      speakerMember: { memberId: "member_123", userId: "user_123" },
      text: "The release is ready.",
    });

    expect(
      centerAgentPostSlackChannelMessageBodySchema.safeParse({
        channelName: "release",
        text: "The release is ready.",
      }).success
    ).toBe(false);
  });

  it("accepts only trusted publication source variants during the mixed rollout", () => {
    const base = {
      channelName: "release",
      speakerMember: { memberId: "member_123", userId: "user_123" },
      text: "The release is ready.",
    };
    for (const publicationSource of [
      {
        documentId: "document_release_notes",
        kind: "organization_document",
      },
      {
        executionId: "remote_agent_submission_123",
        kind: "remote_agent_execution",
      },
      {
        kind: "routine_run",
        runId: "routine_run_daily_journal",
      },
    ] as const) {
      expect(
        centerAgentPostSlackChannelMessageBodySchema.parse({
          ...base,
          publicationSource,
        })
      ).toMatchObject({ publicationSource });
    }

    expect(
      centerAgentPostSlackChannelMessageBodySchema.safeParse({
        ...base,
        publicationSource: {
          kind: "routine_run",
          publicationId: "model_chosen_id",
          runId: "routine_run_daily_journal",
        },
      }).success
    ).toBe(false);
  });

  it("keeps request and response payloads strict", () => {
    expect(
      centerAgentPostSlackChannelMessageBodySchema.safeParse({
        channelId: "C0123456789",
        channelName: "release",
        speakerMember: { memberId: "member_123", userId: "user_123" },
        text: "The release is ready.",
      }).success
    ).toBe(false);

    expect(
      centerAgentPostSlackChannelMessageResponseSchema.safeParse({
        attribution: {
          actorProfileId: "agt_22222222-2222-4222-8222-222222222222",
          onBehalfOf: null,
        },
        channelId: "C0123456789",
        channelName: "release",
        joinedChannel: false,
        messageTs: "1710000000.001",
        organizationId: "org_123",
      }).success
    ).toBe(false);
  });

  it("keeps audit action-set versions explicit", () => {
    expect(listCenterAgentAuditJournalQuerySchema.parse({})).toEqual({});
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v2" })
    ).toEqual({ actionSet: "v2" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v3" })
    ).toEqual({ actionSet: "v3" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v4" })
    ).toEqual({ actionSet: "v4" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v5" })
    ).toEqual({ actionSet: "v5" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v6" })
    ).toEqual({ actionSet: "v6" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v7" })
    ).toEqual({ actionSet: "v7" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v8" })
    ).toEqual({ actionSet: "v8" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v9" })
    ).toEqual({ actionSet: "v9" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v11" })
    ).toEqual({ actionSet: "v11" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v12" })
    ).toEqual({ actionSet: "v12" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v13" })
    ).toEqual({ actionSet: "v13" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v14" })
    ).toEqual({ actionSet: "v14" });
  });
});
