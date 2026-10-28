import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { messageChannelParticipantIdentitySchema } from "../runtime/message-channel";

export const CENTER_AGENT_ANONYMOUS_MEMBER_TOOL_NAMES = [
  "web_search",
  "web_fetch",
  "browser_read_page",
  "browser_get_links",
  "browser_extract",
  "browser_scrape",
  "browser_screenshot",
  "openmeld_require_identity_for_action",
  "openmeld_get_navigation_action",
  "openmeld_read_organization_directory",
  "openmeld_list_organization_members",
  "openmeld_read_member_computers",
  "openmeld_read_member_openmeld_service_status",
  "openmeld_read_org_documents",
  "openmeld_read_channel_file",
  "openmeld_read_organization_skills",
  "openmeld_list_spaces",
  "openmeld_list_projects",
  "openmeld_read_agent_activity",
  "openmeld_list_agent_activity_sessions",
  "openmeld_read_changelog",
  "openmeld_read_center_agent_turn_diagnostics",
  "openmeld_list_connected_apps",
  "openmeld_list_app_actions",
  "openmeld_get_app_action_status",
  "openmeld_execute_app_action",
  "github_execute_action",
  "github_list_actions",
  "github_get_current_user",
  "github_list_my_repositories",
  "github_get_repository",
  "github_list_directory_contents",
  "github_get_file_contents",
  "github_search_code",
  "github_list_branches",
  "github_get_branch",
  "github_list_commits",
  "github_get_commit",
  "github_compare_commits",
  "github_search_commits",
  "github_list_repository_issues",
  "github_get_issue",
  "github_list_issue_comments",
  "github_list_repository_labels",
  "github_search_issues_and_pull_requests",
  "github_list_pull_requests",
  "github_get_pull_request",
  "github_list_pull_request_files",
  "github_list_pull_request_commits",
  "github_list_pull_request_reviews",
  "github_list_pull_request_review_comments",
  "github_list_pull_request_requested_reviewers",
  "github_check_pull_request_merged",
  "github_get_commit_statuses",
  "github_list_check_runs_for_ref",
  "github_list_repository_workflows",
  "github_list_workflow_runs",
  "github_get_workflow_run",
  "github_list_workflow_run_jobs",
  "github_get_release_by_tag",
  "github_create_issue_batch",
  "github_create_issue",
  "github_create_issue_comment",
  "github_add_issue_labels",
  "github_remove_issue_label",
  "github_add_issue_assignees",
  "github_remove_issue_assignees",
  "github_create_ref",
  "github_create_or_update_file",
  "github_create_pull_request",
  "github_create_pull_request_review",
  "github_create_pull_request_review_comment",
  "github_reply_pull_request_review_comment",
  "github_request_pull_request_reviewers",
  "github_remove_pull_request_reviewers",
  "github_update_issue",
  "github_update_pull_request",
  "github_update_pull_request_branch",
  "github_dispatch_workflow",
  "github_rerun_workflow",
] as const;

export const CENTER_AGENT_OPENMELD_IDENTITY_REQUIRED_CODE =
  "center_agent.openmeld_identity_required";

const trimmedIdentifierSchema = z.string().trim().min(1);

export const centerAgentVerifiedMemberToolSpeakerSchema = z.strictObject({
  memberId: trimmedIdentifierSchema,
  userId: trimmedIdentifierSchema,
});

export const centerAgentAnonymousMemberToolSpeakerSchema = z.strictObject({
  displayName: trimmedIdentifierSchema,
  kind: z.literal("anonymous_member"),
  messageChannelIdentity: messageChannelParticipantIdentitySchema,
});

export const centerAgentToolSpeakerSchema = z.union([
  centerAgentVerifiedMemberToolSpeakerSchema,
  centerAgentAnonymousMemberToolSpeakerSchema,
]);

export const centerAgentAnonymousMemberToolNameSchema = z.enum(
  CENTER_AGENT_ANONYMOUS_MEMBER_TOOL_NAMES
);

export const centerAgentAuthorizeAnonymousMemberToolRpcInputSchema =
  z.strictObject({
    connectToUserId: trimmedIdentifierSchema.optional(),
    messageChannelIdentityLinkCapabilityVersion: z
      .union([z.literal(1), z.literal(2)])
      .optional(),
    context: openMeldRequestContextSchema,
    speakerMember: centerAgentAnonymousMemberToolSpeakerSchema,
    toolName: centerAgentAnonymousMemberToolNameSchema,
  });

export const centerAgentAuthorizeAnonymousMemberToolResponseSchema =
  z.strictObject({
    authorized: z.literal(true),
    messageChannelAccountTargetSupported: z.literal(true).optional(),
    messageChannelIdentityLinkSupported: z.literal(true).optional(),
    slackIdentityLinkSupported: z.literal(true).optional(),
    sourceNativeDeliveryId: trimmedIdentifierSchema,
  });
