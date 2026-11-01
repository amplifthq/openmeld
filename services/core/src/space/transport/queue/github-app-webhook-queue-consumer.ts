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
  const db = getPostgresDatabase(input.env);
  const nowMs = Date.now();
  const claim = await claimGitHubAppWebhookDelivery({
    action: input.message.issue.state === "closed" ? "closed" : "reopened",
    claimExpiresAtMs: nowMs + CLAIM_TTL_MS,
    claimId: crypto.randomUUID(),
    db,
    deliveryId: input.message.deliveryId,
    event: input.message.event,
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
