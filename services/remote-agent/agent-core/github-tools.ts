import { centerAgentConnectorConnectionSelectionSchema } from "@openmeld/schemas";
import type {
  CenterAgentConnectorActionExecutionConnection,
  RemoteAgentTurnEnvelope,
} from "@openmeld/schemas/types";
import {
  array,
  boolean,
  check,
  description,
  integer,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  object,
  optional,
  picklist,
  pipe,
  string,
  trim,
} from "valibot";
import type {
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "./callback-context";
import {
  readRemoteAgentCallbackContext,
  recordRemoteAgentNavigationTarget,
} from "./callback-context";
import { digestCanonicalJson } from "./canonical-json";
import {
  readConnectorActionOperation,
  recordConnectorActionOperation,
  runAndFinalizeConnectorAction,
} from "./connector-tools";
import { callCoreRpc, requireCoreRpc } from "./core-rpc";
import {
  isRemoteAgentDestructiveConfirmationResult,
  resolveRemoteAgentDestructiveAuthorization,
  resolveRemoteAgentRoutineExternalWriteBlock,
} from "./destructive-authorization";
import {
  assertRemoteAgentExecutionCanContinue,
  buildRemoteAgentExecutionIdentity,
} from "./execution-state";
import {
  buildRemoteAgentToolContext,
  resolveOrganizationMemberTurnEnvelopeSpeaker,
  resolveVerifiedTurnEnvelopeSpeaker,
} from "./tool-context";
import type {
  RemoteAgentToolDefinition,
  RemoteAgentToolInputSchema,
} from "./tool-definition";
import {
  isRemoteAgentToolResultWithinLimit,
  RemoteAgentToolResultTooLargeError,
} from "./tool-result-boundary";

const TRAILING_SLASH_PATTERN = /\/+$/u;
const GITHUB_HEADS_REF_PREFIX_PATTERN = /^refs\/heads\//u;
const GITHUB_COMMIT_MESSAGE_LINE_BREAK_PATTERN = /\r?\n/u;
const GITHUB_DESTRUCTIVE_WRITE_ACTION_IDS = new Set<GitHubActionId>([
  "github.delete_file",
  "github.merge_pull_request",
]);
const GITHUB_ISSUE_BATCH_PREFIX = "remote-agent:github-issue-batch:";
const GITHUB_FILE_SEGMENT_DEFAULT_UTF16_CODE_UNITS = 24_000;
const GITHUB_FILE_SEGMENT_MAX_UTF16_CODE_UNITS = 50_000;
const GITHUB_SEARCH_DEFAULT_PER_PAGE = 10;
const GITHUB_SEARCH_TEXT_FIELD_MAX_LENGTH = 500;
const GITHUB_SEARCH_TEXT_TRUNCATION_SUFFIX = "...";
const GITHUB_ACTORS = ["organization", "requester"] as const;
const GITHUB_ACTOR_GUIDANCE =
  "Choose githubActor for this task: organization uses the OpenMeld GitHub App through Organization access; requester uses the verified requesting member's connected GitHub. Use requester only when the task explicitly needs that person's GitHub identity or personal repositories. Routines and other unattended work must use organization. OpenMeld never falls back to the other identity.";
const GITHUB_WRITE_OPERATION_GUIDANCE =
  "Choose a unique operationId for this write, and reuse the same operationId only when retrying this exact write with the same githubActor and input.";

export const REMOTE_AGENT_GITHUB_READ_TOOL_NAMES = [
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
] as const;

const REMOTE_AGENT_GITHUB_WRITE_TOOL_NAMES = [
  "github_create_issue_batch",
  "github_create_issue",
  "github_create_issue_comment",
  "github_add_issue_labels",
  "github_remove_issue_label",
  "github_add_issue_assignees",
  "github_remove_issue_assignees",
  "github_create_ref",
  "github_create_or_update_file",
  "github_delete_file",
  "github_create_pull_request",
  "github_create_pull_request_review",
  "github_create_pull_request_review_comment",
  "github_reply_pull_request_review_comment",
  "github_request_pull_request_reviewers",
  "github_remove_pull_request_reviewers",
  "github_update_issue",
  "github_update_pull_request",
  "github_update_pull_request_branch",
  "github_rerun_workflow",
  "github_merge_pull_request",
] as const;

export const REMOTE_AGENT_GITHUB_TOOL_NAMES = [
  ...REMOTE_AGENT_GITHUB_READ_TOOL_NAMES,
  ...REMOTE_AGENT_GITHUB_WRITE_TOOL_NAMES,
] as const;

export type RemoteAgentGitHubToolName =
  (typeof REMOTE_AGENT_GITHUB_TOOL_NAMES)[number];

export type RemoteAgentGitHubToolDefinition =
  RemoteAgentToolDefinition<RemoteAgentGitHubToolName>;
type GitHubActor = (typeof GITHUB_ACTORS)[number];

export type RemoteAgentConnectorExecutionConfig = {
  baseUrl?: string;
  fetch?: typeof fetch;
  runtimeToken?: string;
};

const nonEmptyStringSchema = pipe(string(), minLength(1));
const positiveIntegerSchema = pipe(number(), integer(), minValue(1));
const githubActorSchema = pipe(
  picklist(GITHUB_ACTORS),
  description(
    "Select organization for the OpenMeld GitHub App, or requester for the verified requesting member's connected GitHub."
  )
);
const githubWriteOperationIdSchema = pipe(
  string(),
  trim(),
  minLength(1),
  maxLength(256)
);
const nonNegativeIntegerSchema = pipe(number(), integer(), minValue(0));
const optionalPaginationFields = {
  page: optional(positiveIntegerSchema),
  perPage: optional(positiveIntegerSchema),
};
const repositoryFields = {
  owner: nonEmptyStringSchema,
  repo: nonEmptyStringSchema,
};
const issueFields = {
  ...repositoryFields,
  issueNumber: positiveIntegerSchema,
};
const pullRequestFields = {
  ...repositoryFields,
  pullNumber: positiveIntegerSchema,
};
const workflowRunFields = {
  ...repositoryFields,
  runId: positiveIntegerSchema,
};
const writeConfirmationField = {
  writeConfirmationToken: optional(nonEmptyStringSchema),
};
const nonEmptyStringArraySchema = pipe(
  array(nonEmptyStringSchema),
  minLength(1)
);
const githubIssueSearchInputSchema = pipe(
  object({
    assignee: optional(nonEmptyStringSchema),
    author: optional(nonEmptyStringSchema),
    baseBranch: optional(nonEmptyStringSchema),
    headBranch: optional(nonEmptyStringSchema),
    isMerged: optional(boolean()),
    label: optional(nonEmptyStringSchema),
    language: optional(nonEmptyStringSchema),
    mentions: optional(nonEmptyStringSchema),
    order: optional(picklist(["asc", "desc"])),
    owner: optional(nonEmptyStringSchema),
    ...optionalPaginationFields,
    q: optional(nonEmptyStringSchema),
    query: optional(nonEmptyStringSchema),
    repo: optional(nonEmptyStringSchema),
    sort: optional(
      picklist([
        "comments",
        "reactions",
        "reactions-+1",
        "reactions--1",
        "reactions-smile",
        "reactions-thinking_face",
        "reactions-heart",
        "reactions-tada",
        "interactions",
        "created",
        "updated",
      ])
    ),
    state: optional(picklist(["open", "closed", "all"])),
    type: optional(picklist(["issue", "pr"])),
  }),
  check(
    hasGitHubIssueSearchCriteria,
    "Provide a GitHub search query or at least one issue or pull request filter."
  )
);
const pullRequestReviewerMutationInputSchema = pipe(
  object({
    ...pullRequestFields,
    reviewers: optional(array(nonEmptyStringSchema)),
    teamReviewers: optional(array(nonEmptyStringSchema)),
  }),
  check(
    (input) =>
      (input.reviewers?.length ?? 0) > 0 ||
      (input.teamReviewers?.length ?? 0) > 0,
    "Provide at least one GitHub user or team reviewer."
  )
);

type GitHubActionId =
  | "openmeld.github.create_issue_batch"
  | "github.add_issue_assignees"
  | "github.add_issue_labels"
  | "github.check_pull_request_merged"
  | "github.compare_commits"
  | "github.create_issue"
  | "github.create_issue_comment"
  | "github.create_or_update_file"
  | "github.create_pull_request"
  | "github.create_pull_request_review"
  | "github.create_pull_request_review_comment"
  | "github.create_ref"
  | "github.delete_file"
  | "github.get_branch"
  | "github.get_commit"
  | "github.get_commit_statuses"
  | "github.get_current_user"
  | "github.get_file_contents"
  | "github.get_issue"
  | "github.get_pull_request"
  | "github.get_repository"
  | "github.get_workflow_run"
  | "github.list_branches"
  | "github.list_check_runs_for_ref"
  | "github.list_commits"
  | "github.list_directory_contents"
  | "github.list_issue_comments"
  | "github.list_my_repositories"
  | "github.list_pull_request_commits"
  | "github.list_pull_request_files"
  | "github.list_pull_request_review_comments"
  | "github.list_pull_request_reviews"
  | "github.list_pull_request_requested_reviewers"
  | "github.list_pull_requests"
  | "github.list_repository_issues"
  | "github.list_repository_labels"
  | "github.list_repository_workflows"
  | "github.list_workflow_run_jobs"
  | "github.list_workflow_runs"
  | "github.merge_pull_request"
  | "github.remove_issue_assignees"
  | "github.remove_issue_label"
  | "github.remove_pull_request_reviewers"
  | "github.reply_pull_request_review_comment"
  | "github.request_pull_request_reviewers"
  | "github.rerun_workflow"
  | "github.search_code"
  | "github.search_commits"
  | "github.search_issues_and_pull_requests"
  | "github.update_issue"
  | "github.update_pull_request"
  | "github.update_pull_request_branch";

type GitHubWriteDisclosure = (payload: Record<string, unknown>) => string;

type GitHubIssueBatchItem = {
  body?: string;
  externalKey: string;
  labels?: string[];
  marker: string;
  result?: unknown;
  status: "pending" | "outcome_unknown" | "completed";
  title: string;
};

type GitHubIssueBatchManifest = {
  connectionName: string;
  connectionOwnerUserId: string;
  createdBySubmissionId: string;
  digest: string;
  items: GitHubIssueBatchItem[];
  operationId: string;
  organizationId: string;
  owner: string;
  repo: string;
  v: 1;
};

export function getRemoteAgentGitHubToolDefinitions(input: {
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  submissionId: string;
}): RemoteAgentGitHubToolDefinition[] {
  return [
    githubToolDefinition({
      actionId: "github.get_current_user",
      description:
        "Get the current user profile for the selected Organization member's GitHub connection.",
      input: object({}),
      inputConfig: input,
      name: "github_get_current_user",
    }),
    githubToolDefinition({
      actionId: "github.list_my_repositories",
      description:
        "List repositories visible to the selected Organization member's GitHub connection.",
      input: object({
        direction: optional(picklist(["asc", "desc"])),
        ...optionalPaginationFields,
        sort: optional(picklist(["created", "updated", "pushed", "full_name"])),
        visibility: optional(picklist(["all", "public", "private"])),
      }),
      inputConfig: input,
      name: "github_list_my_repositories",
    }),
    githubToolDefinition({
      actionId: "github.get_repository",
      description:
        "Get repository metadata, including its default branch, visibility, language, and URLs.",
      input: object(repositoryFields),
      inputConfig: input,
      name: "github_get_repository",
    }),
    githubToolDefinition({
      actionId: "github.list_directory_contents",
      description:
        "List files and directories at one path in a repository. Use an empty path for the repository root and ref for a branch, tag, or commit.",
      input: object({
        ...repositoryFields,
        path: optional(string()),
        ref: optional(string()),
      }),
      inputConfig: input,
      name: "github_list_directory_contents",
    }),
    githubToolDefinition({
      actionId: "github.get_file_contents",
      description:
        "Read one bounded segment of a text or source file from a repository by path, optionally at a branch, tag, or commit ref. Search first and read only the relevant segments instead of loading a large file end to end. Start with offsetUtf16 0 or omit it. To continue, pass both contentSegment.nextOffsetUtf16 and contentSegment.fileSha so the tool can reject a file that changed between segments. Segment sizes and offsets are UTF-16 code units, where one emoji can occupy two units. Each result is limited to 24,000 UTF-16 code units by default and never more than 50,000.",
      input: object({
        expectedFileSha: optional(nonEmptyStringSchema),
        maxUtf16CodeUnits: optional(
          pipe(
            positiveIntegerSchema,
            maxValue(GITHUB_FILE_SEGMENT_MAX_UTF16_CODE_UNITS)
          )
        ),
        offsetUtf16: optional(nonNegativeIntegerSchema),
        ...repositoryFields,
        path: nonEmptyStringSchema,
        ref: optional(string()),
      }),
      inputConfig: input,
      name: "github_get_file_contents",
    }),
    githubToolDefinition({
      actionId: "github.search_code",
      description:
        "Search GitHub code with GitHub search syntax. Include repo:owner/name in the query to keep a search inside one repository.",
      input: object({
        order: optional(picklist(["asc", "desc"])),
        ...optionalPaginationFields,
        query: nonEmptyStringSchema,
        sort: optional(picklist(["indexed", "updated"])),
      }),
      inputConfig: input,
      name: "github_search_code",
    }),
    githubToolDefinition({
      actionId: "github.list_branches",
      description: "List branches in a GitHub repository.",
      input: object({
        ...repositoryFields,
        ...optionalPaginationFields,
        protectedOnly: optional(boolean()),
      }),
      inputConfig: input,
      name: "github_list_branches",
    }),
    githubToolDefinition({
      actionId: "github.get_branch",
      description:
        "Get one branch, including its current commit and protection metadata.",
      input: object({
        branch: nonEmptyStringSchema,
        ...repositoryFields,
      }),
      inputConfig: input,
      name: "github_get_branch",
    }),
    githubToolDefinition({
      actionId: "github.list_commits",
      description:
        "List repository commits, optionally filtered by branch or SHA, path, author, committer, or date range.",
      input: object({
        author: optional(string()),
        committer: optional(string()),
        path: optional(string()),
        ...repositoryFields,
        ...optionalPaginationFields,
        sha: optional(string()),
        since: optional(string()),
        until: optional(string()),
      }),
      inputConfig: input,
      name: "github_list_commits",
    }),
    githubToolDefinition({
      actionId: "github.get_commit",
      description:
        "Get one commit by SHA, branch, or tag, including its changed files when GitHub returns them.",
      input: object({
        ref: nonEmptyStringSchema,
        ...repositoryFields,
      }),
      inputConfig: input,
      name: "github_get_commit",
    }),
    githubToolDefinition({
      actionId: "github.compare_commits",
      description:
        "Compare two commit references and return the commits and files between them. Use GitHub's BASE...HEAD syntax for basehead.",
      input: object({
        basehead: nonEmptyStringSchema,
        ...repositoryFields,
        ...optionalPaginationFields,
      }),
      inputConfig: input,
      name: "github_compare_commits",
    }),
    githubToolDefinition({
      actionId: "github.search_commits",
      description:
        "Search commits with GitHub search syntax across all accessible repositories or within a repository named in the query.",
      input: object({
        order: optional(picklist(["asc", "desc"])),
        ...optionalPaginationFields,
        query: nonEmptyStringSchema,
        sort: optional(picklist(["author-date", "committer-date"])),
      }),
      inputConfig: input,
      name: "github_search_commits",
    }),
    githubToolDefinition({
      actionId: "github.list_repository_issues",
      description:
        "List issues in a GitHub repository; pull requests are excluded by OpenConnector.",
      input: object({
        direction: optional(picklist(["asc", "desc"])),
        labels: optional(array(string())),
        ...repositoryFields,
        ...optionalPaginationFields,
        since: optional(string()),
        sort: optional(picklist(["created", "updated", "comments"])),
        state: optional(picklist(["open", "closed", "all"])),
      }),
      inputConfig: input,
      name: "github_list_repository_issues",
    }),
    githubToolDefinition({
      actionId: "github.get_issue",
      description: "Get one GitHub issue by number.",
      input: object(issueFields),
      inputConfig: input,
      name: "github_get_issue",
    }),
    githubToolDefinition({
      actionId: "github.list_issue_comments",
      description: "List comments on one GitHub issue.",
      input: object({
        ...issueFields,
        ...optionalPaginationFields,
      }),
      inputConfig: input,
      name: "github_list_issue_comments",
    }),
    githubToolDefinition({
      actionId: "github.list_repository_labels",
      description: "List labels configured for a GitHub repository.",
      input: object({
        ...repositoryFields,
        ...optionalPaginationFields,
      }),
      inputConfig: input,
      name: "github_list_repository_labels",
    }),
    githubToolDefinition({
      actionId: "github.search_issues_and_pull_requests",
      description:
        "Search GitHub issues and pull requests with a raw query or structured repository, state, author, assignee, branch, merge, and type filters.",
      input: githubIssueSearchInputSchema,
      inputConfig: input,
      name: "github_search_issues_and_pull_requests",
    }),
    githubToolDefinition({
      actionId: "github.list_pull_requests",
      description: "List pull requests in a GitHub repository.",
      input: object({
        base: optional(string()),
        direction: optional(picklist(["asc", "desc"])),
        head: optional(string()),
        ...repositoryFields,
        ...optionalPaginationFields,
        sort: optional(
          picklist(["created", "updated", "popularity", "long-running"])
        ),
        state: optional(picklist(["open", "closed", "all"])),
      }),
      inputConfig: input,
      name: "github_list_pull_requests",
    }),
    githubToolDefinition({
      actionId: "github.get_pull_request",
      description: "Get one GitHub pull request by number.",
      input: object({
        ...repositoryFields,
        pullNumber: positiveIntegerSchema,
      }),
      inputConfig: input,
      name: "github_get_pull_request",
    }),
    githubToolDefinition({
      actionId: "github.list_pull_request_files",
      description:
        "List files changed in one pull request, including patches when GitHub returns them.",
      input: object({
        ...pullRequestFields,
        ...optionalPaginationFields,
      }),
      inputConfig: input,
      name: "github_list_pull_request_files",
    }),
    githubToolDefinition({
      actionId: "github.list_pull_request_commits",
      description: "List commits in one pull request.",
      input: object({
        ...pullRequestFields,
        ...optionalPaginationFields,
      }),
      inputConfig: input,
      name: "github_list_pull_request_commits",
    }),
    githubToolDefinition({
      actionId: "github.list_pull_request_reviews",
      description: "List submitted and pending reviews on one pull request.",
      input: object({
        ...pullRequestFields,
        ...optionalPaginationFields,
      }),
      inputConfig: input,
      name: "github_list_pull_request_reviews",
    }),
    githubToolDefinition({
      actionId: "github.list_pull_request_review_comments",
      description: "List inline review comments on one pull request.",
      input: object({
        direction: optional(picklist(["asc", "desc"])),
        ...pullRequestFields,
        ...optionalPaginationFields,
        since: optional(string()),
        sort: optional(picklist(["created", "updated"])),
      }),
      inputConfig: input,
      name: "github_list_pull_request_review_comments",
    }),
    githubToolDefinition({
      actionId: "github.list_pull_request_requested_reviewers",
      description:
        "List users and teams currently requested to review one pull request.",
      input: object(pullRequestFields),
      inputConfig: input,
      name: "github_list_pull_request_requested_reviewers",
    }),
    githubToolDefinition({
      actionId: "github.check_pull_request_merged",
      description: "Check whether one pull request has been merged.",
      input: object(pullRequestFields),
      inputConfig: input,
      name: "github_check_pull_request_merged",
    }),
    githubToolDefinition({
      actionId: "github.get_commit_statuses",
      description:
        "List commit statuses for a SHA, branch, or tag ref in a repository.",
      input: object({
        ref: nonEmptyStringSchema,
        ...repositoryFields,
        ...optionalPaginationFields,
      }),
      inputConfig: input,
      name: "github_get_commit_statuses",
    }),
    githubToolDefinition({
      actionId: "github.list_check_runs_for_ref",
      description:
        "List GitHub Actions and app check runs for a SHA, branch, or tag ref.",
      input: object({
        appId: optional(positiveIntegerSchema),
        checkName: optional(string()),
        filter: optional(picklist(["latest", "all"])),
        ref: nonEmptyStringSchema,
        ...repositoryFields,
        ...optionalPaginationFields,
        status: optional(string()),
      }),
      inputConfig: input,
      name: "github_list_check_runs_for_ref",
    }),
    githubToolDefinition({
      actionId: "github.list_repository_workflows",
      description: "List GitHub Actions workflows configured in a repository.",
      input: object({
        ...repositoryFields,
        ...optionalPaginationFields,
      }),
      inputConfig: input,
      name: "github_list_repository_workflows",
    }),
    githubToolDefinition({
      actionId: "github.list_workflow_runs",
      description:
        "List GitHub Actions workflow runs for a repository, optionally filtered by branch, actor, event, status, commit, or creation range.",
      input: object({
        actor: optional(string()),
        branch: optional(string()),
        checkSuiteId: optional(positiveIntegerSchema),
        created: optional(string()),
        event: optional(string()),
        excludePullRequests: optional(boolean()),
        headSha: optional(string()),
        ...repositoryFields,
        ...optionalPaginationFields,
        status: optional(string()),
      }),
      inputConfig: input,
      name: "github_list_workflow_runs",
    }),
    githubToolDefinition({
      actionId: "github.get_workflow_run",
      description: "Get one GitHub Actions workflow run by id.",
      input: object(workflowRunFields),
      inputConfig: input,
      name: "github_get_workflow_run",
    }),
    githubToolDefinition({
      actionId: "github.list_workflow_run_jobs",
      description:
        "List jobs and step results for one GitHub Actions workflow run.",
      input: object({
        filter: optional(picklist(["latest", "all"])),
        ...workflowRunFields,
        ...optionalPaginationFields,
      }),
      inputConfig: input,
      name: "github_list_workflow_run_jobs",
    }),
    githubIssueBatchToolDefinition(input),
    githubToolDefinition({
      actionId: "github.create_issue",
      description: githubWriteToolDescription(
        "Create an issue in a GitHub repository."
      ),
      input: object({
        assignees: optional(array(string())),
        body: optional(string()),
        labels: optional(array(string())),
        milestone: optional(positiveIntegerSchema),
        ...repositoryFields,
        title: nonEmptyStringSchema,
      }),
      inputConfig: input,
      name: "github_create_issue",
      writeDisclosure: (payload) =>
        `create this issue in ${repositoryLabel(payload)}`,
    }),
    githubToolDefinition({
      actionId: "github.create_issue_comment",
      description: githubWriteToolDescription(
        "Post a comment on a GitHub issue or pull request conversation."
      ),
      input: object({
        body: nonEmptyStringSchema,
        ...issueFields,
      }),
      inputConfig: input,
      name: "github_create_issue_comment",
      writeDisclosure: (payload) =>
        `post this comment on ${repositoryLabel(payload)}#${String(payload.issueNumber)}`,
    }),
    githubToolDefinition({
      actionId: "github.add_issue_labels",
      description: githubWriteToolDescription(
        "Add one or more labels to a GitHub issue or pull request."
      ),
      input: object({
        ...issueFields,
        labels: nonEmptyStringArraySchema,
      }),
      inputConfig: input,
      name: "github_add_issue_labels",
      writeDisclosure: (payload) =>
        `add labels ${formatStringList(payload.labels)} to ${repositoryLabel(payload)}#${String(payload.issueNumber)}`,
    }),
    githubToolDefinition({
      actionId: "github.remove_issue_label",
      description: githubWriteToolDescription(
        "Remove one label from a GitHub issue or pull request."
      ),
      input: object({
        ...issueFields,
        label: nonEmptyStringSchema,
      }),
      inputConfig: input,
      name: "github_remove_issue_label",
      writeDisclosure: (payload) =>
        `remove label ${String(payload.label)} from ${repositoryLabel(payload)}#${String(payload.issueNumber)}`,
    }),
    githubToolDefinition({
      actionId: "github.add_issue_assignees",
      description: githubWriteToolDescription(
        "Assign one or more GitHub users to an issue or pull request."
      ),
      input: object({
        assignees: nonEmptyStringArraySchema,
        ...issueFields,
      }),
      inputConfig: input,
      name: "github_add_issue_assignees",
      writeDisclosure: (payload) =>
        `assign ${formatStringList(payload.assignees)} to ${repositoryLabel(payload)}#${String(payload.issueNumber)}`,
    }),
    githubToolDefinition({
      actionId: "github.remove_issue_assignees",
      description: githubWriteToolDescription(
        "Unassign one or more GitHub users from an issue or pull request."
      ),
      input: object({
        assignees: nonEmptyStringArraySchema,
        ...issueFields,
      }),
      inputConfig: input,
      name: "github_remove_issue_assignees",
      writeDisclosure: (payload) =>
        `unassign ${formatStringList(payload.assignees)} from ${repositoryLabel(payload)}#${String(payload.issueNumber)}`,
    }),
    githubToolDefinition({
      actionId: "github.create_ref",
      description: githubWriteToolDescription(
        "Create a Git ref, normally a new branch from an existing commit SHA."
      ),
      input: object({
        owner: nonEmptyStringSchema,
        ref: nonEmptyStringSchema,
        repo: nonEmptyStringSchema,
        sha: nonEmptyStringSchema,
      }),
      inputConfig: input,
      name: "github_create_ref",
      writeDisclosure: (payload) =>
        `create branch ${String(payload.ref).replace(GITHUB_HEADS_REF_PREFIX_PATTERN, "")} in ${repositoryLabel(payload)}`,
    }),
    githubToolDefinition({
      actionId: "github.create_or_update_file",
      description: githubWriteToolDescription(
        "Create or update one repository file and commit it to a branch. Supply the current file SHA when updating an existing file."
      ),
      input: object({
        branch: optional(string()),
        content: string(),
        message: nonEmptyStringSchema,
        owner: nonEmptyStringSchema,
        path: nonEmptyStringSchema,
        repo: nonEmptyStringSchema,
        sha: optional(string()),
      }),
      inputConfig: input,
      name: "github_create_or_update_file",
      writeDisclosure: (payload) =>
        `commit changes to ${String(payload.path)}${payload.branch ? ` on ${String(payload.branch)}` : ""} in ${repositoryLabel(payload)}`,
    }),
    githubToolDefinition({
      actionId: "github.delete_file",
      description: githubWriteToolDescription(
        "Delete one repository file and commit that deletion to a branch. Supply the current file SHA."
      ),
      input: object({
        branch: optional(string()),
        ...writeConfirmationField,
        message: nonEmptyStringSchema,
        owner: nonEmptyStringSchema,
        path: nonEmptyStringSchema,
        repo: nonEmptyStringSchema,
        sha: nonEmptyStringSchema,
      }),
      inputConfig: input,
      name: "github_delete_file",
      writeDisclosure: (payload) =>
        `delete ${String(payload.path)}${payload.branch ? ` on ${String(payload.branch)}` : ""} from ${repositoryLabel(payload)}`,
    }),
    githubToolDefinition({
      actionId: "github.create_pull_request",
      description: githubWriteToolDescription(
        "Create a pull request between two branches."
      ),
      input: object({
        base: nonEmptyStringSchema,
        body: optional(string()),
        draft: optional(boolean()),
        head: nonEmptyStringSchema,
        maintainerCanModify: optional(boolean()),
        owner: nonEmptyStringSchema,
        repo: nonEmptyStringSchema,
        title: nonEmptyStringSchema,
      }),
      inputConfig: input,
      name: "github_create_pull_request",
      writeDisclosure: (payload) =>
        `create this pull request in ${repositoryLabel(payload)}`,
    }),
    githubToolDefinition({
      actionId: "github.create_pull_request_review",
      description: githubWriteToolDescription(
        "Submit a comment, approval, or change-request review on a pull request, optionally with inline comments."
      ),
      input: object({
        body: optional(string()),
        comments: optional(
          array(
            object({
              body: nonEmptyStringSchema,
              line: optional(positiveIntegerSchema),
              path: nonEmptyStringSchema,
              side: optional(picklist(["LEFT", "RIGHT"])),
              startLine: optional(positiveIntegerSchema),
              startSide: optional(picklist(["LEFT", "RIGHT"])),
            })
          )
        ),
        commitId: optional(string()),
        event: optional(picklist(["APPROVE", "REQUEST_CHANGES", "COMMENT"])),
        ...pullRequestFields,
      }),
      inputConfig: input,
      name: "github_create_pull_request_review",
      writeDisclosure: (payload) =>
        `submit this review on ${repositoryLabel(payload)}#${String(payload.pullNumber)}`,
    }),
    githubToolDefinition({
      actionId: "github.create_pull_request_review_comment",
      description: githubWriteToolDescription(
        "Create one inline review comment on a pull request diff."
      ),
      input: object({
        body: nonEmptyStringSchema,
        commitId: nonEmptyStringSchema,
        line: optional(positiveIntegerSchema),
        path: nonEmptyStringSchema,
        ...pullRequestFields,
        side: optional(picklist(["LEFT", "RIGHT"])),
        startLine: optional(positiveIntegerSchema),
        startSide: optional(picklist(["LEFT", "RIGHT"])),
      }),
      inputConfig: input,
      name: "github_create_pull_request_review_comment",
      writeDisclosure: (payload) =>
        `post an inline review comment on ${repositoryLabel(payload)}#${String(payload.pullNumber)}`,
    }),
    githubToolDefinition({
      actionId: "github.reply_pull_request_review_comment",
      description: githubWriteToolDescription(
        "Reply to an existing inline pull request review comment."
      ),
      input: object({
        body: nonEmptyStringSchema,
        commentId: positiveIntegerSchema,
        ...pullRequestFields,
      }),
      inputConfig: input,
      name: "github_reply_pull_request_review_comment",
      writeDisclosure: (payload) =>
        `reply to review comment ${String(payload.commentId)} on ${repositoryLabel(payload)}#${String(payload.pullNumber)}`,
    }),
    githubToolDefinition({
      actionId: "github.request_pull_request_reviewers",
      description: githubWriteToolDescription(
        "Request GitHub users or teams to review a pull request."
      ),
      input: pullRequestReviewerMutationInputSchema,
      inputConfig: input,
      name: "github_request_pull_request_reviewers",
      writeDisclosure: (payload) =>
        `request a review from ${formatReviewers(payload)} on ${repositoryLabel(payload)}#${String(payload.pullNumber)}`,
    }),
    githubToolDefinition({
      actionId: "github.remove_pull_request_reviewers",
      description: githubWriteToolDescription(
        "Remove requested GitHub users or teams from a pull request."
      ),
      input: pullRequestReviewerMutationInputSchema,
      inputConfig: input,
      name: "github_remove_pull_request_reviewers",
      writeDisclosure: (payload) =>
        `remove ${formatReviewers(payload)} from the requested reviewers on ${repositoryLabel(payload)}#${String(payload.pullNumber)}`,
    }),
    githubToolDefinition({
      actionId: "github.update_issue",
      description: githubWriteToolDescription(
        "Update an issue's title, body, state, assignees, labels, or milestone."
      ),
      input: object({
        assignees: optional(array(string())),
        body: optional(string()),
        ...issueFields,
        labels: optional(array(string())),
        milestone: optional(positiveIntegerSchema),
        state: optional(picklist(["open", "closed"])),
        title: optional(string()),
      }),
      inputConfig: input,
      name: "github_update_issue",
      writeDisclosure: (payload) =>
        `update issue ${repositoryLabel(payload)}#${String(payload.issueNumber)}`,
    }),
    githubToolDefinition({
      actionId: "github.update_pull_request",
      description: githubWriteToolDescription(
        "Update a pull request's title, body, state, base branch, or maintainer-edit setting."
      ),
      input: object({
        base: optional(string()),
        body: optional(string()),
        maintainerCanModify: optional(boolean()),
        ...pullRequestFields,
        state: optional(picklist(["open", "closed"])),
        title: optional(string()),
      }),
      inputConfig: input,
      name: "github_update_pull_request",
      writeDisclosure: (payload) =>
        `update pull request ${repositoryLabel(payload)}#${String(payload.pullNumber)}`,
    }),
    githubToolDefinition({
      actionId: "github.update_pull_request_branch",
      description: githubWriteToolDescription(
        "Update a pull request branch with changes from its base branch."
      ),
      input: object({
        expectedHeadSha: optional(string()),
        ...pullRequestFields,
      }),
      inputConfig: input,
      name: "github_update_pull_request_branch",
      writeDisclosure: (payload) =>
        `update the branch for ${repositoryLabel(payload)}#${String(payload.pullNumber)} with its base branch`,
    }),
    githubToolDefinition({
      actionId: "github.rerun_workflow",
      description: githubWriteToolDescription(
        "Re-run all jobs in a GitHub Actions workflow run, optionally with debug logging enabled."
      ),
      input: object({
        enableDebugLogging: optional(boolean()),
        ...workflowRunFields,
      }),
      inputConfig: input,
      name: "github_rerun_workflow",
      writeDisclosure: (payload) =>
        `re-run workflow run ${String(payload.runId)} in ${repositoryLabel(payload)}${payload.enableDebugLogging ? " with debug logging" : ""}`,
    }),
    githubToolDefinition({
      actionId: "github.merge_pull_request",
      description: githubWriteToolDescription(
        "Merge a pull request with GitHub's merge, squash, or rebase strategy."
      ),
      input: object({
        ...writeConfirmationField,
        commitMessage: optional(string()),
        commitTitle: optional(string()),
        mergeMethod: optional(picklist(["merge", "squash", "rebase"])),
        ...pullRequestFields,
        sha: optional(string()),
      }),
      inputConfig: input,
      name: "github_merge_pull_request",
      writeDisclosure: (payload) =>
        `${mergePullRequestVerb(payload.mergeMethod)} pull request ${repositoryLabel(payload)}#${String(payload.pullNumber)}`,
    }),
  ];
}

function githubIssueBatchToolDefinition(input: {
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  submissionId: string;
}): RemoteAgentGitHubToolDefinition {
  return {
    name: "github_create_issue_batch",
    description: `${GITHUB_ACTOR_GUIDANCE} Create multiple GitHub issues as one durable OpenMeld operation. Use this tool whenever one authorized user request or Routine instruction creates more than one issue; do not ask for a second confirmation. If the user asks to add issues to a GitHub Project, supply projectV2; if the user asks for assignment, supply assignees. OpenMeld will fail closed before any GitHub write unless Project V2 capability and Organization identity mapping are verified. The manifest is checkpointed after every issue and resumes without intentionally duplicating completed items.`,
    input: withGitHubActor(
      object({
        assignees: optional(array(nonEmptyStringSchema)),
        issues: pipe(
          array(
            object({
              body: optional(string()),
              externalKey: nonEmptyStringSchema,
              labels: optional(array(nonEmptyStringSchema)),
              title: nonEmptyStringSchema,
            })
          ),
          minLength(1)
        ),
        operationId: nonEmptyStringSchema,
        owner: nonEmptyStringSchema,
        projectV2: optional(
          object({
            number: positiveIntegerSchema,
            owner: nonEmptyStringSchema,
          })
        ),
        repo: nonEmptyStringSchema,
      })
    ),
    execute: async (payload) =>
      await executeGitHubIssueBatch({
        connectorExecution: input.connectorExecution,
        coreWorker: input.coreWorker,
        payload,
        storage: input.storage,
        submissionId: input.submissionId,
      }),
  };
}

function githubWriteToolDescription(description: string): {
  writeSummary: string;
} {
  return { writeSummary: description };
}

function withGitHubActor(
  input: RemoteAgentToolInputSchema,
  options: { includeOperationId?: boolean } = {}
): RemoteAgentToolInputSchema {
  const objectInput = input as RemoteAgentToolInputSchema & {
    entries?: Record<string, RemoteAgentToolInputSchema>;
    pipe?: readonly unknown[];
    type?: string;
  };
  if (objectInput.type !== "object" || !objectInput.entries) {
    throw new Error("GitHub tool input must be a top-level object schema.");
  }
  const entries: Record<string, RemoteAgentToolInputSchema> = {
    ...objectInput.entries,
    githubActor: githubActorSchema,
  };
  if (options.includeOperationId) {
    entries.operationId = githubWriteOperationIdSchema;
  }
  const merged = object(entries);
  const validationActions = objectInput.pipe?.slice(1) ?? [];
  if (validationActions.length === 0) {
    return merged;
  }
  const applyPipe = pipe as unknown as (
    schema: RemoteAgentToolInputSchema,
    ...actions: unknown[]
  ) => RemoteAgentToolInputSchema;
  return applyPipe(merged, ...validationActions);
}

function resolveGitHubIssueBatchBlockedReasons(
  payload: Record<string, unknown>
): { message: string; reasonCode: string }[] {
  const reasons: { message: string; reasonCode: string }[] = [];
  if (payload.projectV2) {
    reasons.push({
      message:
        "OpenMeld cannot verify GitHub Project V2 access for this connection, so it did not create any issues.",
      reasonCode: "github.project_v2_capability_unavailable",
    });
  }
  if (toStringArray(payload.assignees).length > 0) {
    reasons.push({
      message:
        "OpenMeld cannot verify those GitHub usernames against Organization member identities, so it did not create any issues.",
      reasonCode: "github.assignee_identity_mapping_unavailable",
    });
  }
  return reasons;
}

async function executeGitHubIssueBatch(input: {
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  coreWorker: RemoteAgentCoreWorkerBinding;
  payload: Record<string, unknown>;
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<unknown> {
  const githubActor = requireGitHubActor(input.payload.githubActor);
  const blockedReasons = resolveGitHubIssueBatchBlockedReasons(input.payload);
  if (blockedReasons.length > 0) {
    return {
      blockedReasons,
      sideEffects: 0,
      status: "blocked_before_write",
    };
  }

  const operationId = requirePayloadString(input.payload, "operationId");
  const owner = requirePayloadString(input.payload, "owner");
  const repo = requirePayloadString(input.payload, "repo");
  const issueInputs = requireGitHubIssueBatchItems(input.payload.issues);
  const toolContext = await buildRemoteAgentToolContext({
    storage: input.storage,
    submissionId: input.submissionId,
    toolName: "github_create_issue_batch",
  });
  const { attribution, selection } = await resolveGitHubActionContext({
    coreWorker: input.coreWorker,
    githubActor,
    storage: input.storage,
    submissionId: input.submissionId,
    toolContext,
  });

  const digest = await digestGitHubActionInput({
    issues: issueInputs,
    operationId,
    owner,
    repo,
  });
  const manifestKey = `${GITHUB_ISSUE_BATCH_PREFIX}${operationId}`;
  const proposedManifest: GitHubIssueBatchManifest = {
    connectionName: selection.connection.connectionName,
    connectionOwnerUserId: selection.connection.userId,
    createdBySubmissionId: input.submissionId,
    digest,
    items: await Promise.all(
      issueInputs.map(async (issue) => ({
        ...issue,
        marker: await buildGitHubIssueOperationMarker({
          externalKey: issue.externalKey,
          operationId,
        }),
        status: "pending" as const,
      }))
    ),
    operationId,
    organizationId: selection.connection.organizationId,
    owner,
    repo,
    v: 1,
  };
  const created = await input.storage.putIfAbsent(
    manifestKey,
    proposedManifest
  );
  const manifest = created
    ? proposedManifest
    : await input.storage.get<GitHubIssueBatchManifest>(manifestKey);
  if (
    !(manifest && githubIssueBatchManifestMatches(manifest, proposedManifest))
  ) {
    throw new Error(
      "This GitHub batch operation id is already bound to a different immutable manifest."
    );
  }

  return await executeGitHubIssueBatchManifest({
    attribution,
    connectorExecution: input.connectorExecution,
    coreWorker: input.coreWorker,
    manifest,
    manifestKey,
    operationId,
    owner,
    repo,
    storage: input.storage,
    submissionId: input.submissionId,
    toolContext,
  });
}

async function executeGitHubIssueBatchManifest(input: {
  attribution: Record<string, unknown>;
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  coreWorker: RemoteAgentCoreWorkerBinding;
  manifest: GitHubIssueBatchManifest;
  manifestKey: string;
  operationId: string;
  owner: string;
  repo: string;
  storage: RemoteAgentStorage;
  submissionId: string;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}): Promise<Record<string, unknown>> {
  for (let index = 0; index < input.manifest.items.length; index += 1) {
    const item = input.manifest.items[index];
    if (!item || item.status === "completed") {
      continue;
    }
    const result = await executeGitHubIssueBatchItem({
      ...input,
      index,
      item,
    });
    if (result.status === "incomplete") {
      return buildGitHubIssueBatchIncompleteResult({
        attribution: input.attribution,
        error: result.error,
        manifest: input.manifest,
        operationId: input.operationId,
      });
    }
  }
  return {
    attribution: input.attribution,
    completed: input.manifest.items.length,
    items: input.manifest.items.map((item) => ({
      externalKey: item.externalKey,
      result: item.result,
      status: item.status,
    })),
    operationId: input.operationId,
    remaining: 0,
    status: "completed",
  };
}

async function executeGitHubIssueBatchItem(input: {
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  coreWorker: RemoteAgentCoreWorkerBinding;
  index: number;
  item: GitHubIssueBatchManifest["items"][number];
  manifest: GitHubIssueBatchManifest;
  manifestKey: string;
  owner: string;
  repo: string;
  storage: RemoteAgentStorage;
  submissionId: string;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}): Promise<
  { status: "completed" } | { error: unknown; status: "incomplete" }
> {
  const callbackContext = await readRemoteAgentCallbackContext(
    input.storage,
    input.submissionId
  );
  if (!callbackContext) {
    throw new Error("Remote Agent execution context is unavailable.");
  }
  await assertRemoteAgentExecutionCanContinue({
    identity: buildRemoteAgentExecutionIdentity(callbackContext),
    storage: input.storage,
  });
  const auditOperationId = `batch:${input.manifest.digest.slice(0, 48)}:${input.index}`;
  let reconciled: unknown | null;
  try {
    reconciled = await findGitHubIssueByOperationMarker({
      connectorExecution: input.connectorExecution,
      connectionName: input.manifest.connectionName,
      marker: input.item.marker,
      owner: input.owner,
      repo: input.repo,
    });
  } catch (error) {
    return { error, status: "incomplete" };
  }
  if (reconciled) {
    input.manifest.items[input.index] = {
      ...input.item,
      result: reconciled,
      status: "completed",
    };
    await input.storage.put(input.manifestKey, input.manifest);
    await recordGitHubConnectorActionAuditBestEffort({
      actionId: "github.create_issue",
      coreWorker: input.coreWorker,
      operationId: auditOperationId,
      outcome: "completed",
      toolContext: input.toolContext,
    });
    return { status: "completed" };
  }

  await recordGitHubConnectorActionAudit({
    actionId: "github.create_issue",
    coreWorker: input.coreWorker,
    operationId: auditOperationId,
    outcome: "attempted",
    toolContext: input.toolContext,
  });
  try {
    const result = await runOpenConnectorAction({
      actionId: "github.create_issue",
      baseUrl: input.connectorExecution?.baseUrl ?? "",
      connectionName: input.manifest.connectionName,
      fetch: input.connectorExecution?.fetch,
      input: buildGitHubIssueBatchActionInput(input),
      runtimeToken: input.connectorExecution?.runtimeToken ?? "",
    });
    input.manifest.items[input.index] = {
      ...input.item,
      result,
      status: "completed",
    };
    await input.storage.put(input.manifestKey, input.manifest);
  } catch (error) {
    await recordGitHubConnectorActionAuditAfterFailure({
      actionId: "github.create_issue",
      coreWorker: input.coreWorker,
      error,
      operationId: auditOperationId,
      toolContext: input.toolContext,
    });
    input.manifest.items[input.index] = {
      ...input.item,
      status: resolveGitHubIssueBatchFailureStatus(error),
    };
    await input.storage.put(input.manifestKey, input.manifest);
    return { error, status: "incomplete" };
  }
  await recordGitHubConnectorActionAuditBestEffort({
    actionId: "github.create_issue",
    coreWorker: input.coreWorker,
    operationId: auditOperationId,
    outcome: "completed",
    toolContext: input.toolContext,
  });
  return { status: "completed" };
}

function buildGitHubIssueBatchActionInput(input: {
  item: GitHubIssueBatchManifest["items"][number];
  owner: string;
  repo: string;
}): Record<string, unknown> {
  return {
    body: input.item.body
      ? `${input.item.body}\n\n${input.item.marker}`
      : input.item.marker,
    ...(input.item.labels ? { labels: input.item.labels } : {}),
    owner: input.owner,
    repo: input.repo,
    title: input.item.title,
  };
}

function resolveGitHubIssueBatchFailureStatus(
  error: unknown
): "outcome_unknown" | "pending" {
  return error instanceof OpenConnectorActionError && error.outcome === "failed"
    ? "pending"
    : "outcome_unknown";
}

function buildGitHubIssueBatchIncompleteResult(input: {
  attribution: Record<string, unknown>;
  error: unknown;
  manifest: GitHubIssueBatchManifest;
  operationId: string;
}): Record<string, unknown> {
  return {
    attribution: input.attribution,
    completed: input.manifest.items.filter(
      (candidate) => candidate.status === "completed"
    ).length,
    error:
      input.error instanceof Error ? input.error.message : String(input.error),
    operationId: input.operationId,
    remaining: input.manifest.items.filter(
      (candidate) => candidate.status !== "completed"
    ).length,
    status: "incomplete_retryable",
  };
}

function repositoryLabel(payload: Record<string, unknown>): string {
  return `${String(payload.owner)}/${String(payload.repo)}`;
}

function formatStringList(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(", ") : String(value);
}

function formatReviewers(payload: Record<string, unknown>): string {
  const reviewers = Array.isArray(payload.reviewers)
    ? payload.reviewers.map(String)
    : [];
  const teams = Array.isArray(payload.teamReviewers)
    ? payload.teamReviewers.map((team) => `team ${String(team)}`)
    : [];
  return [...reviewers, ...teams].join(" and ");
}

function mergePullRequestVerb(value: unknown): string {
  if (value === "squash") {
    return "squash-merge";
  }
  if (value === "rebase") {
    return "rebase-merge";
  }
  return "merge";
}

function hasGitHubIssueSearchCriteria(input: {
  assignee?: string;
  author?: string;
  baseBranch?: string;
  headBranch?: string;
  isMerged?: boolean;
  label?: string;
  language?: string;
  mentions?: string;
  owner?: string;
  q?: string;
  query?: string;
  repo?: string;
  state?: "all" | "closed" | "open";
  type?: "issue" | "pr";
}): boolean {
  return Boolean(
    input.query ||
      input.q ||
      input.owner ||
      input.repo?.includes("/") ||
      (input.state && input.state !== "all") ||
      input.type ||
      input.label ||
      input.author ||
      input.assignee ||
      input.mentions ||
      input.language ||
      input.baseBranch ||
      input.headBranch ||
      typeof input.isMerged === "boolean"
  );
}

function githubToolDefinition(input: {
  actionId: GitHubActionId;
  description: string | { writeSummary: string };
  input: RemoteAgentToolInputSchema;
  inputConfig: {
    connectorExecution?: RemoteAgentConnectorExecutionConfig;
    coreWorker: RemoteAgentCoreWorkerBinding;
    storage: RemoteAgentStorage;
    submissionId: string;
  };
  name: RemoteAgentGitHubToolName;
  writeDisclosure?: GitHubWriteDisclosure;
}): RemoteAgentGitHubToolDefinition {
  const destructive = GITHUB_DESTRUCTIVE_WRITE_ACTION_IDS.has(input.actionId);
  const actionDescription =
    typeof input.description === "string"
      ? input.description
      : describeGitHubWriteTool({
          destructive,
          summary: input.description.writeSummary,
        });
  return {
    description: `${GITHUB_ACTOR_GUIDANCE} ${
      input.writeDisclosure ? `${GITHUB_WRITE_OPERATION_GUIDANCE} ` : ""
    }${actionDescription}`,
    ...(destructive
      ? {
          endsTurnAfter: (result: unknown) =>
            isRemoteAgentDestructiveConfirmationResult(result),
        }
      : {}),
    execute: async (payload) =>
      await executeGitHubAction({
        actionId: input.actionId,
        connectorExecution: input.inputConfig.connectorExecution,
        coreWorker: input.inputConfig.coreWorker,
        payload,
        storage: input.inputConfig.storage,
        submissionId: input.inputConfig.submissionId,
        toolName: input.name,
        writeDisclosure: input.writeDisclosure,
      }),
    input: withGitHubActor(input.input, {
      includeOperationId: Boolean(input.writeDisclosure),
    }),
    name: input.name,
  };
}

async function resolveGitHubActionContext(input: {
  coreWorker: RemoteAgentCoreWorkerBinding;
  githubActor: GitHubActor;
  storage: RemoteAgentStorage;
  submissionId: string;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}) {
  const { requesterKind, requesterUserId } = resolveGitHubTurnRequester(
    input.toolContext.turnEnvelope
  );
  if (requesterUserId === null && input.githubActor === "requester") {
    throw new Error(
      "Your GitHub requires a linked OpenMeld identity. Use githubActor = organization for this Organization's shared GitHub access."
    );
  }
  if (requesterKind !== "interactive" && input.githubActor === "requester") {
    throw new Error(
      "Routines and other unattended GitHub work must use the OpenMeld GitHub App through Organization access."
    );
  }
  const connectionPreference =
    input.githubActor === "organization" ? "shared" : "requester";
  const resolveConnection = requireCoreRpc(
    input.coreWorker.centerAgentResolveConnectorConnection,
    "centerAgentResolveConnectorConnection"
  );
  const resolved = centerAgentConnectorConnectionSelectionSchema.parse(
    await resolveConnection({
      connectionPreference,
      context: input.toolContext.context,
      requesterUserId,
      service: "github",
    })
  );
  if (!(resolved.connection && resolved.selection)) {
    const hasNavigationAction = Boolean(
      input.toolContext.turnEnvelope?.organization.webUrl
    );
    if (hasNavigationAction) {
      await recordRemoteAgentNavigationTarget({
        storage: input.storage,
        submissionId: input.submissionId,
        target: { kind: "organization_app", service: "github" },
      });
    }
    throw new Error(
      resolveUnavailableGitHubConnectionMessage({
        githubActor: input.githubActor,
        hasNavigationAction,
      })
    );
  }
  if (resolved.selection !== connectionPreference) {
    throw new Error(
      "Core returned a GitHub connection that does not match the selected GitHub identity."
    );
  }
  if (
    resolved.connection.organizationId !==
    input.toolContext.context.activeOrganizationId
  ) {
    throw new Error(
      "Core returned a GitHub connection from another Organization."
    );
  }
  const connection = resolved.connection;
  const selection = resolved.selection;
  return {
    attribution: {
      connectionOwner: {
        displayName: connection.ownerDisplayName,
        userId: connection.userId,
      },
      selection,
      service: "github" as const,
      via:
        connection.scope === "shared"
          ? `the OpenMeld GitHub App through Organization access (connected by ${connection.ownerDisplayName})`
          : `${connection.ownerDisplayName}'s GitHub`,
    },
    requesterUserId,
    selection: { connection, selection },
  };
}

function buildGitHubActionAttributionFromExecutionConnection(
  connection: CenterAgentConnectorActionExecutionConnection
) {
  if (connection.service !== "github") {
    throw new Error(
      "Core returned a non-GitHub execution connection for a GitHub operation."
    );
  }
  const selection =
    connection.scope === "shared"
      ? ("shared" as const)
      : ("requester" as const);
  return {
    connectionOwner: {
      displayName: connection.ownerDisplayName,
      userId: connection.ownerUserId,
    },
    selection,
    service: "github" as const,
    via:
      selection === "shared"
        ? `the OpenMeld GitHub App through Organization access (connected by ${connection.ownerDisplayName})`
        : `${connection.ownerDisplayName}'s GitHub`,
  };
}

async function executeGitHubAction(input: {
  actionId: GitHubActionId;
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  coreWorker: RemoteAgentCoreWorkerBinding;
  payload: Record<string, unknown>;
  storage: RemoteAgentStorage;
  submissionId: string;
  toolName: RemoteAgentGitHubToolName;
  writeDisclosure?: GitHubWriteDisclosure;
}): Promise<unknown> {
  const toolContext = await buildRemoteAgentToolContext({
    storage: input.storage,
    submissionId: input.submissionId,
    toolName: input.toolName,
  });
  if (input.writeDisclosure) {
    const externalWriteBlock =
      resolveRemoteAgentRoutineExternalWriteBlock(toolContext);
    if (externalWriteBlock) {
      return externalWriteBlock;
    }
  }
  const {
    githubActor: rawGitHubActor,
    operationId: rawOperationId,
    writeConfirmationToken,
    ...rawActionInput
  } = input.payload;
  const githubActor = requireGitHubActor(rawGitHubActor);
  const { actionInput, fileSegment } = resolveGitHubActionRequest({
    actionId: input.actionId,
    input: rawActionInput,
  });
  if (input.writeDisclosure) {
    return await executeIdempotentGitHubWrite({
      actionId: input.actionId,
      actionInput,
      connectorExecution: input.connectorExecution,
      coreWorker: input.coreWorker,
      githubActor,
      operationId: requireGitHubWriteOperationId(rawOperationId),
      storage: input.storage,
      submissionId: input.submissionId,
      toolContext,
      writeConfirmationToken,
      writeDisclosure: input.writeDisclosure,
    });
  }

  const { attribution, requesterUserId, selection } =
    await resolveGitHubActionContext({
      coreWorker: input.coreWorker,
      githubActor,
      storage: input.storage,
      submissionId: input.submissionId,
      toolContext,
    });
  let data: unknown;
  try {
    const connectorData = await runOpenConnectorAction({
      actionId: input.actionId,
      baseUrl: input.connectorExecution?.baseUrl ?? "",
      connectionName: selection.connection.connectionName,
      fetch: input.connectorExecution?.fetch,
      input: actionInput,
      runtimeToken: input.connectorExecution?.runtimeToken ?? "",
    });
    data = fileSegment
      ? segmentGitHubFileContents(connectorData, fileSegment, attribution)
      : projectGitHubActionResult({
          actionId: input.actionId,
          actionInput,
          attribution,
          data: connectorData,
        });
  } catch (error) {
    console.warn("[remote_agent.connector_action_failed]", {
      actionId: input.actionId,
      connectionName: selection.connection.connectionName,
      connectionOwnerUserId: selection.connection.userId,
      error: error instanceof Error ? error.message : String(error),
      organizationId: selection.connection.organizationId,
      requestId: toolContext.context.actorContext.requestId,
      requesterUserId,
      selection: selection.selection,
      service: "github",
    });
    throw error;
  }
  console.info("[remote_agent.connector_action_completed]", {
    actionId: input.actionId,
    connectionName: selection.connection.connectionName,
    connectionOwnerDisplayName: selection.connection.ownerDisplayName,
    connectionOwnerUserId: selection.connection.userId,
    organizationId: selection.connection.organizationId,
    requestId: toolContext.context.actorContext.requestId,
    requesterUserId,
    selection: selection.selection,
    service: "github",
  });
  return {
    attribution,
    data,
    status: "completed",
  };
}

async function executeIdempotentGitHubWrite(input: {
  actionId: GitHubActionId;
  actionInput: Record<string, unknown>;
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  coreWorker: RemoteAgentCoreWorkerBinding;
  githubActor: GitHubActor;
  operationId: string;
  storage: RemoteAgentStorage;
  submissionId: string;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
  writeConfirmationToken: unknown;
  writeDisclosure: GitHubWriteDisclosure;
}): Promise<unknown> {
  const { requesterKind, requesterUserId } = resolveGitHubTurnRequester(
    input.toolContext.turnEnvelope
  );
  if (requesterKind !== "interactive" && input.githubActor === "requester") {
    throw new Error(
      "Routines and other unattended GitHub work must use the OpenMeld GitHub App through Organization access."
    );
  }
  const existingOperation = await readConnectorActionOperation({
    actionId: input.actionId,
    coreWorker: input.coreWorker,
    operationId: input.operationId,
    service: "github",
    toolContext: input.toolContext,
  });
  let actionContext:
    | Awaited<ReturnType<typeof resolveGitHubActionContext>>
    | undefined;
  if (!existingOperation) {
    actionContext = await resolveGitHubActionContext({
      coreWorker: input.coreWorker,
      githubActor: input.githubActor,
      storage: input.storage,
      submissionId: input.submissionId,
      toolContext: input.toolContext,
    });
    const destructiveConfirmation =
      await resolvePendingGitHubDestructiveConfirmation({
        actionId: input.actionId,
        actionInput: input.actionInput,
        attribution: actionContext.attribution,
        githubActor: input.githubActor,
        operationId: input.operationId,
        selection: actionContext.selection.connection,
        storage: input.storage,
        submissionId: input.submissionId,
        token: input.writeConfirmationToken,
        toolContext: input.toolContext,
        writeDisclosure: input.writeDisclosure,
      });
    if (destructiveConfirmation) {
      return destructiveConfirmation;
    }
  }

  const connectionName =
    existingOperation?.connectionName ??
    actionContext?.selection.connection.connectionName;
  if (!connectionName) {
    throw new Error(
      `OpenMeld could not resolve the GitHub connection for operation ${input.operationId}.`
    );
  }
  const requestSignature = await digestCanonicalJson({
    actionId: input.actionId,
    connectionName,
    githubActor: input.githubActor,
    input: input.actionInput,
    service: "github",
  });
  const claim = await recordConnectorActionOperation({
    actionId: input.actionId,
    connectionName,
    coreWorker: input.coreWorker,
    operationId: input.operationId,
    outcome: "attempted",
    providerExecutionId: null,
    requestSignature,
    service: "github",
    toolContext: input.toolContext,
  });
  const replayExecutionConnection =
    existingOperation?.executionConnection ?? claim.executionConnection;
  const replayAttribution = replayExecutionConnection
    ? buildGitHubActionAttributionFromExecutionConnection(
        replayExecutionConnection
      )
    : undefined;
  const attribution = actionContext?.attribution ??
    replayAttribution ?? {
      connectionName,
      service: "github" as const,
    };
  const selection =
    actionContext?.selection.selection ??
    replayAttribution?.selection ??
    "operation_replay";
  const connectionOwnerDisplayName =
    actionContext?.selection.connection.ownerDisplayName ??
    replayExecutionConnection?.ownerDisplayName ??
    null;
  const connectionOwnerUserId =
    actionContext?.selection.connection.userId ??
    replayExecutionConnection?.ownerUserId ??
    null;
  const providerIdempotencyKey = `openmeld:${await digestCanonicalJson({
    actionId: input.actionId,
    actorProfileId: claim.attribution.actorProfileId,
    callerOperationId: input.operationId,
    connectionName,
    organizationId: input.toolContext.context.activeOrganizationId,
    representedUserId: claim.attribution.onBehalfOf?.userId ?? null,
    requestSignature,
  })}`;

  let run: Awaited<ReturnType<typeof runAndFinalizeConnectorAction>>;
  try {
    run = await runAndFinalizeConnectorAction({
      connectionName,
      dependencies: {
        connectorExecution: input.connectorExecution,
        coreWorker: input.coreWorker,
        storage: input.storage,
        submissionId: input.submissionId,
      },
      request: {
        actionId: input.actionId,
        input: input.actionInput,
        operationId: input.operationId,
        providerIdempotencyKey,
        service: "github",
      },
      requestSignature,
      toolContext: input.toolContext,
    });
  } catch (error) {
    console.warn("[remote_agent.connector_action_failed]", {
      actionId: input.actionId,
      connectionName,
      connectionOwnerUserId,
      error: error instanceof Error ? error.message : String(error),
      operationId: input.operationId,
      organizationId: input.toolContext.context.activeOrganizationId,
      requestId: input.toolContext.context.actorContext.requestId,
      requesterUserId,
      selection,
      service: "github",
    });
    throw error;
  }

  console.info("[remote_agent.connector_action_completed]", {
    actionId: input.actionId,
    connectionName,
    connectionOwnerDisplayName,
    connectionOwnerUserId,
    operationId: input.operationId,
    organizationId: input.toolContext.context.activeOrganizationId,
    requestId: input.toolContext.context.actorContext.requestId,
    requesterUserId,
    selection,
    service: "github",
  });
  return {
    attribution,
    data: run.data,
    operationId: input.operationId,
    providerExecutionId: run.providerExecutionId,
    replayed: claim.replayed,
    status: "completed",
  };
}

async function resolvePendingGitHubDestructiveConfirmation(input: {
  actionId: GitHubActionId;
  actionInput: Record<string, unknown>;
  attribution: Record<string, unknown>;
  githubActor: GitHubActor;
  operationId: string;
  selection: {
    connectionName: string;
    organizationId: string;
    ownerDisplayName: string;
    scope: "member" | "shared";
    userId: string;
  };
  storage: RemoteAgentStorage;
  submissionId: string;
  token: unknown;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
  writeDisclosure?: GitHubWriteDisclosure;
}): Promise<Record<string, unknown> | null> {
  if (!GITHUB_DESTRUCTIVE_WRITE_ACTION_IDS.has(input.actionId)) {
    return null;
  }
  if (!input.writeDisclosure) {
    throw new Error(
      `Destructive GitHub action ${input.actionId} is missing its confirmation contract.`
    );
  }
  const authorization = await resolveRemoteAgentDestructiveAuthorization({
    actionId: input.actionId,
    actionDescription: `${input.writeDisclosure(
      input.actionInput
    )} ${describeGitHubWriteIdentity({
      ownerDisplayName: input.selection.ownerDisplayName,
      scope: input.selection.scope,
    })}`,
    actionInput: {
      githubActor: input.githubActor,
      input: input.actionInput,
      operationId: input.operationId,
    },
    executionIdentity: {
      connectionName: input.selection.connectionName,
      ownerUserId: input.selection.userId,
    },
    storage: input.storage,
    submissionId: input.submissionId,
    token: input.token,
    tokenFieldName: "writeConfirmationToken",
    toolContext: input.toolContext,
  });
  if (authorization.authorized) {
    return null;
  }
  const result = authorization.result;
  return {
    attribution: input.attribution,
    ...result,
    ...(result.status === "destructive_confirmation_required"
      ? {
          confirmation: {
            ...result.confirmation,
            connectionOwnerUserId: input.selection.userId,
          },
        }
      : {}),
  };
}

function describeGitHubWriteTool(input: {
  destructive: boolean;
  summary: string;
}): string {
  if (input.destructive) {
    return `${input.summary} In an interactive conversation, always call once without writeConfirmationToken, end the turn after showing the returned confirmation, and call again with that exact one-time token only after the user confirms. Routines do not currently support delete or merge actions; the tool returns routine_destructive_action_unsupported with zero side effects.`;
  }
  return `${input.summary} This is an ordinary external write. Apply the unified authorization policy; once authorized, execute it without asking for a second confirmation.`;
}

type GitHubFileSegmentRequest = {
  expectedFileSha: string | null;
  maxUtf16CodeUnits: number;
  offsetUtf16: number;
};

const GITHUB_FILE_SEGMENT_METADATA_KEYS = [
  "download_url",
  "encoding",
  "git_url",
  "html_url",
  "name",
  "path",
  "sha",
  "size",
  "type",
  "url",
] as const;

function resolveGitHubActionRequest(input: {
  actionId: GitHubActionId;
  input: Record<string, unknown>;
}): {
  actionInput: Record<string, unknown>;
  fileSegment: GitHubFileSegmentRequest | null;
} {
  if (isGitHubSearchAction(input.actionId)) {
    return {
      actionInput: withGitHubSearchDefaults(input.input),
      fileSegment: null,
    };
  }
  if (input.actionId !== "github.get_file_contents") {
    return { actionInput: input.input, fileSegment: null };
  }
  const { expectedFileSha, maxUtf16CodeUnits, offsetUtf16, ...actionInput } =
    input.input;
  const resolvedOffsetUtf16 =
    typeof offsetUtf16 === "number" &&
    Number.isSafeInteger(offsetUtf16) &&
    offsetUtf16 >= 0
      ? offsetUtf16
      : 0;
  const resolvedExpectedFileSha =
    typeof expectedFileSha === "string" && expectedFileSha.trim().length > 0
      ? expectedFileSha.trim()
      : null;
  if (resolvedOffsetUtf16 > 0 && !resolvedExpectedFileSha) {
    throw new Error(
      "Continue a GitHub file read with contentSegment.fileSha as expectedFileSha. If the original SHA is unavailable, restart at offsetUtf16 0."
    );
  }
  return {
    actionInput,
    fileSegment: {
      expectedFileSha: resolvedExpectedFileSha,
      maxUtf16CodeUnits:
        typeof maxUtf16CodeUnits === "number" &&
        Number.isSafeInteger(maxUtf16CodeUnits) &&
        maxUtf16CodeUnits > 0
          ? Math.min(
              maxUtf16CodeUnits,
              GITHUB_FILE_SEGMENT_MAX_UTF16_CODE_UNITS
            )
          : GITHUB_FILE_SEGMENT_DEFAULT_UTF16_CODE_UNITS,
      offsetUtf16: resolvedOffsetUtf16,
    },
  };
}

function isGitHubSearchAction(
  actionId: GitHubActionId
): actionId is
  | "github.search_commits"
  | "github.search_issues_and_pull_requests" {
  return (
    actionId === "github.search_commits" ||
    actionId === "github.search_issues_and_pull_requests"
  );
}

function withGitHubSearchDefaults(
  input: Record<string, unknown>
): Record<string, unknown> {
  if (isPositiveInteger(input.perPage)) {
    return input;
  }
  return { ...input, perPage: GITHUB_SEARCH_DEFAULT_PER_PAGE };
}

function projectGitHubActionResult(input: {
  actionId: GitHubActionId;
  actionInput: Record<string, unknown>;
  attribution: Record<string, unknown>;
  data: unknown;
}): unknown {
  if (input.actionId === "github.search_commits") {
    return projectGitHubCommitSearchResult({
      actionInput: input.actionInput,
      attribution: input.attribution,
      data: input.data,
    });
  }
  if (input.actionId === "github.search_issues_and_pull_requests") {
    return projectGitHubIssueSearchResult({
      actionInput: input.actionInput,
      attribution: input.attribution,
      data: input.data,
    });
  }
  return input.data;
}

function projectGitHubCommitSearchResult(input: {
  actionInput: Record<string, unknown>;
  attribution: Record<string, unknown>;
  data: unknown;
}): unknown {
  const source = asRecord(input.data);
  const items = readSearchItems(input.data).map(projectGitHubCommitSearchItem);
  const page = resolveGitHubSearchPage(input.actionInput);
  const perPage = resolveGitHubSearchPerPage(input.actionInput);
  const totalCount =
    readNumber(source?.total_count ?? source?.totalCount) ?? items.length;
  return fitGitHubSearchSummaryWithinLimit({
    attribution: input.attribution,
    summary: {
      total_count: totalCount,
      incomplete_results:
        readBoolean(source?.incomplete_results ?? source?.incompleteResults) ??
        false,
      page,
      perPage,
      hasMore: hasGitHubSearchMoreResults({
        itemCount: items.length,
        page,
        perPage,
        totalCount,
      }),
      items,
    },
  });
}

function projectGitHubIssueSearchResult(input: {
  actionInput: Record<string, unknown>;
  attribution: Record<string, unknown>;
  data: unknown;
}): unknown {
  const source = asRecord(input.data);
  const items = readSearchItems(input.data).map(projectGitHubIssueSearchItem);
  const page = resolveGitHubSearchPage(input.actionInput);
  const perPage = resolveGitHubSearchPerPage(input.actionInput);
  const totalCount =
    readNumber(source?.total_count ?? source?.totalCount) ?? items.length;
  return fitGitHubSearchSummaryWithinLimit({
    attribution: input.attribution,
    summary: {
      total_count: totalCount,
      page,
      perPage,
      hasMore: hasGitHubSearchMoreResults({
        itemCount: items.length,
        page,
        perPage,
        totalCount,
      }),
      items,
    },
  });
}

function readSearchItems(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.flatMap((item) => {
      const record = asRecord(item);
      return record ? [record] : [];
    });
  }
  const source = asRecord(data);
  return Array.isArray(source?.items)
    ? source.items.flatMap((item) => {
        const record = asRecord(item);
        return record ? [record] : [];
      })
    : [];
}

function projectGitHubCommitSearchItem(
  item: Record<string, unknown>
): Record<string, unknown> {
  const commit = asRecord(item.commit);
  const author = buildGitHubCommitPersonSummary({
    commitPerson: asRecord(commit?.author),
    profile: asRecord(item.author),
  });
  const committer = buildGitHubCommitPersonSummary({
    commitPerson: asRecord(commit?.committer),
    profile: asRecord(item.committer),
  });
  return {
    sha: readString(item.sha) ?? "",
    html_url: readString(item.html_url) ?? "",
    repository: {
      full_name:
        readString(asRecord(item.repository)?.full_name) ??
        readRepositoryFullNameFromUrl(readString(item.repository_url)) ??
        "",
    },
    ...(author ? { author } : {}),
    ...(committer ? { committer } : {}),
    message_headline: truncateGitHubSearchText(
      readGitHubCommitMessageHeadline(readString(commit?.message))
    ),
  };
}

function projectGitHubIssueSearchItem(
  item: Record<string, unknown>
): Record<string, unknown> {
  const pullRequest = asRecord(item.pull_request);
  const mergedAt = readString(pullRequest?.merged_at);
  return {
    number: readNumber(item.number) ?? 0,
    title: truncateGitHubSearchText(readString(item.title) ?? ""),
    state: readString(item.state) ?? "",
    html_url: readString(item.html_url) ?? "",
    repository: {
      full_name:
        readString(asRecord(item.repository)?.full_name) ??
        readRepositoryFullNameFromUrl(readString(item.repository_url)) ??
        "",
    },
    user: {
      login: readString(asRecord(item.user)?.login) ?? "",
    },
    labels: Array.isArray(item.labels)
      ? item.labels.flatMap((label) => {
          const name = readString(asRecord(label)?.name);
          return name ? [{ name }] : [];
        })
      : [],
    created_at: readString(item.created_at) ?? "",
    updated_at: readString(item.updated_at) ?? "",
    ...(readString(item.closed_at)
      ? { closed_at: readString(item.closed_at) }
      : {}),
    type: pullRequest ? "pr" : "issue",
    ...(pullRequest
      ? {
          pull_request: {
            merged: readBoolean(pullRequest.merged) ?? Boolean(mergedAt),
            ...(mergedAt ? { merged_at: mergedAt } : {}),
          },
        }
      : {}),
  };
}

function fitGitHubSearchSummaryWithinLimit<
  Summary extends {
    hasMore: boolean;
    items: Record<string, unknown>[];
    page: number;
    perPage: number;
  },
>(input: {
  attribution: Record<string, unknown>;
  summary: Summary;
}):
  | Summary
  | (Summary & {
      partial: true;
      suggestedNextPage: { page: number; perPage: number };
      suggestedRetry: { page: number; perPage: number };
    }) {
  if (
    isProjectedGitHubSearchSummaryWithinLimit(input.summary, input.attribution)
  ) {
    return input.summary;
  }

  for (
    let itemCount = input.summary.items.length - 1;
    itemCount >= 0;
    itemCount -= 1
  ) {
    const suggestedPerPage = Math.max(itemCount, 1);
    const candidate = {
      ...input.summary,
      hasMore: true,
      items: input.summary.items.slice(0, itemCount),
      partial: true as const,
      suggestedNextPage: {
        page: resolvePartialGitHubSearchNextPage({
          originalPage: input.summary.page,
          originalPerPage: input.summary.perPage,
          returnedItemCount: suggestedPerPage,
        }),
        perPage: suggestedPerPage,
      },
      suggestedRetry: {
        page: input.summary.page,
        perPage: suggestedPerPage,
      },
    };
    if (
      isProjectedGitHubSearchSummaryWithinLimit(candidate, input.attribution)
    ) {
      return candidate;
    }
  }

  throw new RemoteAgentToolResultTooLargeError(
    "github_search_result_projection"
  );
}

function isProjectedGitHubSearchSummaryWithinLimit(
  summary: unknown,
  attribution: Record<string, unknown>
): boolean {
  return isRemoteAgentToolResultWithinLimit({
    attribution,
    data: summary,
    status: "completed",
  });
}

function buildGitHubCommitPersonSummary(input: {
  commitPerson: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
}): { date: string; login: string } | null {
  const login =
    readString(input.profile?.login) ?? readString(input.commitPerson?.name);
  const date = readString(input.commitPerson?.date);
  return login && date ? { login, date } : null;
}

function readGitHubCommitMessageHeadline(message: string | null): string {
  return (
    message?.split(GITHUB_COMMIT_MESSAGE_LINE_BREAK_PATTERN)[0]?.trim() ?? ""
  );
}

function truncateGitHubSearchText(value: string): string {
  if (value.length <= GITHUB_SEARCH_TEXT_FIELD_MAX_LENGTH) {
    return value;
  }
  const endOffset = moveOffsetBeforeSplitSurrogatePair(
    value,
    GITHUB_SEARCH_TEXT_FIELD_MAX_LENGTH -
      GITHUB_SEARCH_TEXT_TRUNCATION_SUFFIX.length
  );
  return `${value.slice(0, endOffset)}${GITHUB_SEARCH_TEXT_TRUNCATION_SUFFIX}`;
}

function resolvePartialGitHubSearchNextPage(input: {
  originalPage: number;
  originalPerPage: number;
  returnedItemCount: number;
}): number {
  if (input.returnedItemCount <= 0) {
    return input.originalPage + 1;
  }
  const nextOffset =
    (input.originalPage - 1) * input.originalPerPage + input.returnedItemCount;
  return Math.floor(nextOffset / input.returnedItemCount) + 1;
}

function hasGitHubSearchMoreResults(input: {
  itemCount: number;
  page: number;
  perPage: number;
  totalCount: number;
}): boolean {
  return (
    input.page * input.perPage < input.totalCount ||
    input.itemCount > input.perPage
  );
}

function resolveGitHubSearchPage(input: Record<string, unknown>): number {
  return isPositiveInteger(input.page) ? input.page : 1;
}

function resolveGitHubSearchPerPage(input: Record<string, unknown>): number {
  return isPositiveInteger(input.perPage)
    ? input.perPage
    : GITHUB_SEARCH_DEFAULT_PER_PAGE;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRepositoryFullNameFromUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }
  const [, path] = url.split("/repos/");
  if (!path) {
    return null;
  }
  const [owner, repo] = path.split("/");
  return owner && repo ? `${owner}/${repo}` : null;
}

function segmentGitHubFileContents(
  data: unknown,
  request: GitHubFileSegmentRequest,
  attribution: Record<string, unknown>
): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("GitHub returned invalid file content metadata.");
  }
  const fileData = data as Record<string, unknown>;
  const decodedContent = fileData.decoded_content;
  if (typeof decodedContent !== "string") {
    throw new Error(
      "GitHub did not return decoded text content for this file. The file may be binary; use its metadata or another content-aware tool instead."
    );
  }
  const fileShaValue = fileData.sha;
  const fileSha =
    typeof fileShaValue === "string" && fileShaValue.trim().length > 0
      ? fileShaValue.trim()
      : null;
  if (request.expectedFileSha && fileSha !== request.expectedFileSha) {
    throw new Error(
      "The GitHub file changed between segments. Restart the read at offsetUtf16 0 and use the new contentSegment.fileSha for later segments."
    );
  }
  const requestedStartOffsetUtf16 = Math.min(
    request.offsetUtf16,
    decodedContent.length
  );
  const startOffsetUtf16 = moveOffsetBeforeSplitSurrogatePair(
    decodedContent,
    requestedStartOffsetUtf16
  );
  const rawRequestedEndOffsetUtf16Exclusive = Math.min(
    startOffsetUtf16 + request.maxUtf16CodeUnits,
    decodedContent.length
  );
  const requestedEndOffsetUtf16Exclusive = moveOffsetAfterSplitSurrogatePair(
    decodedContent,
    rawRequestedEndOffsetUtf16Exclusive
  );
  const segmentedData: Record<string, unknown> = {};
  for (const key of GITHUB_FILE_SEGMENT_METADATA_KEYS) {
    if (fileData[key] !== undefined) {
      segmentedData[key] = fileData[key];
    }
  }
  const buildSegment = (endOffsetUtf16Exclusive: number) => {
    const hasMore = endOffsetUtf16Exclusive < decodedContent.length;
    if (hasMore && !fileSha) {
      throw new Error(
        "GitHub did not return a stable file SHA for this segmented read. Retry with a commit SHA ref or use a narrower GitHub search."
      );
    }
    return {
      ...segmentedData,
      contentSegment: {
        endOffsetUtf16Exclusive,
        fileSha,
        hasMore,
        nextOffsetUtf16: hasMore ? endOffsetUtf16Exclusive : null,
        startOffsetUtf16,
        totalUtf16CodeUnits: decodedContent.length,
      },
      decoded_content: decodedContent.slice(
        startOffsetUtf16,
        endOffsetUtf16Exclusive
      ),
    };
  };
  const fitsToolResultBoundary = (segment: ReturnType<typeof buildSegment>) =>
    isRemoteAgentToolResultWithinLimit({
      attribution,
      data: segment,
      status: "completed",
    });
  const requestedSegment = buildSegment(requestedEndOffsetUtf16Exclusive);
  if (fitsToolResultBoundary(requestedSegment)) {
    return requestedSegment;
  }
  if (requestedEndOffsetUtf16Exclusive === startOffsetUtf16) {
    throw new RemoteAgentToolResultTooLargeError("github_get_file_contents");
  }

  let lowestCandidateEndOffsetUtf16Exclusive =
    moveOffsetAfterSplitSurrogatePair(decodedContent, startOffsetUtf16 + 1);
  let highestCandidateEndOffsetUtf16Exclusive =
    requestedEndOffsetUtf16Exclusive - 1;
  let largestFittingSegment: ReturnType<typeof buildSegment> | null = null;

  while (
    lowestCandidateEndOffsetUtf16Exclusive <=
    highestCandidateEndOffsetUtf16Exclusive
  ) {
    const middleCandidateEndOffsetUtf16Exclusive = Math.floor(
      (lowestCandidateEndOffsetUtf16Exclusive +
        highestCandidateEndOffsetUtf16Exclusive) /
        2
    );
    const candidateEndOffsetUtf16Exclusive = moveOffsetAfterSplitSurrogatePair(
      decodedContent,
      middleCandidateEndOffsetUtf16Exclusive
    );
    const candidateSegment = buildSegment(candidateEndOffsetUtf16Exclusive);
    if (fitsToolResultBoundary(candidateSegment)) {
      largestFittingSegment = candidateSegment;
      lowestCandidateEndOffsetUtf16Exclusive =
        candidateEndOffsetUtf16Exclusive + 1;
    } else {
      highestCandidateEndOffsetUtf16Exclusive =
        middleCandidateEndOffsetUtf16Exclusive - 1;
    }
  }

  if (!largestFittingSegment) {
    throw new RemoteAgentToolResultTooLargeError("github_get_file_contents");
  }
  return largestFittingSegment;
}

function moveOffsetBeforeSplitSurrogatePair(
  value: string,
  offset: number
): number {
  return offset > 0 &&
    isLowSurrogate(value.charCodeAt(offset)) &&
    isHighSurrogate(value.charCodeAt(offset - 1))
    ? offset - 1
    : offset;
}

function moveOffsetAfterSplitSurrogatePair(
  value: string,
  offset: number
): number {
  return offset < value.length &&
    offset > 0 &&
    isLowSurrogate(value.charCodeAt(offset)) &&
    isHighSurrogate(value.charCodeAt(offset - 1))
    ? offset + 1
    : offset;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd8_00 && codeUnit <= 0xdb_ff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc_00 && codeUnit <= 0xdf_ff;
}

function describeGitHubWriteIdentity(input: {
  ownerDisplayName: string;
  scope: "member" | "shared";
}): string {
  return input.scope === "shared"
    ? `as the OpenMeld GitHub App through Organization access connected by ${input.ownerDisplayName}`
    : `as ${input.ownerDisplayName}`;
}

async function recordGitHubConnectorActionAudit(input: {
  actionId: GitHubActionId;
  coreWorker: RemoteAgentCoreWorkerBinding;
  operationId: string;
  outcome: "attempted" | "completed" | "failed" | "outcome_unknown";
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}): Promise<void> {
  const speakerMember = resolveVerifiedTurnEnvelopeSpeaker(
    input.toolContext.turnEnvelope
  );
  if (!speakerMember) {
    throw new Error(
      "GitHub writes require a verified Organization member attribution."
    );
  }
  await callCoreRpc(
    input.coreWorker,
    "centerAgentRecordConnectorActionAudit",
    {
      actionId: input.actionId,
      context: input.toolContext.context,
      operationId: input.operationId,
      outcome: input.outcome,
      service: "github" as const,
      speakerMember,
    },
    (binding, payload) =>
      binding.centerAgentRecordConnectorActionAudit?.(payload)
  );
}

async function recordGitHubConnectorActionAuditAfterFailure(input: {
  actionId: GitHubActionId;
  coreWorker: RemoteAgentCoreWorkerBinding;
  error: unknown;
  operationId: string;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}): Promise<void> {
  await recordGitHubConnectorActionAuditBestEffort({
    actionId: input.actionId,
    coreWorker: input.coreWorker,
    operationId: input.operationId,
    outcome:
      input.error instanceof OpenConnectorActionError
        ? input.error.outcome
        : "outcome_unknown",
    toolContext: input.toolContext,
  });
}

async function recordGitHubConnectorActionAuditBestEffort(input: {
  actionId: GitHubActionId;
  coreWorker: RemoteAgentCoreWorkerBinding;
  operationId: string;
  outcome: "completed" | "failed" | "outcome_unknown";
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}): Promise<void> {
  try {
    await recordGitHubConnectorActionAudit(input);
  } catch (error) {
    console.error("[remote_agent.connector_action_audit_failed]", {
      actionId: input.actionId,
      auditError: error instanceof Error ? error.message : String(error),
      operationId: input.operationId,
      outcome: input.outcome,
    });
  }
}

async function digestGitHubActionInput(
  input: Record<string, unknown>
): Promise<string> {
  return await digestCanonicalJson(input);
}

async function buildGitHubIssueOperationMarker(input: {
  externalKey: string;
  operationId: string;
}): Promise<string> {
  const digest = await digestGitHubActionInput(input);
  return `<!-- openmeld-issue-operation:${digest.slice(0, 32)} -->`;
}

function requirePayloadString(
  payload: Record<string, unknown>,
  key: string
): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`GitHub issue batch requires ${key}.`);
  }
  return value.trim();
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function requireGitHubIssueBatchItems(value: unknown): Array<{
  body?: string;
  externalKey: string;
  labels?: string[];
  title: string;
}> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("GitHub issue batch requires at least one issue.");
  }
  return value.map((item) => {
    if (!(item && typeof item === "object" && !Array.isArray(item))) {
      throw new TypeError("GitHub issue batch contains an invalid issue.");
    }
    const record = item as Record<string, unknown>;
    return {
      ...(typeof record.body === "string" ? { body: record.body } : {}),
      externalKey: requirePayloadString(record, "externalKey"),
      ...(Array.isArray(record.labels)
        ? { labels: toStringArray(record.labels) }
        : {}),
      title: requirePayloadString(record, "title"),
    };
  });
}

function githubIssueBatchManifestMatches(
  stored: GitHubIssueBatchManifest,
  expected: GitHubIssueBatchManifest
): boolean {
  return (
    stored.v === 1 &&
    stored.operationId === expected.operationId &&
    stored.digest === expected.digest &&
    stored.organizationId === expected.organizationId &&
    stored.connectionName === expected.connectionName &&
    stored.connectionOwnerUserId === expected.connectionOwnerUserId &&
    stored.owner === expected.owner &&
    stored.repo === expected.repo
  );
}

async function findGitHubIssueByOperationMarker(input: {
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  connectionName: string;
  marker: string;
  owner: string;
  repo: string;
}): Promise<unknown | null> {
  const data = await runOpenConnectorAction({
    actionId: "github.search_issues_and_pull_requests",
    baseUrl: input.connectorExecution?.baseUrl ?? "",
    connectionName: input.connectionName,
    fetch: input.connectorExecution?.fetch,
    input: {
      query: `repo:${input.owner}/${input.repo} type:issue ${input.marker}`,
    },
    runtimeToken: input.connectorExecution?.runtimeToken ?? "",
  });
  return findObjectContainingMarker(data, input.marker);
}

function findObjectContainingMarker(
  value: unknown,
  marker: string
): unknown | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findObjectContainingMarker(item, marker);
      if (match) {
        return match;
      }
    }
    return null;
  }
  if (!(value && typeof value === "object")) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.body === "string" && record.body.includes(marker)) {
    return record;
  }
  for (const item of Object.values(record)) {
    const match = findObjectContainingMarker(item, marker);
    if (match) {
      return match;
    }
  }
  return null;
}

function resolveUnavailableGitHubConnectionMessage(input: {
  githubActor: GitHubActor;
  hasNavigationAction: boolean;
}): string {
  const accessName =
    input.githubActor === "organization"
      ? "Organization access"
      : "Your GitHub";
  const action = input.hasNavigationAction
    ? "Use the Open GitHub access action below"
    : "Open Center Agent → Apps → GitHub for this workspace";
  return `${accessName} is not ready. It may be disconnected or authorization may still be pending. ${action}, check ${accessName}, and try again. OpenMeld did not use a different GitHub identity.`;
}

function requireGitHubActor(value: unknown): GitHubActor {
  if (value === "organization" || value === "requester") {
    return value;
  }
  throw new Error(
    "GitHub tools require githubActor to be organization or requester."
  );
}

function requireGitHubWriteOperationId(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("GitHub writes require operationId.");
  }
  const operationId = value.trim();
  if (!operationId || operationId.length > 256) {
    throw new Error(
      "GitHub writes require operationId to contain 1 to 256 characters."
    );
  }
  return operationId;
}

function resolveGitHubTurnRequester(
  turnEnvelope: RemoteAgentTurnEnvelope | undefined
): {
  requesterKind: "interactive" | "routine" | "shared_unattended";
  requesterUserId: string | null;
} {
  if (turnEnvelope?.trigger.source === "member_research") {
    return { requesterKind: "shared_unattended", requesterUserId: null };
  }
  const speaker = resolveVerifiedTurnEnvelopeSpeaker(turnEnvelope);
  if (
    turnEnvelope?.trigger.source === "task_continuation" ||
    turnEnvelope?.trigger.source === "task_watch_continuation"
  ) {
    if (!speaker) {
      throw new Error(
        "Unattended GitHub work requires a verified Organization member context."
      );
    }
    return {
      requesterKind: "shared_unattended",
      requesterUserId: speaker.userId,
    };
  }
  if (
    turnEnvelope?.sender.kind === "routine" &&
    turnEnvelope.trigger.source === "routine"
  ) {
    if (!speaker) {
      throw new Error(
        "GitHub tools require the Routine's verified delegated member context."
      );
    }
    return { requesterKind: "routine", requesterUserId: speaker.userId };
  }
  if (speaker) {
    return { requesterKind: "interactive", requesterUserId: speaker.userId };
  }
  const organizationMemberSpeaker =
    resolveOrganizationMemberTurnEnvelopeSpeaker(turnEnvelope);
  if (organizationMemberSpeaker && "kind" in organizationMemberSpeaker) {
    return { requesterKind: "interactive", requesterUserId: null };
  }
  throw new Error("GitHub tools require a verified Organization member turn.");
}

class OpenConnectorActionError extends Error {
  readonly outcome: "failed" | "outcome_unknown";

  constructor(input: {
    cause?: unknown;
    message: string;
    outcome: "failed" | "outcome_unknown";
  }) {
    super(input.message, { cause: input.cause });
    this.name = "OpenConnectorActionError";
    this.outcome = input.outcome;
  }
}

async function runOpenConnectorAction(input: {
  actionId: GitHubActionId;
  baseUrl: string;
  connectionName: string;
  fetch?: typeof fetch;
  input: Record<string, unknown>;
  runtimeToken: string;
}): Promise<unknown> {
  const runtimeToken = requireConnectorConfiguration(
    input.runtimeToken,
    "OpenConnector runtime token"
  );
  const baseUrl = requireConnectorConfiguration(
    input.baseUrl,
    "OpenConnector base URL"
  ).replace(TRAILING_SLASH_PATTERN, "");
  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(
      `${baseUrl}/v1/actions/${encodeURIComponent(input.actionId)}`,
      {
        body: JSON.stringify({
          connectionName: input.connectionName,
          input: input.input,
        }),
        headers: {
          authorization: `Bearer ${runtimeToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      }
    );
  } catch (error) {
    throw new OpenConnectorActionError({
      cause: error,
      message: `OpenConnector action ${input.actionId} did not return a response: ${error instanceof Error ? error.message : String(error)}`,
      outcome: "outcome_unknown",
    });
  }
  let payload: Awaited<ReturnType<typeof readRuntimeEnvelope>>;
  try {
    payload = await readRuntimeEnvelope(response);
  } catch (error) {
    throw new OpenConnectorActionError({
      cause: error,
      message: `OpenConnector action ${input.actionId} returned an invalid response: ${error instanceof Error ? error.message : String(error)}`,
      outcome: response.status >= 500 ? "outcome_unknown" : "failed",
    });
  }
  if (!response.ok || payload.success !== true) {
    throw new OpenConnectorActionError({
      message: resolveOpenConnectorGitHubActionError({
        actionId: input.actionId,
        errorCode: payload.errorCode,
        message: payload.message,
        status: response.status,
      }),
      outcome: response.status >= 500 ? "outcome_unknown" : "failed",
    });
  }
  return payload.data;
}

function resolveOpenConnectorGitHubActionError(input: {
  actionId: GitHubActionId;
  errorCode?: string;
  message?: string;
  status: number;
}): string {
  const baseMessage = `OpenConnector action ${input.actionId} failed${
    input.errorCode ? ` (${input.errorCode})` : ""
  }: ${input.message ?? `HTTP ${input.status}`}`;

  if (input.errorCode === "action_not_allowed") {
    return `${baseMessage} OpenMeld's connector policy blocked this GitHub action. Reconnecting GitHub will not fix it; the OpenConnector deployment policy must be updated.`;
  }

  if (input.errorCode === "action_blocked") {
    return `${baseMessage} OpenMeld's connector policy intentionally blocks this GitHub action. Reconnecting GitHub will not change that policy.`;
  }

  const normalizedMessage = input.message?.trim().toLowerCase();
  if (
    input.errorCode === "authorization_failed" ||
    (input.errorCode === "invalid_input" && normalizedMessage === "not found")
  ) {
    return `${baseMessage} GitHub could not find or access this resource. It may not exist, or the repository may not be included in the GitHub App installation. Review Center Agent → Apps → GitHub and the installation's repository access.`;
  }

  return baseMessage;
}

async function readRuntimeEnvelope(response: Response): Promise<{
  data?: unknown;
  errorCode?: string;
  message?: string;
  success?: boolean;
}> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("OpenConnector returned an invalid JSON action response.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("OpenConnector returned an invalid action response.");
  }
  const record = payload as Record<string, unknown>;
  return {
    data: record.data,
    errorCode:
      typeof record.errorCode === "string" ? record.errorCode : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    success: typeof record.success === "boolean" ? record.success : undefined,
  };
}

function requireConnectorConfiguration(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is not configured.`);
  }
  return normalized;
}
