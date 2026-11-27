import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/inbox-github-issues");
export type InboxGitHubIssuesQuery = z.infer<
  Schemas["inboxGitHubIssuesQuerySchema"]
>;
export type InboxGitHubIssuesResponse = z.infer<
  Schemas["inboxGitHubIssuesResponseSchema"]
>;
export type ListInboxGitHubIssuesRpcInput = z.infer<
  Schemas["listInboxGitHubIssuesRpcInputSchema"]
>;
export type InboxGitHubIssue = Extract<
  InboxGitHubIssuesResponse["result"],
  { status: "ready" }
>["issues"][number];
