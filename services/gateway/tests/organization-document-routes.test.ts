import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "document-1";
const FOLDER_ID = "folder-1";
const FOLDER = {
  createdAt: "2026-07-14T00:00:00.000Z",
  id: FOLDER_ID,
  name: "Runbooks",
  organizationId: "org-1",
  parentFolderId: null,
  updatedAt: "2026-07-14T00:00:00.000Z",
};
const DOCUMENT = {
  canEditContent: true,
  canManage: true,
  content: "Published content",
  createdAt: "2026-07-15T00:00:00.000Z",
  draftContent: "Proposed content",
  draftCreatedAt: "2026-07-15T01:00:00.000Z",
  draftCreatedBy: "center_agent" as const,
  folderId: null,
  id: DOCUMENT_ID,
  kind: "brief" as const,
  organizationId: "org-1",
  subjectUserId: null,
  title: "Organization Brief",
  updatedAt: "2026-07-15T01:00:00.000Z",
};
const MEMBER_RESEARCH_BATCH = {
  completedCount: 0,
  createdAt: "2026-07-16T00:00:00.000Z",
  failedCount: 0,
  id: "member-research-batch-1",
  organizationId: "org-1",
  scope: "member" as const,
  status: "queued" as const,
  tasks: [
    {
      failureCode: null,
      finishedAt: null,
      id: "member-research-task-1",
      position: 1,
      startedAt: null,
      status: "queued" as const,
      subjectDisplayName: "Mira",
      subjectUserId: "owner-1",
    },
  ],
  totalCount: 1,
  updatedAt: "2026-07-16T00:00:00.000Z",
};

const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

describe("Organization document routes", () => {
  it("forwards the full HTTP surface to same-batch Core RPC methods", async () => {
    const { coreRpc, env } = makeEnv();
    const requests = [
      new Request("http://local/v1/organizations/current/documents"),
      new Request(
        `http://local/v1/organizations/current/documents/${DOCUMENT_ID}`
      ),
      jsonRequest("http://local/v1/organizations/current/documents", "POST", {
        content: "New knowledge",
        expectedOrganizationId: "org-1",
        kind: "knowledge",
        title: "Runbook",
      }),
      jsonRequest(
        `http://local/v1/organizations/current/documents/${DOCUMENT_ID}`,
        "PATCH",
        { content: "Updated content", expectedOrganizationId: "org-1" }
      ),
      jsonRequest(
        `http://local/v1/organizations/current/documents/${DOCUMENT_ID}/approve-draft`,
        "POST",
        {
          expectedDraftCreatedAt: DOCUMENT.draftCreatedAt,
          expectedOrganizationId: "org-1",
        }
      ),
      jsonRequest(
        `http://local/v1/organizations/current/documents/${DOCUMENT_ID}/discard-draft`,
        "POST",
        {
          expectedDraftCreatedAt: DOCUMENT.draftCreatedAt,
          expectedOrganizationId: "org-1",
        }
      ),
      jsonRequest(
        `http://local/v1/organizations/current/documents/${DOCUMENT_ID}`,
        "DELETE",
        { expectedOrganizationId: "org-1" }
      ),
      jsonRequest(
        "http://local/v1/organizations/current/documents/folders",
        "POST",
        {
          expectedOrganizationId: "org-1",
          name: "Runbooks",
          parentFolderId: "parent-folder-1",
        }
      ),
      jsonRequest(
        `http://local/v1/organizations/current/documents/folders/${FOLDER_ID}`,
        "PATCH",
        { expectedOrganizationId: "org-1", name: "Playbooks" }
      ),
      jsonRequest(
        `http://local/v1/organizations/current/documents/folders/${FOLDER_ID}`,
        "DELETE",
        { expectedOrganizationId: "org-1" }
      ),
      new Request("http://local/v1/organizations/current/member-research"),
      jsonRequest(
        "http://local/v1/organizations/current/member-research",
        "POST",
        {
          expectedOrganizationId: "org-1",
          scope: "member",
          subjectUserId: "owner-1",
        }
      ),
    ];

    const responses = await Promise.all(
      requests.map(
        async (request) => await app.fetch(request, env, TEST_EXECUTION_CONTEXT)
      )
    );
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 201, 200, 200, 200, 200, 201, 200, 200, 200, 202,
    ]);
    expect(coreRpc.listOrganizationDocuments).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
    });
    expect(coreRpc.getOrganizationDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: DOCUMENT_ID })
    );
    expect(coreRpc.createOrganizationDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrganizationId: "org-1",
        kind: "knowledge",
        title: "Runbook",
      })
    );
    expect(coreRpc.updateOrganizationDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Updated content",
        documentId: DOCUMENT_ID,
        expectedOrganizationId: "org-1",
      })
    );
    expect(coreRpc.approveOrganizationDocumentDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        expectedDraftCreatedAt: DOCUMENT.draftCreatedAt,
        expectedOrganizationId: "org-1",
      })
    );
    expect(coreRpc.discardOrganizationDocumentDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        expectedDraftCreatedAt: DOCUMENT.draftCreatedAt,
        expectedOrganizationId: "org-1",
      })
    );
    expect(coreRpc.createOrganizationDocumentFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrganizationId: "org-1",
        name: "Runbooks",
        parentFolderId: "parent-folder-1",
      })
    );
    expect(coreRpc.updateOrganizationDocumentFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrganizationId: "org-1",
        folderId: FOLDER_ID,
        name: "Playbooks",
      })
    );
    expect(coreRpc.deleteOrganizationDocumentFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrganizationId: "org-1",
        folderId: FOLDER_ID,
      })
    );
    expect(coreRpc.deleteOrganizationDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        expectedOrganizationId: "org-1",
      })
    );
    expect(coreRpc.getCenterAgentMemberResearchStatus).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
    });
    expect(coreRpc.startCenterAgentMemberResearch).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrganizationId: "org-1",
        scope: "member",
        subjectUserId: "owner-1",
      })
    );
  });

  it("rejects direct draft fields on human writes before Core", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      jsonRequest("http://local/v1/organizations/current/documents", "POST", {
        content: "Published content",
        draftContent: "Bypass approval",
        expectedOrganizationId: "org-1",
        kind: "knowledge",
        title: "Unsafe",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(coreRpc.createOrganizationDocument).not.toHaveBeenCalled();
  });

  it("rejects an invalid Core response instead of returning a false success", async () => {
    const { env } = makeEnv({
      listOrganizationDocuments: vi.fn(async () => ({
        documents: [{ ...DOCUMENT, draftContent: "must not be in list" }],
        organizationId: "org-1",
      })),
    });
    const response = await app.fetch(
      new Request("http://local/v1/organizations/current/documents"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(502);
  });
});

function makeEnv(coreOverrides?: Record<string, ReturnType<typeof vi.fn>>) {
  const coreRpc = {
    approveOrganizationDocumentDraft: vi.fn(async () => ({
      document: {
        ...DOCUMENT,
        content: DOCUMENT.draftContent,
        draftContent: null,
        draftCreatedAt: null,
        draftCreatedBy: null,
      },
    })),
    createOrganizationDocument: vi.fn(async () => ({ document: DOCUMENT })),
    createOrganizationDocumentFolder: vi.fn(async () => ({ folder: FOLDER })),
    updateOrganizationDocumentFolder: vi.fn(async () => ({
      folder: { ...FOLDER, name: "Playbooks" },
    })),
    deleteOrganizationDocumentFolder: vi.fn(async () => ({
      deleted: true,
      folderId: FOLDER_ID,
      organizationId: "org-1",
    })),
    deleteOrganizationDocument: vi.fn(async () => ({
      deleted: true,
      documentId: DOCUMENT_ID,
      organizationId: "org-1",
    })),
    discardOrganizationDocumentDraft: vi.fn(async () => ({
      document: {
        ...DOCUMENT,
        draftContent: null,
        draftCreatedAt: null,
        draftCreatedBy: null,
      },
    })),
    getOrganizationDocument: vi.fn(async () => ({ document: DOCUMENT })),
    getCenterAgentMemberResearchStatus: vi.fn(async () => ({
      latestBatch: MEMBER_RESEARCH_BATCH,
      organizationId: "org-1",
    })),
    listOrganizationDocuments: vi.fn(async () => ({
      canManage: true,
      currentUserId: "owner-1",
      folders: [FOLDER],
      documents: [
        {
          canEditContent: true,
          canManage: true,
          createdAt: DOCUMENT.createdAt,
          folderId: null,
          hasDraft: true,
          id: DOCUMENT.id,
          kind: DOCUMENT.kind,
          organizationId: DOCUMENT.organizationId,
          subjectUserId: null,
          title: DOCUMENT.title,
          updatedAt: DOCUMENT.updatedAt,
        },
      ],
      organizationId: "org-1",
    })),
    updateOrganizationDocument: vi.fn(async () => ({ document: DOCUMENT })),
    startCenterAgentMemberResearch: vi.fn(async () => ({
      batch: MEMBER_RESEARCH_BATCH,
    })),
    ...coreOverrides,
  };
  const authResult = {
    claims: {
      activeOrganizationId: "org-1",
      authenticated: true,
      authMethod: "session",
      ownerIds: ["owner-1"],
      requestId: "req-document-route",
    },
    ok: true,
  } as const;
  const resolvedProfile = {
    ownerUserId: "owner-1",
    profileKind: "human" as const,
    profileName: "Mira",
    openMeldProfileId: PROFILE_ID,
  };
  const authRpc = {
    resolveProfile: vi.fn(async () => ({ ok: true, resolvedProfile })),
    resolveRequestAuth: vi.fn(async () => authResult),
    resolveRequestAuthWithProfile: vi.fn(async () => ({
      ...authResult,
      profile: { ok: true, resolvedProfile },
    })),
  };
  return {
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}

function jsonRequest(
  url: string,
  method: "DELETE" | "PATCH" | "POST",
  body: unknown
): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
}
