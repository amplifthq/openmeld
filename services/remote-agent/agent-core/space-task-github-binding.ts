import {
  createSpaceTaskBodySchema,
  describeLinkedGitHubIssueClosePrompt,
  formatSpaceTaskGitHubIssueLabel,
  listSpaceTasksResponseSchema,
  SPACE_TASK_EXTERNAL_WORK_ITEM_LIMIT_ERROR_CODE,
  SPACE_TASK_LIST_MAX_ITEMS,
  SPACE_TASK_WORKFLOW_CONTRACT_VERSION,
  spaceTaskExternalWorkItemIdentityKey,
  spaceTaskGitHubIssueOperationId,
  spaceTaskMutationReceiptSchema,
  spaceTaskResponseSchema,
  spaceTaskSchema,
} from "@openmeld/schemas";
import type {
  MutateSpaceTaskBody,
  OpenMeldRequestContext,
  RemoteAgentTurnEnvelope,
  SpaceTask,
  SpaceTaskExternalWorkItem,
  SpaceTaskMutationReceipt,
} from "@openmeld/schemas/types";
import { mutateSpaceTaskWithObservationConflictRetry } from "./space-task-observation-retry";

export type GitHubIssueSpaceTaskIdentity = {
  number: number;
  owner: string;
  repo: string;
  url: string;
};
type GitHubWorkItem = Extract<
  SpaceTaskExternalWorkItem,
  { provider: "github" }
>;

export type SpaceTaskGitHubBindingPorts = {
  createSpaceTask?: (input: unknown) => Promise<unknown>;
  getSpaceTask?: (input: unknown) => Promise<unknown>;
  listSpaceTasks?: (input: unknown) => Promise<unknown>;
  mutateSpaceTask?: (input: unknown) => Promise<unknown>;
};

export type SpaceTaskGitHubBindingSummary = {
  created: boolean;
  githubClosePrompt: string | null;
  issueBodyAppendix: string | null;
  closedTaskIds: string[];
  task: SpaceTask | null;
};

export type SpaceTaskGitHubBindingToolResult = {
  closedTaskIds: string[];
  created: boolean;
  githubClosePrompt: string | null;
  issueBodyAppendix: string | null;
  reason?: string;
  code?: string;
  task: SpaceTask | null;
};

export class SpaceTaskGitHubBindingError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string }) {
    super(input.message);
    this.name = "SpaceTaskGitHubBindingError";
    this.code = input.code;
  }
}

const OPENMELD_TASK_BODY_MARKER = "OpenMeld Task:";
const OPENMELD_TASK_BODY_REFERENCE_PATTERN = /OpenMeld Task:\s*tsk_/u;
const TRAILING_SLASH_PATTERN = /\/+$/u;
const POSITIVE_INTEGER_STRING_PATTERN = /^\d+$/u;

export function shouldBindGitHubIssueToSpaceTask(
  space: RemoteAgentTurnEnvelope["space"] | null | undefined
): boolean {
  return space?.kind === "space";
}

export function readGitHubIssueIdentityFromWrite(input: {
  actionInput: Record<string, unknown>;
  data: unknown;
}): GitHubIssueSpaceTaskIdentity | null {
  const owner = readNonEmptyString(input.actionInput.owner);
  const repo = readNonEmptyString(input.actionInput.repo);
  if (!(owner && repo)) {
    return null;
  }
  const record = asRecord(input.data);
  const nested = asRecord(record?.data);
  const number =
    readPositiveInteger(record?.number) ??
    readPositiveInteger(record?.issue_number) ??
    readPositiveInteger(record?.issueNumber) ??
    readPositiveInteger(nested?.number) ??
    readPositiveInteger(input.actionInput.issueNumber);
  if (!number) {
    return null;
  }
  const url =
    readNonEmptyString(record?.html_url) ??
    readNonEmptyString(record?.htmlUrl) ??
    readNonEmptyString(nested?.html_url) ??
    readNonEmptyString(nested?.htmlUrl) ??
    `https://github.com/${owner}/${repo}/issues/${number}`;
  return { number, owner, repo, url };
}

export function findSpaceTaskForGitHubIssue(
  tasks: readonly SpaceTask[],
  identity: Pick<GitHubIssueSpaceTaskIdentity, "number" | "owner" | "repo">
): SpaceTask | null {
  const key = spaceTaskExternalWorkItemIdentityKey({
    ...identity,
    provider: "github",
  });
  return (
    tasks.find((task) =>
      task.externalWorkItems.some(
        (item) => spaceTaskExternalWorkItemIdentityKey(item) === key
      )
    ) ?? null
  );
}

export function toSpaceTaskGitHubBindingToolResult(
  binding: SpaceTaskGitHubBindingSummary
): SpaceTaskGitHubBindingToolResult {
  return {
    closedTaskIds: binding.closedTaskIds,
    created: binding.created,
    githubClosePrompt: binding.githubClosePrompt,
    issueBodyAppendix: binding.issueBodyAppendix,
    task: binding.task,
  };
}

export function toFailedSpaceTaskGitHubBindingToolResult(
  error: unknown
): SpaceTaskGitHubBindingToolResult {
  return {
    closedTaskIds: [],
    created: false,
    githubClosePrompt: null,
    issueBodyAppendix: null,
    reason: error instanceof Error ? error.message : String(error),
    task: null,
    ...(error instanceof SpaceTaskGitHubBindingError
      ? { code: error.code }
      : {}),
  };
}

export function buildOpenMeldTaskIssueBodyAppendix(input: {
  organizationWebUrl?: string;
  spaceId: string;
  taskId: string;
}): string {
  const spaceUrl = buildSpaceUrl(input.organizationWebUrl, input.spaceId);
  return spaceUrl
    ? `${OPENMELD_TASK_BODY_MARKER} ${spaceUrl} (${input.taskId})`
    : `${OPENMELD_TASK_BODY_MARKER} ${input.taskId}`;
}

export function appendOpenMeldTaskReferenceToIssueBody(
  body: string | null | undefined,
  appendix: string
): string | null {
  const current = body?.trim() ?? "";
  if (
    current.includes(appendix) ||
    OPENMELD_TASK_BODY_REFERENCE_PATTERN.test(current)
  ) {
    return null;
  }
  return current.length > 0 ? `${current}\n\n${appendix}` : appendix;
}

export async function applyGitHubIssueSpaceTaskBinding(input: {
  actionId: string;
  actionInput: Record<string, unknown>;
  data: unknown;
  eventIdentity?: string;
  now?: string | (() => Promise<string>);
  ports: SpaceTaskGitHubBindingPorts;
  toolContext: {
    context: OpenMeldRequestContext;
    turnEnvelope: RemoteAgentTurnEnvelope | null | undefined;
  };
}): Promise<SpaceTaskGitHubBindingSummary | null> {
  const space = input.toolContext.turnEnvelope?.space;
  if (!(space && shouldBindGitHubIssueToSpaceTask(space))) {
    return null;
  }
  if (
    !(
      input.ports.listSpaceTasks &&
      input.ports.createSpaceTask &&
      input.ports.mutateSpaceTask &&
      input.ports.getSpaceTask
    )
  ) {
    return null;
  }
  const identity = readGitHubIssueIdentityFromWrite({
    actionInput: input.actionInput,
    data: input.data,
  });
  if (!identity) {
    return null;
  }
  // A stable observation may require storage. Resolve it only for a binding
  // that applies, never for reads, private conversations, or unrelated writes.
  const readObservationAt = async () =>
    typeof input.now === "function"
      ? await input.now()
      : (input.now ?? new Date().toISOString());
  if (input.actionId === "github.create_issue") {
    return await associateCreatedGitHubIssue({
      actionInput: input.actionInput,
      identity,
      now: await readObservationAt(),
      ports: {
        createSpaceTask: input.ports.createSpaceTask,
        getSpaceTask: input.ports.getSpaceTask,
        listSpaceTasks: input.ports.listSpaceTasks,
        mutateSpaceTask: input.ports.mutateSpaceTask,
      },
      space,
      toolContext: input.toolContext,
    });
  }
  if (
    input.actionId === "github.update_issue" &&
    input.actionInput.state === "closed"
  ) {
    if (!input.eventIdentity?.trim()) {
      throw new SpaceTaskGitHubBindingError({
        code: "space_task.github_event_identity_required",
        message:
          "OpenMeld cannot confirm this GitHub issue update's operation identity.",
      });
    }
    return await readClosedGitHubIssueTasks({
      identity,
      ports: {
        listSpaceTasks: input.ports.listSpaceTasks,
      },
      spaceId: space.id,
      toolContext: input.toolContext,
    });
  }
  return null;
}

async function associateCreatedGitHubIssue(input: {
  actionInput: Record<string, unknown>;
  identity: GitHubIssueSpaceTaskIdentity;
  now: string;
  ports: Required<SpaceTaskGitHubBindingPorts>;
  space: RemoteAgentTurnEnvelope["space"];
  toolContext: {
    context: OpenMeldRequestContext;
    turnEnvelope: RemoteAgentTurnEnvelope | null | undefined;
  };
}): Promise<SpaceTaskGitHubBindingSummary> {
  const existing = (
    await listLinkedSpaceTasksForGitHubIssue({
      context: input.toolContext.context,
      identity: input.identity,
      listSpaceTasks: input.ports.listSpaceTasks,
      spaceId: input.space.id,
    })
  )[0];
  const item = buildGitHubWorkItem(input.identity, input.now);
  const task = existing
    ? await ensureGitHubIssueAttached({
        item,
        ports: input.ports,
        spaceId: input.space.id,
        task: existing,
        toolContext: input.toolContext,
      })
    : (
        await createLinkedSpaceTask({
          actionInput: input.actionInput,
          item,
          ports: input.ports,
          spaceId: input.space.id,
          toolContext: input.toolContext,
        })
      ).task;
  return {
    closedTaskIds: [],
    created: !existing,
    githubClosePrompt: null,
    issueBodyAppendix: buildOpenMeldTaskIssueBodyAppendix({
      organizationWebUrl: input.toolContext.turnEnvelope?.organization?.webUrl,
      spaceId: input.space.id,
      taskId: task.taskId,
    }),
    task,
  };
}

async function createLinkedSpaceTask(input: {
  actionInput: Record<string, unknown>;
  item: GitHubWorkItem;
  ports: Required<SpaceTaskGitHubBindingPorts>;
  spaceId: string;
  toolContext: {
    context: OpenMeldRequestContext;
  };
}): Promise<SpaceTaskMutationReceipt> {
  const title =
    readNonEmptyString(input.actionInput.title) ??
    `GitHub issue ${formatSpaceTaskGitHubIssueLabel(input.item)}`;
  const body = createSpaceTaskBodySchema.parse({
    assigneeProfileId: null,
    completionConditions: [
      "The requested outcome is verified and submitted through this Task's workflow.",
    ],
    description: `Linked GitHub issue ${formatSpaceTaskGitHubIssueLabel(input.item)}.`,
    externalWorkItems: [input.item],
    operationId: spaceTaskGitHubIssueOperationId("create", input.item),
    title,
  });
  return spaceTaskMutationReceiptSchema.parse(
    await input.ports.createSpaceTask({
      body,
      context: input.toolContext.context,
      spaceId: input.spaceId,
      taskContractVersion: SPACE_TASK_WORKFLOW_CONTRACT_VERSION,
    })
  );
}

async function ensureGitHubIssueAttached(input: {
  item: GitHubWorkItem;
  ports: Required<SpaceTaskGitHubBindingPorts>;
  spaceId: string;
  task: SpaceTask;
  toolContext: {
    context: OpenMeldRequestContext;
  };
}): Promise<SpaceTask> {
  const alreadyLinked = findSpaceTaskForGitHubIssue([input.task], input.item);
  if (alreadyLinked) {
    return input.task;
  }
  const receipt = await mutateLinkedTask({
    body: {
      action: "attach_external_work_item",
      expectedRevision: input.task.revision,
      item: input.item,
      operationId: spaceTaskGitHubIssueOperationId(
        "attach",
        input.item,
        input.task.taskId
      ),
    },
    ports: input.ports,
    spaceId: input.spaceId,
    taskId: input.task.taskId,
    toolContext: input.toolContext,
  });
  return receipt.task;
}

async function readClosedGitHubIssueTasks(input: {
  identity: GitHubIssueSpaceTaskIdentity;
  ports: Pick<Required<SpaceTaskGitHubBindingPorts>, "listSpaceTasks">;
  spaceId: string;
  toolContext: { context: OpenMeldRequestContext };
}): Promise<SpaceTaskGitHubBindingSummary> {
  // Core owns the provider observation. Task completion remains with the
  // Task workflow; this only reads already completed or canceled Tasks.
  const matching = await listLinkedSpaceTasksForGitHubIssue({
    context: input.toolContext.context,
    identity: input.identity,
    listSpaceTasks: input.ports.listSpaceTasks,
    spaceId: input.spaceId,
  });
  const latest = matching[0] ?? null;
  return {
    closedTaskIds: matching
      .filter((task) => task.phase === "done" || task.phase === "canceled")
      .map((task) => task.taskId),
    created: false,
    githubClosePrompt: latest
      ? describeLinkedGitHubIssueClosePrompt(latest)
      : null,
    issueBodyAppendix: null,
    task: latest,
  };
}

async function mutateLinkedTask(input: {
  body: MutateSpaceTaskBody;
  ports: Pick<
    Required<SpaceTaskGitHubBindingPorts>,
    "getSpaceTask" | "mutateSpaceTask"
  >;
  spaceId: string;
  taskId: string;
  toolContext: {
    context: OpenMeldRequestContext;
  };
}): Promise<SpaceTaskMutationReceipt> {
  return await mutateSpaceTaskWithObservationConflictRetry({
    mutate: (mutation) =>
      input.ports.mutateSpaceTask({
        body: mutation,
        context: input.toolContext.context,
        spaceId: input.spaceId,
        taskId: input.taskId,
        taskContractVersion: SPACE_TASK_WORKFLOW_CONTRACT_VERSION,
      }),
    readCurrentRevision: async () =>
      spaceTaskSchema.parse(
        spaceTaskResponseSchema.parse(
          await input.ports.getSpaceTask({
            context: input.toolContext.context,
            spaceId: input.spaceId,
            taskId: input.taskId,
            taskContractVersion: SPACE_TASK_WORKFLOW_CONTRACT_VERSION,
          })
        ).task
      ).revision,
    request: input.body,
  });
}

async function listLinkedSpaceTasksForGitHubIssue(input: {
  context: OpenMeldRequestContext;
  identity: GitHubIssueSpaceTaskIdentity;
  listSpaceTasks: NonNullable<SpaceTaskGitHubBindingPorts["listSpaceTasks"]>;
  spaceId: string;
}): Promise<SpaceTask[]> {
  const listed = listSpaceTasksResponseSchema.parse(
    await input.listSpaceTasks({
      context: input.context,
      spaceId: input.spaceId,
      taskContractVersion: SPACE_TASK_WORKFLOW_CONTRACT_VERSION,
    })
  );
  const matching = listed.tasks.filter(
    (task) => findSpaceTaskForGitHubIssue([task], input.identity) !== null
  );
  if (matching.length > 0) {
    return matching;
  }
  if (listed.truncated) {
    throw new SpaceTaskGitHubBindingError({
      code: SPACE_TASK_EXTERNAL_WORK_ITEM_LIMIT_ERROR_CODE,
      message: `This Space has more than ${SPACE_TASK_LIST_MAX_ITEMS} Tasks, so OpenMeld cannot confirm whether GitHub issue ${formatSpaceTaskGitHubIssueLabel(input.identity)} already has a linked Task.`,
    });
  }
  return [];
}

function buildGitHubWorkItem(
  identity: GitHubIssueSpaceTaskIdentity,
  now: string
): GitHubWorkItem {
  return {
    lastObservedAt: now,
    lastObservedState: "open",
    number: identity.number,
    owner: identity.owner,
    provider: "github",
    repo: identity.repo,
    url: identity.url,
  };
}

function buildSpaceUrl(
  organizationWebUrl: string | undefined,
  spaceId: string
): string | null {
  if (!organizationWebUrl) {
    return null;
  }
  return `${organizationWebUrl.replace(TRAILING_SLASH_PATTERN, "")}/spaces/${encodeURIComponent(spaceId)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (
    typeof value === "string" &&
    POSITIVE_INTEGER_STRING_PATTERN.test(value.trim())
  ) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : null;
  }
  return null;
}
