import { describe, expect, it } from "vitest";
import {
  buildCenterAgentProfileReportComputerPath,
  centerAgentDraftOrganizationDocumentResponseSchema,
  centerAgentDraftOrganizationDocumentRpcInputSchema,
  centerAgentOrganizationDocumentsComputerSnapshotResponseSchema,
  centerAgentOrganizationDocumentsComputerSnapshotRpcInputSchema,
  updateOrganizationDocumentBodySchema,
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
  it("requires the loaded document and draft versions when saving content", () => {
    const versioned = {
      content: "Human edit",
      expectedDocumentUpdatedAt: "2026-08-15T10:00:00.000Z",
      expectedDraftCreatedAt: null,
      expectedOrganizationId: "org_acme",
    };
    expect(
      updateOrganizationDocumentBodySchema.safeParse(versioned)
    ).toMatchObject({ success: true });
    expect(
      updateOrganizationDocumentBodySchema.safeParse({
        content: versioned.content,
        expectedOrganizationId: versioned.expectedOrganizationId,
      })
    ).toMatchObject({ success: false });
  });

  it("keeps the Core-assigned person folder in the member research response", () => {
    const response = centerAgentDraftOrganizationDocumentResponseSchema.parse({
      document: {
        canEditContent: true,
        canManage: false,
        createdAt: "2026-08-15T10:00:00.000Z",
        folderId: "folder_felix_test_2",
        hasDraft: true,
        id: "document_profile_report",
        kind: "member_profile",
        organizationId: "org_acme",
        profileReportDate: "2026-08-15",
        profileReportType: "work_profile",
        subjectUserId: "user_felix_test_2",
        title: "2026-08-15 — Work Profile",
        updatedAt: "2026-08-15T10:00:00.000Z",
      },
      draftReplaced: false,
      memberResearchDraft: {
        content: "# Profile Report",
        documentId: "document_profile_report",
        profileReportFolderName: "Felix Test (2)",
        subjectUserId: "user_felix_test_2",
        title: "2026-08-15 — Work Profile",
      },
    });

    expect(response.memberResearchDraft?.profileReportFolderName).toBe(
      "Felix Test (2)"
    );
    expect(
      buildCenterAgentProfileReportComputerPath({
        documentTitle: response.document.title,
        profileReportFolderName:
          response.memberResearchDraft?.profileReportFolderName ?? "",
      })
    ).toBe(
      "/computer/home/documents/Profile Reports/Felix Test (2)/2026-08-15 — Work Profile.md"
    );
  });

  it("preserves Core's collision suffix for long same-name person folders", () => {
    const longName = "A".repeat(200);
    const secondPath = buildCenterAgentProfileReportComputerPath({
      documentTitle: "2026-08-15 — Work Profile",
      profileReportFolderName: `${longName} (2)`,
    });
    const thirdPath = buildCenterAgentProfileReportComputerPath({
      documentTitle: "2026-08-15 — Work Profile",
      profileReportFolderName: `${longName} (3)`,
    });

    expect(secondPath).not.toBe(thirdPath);
    expect(secondPath).toContain(" (2)/2026-08-15 — Work Profile.md");
    expect(thirdPath).toContain(" (3)/2026-08-15 — Work Profile.md");
  });

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
