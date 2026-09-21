import type { z } from "zod/v4";

type SchemaModule = typeof import("../../schemas/runtime/github-app-webhook");

export type GitHubAppWebhookIssueAction = z.infer<
  SchemaModule["githubAppWebhookIssueActionSchema"]
>;
export type GitHubAppWebhookIssueObservation = z.infer<
  SchemaModule["githubAppWebhookIssueObservationSchema"]
>;
export type GitHubAppWebhookIssueState = z.infer<
  SchemaModule["githubAppWebhookIssueStateSchema"]
>;
export type GitHubAppWebhookQueueMessage = z.infer<
  SchemaModule["githubAppWebhookQueueMessageSchema"]
>;
export type GitHubAppWebhookVerificationInput = z.infer<
  SchemaModule["githubAppWebhookVerificationInputSchema"]
>;
export type GitHubAppWebhookVerificationResponse = z.infer<
  SchemaModule["githubAppWebhookVerificationResponseSchema"]
>;
