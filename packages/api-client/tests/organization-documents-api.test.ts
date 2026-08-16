import { describe, expect, it, vi } from "vitest";
import {
  createOpenMeldApiClient,
  createOrganizationDocumentsApi,
  type OpenMeldApiClientTransport,
} from "../src";

describe("api-client Organization Documents API", () => {
  it("preserves the loaded document and draft versions when saving content", async () => {
    const expectedDocumentUpdatedAt = "2026-08-16T09:00:00.000Z";
    const expectedDraftCreatedAt: string | null = null;
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(
        Response.json({
          document: {
            canEditContent: true,
            canManage: true,
            content: "Updated content",
            createdAt: "2026-08-16T07:00:00.000Z",
            draftContent: null,
            draftCreatedAt: null,
            draftCreatedBy: null,
            folderId: null,
            id: "document-1",
            kind: "knowledge",
            organizationId: "organization-1",
            subjectUserId: null,
            title: "Production runbook",
            updatedAt: "2026-08-16T09:01:00.000Z",
          },
        })
      )
    );
    const api = createOrganizationDocumentsApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.update({
      content: "Updated content",
      documentId: "document-1",
      expectedDocumentUpdatedAt,
      expectedDraftCreatedAt,
      expectedOrganizationId: "organization-1",
    });

    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[0].init?.body).toBe(
      JSON.stringify({
        content: "Updated content",
        expectedDocumentUpdatedAt,
        expectedDraftCreatedAt,
        expectedOrganizationId: "organization-1",
      })
    );
  });
});
