import { describe, expect, it, vi } from "vitest";
import { createRemoteAgentCallbackContext } from "../agent-core/callback-context";
import { getOrganizationDocumentComputerToolDefinitions } from "../flue-adapter/organization-document-computer-tools";
import type { OrganizationDocumentComputerWorkingCopyStore } from "../flue-adapter/organization-document-computer-working-copies";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";

const BASE_UPDATED_AT = "2026-08-08T10:00:00.000Z";
const WORKING_COPY_PATH =
  "/computer/spaces/space_123/documents/Launch-Plan--doc_launch--20260808T100000000Z.md";

function createContext(request = createSubmitTurnRequest()) {
  return createRemoteAgentCallbackContext({
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: "request_document_computer_tools",
      status: "pending",
      submissionId: "submission_document_computer_tools",
    },
    nowMs: TEST_NOW_MS,
    request,
  });
}

function createWorkingCopies(): OrganizationDocumentComputerWorkingCopyStore {
  return {
    checkout: vi.fn(async () => ({
      baseUpdatedAt: BASE_UPDATED_AT,
      documentId: "document-1",
      outcome: "created" as const,
      path: WORKING_COPY_PATH,
      title: "Launch Plan",
    })),
    read: vi.fn(async () => ({
      baseUpdatedAt: BASE_UPDATED_AT,
      content: "# Center Agent proposal\n",
      documentId: "document-1",
      path: WORKING_COPY_PATH,
      title: "Launch Plan",
    })),
  };
}

describe("Organization Document Computer tools", () => {
  it("checks out a formal Document into the current Computer workspace", async () => {
    const workingCopies = createWorkingCopies();
    const tools = getOrganizationDocumentComputerToolDefinitions({
      context: createContext(),
      coreWorker: {},
      workingCopies,
    });
    const checkout = tools.find(
      (tool) => tool.name === "openmeld_checkout_org_document"
    );

    await expect(
      checkout?.execute({ documentId: "document-1" })
    ).resolves.toMatchObject({ path: WORKING_COPY_PATH });
    expect(workingCopies.checkout).toHaveBeenCalledWith("document-1");
  });

  it("submits exact file content with the checkout version fence", async () => {
    const workingCopies = createWorkingCopies();
    const centerAgentDraftOrganizationDocument = vi.fn(async () => ({
      document: {
        canEditContent: false,
        canManage: false,
        createdAt: BASE_UPDATED_AT,
        folderId: null,
        hasDraft: true,
        id: "document-1",
        kind: "knowledge" as const,
        organizationId: "org_123",
        subjectUserId: null,
        title: "Launch Plan",
        updatedAt: BASE_UPDATED_AT,
      },
      draftReplaced: false,
    }));
    const tools = getOrganizationDocumentComputerToolDefinitions({
      context: createContext(),
      coreWorker: { centerAgentDraftOrganizationDocument },
      workingCopies,
    });
    const submit = tools.find(
      (tool) => tool.name === "openmeld_submit_org_document_working_copy"
    );

    await expect(
      submit?.execute({ path: WORKING_COPY_PATH })
    ).resolves.toMatchObject({
      document: { hasDraft: true, id: "document-1" },
      workingCopyPath: WORKING_COPY_PATH,
    });
    expect(centerAgentDraftOrganizationDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "document-1",
        draftContent: "# Center Agent proposal\n",
        expectedDocumentUpdatedAt: BASE_UPDATED_AT,
        speakerMember: { memberId: "member_123", userId: "user_1" },
      })
    );
  });

  it("does not expose generic working-copy submission during member research", () => {
    const base = createSubmitTurnRequest();
    const context = createContext(
      createSubmitTurnRequest({
        turnEnvelope: {
          ...base.turnEnvelope,
          trigger: {
            source: "member_research",
            subjectDisplayName: "Morgan Member",
            subjectUserId: "user_2",
            taskId: "research_task_1",
          },
        },
      })
    );

    expect(
      getOrganizationDocumentComputerToolDefinitions({
        context,
        coreWorker: {},
        workingCopies: createWorkingCopies(),
      })
    ).toEqual([]);
  });
});
