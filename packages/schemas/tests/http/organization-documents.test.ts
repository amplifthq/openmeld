import { describe, expect, it } from "vitest";
import {
  centerAgentDraftOrganizationDocumentRpcInputSchema,
  centerAgentOrganizationDocumentsComputerSnapshotResponseSchema,
  centerAgentOrganizationDocumentsComputerSnapshotRpcInputSchema,
} from "../../src";

const CENTER_AGENT_CONTEXT = {
  activeOrganizationId: "org_acme",
  actorContext: {
    agentControllerRef: "hosted:center-agent",
    callerPrincipalId: "user_owner",
    ownerUserId: "user_owner",
    profileKind: "agent" as const,
    profileName: "Center Agent",
    requestId: "request_documents_projection",
    openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
  },
};

describe("Organization Documents Computer snapshot contract", () => {
  it("accepts the designated Center Agent request context", () => {
    expect(
      centerAgentOrganizationDocumentsComputerSnapshotRpcInputSchema.safeParse({
        context: CENTER_AGENT_CONTEXT,
      })
    ).toMatchObject({ success: true });
  });

  it("accepts a version fence only as an ISO timestamp", () => {
    const input = {
      context: CENTER_AGENT_CONTEXT,
      documentId: "doc_1",
      draftContent: "Updated working copy",
      expectedDocumentUpdatedAt: "2026-08-08T10:00:00.000Z",
      speakerMember: { memberId: "member_1", userId: "user_1" },
    };
    expect(
      centerAgentDraftOrganizationDocumentRpcInputSchema.safeParse(input)
    ).toMatchObject({ success: true });
    expect(
      centerAgentDraftOrganizationDocumentRpcInputSchema.safeParse({
        ...input,
        expectedDocumentUpdatedAt: "yesterday",
      })
    ).toMatchObject({ success: false });
    expect(
      centerAgentDraftOrganizationDocumentRpcInputSchema.safeParse({
        ...input,
        documentId: undefined,
        kind: "knowledge",
        title: "New draft",
      })
    ).toMatchObject({ success: false });
  });

  it("exposes approved content without a draft channel", () => {
    const result =
      centerAgentOrganizationDocumentsComputerSnapshotResponseSchema.safeParse({
        documents: [
          {
            content: "Approved knowledge",
            folderId: null,
            id: "doc_1",
            kind: "knowledge",
            subjectUserId: null,
            title: "Launch plan",
            updatedAt: "2026-08-08T10:00:00.000Z",
          },
        ],
        folders: [],
        organizationId: "org_acme",
        revision: "a".repeat(64),
      });

    expect(result).toMatchObject({ success: true });
    expect(result.success && result.data.documents[0]).not.toHaveProperty(
      "draftContent"
    );
  });

  it("rejects unversioned snapshots and draft fields", () => {
    const base = {
      documents: [],
      folders: [],
      organizationId: "org_acme",
      revision: "unversioned",
    };
    expect(
      centerAgentOrganizationDocumentsComputerSnapshotResponseSchema.safeParse(
        base
      )
    ).toMatchObject({ success: false });
    expect(
      centerAgentOrganizationDocumentsComputerSnapshotResponseSchema.safeParse({
        ...base,
        documents: [
          {
            content: "Approved",
            draftContent: "Private draft",
            folderId: null,
            id: "doc_1",
            kind: "knowledge",
            subjectUserId: null,
            title: "Launch plan",
            updatedAt: "2026-08-08T10:00:00.000Z",
          },
        ],
        revision: "b".repeat(64),
      })
    ).toMatchObject({ success: false });
  });
});
