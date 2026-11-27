import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

const repository = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/u);
const login = z.string().regex(/^[A-Za-z0-9-]{1,39}$/u);
const state = z.enum(["open", "closed"]);
export const MAX_INBOX_GITHUB_ISSUES = 30;

export const inboxGitHubIssuesQuerySchema = z.strictObject({
  repository: repository.optional(),
  state: z.enum(["open", "closed", "all"]).optional(),
  assignee: login.optional(),
});

export const listInboxGitHubIssuesRpcInputSchema =
  inboxGitHubIssuesQuerySchema.extend({
    context: openMeldRequestContextSchema,
  });

const inboxGitHubIssueSchema = z.strictObject({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string().min(1).max(256),
  repository,
  url: z
    .url()
    .regex(
      /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/u
    ),
  state,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  assignees: z.array(login).max(10),
});

export const inboxGitHubIssuesResponseSchema = z.strictObject({
  organizationId: z.string().min(1),
  result: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("ready"),
      issues: z.array(inboxGitHubIssueSchema).max(MAX_INBOX_GITHUB_ISSUES),
      partial: z.boolean(),
    }),
    z.strictObject({ status: z.enum(["not_connected", "unavailable"]) }),
  ]),
});
