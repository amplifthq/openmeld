import {
  GITHUB_APP_WEBHOOK_RAW_BODY_MAX_BYTES,
  githubAppWebhookQueueMessageSchema,
  githubAppWebhookVerificationInputSchema,
  githubAppWebhookVerificationResponseSchema,
  readGitHubAppWebhookIssueObservation,
} from "@openmeld/schemas";
import type {
  GitHubAppWebhookQueueMessage,
  GitHubAppWebhookVerificationInput,
  GitHubAppWebhookVerificationResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { verifyGitHubAppWebhookSignature } from "./github-app-webhook-signature";

export async function verifyGitHubAppWebhook(input: {
  env: Pick<
    CoreBindings,
    "GITHUB_OPENMELD_WEBHOOK_SECRET" | "OPENMELD_DAEMON_DISPATCH_QUEUE"
  >;
  input: GitHubAppWebhookVerificationInput;
}): Promise<GitHubAppWebhookVerificationResponse> {
  const request = githubAppWebhookVerificationInputSchema.safeParse(
    input.input
  );
  if (!request.success) {
    return response({
      reasonCode: "github.webhook_request_invalid",
      status: "rejected",
    });
  }
  if (request.data.rawBody.length > GITHUB_APP_WEBHOOK_RAW_BODY_MAX_BYTES) {
    return response({
      reasonCode: "github.webhook_payload_too_large",
      status: "rejected",
    });
  }
  const verified = await verifyGitHubAppWebhookSignature({
    rawBody: request.data.rawBody,
    secret: input.env.GITHUB_OPENMELD_WEBHOOK_SECRET,
    signature256: request.data.headers.signature256,
  });
  if (!verified) {
    return response({
      reasonCode: "github.webhook_signature_invalid",
      status: "rejected",
    });
  }
  if (request.data.headers.event === "ping") {
    return response({ reasonCode: null, status: "accepted" });
  }
  if (!(request.data.headers.deliveryId && request.data.headers.event)) {
    return response({
      reasonCode: "github.webhook_delivery_invalid",
      status: "rejected",
    });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(request.data.rawBody) as unknown;
  } catch {
    return response({
      reasonCode: "github.webhook_payload_invalid",
      status: "rejected",
    });
  }
  const observation = readGitHubAppWebhookIssueObservation({
    event: request.data.headers.event,
    payload,
  });
  if (!observation) {
    return response({ reasonCode: null, status: "ignored" });
  }
  const queue = input.env.OPENMELD_DAEMON_DISPATCH_QUEUE;
  if (!queue) {
    return response({
      reasonCode: "github.webhook_queue_unavailable",
      status: "rejected",
    });
  }
  const message = githubAppWebhookQueueMessageSchema.parse({
    deliveryId: request.data.headers.deliveryId,
    event: "issues",
    gatewayRequestId: request.data.gatewayRequestId,
    issue: observation,
    kind: "github_app_webhook",
    receivedAtMs: request.data.receivedAtMs,
    v: 1,
  } satisfies GitHubAppWebhookQueueMessage);
  try {
    await queue.send(message);
  } catch (error) {
    console.warn("[core.github_app.webhook.enqueue_failed]", {
      deliveryId: message.deliveryId,
      error: error instanceof Error ? error.message : String(error),
      gatewayRequestId: message.gatewayRequestId,
    });
    return response({
      reasonCode: "github.webhook_enqueue_failed",
      status: "rejected",
    });
  }
  return response({ reasonCode: null, status: "accepted" });
}

function response(input: {
  reasonCode: string | null;
  status: GitHubAppWebhookVerificationResponse["status"];
}): GitHubAppWebhookVerificationResponse {
  return githubAppWebhookVerificationResponseSchema.parse(input);
}
