import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFeedbackIssueService,
  type FeedbackInboxRecord,
  type FeedbackIssueRecord,
  type FeedbackIssueRepository,
} from "../src/feedback/application/feedback-issue-service";
import { createD1FeedbackIssueRepository } from "../src/feedback/infrastructure/d1/feedback-issue-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const SUBMISSION_SUMMARY = "The submit button did not respond.";
const SUBMISSION_DETAILS = "The page stayed unchanged after three attempts.";
const SUBMISSION_EMAIL = "feedback@example.com";

describe("Feedback Issue service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a new issue through the receiving inbox and logs no submitted text", async () => {
    const repository = createRepository({
      inbox: createInbox({ organizationId: "org_receiving" }),
    });
    const info = vi.fn();
    const service = createFeedbackIssueService({
      generateIssueId: () => "feedback_issue_1",
      logger: { info, warn: vi.fn() },
      nowMs: () => 2000,
      repository,
    });

    await expect(
      service.submitFeedbackIssue({
        inboxKey: "feedback_key_1",
        request: {
          category: "bug",
          summary: SUBMISSION_SUMMARY,
          details: SUBMISSION_DETAILS,
          submitterKind: "local_agent",
          sourceOrganizationId: "org_source",
          contactEmail: SUBMISSION_EMAIL,
          clientContext: {
            clientKind: "cli",
            clientVersion: "0.1.0",
            os: "macOS 15.5",
          },
        },
        submitterUserId: "user_1",
      })
    ).resolves.toEqual({ ok: true, issueId: "feedback_issue_1" });

    expect(repository.createIssue).toHaveBeenCalledWith({
      issueId: "feedback_issue_1",
      inboxId: "feedback_inbox_1",
      organizationId: "org_receiving",
      category: "bug",
      summary: SUBMISSION_SUMMARY,
      details: SUBMISSION_DETAILS,
      submitterKind: "local_agent",
      submitterUserId: "user_1",
      sourceOrganizationId: "org_source",
      contactEmail: SUBMISSION_EMAIL,
      clientContext: {
        clientKind: "cli",
        clientVersion: "0.1.0",
        os: "macOS 15.5",
      },
      status: "new",
      triageNote: null,
      createdAtMs: 2000,
      updatedAtMs: 2000,
    });
    expect(info).toHaveBeenCalledWith("[core.feedback.issue_submitted]", {
      event: "core.feedback.issue_submitted",
      issueId: "feedback_issue_1",
      inboxId: "feedback_inbox_1",
      category: "bug",
      submitterKind: "local_agent",
      summaryLength: SUBMISSION_SUMMARY.length,
      detailsLength: SUBMISSION_DETAILS.length,
      reasonCode: "submitted",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(SUBMISSION_SUMMARY);
    expect(JSON.stringify(info.mock.calls)).not.toContain(SUBMISSION_DETAILS);
    expect(JSON.stringify(info.mock.calls)).not.toContain(SUBMISSION_EMAIL);
  });

  it.each([
    {
      name: "missing inbox",
      inbox: null,
      code: "feedback.submit.inbox_not_found",
    },
    {
      name: "paused inbox",
      inbox: createInbox({ status: "paused" }),
      code: "feedback.submit.disabled",
    },
    {
      name: "unsupported delivery mode",
      inbox: createInbox({ deliveryMode: "unexpected_mode" }),
      code: "feedback.submit.disabled",
    },
  ])("rejects $name without writing an issue", async ({ inbox, code }) => {
    const repository = createRepository({ inbox });
    const service = createFeedbackIssueService({
      generateIssueId: () => "feedback_issue_never_written",
      logger: { info: vi.fn(), warn: vi.fn() },
      nowMs: () => 2000,
      repository,
    });

    await expect(
      service.submitFeedbackIssue({
        inboxKey: "feedback_key_1",
        request: {
          category: "idea",
          summary: "Add a compact diagnostics view.",
          submitterKind: "human",
        },
        submitterUserId: null,
      })
    ).rejects.toMatchObject({ code });
    expect(repository.createIssue).not.toHaveBeenCalled();
  });

  it("paginates organization issues with an optional status filter", async () => {
    const repository = createRepository({
      inbox: createInbox(),
      issues: [
        createIssue({ issueId: "feedback_issue_3", createdAtMs: 3000 }),
        createIssue({ issueId: "feedback_issue_2", createdAtMs: 2000 }),
        createIssue({ issueId: "feedback_issue_1", createdAtMs: 1000 }),
      ],
    });
    const service = createFeedbackIssueService({
      generateIssueId: () => "feedback_issue_unused",
      logger: { info: vi.fn(), warn: vi.fn() },
      nowMs: () => 4000,
      repository,
    });

    await expect(
      service.listFeedbackIssues({
        organizationId: "org_receiving",
        status: "investigating",
        limit: 2,
      })
    ).resolves.toEqual({
      items: [
        createIssue({ issueId: "feedback_issue_3", createdAtMs: 3000 }),
        createIssue({ issueId: "feedback_issue_2", createdAtMs: 2000 }),
      ],
      nextCursor: { createdAtMs: 2000, issueId: "feedback_issue_2" },
    });
    expect(repository.listIssues).toHaveBeenCalledWith({
      organizationId: "org_receiving",
      status: "investigating",
      cursor: null,
      limit: 3,
    });
  });

  it("updates issue status and triage note within the receiving organization", async () => {
    const updated = createIssue({
      status: "needs_human",
      triageNote: "Confirm the account state with support.",
      updatedAtMs: 5000,
    });
    const repository = createRepository({
      inbox: createInbox(),
      updatedIssue: updated,
    });
    const service = createFeedbackIssueService({
      generateIssueId: () => "feedback_issue_unused",
      logger: { info: vi.fn(), warn: vi.fn() },
      nowMs: () => 5000,
      repository,
    });

    await expect(
      service.updateFeedbackIssueStatus({
        organizationId: "org_receiving",
        issueId: "feedback_issue_1",
        status: "needs_human",
        triageNote: "Confirm the account state with support.",
      })
    ).resolves.toEqual(updated);
    expect(repository.updateIssueStatus).toHaveBeenCalledWith({
      allowedCurrentStatuses: ["new", "needs_human"],
      organizationId: "org_receiving",
      issueId: "feedback_issue_1",
      status: "needs_human",
      triageNote: "Confirm the account state with support.",
      updatedAtMs: 5000,
    });
  });

  it("rejects a status transition after an issue is resolved", async () => {
    const repository = createRepository({
      inbox: createInbox(),
      statusUpdateResult: {
        outcome: "invalid_transition",
        currentStatus: "resolved",
      },
    });
    const service = createFeedbackIssueService({
      generateIssueId: () => "feedback_issue_unused",
      logger: { info: vi.fn(), warn: vi.fn() },
      nowMs: () => 5000,
      repository,
    });

    await expect(
      service.updateFeedbackIssueStatus({
        organizationId: "org_receiving",
        issueId: "feedback_issue_1",
        status: "new",
      })
    ).rejects.toMatchObject({
      code: "feedback.issue.invalid_transition",
    });
    expect(repository.updateIssueStatus).toHaveBeenCalledWith({
      allowedCurrentStatuses: ["new"],
      organizationId: "org_receiving",
      issueId: "feedback_issue_1",
      status: "new",
      triageNote: null,
      updatedAtMs: 5000,
    });
  });
});

describe("Feedback Issue D1 repository", () => {
  it("round-trips submit, list, and status update behavior through the 0021 tables", async () => {
    const harness = createSqliteD1Harness();
    try {
      applyDrizzleMigrationForTable(harness, "openMeldFeedback_inboxes");
      applyDrizzleMigrationForTable(harness, "openMeldFeedback_issues");
      harness.run({
        sql: `
          INSERT INTO openMeldFeedback_inboxes (
            inbox_id,
            organization_id,
            label,
            inbox_key,
            delivery_mode,
            status,
            created_at_ms,
            updated_at_ms
          ) VALUES (
            'feedback_inbox_1',
            'org_receiving',
            'OpenMeld Feedback',
            'feedback_key_1',
            'inbox_only',
            'active',
            1000,
            1000
          )
        `,
      });
      const service = createFeedbackIssueService({
        generateIssueId: () => "feedback_issue_1",
        logger: { info: vi.fn(), warn: vi.fn() },
        nowMs: () => 2000,
        repository: createD1FeedbackIssueRepository({ db: harness.db }),
      });

      await service.submitFeedbackIssue({
        inboxKey: "feedback_key_1",
        request: {
          category: "experience",
          summary: "The setup progress stopped.",
          submitterKind: "center_agent",
          sourceOrganizationId: "org_source",
          clientContext: { clientKind: "center_agent" },
        },
        submitterUserId: null,
      });
      const listed = await service.listFeedbackIssues({
        organizationId: "org_receiving",
        limit: 20,
      });
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]).toMatchObject({
        issueId: "feedback_issue_1",
        organizationId: "org_receiving",
        status: "new",
        clientContext: { clientKind: "center_agent" },
      });

      await service.updateFeedbackIssueStatus({
        organizationId: "org_receiving",
        issueId: "feedback_issue_1",
        status: "investigating",
        triageNote: "Reproduced and under investigation.",
      });
      await service.updateFeedbackIssueStatus({
        organizationId: "org_receiving",
        issueId: "feedback_issue_1",
        status: "resolved",
        triageNote: "Verified in the next build.",
      });
      await expect(
        service.updateFeedbackIssueStatus({
          organizationId: "org_receiving",
          issueId: "feedback_issue_1",
          status: "new",
          triageNote: "Reopen without a supported transition.",
        })
      ).rejects.toMatchObject({
        code: "feedback.issue.invalid_transition",
      });
      expect(
        harness.queryFirst({
          sql: `
            SELECT
              status,
              triage_note AS triageNote
            FROM openMeldFeedback_issues
            WHERE issue_id = 'feedback_issue_1'
          `,
        })
      ).toEqual({
        status: "resolved",
        triageNote: "Verified in the next build.",
      });
    } finally {
      harness.close();
    }
  });
});

function createInbox(
  overrides: Partial<FeedbackInboxRecord> = {}
): FeedbackInboxRecord {
  return {
    inboxId: "feedback_inbox_1",
    organizationId: "org_receiving",
    label: "OpenMeld Feedback",
    inboxKey: "feedback_key_1",
    deliveryMode: "inbox_only",
    status: "active",
    createdAtMs: 1000,
    updatedAtMs: 1000,
    ...overrides,
  };
}

function createIssue(
  overrides: Partial<FeedbackIssueRecord> = {}
): FeedbackIssueRecord {
  return {
    issueId: "feedback_issue_1",
    inboxId: "feedback_inbox_1",
    organizationId: "org_receiving",
    category: "bug",
    summary: "The submit button did not respond.",
    details: null,
    submitterKind: "human",
    submitterUserId: null,
    sourceOrganizationId: null,
    contactEmail: null,
    clientContext: null,
    status: "new",
    triageNote: null,
    createdAtMs: 1000,
    updatedAtMs: 1000,
    ...overrides,
  };
}

function createRepository(input: {
  inbox: FeedbackInboxRecord | null;
  issues?: FeedbackIssueRecord[];
  statusUpdateResult?: Awaited<
    ReturnType<FeedbackIssueRepository["updateIssueStatus"]>
  >;
  updatedIssue?: FeedbackIssueRecord | null;
}): FeedbackIssueRepository & {
  createIssue: ReturnType<typeof vi.fn>;
  listIssues: ReturnType<typeof vi.fn>;
  updateIssueStatus: ReturnType<typeof vi.fn>;
} {
  return {
    findInboxByKey: vi.fn(async () => input.inbox),
    createIssue: vi.fn(async (issue: FeedbackIssueRecord) => issue),
    listIssues: vi.fn(async () => input.issues ?? []),
    updateIssueStatus: vi.fn(() => {
      if (input.statusUpdateResult) {
        return Promise.resolve(input.statusUpdateResult);
      }
      if (input.updatedIssue) {
        return Promise.resolve({
          outcome: "updated" as const,
          issue: input.updatedIssue,
        });
      }
      return Promise.resolve({ outcome: "not_found" as const });
    }),
  };
}
