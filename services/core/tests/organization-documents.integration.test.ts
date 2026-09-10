import { env } from "cloudflare:test";
import {
  centerAgentDraftOrganizationDocumentRpcInputSchema,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  remoteAgentWorkerSubmitTurnRequestSchema,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  prepareCenterAgentOrganizationMemberRequest,
  rpcCenterAgentAuthorizeAnonymousMemberTool,
} from "../src/center-agent/application/anonymous-member-request";
import type { CoreBindings } from "../src/lib/bindings";
import {
  beginCenterAgentOrganizationDocumentOperation,
  buildCenterAgentOrganizationDocumentRequestSignature,
  CENTER_AGENT_DOCUMENT_OPERATION_CLAIM_LEASE_MS,
  prepareCompleteCenterAgentOrganizationDocumentOperationStatement,
} from "../src/organization-documents/center-agent-document-operation-repository";
import { rpcCenterAgentManageOrganizationDocuments } from "../src/organization-documents/center-agent-document-rpc";
import { projectOrganizationDocumentDraftReview } from "../src/organization-documents/organization-document-inbox-producer";
import { reconcileOrganizationDocumentDraftInbox } from "../src/organization-documents/organization-document-inbox-reconciler";
import {
  rpcCenterAgentDraftOrganizationDocument,
  rpcCenterAgentOrganizationDocumentsComputerSnapshot,
  rpcCenterAgentReadOrganizationDocuments,
  rpcCreateOrganizationDocument,
} from "../src/organization-documents/organization-document-rpc";
import {
  createOrganizationDocumentService,
  type OrganizationDocumentActor,
} from "../src/organization-documents/organization-document-service";
// biome-ignore lint/performance/noNamespaceImport: Needed to pause the authorization read at the exact replay race boundary.
import * as nativeDeliveryLedgerRepo from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  claimRemoteAgentRoutineNativeDelivery,
  markRemoteAgentNativeDeliveryAck,
  markRemoteAgentNativeDeliveryCompleted,
  persistRemoteAgentWorkerSubmitRequest,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  rpcCenterAgentGetOrganizationDirectory,
  rpcCenterAgentListComputers,
  rpcCenterAgentReadMemberComputers,
  rpcListCenterAgentAuditJournal,
} from "../src/rpc/methods";

const ORGANIZATION_DOCUMENT_UPDATE_SQL_PATTERN =
  /UPDATE organization_documents/u;
const ISO_CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

describe("Organization documents", () => {
  it("projects a maximum-length document title within the Inbox title contract", async () => {
    const fixture = await seedFixture();
    const documentTitle = `${"A".repeat(149)}😀${"B".repeat(49)}`;
    expect(documentTitle.length).toBe(200);
    const service = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => 11_000,
    });

    await service.draft(
      fixture.organizationId,
      {
        draftContent: "A valid draft with a maximum-length document title.",
        kind: "knowledge",
        title: documentTitle,
      },
      documentReviewerUserIds(fixture)
    );

    const rows = await readDocumentReviewInboxRows(fixture.organizationId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.title.length <= 160)).toBe(true);
    expect(rows.every((row) => row.title.endsWith("…”"))).toBe(true);
    expect(rows.every((row) => row.title.startsWith("Review “"))).toBe(true);
  });

  it("creates one durable review item per current manager without exposing draft content", async () => {
    const fixture = await seedFixture();
    const draftedAtMs = 12_000;
    const service = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => draftedAtMs,
    });
    const draft = await service.draft(
      fixture.organizationId,
      {
        draftContent: "Private proposal that must stay out of Inbox previews.",
        kind: "knowledge",
        title: "Incident response",
      },
      documentReviewerUserIds(fixture)
    );

    const rows = await readDocumentReviewInboxRows(fixture.organizationId);
    expect(rows).toEqual([
      expect.objectContaining({
        attention: "action_required",
        importance: "normal",
        recipient_user_id: fixture.admin.userId,
        resolution_status: "open",
        source_key: `${draft.document.id}:${draftedAtMs}`,
        title: "Review “Incident response”",
      }),
      expect.objectContaining({
        attention: "action_required",
        importance: "normal",
        recipient_user_id: fixture.owner.userId,
        resolution_status: "open",
        source_key: `${draft.document.id}:${draftedAtMs}`,
        title: "Review “Incident response”",
      }),
    ]);
    expect(rows.every((row) => !row.preview.includes("Private proposal"))).toBe(
      true
    );
    expect(
      rows.every(
        (row) =>
          row.preview ===
          "The Center Agent prepared a document update for review."
      )
    ).toBe(true);
    expect(
      rows.some((row) => row.recipient_user_id === fixture.member.userId)
    ).toBe(false);

    await env.OPENMELD_DB.prepare(
      "UPDATE inbox_items SET read_at_ms = ? WHERE organization_id = ? AND recipient_user_id = ?"
    )
      .bind(12_100, fixture.organizationId, fixture.owner.userId)
      .run();
    await projectOrganizationDocumentDraftReview({
      db: env.OPENMELD_DB,
      draft: {
        documentId: draft.document.id,
        draftCreatedAtMs: draftedAtMs,
        organizationId: fixture.organizationId,
        title: draft.document.title,
      },
      recipientUserIds: documentReviewerUserIds(fixture),
    });
    const replayedRows = await readDocumentReviewInboxRows(
      fixture.organizationId
    );
    expect(replayedRows).toHaveLength(2);
    expect(
      replayedRows.find((row) => row.recipient_user_id === fixture.owner.userId)
    ).toMatchObject({ read_at_ms: 12_100, resolution_status: "open" });

    const pending = await service.get(fixture.owner, draft.document.id);
    await service.approveDraft(
      fixture.owner,
      draft.document.id,
      draftVersion(pending)
    );
    expect(await readDocumentReviewInboxRows(fixture.organizationId)).toEqual([
      expect.objectContaining({ resolution_status: "resolved" }),
      expect.objectContaining({ resolution_status: "resolved" }),
    ]);
  });

  it("reconciles a durable draft after the immediate Inbox projection fails", async () => {
    const fixture = await seedFixture();
    const draftedAtMs = 18_000;
    const service = createOrganizationDocumentService({
      db: createOneShotFailingBatchDb(),
      now: () => draftedAtMs,
    });

    await expect(
      service.draft(
        fixture.organizationId,
        {
          draftContent: "A durable proposal",
          kind: "knowledge",
          title: "Recovery runbook",
        },
        documentReviewerUserIds(fixture)
      )
    ).resolves.toMatchObject({
      document: { hasDraft: true, title: "Recovery runbook" },
    });
    const durableDraft = await env.OPENMELD_DB.prepare(
      `
        SELECT id, draft_created_at
        FROM organization_documents
        WHERE organization_id = ? AND title = 'Recovery runbook'
      `
    )
      .bind(fixture.organizationId)
      .first<{ draft_created_at: number; id: string }>();
    expect(durableDraft).toMatchObject({ draft_created_at: draftedAtMs });
    expect(await readDocumentReviewInboxRows(fixture.organizationId)).toEqual(
      []
    );

    await expect(
      reconcileOrganizationDocumentDraftInbox({
        authWorker: createDocumentReviewDirectoryAuthWorker(),
        db: env.OPENMELD_DB,
        nowMs: draftedAtMs + 60_000,
      })
    ).resolves.toMatchObject({ errors: 0 });
    expect(await readDocumentReviewInboxRows(fixture.organizationId)).toEqual([
      expect.objectContaining({
        recipient_user_id: fixture.admin.userId,
        resolution_status: "open",
      }),
      expect.objectContaining({
        recipient_user_id: fixture.owner.userId,
        resolution_status: "open",
      }),
    ]);
  });

  it("saves the canonical draft before resolving reviewers and recovers a failed directory projection", async () => {
    const fixture = await seedFixture();
    const draftedAtMs = 18_500;
    const service = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => draftedAtMs,
    });
    let draftWasDurableBeforeDirectoryRead = false;

    await expect(
      service.draft(
        fixture.organizationId,
        {
          draftContent: "A proposal whose reviewer lookup can recover",
          kind: "knowledge",
          title: "Directory recovery",
        },
        async () => {
          const row = await env.OPENMELD_DB.prepare(
            `
              SELECT draft_created_at
              FROM organization_documents
              WHERE organization_id = ? AND title = 'Directory recovery'
            `
          )
            .bind(fixture.organizationId)
            .first<{ draft_created_at: number | null }>();
          draftWasDurableBeforeDirectoryRead =
            row?.draft_created_at === draftedAtMs;
          throw new Error("directory unavailable");
        }
      )
    ).resolves.toMatchObject({
      document: { hasDraft: true, title: "Directory recovery" },
    });
    expect(draftWasDurableBeforeDirectoryRead).toBe(true);
    expect(await readDocumentReviewInboxRows(fixture.organizationId)).toEqual(
      []
    );

    await expect(
      reconcileOrganizationDocumentDraftInbox({
        authWorker: createDocumentReviewDirectoryAuthWorker(),
        db: env.OPENMELD_DB,
        nowMs: draftedAtMs + 60_000,
      })
    ).resolves.toMatchObject({ errors: 0 });
    expect(await readDocumentReviewInboxRows(fixture.organizationId)).toEqual([
      expect.objectContaining({
        recipient_user_id: fixture.admin.userId,
        resolution_status: "open",
      }),
      expect.objectContaining({
        recipient_user_id: fixture.owner.userId,
        resolution_status: "open",
      }),
    ]);
  });

  it("resolves an orphaned review item after approval commits but its fast projection fails", async () => {
    const fixture = await seedFixture();
    const draftedAtMs = 19_000;
    const draftService = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => draftedAtMs,
    });
    const draft = await draftService.draft(
      fixture.organizationId,
      {
        draftContent: "Approved content",
        kind: "knowledge",
        title: "Approval recovery",
      },
      documentReviewerUserIds(fixture)
    );
    const pending = await draftService.get(fixture.owner, draft.document.id);
    const approvingService = createOrganizationDocumentService({
      db: createOneShotFailingBatchDb(),
      now: () => draftedAtMs + 1000,
    });

    await expect(
      approvingService.approveDraft(
        fixture.owner,
        draft.document.id,
        draftVersion(pending)
      )
    ).resolves.toMatchObject({
      content: "Approved content",
      draftContent: null,
    });
    await expect(
      draftService.get(fixture.owner, draft.document.id)
    ).resolves.toMatchObject({
      content: "Approved content",
      draftContent: null,
    });
    expect(await readDocumentReviewInboxRows(fixture.organizationId)).toEqual([
      expect.objectContaining({ resolution_status: "open" }),
      expect.objectContaining({ resolution_status: "open" }),
    ]);

    await expect(
      reconcileOrganizationDocumentDraftInbox({
        authWorker: createDocumentReviewDirectoryAuthWorker(),
        db: env.OPENMELD_DB,
        nowMs: draftedAtMs + 60_000,
      })
    ).resolves.toMatchObject({ errors: 0 });
    expect(await readDocumentReviewInboxRows(fixture.organizationId)).toEqual([
      expect.objectContaining({ resolution_status: "resolved" }),
      expect.objectContaining({ resolution_status: "resolved" }),
    ]);
  });

  it("removes former reviewers and adds newly promoted managers", async () => {
    const fixture = await seedFixture();
    const draftedAtMs = 20_000;
    const service = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => draftedAtMs,
    });
    await service.draft(
      fixture.organizationId,
      {
        draftContent: "Pending manager review",
        kind: "knowledge",
        title: "Reviewer changes",
      },
      documentReviewerUserIds(fixture)
    );
    await env.OPENMELD_DB.prepare(
      "UPDATE members SET role = 'member' WHERE organization_id = ? AND user_id = ?"
    )
      .bind(fixture.organizationId, fixture.admin.userId)
      .run();

    await expect(
      reconcileOrganizationDocumentDraftInbox({
        authWorker: createDocumentReviewDirectoryAuthWorker(),
        db: env.OPENMELD_DB,
        nowMs: draftedAtMs + 60_000,
      })
    ).resolves.toMatchObject({ errors: 0 });
    expect(await readDocumentReviewInboxRows(fixture.organizationId)).toEqual([
      expect.objectContaining({
        recipient_user_id: fixture.admin.userId,
        resolution_status: "resolved",
      }),
      expect.objectContaining({
        recipient_user_id: fixture.owner.userId,
        resolution_status: "open",
      }),
    ]);

    await env.OPENMELD_DB.prepare(
      "UPDATE members SET role = 'admin' WHERE organization_id = ? AND user_id = ?"
    )
      .bind(fixture.organizationId, fixture.member.userId)
      .run();
    await expect(
      reconcileOrganizationDocumentDraftInbox({
        authWorker: createDocumentReviewDirectoryAuthWorker(),
        db: env.OPENMELD_DB,
        nowMs: draftedAtMs + 120_000,
      })
    ).resolves.toMatchObject({ errors: 0 });
    expect(await readDocumentReviewInboxRows(fixture.organizationId)).toEqual([
      expect.objectContaining({
        recipient_user_id: fixture.admin.userId,
        resolution_status: "resolved",
      }),
      expect.objectContaining({
        recipient_user_id: fixture.member.userId,
        resolution_status: "open",
      }),
      expect.objectContaining({
        recipient_user_id: fixture.owner.userId,
        resolution_status: "open",
      }),
    ]);
  });

  it("keeps Center Agent drafts separate until an owner approves them", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const brief = await service.create(fixture.owner, {
      content: "Published brief",
      kind: "brief",
    });

    await expect(
      service.draft(
        fixture.organizationId,
        {
          documentId: brief.id,
          draftContent: "Proposed replacement",
        },
        documentReviewerUserIds(fixture)
      )
    ).resolves.toMatchObject({ draftReplaced: false });
    const pending = await service.get(fixture.owner, brief.id);
    expect(pending).toMatchObject({
      content: "Published brief",
      draftContent: "Proposed replacement",
    });
    await expect(
      service.readPromptContext(fixture.organizationId)
    ).resolves.toMatchObject({ briefContent: "Published brief" });

    await expect(
      service.approveDraft(fixture.owner, brief.id, draftVersion(pending))
    ).resolves.toMatchObject({
      content: "Proposed replacement",
      draftContent: null,
    });
    await expect(
      service.readPromptContext(fixture.organizationId)
    ).resolves.toMatchObject({ briefContent: "Proposed replacement" });
  });

  it("versions only approved organization content for the Center Agent Computer", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const folder = await service.createFolder(fixture.owner, {
      name: "Launch Plans",
    });
    const document = await service.create(fixture.owner, {
      content: "Approved version one",
      folderId: folder.id,
      kind: "knowledge",
      title: "Production launch",
    });
    await service.draft(
      fixture.organizationId,
      {
        documentId: document.id,
        draftContent: "Private pending proposal",
      },
      documentReviewerUserIds(fixture)
    );
    const coreEnv = {
      OPENMELD_DB: env.OPENMELD_DB,
    } as CoreBindings;
    const context = requestContext(
      fixture.organizationId,
      fixture.centerAgentProfileId
    );

    const first = await rpcCenterAgentOrganizationDocumentsComputerSnapshot(
      coreEnv,
      { context }
    );
    const replay = await rpcCenterAgentOrganizationDocumentsComputerSnapshot(
      coreEnv,
      { context }
    );
    expect(first).toMatchObject({
      documents: [
        {
          content: "Approved version one",
          folderId: folder.id,
          id: document.id,
          title: "Production launch",
        },
      ],
      folders: [{ id: folder.id, name: "Launch Plans" }],
      organizationId: fixture.organizationId,
    });
    expect(first.documents[0]).not.toHaveProperty("draftContent");
    expect(replay.revision).toBe(first.revision);

    const currentDocument = await service.get(fixture.owner, document.id);
    await service.update(fixture.owner, document.id, {
      content: "Approved version two",
      ...humanDocumentVersion(currentDocument),
    });
    const updated = await rpcCenterAgentOrganizationDocumentsComputerSnapshot(
      coreEnv,
      { context }
    );
    expect(updated.documents[0]?.content).toBe("Approved version two");
    expect(updated.revision).not.toBe(first.revision);

    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT COUNT(*) AS count
          FROM center_agent_audit_journal
          WHERE organization_id = ?
            AND action = 'read_org_documents'
            AND resource_type = 'organization_document_computer_snapshot'
        `
      )
        .bind(fixture.organizationId)
        .first<{ count: number }>()
    ).resolves.toEqual({ count: 3 });
  });

  it("rejects a Computer working copy after the formal document changes", async () => {
    const fixture = await seedFixture();
    const initialService = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => 10_000,
    });
    const document = await initialService.create(fixture.owner, {
      content: "Original approved plan",
      kind: "knowledge",
      title: "Launch plan",
    });
    const humanService = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => 20_000,
    });
    await humanService.update(fixture.owner, document.id, {
      content: "Human's newer approved plan",
      ...humanDocumentVersion(document),
    });
    const centerAgentService = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => 30_000,
    });

    await expect(
      centerAgentService.draft(
        fixture.organizationId,
        {
          documentId: document.id,
          draftContent: "Stale Computer proposal",
          expectedDocumentUpdatedAt: document.updatedAt,
        },
        documentReviewerUserIds(fixture)
      )
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.working_copy_conflict",
        status: 409,
      },
    });
    await expect(
      humanService.get(fixture.owner, document.id)
    ).resolves.toMatchObject({
      content: "Human's newer approved plan",
      draftContent: null,
    });

    const currentWorkingCopy = {
      documentId: document.id,
      draftContent: "Proposal based on the current version",
      expectedDocumentUpdatedAt: new Date(20_000).toISOString(),
    };
    await expect(
      centerAgentService.draft(
        fixture.organizationId,
        currentWorkingCopy,
        documentReviewerUserIds(fixture)
      )
    ).resolves.toMatchObject({
      document: { hasDraft: true },
      draftReplaced: false,
    });
    await expect(
      centerAgentService.draft(
        fixture.organizationId,
        currentWorkingCopy,
        documentReviewerUserIds(fixture)
      )
    ).resolves.toMatchObject({
      document: { hasDraft: true },
      draftReplaced: false,
    });
  });

  it("does not advertise a draft-only document title in the system prompt", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const draft = await service.draft(
      fixture.organizationId,
      {
        draftContent: "Pending knowledge",
        kind: "knowledge",
        title: "Pending runbook",
      },
      documentReviewerUserIds(fixture)
    );

    await expect(
      service.readPromptContext(fixture.organizationId)
    ).resolves.toEqual({ briefContent: null, documentTitles: [] });

    const pending = await service.get(fixture.owner, draft.document.id);
    await service.approveDraft(
      fixture.owner,
      draft.document.id,
      draftVersion(pending)
    );
    await expect(
      service.readPromptContext(fixture.organizationId)
    ).resolves.toEqual({
      briefContent: null,
      documentTitles: ["Pending runbook"],
    });
  });

  it("lets a member edit only their own member profile content", async () => {
    const fixture = await seedFixture();
    const service = createService();
    await expect(
      service.create(fixture.member, {
        content: "I should not create my own profile.",
        kind: "member_profile",
        subjectUserId: fixture.member.userId,
      })
    ).rejects.toMatchObject({ cause: { status: 403 } });
    const profile = await service.create(fixture.owner, {
      content: "Original about text",
      kind: "member_profile",
      subjectUserId: fixture.member.userId,
    });
    expect(profile.profileReportDate).toMatch(ISO_CALENDAR_DATE_PATTERN);
    expect(profile.profileReportType).toBe("work_profile");
    expect(profile.title).toBe(
      `${profile.profileReportDate as string} — Work Profile`
    );
    const otherProfile = await service.create(fixture.owner, {
      content: "Owner profile",
      kind: "member_profile",
      subjectUserId: fixture.owner.userId,
    });

    await expect(
      service.update(fixture.member, profile.id, {
        content: "I updated my own about text.",
        ...humanDocumentVersion(profile),
      })
    ).resolves.toMatchObject({ content: "I updated my own about text." });
    await expect(
      service.update(fixture.member, profile.id, { title: "A new title" })
    ).rejects.toMatchObject({ cause: { status: 403 } });
    await expect(
      service.update(fixture.member, otherProfile.id, {
        content: "Not mine",
      })
    ).rejects.toMatchObject({ cause: { status: 403 } });
    await expect(
      service.delete(fixture.member, profile.id)
    ).rejects.toMatchObject({ cause: { status: 403 } });
  });

  it("gives same-day Profile Reports distinct human-readable titles", async () => {
    const fixture = await seedFixture();
    const reportTimestamp = Date.UTC(2026, 7, 14, 12, 30, 0);
    const service = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => reportTimestamp,
    });

    const first = await service.create(fixture.owner, {
      content: "First angle",
      kind: "member_profile",
      subjectUserId: fixture.member.userId,
    });
    const second = await service.create(fixture.owner, {
      content: "Second angle",
      kind: "member_profile",
      subjectUserId: fixture.member.userId,
    });

    expect(first.title).toBe("2026-08-14 — Work Profile");
    expect(second.title).toBe("2026-08-14 — Work Profile (2)");
  });

  it("gives different members with the same display name distinct managed folders", async () => {
    const fixture = await seedFixture();
    const sameNameUserId = `same_name_${crypto.randomUUID()}`;
    const timestamp = Date.UTC(2026, 7, 14, 12, 30, 0);
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(
        sameNameUserId,
        "Morgan Member",
        `${sameNameUserId}@example.com`,
        1,
        timestamp,
        timestamp
      ),
      env.OPENMELD_DB.prepare(
        "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)"
      ).bind(
        `membership_${sameNameUserId}`,
        fixture.organizationId,
        sameNameUserId,
        timestamp
      ),
    ]);
    const service = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => timestamp,
    });

    const first = await service.create(fixture.owner, {
      content: "First Morgan",
      kind: "member_profile",
      subjectUserId: fixture.member.userId,
    });
    const second = await service.create(fixture.owner, {
      content: "Second Morgan",
      kind: "member_profile",
      subjectUserId: sameNameUserId,
    });
    const folders = await service.listFolders(fixture.owner);
    const firstFolder = folders.find((folder) => folder.id === first.folderId);
    const secondFolder = folders.find(
      (folder) => folder.id === second.folderId
    );

    expect(firstFolder?.name).toBe("Morgan Member");
    expect(secondFolder?.name).toBe("Morgan Member (2)");
  });

  it("turns a Profile Report draft into the editable working report when its subject saves", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const profile = await service.create(fixture.owner, {
      content: "Earlier working report",
      kind: "member_profile",
      subjectUserId: fixture.member.userId,
    });
    const draftedAtMs = Date.parse(profile.updatedAt) + 1000;
    const draftingService = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => draftedAtMs,
    });
    await draftingService.draft(
      fixture.organizationId,
      {
        documentId: profile.id,
        draftContent: "What the Center Agent learned",
      },
      documentReviewerUserIds(fixture)
    );
    const pending = await service.get(fixture.member, profile.id);
    expect(await readDocumentReviewInboxRows(fixture.organizationId)).toEqual([
      expect.objectContaining({
        recipient_user_id: fixture.admin.userId,
        resolution_status: "open",
        source_key: `${profile.id}:${draftedAtMs}`,
      }),
      expect.objectContaining({
        recipient_user_id: fixture.owner.userId,
        resolution_status: "open",
        source_key: `${profile.id}:${draftedAtMs}`,
      }),
    ]);

    await expect(
      service.update(fixture.member, profile.id, {
        content: pending.draftContent as string,
        ...humanDocumentVersion(pending),
      })
    ).resolves.toMatchObject({
      content: "What the Center Agent learned",
      draftContent: null,
      draftCreatedAt: null,
      draftCreatedBy: null,
    });
    expect(await readDocumentReviewInboxRows(fixture.organizationId)).toEqual([
      expect.objectContaining({ resolution_status: "resolved" }),
      expect.objectContaining({ resolution_status: "resolved" }),
    ]);
  });

  it("keeps a newer Profile Report draft when an older editor tries to save", async () => {
    const fixture = await seedFixture();
    let nowMs = 10_000;
    const service = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => nowMs,
    });
    const profile = await service.create(fixture.owner, {
      content: "Earlier working report",
      kind: "member_profile",
      subjectUserId: fixture.member.userId,
    });
    nowMs = 20_000;
    await service.draft(
      fixture.organizationId,
      {
        documentId: profile.id,
        draftContent: "First draft loaded in the editor",
      },
      documentReviewerUserIds(fixture)
    );
    const editorCopy = await service.get(fixture.member, profile.id);
    nowMs = 30_000;
    await service.draft(
      fixture.organizationId,
      {
        documentId: profile.id,
        draftContent: "Newer research that must be preserved",
      },
      documentReviewerUserIds(fixture)
    );

    await expect(
      service.update(fixture.member, profile.id, {
        content: "Stale editor content",
        ...humanDocumentVersion(editorCopy),
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.working_copy_conflict",
        status: 409,
      },
    });
    await expect(
      service.get(fixture.member, profile.id)
    ).resolves.toMatchObject({
      content: "Earlier working report",
      draftContent: "Newer research that must be preserved",
      draftCreatedAt: new Date(30_000).toISOString(),
    });
  });

  it("supports manager CRUD and keeps draft review manager-only", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const document = await service.create(fixture.owner, {
      content: "Approved runbook",
      kind: "knowledge",
      title: "Runbook",
    });

    await expect(service.list(fixture.member)).resolves.toContainEqual(
      expect.objectContaining({ id: document.id, title: "Runbook" })
    );
    await expect(
      service.get(fixture.member, document.id)
    ).resolves.toMatchObject({ content: "Approved runbook" });
    await expect(
      service.update(fixture.admin, document.id, {
        content: "Admin edit",
        ...humanDocumentVersion(document),
        title: "Operations runbook",
      })
    ).resolves.toMatchObject({
      content: "Admin edit",
      title: "Operations runbook",
    });

    await service.draft(
      fixture.organizationId,
      {
        documentId: document.id,
        draftContent: "Center Agent proposal",
      },
      documentReviewerUserIds(fixture)
    );
    const pending = await service.get(fixture.owner, document.id);
    await expect(
      service.approveDraft(fixture.member, document.id, draftVersion(pending))
    ).rejects.toMatchObject({ cause: { status: 403 } });
    await expect(
      service.discardDraft(fixture.admin, document.id, draftVersion(pending))
    ).resolves.toMatchObject({
      content: "Admin edit",
      draftContent: null,
    });

    await service.delete(fixture.owner, document.id);
    await expect(
      service.get(fixture.member, document.id)
    ).rejects.toMatchObject({ cause: { status: 404 } });
  });

  it("does not write unrequested columns during partial updates", async () => {
    const fixture = await seedFixture();
    const updateStatements: string[] = [];
    const db = {
      prepare: (query: string) => {
        if (ORGANIZATION_DOCUMENT_UPDATE_SQL_PATTERN.test(query)) {
          updateStatements.push(query);
        }
        return env.OPENMELD_DB.prepare(query);
      },
    } as unknown as D1Database;
    const service = createOrganizationDocumentService({ db });
    const document = await service.create(fixture.owner, {
      content: "Approved runbook",
      kind: "knowledge",
      title: "Runbook",
    });

    const renamedDocument = await service.update(fixture.owner, document.id, {
      title: "Operations runbook",
    });
    await service.update(fixture.owner, document.id, {
      content: "Updated content",
      ...humanDocumentVersion(renamedDocument),
    });

    expect(updateStatements).toHaveLength(2);
    expect(updateStatements[0]).toContain("title = ?");
    expect(updateStatements[0]).not.toContain("content = ?");
    expect(updateStatements[1]).toContain("content = ?");
    expect(updateStatements[1]).not.toContain("title = ?");
  });

  it("keeps one Organization Brief and preserves dated Profile Report history", async () => {
    const fixture = await seedFixture();
    const service = createService();
    await service.create(fixture.owner, { content: "First", kind: "brief" });
    const firstProfile = await service.create(fixture.owner, {
      content: "About",
      kind: "member_profile",
      subjectUserId: fixture.member.userId,
    });

    await expect(
      service.create(fixture.owner, { content: "Second", kind: "brief" })
    ).rejects.toMatchObject({
      cause: { code: "organization_document.brief_exists", status: 409 },
    });
    const secondProfile = await service.create(fixture.owner, {
      content: "Duplicate",
      kind: "member_profile",
      subjectUserId: fixture.member.userId,
    });
    expect(secondProfile.id).not.toBe(firstProfile.id);
    expect(secondProfile.folderId).toBe(firstProfile.folderId);
    const profileFolders = (await service.listFolders(fixture.owner)).filter(
      (folder) => folder.isManaged
    );
    expect(profileFolders).toHaveLength(2);
    const profileReportsRoot = profileFolders.find(
      (folder) => folder.name === "Profile Reports"
    );
    const memberFolder = profileFolders.find(
      (folder) => folder.id === firstProfile.folderId
    );
    expect(memberFolder?.parentFolderId).toBe(profileReportsRoot?.id);
    await expect(
      service.renameFolder(fixture.owner, memberFolder?.id ?? "", {
        name: "Moved reports",
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_document.managed_placement", status: 409 },
    });
    await expect(
      service.createFolder(fixture.owner, {
        name: "Manual child",
        parentFolderId: profileReportsRoot?.id,
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_document.managed_placement", status: 409 },
    });
    const knowledge = await service.create(fixture.owner, {
      content: "Ordinary knowledge",
      kind: "knowledge",
      title: "Runbook",
    });
    await expect(
      service.update(fixture.owner, knowledge.id, {
        folderId: memberFolder?.id,
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_document.managed_placement", status: 409 },
    });
    const memberReports = (await service.list(fixture.owner)).filter(
      (document) =>
        document.kind === "member_profile" &&
        document.subjectUserId === fixture.member.userId
    );
    expect(memberReports).toHaveLength(2);
  });

  it("preserves an ordinary Profile Reports folder when managed reports begin", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const ordinaryRoot = await service.createFolder(fixture.owner, {
      name: "Profile Reports",
    });
    const ordinaryOpenMeldRoot = await service.createFolder(fixture.owner, {
      name: "OpenMeld Profile Reports",
    });
    const ordinaryChild = await service.createFolder(fixture.owner, {
      name: "Imported notes",
      parentFolderId: ordinaryRoot.id,
    });
    const ordinaryDocument = await service.create(fixture.owner, {
      content: "A user-managed profile note.",
      folderId: ordinaryRoot.id,
      kind: "knowledge",
      title: "Legacy profile notes",
    });

    const profile = await service.create(fixture.owner, {
      content: "The first managed report.",
      kind: "member_profile",
      subjectUserId: fixture.member.userId,
    });

    const folders = await service.listFolders(fixture.owner);
    const currentOrdinaryDocument = await service.get(
      fixture.owner,
      ordinaryDocument.id
    );
    const preservedRoot = folders.find(
      (folder) => folder.id === ordinaryRoot.id
    );
    const preservedOpenMeldRoot = folders.find(
      (folder) => folder.id === ordinaryOpenMeldRoot.id
    );
    const preservedChild = folders.find(
      (folder) => folder.id === ordinaryChild.id
    );
    const managedRoot = folders.find(
      (folder) => folder.isManaged && folder.parentFolderId === null
    );
    const personFolder = folders.find(
      (folder) => folder.id === profile.folderId
    );
    expect(preservedRoot).toMatchObject({
      isManaged: false,
      name: "Profile Reports",
    });
    expect(preservedOpenMeldRoot).toMatchObject({
      isManaged: false,
      name: "OpenMeld Profile Reports",
    });
    expect(preservedChild?.parentFolderId).toBe(ordinaryRoot.id);
    expect(currentOrdinaryDocument.folderId).toBe(ordinaryRoot.id);
    expect(managedRoot).toMatchObject({
      name: "OpenMeld Profile Reports (2)",
    });
    expect(managedRoot?.id).not.toBe(ordinaryRoot.id);
    expect(personFolder?.parentFolderId).toBe(managedRoot?.id);
  });

  it("replaces the pending draft and rejects review of a stale version", async () => {
    const fixture = await seedFixture();
    let timestamp = 10_000;
    const service = createOrganizationDocumentService({
      db: env.OPENMELD_DB,
      now: () => timestamp++,
    });
    const document = await service.create(fixture.owner, {
      content: "Approved",
      kind: "knowledge",
      title: "Runbook",
    });
    await service.draft(
      fixture.organizationId,
      {
        documentId: document.id,
        draftContent: "Draft A",
      },
      documentReviewerUserIds(fixture)
    );
    const draftA = await service.get(fixture.owner, document.id);

    await expect(
      service.draft(
        fixture.organizationId,
        {
          documentId: document.id,
          draftContent: "Draft B",
        },
        documentReviewerUserIds(fixture)
      )
    ).resolves.toMatchObject({ draftReplaced: true });
    const draftB = await service.get(fixture.owner, document.id);
    expect(draftB).toMatchObject({
      content: "Approved",
      draftContent: "Draft B",
    });
    await expect(
      service.approveDraft(fixture.owner, document.id, draftVersion(draftA))
    ).rejects.toMatchObject({
      cause: { code: "organization_document.draft_changed", status: 409 },
    });
    await expect(
      service.approveDraft(fixture.owner, document.id, draftVersion(draftB))
    ).resolves.toMatchObject({ content: "Draft B", draftContent: null });
  });

  it("rejects a human write when the active Organization changed", async () => {
    const fixture = await seedFixture();
    await expect(
      rpcCreateOrganizationDocument(
        { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings,
        {
          content: "Must not cross Organizations",
          context: humanRequestContext(
            fixture.organizationId,
            fixture.ownerHumanProfileId,
            fixture.owner.userId
          ),
          expectedOrganizationId: "another-organization",
          kind: "knowledge",
          title: "Wrong scope",
        }
      )
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.organization_context_changed",
        status: 409,
      },
    });
  });

  it("caps knowledge documents and each formal or draft body", async () => {
    const fixture = await seedFixture();
    const service = createService();
    for (let index = 1; index <= 50; index += 1) {
      await service.create(fixture.owner, {
        content: `Knowledge ${index}`,
        kind: "knowledge",
        title: `Knowledge ${index}`,
      });
    }

    await expect(
      service.create(fixture.owner, {
        content: "One too many",
        kind: "knowledge",
        title: "Knowledge 51",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.knowledge_limit_reached",
        status: 409,
      },
    });
    await expect(
      service.create(fixture.owner, {
        content: "x".repeat(20_001),
        kind: "knowledge",
        title: "Too long",
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_document.content_too_long", status: 400 },
    });
    const brief = await service.create(fixture.owner, {
      content: "Brief",
      kind: "brief",
    });
    await expect(
      service.draft(
        fixture.organizationId,
        {
          documentId: brief.id,
          draftContent: "x".repeat(20_001),
        },
        documentReviewerUserIds(fixture)
      )
    ).rejects.toMatchObject({
      cause: { code: "organization_document.content_too_long", status: 400 },
    });
  });

  it("rejects direct formal content on the Center Agent draft contract", () => {
    const parsed = centerAgentDraftOrganizationDocumentRpcInputSchema.safeParse(
      {
        content: "This must never be writable by the Center Agent.",
        context: requestContext("org-contract", "agent-contract"),
        documentId: "doc-contract",
        draftContent: "A reviewable proposal.",
        speakerMember: {
          memberId: "member-contract",
          userId: "user-contract",
        },
      }
    );

    expect(parsed.success).toBe(false);
  });

  it("lets an authorized Center Agent manage folders and save approved knowledge idempotently", async () => {
    const fixture = await seedFixture();
    const coreEnv = { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings;
    const context = requestContext(
      fixture.organizationId,
      fixture.centerAgentProfileId
    );
    const speakerMember = {
      memberId: fixture.ownerMemberId,
      userId: fixture.owner.userId,
    };

    const folder = await rpcCenterAgentManageOrganizationDocuments(coreEnv, {
      action: "create_folder",
      context,
      name: "OK Eight Team Learning Journal",
      operationId: "create-learning-folder",
      speakerMember,
    });
    if (folder.action !== "create_folder") {
      throw new Error("Expected a folder creation response.");
    }
    const replay = await rpcCenterAgentManageOrganizationDocuments(coreEnv, {
      action: "create_folder",
      context,
      name: "OK Eight Team Learning Journal",
      operationId: "create-learning-folder",
      speakerMember,
    });
    expect(replay).toEqual(folder);
    await expect(
      rpcCenterAgentManageOrganizationDocuments(coreEnv, {
        action: "create_folder",
        context,
        name: "Launch Notes",
        operationId: "create-launch-notes-folder",
        parentFolderId: folder.folder.id,
        speakerMember,
      })
    ).resolves.toMatchObject({
      action: "create_folder",
      folder: { parentFolderId: folder.folder.id },
    });
    await expect(
      rpcCenterAgentManageOrganizationDocuments(coreEnv, {
        action: "create_folder",
        context,
        name: "Different folder",
        operationId: "create-learning-folder",
        speakerMember,
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.operation_conflict",
        status: 409,
      },
    });

    await expect(
      rpcCenterAgentManageOrganizationDocuments(coreEnv, {
        action: "save_document",
        content: "This request has no active turn authority.",
        context,
        folderId: folder.folder.id,
        operationId: "save-without-turn-authority",
        speakerMember,
        title: "Unauthorized journal",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.direct_save_not_authorized",
        status: 403,
      },
    });

    const delivery = await seedAcceptedLocalAgentDocumentDelivery(fixture);
    const authorizedContext = requestContext(
      fixture.organizationId,
      fixture.centerAgentProfileId,
      delivery.submissionId
    );
    const saved = await rpcCenterAgentManageOrganizationDocuments(coreEnv, {
      action: "save_document",
      content: "Approved daily learning.",
      context: authorizedContext,
      folderId: folder.folder.id,
      operationId: "save-learning-document",
      speakerMember,
      title: "2026-07-23 | OK Eight Team Learning Journal",
    });
    if (saved.action !== "save_document") {
      throw new Error("Expected a document save response.");
    }
    expect(saved).toMatchObject({
      document: {
        content: "Approved daily learning.",
        folderId: folder.folder.id,
        kind: "knowledge",
      },
      outcome: "created",
    });
    await markRemoteAgentNativeDeliveryCompleted({
      db: env.OPENMELD_DB,
      nowMs: 2002,
      publishedSignalId: saved.document.id,
      submissionId: delivery.submissionId,
    });
    await expect(
      rpcCenterAgentManageOrganizationDocuments(coreEnv, {
        action: "save_document",
        content: "Approved daily learning.",
        context: authorizedContext,
        folderId: folder.folder.id,
        operationId: "save-learning-document",
        speakerMember,
        title: "2026-07-23 | OK Eight Team Learning Journal",
      })
    ).resolves.toEqual(saved);
    await expect(
      rpcCenterAgentManageOrganizationDocuments(coreEnv, {
        action: "save_document",
        content: "Conflicting content after the turn ended.",
        context: authorizedContext,
        folderId: folder.folder.id,
        operationId: "save-learning-document",
        speakerMember,
        title: "2026-07-23 | OK Eight Team Learning Journal",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.operation_conflict",
        status: 409,
      },
    });
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT source_native_delivery_id
          FROM center_agent_audit_journal
          WHERE organization_id = ?
            AND action = 'save_org_document'
            AND resource_id = ?
          LIMIT 1
        `
      )
        .bind(fixture.organizationId, saved.document.id)
        .first<{ source_native_delivery_id: string | null }>()
    ).resolves.toEqual({ source_native_delivery_id: delivery.deliveryId });
    const legacyAudit = await rpcListCenterAgentAuditJournal(coreEnv, {
      actionSet: "v13",
      context: humanRequestContext(
        fixture.organizationId,
        fixture.ownerHumanProfileId,
        fixture.owner.userId
      ),
      limit: 25,
    });
    expect(
      legacyAudit.entries.find(
        (entry) => entry.resource?.id === saved.document.id
      )?.interactionSource
    ).toBeUndefined();
    const sourceAwareAudit = await rpcListCenterAgentAuditJournal(coreEnv, {
      actionSet: "v14",
      context: humanRequestContext(
        fixture.organizationId,
        fixture.ownerHumanProfileId,
        fixture.owner.userId
      ),
      limit: 25,
    });
    expect(
      sourceAwareAudit.entries.find(
        (entry) => entry.resource?.id === saved.document.id
      )?.interactionSource
    ).toEqual({ client: "codex", kind: "local_agent" });
    await expect(
      rpcCenterAgentManageOrganizationDocuments(coreEnv, {
        action: "save_document",
        content: "A new operation must still require an active turn.",
        context: authorizedContext,
        folderId: folder.folder.id,
        operationId: "save-after-turn-ended",
        speakerMember,
        title: "Unauthorized follow-up",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.direct_save_not_authorized",
        status: 403,
      },
    });
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT COUNT(*) AS count
          FROM center_agent_organization_document_operations
          WHERE operation_id = 'save-after-turn-ended'
        `
      ).first<{ count: number }>()
    ).resolves.toEqual({ count: 0 });
    await expect(
      rpcCenterAgentReadOrganizationDocuments(coreEnv, {
        action: "list",
        context,
        speakerMember,
      })
    ).resolves.toMatchObject({
      documents: [
        expect.objectContaining({
          folderId: folder.folder.id,
          id: saved.document.id,
        }),
      ],
      folders: expect.arrayContaining([
        expect.objectContaining({ id: folder.folder.id }),
        expect.objectContaining({
          name: "Launch Notes",
          parentFolderId: folder.folder.id,
        }),
      ]),
    });

    await expect(
      rpcCenterAgentManageOrganizationDocuments(coreEnv, {
        action: "move_document",
        context,
        documentId: saved.document.id,
        folderId: null,
        operationId: "move-learning-document",
        speakerMember,
      })
    ).resolves.toMatchObject({
      action: "move_document",
      document: { folderId: null, id: saved.document.id },
    });
    await expect(
      rpcCenterAgentManageOrganizationDocuments(coreEnv, {
        action: "rename_folder",
        context,
        folderId: folder.folder.id,
        name: "OK Eight Learning",
        operationId: "rename-learning-folder",
        speakerMember,
      })
    ).resolves.toMatchObject({
      action: "rename_folder",
      folder: { name: "OK Eight Learning" },
    });
  });

  it("lets only one concurrent document operation claimant mutate", async () => {
    const fixture = await seedFixture();
    const scope = {
      actorProfileId: fixture.centerAgentProfileId,
      operationId: "concurrent-document-operation",
      operationKind: "create_folder" as const,
      organizationId: fixture.organizationId,
      representedUserId: fixture.owner.userId,
    };
    const requestSignature =
      await buildCenterAgentOrganizationDocumentRequestSignature({
        action: "create_folder",
        name: "Concurrent folder",
      });

    const [first, second] = await Promise.all([
      beginCenterAgentOrganizationDocumentOperation({
        db: env.OPENMELD_DB,
        nowMs: 1000,
        requestSignature,
        scope,
        targetResourceId: "org_document_concurrent_first",
      }),
      beginCenterAgentOrganizationDocumentOperation({
        db: env.OPENMELD_DB,
        nowMs: 1001,
        requestSignature,
        scope,
        targetResourceId: "org_document_concurrent_second",
      }),
    ]);

    expect([first.outcome, second.outcome].sort()).toEqual([
      "claimed",
      "pending_in_progress",
    ]);
    const claimed = first.outcome === "claimed" ? first : second;
    const replay = first.outcome === "claimed" ? second : first;
    expect(replay.operation).toEqual(claimed.operation);
  });

  it("waits one claim lease before recovering a pending operation from the previous Core", async () => {
    const fixture = await seedFixture();
    const startedAtMs = 1000;
    const scope = {
      actorProfileId: fixture.centerAgentProfileId,
      operationId: "legacy-pending-document-operation",
      operationKind: "create_folder" as const,
      organizationId: fixture.organizationId,
      representedUserId: fixture.owner.userId,
    };
    const requestSignature =
      await buildCenterAgentOrganizationDocumentRequestSignature({
        action: "create_folder",
        name: "Legacy pending folder",
      });
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO center_agent_organization_document_operations (
          id,
          organization_id,
          actor_profile_id,
          represented_user_id,
          operation_id,
          operation_kind,
          request_signature,
          target_resource_id,
          response_json,
          status,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?, ?)
      `
    )
      .bind(
        "legacy-pending-document-operation-record",
        scope.organizationId,
        scope.actorProfileId,
        scope.representedUserId,
        scope.operationId,
        scope.operationKind,
        requestSignature,
        "legacy-pending-folder",
        startedAtMs,
        startedAtMs
      )
      .run();

    const duringLegacyLease =
      await beginCenterAgentOrganizationDocumentOperation({
        db: env.OPENMELD_DB,
        nowMs: startedAtMs + 1,
        requestSignature,
        scope,
        targetResourceId: "legacy-pending-folder",
      });
    expect(duringLegacyLease).toMatchObject({
      operation: {
        claimExpiresAtMs: null,
        claimId: null,
      },
      outcome: "pending_in_progress",
    });

    const recovered = await beginCenterAgentOrganizationDocumentOperation({
      db: env.OPENMELD_DB,
      nowMs: startedAtMs + CENTER_AGENT_DOCUMENT_OPERATION_CLAIM_LEASE_MS,
      requestSignature,
      scope,
      targetResourceId: "legacy-pending-folder",
    });
    expect(recovered).toMatchObject({
      operation: {
        claimExpiresAtMs:
          startedAtMs + CENTER_AGENT_DOCUMENT_OPERATION_CLAIM_LEASE_MS * 2,
      },
      outcome: "claimed",
    });
    expect(recovered.operation.claimId).not.toBeNull();

    await expect(
      prepareCompleteCenterAgentOrganizationDocumentOperationStatement({
        claimId: "stale-claim",
        db: env.OPENMELD_DB,
        nowMs: startedAtMs + CENTER_AGENT_DOCUMENT_OPERATION_CLAIM_LEASE_MS + 1,
        operationRecordId: recovered.operation.id,
        responseJson: JSON.stringify({ stale: true }),
      }).run()
    ).resolves.toMatchObject({
      meta: expect.objectContaining({ changes: 0 }),
    });
    await expect(
      prepareCompleteCenterAgentOrganizationDocumentOperationStatement({
        claimId: recovered.operation.claimId ?? "",
        db: env.OPENMELD_DB,
        nowMs: startedAtMs + CENTER_AGENT_DOCUMENT_OPERATION_CLAIM_LEASE_MS + 1,
        operationRecordId: recovered.operation.id,
        responseJson: JSON.stringify({ recovered: true }),
      }).run()
    ).resolves.toMatchObject({
      meta: expect.objectContaining({ changes: 1 }),
    });
  });

  it("does not execute a mutation for an exact pending operation replay", async () => {
    const fixture = await seedFixture();
    const operationId = "pending-folder-replay";
    const folderId = "org_document_pending_folder";
    const folderName = "Pending folder";
    const requestSignature =
      await buildCenterAgentOrganizationDocumentRequestSignature({
        action: "create_folder",
        name: folderName,
      });
    await beginCenterAgentOrganizationDocumentOperation({
      db: env.OPENMELD_DB,
      nowMs: Date.now(),
      requestSignature,
      scope: {
        actorProfileId: fixture.centerAgentProfileId,
        operationId,
        operationKind: "create_folder",
        organizationId: fixture.organizationId,
        representedUserId: fixture.owner.userId,
      },
      targetResourceId: folderId,
    });

    await expect(
      rpcCenterAgentManageOrganizationDocuments(
        { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings,
        {
          action: "create_folder",
          context: requestContext(
            fixture.organizationId,
            fixture.centerAgentProfileId
          ),
          name: folderName,
          operationId,
          speakerMember: {
            memberId: fixture.ownerMemberId,
            userId: fixture.owner.userId,
          },
        }
      )
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.operation_in_progress",
        status: 409,
      },
    });
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT COUNT(*) AS count
          FROM organization_document_folders
          WHERE id = ?
        `
      )
        .bind(folderId)
        .first<{ count: number }>()
    ).resolves.toEqual({ count: 0 });
  });

  it("recovers an abandoned pending operation after its claim lease expires", async () => {
    const fixture = await seedFixture();
    const operationId = "abandoned-folder-operation";
    const folderId = "org_document_abandoned_folder";
    const folderName = "Recovered folder";
    const requestSignature =
      await buildCenterAgentOrganizationDocumentRequestSignature({
        action: "create_folder",
        name: folderName,
      });
    const nowMs = Date.now();
    const abandoned = await beginCenterAgentOrganizationDocumentOperation({
      db: env.OPENMELD_DB,
      nowMs: nowMs - CENTER_AGENT_DOCUMENT_OPERATION_CLAIM_LEASE_MS - 1,
      requestSignature,
      scope: {
        actorProfileId: fixture.centerAgentProfileId,
        operationId,
        operationKind: "create_folder",
        organizationId: fixture.organizationId,
        representedUserId: fixture.owner.userId,
      },
      targetResourceId: folderId,
    });

    await expect(
      rpcCenterAgentManageOrganizationDocuments(
        { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings,
        {
          action: "create_folder",
          context: requestContext(
            fixture.organizationId,
            fixture.centerAgentProfileId
          ),
          name: folderName,
          operationId,
          speakerMember: {
            memberId: fixture.ownerMemberId,
            userId: fixture.owner.userId,
          },
        }
      )
    ).resolves.toMatchObject({
      action: "create_folder",
      folder: { id: folderId, name: folderName },
    });
    await expect(
      prepareCompleteCenterAgentOrganizationDocumentOperationStatement({
        claimId: abandoned.operation.claimId ?? "",
        db: env.OPENMELD_DB,
        nowMs: nowMs + 1,
        operationRecordId: abandoned.operation.id,
        responseJson: JSON.stringify({ stale: true }),
      }).run()
    ).resolves.toMatchObject({
      meta: expect.objectContaining({ changes: 0 }),
    });
  });

  it("returns an exact completed replay when turn authorization ends during the request", async () => {
    const fixture = await seedFixture();
    const operationId = "save-completed-during-authorization";
    const documentId = "org_document_authorization_race";
    const content = "Approved knowledge completed by the original request.";
    const title = "Authorization race";
    const response = {
      action: "save_document" as const,
      document: {
        content,
        folderId: null,
        id: documentId,
        kind: "knowledge" as const,
        title,
        updatedAt: "2026-07-23T00:00:00.000Z",
      },
      organizationId: fixture.organizationId,
      outcome: "created" as const,
    };
    const nativeDeliveryRead = vi
      .spyOn(
        nativeDeliveryLedgerRepo,
        "readRemoteAgentNativeDeliveryBySubmissionId"
      )
      .mockImplementationOnce(async () => {
        const requestSignature =
          await buildCenterAgentOrganizationDocumentRequestSignature({
            action: "save_document",
            content,
            title,
          });
        const claim = await beginCenterAgentOrganizationDocumentOperation({
          db: env.OPENMELD_DB,
          nowMs: 1000,
          requestSignature,
          scope: {
            actorProfileId: fixture.centerAgentProfileId,
            operationId,
            operationKind: "save_document",
            organizationId: fixture.organizationId,
            representedUserId: fixture.owner.userId,
          },
          targetResourceId: documentId,
        });
        await prepareCompleteCenterAgentOrganizationDocumentOperationStatement({
          claimId: claim.operation.claimId ?? "",
          db: env.OPENMELD_DB,
          nowMs: 1001,
          operationRecordId: claim.operation.id,
          responseJson: JSON.stringify(response),
        }).run();
        return null;
      });

    try {
      await expect(
        rpcCenterAgentManageOrganizationDocuments(
          { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings,
          {
            action: "save_document",
            content,
            context: requestContext(
              fixture.organizationId,
              fixture.centerAgentProfileId,
              "submission-that-ended-during-authorization"
            ),
            operationId,
            speakerMember: {
              memberId: fixture.ownerMemberId,
              userId: fixture.owner.userId,
            },
            title,
          }
        )
      ).resolves.toEqual(response);
    } finally {
      nativeDeliveryRead.mockRestore();
    }
  });

  it("lets only an explicitly authorized Routine finalize approved knowledge", async () => {
    const fixture = await seedFixture();
    const coreEnv = { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings;
    const speakerMember = {
      memberId: fixture.ownerMemberId,
      userId: fixture.owner.userId,
    };

    const deniedSubmissionId = await seedAcceptedRoutineDocumentDelivery({
      authorized: false,
      fixture,
    });
    await expect(
      rpcCenterAgentManageOrganizationDocuments(coreEnv, {
        action: "save_document",
        content: "Routine content without a stored grant.",
        context: requestContext(
          fixture.organizationId,
          fixture.centerAgentProfileId,
          deniedSubmissionId
        ),
        operationId: "routine-save-without-grant",
        speakerMember,
        title: "Unauthorized Routine journal",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.direct_save_not_authorized",
        status: 403,
      },
    });

    const authorizedSubmissionId = await seedAcceptedRoutineDocumentDelivery({
      authorized: true,
      fixture,
    });
    await expect(
      rpcCenterAgentManageOrganizationDocuments(coreEnv, {
        action: "save_document",
        content: "Routine content with a durable grant.",
        context: requestContext(
          fixture.organizationId,
          fixture.centerAgentProfileId,
          authorizedSubmissionId
        ),
        operationId: "routine-save-with-grant",
        speakerMember,
        title: "Authorized Routine journal",
      })
    ).resolves.toMatchObject({
      action: "save_document",
      document: { content: "Routine content with a durable grant." },
      outcome: "created",
    });
  });

  it("refuses to overwrite approved content while a draft is pending", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const document = await service.create(fixture.owner, {
      content: "Approved",
      kind: "knowledge",
      title: "Journal",
    });
    await service.draft(
      fixture.organizationId,
      {
        documentId: document.id,
        draftContent: "Pending review",
      },
      documentReviewerUserIds(fixture)
    );

    await expect(
      service.updateApprovedKnowledge(fixture.owner, document.id, {
        content: "Do not overwrite the draft",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.pending_draft_conflict",
        status: 409,
      },
    });
    await expect(
      service.updateApprovedKnowledge(fixture.member, document.id, {
        content: "Members cannot publish",
      })
    ).rejects.toMatchObject({ cause: { status: 403 } });
  });

  it("lists the brief first and exposes draft state without draft content", async () => {
    const fixture = await seedFixture();
    const service = createService();
    await service.create(fixture.owner, {
      content: "Knowledge",
      kind: "knowledge",
      title: "Alpha",
    });
    const brief = await service.create(fixture.owner, {
      content: "Brief",
      kind: "brief",
    });
    await service.draft(
      fixture.organizationId,
      {
        documentId: brief.id,
        draftContent: "Draft brief",
      },
      documentReviewerUserIds(fixture)
    );

    const documents = await service.list(fixture.member);
    expect(documents[0]).toMatchObject({
      hasDraft: true,
      kind: "brief",
      title: "Organization Brief",
    });
    expect(documents[0]).not.toHaveProperty("draftContent");
  });

  it("routes both Center Agent document tools through Core and audits them", async () => {
    const fixture = await seedFixture();
    const coreEnv = {
      OPENMELD_AUTH_WORKER: createDocumentReviewDirectoryAuthWorker(),
      OPENMELD_DB: env.OPENMELD_DB,
    } as CoreBindings;
    const context = requestContext(
      fixture.organizationId,
      fixture.centerAgentProfileId
    );
    const speakerMember = {
      memberId: fixture.ownerMemberId,
      userId: fixture.owner.userId,
    };

    const drafted = await rpcCenterAgentDraftOrganizationDocument(coreEnv, {
      context,
      draftContent: "Proposed runbook",
      kind: "knowledge",
      speakerMember,
      title: "Operations runbook",
    });
    await expect(
      rpcCenterAgentReadOrganizationDocuments(coreEnv, {
        action: "list",
        context,
        speakerMember,
      })
    ).resolves.toMatchObject({
      documents: [
        expect.objectContaining({
          id: drafted.document.id,
          title: "Operations runbook",
        }),
      ],
    });
    await expect(
      rpcCenterAgentReadOrganizationDocuments(coreEnv, {
        action: "get",
        context,
        documentId: drafted.document.id,
        speakerMember,
      })
    ).resolves.toMatchObject({
      document: {
        content: "",
        id: drafted.document.id,
        title: "Operations runbook",
      },
    });

    const result = await env.OPENMELD_DB.prepare(
      `
        SELECT action, resource_type, resource_id
        FROM center_agent_audit_journal
        WHERE organization_id = ?
        ORDER BY action ASC, resource_type ASC
      `
    )
      .bind(fixture.organizationId)
      .all<{
        action: string;
        resource_id: string;
        resource_type: string;
      }>();
    expect(result.results).toEqual([
      {
        action: "draft_org_document",
        resource_id: drafted.document.id,
        resource_type: "organization_document",
      },
      {
        action: "read_org_documents",
        resource_id: drafted.document.id,
        resource_type: "organization_document",
      },
      {
        action: "read_org_documents",
        resource_id: fixture.organizationId,
        resource_type: "organization_document_catalog",
      },
    ]);
  });

  it("lets an anonymous member read ordinary member documents through the exact native delivery", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const coreEnv = {
      OPENMELD_AUTH_WORKER: createDocumentReviewDirectoryAuthWorker(),
      OPENMELD_DB: env.OPENMELD_DB,
    } as CoreBindings;
    const document = await service.create(fixture.owner, {
      content: "The launch review is Thursday.",
      kind: "knowledge",
      title: "Launch plan",
    });
    const delivery = await seedAcceptedAnonymousMemberDelivery(fixture);
    const context = requestContext(
      fixture.organizationId,
      fixture.centerAgentProfileId,
      delivery.submissionId
    );
    const speakerMember = {
      displayName: "Ashley",
      kind: "anonymous_member" as const,
      messageChannelIdentity: {
        connectionId: "T123",
        provider: "slack" as const,
        providerUserId: "U123",
      },
    };

    await expect(
      prepareCenterAgentOrganizationMemberRequest(
        coreEnv,
        context,
        speakerMember
      )
    ).resolves.toMatchObject({
      member: {
        sourceNativeDeliveryId: delivery.deliveryId,
        sourceSpaceId: null,
      },
    });

    await expect(
      rpcCenterAgentAuthorizeAnonymousMemberTool(coreEnv, {
        context,
        speakerMember,
        toolName: "openmeld_read_org_documents",
      })
    ).resolves.toEqual({
      authorized: true,
      sourceNativeDeliveryId: delivery.deliveryId,
    });
    await expect(
      rpcCenterAgentAuthorizeAnonymousMemberTool(coreEnv, {
        context,
        messageChannelIdentityLinkCapabilityVersion: 1,
        speakerMember,
        toolName: "openmeld_get_navigation_action",
      })
    ).resolves.toEqual({
      authorized: true,
      messageChannelAccountTargetSupported: true,
      messageChannelIdentityLinkSupported: true,
      slackIdentityLinkSupported: true,
      sourceNativeDeliveryId: delivery.deliveryId,
    });
    await expect(
      rpcCenterAgentAuthorizeAnonymousMemberTool(coreEnv, {
        connectToUserId: fixture.owner.userId,
        context,
        messageChannelIdentityLinkCapabilityVersion: 2,
        speakerMember,
        toolName: "openmeld_get_navigation_action",
      })
    ).resolves.toEqual({
      authorized: true,
      messageChannelAccountTargetSupported: true,
      messageChannelIdentityLinkSupported: true,
      slackIdentityLinkSupported: true,
      sourceNativeDeliveryId: delivery.deliveryId,
    });
    await expect(
      rpcCenterAgentAuthorizeAnonymousMemberTool(coreEnv, {
        connectToUserId: "user_not_in_org",
        context,
        messageChannelIdentityLinkCapabilityVersion: 2,
        speakerMember,
        toolName: "openmeld_get_navigation_action",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "center_agent.account_connection_member_unavailable",
        status: 409,
      },
    });
    await expect(
      rpcCenterAgentAuthorizeAnonymousMemberTool(coreEnv, {
        context,
        speakerMember,
        toolName: "openmeld_get_navigation_action",
      })
    ).resolves.toEqual({
      authorized: true,
      slackIdentityLinkSupported: true,
      sourceNativeDeliveryId: delivery.deliveryId,
    });
    await expect(
      rpcCenterAgentReadOrganizationDocuments(coreEnv, {
        action: "get",
        context,
        documentId: document.id,
        speakerMember,
      })
    ).resolves.toMatchObject({
      document: {
        content: "The launch review is Thursday.",
        id: document.id,
      },
    });
    await expect(
      rpcCenterAgentGetOrganizationDirectory(coreEnv, {
        context,
        speakerMember,
      })
    ).resolves.toMatchObject({
      organizationId: fixture.organizationId,
    });
    await expect(
      rpcCenterAgentAuthorizeAnonymousMemberTool(coreEnv, {
        context,
        speakerMember,
        toolName: "openmeld_read_member_computers",
      })
    ).resolves.toEqual({
      authorized: true,
      sourceNativeDeliveryId: delivery.deliveryId,
    });
    await expect(
      rpcCenterAgentReadMemberComputers(coreEnv, {
        context,
        memberUserId: fixture.owner.userId,
        speakerMember,
      })
    ).resolves.toMatchObject({
      computers: expect.any(Array),
      memberUserId: fixture.owner.userId,
      organizationId: fixture.organizationId,
    });
    await expect(
      rpcCenterAgentListComputers(coreEnv, {
        context,
        includeDiagnostics: true,
        speakerMember,
      })
    ).rejects.toMatchObject({
      cause: {
        code: "center_agent.openmeld_identity_required",
        status: 403,
      },
    });

    await expect(
      rpcCenterAgentReadMemberComputers(coreEnv, {
        context,
        memberUserId: fixture.owner.userId,
        speakerMember: {
          ...speakerMember,
          messageChannelIdentity: {
            ...speakerMember.messageChannelIdentity,
            providerUserId: "U_OTHER",
          },
        },
      })
    ).rejects.toMatchObject({
      cause: {
        code: "center_agent.anonymous_member_delivery_mismatch",
        status: 403,
      },
    });
    await expect(
      rpcCenterAgentDraftOrganizationDocument(
        { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings,
        {
          context,
          draftContent: "Anonymous mutation",
          documentId: document.id,
          speakerMember,
        }
      )
    ).rejects.toMatchObject({
      cause: {
        code: "center_agent.openmeld_identity_required",
        status: 403,
      },
    });

    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT source_native_delivery_id
          FROM center_agent_audit_journal
          WHERE organization_id = ? AND action = 'read_org_documents'
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
        .bind(fixture.organizationId)
        .first<{ source_native_delivery_id: string | null }>()
    ).resolves.toEqual({
      source_native_delivery_id: delivery.deliveryId,
    });
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT source_native_delivery_id
          FROM center_agent_audit_journal
          WHERE organization_id = ? AND action = 'read_org_directory'
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
        .bind(fixture.organizationId)
        .first<{ source_native_delivery_id: string | null }>()
    ).resolves.toEqual({
      source_native_delivery_id: delivery.deliveryId,
    });
    await markRemoteAgentNativeDeliveryCompleted({
      db: env.OPENMELD_DB,
      nowMs: 3000,
      publishedSignalId: null,
      submissionId: delivery.submissionId,
    });
    await expect(
      rpcCenterAgentReadMemberComputers(coreEnv, {
        context,
        memberUserId: fixture.owner.userId,
        speakerMember,
      })
    ).rejects.toMatchObject({
      cause: {
        code: "center_agent.anonymous_member_delivery_inactive",
        status: 403,
      },
    });
  });
  it("keeps folders manager-owned and preserves nested contents on delete", async () => {
    const fixture = await seedFixture();
    const service = createService();

    await expect(
      service.createFolder(fixture.member, { name: "Member folder" })
    ).rejects.toMatchObject({ cause: { status: 403 } });

    const folder = await service.createFolder(fixture.owner, {
      name: "Runbooks",
    });
    const childFolder = await service.createFolder(fixture.owner, {
      name: "Production",
      parentFolderId: folder.id,
    });
    await expect(
      service.createFolder(fixture.admin, { name: "runbooks" })
    ).rejects.toMatchObject({
      cause: { code: "organization_document.folder_exists", status: 409 },
    });

    const doc = await service.create(fixture.owner, {
      content: "Inside a folder",
      folderId: folder.id,
      kind: "knowledge",
      title: "Deploy runbook",
    });
    const childDoc = await service.create(fixture.owner, {
      content: "Inside a nested folder",
      folderId: childFolder.id,
      kind: "knowledge",
      title: "Production checklist",
    });
    expect(doc.folderId).toBe(folder.id);

    await expect(
      service.update(fixture.member, doc.id, { folderId: null })
    ).rejects.toMatchObject({ cause: { status: 403 } });

    const folders = await service.listFolders(fixture.member);
    expect(folders).toHaveLength(2);
    expect(folders).toContainEqual(
      expect.objectContaining({
        name: "Production",
        parentFolderId: folder.id,
      })
    );

    await service.deleteFolder(fixture.owner, folder.id);
    const after = await service.get(fixture.owner, doc.id);
    expect(after).toMatchObject({
      content: "Inside a folder",
      folderId: null,
    });
    await expect(
      service.get(fixture.owner, childDoc.id)
    ).resolves.toMatchObject({
      content: "Inside a nested folder",
      folderId: childFolder.id,
    });
    await expect(service.listFolders(fixture.owner)).resolves.toEqual([
      expect.objectContaining({
        id: childFolder.id,
        name: "Production",
        parentFolderId: null,
      }),
    ]);
  });

  it("scopes folder names to siblings and supports nested creation", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const product = await service.createFolder(fixture.owner, {
      name: "Product",
    });
    const nestedRunbooks = await service.createFolder(fixture.owner, {
      name: "Runbooks",
      parentFolderId: product.id,
    });

    await expect(
      service.createFolder(fixture.owner, {
        name: "runbooks",
        parentFolderId: product.id,
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_document.folder_exists", status: 409 },
    });
    await expect(
      service.createFolder(fixture.owner, { name: "Runbooks" })
    ).resolves.toMatchObject({ parentFolderId: null });
    expect(nestedRunbooks).toMatchObject({ parentFolderId: product.id });
  });

  it("moves folders without allowing cross-organization parents or cycles", async () => {
    const fixture = await seedFixture();
    const otherFixture = await seedFixture();
    const service = createService();
    const product = await service.createFolder(fixture.owner, {
      name: "Product",
    });
    const launch = await service.createFolder(fixture.owner, {
      name: "Launch",
      parentFolderId: product.id,
    });
    const archive = await service.createFolder(fixture.owner, {
      name: "Archive",
    });
    const foreign = await service.createFolder(otherFixture.owner, {
      name: "Foreign",
    });

    await expect(
      service.moveFolder(fixture.owner, launch.id, archive.id)
    ).resolves.toMatchObject({ parentFolderId: archive.id });
    await expect(
      service.moveFolder(fixture.owner, archive.id, launch.id)
    ).rejects.toMatchObject({
      cause: { code: "organization_document.folder_cycle", status: 409 },
    });
    await expect(
      service.moveFolder(fixture.owner, product.id, foreign.id)
    ).rejects.toMatchObject({
      cause: { code: "organization_document.folder_not_found", status: 404 },
    });
  });

  it("moves documents between folders and rejects cross-organization folders", async () => {
    const fixture = await seedFixture();
    const otherFixture = await seedFixture();
    const service = createService();

    const folder = await service.createFolder(fixture.owner, {
      name: "Playbooks",
    });
    const foreignFolder = await service.createFolder(otherFixture.owner, {
      name: "Foreign",
    });
    const doc = await service.create(fixture.owner, {
      content: "Movable",
      kind: "knowledge",
      title: "Movable doc",
    });

    await expect(
      service.update(fixture.owner, doc.id, { folderId: foreignFolder.id })
    ).rejects.toMatchObject({
      cause: { code: "organization_document.folder_not_found", status: 404 },
    });

    await expect(
      service.update(fixture.owner, doc.id, { folderId: folder.id })
    ).resolves.toMatchObject({ folderId: folder.id });
    await expect(
      service.update(fixture.owner, doc.id, { folderId: null })
    ).resolves.toMatchObject({ folderId: null });

    const renamed = await service.renameFolder(fixture.owner, folder.id, {
      name: "Field guides",
    });
    expect(renamed).toMatchObject({ name: "Field guides" });
    await expect(
      service.renameFolder(fixture.owner, foreignFolder.id, { name: "Steal" })
    ).rejects.toMatchObject({
      cause: { code: "organization_document.folder_not_found", status: 404 },
    });
  });
});

function createService() {
  return createOrganizationDocumentService({ db: env.OPENMELD_DB });
}

function draftVersion(document: { draftCreatedAt: string | null }): string {
  if (!document.draftCreatedAt) {
    throw new Error("Expected a pending draft version in this test.");
  }
  return document.draftCreatedAt;
}

function humanDocumentVersion(document: {
  draftCreatedAt: string | null;
  updatedAt: string;
}) {
  return {
    expectedDocumentUpdatedAt: document.updatedAt,
    expectedDraftCreatedAt: document.draftCreatedAt,
  };
}

function documentReviewerUserIds(fixture: {
  admin: OrganizationDocumentActor;
  owner: OrganizationDocumentActor;
}): string[] {
  return [fixture.owner.userId, fixture.admin.userId];
}

type DocumentReviewInboxRow = {
  attention: string;
  importance: string;
  preview: string;
  read_at_ms: number | null;
  recipient_user_id: string;
  resolution_status: string;
  source_key: string;
  title: string;
};

async function readDocumentReviewInboxRows(
  organizationId: string
): Promise<DocumentReviewInboxRow[]> {
  const result = await env.OPENMELD_DB.prepare(
    `
      SELECT
        attention,
        importance,
        preview,
        read_at_ms,
        recipient_user_id,
        resolution_status,
        source_key,
        title
      FROM inbox_items
      WHERE organization_id = ?
        AND source_kind = 'organization_document_draft'
      ORDER BY recipient_user_id, source_key
    `
  )
    .bind(organizationId)
    .all<DocumentReviewInboxRow>();
  return result.results ?? [];
}

function createDocumentReviewDirectoryAuthWorker(): NonNullable<
  CoreBindings["OPENMELD_AUTH_WORKER"]
> {
  return {
    resolveOrganizationAccountIdentity: async ({ account, organizationId }) => {
      const organization = await env.OPENMELD_DB.prepare(
        `
          SELECT id, name, slug
          FROM organizations
          WHERE id = ?
          LIMIT 1
        `
      )
        .bind(organizationId)
        .first<{ id: string; name: string; slug: string }>();
      if (!organization) {
        return {
          code: "auth.organization_identity_unavailable" as const,
          message: "Organization identity is unavailable.",
          ok: false as const,
        };
      }

      const memberCountRow = await env.OPENMELD_DB.prepare(
        `
          SELECT COUNT(*) AS member_count
          FROM members
          WHERE organization_id = ?
        `
      )
        .bind(organizationId)
        .first<{ member_count: number }>();
      const selectedUserId =
        account?.kind === "user_id" ? account.userId : null;
      const selectedAccount = selectedUserId
        ? await env.OPENMELD_DB.prepare(
            `
              SELECT
                users.id AS user_id,
                users.name,
                users.email,
                members.id AS member_id,
                members.role
              FROM users
              LEFT JOIN members
                ON members.organization_id = ?
                AND members.user_id = users.id
              WHERE users.id = ?
              LIMIT 1
            `
          )
            .bind(organizationId, selectedUserId)
            .first<{
              email: string;
              member_id: string | null;
              name: string;
              role: "admin" | "member" | "owner" | null;
              user_id: string;
            }>()
        : null;

      return {
        account: selectedAccount
          ? {
              defaultHumanProfile: null,
              displayName: selectedAccount.name,
              email: selectedAccount.email,
              membership:
                selectedAccount.member_id && selectedAccount.role
                  ? {
                      memberId: selectedAccount.member_id,
                      role: selectedAccount.role,
                    }
                  : null,
              userId: selectedAccount.user_id,
            }
          : null,
        ok: true as const,
        organization: {
          id: organization.id,
          memberCount: memberCountRow?.member_count ?? 0,
          name: organization.name,
          personal: false,
          slug: organization.slug,
        },
      };
    },
    resolveOrganizationDirectoryAgentProfiles: async ({ organizationId }) => {
      const result = await env.OPENMELD_DB.prepare(
        `
          SELECT
            profile.profile_id,
            profile.profile_name,
            profile.profile_handle,
            profile.status,
            profile.organization_id,
            profile.owner_user_id,
            owner.name AS owner_name,
            profile.source,
            profile.managed_role,
            profile.created_by_user_id,
            profile.creator_profile_id,
            profile.last_used_at,
            profile.created_at,
            profile.updated_at
          FROM openmeld_profiles AS profile
          LEFT JOIN users AS owner ON owner.id = profile.owner_user_id
          WHERE profile.organization_id = ?
            AND profile.profile_kind = 'agent'
          ORDER BY profile.profile_id
        `
      )
        .bind(organizationId)
        .all<{
          created_at: number;
          created_by_user_id: string | null;
          creator_profile_id: string | null;
          last_used_at: number | null;
          managed_role: "center_agent" | "openmeld_assistant" | null;
          organization_id: string;
          owner_name: string | null;
          owner_user_id: string;
          profile_handle: string;
          profile_id: string;
          profile_name: string;
          source: string;
          status: "active" | "disabled";
          updated_at: number;
        }>();
      return {
        additionalAgentProfiles: [],
        ok: true as const,
        organizationAgentProfiles: (result.results ?? []).map((profile) => ({
          createdAt: new Date(profile.created_at).toISOString(),
          createdByUserId: profile.created_by_user_id,
          creatorProfileId: profile.creator_profile_id,
          isDefault: false as const,
          lastUsedAt:
            profile.last_used_at === null
              ? null
              : new Date(profile.last_used_at).toISOString(),
          managedRole: profile.managed_role,
          organizationId: profile.organization_id,
          ...(profile.owner_name ? { ownerName: profile.owner_name } : {}),
          ownerUserId: profile.owner_user_id,
          profileHandle: profile.profile_handle,
          profileId: profile.profile_id,
          profileKind: "agent" as const,
          profileName: profile.profile_name,
          source: profile.source,
          status: profile.status,
          updatedAt: new Date(profile.updated_at).toISOString(),
        })),
        organizationId,
      };
    },
    resolveOrganizationDirectoryMembers: async ({ organizationId }) => {
      const result = await env.OPENMELD_DB.prepare(
        `
          SELECT
            members.id AS member_id,
            members.role,
            members.user_id,
            members.created_at,
            users.email,
            users.name
          FROM members
          INNER JOIN users ON users.id = members.user_id
          WHERE members.organization_id = ?
          ORDER BY members.id
        `
      )
        .bind(organizationId)
        .all<{
          created_at: number;
          email: string;
          member_id: string;
          name: string;
          role: string;
          user_id: string;
        }>();
      return {
        members: (result.results ?? []).map((member) => ({
          humanProfile: null,
          joinedAt: new Date(member.created_at).toISOString(),
          memberId: member.member_id,
          organizationId,
          role: member.role,
          user: {
            email: member.email,
            id: member.user_id,
            image: null,
            name: member.name,
          },
          userId: member.user_id,
        })),
        ok: true as const,
        organizationId,
      };
    },
  };
}

function createOneShotFailingBatchDb(): D1Database {
  let shouldFail = true;
  return new Proxy(env.OPENMELD_DB, {
    get(target, property, receiver) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (shouldFail) {
            shouldFail = false;
            throw new Error("inbox projection unavailable");
          }
          return await target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function seedFixture(): Promise<{
  admin: OrganizationDocumentActor;
  centerAgentProfileId: string;
  member: OrganizationDocumentActor;
  organizationId: string;
  owner: OrganizationDocumentActor;
  ownerHumanProfileId: string;
  ownerMemberId: string;
}> {
  const suffix = crypto.randomUUID();
  const organizationId = `org_documents_${suffix}`;
  const users = [
    { id: `owner_${suffix}`, name: "Olivia Owner", role: "owner" },
    { id: `admin_${suffix}`, name: "Avery Admin", role: "admin" },
    { id: `member_${suffix}`, name: "Morgan Member", role: "member" },
  ] as const;
  await env.OPENMELD_DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(organizationId, "Documents Org", `documents-${suffix}`, 1000)
    .run();
  for (const [index, user] of users.entries()) {
    await env.OPENMELD_DB.prepare(
      "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(
        user.id,
        user.name,
        `documents-${index}-${suffix}@example.com`,
        1,
        1000,
        1000
      )
      .run();
    await env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(
        `membership_${index}_${suffix}`,
        organizationId,
        user.id,
        user.role,
        1000
      )
      .run();
  }
  const centerAgentProfileId = `agt_${crypto.randomUUID()}`;
  const ownerHumanProfileId = crypto.randomUUID();
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO openmeld_profiles (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        owner_user_id,
        created_by_user_id,
        source,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'human', 1, 'active', ?, ?, 'auth_bootstrap', ?, ?)
    `
  )
    .bind(
      ownerHumanProfileId,
      users[0].name,
      `owner-${suffix}`,
      users[0].id,
      users[0].id,
      1000,
      1000
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO openmeld_profiles (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        created_by_user_id,
        source,
        managed_role,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'agent', 0, 'active', ?, NULL, ?, 'cli_create', 'center_agent', ?, ?)
    `
  )
    .bind(
      centerAgentProfileId,
      "Center Agent",
      `center-agent-${suffix}`,
      organizationId,
      users[0].id,
      1000,
      1000
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO center_agent_designations (
        organization_id,
        agent_profile_id,
        duty,
        designated_by,
        created_at
      ) VALUES (?, ?, NULL, ?, ?)
    `
  )
    .bind(organizationId, centerAgentProfileId, users[0].id, 1000)
    .run();
  return {
    admin: { organizationId, role: "admin", userId: users[1].id },
    centerAgentProfileId,
    member: { organizationId, role: "member", userId: users[2].id },
    organizationId,
    owner: { organizationId, role: "owner", userId: users[0].id },
    ownerHumanProfileId,
    ownerMemberId: `membership_0_${suffix}`,
  };
}

async function seedAcceptedLocalAgentDocumentDelivery(
  fixture: Awaited<ReturnType<typeof seedFixture>>
): Promise<{ deliveryId: string; submissionId: string }> {
  const suffix = crypto.randomUUID();
  const idempotencyKey = `document_interactive_${suffix}`;
  const submissionId = `submission_${suffix}`;
  const delivery = await upsertRemoteAgentNativeDeliveryRecord({
    attemptId: null,
    bindingId: `binding_${suffix}`,
    db: env.OPENMELD_DB,
    dispatchId: idempotencyKey,
    idempotencyKey,
    nowMs: 2000,
    onBehalfOfDisplayName: "Olivia Owner",
    onBehalfOfProfileId: fixture.ownerHumanProfileId,
    onBehalfOfUserId: fixture.owner.userId,
    organizationId: fixture.organizationId,
    profileId: fixture.centerAgentProfileId,
    spaceId: `space_${suffix}`,
    status: "submitted",
    triggerMessageId: idempotencyKey,
  });
  await markRemoteAgentNativeDeliveryAck({
    accepted: true,
    db: env.OPENMELD_DB,
    idempotencyKey,
    nowMs: 2001,
    submissionId,
  });
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO center_agent_audit_journal (
        id,
        organization_id,
        actor_profile_id,
        action,
        on_behalf_of_profile_id,
        on_behalf_of_user_id,
        on_behalf_of_display_name,
        resource_type,
        resource_id,
        source_native_delivery_id,
        created_at
      ) VALUES (?, ?, ?, 'receive_local_agent_request', ?, ?, ?, 'local_agent_client', 'codex', ?, ?)
    `
  )
    .bind(
      `audit_local_agent_${suffix}`,
      fixture.organizationId,
      fixture.centerAgentProfileId,
      fixture.ownerHumanProfileId,
      fixture.owner.userId,
      "Olivia Owner",
      delivery.deliveryId,
      2001
    )
    .run();
  return { deliveryId: delivery.deliveryId, submissionId };
}

async function seedAcceptedAnonymousMemberDelivery(
  fixture: Awaited<ReturnType<typeof seedFixture>>
): Promise<{ deliveryId: string; submissionId: string }> {
  const suffix = crypto.randomUUID();
  const idempotencyKey = `anonymous_member_${suffix}`;
  const submissionId = `submission_${suffix}`;
  const bindingId = `binding_${suffix}`;
  const spaceId = `slack:T123:C123:${suffix}`;
  const workerSubmitRequest = remoteAgentWorkerSubmitTurnRequestSchema.parse({
    agentProfileId: fixture.centerAgentProfileId,
    agentProfileOwnerUserId: fixture.owner.userId,
    author: {
      displayName: "Ashley",
      profileId: null,
      profileKind: null,
    },
    bindingId,
    dispatchId: idempotencyKey,
    idempotencyKey,
    messages: [{ content: "What is the launch plan?", role: "user" }],
    onBehalfOf: null,
    organizationId: fixture.organizationId,
    sourceClientMessageId: null,
    spaceId,
    triggerMessageId: idempotencyKey,
    turnEnvelope: {
      centerAgent: {
        profileHandle: "center-agent",
        profileName: "Center Agent",
      },
      organization: {
        id: fixture.organizationId,
        memberCount: 3,
        name: "Documents Org",
        personal: false,
      },
      sender: {
        displayName: "Ashley",
        id: "slack:T123:U123",
        kind: "member",
        messageChannelIdentity: {
          connectionId: "T123",
          provider: "slack",
          providerUserId: "U123",
        },
        verified: false,
      },
      space: {
        id: spaceId,
        isCenterAgentDm: false,
        kind: "space",
        name: "#launch",
      },
      trigger: {
        channelId: "C123",
        conversationId: spaceId,
        source: "slack",
        teamId: "T123",
        threadTs: suffix,
      },
    },
    v: 1,
  });
  const delivery = await upsertRemoteAgentNativeDeliveryRecord({
    attemptId: null,
    bindingId,
    conversationKind: "slack",
    db: env.OPENMELD_DB,
    dispatchId: idempotencyKey,
    idempotencyKey,
    nowMs: 2000,
    onBehalfOfDisplayName: null,
    onBehalfOfProfileId: null,
    onBehalfOfUserId: null,
    organizationId: fixture.organizationId,
    profileId: fixture.centerAgentProfileId,
    slackChannelId: "C123",
    slackTeamId: "T123",
    slackThreadTs: suffix,
    spaceId,
    status: "submitted",
    triggerMessageId: idempotencyKey,
  });
  await persistRemoteAgentWorkerSubmitRequest({
    db: env.OPENMELD_DB,
    idempotencyKey,
    nowMs: 2001,
    workerSubmitRequest,
  });
  await markRemoteAgentNativeDeliveryAck({
    accepted: true,
    db: env.OPENMELD_DB,
    idempotencyKey,
    nowMs: 2002,
    submissionId,
  });
  return { deliveryId: delivery.deliveryId, submissionId };
}

async function seedAcceptedRoutineDocumentDelivery(input: {
  authorized: boolean;
  fixture: Awaited<ReturnType<typeof seedFixture>>;
}): Promise<string> {
  const suffix = crypto.randomUUID();
  const routineId = `routine_${suffix}`;
  const runId = `routine_run_${suffix}`;
  const spaceId = `space_${suffix}`;
  const bindingId = `binding_${suffix}`;
  const submissionId = `submission_${suffix}`;
  const nowMs = 3000;
  const routineName = input.authorized
    ? "Authorized knowledge journal"
    : "Unapproved knowledge journal";
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO routines (
        id, organization_id, name, instructions, authorized_actions_json,
        schedule_kind, cron_expression, timezone, destination_kind,
        target_space_id, status, next_due_at, created_by_user_id,
        updated_by_user_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'Write today''s learning journal.', ?, 'cron',
        '0 9 * * *', 'UTC', 'space', ?, 'enabled', ?, ?, ?, ?, ?)
    `
  )
    .bind(
      routineId,
      input.fixture.organizationId,
      routineName,
      JSON.stringify(
        input.authorized
          ? ["organization_documents.save_approved_knowledge"]
          : []
      ),
      spaceId,
      nowMs + 86_400_000,
      input.fixture.owner.userId,
      input.fixture.owner.userId,
      nowMs,
      nowMs
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO routine_runs (
        id, routine_id, organization_id, scheduled_for, status,
        routine_name_snapshot, destination_kind_snapshot,
        target_space_id_snapshot, execution_engine, started_at_ms
      ) VALUES (?, ?, ?, ?, 'claimed', ?, 'space', ?, 'workflow', ?)
    `
  )
    .bind(
      runId,
      routineId,
      input.fixture.organizationId,
      nowMs,
      routineName,
      spaceId,
      nowMs
    )
    .run();
  const workerSubmitRequest = remoteAgentWorkerSubmitTurnRequestSchema.parse({
    agentProfileId: input.fixture.centerAgentProfileId,
    agentProfileOwnerUserId: input.fixture.owner.userId,
    author: {
      displayName: "Center Agent",
      profileId: input.fixture.centerAgentProfileId,
      profileKind: "agent",
    },
    bindingId,
    dispatchId: runId,
    idempotencyKey: runId,
    messages: [{ content: "Write today's learning journal.", role: "user" }],
    onBehalfOf: null,
    organizationId: input.fixture.organizationId,
    sourceClientMessageId: null,
    spaceId,
    triggerMessageId: runId,
    turnEnvelope: {
      centerAgent: {
        profileHandle: "center-agent",
        profileName: "Center Agent",
      },
      organization: {
        id: input.fixture.organizationId,
        memberCount: 3,
        name: "Documents Org",
        personal: false,
      },
      sender: {
        createdByUserId: input.fixture.owner.userId,
        delegatedBy: {
          displayName: "Olivia Owner",
          id: input.fixture.ownerMemberId,
          ownerUserId: input.fixture.owner.userId,
          role: "owner",
          verified: true,
        },
        kind: "routine",
        routineId,
      },
      space: {
        id: spaceId,
        isCenterAgentDm: false,
        kind: "space",
        name: "OK Eight",
      },
      trigger: {
        destination: { kind: "space", spaceId },
        routineId,
        routineName,
        runId,
        scheduledFor: nowMs,
        source: "routine",
      },
    },
    v: 1,
  });
  const claim = await claimRemoteAgentRoutineNativeDelivery({
    bindingId,
    conversationKind: "space",
    db: env.OPENMELD_DB,
    nowMs,
    onBehalfOfDisplayName: "Olivia Owner",
    onBehalfOfProfileId: input.fixture.ownerHumanProfileId,
    onBehalfOfUserId: input.fixture.owner.userId,
    organizationId: input.fixture.organizationId,
    profileId: input.fixture.centerAgentProfileId,
    routineId,
    routineName,
    runId,
    slackChannelId: null,
    slackTeamId: null,
    slackThreadTs: null,
    spaceId,
    workerSubmitRequest,
  });
  if (claim.status !== "claimed") {
    throw new Error("Routine document delivery could not be claimed.");
  }
  await markRemoteAgentNativeDeliveryAck({
    accepted: true,
    db: env.OPENMELD_DB,
    idempotencyKey: runId,
    nowMs: nowMs + 1,
    submissionId,
  });
  return submissionId;
}

function requestContext(
  organizationId: string,
  profileId: string,
  agentControllerConversationId?: string
) {
  return {
    activeOrganizationId: organizationId,
    ...(agentControllerConversationId ? { agentControllerConversationId } : {}),
    actorContext: {
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      callerPrincipalId: profileId,
      profileKind: "agent" as const,
      profileName: "Center Agent",
      requestId: "org-document-contract-request",
      openMeldProfileId: profileId,
    },
  };
}

function humanRequestContext(
  organizationId: string,
  profileId: string,
  ownerUserId: string
) {
  return {
    activeOrganizationId: organizationId,
    actorContext: {
      callerPrincipalId: ownerUserId,
      ownerUserId,
      profileKind: "human" as const,
      profileName: "Organization owner",
      requestId: "org-document-human-request",
      openMeldProfileId: profileId,
    },
  };
}
