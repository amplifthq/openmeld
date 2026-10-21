import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import {
  rpcListFeedbackIssuesForOrganization,
  rpcReadFeedbackReportingPolicy,
  rpcSetFeedbackReportingPolicy,
  rpcUpdateFeedbackIssueStatusForOrganization,
} from "../src/feedback/transport/rpc/feedback-management-rpc";
import { rpcSubmitFeedbackIssue } from "../src/feedback/transport/rpc/feedback-rpc";
import { GatewayRpcEntrypoint } from "../src/index";
import type { CoreBindings } from "../src/lib/bindings";
import { env } from "../test-support/worker-env";

describe("Feedback submit RPC", () => {
  it("writes a validated anonymous issue into the inbox organization", async () => {
    const suffix = crypto.randomUUID();
    const inboxId = `feedback_inbox_${suffix}`;
    const inboxKey = `feedback_key_${suffix}`;
    const organizationId = `org_feedback_${suffix}`;
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."openMeldFeedback_inboxes" (
          inbox_id,
          organization_id,
          label,
          inbox_key,
          delivery_mode,
          status,
          created_at_ms,
          updated_at_ms
        ) VALUES ($1, $2, $3, $4, 'inbox_only', 'active', $5, $6)
      `,
        values: [],
      },
      values: [
        inboxId,
        organizationId,
        "OpenMeld Feedback",
        inboxKey,
        1000,
        1000,
      ],
    });
    const result = await rpcSubmitFeedbackIssue(env as CoreBindings, {
      inboxKey,
      request: {
        category: "question",
        summary: "Where can I find service diagnostics?",
        submitterKind: "human",
      },
      submitterUserId: null,
    });
    expect(result.ok).toBe(true);
    await expect(
      getPostgresDatabase(env)
        .query({
          ...{
            text: `
          SELECT
            organization_id AS "organizationId",
            submitter_user_id AS "submitterUserId",
            status
          FROM "openmeld"."openMeldFeedback_issues"
          WHERE issue_id = $1
        `,
            values: [],
          },
          values: [result.issueId],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toEqual({
      organizationId,
      submitterUserId: null,
      status: "new",
    });
  });
  it("preserves stable Feedback errors without echoing submitted text", async () => {
    const privateSummary = "A private summary that must not enter the error";
    let error: unknown;
    try {
      await rpcSubmitFeedbackIssue(env as CoreBindings, {
        inboxKey: `feedback_key_missing_${crypto.randomUUID()}`,
        request: {
          category: "bug",
          summary: privateSummary,
          submitterKind: "local_agent",
        },
        submitterUserId: null,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(
      (
        error as Error & {
          cause?: unknown;
        }
      ).cause
    ).toMatchObject({
      status: 404,
      code: "feedback.submit.inbox_not_found",
      message: "feedback inbox was not found",
    });
    expect(String((error as Error).message)).not.toContain(privateSummary);
  });
  it("exposes only submit on the explicit Gateway Feedback RPC surface", () => {
    const methods = Object.getOwnPropertyNames(GatewayRpcEntrypoint.prototype);
    expect(methods).toContain("submitFeedbackIssue");
    expect(methods).toContain("readCurrentOrganizationFeedbackReportingPolicy");
    expect(methods).toContain("setCurrentOrganizationFeedbackReportingPolicy");
    expect(methods).not.toContain("readFeedbackReportingPolicy");
    expect(methods).not.toContain("listFeedbackIssuesForOrganization");
    expect(methods).not.toContain("updateFeedbackIssueStatusForOrganization");
    expect(methods).not.toContain("listFeedbackIssues");
    expect(methods).not.toContain("updateFeedbackIssueStatus");
  });
  it("lists and updates issues only inside the explicit organization", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org_feedback_owner_${suffix}`;
    const otherOrganizationId = `org_feedback_other_${suffix}`;
    const first = await seedFeedbackIssue({
      suffix: `${suffix}_owner`,
      organizationId,
    });
    const other = await seedFeedbackIssue({
      suffix: `${suffix}_other`,
      organizationId: otherOrganizationId,
    });
    await expect(
      rpcListFeedbackIssuesForOrganization(env as CoreBindings, {
        organizationId,
        limit: 20,
      })
    ).resolves.toMatchObject({
      items: [{ issueId: first.issueId, organizationId }],
      nextCursor: null,
    });
    await expect(
      rpcUpdateFeedbackIssueStatusForOrganization(env as CoreBindings, {
        organizationId,
        issueId: other.issueId,
        status: "investigating",
      })
    ).rejects.toMatchObject({
      cause: {
        status: 404,
        code: "feedback.issue.not_found",
      },
    });
    await expect(
      rpcUpdateFeedbackIssueStatusForOrganization(env as CoreBindings, {
        organizationId,
        issueId: first.issueId,
        status: "investigating",
        triageNote: "Reproduced locally.",
      })
    ).resolves.toMatchObject({
      issueId: first.issueId,
      organizationId,
      status: "investigating",
      triageNote: "Reproduced locally.",
    });
  });
  it("preserves an invalid transition as a structured Feedback error", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org_feedback_transition_${suffix}`;
    const issue = await seedFeedbackIssue({ suffix, organizationId });
    await rpcUpdateFeedbackIssueStatusForOrganization(env as CoreBindings, {
      organizationId,
      issueId: issue.issueId,
      status: "investigating",
    });
    await rpcUpdateFeedbackIssueStatusForOrganization(env as CoreBindings, {
      organizationId,
      issueId: issue.issueId,
      status: "resolved",
    });
    await expect(
      rpcUpdateFeedbackIssueStatusForOrganization(env as CoreBindings, {
        organizationId,
        issueId: issue.issueId,
        status: "new",
      })
    ).rejects.toMatchObject({
      cause: {
        status: 409,
        code: "feedback.issue.invalid_transition",
        message: "feedback issue status transition is invalid",
      },
    });
  });
  it("defaults reporting to enabled and persists an explicit opt-out", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org_feedback_policy_${suffix}`;
    const userId = `user_feedback_policy_${suffix}`;
    await seedOrganizationAndUser({ organizationId, suffix, userId });
    await expect(
      rpcReadFeedbackReportingPolicy(env as CoreBindings, { organizationId })
    ).resolves.toEqual({
      organizationId,
      reportingEnabled: true,
      updatedByUserId: null,
    });
    await expect(
      rpcSetFeedbackReportingPolicy(env as CoreBindings, {
        organizationId,
        reportingEnabled: false,
        updatedByUserId: userId,
      })
    ).resolves.toEqual({
      organizationId,
      reportingEnabled: false,
      updatedByUserId: userId,
    });
    await expect(
      rpcReadFeedbackReportingPolicy(env as CoreBindings, { organizationId })
    ).resolves.toMatchObject({ reportingEnabled: false });
  });
});
async function seedFeedbackIssue(input: {
  organizationId: string;
  suffix: string;
}): Promise<{
  issueId: string;
}> {
  const inboxId = `feedback_inbox_${input.suffix}`;
  const inboxKey = `feedback_key_${input.suffix}`;
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."openMeldFeedback_inboxes" (
        inbox_id,
        organization_id,
        label,
        inbox_key,
        delivery_mode,
        status,
        created_at_ms,
        updated_at_ms
      ) VALUES ($1, $2, $3, $4, 'inbox_only', 'active', $5, $6)
    `,
      values: [],
    },
    values: [
      inboxId,
      input.organizationId,
      "OpenMeld Feedback",
      inboxKey,
      1000,
      1000,
    ],
  });
  return await rpcSubmitFeedbackIssue(env as CoreBindings, {
    inboxKey,
    request: {
      category: "bug",
      summary: `Feedback issue ${input.suffix}`,
      submitterKind: "center_agent",
      sourceOrganizationId: input.organizationId,
      clientContext: { clientKind: "center_agent" },
    },
    submitterUserId: null,
  });
}
async function seedOrganizationAndUser(input: {
  organizationId: string;
  suffix: string;
  userId: string;
}): Promise<void> {
  await getPostgresDatabase(env).query({
    ...{
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
      values: [],
    },
    values: [
      input.organizationId,
      "Feedback Org",
      `feedback-${input.suffix}`,
      1000,
    ],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
      values: [],
    },
    values: [
      input.userId,
      "Feedback Owner",
      `feedback-${input.suffix}@example.com`,
      1,
      1000,
      1000,
    ],
  });
}
