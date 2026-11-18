import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  githubAppWebhookQueueMessageSchema,
  spaceTaskGitHubIssueOperationId,
} from "@openmeld/schemas";
import type { GitHubAppWebhookQueueMessage } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../../lib/bindings";

import { resolveSpaceStub } from "../../../rpc/space-ref";
import { emitCoreCloudflareRuntimeEvidence } from "../../../shared/observability/cloudflare-runtime-evidence";
import {
  claimGitHubAppWebhookDelivery,
  completeGitHubAppWebhookDelivery,
} from "../../infrastructure/postgresql/github-app-webhook-delivery-repo";
import { listActiveSpaceTaskGitHubIssueLinks } from "../../infrastructure/postgresql/space-task-github-issue-link-repo";
import { listActiveSpaceTaskGitHubPullRequestLinks } from "../../infrastructure/postgresql/space-task-github-pr-link-repo";

const CLAIM_TTL_MS = 30_000;

export async function handleGitHubAppWebhookQueueMessage(input: {
  env: CoreBindings;
  message: Message<unknown>;
  queueName: string;
}): Promise<boolean> {
  const parsed = githubAppWebhookQueueMessageSchema.safeParse(
    input.message.body
  );
  if (!parsed.success) {
    return false;
  }

  const startedAt = Date.now();
  emitCoreCloudflareRuntimeEvidence(input.env, {
    durationMs: 0,
    event: "core.github_app.webhook.queue_message_started",
    messageCount: 1,
    operation: input.queueName,
    requestId: parsed.data.gatewayRequestId,
    runtimeKind: "queue",
    status: "started",
    workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
  });

  try {
    await processGitHubAppWebhookQueueMessage({
      env: input.env,
      message: parsed.data,
    });
    input.message.ack();
    emitCoreCloudflareRuntimeEvidence(input.env, {
      durationMs: Date.now() - startedAt,
      event: "core.github_app.webhook.queue_message_succeeded",
      messageCount: 1,
      operation: input.queueName,
      requestId: parsed.data.gatewayRequestId,
      runtimeKind: "queue",
      status: "succeeded",
      workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
    });
    return true;
  } catch (error) {
    console.warn("[core.github_app.webhook.queue_message_failed]", {
      deliveryId: parsed.data.deliveryId,
      error: error instanceof Error ? error.message : String(error),
      gatewayRequestId: parsed.data.gatewayRequestId,
    });
    input.message.retry();
    emitCoreCloudflareRuntimeEvidence(input.env, {
      durationMs: Date.now() - startedAt,
      event: "core.github_app.webhook.queue_message_failed",
      messageCount: 1,
      operation: input.queueName,
      requestId: parsed.data.gatewayRequestId,
      runtimeKind: "queue",
      status: "failed",
      workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
    });
    return true;
  }
}

export async function processGitHubAppWebhookQueueMessage(input: {
  env: CoreBindings;
  message: GitHubAppWebhookQueueMessage;
}): Promise<void> {
  // Split the logic to keep complexity contained.
  if (input.message.event === "issues") {
    await processIssueWebhook(input);
    return;
  }
  await processPullRequestWebhook(input);
}

async function processIssueWebhook(input: {
  env: CoreBindings;
  message: GitHubAppWebhookQueueMessage;
}): Promise<void> {
  const db = getPostgresDatabase(input.env);
  const nowMs = Date.now();
  const action = input.message.issue.state === "closed" ? "closed" : "reopened";
  const claim = await claimGitHubAppWebhookDelivery({
    action,
    claimExpiresAtMs: nowMs + CLAIM_TTL_MS,
    claimId: crypto.randomUUID(),
    db,
    deliveryId: input.message.deliveryId,
    event: "issues",
    gatewayRequestId: input.message.gatewayRequestId,
    issueState: input.message.issue.state,
    nowMs,
    number: input.message.issue.number,
    ownerLogin: input.message.issue.owner,
    receivedAtMs: input.message.receivedAtMs,
    repo: input.message.issue.repo,
  });
  if (claim === "duplicate") {
    return;
  }

  try {
    const links = await listActiveSpaceTaskGitHubIssueLinks({
      db,
      number: input.message.issue.number,
      owner: input.message.issue.owner,
      repo: input.message.issue.repo,
    });
    for (const link of links) {
      const stub = resolveSpaceStub(input.env.OPENMELD_SPACES, link.spaceId);
      if (!stub) {
        continue;
      }
      await stub.rpcApplyGitHubIssueObservation({
        identity: {
          number: input.message.issue.number,
          owner: input.message.issue.owner,
          repo: input.message.issue.repo,
        },
        observeOperationId: spaceTaskGitHubIssueOperationId(
          input.message.issue.state === "closed"
            ? "observe-closed"
            : "observe-open",
          input.message.issue,
          link.taskId,
          input.message.deliveryId
        ),
        observedAt: input.message.issue.updatedAt,
        observedState: input.message.issue.state,
        observedStateReason: input.message.issue.stateReason,
        spaceId: link.spaceId,
        taskId: link.taskId,
      });
    }
    await completeGitHubAppWebhookDelivery({
      db,
      deliveryId: input.message.deliveryId,
      failureCode: null,
      nowMs: Date.now(),
      state: links.length === 0 ? "ignored" : "completed",
    });
  } catch (error) {
    await completeGitHubAppWebhookDelivery({
      db,
      deliveryId: input.message.deliveryId,
      failureCode: "github.webhook_processing_failed",
      nowMs: Date.now(),
      state: "failed",
    });
    throw error;
  }
}

async function processPullRequestWebhook(input: {
  env: CoreBindings;
  message: GitHubAppWebhookQueueMessage;
}): Promise<void> {
  const db = getPostgresDatabase(input.env);
  const nowMs = Date.now();
  const claim = await claimGitHubAppWebhookDelivery({
    action: "observed",
    claimExpiresAtMs: nowMs + CLAIM_TTL_MS,
    claimId: crypto.randomUUID(),
    db,
    deliveryId: input.message.deliveryId,
    event: "pull_request",
    gatewayRequestId: input.message.gatewayRequestId,
    issueState: null,
    nowMs,
    number: input.message.pullRequest?.number ?? 0,
    ownerLogin: input.message.pullRequest?.owner ?? "",
    receivedAtMs: input.message.receivedAtMs,
    repo: input.message.pullRequest?.repo ?? "",
  });
  if (claim === "duplicate") {
    return;
  }
  try {
    const links = await listActiveSpaceTaskGitHubPullRequestLinks({
      db,
      number: input.message.pullRequest?.number ?? 0,
      owner: input.message.pullRequest?.owner ?? "",
      repo: input.message.pullRequest?.repo ?? "",
    });
    for (const link of links) {
      const stub = resolveSpaceStub(input.env.OPENMELD_SPACES, link.spaceId);
      if (!(stub && input.message.pullRequest)) {
        continue;
      }
      await stub.rpcApplyGitHubPullRequestObservation({
        identity: {
          number: input.message.pullRequest.number,
          owner: input.message.pullRequest.owner,
          repo: input.message.pullRequest.repo,
        },
        observeOperationId: spaceTaskGitHubIssueOperationId(
          "observe-open",
          {
            number: input.message.pullRequest.number,
            owner: input.message.pullRequest.owner,
            repo: input.message.pullRequest.repo,
            state: "open",
            stateReason: null,
            updatedAt: input.message.pullRequest.observedAt,
            url: input.message.pullRequest.url,
          },
          link.taskId,
          input.message.deliveryId
        ),
        observedAt: input.message.pullRequest.observedAt,
        headSha: input.message.pullRequest.headSha,
        spaceId: link.spaceId,
        taskId: link.taskId,
      });
    }
    await completeGitHubAppWebhookDelivery({
      db,
      deliveryId: input.message.deliveryId,
      failureCode: null,
      nowMs: Date.now(),
      state: links.length === 0 ? "ignored" : "completed",
    });
  } catch (error) {
    await completeGitHubAppWebhookDelivery({
      db,
      deliveryId: input.message.deliveryId,
      failureCode: "github.webhook_processing_failed",
      nowMs: Date.now(),
      state: "failed",
    });
    throw error;
  }
}
