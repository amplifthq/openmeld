import { describe, expect, it } from "vitest";
import {
  CENTER_AGENT_ANONYMOUS_MEMBER_TOOL_NAMES,
  centerAgentAuthorizeAnonymousMemberToolResponseSchema,
  centerAgentAuthorizeAnonymousMemberToolRpcInputSchema,
  centerAgentToolSpeakerSchema,
} from "../../src";

const VALID_CENTER_AGENT_RPC_CONTEXT = {
  activeOrganizationId: "org-1",
  actorContext: {
    agentControllerRef: "hosted:center-agent",
    callerPrincipalId: "user-1",
    ownerUserId: "user-1",
    profileKind: "agent" as const,
    requestId: "request-anonymous-member-contract",
    openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
  },
};

const VALID_ANONYMOUS_MEMBER_SPEAKER = {
  displayName: "Ashley",
  kind: "anonymous_member" as const,
  messageChannelIdentity: {
    connectionId: "T123",
    provider: "slack" as const,
    providerUserId: "U123",
  },
};

describe("Center Agent speaker contracts", () => {
  it("keeps anonymous member identity and allowed tools on one shared contract", () => {
    expect(
      centerAgentToolSpeakerSchema.parse(VALID_ANONYMOUS_MEMBER_SPEAKER)
    ).toEqual(VALID_ANONYMOUS_MEMBER_SPEAKER);
    expect(CENTER_AGENT_ANONYMOUS_MEMBER_TOOL_NAMES).toEqual([
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
    ]);
    expect(
      centerAgentAuthorizeAnonymousMemberToolRpcInputSchema.parse({
        context: VALID_CENTER_AGENT_RPC_CONTEXT,
        speakerMember: VALID_ANONYMOUS_MEMBER_SPEAKER,
        toolName: "web_search",
      })
    ).toMatchObject({
      speakerMember: VALID_ANONYMOUS_MEMBER_SPEAKER,
      toolName: "web_search",
    });
    expect(
      centerAgentAuthorizeAnonymousMemberToolRpcInputSchema.safeParse({
        context: VALID_CENTER_AGENT_RPC_CONTEXT,
        speakerMember: VALID_ANONYMOUS_MEMBER_SPEAKER,
        toolName: "openmeld_create_space",
      }).success
    ).toBe(false);
    expect(
      centerAgentAuthorizeAnonymousMemberToolRpcInputSchema.safeParse({
        context: VALID_CENTER_AGENT_RPC_CONTEXT,
        speakerMember: VALID_ANONYMOUS_MEMBER_SPEAKER,
        toolName: "github_delete_file",
      }).success
    ).toBe(false);
    expect(
      centerAgentAuthorizeAnonymousMemberToolRpcInputSchema.safeParse({
        context: VALID_CENTER_AGENT_RPC_CONTEXT,
        speakerMember: VALID_ANONYMOUS_MEMBER_SPEAKER,
        toolName: "github_merge_pull_request",
      }).success
    ).toBe(false);
    expect(
      centerAgentAuthorizeAnonymousMemberToolResponseSchema.parse({
        authorized: true,
        sourceNativeDeliveryId: "delivery-1",
      })
    ).toEqual({
      authorized: true,
      sourceNativeDeliveryId: "delivery-1",
    });
    expect(
      centerAgentAuthorizeAnonymousMemberToolResponseSchema.parse({
        authorized: true,
        slackIdentityLinkSupported: true,
        sourceNativeDeliveryId: "delivery-1",
      })
    ).toEqual({
      authorized: true,
      slackIdentityLinkSupported: true,
      sourceNativeDeliveryId: "delivery-1",
    });
  });
});
