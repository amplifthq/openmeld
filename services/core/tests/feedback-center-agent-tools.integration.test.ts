import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { submitFeedbackIssueRequestSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
} from "../../remote-agent/agent-core/callback-context";
import {
  getRemoteAgentOpenMeldToolDefinitions,
  type RemoteAgentOpenMeldToolName,
} from "../../remote-agent/agent-core/tools";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import { InMemoryDurableObjectStorage } from "../../remote-agent/tests/storage";
import {
  rpcListFeedbackIssuesForOrganization,
  rpcReadFeedbackReportingPolicy,
  rpcUpdateFeedbackIssueStatusForOrganization,
} from "../src/feedback/transport/rpc/feedback-management-rpc";
import { rpcSubmitFeedbackIssue } from "../src/feedback/transport/rpc/feedback-rpc";
import type { CoreBindings } from "../src/lib/bindings";
import { env } from "../test-support/worker-env";

describe("Center Agent Feedback tools integration", () => {
  it("reports through the public HTTP contract, then lists and updates through Core", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org_feedback_tools_${suffix}`;
    const inboxId = `feedback_inbox_${suffix}`;
    const inboxKey = `feedback_key_${suffix}`;
    const summary = `Setup submit stays blocked ${suffix}`;
    await seedFeedbackInbox({ inboxId, inboxKey, organizationId });
    const storage = await createToolStorage({ organizationId, suffix });
    const coreWorker = createRealFeedbackCoreBinding();
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker,
      feedbackSubmission: {
        baseUrl: "http://local",
        fetch: createLocalPublicFeedbackFetch({ inboxKey }),
        inboxKey,
      },
      storage,
      submissionId: `submission_${suffix}`,
    });
    const reported = (await executeTool(tools, "openmeld_report_feedback", {
      category: "bug",
      details: "The control remains disabled after setup completes.",
      summary,
    })) as {
      issueId: string;
      ok: true;
    };
    expect(reported).toMatchObject({ ok: true });
    const listed = (await executeTool(tools, "openmeld_list_feedback_issues", {
      limit: 10,
      status: "new",
    })) as {
      items: Array<{
        issueId: string;
        summary: string;
      }>;
      notice: string;
    };
    expect(listed.items).toEqual([
      expect.objectContaining({ issueId: reported.issueId, summary }),
    ]);
    expect(listed.notice).toContain("untrusted external submissions");
    await expect(
      executeTool(tools, "openmeld_update_feedback_issue", {
        issueId: reported.issueId,
        status: "investigating",
        triageNote: "Reproduced through the tool integration path.",
      })
    ).resolves.toMatchObject({
      issueId: reported.issueId,
      organizationId,
      status: "investigating",
      triageNote: "Reproduced through the tool integration path.",
    });
    await expect(
      rpcReadFeedbackReportingPolicy(env as CoreBindings, { organizationId })
    ).resolves.toEqual({
      organizationId,
      reportingEnabled: true,
      updatedByUserId: null,
    });
  });
});
function createRealFeedbackCoreBinding(): RemoteAgentCoreWorkerBinding {
  const coreEnv = env as CoreBindings;
  return {
    listFeedbackIssuesForOrganization: async (input) =>
      await rpcListFeedbackIssuesForOrganization(
        coreEnv,
        input as Parameters<typeof rpcListFeedbackIssuesForOrganization>[1]
      ),
    readFeedbackReportingPolicy: async (input) =>
      await rpcReadFeedbackReportingPolicy(
        coreEnv,
        input as Parameters<typeof rpcReadFeedbackReportingPolicy>[1]
      ),
    updateFeedbackIssueStatusForOrganization: async (input) =>
      await rpcUpdateFeedbackIssueStatusForOrganization(
        coreEnv,
        input as Parameters<
          typeof rpcUpdateFeedbackIssueStatusForOrganization
        >[1]
      ),
  };
}
function createLocalPublicFeedbackFetch(input: {
  inboxKey: string;
}): typeof globalThis.fetch {
  return async (request, init) => {
    const httpRequest = new Request(request, init);
    const expectedPath = `/v1/feedback/inboxes/${encodeURIComponent(input.inboxKey)}/issues`;
    if (
      httpRequest.method !== "POST" ||
      new URL(httpRequest.url).pathname !== expectedPath
    ) {
      return new Response(null, { status: 404 });
    }
    const body = submitFeedbackIssueRequestSchema.safeParse(
      await httpRequest.json()
    );
    if (!body.success) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "feedback.submit.invalid_input",
            message: "feedback submission is invalid",
            requestId: "local-tool-integration",
          },
        },
        { status: 400 }
      );
    }
    return Response.json(
      await rpcSubmitFeedbackIssue(env as CoreBindings, {
        inboxKey: input.inboxKey,
        request: body.data,
        submitterUserId: null,
      })
    );
  };
}
async function createToolStorage(input: {
  organizationId: string;
  suffix: string;
}): Promise<InMemoryDurableObjectStorage> {
  const baseRequest = createSubmitTurnRequest();
  const request = createSubmitTurnRequest({
    dispatchId: `dispatch_${input.suffix}`,
    idempotencyKey: `remote-agent:${input.suffix}`,
    organizationId: input.organizationId,
    turnEnvelope: {
      ...baseRequest.turnEnvelope,
      organization: {
        ...baseRequest.turnEnvelope?.organization,
        id: input.organizationId,
      },
    },
  });
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(
    storage,
    createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: Date.now(),
        idempotencyKey: request.idempotencyKey,
        requestId: `request_${input.suffix}`,
        status: "pending",
        submissionId: `submission_${input.suffix}`,
      },
      nowMs: Date.now(),
      request,
    })
  );
  return storage;
}
async function seedFeedbackInbox(input: {
  inboxId: string;
  inboxKey: string;
  organizationId: string;
}): Promise<void> {
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
      ) VALUES ($1, $2, 'Local Center Agent Feedback', $3, 'inbox_only', 'active', $4, $5)
    `,
      values: [],
    },
    values: [
      input.inboxId,
      input.organizationId,
      input.inboxKey,
      Date.now(),
      Date.now(),
    ],
  });
}
async function executeTool(
  tools: ReturnType<typeof getRemoteAgentOpenMeldToolDefinitions>,
  name: RemoteAgentOpenMeldToolName,
  input: Record<string, unknown>
): Promise<unknown> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing remote-agent tool: ${name}`);
  }
  return await tool.execute(input);
}
