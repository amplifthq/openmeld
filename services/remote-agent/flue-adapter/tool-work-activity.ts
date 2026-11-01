import {
  connectorActionOutcomeUnknownSchema,
  resolveCommandAgentWorkActivity,
} from "@openmeld/schemas";
import type { AgentWorkActivity } from "@openmeld/schemas/types";
import { resolveConnectedAppDisplayName } from "../agent-core/connector-service-presentation";
import { isRemoteAgentDestructiveConfirmationResult } from "../agent-core/destructive-authorization";

type AgentWorkActivityKey = AgentWorkActivity["key"];
type AgentWorkSubject = NonNullable<AgentWorkActivity["subject"]>;

const SAFE_SUBJECT_LABEL_MAX_CHARS = 120;
const SAFE_URL_INPUT_MAX_CHARS = 8192;
const SAFE_CONNECTED_APP_ACTION_ID_PATTERN = /^[a-z\d][a-z\d._:-]{0,159}$/iu;
const SAFE_REPOSITORY_PART_PATTERN = /^[a-z\d](?:[a-z\d_.-]*[a-z\d])?$/iu;
const CONNECTED_APP_SUBJECT_TOOL_NAMES = new Set([
  "github_execute_action",
  "github_list_actions",
  "openmeld_execute_app_action",
  "openmeld_list_app_actions",
]);

const TOOL_WORK_BY_NAME = new Map<string, AgentWorkActivityKey>([
  ["github_execute_action", "connected_app.action.execute"],
  ["github_list_actions", "connected_app.actions.read"],
  ["browser_extract", "web.data.extract"],
  ["browser_get_links", "web.links.read"],
  ["browser_read_page", "webpage.read"],
  ["browser_scrape", "webpage.scrape"],
  ["browser_screenshot", "webpage.screenshot"],
  ["edit", "source.update"],
  ["glob", "source.search"],
  ["grep", "source.search"],
  ["read", "source.read"],
  ["openmeld_add_agent_profiles_to_space", "space.agents.add"],
  ["openmeld_add_members_to_space", "space.members.add"],
  ["openmeld_check_agent_profile_readiness", "agent_profile.readiness.check"],
  ["openmeld_connect_agent_profile_to_local_agent", "agent_profile.connect"],
  ["openmeld_create_agent_profile", "agent_profile.create"],
  ["openmeld_create_agent_profile_request", "agent_profile.create"],
  ["openmeld_create_organization_invite_link", "organization.invite.create"],
  ["openmeld_create_project", "project.create"],
  ["openmeld_create_routine", "routine.create"],
  ["openmeld_create_space", "space.create"],
  ["openmeld_delete_routine", "routine.delete"],
  ["openmeld_draft_org_document", "organization.document.draft"],
  ["openmeld_checkout_org_document", "organization.documents.read"],
  ["openmeld_enable_agent_profile", "agent_profile.enable"],
  ["openmeld_execute_app_action", "connected_app.action.execute"],
  ["openmeld_get_navigation_action", "navigation.prepare"],
  ["openmeld_get_organization_invite_link", "organization.invite.read"],
  ["openmeld_invite_slack_teammates", "organization.invite.create"],
  ["openmeld_inspect_execution_recovery", "execution.recovery.inspect"],
  ["openmeld_list_app_actions", "connected_app.actions.read"],
  ["openmeld_list_connected_apps", "connected_apps.read"],
  ["openmeld_list_computers", "agent_profile.connections.read"],
  [
    "openmeld_list_local_agent_installations",
    "computer.local_agent.installations.read",
  ],
  [
    "openmeld_list_local_agent_connection_candidates",
    "agent_profile.connections.read",
  ],
  ["openmeld_list_feedback_issues", "feedback.read"],
  ["openmeld_list_agent_tasks", "tasks.read"],
  ["openmeld_list_projects", "projects.read"],
  ["openmeld_list_routines", "routines.read"],
  ["openmeld_list_routine_runs", "routines.read"],
  ["openmeld_read_routine_run_diagnostics", "routines.read"],
  ["openmeld_list_slack_channels", "slack.channels.read"],
  ["openmeld_list_spaces", "spaces.read"],
  ["openmeld_list_active_space_wakes", "spaces.read"],
  ["openmeld_read_space_wake_progress", "spaces.read"],
  ["openmeld_learn_about_me", "organization.member_research.start"],
  ["openmeld_pause_routine", "routine.pause"],
  ["openmeld_post_slack_channel_message", "slack.message.post"],
  ["openmeld_post_space_message", "space.message.post"],
  ["openmeld_prepare_remove_project", "project.remove.prepare"],
  ["openmeld_read_agent_activity", "agent.activity.read"],
  ["openmeld_read_ai_usage", "agent.activity.read"],
  [
    "openmeld_read_agent_profile_creation_defaults",
    "agent_profile.settings.read",
  ],
  ["openmeld_list_agent_activity_sessions", "agent.activity.read"],
  ["openmeld_read_session_history", "agent.activity.read"],
  ["openmeld_list_hosted_models", "agent_profile.settings.read"],
  [
    "openmeld_list_agent_controller_permission_modes",
    "agent_profile.settings.read",
  ],
  ["openmeld_read_changelog", "documentation.read"],
  ["openmeld_list_opportunities", "center_agent.activity.read"],
  [
    "openmeld_list_agent_profile_creation_requests",
    "center_agent.activity.read",
  ],
  [
    "openmeld_get_agent_profile_creation_approval_preferences",
    "center_agent.activity.read",
  ],
  ["openmeld_recommend_opportunity", "center_agent.attention.request"],
  ["openmeld_respond_to_opportunity", "center_agent.attention.request"],
  [
    "openmeld_manage_agent_profile_creation_request",
    "center_agent.attention.request",
  ],
  ["openmeld_search_center_agent_memory", "center_agent.activity.read"],
  ["openmeld_read_center_agent_activity", "center_agent.activity.read"],
  ["openmeld_read_center_agent_turn_diagnostics", "center_agent.activity.read"],
  ["openmeld_request_member_attention", "center_agent.attention.request"],
  [
    "openmeld_select_local_agent_installation",
    "computer.local_agent.installation.select",
  ],
  [
    "openmeld_set_openmeld_tools_updates",
    "computer.openmeld_tools.settings.update",
  ],
  ["openmeld_read_dispatch_history", "dispatch.history.read"],
  ["openmeld_read_member_computers", "organization.member_computers.read"],
  [
    "openmeld_read_member_openmeld_service_status",
    "organization.member_service_status.read",
  ],
  ["openmeld_read_org_documents", "organization.documents.read"],
  ["openmeld_manage_org_documents", "organization.documents.manage"],
  ["openmeld_submit_org_document_working_copy", "organization.document.draft"],
  ["openmeld_update_openmeld_tools", "computer.openmeld_tools.update"],
  ["openmeld_read_organization_skills", "organization.skills.read"],
  ["openmeld_install_organization_skill", "organization.skills.install"],
  ["openmeld_read_organization_directory", "organization.members.read"],
  ["openmeld_list_organization_members", "organization.members.read"],
  ["openmeld_read_slack_channel_history", "slack.channel.history.read"],
  ["openmeld_read_slack_channel_members", "slack.channel.members.read"],
  ["openmeld_read_slack_file", "slack.file.read"],
  ["openmeld_read_channel_file", "message_channel.file.read"],
  ["openmeld_send_channel_file", "message_channel.file.send"],
  ["openmeld_read_slack_workspace_directory", "slack.members.read"],
  ["openmeld_send_slack_file", "slack.file.send"],
  ["openmeld_read_space_context", "space.context.read"],
  ["openmeld_read_space_guide", "space.context.read"],
  ["openmeld_list_team_files", "team.files.read"],
  ["openmeld_read_team_file", "team.files.read"],
  ["openmeld_save_team_file", "team.files.update"],
  ["openmeld_list_space_files", "space.files.read"],
  ["openmeld_read_space_file", "space.files.read"],
  ["openmeld_save_space_file", "space.files.update"],
  ["openmeld_save_computer_file", "space.files.update"],
  ["openmeld_manage_space_files", "space.files.update"],
  ["openmeld_manage_space_tasks", "space.tasks.manage"],
  ["openmeld_remember_for_organization", "organization.memory.update"],
  [
    "openmeld_set_organization_working_language",
    "organization.settings.update",
  ],
  [
    "openmeld_set_agent_profile_creation_approval_preferences",
    "organization.settings.update",
  ],
  ["openmeld_require_identity_for_action", "navigation.prepare"],
  ["openmeld_remove_agent_profiles_from_space", "space.agents.remove"],
  ["openmeld_remove_project", "project.remove"],
  ["openmeld_report_feedback", "feedback.create"],
  ["openmeld_recover_execution_result", "execution.recovery.result.replay"],
  [
    "openmeld_resume_controller_conversation",
    "execution.recovery.conversation.resume",
  ],
  ["openmeld_resume_routine", "routine.resume"],
  ["openmeld_search_slack_messages", "slack.messages.search"],
  ["openmeld_set_agent_profile_default_project", "project.default.set"],
  [
    "openmeld_update_agent_profile_runtime_settings",
    "agent_profile.settings.update",
  ],
  ["openmeld_update_feedback_issue", "feedback.update"],
  ["openmeld_update_project", "project.update"],
  ["openmeld_update_routine", "routine.update"],
  ["openmeld_update_space_settings", "space.settings.update"],
  ["openmeld_wake_agent_profiles_in_space", "space.agents.wake"],
  ["openmeld_wake_agent_profiles_in_spaces", "space.agents.wake"],
  ["openmeld_watch_agent_task", "task.watch"],
  ["web_fetch", "webpage.read"],
  ["web_search", "web.search"],
  ["write", "source.update"],
]);

const GITHUB_TOOL_WORK_BY_NAME = new Map<string, AgentWorkActivityKey>([
  ["github_add_issue_assignees", "github.issue.assignees.update"],
  ["github_add_issue_labels", "github.issue.labels.update"],
  ["github_check_pull_request_merged", "github.pull_requests.read"],
  ["github_compare_commits", "github.commits.compare"],
  ["github_create_issue", "github.issue.create"],
  ["github_create_issue_batch", "github.issue.create"],
  ["github_create_issue_comment", "github.issue.comment"],
  ["github_create_or_update_file", "github.file.update"],
  ["github_create_pull_request", "github.pull_request.create"],
  ["github_create_pull_request_review", "github.pull_request.review"],
  ["github_create_pull_request_review_comment", "github.pull_request.comment"],
  ["github_create_ref", "github.ref.create"],
  ["github_delete_file", "github.file.delete"],
  ["github_get_branch", "github.branches.read"],
  ["github_get_commit", "github.commits.read"],
  ["github_get_commit_statuses", "github.checks.read"],
  ["github_get_current_user", "github.account.read"],
  ["github_get_file_contents", "github.file.read"],
  ["github_get_issue", "github.issues.read"],
  ["github_get_pull_request", "github.pull_requests.read"],
  ["github_get_repository", "github.repository.read"],
  ["github_get_release_by_tag", "github.releases.read"],
  ["github_get_workflow_run", "github.workflows.read"],
  ["github_list_branches", "github.branches.read"],
  ["github_list_check_runs_for_ref", "github.checks.read"],
  ["github_list_commits", "github.commits.read"],
  ["github_list_directory_contents", "github.directory.read"],
  ["github_list_issue_comments", "github.issues.read"],
  ["github_list_my_repositories", "github.repositories.read"],
  ["github_list_pull_request_commits", "github.pull_requests.read"],
  ["github_list_pull_request_files", "github.pull_requests.read"],
  ["github_list_pull_request_requested_reviewers", "github.pull_requests.read"],
  ["github_list_pull_request_review_comments", "github.pull_requests.read"],
  ["github_list_pull_request_reviews", "github.pull_requests.read"],
  ["github_list_pull_requests", "github.pull_requests.read"],
  ["github_list_repository_issues", "github.issues.read"],
  ["github_list_repository_labels", "github.issues.read"],
  ["github_list_repository_workflows", "github.workflows.read"],
  ["github_list_workflow_run_jobs", "github.workflows.read"],
  ["github_list_workflow_runs", "github.workflows.read"],
  ["github_merge_pull_request", "github.pull_request.merge"],
  ["github_remove_issue_assignees", "github.issue.assignees.update"],
  ["github_remove_issue_label", "github.issue.labels.update"],
  [
    "github_remove_pull_request_reviewers",
    "github.pull_request.reviewers.update",
  ],
  ["github_reply_pull_request_review_comment", "github.pull_request.comment"],
  [
    "github_request_pull_request_reviewers",
    "github.pull_request.reviewers.update",
  ],
  ["github_dispatch_workflow", "github.workflow.dispatch"],
  ["github_rerun_workflow", "github.workflow.rerun"],
  ["github_search_code", "github.code.search"],
  ["github_search_commits", "github.commits.search"],
  ["github_search_issues_and_pull_requests", "github.issues.search"],
  ["github_update_issue", "github.issue.update"],
  ["github_update_pull_request", "github.pull_request.update"],
  ["github_update_pull_request_branch", "github.pull_request.branch.update"],
]);

const SUBJECT_RULE_BY_TOOL_NAME = new Map<
  string,
  { fields: readonly string[]; kind: AgentWorkSubject["kind"] }
>([
  [
    "openmeld_create_agent_profile",
    { fields: ["profileName"], kind: "agent_profile" },
  ],
  [
    "openmeld_create_agent_profile_request",
    { fields: ["profileName"], kind: "agent_profile" },
  ],
  ["openmeld_create_project", { fields: ["name"], kind: "project" }],
  ["openmeld_update_project", { fields: ["name"], kind: "project" }],
  ["openmeld_create_routine", { fields: ["name"], kind: "routine" }],
  ["openmeld_update_routine", { fields: ["name"], kind: "routine" }],
  ["openmeld_create_space", { fields: ["name"], kind: "space" }],
  ["openmeld_draft_org_document", { fields: ["title"], kind: "document" }],
]);

const WEBSITE_SUBJECT_TOOL_NAMES = new Set([
  "browser_extract",
  "browser_get_links",
  "browser_read_page",
  "browser_scrape",
  "browser_screenshot",
  "web_fetch",
]);

function resolveComputerWorkActivity(
  toolInput: unknown,
  toolResult: unknown
): AgentWorkActivity | null {
  const request = toRecord(toolInput);
  if (request?.action === "files") {
    const names: Record<string, string> = {
      ls: "read",
      find: "glob",
      delete: "edit",
    };
    const name = typeof request.tool === "string" ? request.tool : "";
    return resolveRemoteAgentToolWorkActivity(
      names[name] ?? name,
      request.input,
      toolResult
    );
  }
  if (request?.action === "command") {
    return resolveRemoteAgentToolWorkActivity(
      "computer_command",
      request.input,
      toolResult
    );
  }
  return null;
}

export function resolveRemoteAgentToolWorkActivity(
  toolName: unknown,
  toolInput: unknown,
  toolResult?: unknown
): AgentWorkActivity | null {
  if (typeof toolName !== "string") {
    return null;
  }
  if (toolName === "computer") {
    return resolveComputerWorkActivity(toolInput, toolResult);
  }
  if (toolName === "computer_command") {
    const request = toRecord(toolInput);
    return request?.action === "start" &&
      request.backend !== "worker-javascript"
      ? resolveCommandAgentWorkActivity(readCommand(request))
      : null;
  }
  const key =
    toolName === "openmeld_install_organization_skill" &&
    toRecord(toolInput)?.action === "begin_import_batch"
      ? "organization.skills.read"
      : (TOOL_WORK_BY_NAME.get(toolName) ??
        GITHUB_TOOL_WORK_BY_NAME.get(toolName));
  if (key) {
    const subject = resolveSafeToolSubject(toolName, toolInput);
    if (CONNECTED_APP_SUBJECT_TOOL_NAMES.has(toolName) && !subject) {
      return null;
    }
    return {
      key,
      v: 1,
      ...(subject ? { subject } : {}),
      ...resolveRemoteAgentToolWorkOutcome(toolResult),
    };
  }
  if (toolName !== "bash") {
    return null;
  }
  return resolveCommandAgentWorkActivity(readCommand(toolInput));
}

export function resolveRemoteAgentToolWorkOutcome(
  toolResult: unknown
): Pick<AgentWorkActivity, "outcome"> {
  if (isRemoteAgentDestructiveConfirmationResult(toolResult)) {
    return { outcome: "confirmation_required" };
  }
  return connectorActionOutcomeUnknownSchema.safeParse(toolResult).success
    ? { outcome: "outcome_unknown" }
    : {};
}

function resolveSafeToolSubject(
  toolName: string,
  toolInput: unknown
): AgentWorkSubject | null {
  const record = toRecord(toolInput);
  if (!record) {
    return null;
  }
  if (GITHUB_TOOL_WORK_BY_NAME.has(toolName)) {
    return readGitHubRepositorySubject(record);
  }
  if (WEBSITE_SUBJECT_TOOL_NAMES.has(toolName)) {
    return readWebsiteSubject(record);
  }
  if (CONNECTED_APP_SUBJECT_TOOL_NAMES.has(toolName)) {
    return readConnectedAppSubject(toolName, record);
  }
  const rule = SUBJECT_RULE_BY_TOOL_NAME.get(toolName);
  if (!rule) {
    return null;
  }
  const label = readSafeLabel(record, rule.fields);
  return label ? { kind: rule.kind, label } : null;
}

function readConnectedAppSubject(
  toolName: string,
  record: Record<string, unknown>
): AgentWorkSubject | null {
  const isGitHub =
    toolName === "github_list_actions" || toolName === "github_execute_action";
  const requestedService =
    typeof record.service === "string" ? record.service.trim() : "";
  const service = isGitHub ? "github" : requestedService;
  const appName = isGitHub ? "GitHub" : resolveConnectedAppDisplayName(service);
  if (!appName) {
    return null;
  }
  if (
    toolName === "openmeld_list_app_actions" ||
    toolName === "github_list_actions"
  ) {
    return { kind: "connected_app", label: appName };
  }
  const actionId =
    typeof record.actionId === "string" ? record.actionId.trim() : "";
  if (!SAFE_CONNECTED_APP_ACTION_ID_PATTERN.test(actionId)) {
    return null;
  }
  const servicePrefix = `${service.toLowerCase()}.`;
  if (!actionId.toLowerCase().startsWith(servicePrefix)) {
    return null;
  }
  const actionName = actionId
    .slice(servicePrefix.length)
    .replace(/[._:-]+/gu, " ")
    .trim();
  const label = `${appName}: ${actionName}`;
  return actionName.length > 0 && label.length <= SAFE_SUBJECT_LABEL_MAX_CHARS
    ? { kind: "connected_app", label }
    : null;
}

function readGitHubRepositorySubject(
  record: Record<string, unknown>
): AgentWorkSubject | null {
  const owner = readSafeRepositoryPart(record.owner);
  const repository = readSafeRepositoryPart(record.repo);
  if (!(owner && repository)) {
    return null;
  }
  return {
    kind: "repository",
    label: `${owner}/${repository}`,
  };
}

function readWebsiteSubject(
  record: Record<string, unknown>
): AgentWorkSubject | null {
  const urlText = readSafeUrlInput(record.url);
  if (!urlText) {
    return null;
  }
  try {
    const url = new URL(urlText);
    if (!(url.protocol === "http:" || url.protocol === "https:")) {
      return null;
    }
    const hostname = url.hostname.trim();
    if (
      hostname.length === 0 ||
      hostname.length > SAFE_SUBJECT_LABEL_MAX_CHARS ||
      hasControlCharacter(hostname)
    ) {
      return null;
    }
    return {
      kind: "website",
      label: hostname,
    };
  } catch {
    return null;
  }
}

function readSafeUrlInput(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const urlText = value.trim();
  return urlText.length > 0 &&
    urlText.length <= SAFE_URL_INPUT_MAX_CHARS &&
    !hasControlCharacter(urlText)
    ? urlText
    : null;
}

function readCommand(value: unknown): string | null {
  const command = toRecord(value)?.command;
  return typeof command === "string" && command.trim().length > 0
    ? command
    : null;
}

function readSafeLabel(
  record: Record<string, unknown>,
  fields: readonly string[]
): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "string") {
      continue;
    }
    const label = value.trim();
    if (
      label.length > 0 &&
      label.length <= SAFE_SUBJECT_LABEL_MAX_CHARS &&
      !hasControlCharacter(label)
    ) {
      return label;
    }
  }
  return null;
}

function readSafeRepositoryPart(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const part = value.trim();
  return SAFE_REPOSITORY_PART_PATTERN.test(part) && part.length <= 60
    ? part
    : null;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
      return true;
    }
  }
  return false;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
