import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/slack-workspace-directory");

export type CenterAgentReadSlackWorkspaceDirectoryBody = z.infer<
  Schemas["centerAgentReadSlackWorkspaceDirectoryBodySchema"]
>;
export type SlackWorkspaceMembership = z.infer<
  Schemas["slackWorkspaceMembershipSchema"]
>;
export type SlackWorkspaceDirectoryMember = z.infer<
  Schemas["slackWorkspaceDirectoryMemberSchema"]
>;
export type SlackWorkspaceDirectoryResponse = z.infer<
  Schemas["slackWorkspaceDirectoryResponseSchema"]
>;
