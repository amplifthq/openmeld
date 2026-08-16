import {
  CENTER_AGENT_CONTEXT_DEFAULT_MESSAGE_LIMIT,
  CENTER_AGENT_CONTEXT_DEFAULT_TOKEN_BUDGET,
  CENTER_AGENT_CONTEXT_ERROR_CODES,
  CENTER_AGENT_CONTEXT_LOAD_RECEIPT_VERSION,
  centerAgentActionSchema,
  centerAgentAuditJournalEntrySchema,
  createCenterAgentContextLoadReceiptBodySchema,
  createCenterAgentContextLoadReceiptResponseSchema,
  createCenterAgentContextManifestBodySchema,
  createCenterAgentContextManifestResponseSchema,
  gatewayErrorCodeSchema,
  listCenterAgentAuditJournalQuerySchema,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";

describe("Center Agent Context Manifest contracts", () => {
  it("defaults to a bounded messages projection", () => {
    expect(
      createCenterAgentContextManifestBodySchema.parse({
        source: { client: "codex", kind: "local_agent" },
      })
    ).toEqual({
      limit: CENTER_AGENT_CONTEXT_DEFAULT_MESSAGE_LIMIT,
      maxContextTokens: CENTER_AGENT_CONTEXT_DEFAULT_TOKEN_BUDGET,
      source: { client: "codex", kind: "local_agent" },
      view: "messages",
    });
  });

  it("rejects an unbounded context payload", () => {
    expect(
      createCenterAgentContextManifestBodySchema.safeParse({
        limit: 51,
        maxContextTokens: 100_000,
        source: { client: "codex", kind: "local_agent" },
      }).success
    ).toBe(false);
  });

  it("keeps raw messages attributable without exposing a local session locator", () => {
    const parsed = createCenterAgentContextManifestResponseSchema.parse({
      authorization: {
        principal: "authenticated_member",
        scope: "requester_private",
      },
      availableViews: ["messages"],
      budget: {
        estimateAlgorithm: "utf8_bytes_divided_by_3.v1",
        estimatedTokens: 42,
        includedMessages: 1,
        requestedTokens: 8000,
        truncated: false,
        truncationReasons: [],
      },
      continuation: { cursor: null, hasMore: false },
      entries: [
        {
          author: {
            profileId: "member-profile-1",
            profileKind: "human",
            profileName: "Taylor",
          },
          carrier: { client: "codex", kind: "local_agent" },
          content: {
            originalCharacterCount: 24,
            text: "Review the launch blockers.",
            truncated: false,
            type: "text",
          },
          materializedContentHash: `sha256:${"b".repeat(64)}`,
          occurredAt: "2026-08-10T01:02:03.000Z",
          redactions: ["local_session_locator_omitted"],
          sourceRef: {
            id: "signal-1",
            type: "space_signal",
            uri: "openmeld://spaces/space-1/signals/signal-1",
            version: `sha256:${"a".repeat(64)}`,
          },
        },
      ],
      generatedAt: "2026-08-10T01:02:04.000Z",
      manifestId:
        "center_agent_context_manifest_11111111-1111-4111-8111-111111111111",
      provenance: {
        auditEntryId: "audit-1",
        contentProjection: "user_visible_space_signals",
      },
      request: {
        source: {
          client: "codex",
          kind: "local_agent",
          sessionId: "private-thread-1",
        },
      },
      schemaVersion: "center_agent_context_manifest.v1",
      subject: {
        centerAgentProfileId: "agent-profile-1",
        conversationId: "space-1",
        kind: "center_agent_conversation",
        memberProfileId: "member-profile-1",
        organizationId: "org-1",
      },
      view: "messages",
    });

    expect(parsed.entries[0]?.carrier).toEqual({
      client: "codex",
      kind: "local_agent",
    });
    expect(parsed.entries[0]).not.toHaveProperty("sessionId");
  });

  it("accepts an exact Local Agent context load receipt without a session locator", () => {
    const materializedContentHash = `sha256:${"b".repeat(64)}`;
    const body = createCenterAgentContextLoadReceiptBodySchema.parse({
      selection: {
        entries: [
          {
            materializedContentHash,
            sourceRefId: "signal-1",
          },
        ],
        kind: "selected_entries",
      },
      source: {
        client: "codex",
        kind: "local_agent",
        sessionId: "private-thread-1",
      },
    });
    if (body.selection.kind !== "selected_entries") {
      throw new Error("Expected an exact selected-entry fixture.");
    }
    const selectedEntries = body.selection.entries;
    const response = createCenterAgentContextLoadReceiptResponseSchema.parse({
      authorization: {
        principal: "authenticated_member",
        scope: "requester_private",
      },
      provenance: { auditEntryId: "audit-load-1" },
      receipt: {
        client: "codex",
        estimatedTokens: 42,
        id: "center_agent_context_load_receipt_11111111-1111-4111-8111-111111111111",
        includedMessages: 1,
        manifestId:
          "center_agent_context_manifest_11111111-1111-4111-8111-111111111111",
        selectedEntries,
        status: "loaded",
      },
      recordedAt: "2026-08-10T01:02:04.000Z",
      schemaVersion: CENTER_AGENT_CONTEXT_LOAD_RECEIPT_VERSION,
    });

    expect(response.receipt.selectedEntries).toEqual(selectedEntries);
    expect(response.receipt).not.toHaveProperty("sessionId");
    expect(JSON.stringify(response)).not.toContain("private-thread-1");
  });

  it("supports an all-entries receipt and a versioned user-visible audit record", () => {
    expect(
      createCenterAgentContextLoadReceiptBodySchema.parse({
        selection: { kind: "all_manifest_entries" },
        source: { client: "claude-code", kind: "local_agent" },
      })
    ).toMatchObject({ selection: { kind: "all_manifest_entries" } });
    expect(centerAgentActionSchema.parse("load_center_agent_context")).toBe(
      "load_center_agent_context"
    );
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v16" })
    ).toEqual({ actionSet: "v16" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v17" })
    ).toEqual({ actionSet: "v17" });
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v18" })
    ).toEqual({ actionSet: "v18" });
    for (const action of [
      "create_routine",
      "update_routine",
      "pause_routine",
      "resume_routine",
      "delete_routine",
    ]) {
      expect(centerAgentActionSchema.parse(action)).toBe(action);
    }
    expect(
      centerAgentAuditJournalEntrySchema.parse({
        action: "load_center_agent_context",
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        contextLoad: {
          estimatedTokens: 42,
          includedMessages: 1,
          manifestId:
            "center_agent_context_manifest_11111111-1111-4111-8111-111111111111",
        },
        createdAt: "2026-08-10T01:02:04.000Z",
        id: "audit-load-1",
        interactionSource: { client: "codex", kind: "local_agent" },
        onBehalfOf: null,
        organizationId: "org-1",
        resource: {
          id: "center_agent_context_load_receipt_11111111-1111-4111-8111-111111111111",
          type: "center_agent_context_load_receipt",
        },
      })
    ).toMatchObject({
      action: "load_center_agent_context",
      contextLoad: { includedMessages: 1 },
    });
  });

  it("keeps every context failure readable through the shared Gateway envelope", () => {
    for (const code of CENTER_AGENT_CONTEXT_ERROR_CODES) {
      expect(gatewayErrorCodeSchema.safeParse(code).success).toBe(true);
    }
  });
});
