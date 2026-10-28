import { centerAgentWorkTargetResponseSchema } from "@openmeld/schemas";
import type {
  CenterAgentWorkTargetRequest,
  CenterAgentWorkTargetResponse,
  RemoteAgentTurnEnvelope,
} from "@openmeld/schemas/types";
import {
  array,
  integer,
  literal,
  maxLength,
  minLength,
  minValue,
  number,
  optional,
  pipe,
  strictObject,
  string,
  trim,
  variant,
} from "valibot";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import { callCoreRpc } from "../agent-core/core-rpc";
import { buildRemoteAgentToolContext } from "../agent-core/tool-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";

type Dependencies = {
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  submissionId: string;
};
const GITHUB_TOOL_PREFIX = /^github_/u;
const GITHUB_QUERY_REPOSITORY =
  /(?:^|\s)repo:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?=\s|$)/giu;
const GITHUB_QUERY_REPOSITORY_TOKEN = /(?:^|\s)-?repo:/giu;
const GITHUB_QUERY_QUOTED_TEXT = /"(?:\\.|[^"\\])*"/gu;
const UNSUPPORTED_QUERY_SCOPE = /(?:^|\s)(?:OR|NOT)(?=\s|$)|[()]/iu;
const GITHUB_FULL_REPOSITORY = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u;
const GITHUB_SEARCH_ACTIONS = new Set([
  "github.search_code",
  "github.search_commits",
  "github.search_issues_and_pull_requests",
]);
const GITHUB_ISSUE_CREATION_ACTIONS = new Set([
  "github.create_issue",
  "github.create_issue_batch",
]);
const GITHUB_REFERENCE_ACTIONS = new Set([
  "github.get_repository",
  "github.get_issue",
  "github.update_issue",
  "github.list_repository_issues",
  "github.list_issue_comments",
  "github.create_issue_comment",
  "github.add_issue_labels",
  "github.remove_issue_label",
  "github.add_issue_assignees",
  "github.remove_issue_assignees",
  "github.list_repository_labels",
]);

export function supportsCenterAgentWorkTarget(input: {
  personalAgent?: boolean;
  replyRecovery?: boolean;
  turnEnvelope?: RemoteAgentTurnEnvelope | null;
}) {
  const envelope = input.turnEnvelope;
  return (
    !(input.personalAgent || input.replyRecovery) &&
    Boolean(envelope) &&
    !(envelope?.sender.kind === "member" && !envelope.sender.verified) &&
    !(
      envelope?.trigger.source === "task_continuation" &&
      envelope.trigger.summaryOnly
    ) &&
    [
      "space_wake",
      "web_dm",
      "task_continuation",
      "task_watch_continuation",
    ].includes(envelope?.trigger.source ?? "")
  );
}

export async function readCenterAgentWorkTargetFacts(input: {
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  context: RemoteAgentCallbackContext | null;
  personalAgent: boolean;
}) {
  if (
    !(
      input.context &&
      supportsCenterAgentWorkTarget({
        turnEnvelope: input.context.turnEnvelope,
        replyRecovery: Boolean(input.context.replyRecovery),
        personalAgent: input.personalAgent,
      })
    )
  ) {
    return "";
  }
  const current = await readCenterAgentWorkTarget({
    ...input,
    submissionId: input.context.submissionId,
  });
  return `\nCurrent Space-owned work target (context data): ${JSON.stringify(current)}`;
}

export async function requireCenterAgentCodeTarget(
  input: Omit<Dependencies, "submissionId"> & {
    context: RemoteAgentCallbackContext;
  },
  repository: { owner: string; repo: string }
) {
  if (
    !supportsCenterAgentWorkTarget({
      turnEnvelope: input.context.turnEnvelope,
      replyRecovery: Boolean(input.context.replyRecovery),
      personalAgent:
        input.context.conversationIdentity?.kind === "personal_agent",
    })
  ) {
    return;
  }
  const current = await readCenterAgentWorkTarget({
    ...input,
    submissionId: input.context.submissionId,
  });
  const failure = checkWorkTargetDestination(current, {
    ...repository,
    kind: "code",
    provider: "github",
  });
  if (failure) {
    throw new Error(failure);
  }
}
const identifier = pipe(string(), trim(), minLength(1), maxLength(100));
const repository = { owner: identifier, repo: identifier };
const selectionInput = strictObject({
  expectedRevision: pipe(number(), integer(), minValue(0)),
  choice: variant("kind", [
    strictObject({ kind: literal("inherit") }),
    strictObject({
      kind: literal("select"),
      target: strictObject({
        requestGoal: pipe(string(), trim(), minLength(1), maxLength(2000)),
        codeRepositories: pipe(array(strictObject(repository)), maxLength(8)),
        issueDestinations: pipe(
          array(
            variant("provider", [
              strictObject({ provider: literal("github"), ...repository }),
              strictObject({
                provider: literal("linear"),
                teamId: identifier,
                projectId: optional(identifier),
              }),
            ])
          ),
          maxLength(8)
        ),
      }),
    }),
  ]),
});

export async function readCenterAgentWorkTarget(
  input: Dependencies,
  selection?: CenterAgentWorkTargetRequest["selection"]
) {
  const { context } = await buildRemoteAgentToolContext({
    ...input,
    toolName: "openmeld_work_target",
  });
  return centerAgentWorkTargetResponseSchema.parse(
    await callCoreRpc(
      input.coreWorker,
      "centerAgentWorkTarget",
      { context, ...(selection ? { selection } : {}) },
      (binding, request) => binding.centerAgentWorkTarget?.(request)
    )
  );
}

export function createCenterAgentWorkTargetTools(
  input: Dependencies
): RemoteAgentToolDefinition[] {
  return [
    {
      name: "openmeld_read_work_target",
      description:
        "Read the durable goal, code repository, separate issue destination, revision and Human source for this exact Task or request conversation. It survives context compaction and runtime rollover. This context constraint grants no permissions.",
      input: strictObject({}),
      execute: async () => await readCenterAgentWorkTarget(input),
    },
    {
      name: "openmeld_select_work_target",
      description:
        "Bind this Human request to its goal and destinations before repository work. Use inherit for a continuation that keeps the current goal and targets; use select for a new request or an explicit target correction, keeping code repository separate from issue destination. Use the revision returned by openmeld_read_work_target. Core fixes the Task/conversation and Human source; this choice cannot be changed again from the same message. No additional Human approval is requested.",
      input: selectionInput,
      execute: async (payload) =>
        await readCenterAgentWorkTarget(
          input,
          payload as NonNullable<CenterAgentWorkTargetRequest["selection"]>
        ),
    },
  ];
}

/** Both direct tools and Code Mode pass through this catalog boundary. Exact
 * approved-action replay executes the original owner's frozen raw definition. */
export function guardCenterAgentWorkTarget(
  definition: RemoteAgentToolDefinition,
  input: Dependencies
): RemoteAgentToolDefinition {
  return {
    ...definition,
    execute: async (payload, options) => {
      const destination = resolveWorkTargetDestination(
        definition.name,
        payload
      );
      if (destination) {
        const current = await readCenterAgentWorkTarget(input);
        const failure = checkWorkTargetDestination(current, destination);
        if (failure) {
          return {
            status: "blocked_before_execution",
            reasonCode: failure,
            currentWorkTarget: current,
            sideEffects: 0,
          };
        }
      }
      return await definition.execute(payload, options);
    },
  };
}

type Destination =
  | {
      kind: "code" | "issue" | "reference";
      provider: "github";
      owner: string;
      repo: string;
    }
  | { kind: "issue"; provider: "linear"; teamId: string; projectId?: string }
  | { kind: "unscoped_query" };

export function checkWorkTargetDestination(
  current: CenterAgentWorkTargetResponse,
  destination: Destination
): string | null {
  if (!current.record || current.selectionRequired) {
    return "center_agent.work_target.selection_required";
  }
  if (destination.kind === "unscoped_query") {
    return "center_agent.work_target.query_scope_required";
  }
  if (
    destination.kind === "reference" &&
    destination.provider === "github" &&
    current.record.target.codeRepositories.some((repository) =>
      sameRepository(repository, destination)
    )
  ) {
    return null;
  }
  if (destination.kind === "code" && destination.provider === "github") {
    return current.record.target.codeRepositories.some((repository) =>
      sameRepository(repository, destination)
    )
      ? null
      : "center_agent.work_target.destination_mismatch";
  }
  const matches = current.record.target.issueDestinations.some((selected) =>
    destination.provider === "github"
      ? selected?.provider === "github" && sameRepository(selected, destination)
      : selected?.provider === "linear" &&
        selected.teamId === destination.teamId &&
        selected.projectId === destination.projectId
  );
  return matches ? null : "center_agent.work_target.destination_mismatch";
}

function sameRepository(
  a: { owner: string; repo: string },
  b: { owner: string; repo: string }
) {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

export function resolveWorkTargetDestination(
  name: string,
  payload: Record<string, unknown>
): Destination | null {
  const dynamic =
    name === "github_execute_action" || name === "openmeld_execute_app_action";
  const args =
    dynamic &&
    payload.input &&
    typeof payload.input === "object" &&
    !Array.isArray(payload.input)
      ? (payload.input as Record<string, unknown>)
      : payload;
  const action = dynamic
    ? String(payload.actionId ?? "")
    : name.replace(GITHUB_TOOL_PREFIX, "github.");
  if (GITHUB_SEARCH_ACTIONS.has(action)) {
    return resolveGitHubQueryDestination(action, args);
  }
  if (
    action === "linear.create_linear_issue" &&
    typeof args.teamId === "string"
  ) {
    return {
      kind: "issue",
      provider: "linear",
      teamId: args.teamId,
      ...(typeof args.projectId === "string"
        ? { projectId: args.projectId }
        : {}),
    };
  }
  if (
    !action.startsWith("github.") ||
    typeof args.owner !== "string" ||
    typeof args.repo !== "string"
  ) {
    return null;
  }
  return {
    kind: githubDestinationKind(action),
    provider: "github",
    owner: args.owner,
    repo: args.repo,
  };
}

function githubDestinationKind(action: string) {
  if (GITHUB_ISSUE_CREATION_ACTIONS.has(action)) {
    return "issue" as const;
  }
  return GITHUB_REFERENCE_ACTIONS.has(action)
    ? ("reference" as const)
    : ("code" as const);
}

/** Parse provider search scope, never the user's task text. Ambiguous/global
 * queries stay blocked; the Agent can use one explicit repo per search. */
function resolveGitHubQueryDestination(
  action: string,
  args: Record<string, unknown>
): Destination {
  const queryValue = args.q ?? args.query;
  const query = typeof queryValue === "string" ? queryValue : "";
  const fullName =
    typeof args.repo === "string"
      ? GITHUB_FULL_REPOSITORY.exec(args.repo)
      : null;
  let declared: { owner: string; repo: string } | null = null;
  if (fullName?.[1] && fullName[2]) {
    declared = { owner: fullName[1], repo: fullName[2] };
  }
  if (typeof args.owner === "string" && typeof args.repo === "string") {
    declared = { owner: args.owner, repo: args.repo };
  }
  const scopeQuery = query.replace(GITHUB_QUERY_QUOTED_TEXT, " ");
  const scopes = [...scopeQuery.matchAll(GITHUB_QUERY_REPOSITORY)];
  const tokens = [...scopeQuery.matchAll(GITHUB_QUERY_REPOSITORY_TOKEN)];
  if (
    (typeof args.q === "string" &&
      typeof args.query === "string" &&
      args.q !== args.query) ||
    scopeQuery.includes('"') ||
    UNSUPPORTED_QUERY_SCOPE.test(scopeQuery) ||
    tokens.length > 1 ||
    tokens.length !== scopes.length
  ) {
    return { kind: "unscoped_query" };
  }
  const scope = scopes[0];
  const repository =
    scope?.[1] && scope[2] ? { owner: scope[1], repo: scope[2] } : declared;
  if (
    !repository ||
    (scope && declared && !sameRepository(repository, declared))
  ) {
    return { kind: "unscoped_query" };
  }
  return {
    ...repository,
    provider: "github",
    kind:
      action === "github.search_issues_and_pull_requests"
        ? "reference"
        : "code",
  };
}
