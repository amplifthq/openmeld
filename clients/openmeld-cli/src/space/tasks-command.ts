import {
  createSpaceTaskBodySchema,
  mutateSpaceTaskBodySchema,
  spaceTaskIdSchema,
  spaceTaskPhaseSchema,
} from "@openmeld/schemas";
import type {
  MutateSpaceTaskBody,
  OpenMeldRequestContext,
  SpaceTaskPhase,
} from "@openmeld/schemas/types";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { outLine } from "../ui/io";
import { createCliSpaceApi, type SpaceApi } from "./cli-space-api";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import {
  formatSpaceTaskDetailOutput,
  formatSpaceTaskListOutput,
  formatSpaceTaskReceiptOutput,
} from "./tasks-output";

type SpaceTasksCommandInput = {
  profile?: string;
  baseUrl?: string;
  space: string;
  password?: string;
  json: boolean;
  view?: string;
  entryChecksHandled?: boolean;
};

/**
 * One Task change a person or Agent can make from the CLI. The revision is
 * optional: without it the command reads the Task first and changes exactly
 * the revision it read. Review always names both revisions, because a review
 * decision is only valid for the result the reviewer actually read.
 */
export type SpaceTaskChange =
  | { action: "start"; expectedRevision?: number }
  | { action: "submit"; expectedRevision?: number; summary: string }
  | {
      action: "review";
      expectedRevision: number;
      expectedResultRevision: number;
      decision: "accepted" | "changes_requested";
      feedback?: string;
    }
  | { action: "cancel"; expectedRevision?: number; reason: string }
  | { action: "reopen"; expectedRevision?: number; reason: string };

type SpaceTasksSession = {
  api: SpaceApi;
  requestContext: OpenMeldRequestContext;
};

export function parseSpaceTaskPhaseOption(
  value: string | undefined
): SpaceTaskPhase | undefined {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/gu, "_");
  if (normalized.length === 0) {
    return;
  }
  const parsed = spaceTaskPhaseSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(
      `Unknown Task phase "${value}". Use one of: ${spaceTaskPhaseSchema.options.join(", ")}.`
    );
  }
  return parsed.data;
}

export function parseSpaceTaskRevisionOption(
  value: string | undefined,
  label: string
): number | undefined {
  if (value === undefined || String(value).trim().length === 0) {
    return;
  }
  const parsed = Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return parsed;
}

/** Builds the canonical Task mutation body for one CLI change. */
export function buildSpaceTaskMutationBody(input: {
  change: SpaceTaskChange;
  expectedRevision: number;
  operationId: string;
}): MutateSpaceTaskBody {
  const base = {
    operationId: input.operationId,
    expectedRevision: input.expectedRevision,
  };
  const { change } = input;
  switch (change.action) {
    case "start":
      return mutateSpaceTaskBodySchema.parse({
        ...base,
        action: "mark_in_progress",
      });
    case "submit":
      return mutateSpaceTaskBodySchema.parse({
        ...base,
        action: "submit_result",
        summary: change.summary,
      });
    case "review":
      if (change.decision === "changes_requested" && !change.feedback?.trim()) {
        throw new Error("Requesting changes needs --feedback.");
      }
      return mutateSpaceTaskBodySchema.parse({
        ...base,
        action: "review",
        expectedResultRevision: change.expectedResultRevision,
        decision: change.decision,
        ...(change.feedback?.trim() ? { feedback: change.feedback } : {}),
      });
    case "cancel":
      return mutateSpaceTaskBodySchema.parse({
        ...base,
        action: "cancel",
        reason: change.reason,
      });
    case "reopen":
      return mutateSpaceTaskBodySchema.parse({
        ...base,
        action: "reopen",
        reason: change.reason,
      });
    default: {
      const exhaustive: never = change;
      throw new Error(`Unsupported Task change: ${String(exhaustive)}`);
    }
  }
}

export async function runSpaceTasksList(
  input: SpaceTasksCommandInput & { phase?: SpaceTaskPhase }
): Promise<void> {
  const session = await prepareSpaceTasksSession(input, "reading Space Tasks");
  if (!session) {
    return;
  }
  const response = await session.api.listTasks({
    spaceId: input.space,
    requestContext: session.requestContext,
    spacePassword: input.password,
    ...(input.phase ? { phase: input.phase } : {}),
  });
  outLine(formatSpaceTaskListOutput(response, { json: input.json }));
}

export async function runSpaceTaskShow(
  input: SpaceTasksCommandInput & { taskId: string }
): Promise<void> {
  const taskId = parseTaskId(input.taskId);
  const session = await prepareSpaceTasksSession(input, "reading a Space Task");
  if (!session) {
    return;
  }
  const response = await session.api.getTask({
    spaceId: input.space,
    requestContext: session.requestContext,
    spacePassword: input.password,
    taskId,
    includeAffordances: true,
  });
  outLine(formatSpaceTaskDetailOutput(response, { json: input.json }));
}

export async function runSpaceTaskCreate(
  input: SpaceTasksCommandInput & {
    title: string;
    description?: string;
    completionConditions?: string[];
    assigneeProfileId?: string;
    reviewerProfileId?: string;
  }
): Promise<void> {
  const body = createSpaceTaskBodySchema.parse({
    operationId: crypto.randomUUID(),
    title: input.title,
    ...(input.description?.trim() ? { description: input.description } : {}),
    ...(input.completionConditions && input.completionConditions.length > 0
      ? { completionConditions: input.completionConditions }
      : {}),
    ...(input.assigneeProfileId
      ? { assigneeProfileId: input.assigneeProfileId }
      : {}),
    ...(input.reviewerProfileId
      ? { reviewerProfileId: input.reviewerProfileId }
      : {}),
  });
  const session = await prepareSpaceTasksSession(
    input,
    "creating a Space Task"
  );
  if (!session) {
    return;
  }
  const receipt = await session.api.createTask({
    spaceId: input.space,
    requestContext: session.requestContext,
    spacePassword: input.password,
    body,
  });
  outLine(formatSpaceTaskReceiptOutput(receipt, { json: input.json }));
}

export async function runSpaceTaskChange(
  input: SpaceTasksCommandInput & { taskId: string; change: SpaceTaskChange }
): Promise<void> {
  const taskId = parseTaskId(input.taskId);
  const session = await prepareSpaceTasksSession(
    input,
    "changing a Space Task"
  );
  if (!session) {
    return;
  }
  const expectedRevision =
    input.change.expectedRevision ??
    (
      await session.api.getTask({
        spaceId: input.space,
        requestContext: session.requestContext,
        spacePassword: input.password,
        taskId,
      })
    ).task.revision;
  const receipt = await session.api.mutateTask({
    spaceId: input.space,
    requestContext: session.requestContext,
    spacePassword: input.password,
    taskId,
    body: buildSpaceTaskMutationBody({
      change: input.change,
      expectedRevision,
      operationId: crypto.randomUUID(),
    }),
  });
  outLine(formatSpaceTaskReceiptOutput(receipt, { json: input.json }));
}

function parseTaskId(value: string): string {
  const parsed = spaceTaskIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "Task ID must look like tsk_<uuid>. Run `openmeld space tasks <space-id-or-url>` to list Task IDs."
    );
  }
  return parsed.data;
}

async function prepareSpaceTasksSession(
  input: SpaceTasksCommandInput,
  authAction: string
): Promise<SpaceTasksSession | null> {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(authAction),
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return null;
  }
  const { runtime, interactive, baseUrl } = context;
  assertValidSpaceIdTarget({
    space: input.space,
    resolvedView: runtime.resolvedView,
  });
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  return {
    api: createCliSpaceApi(baseUrl),
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile,
    }),
  };
}
