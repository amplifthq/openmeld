import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
} from "@openmeld/schemas";
import type {
  AuthRpcResolveOrganizationAccountIdentityInput,
  AuthRpcResolveOrganizationAccountIdentityResult,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  recordCenterAgentMemberResearchComputerFile,
  requireCenterAgentMemberResearchDraftTarget,
} from "../src/center-agent-member-research/member-research-repository";
import {
  getCenterAgentMemberResearchStatus,
  runCenterAgentMemberResearchTick,
  startCenterAgentMemberResearch,
} from "../src/center-agent-member-research/member-research-service";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcCenterAgentDraftOrganizationDocument } from "../src/organization-documents/organization-document-rpc";
import { createOrganizationDocumentService } from "../src/organization-documents/organization-document-service";
import {
  buildCenterAgentMemberResearchInstructions,
  submitRemoteAgentMemberResearchDelivery,
} from "../src/remote-agent/application/native-delivery-service";
import {
  markRemoteAgentNativeDeliveryAck,
  markRemoteAgentNativeDeliveryCompleted,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { rpcCenterAgentStartSelfMemberResearch } from "../src/rpc/methods";
import { env } from "../test-support/worker-env";

describe("Center Agent member research", () => {
  it("builds a privacy-bounded research instruction with an explicit quality floor", () => {
    const instructions = buildCenterAgentMemberResearchInstructions({
      nowMs: Date.UTC(2026, 6, 16, 12),
      subjectDisplayName: "Morgan Lee",
      subjectUserId: "user-morgan",
    });
    expect(instructions).toContain("Morgan Lee (userId: user-morgan)");
    expect(instructions).toContain("shared GitHub connection");
    expect(instructions).toContain("Slack workspace directory metadata");
    expect(instructions).not.toContain("public messages");
    expect(instructions).toContain(
      "Never access or infer from local agent session content"
    );
    expect(instructions).toContain(
      "Leave unavailable facts blank. Never invent details"
    );
    expect(instructions).toContain(
      "Identity metadata and missing-source notices are not substantive evidence"
    );
    expect(instructions).toContain(
      "Do not present names, email addresses, Organization roles, profile ownership, connection status, or the absence of activity as observed work"
    );
    expect(instructions).toContain("previous 90 days");
    expect(instructions).toContain("previous 180 days");
    expect(instructions).toContain(
      "exactly one accepted draft with openmeld_draft_org_document"
    );
    expect(instructions).toContain(
      "must never write or restate approved content"
    );
    expect(instructions).toContain('the title "2026-07-16 — Work Profile"');
    expect(instructions).toContain("memberResearchReport");
    expect(instructions).toContain(
      "Always omit documentId so this learning run remains a separate dated report"
    );
    expect(instructions).toContain(
      "Core validates the report, preserves the approved About section, and renders all Markdown"
    );
    expect(instructions).toContain("result to evidence_backed");
    expect(instructions).toContain(
      "observedActivity requires at least two distinct evidence items"
    );
    expect(instructions).toContain(
      "GitHub items also require the direct artifact URL in sourceUrl"
    );
    expect(instructions).toContain(
      "Display-name or handle similarity is not enough"
    );
    expect(instructions).toContain("For insufficient_evidence");
  });
  it("lets any active human Organization member accept a single-member research task and audits it", async () => {
    const fixture = await seedResearchFixture();
    const coreEnv = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
    } as CoreBindings;
    const nowMs = Date.UTC(2026, 7, 14, 3, 45);
    const accepted = await startCenterAgentMemberResearch(
      coreEnv,
      {
        context: humanContext(fixture, fixture.requester),
        expectedOrganizationId: fixture.organizationId,
        scope: "member",
        subjectUserId: fixture.requester.userId,
      },
      `ca_dm_${fixture.suffix}`,
      { nowMs }
    );
    expect(accepted.batch).toMatchObject({
      completedCount: 0,
      failedCount: 0,
      organizationId: fixture.organizationId,
      scope: "member",
      status: "queued",
      totalCount: 1,
    });
    expect(accepted.batch.tasks[0]).toMatchObject({
      status: "queued",
      subjectUserId: fixture.requester.userId,
    });
    expect(accepted.batch.createdAt).toBe(new Date(nowMs).toISOString());
    expect(accepted.batch.updatedAt).toBe(new Date(nowMs).toISOString());
    const audit = await getPostgresDatabase(env)
      .query<{
        action: string;
        on_behalf_of_user_id: string;
        resource_id: string;
        resource_type: string;
      }>({
        ...{
          text: `
        SELECT action, on_behalf_of_user_id, resource_type, resource_id
        FROM "openmeld"."center_agent_audit_journal"
        WHERE organization_id = $1
      `,
          values: [],
        },
        values: [fixture.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(audit).toEqual({
      action: "research_member",
      on_behalf_of_user_id: fixture.requester.userId,
      resource_id: accepted.batch.tasks[0]?.id,
      resource_type: "member_research_task",
    });
    await expect(
      startCenterAgentMemberResearch(
        coreEnv,
        {
          context: {
            ...humanContext(fixture, fixture.requester),
            actorContext: {
              ...humanContext(fixture, fixture.requester).actorContext,
              callerPrincipalId: `outsider_${fixture.suffix}`,
              ownerUserId: `outsider_${fixture.suffix}`,
            },
          },
          expectedOrganizationId: fixture.organizationId,
          scope: "member",
          subjectUserId: fixture.requester.userId,
        },
        `ca_dm_${fixture.suffix}`
      )
    ).rejects.toMatchObject({ cause: { status: 403 } });
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."center_agent_member_research_batches" WHERE id = $1',
        values: [],
      },
      values: [accepted.batch.id],
    });
  });
  it("returns the same accepted research task for one internal onboarding request", async () => {
    const fixture = await seedResearchFixture();
    const coreEnv = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
    } as CoreBindings;
    const request = {
      context: humanContext(fixture, fixture.requester),
      expectedOrganizationId: fixture.organizationId,
      scope: "member" as const,
      subjectUserId: fixture.requester.userId,
    };
    const acceptanceIdempotencyKey = `slack-welcome:${fixture.suffix}`;
    const first = await startCenterAgentMemberResearch(
      coreEnv,
      request,
      `ca_dm_${fixture.suffix}`,
      { acceptanceIdempotencyKey, nowMs: 1000 }
    );
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: `UPDATE "openmeld"."center_agent_member_research_tasks"
         SET status = 'completed', started_at_ms = 2000, finished_at_ms = 3000
         WHERE batch_id = $1`,
              values: [],
            },
            values: [first.batch.id],
          },
          {
            ...{
              text: `UPDATE "openmeld"."center_agent_member_research_batches"
         SET status = 'completed', updated_at_ms = 3000
         WHERE id = $1`,
              values: [],
            },
            values: [first.batch.id],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const recovered = await startCenterAgentMemberResearch(
      coreEnv,
      request,
      `ca_dm_${fixture.suffix}`,
      { acceptanceIdempotencyKey }
    );
    expect(recovered.batch.id).toBe(first.batch.id);
    expect(recovered.batch.status).toBe("completed");
    expect(recovered.batch.tasks[0]?.id).toBe(first.batch.tasks[0]?.id);
    const batchCount = await getPostgresDatabase(env)
      .query<{
        count: number;
      }>({
        ...{
          text: `SELECT COUNT(*) AS count
        FROM "openmeld"."center_agent_member_research_batches"
        WHERE organization_id = $1`,
          values: [],
        },
        values: [fixture.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(batchCount?.count).toBe(1);
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."center_agent_member_research_batches" WHERE id = $1',
        values: [],
      },
      values: [first.batch.id],
    });
  });
  it("returns one accepted research task when the same onboarding request races", async () => {
    const fixture = await seedResearchFixture();
    const coreEnv = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
    } as CoreBindings;
    const request = {
      context: humanContext(fixture, fixture.requester),
      expectedOrganizationId: fixture.organizationId,
      scope: "member" as const,
      subjectUserId: fixture.requester.userId,
    };
    const acceptanceIdempotencyKey = `slack-welcome-race:${fixture.suffix}`;
    const [first, second] = await Promise.all([
      startCenterAgentMemberResearch(
        coreEnv,
        request,
        `ca_dm_${fixture.suffix}`,
        { acceptanceIdempotencyKey, nowMs: 1000 }
      ),
      startCenterAgentMemberResearch(
        coreEnv,
        request,
        `ca_dm_${fixture.suffix}`,
        { acceptanceIdempotencyKey, nowMs: 1001 }
      ),
    ]);
    expect(second.batch.id).toBe(first.batch.id);
    expect(second.batch.tasks[0]?.id).toBe(first.batch.tasks[0]?.id);
    const batchCount = await getPostgresDatabase(env)
      .query<{
        count: number;
      }>({
        ...{
          text: `SELECT COUNT(*) AS count
        FROM "openmeld"."center_agent_member_research_batches"
        WHERE organization_id = $1`,
          values: [],
        },
        values: [fixture.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(batchCount?.count).toBe(1);
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."center_agent_member_research_batches" WHERE id = $1',
        values: [],
      },
      values: [first.batch.id],
    });
  });
  it("lets a verified member ask the hosted Center Agent to learn about themselves", async () => {
    const fixture = await seedResearchFixture();
    const coreEnv = buildResearchDeliveryEnv(fixture);
    const nowMs = Date.UTC(2026, 7, 15, 3, 45);
    const accepted = await rpcCenterAgentStartSelfMemberResearch(
      coreEnv,
      {
        context: hostedCenterAgentContext(fixture),
        speakerMember: {
          memberId: fixture.requester.memberId,
          userId: fixture.requester.userId,
        },
      },
      {
        nowMs,
        openDirectMessage: async () => ({
          spaceId: `ca_dm_${fixture.suffix}`,
        }),
      }
    );
    expect(accepted.batch).toMatchObject({
      organizationId: fixture.organizationId,
      scope: "member",
      status: "queued",
      tasks: [
        {
          status: "queued",
          subjectUserId: fixture.requester.userId,
        },
      ],
    });
    await expect(
      rpcCenterAgentStartSelfMemberResearch(coreEnv, {
        context: hostedCenterAgentContext(fixture),
        speakerMember: {
          memberId: fixture.requester.memberId,
          userId: `someone-else-${fixture.suffix}`,
        },
      })
    ).rejects.toMatchObject({ cause: { status: 403 } });
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."center_agent_member_research_batches" WHERE id = $1',
        values: [],
      },
      values: [accepted.batch.id],
    });
  });
  it("runs all members serially and continues after one delivery fails", async () => {
    const fixture = await seedResearchFixture();
    const coreEnv = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
    } as CoreBindings;
    const accepted = await startCenterAgentMemberResearch(
      coreEnv,
      {
        context: humanContext(fixture, fixture.requester),
        expectedOrganizationId: fixture.organizationId,
        scope: "all",
      },
      `ca_dm_${fixture.suffix}`
    );
    const submitDelivery = vi
      .fn()
      .mockResolvedValueOnce({
        failureCode: "remote_agent.worker_unavailable",
        status: "failed" as const,
      })
      .mockResolvedValueOnce({ status: "submitted" as const });
    await runCenterAgentMemberResearchTick({
      db: getPostgresDatabase(env),
      env: coreEnv,
      nowMs: Date.now() + 1000,
      submitDelivery,
    });
    expect(submitDelivery).toHaveBeenCalledTimes(2);
    expect(submitDelivery.mock.calls[0]?.[0].subjectUserId).toBe(
      accepted.batch.tasks[0]?.subjectUserId
    );
    expect(submitDelivery.mock.calls[1]?.[0].subjectUserId).toBe(
      accepted.batch.tasks[1]?.subjectUserId
    );
    const status = await getCenterAgentMemberResearchStatus(coreEnv, {
      context: humanContext(fixture, fixture.requester),
    });
    expect(status.latestBatch).toMatchObject({
      failedCount: 1,
      status: "running",
      totalCount: 4,
      tasks: [
        {
          failureCode: "remote_agent.worker_unavailable",
          status: "failed",
        },
        { failureCode: null, status: "running" },
        { failureCode: null, status: "queued" },
        { failureCode: null, status: "queued" },
      ],
    });
    const auditCount = await getPostgresDatabase(env)
      .query<{
        count: number;
      }>({
        ...{
          text: `
        SELECT COUNT(*) AS count
        FROM "openmeld"."center_agent_audit_journal"
        WHERE organization_id = $1 AND action = 'research_member'
      `,
          values: [],
        },
        values: [fixture.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(auditCount?.count).toBe(4);
  });
  it("returns a terminal failure when member research selects an unknown model", async () => {
    const fixture = await seedResearchFixture();
    const authority = await seedResearchDeliveryAuthority(fixture, {
      modelId: "openrouter/not-in-the-catalog",
    });
    await expect(
      submitRemoteAgentMemberResearchDelivery({
        db: getPostgresDatabase(env),
        directMessageSpaceId: authority.directMessageSpaceId,
        env: buildResearchDeliveryEnv(fixture),
        nowMs: 2000,
        organizationId: fixture.organizationId,
        requesterUserId: fixture.requester.userId,
        subjectDisplayName: fixture.requester.displayName,
        subjectUserId: fixture.requester.userId,
        taskId: `member_research_unknown_model_${fixture.suffix}`,
      })
    ).resolves.toEqual({
      failureCode: "center_agent_model_unknown",
      status: "failed",
    });
  });
  it("retries an unacknowledged member research submission with the same task identity", async () => {
    const fixture = await seedResearchFixture();
    const coreEnv = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
    } as CoreBindings;
    const accepted = await startCenterAgentMemberResearch(
      coreEnv,
      {
        context: humanContext(fixture, fixture.requester),
        expectedOrganizationId: fixture.organizationId,
        scope: "member",
        subjectUserId: fixture.requester.userId,
      },
      `ca_dm_${fixture.suffix}`
    );
    const task = accepted.batch.tasks[0];
    if (!task) {
      throw new Error("Expected one accepted member research task.");
    }
    const submitDelivery = vi.fn().mockResolvedValue({ status: "submitted" });
    await runCenterAgentMemberResearchTick({
      db: getPostgresDatabase(env),
      env: coreEnv,
      nowMs: Date.now() + 1000,
      submitDelivery,
    });
    await upsertRemoteAgentNativeDeliveryRecord({
      attemptId: null,
      bindingId: `binding_${fixture.suffix}`,
      db: getPostgresDatabase(env),
      dispatchId: task.id,
      idempotencyKey: task.id,
      nowMs: Date.now() + 1001,
      organizationId: fixture.organizationId,
      profileId: fixture.centerAgentProfileId,
      spaceId: `ca_dm_${fixture.suffix}`,
      status: "submitted",
      triggerMessageId: task.id,
    });
    await runCenterAgentMemberResearchTick({
      db: getPostgresDatabase(env),
      env: coreEnv,
      nowMs: Date.now() + 2000,
      submitDelivery,
    });
    const taskSubmissions = submitDelivery.mock.calls.filter(
      ([input]) => input.taskId === task.id
    );
    expect(taskSubmissions).toHaveLength(2);
    expect(taskSubmissions[1]?.[0].taskId).toBe(task.id);
  });
  it("keeps durable draft-origin evidence after the reviewable draft is cleared", async () => {
    const fixture = await seedResearchFixture();
    const coreEnv = buildResearchDeliveryEnv(fixture);
    const startedAtMs = Date.now() + 1000;
    let documentNowMs = startedAtMs + 2;
    const accepted = await startCenterAgentMemberResearch(
      coreEnv,
      {
        context: humanContext(fixture, fixture.requester),
        expectedOrganizationId: fixture.organizationId,
        scope: "member",
        subjectUserId: fixture.requester.userId,
      },
      `ca_dm_${fixture.suffix}`
    );
    const task = accepted.batch.tasks[0];
    if (!task) {
      throw new Error("Expected one accepted member research task.");
    }
    await runCenterAgentMemberResearchTick({
      db: getPostgresDatabase(env),
      env: coreEnv,
      nowMs: startedAtMs,
      submitDelivery: vi.fn().mockResolvedValue({ status: "submitted" }),
    });
    await upsertRemoteAgentNativeDeliveryRecord({
      attemptId: null,
      bindingId: `binding_${fixture.suffix}`,
      db: getPostgresDatabase(env),
      dispatchId: task.id,
      idempotencyKey: task.id,
      nowMs: startedAtMs,
      organizationId: fixture.organizationId,
      profileId: fixture.centerAgentProfileId,
      spaceId: `ca_dm_${fixture.suffix}`,
      status: "submitted",
      triggerMessageId: task.id,
    });
    const submissionId = `submission_${fixture.suffix}`;
    await markRemoteAgentNativeDeliveryAck({
      accepted: true,
      db: getPostgresDatabase(env),
      idempotencyKey: task.id,
      nowMs: startedAtMs + 1,
      submissionId,
    });
    await expect(
      requireCenterAgentMemberResearchDraftTarget({
        db: getPostgresDatabase(env),
        kind: "member_profile",
        organizationId: fixture.organizationId,
        submissionId,
        subjectUserId: "another-user",
        taskId: task.id,
      })
    ).rejects.toMatchObject({ cause: { status: 409 } });
    await requireCenterAgentMemberResearchDraftTarget({
      db: getPostgresDatabase(env),
      kind: "member_profile",
      organizationId: fixture.organizationId,
      submissionId,
      subjectUserId: fixture.requester.userId,
      taskId: task.id,
    });
    const documentService = createOrganizationDocumentService({
      db: getPostgresDatabase(env),
      now: () => documentNowMs,
    });
    const draftInput = {
      draftContent: "",
      kind: "member_profile" as const,
      memberResearch: { submissionId, taskId: task.id },
      memberResearchReport: insufficientEvidenceReport(),
      subjectUserId: fixture.requester.userId,
      title: `${fixture.requester.displayName} Profile Report`,
    };
    await expect(
      documentService.draft(
        fixture.organizationId,
        {
          ...draftInput,
          memberResearch: {
            submissionId: "another-submission",
            taskId: task.id,
          },
        },
        memberResearchDocumentReviewerUserIds(fixture)
      )
    ).rejects.toMatchObject({ cause: { status: 409 } });
    await expect(
      documentService.draft(
        fixture.organizationId,
        {
          ...draftInput,
          memberResearchReport: {
            result: "evidence_backed",
          } as never,
        },
        memberResearchDocumentReviewerUserIds(fixture)
      )
    ).rejects.toMatchObject({
      cause: {
        code: "center_agent_member_research.report_quality_failed",
        status: 422,
      },
    });
    const unauthorizedDraftCount = await getPostgresDatabase(env)
      .query<{
        count: number;
      }>({
        ...{
          text: 'SELECT COUNT(*) AS count FROM "openmeld"."organization_documents" WHERE organization_id = $1 AND kind = \'member_profile\'',
          values: [],
        },
        values: [fixture.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(unauthorizedDraftCount?.count).toBe(0);
    const drafted = await rpcCenterAgentDraftOrganizationDocument(coreEnv, {
      context: {
        ...hostedCenterAgentContext(fixture),
        agentControllerConversationId: submissionId,
      },
      draftContent: draftInput.draftContent,
      kind: draftInput.kind,
      memberResearchReport: draftInput.memberResearchReport,
      memberResearchTaskId: task.id,
      speakerMember: {
        memberId: fixture.requester.memberId,
        userId: fixture.requester.userId,
      },
      subjectUserId: draftInput.subjectUserId,
      title: draftInput.title,
    });
    expect(drafted.memberResearchDraft?.content).toContain(
      "**Insufficient evidence**"
    );
    expect(drafted.memberResearchDraft?.content).toContain(
      "## Research coverage"
    );
    const storedTaskResult = await getPostgresDatabase(env)
      .query<{
        report_result: string;
      }>({
        ...{
          text: 'SELECT report_result FROM "openmeld"."center_agent_member_research_tasks" WHERE id = $1',
          values: [],
        },
        values: [task.id],
      })
      .then((result) => result.rows[0] ?? null);
    expect(storedTaskResult).toEqual({
      report_result: "insufficient_evidence",
    });
    const expectedReportDate = drafted.document.profileReportDate;
    if (!expectedReportDate) {
      throw new Error("Expected the Profile Report date.");
    }
    const storedReport = await getPostgresDatabase(env)
      .query<{
        folder_id: string;
        profile_report_date: string;
        profile_report_type: string;
        title: string;
      }>({
        ...{
          text: `
        SELECT title, folder_id, profile_report_date, profile_report_type
        FROM "openmeld"."organization_documents"
        WHERE id = $1
      `,
          values: [],
        },
        values: [drafted.document.id],
      })
      .then((result) => result.rows[0] ?? null);
    expect(storedReport).toMatchObject({
      profile_report_date: expectedReportDate,
      profile_report_type: "work_profile",
      title: `${expectedReportDate} — Work Profile`,
    });
    const folderPath = await getPostgresDatabase(env)
      .query<{
        person_name: string;
        root_name: string;
      }>({
        ...{
          text: `
        SELECT person.name AS person_name, root.name AS root_name
        FROM "openmeld"."organization_document_folders" person
        INNER JOIN "openmeld"."organization_document_folders" root
          ON root.id = person.parent_folder_id
        WHERE person.id = $1
      `,
          values: [],
        },
        values: [storedReport?.folder_id],
      })
      .then((result) => result.rows[0] ?? null);
    expect(folderPath).toEqual({
      person_name: fixture.requester.displayName,
      root_name: "Profile Reports",
    });
    await expect(
      recordCenterAgentMemberResearchComputerFile({
        db: getPostgresDatabase(env),
        documentId: drafted.document.id,
        nowMs: startedAtMs + 2,
        organizationId: fixture.organizationId,
        path: `/computer/home/documents/Profile Reports/Someone Else/${expectedReportDate} — Work Profile.md`,
        subjectUserId: fixture.requester.userId,
        submissionId,
        taskId: task.id,
      })
    ).rejects.toMatchObject({
      cause: {
        code: "center_agent_member_research.computer_file_path_invalid",
        status: 422,
      },
    });
    await recordCenterAgentMemberResearchComputerFile({
      db: getPostgresDatabase(env),
      documentId: drafted.document.id,
      nowMs: startedAtMs + 2,
      organizationId: fixture.organizationId,
      path: `/computer/home/documents/Profile Reports/${folderPath?.person_name}/${expectedReportDate} — Work Profile.md`,
      subjectUserId: fixture.requester.userId,
      submissionId,
      taskId: task.id,
    });
    const draftVersion = await getPostgresDatabase(env)
      .query<{
        draft_created_at: number;
      }>({
        ...{
          text: 'SELECT draft_created_at FROM "openmeld"."organization_documents" WHERE id = $1',
          values: [],
        },
        values: [drafted.document.id],
      })
      .then((result) => result.rows[0] ?? null);
    if (!draftVersion) {
      throw new Error("Expected the member research draft version.");
    }
    // The RPC uses the real clock, while this direct service keeps an injected
    // clock. Advance it to the persisted draft before resolving that draft.
    documentNowMs = Math.max(documentNowMs, draftVersion.draft_created_at + 1);
    const renderedDraft = await getPostgresDatabase(env)
      .query<{
        draft_content: string;
      }>({
        ...{
          text: 'SELECT draft_content FROM "openmeld"."organization_documents" WHERE id = $1',
          values: [],
        },
        values: [drafted.document.id],
      })
      .then((result) => result.rows[0] ?? null);
    expect(drafted.memberResearchDraft?.content).toBe(
      renderedDraft?.draft_content
    );
    expect(renderedDraft?.draft_content).toContain("**Insufficient evidence**");
    expect(renderedDraft?.draft_content).toContain("## Research coverage");
    await documentService.discardDraft(
      {
        organizationId: fixture.organizationId,
        role: "owner",
        userId: fixture.requester.userId,
      },
      drafted.document.id,
      new Date(draftVersion.draft_created_at).toISOString()
    );
    const replayed = await documentService.draft(
      fixture.organizationId,
      draftInput,
      memberResearchDocumentReviewerUserIds(fixture)
    );
    expect(replayed.document).toMatchObject({
      hasDraft: false,
      id: drafted.document.id,
    });
    await markRemoteAgentNativeDeliveryCompleted({
      db: getPostgresDatabase(env),
      nowMs: startedAtMs + 3,
      publishedSignalId: null,
      submissionId,
    });
    await runCenterAgentMemberResearchTick({
      db: getPostgresDatabase(env),
      env: coreEnv,
      nowMs: startedAtMs + 4,
    });
    const status = await getCenterAgentMemberResearchStatus(coreEnv, {
      context: humanContext(fixture, fixture.requester),
    });
    expect(status.latestBatch).toMatchObject({
      completedCount: 1,
      failedCount: 0,
      status: "completed",
      tasks: [{ status: "completed" }],
    });
  });
});
async function seedResearchFixture() {
  const suffix = crypto.randomUUID();
  const organizationId = `org_member_research_${suffix}`;
  const users = [
    {
      displayName: "Riley Requester",
      memberId: `member_requester_${suffix}`,
      profileId: crypto.randomUUID(),
      role: "member",
      userId: `user_requester_${suffix}`,
    },
    {
      displayName: "Alex Subject",
      memberId: `member_alex_${suffix}`,
      profileId: crypto.randomUUID(),
      role: "member",
      userId: `user_alex_${suffix}`,
    },
    {
      displayName: "Morgan Subject",
      memberId: `member_morgan_${suffix}`,
      profileId: crypto.randomUUID(),
      role: "admin",
      userId: `user_morgan_${suffix}`,
    },
  ] as const;
  await getPostgresDatabase(env).query({
    ...{
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
      values: [],
    },
    values: [
      organizationId,
      "Member Research Org",
      `member-research-${suffix}`,
      1000,
    ],
  });
  for (const [index, user] of users.entries()) {
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, $5)',
              values: [],
            },
            values: [
              user.userId,
              user.displayName,
              `member-research-${index}-${suffix}@example.com`,
              1000,
              1000,
            ],
          },
          {
            ...{
              text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, $5)',
              values: [],
            },
            values: [
              user.memberId,
              organizationId,
              user.userId,
              user.role,
              1000,
            ],
          },
          {
            ...{
              text: `
          INSERT INTO "openmeld"."openmeld_profiles" (
            profile_id, profile_name, profile_handle, profile_kind,
            is_default, status, owner_user_id, created_by_user_id,
            source, created_at, updated_at
          ) VALUES ($1, $2, $3, 'human', 1, 'active', $4, $5, 'auth_bootstrap', $6, $7)
        `,
              values: [],
            },
            values: [
              user.profileId,
              user.displayName,
              `member-research-${index}-${suffix}`,
              user.userId,
              user.userId,
              1000,
              1000,
            ],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
  }
  const membershipOnlyUser = {
    displayName: "No Profile Subject",
    memberId: `member_no_profile_${suffix}`,
    role: "member",
    userId: `user_no_profile_${suffix}`,
  } as const;
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, $5)',
            values: [],
          },
          values: [
            membershipOnlyUser.userId,
            membershipOnlyUser.displayName,
            `member-research-no-profile-${suffix}@example.com`,
            1000,
            1000,
          ],
        },
        {
          ...{
            text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, $5)',
            values: [],
          },
          values: [
            membershipOnlyUser.memberId,
            organizationId,
            membershipOnlyUser.userId,
            membershipOnlyUser.role,
            1000,
          ],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  const centerAgentProfileId = `agt_${crypto.randomUUID()}`;
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id, profile_name, profile_handle, profile_kind,
          is_default, status, organization_id, owner_user_id,
          created_by_user_id, source, managed_role, created_at, updated_at
        ) VALUES ($1, 'Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4, 'cli_create', 'center_agent', $5, $6)
      `,
            values: [],
          },
          values: [
            centerAgentProfileId,
            `member-research-ca-${suffix}`,
            organizationId,
            users[0].userId,
            1000,
            1000,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."center_agent_designations" (
          organization_id, agent_profile_id, duty, designated_by, created_at
        ) VALUES ($1, $2, NULL, $3, $4)
      `,
            values: [],
          },
          values: [organizationId, centerAgentProfileId, users[0].userId, 1000],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return {
    centerAgentProfileId,
    organizationId,
    requester: users[0],
    subjects: [...users, membershipOnlyUser],
    suffix,
  };
}
async function seedResearchDeliveryAuthority(
  fixture: Awaited<ReturnType<typeof seedResearchFixture>>,
  input: {
    modelId: string;
  }
) {
  const bindingId = `binding_member_research_${fixture.suffix}`;
  const directMessageSpaceId = `ca_dm_${fixture.suffix}`;
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."space_index_spaces" (
          space_id, organization_id, organization_visibility, status, space_name,
          source_updated_at_ms, projected_at_ms, projection_event_id
        ) VALUES ($1, $2, 'private', 'active', 'Center Agent', 1000, 1000, $3)
      `,
            values: [],
          },
          values: [
            directMessageSpaceId,
            fixture.organizationId,
            `member_research_space_${fixture.suffix}`,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."space_index_memberships" (
          space_id, profile_id, profile_kind_snapshot, profile_name_snapshot,
          owner_user_id_snapshot, controller_ref_snapshot, status, member_source,
          added_at_ms, source_updated_at_ms, projected_at_ms, projection_event_id
        ) VALUES ($1, $2, 'agent', 'Center Agent', NULL, $3, 'active', 'member_add',
          1000, 1000, 1000, $4)
      `,
            values: [],
          },
          values: [
            directMessageSpaceId,
            fixture.centerAgentProfileId,
            HOSTED_CENTER_AGENT_CONTROLLER_REF,
            `member_research_membership_${fixture.suffix}`,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
          binding_id, owner_kind, owner_id, agent_profile_id,
          openmeld_service_runtime_id, runtime_kind, hosted_runtime_identity_json,
          agent_controller_ref, agent_controller_conversation_id, binding_state,
          model_id, created_at_ms, updated_at_ms
        ) VALUES ($1, 'organization', $2, $3, $4, 'hosted_center_agent', $5, $6,
          NULL, 'enabled_primary', $7, 1000, 1000)
      `,
            values: [],
          },
          values: [
            bindingId,
            fixture.organizationId,
            fixture.centerAgentProfileId,
            HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
            JSON.stringify(HOSTED_CENTER_AGENT_RUNTIME_IDENTITY),
            HOSTED_CENTER_AGENT_CONTROLLER_REF,
            input.modelId,
          ],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return { bindingId, directMessageSpaceId };
}
function buildResearchDeliveryEnv(
  fixture: Awaited<ReturnType<typeof seedResearchFixture>>
): CoreBindings {
  return {
    OPENMELD_AUTH_WORKER: {
      resolveOrganizationAccountIdentity: (
        request: AuthRpcResolveOrganizationAccountIdentityInput
      ): Promise<AuthRpcResolveOrganizationAccountIdentityResult> => {
        if (
          request.organizationId !== fixture.organizationId ||
          request.account?.kind !== "user_id" ||
          request.account.userId !== fixture.requester.userId
        ) {
          return Promise.resolve({
            code: "auth.organization_identity_unavailable",
            message: "Organization identity is unavailable.",
            ok: false,
          });
        }
        return Promise.resolve({
          account: {
            defaultHumanProfile: {
              profileId: fixture.requester.profileId,
              profileName: fixture.requester.displayName,
            },
            displayName: fixture.requester.displayName,
            email: `member-research-0-${fixture.suffix}@example.com`,
            membership: {
              memberId: fixture.requester.memberId,
              role: fixture.requester.role,
            },
            userId: fixture.requester.userId,
          },
          ok: true,
          organization: {
            id: fixture.organizationId,
            memberCount: fixture.subjects.length,
            name: "Member Research Org",
            personal: false,
            slug: `member-research-${fixture.suffix}`,
          },
        });
      },
      resolveOrganizationDirectoryMembers: ({ organizationId }) =>
        Promise.resolve({
          members: fixture.subjects.map((member) => ({
            humanProfile: null,
            joinedAt: new Date(1000).toISOString(),
            memberId: member.memberId,
            organizationId,
            role: member.role,
            user: {
              email: `${member.userId}@example.com`,
              id: member.userId,
              image: null,
              name: member.displayName,
            },
            userId: member.userId,
          })),
          ok: true as const,
          organizationId,
        }),
    },
    OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
  } as CoreBindings;
}
function humanContext(
  fixture: Awaited<ReturnType<typeof seedResearchFixture>>,
  actor: Awaited<ReturnType<typeof seedResearchFixture>>["requester"]
) {
  return {
    activeOrganizationId: fixture.organizationId,
    actorContext: {
      callerPrincipalId: actor.userId,
      ownerUserId: actor.userId,
      profileKind: "human" as const,
      profileName: actor.displayName,
      requestId: `member-research-request-${fixture.suffix}`,
      openMeldProfileId: actor.profileId,
    },
  };
}
function hostedCenterAgentContext(
  fixture: Awaited<ReturnType<typeof seedResearchFixture>>
) {
  return {
    activeOrganizationId: fixture.organizationId,
    actorContext: {
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      callerPrincipalId: fixture.centerAgentProfileId,
      openMeldProfileId: fixture.centerAgentProfileId,
      profileKind: "agent" as const,
      profileName: "Center Agent",
      requestId: `center-agent-learn-about-me-${fixture.suffix}`,
    },
  };
}
function memberResearchDocumentReviewerUserIds(
  fixture: Awaited<ReturnType<typeof seedResearchFixture>>
): string[] {
  return fixture.subjects
    .filter((member) => member.role === "admin")
    .map((member) => member.userId);
}
function insufficientEvidenceReport() {
  return {
    coverage: [
      {
        evidence: "Exact subject identity confirmed.",
        source: "organization_directory" as const,
        status: "checked" as const,
        timeRange: "Current",
      },
      {
        evidence: "No approved Profile Report exists.",
        source: "approved_profile_report" as const,
        status: "unavailable" as const,
        timeRange: "Current",
      },
      {
        evidence: "No attributable records were available.",
        source: "agent_activity" as const,
        status: "unavailable" as const,
        timeRange: "Previous 180 days",
      },
      {
        evidence: "No exact identity match was available.",
        source: "github" as const,
        status: "not_attributable" as const,
        timeRange: "Previous 180 days",
      },
      {
        evidence: "The shared Slack directory was unavailable.",
        source: "slack_workspace_directory" as const,
        status: "unavailable" as const,
        timeRange: "Current",
      },
      {
        evidence: "No attributable Slack messages were available.",
        source: "slack_channel_history" as const,
        status: "unavailable" as const,
        timeRange: "Previous 180 days",
      },
      {
        evidence: "No attributable shared App records were available.",
        source: "connected_apps" as const,
        status: "unavailable" as const,
        timeRange: "Previous 180 days",
      },
    ],
    nextSteps: [
      "Connect an attributable work source before researching again.",
    ],
    result: "insufficient_evidence" as const,
  };
}
