import * as z from "zod/v4";
import { remoteAgentGitShaSchema } from "./remote-agent-git";

export const GITHUB_APP_WEBHOOK_RAW_BODY_MAX_BYTES = 262_144;

const githubLoginSchema = z.string().trim().min(1).max(100);
const githubRepoNameSchema = z.string().trim().min(1).max(100);

export const githubAppWebhookIssueActionSchema = z.enum(["closed", "reopened"]);

export const githubAppWebhookIssueStateSchema = z.enum(["open", "closed"]);

export const githubAppWebhookIssueObservationSchema = z.strictObject({
  number: z.number().int().positive(),
  owner: githubLoginSchema,
  repo: githubRepoNameSchema,
  state: githubAppWebhookIssueStateSchema,
  stateReason: z.string().max(100).nullish(),
  updatedAt: z.string().datetime(),
  url: z.url().max(2048),
});

const githubAppWebhookPullRequestObservationSchema = z.strictObject({
  number: z.number().int().positive(),
  owner: githubLoginSchema,
  repo: githubRepoNameSchema,
  headSha: remoteAgentGitShaSchema,
  observedAt: z.string().datetime(),
  url: z.url().max(2048),
});

const githubAppWebhookQueueMessageBaseShape = {
  deliveryId: z.string().trim().min(1).max(128),
  gatewayRequestId: z.string().uuid(),
  kind: z.literal("github_app_webhook"),
  receivedAtMs: z.number().int().nonnegative(),
  v: z.literal(1),
};

export const githubAppWebhookQueueMessageSchema = z.discriminatedUnion(
  "event",
  [
    z.strictObject({
      ...githubAppWebhookQueueMessageBaseShape,
      event: z.literal("issues"),
      issue: githubAppWebhookIssueObservationSchema,
    }),
    z.strictObject({
      ...githubAppWebhookQueueMessageBaseShape,
      event: z.literal("pull_request"),
      pullRequest: githubAppWebhookPullRequestObservationSchema,
    }),
  ]
);

export const githubAppWebhookVerificationInputSchema = z.strictObject({
  gatewayRequestId: z.string().uuid(),
  headers: z.strictObject({
    deliveryId: z.string().trim().min(1).max(128).nullable(),
    event: z.string().trim().min(1).max(64).nullable(),
    signature256: z.string().trim().min(1).max(128).nullable(),
  }),
  rawBody: z.string().max(GITHUB_APP_WEBHOOK_RAW_BODY_MAX_BYTES),
  receivedAtMs: z.number().int().nonnegative(),
});

export const githubAppWebhookVerificationResponseSchema = z.strictObject({
  reasonCode: z.string().trim().min(1).max(120).nullable(),
  status: z.enum(["accepted", "ignored", "rejected"]),
});

const githubIssuesWebhookPayloadSchema = z
  .object({
    action: z.string(),
    issue: z
      .object({
        html_url: z.url(),
        number: z.number().int().positive(),
        state: githubAppWebhookIssueStateSchema,
        state_reason: z.string().max(100).nullish(),
        updated_at: z.string().min(1),
      })
      .catchall(z.unknown()),
    repository: z
      .object({
        name: githubRepoNameSchema,
        owner: z
          .object({
            login: githubLoginSchema,
          })
          .catchall(z.unknown()),
      })
      .catchall(z.unknown()),
  })
  .catchall(z.unknown());

export function readGitHubAppWebhookIssueObservation(input: {
  event: string | null;
  payload: unknown;
}): z.infer<typeof githubAppWebhookIssueObservationSchema> | null {
  if (input.event !== "issues") {
    return null;
  }
  const parsed = githubIssuesWebhookPayloadSchema.safeParse(input.payload);
  if (!parsed.success) {
    return null;
  }
  if (parsed.data.action !== "closed" && parsed.data.action !== "reopened") {
    return null;
  }
  const updatedAt = new Date(parsed.data.issue.updated_at);
  if (Number.isNaN(updatedAt.getTime())) {
    return null;
  }
  const expectedState = parsed.data.action === "closed" ? "closed" : "open";
  if (parsed.data.issue.state !== expectedState) {
    return null;
  }
  const observation = githubAppWebhookIssueObservationSchema.safeParse({
    number: parsed.data.issue.number,
    owner: parsed.data.repository.owner.login,
    repo: parsed.data.repository.name,
    state: parsed.data.issue.state,
    stateReason: parsed.data.issue.state_reason ?? null,
    updatedAt: updatedAt.toISOString(),
    url: parsed.data.issue.html_url,
  });
  return observation.success ? observation.data : null;
}

export function readGitHubAppWebhookPullRequestObservation(input: {
  event: string | null;
  payload: unknown;
}): z.infer<typeof githubAppWebhookPullRequestObservationSchema> | null {
  if (input.event !== "pull_request") {
    return null;
  }
  const payload = z
    .object({
      action: z.string(),
      number: z.number().int().positive(),
      pull_request: z
        .object({
          html_url: z.url(),
          head: z
            .object({
              sha: remoteAgentGitShaSchema,
            })
            .catchall(z.unknown()),
          updated_at: z.string().min(1),
        })
        .catchall(z.unknown()),
      repository: z
        .object({
          name: githubRepoNameSchema,
          owner: z
            .object({
              login: githubLoginSchema,
            })
            .catchall(z.unknown()),
        })
        .catchall(z.unknown()),
    })
    .catchall(z.unknown())
    .safeParse(input.payload);
  if (!payload.success) {
    return null;
  }
  // We care about opened/synchronize/ready_for_review/closed (head updates on synchronize).
  const allowed = new Set([
    "opened",
    "synchronize",
    "ready_for_review",
    "edited",
    "reopened",
    "closed",
  ]);
  if (!allowed.has(payload.data.action)) {
    return null;
  }
  const observedAt = new Date(payload.data.pull_request.updated_at);
  if (Number.isNaN(observedAt.getTime())) {
    return null;
  }
  const prObservation = githubAppWebhookPullRequestObservationSchema.safeParse({
    number: payload.data.number,
    owner: payload.data.repository.owner.login,
    repo: payload.data.repository.name,
    headSha: payload.data.pull_request.head.sha,
    observedAt: observedAt.toISOString(),
    url: payload.data.pull_request.html_url,
  });
  return prObservation.success ? prObservation.data : null;
}
