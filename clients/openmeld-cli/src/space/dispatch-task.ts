import {
  createSpaceTaskBodySchema,
  mutateSpaceTaskBodySchema,
  spaceTaskIdSchema,
} from "@openmeld/schemas";
import type {
  CreateSpaceTaskBody,
  MutateSpaceTaskBody,
  SpaceTaskPhase,
} from "@openmeld/schemas/types";
import { resolveBaseUrl } from "../config/base-url";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { requireOpenMeldProfile } from "../config/resolve-openmeld-profile";
import {
  DISPATCH_OWNED_RUNTIME_MODE,
  OPENMELD_DISPATCH_RUNTIME_MODE_ENV,
} from "../runtime/dispatch-runtime-env";
import {
  type DispatchSpaceActionContext,
  readDispatchSpaceActionContextFromEnv,
} from "../runtime/dispatch-space-action-context";
import { createCliSpaceApi } from "./cli-space-api";

type DispatchTaskOperationContext = {
  actionContext: DispatchSpaceActionContext;
  api: ReturnType<typeof createCliSpaceApi>;
  requestContext: ReturnType<typeof buildOpenMeldRequestContextFromProfile>;
};
type WithoutTaskOperationId<T> = T extends unknown
  ? Omit<T, "operationId">
  : never;

export async function listDispatchSpaceTasks(phase?: SpaceTaskPhase) {
  return await withDispatchTaskContext(
    async ({ actionContext, api, requestContext }) =>
      await api.listTasks({
        spaceId: actionContext.spaceId,
        requestContext,
        ...(phase ? { phase } : {}),
      })
  );
}

export async function createDispatchSpaceTask(
  body: Omit<
    CreateSpaceTaskBody,
    "assigneeProfileId" | "operationId" | "sourceSignalId" | "threadId"
  > & { assigneeProfileId?: string | null }
) {
  return await withDispatchTaskContext(
    async ({ actionContext, api, requestContext }) =>
      await api.createTask({
        spaceId: actionContext.spaceId,
        requestContext,
        body: createSpaceTaskBodySchema.parse({
          ...body,
          operationId: crypto.randomUUID(),
          sourceSignalId: actionContext.sourceEventId,
          assigneeProfileId:
            body.assigneeProfileId === undefined
              ? actionContext.targetProfileId
              : body.assigneeProfileId,
        }),
      })
  );
}

export async function mutateDispatchSpaceTask(input: {
  taskId: string;
  body: WithoutTaskOperationId<MutateSpaceTaskBody>;
}) {
  const taskId = spaceTaskIdSchema.parse(input.taskId);
  const body = mutateSpaceTaskBodySchema.parse({
    ...input.body,
    operationId: crypto.randomUUID(),
  });
  return await withDispatchTaskContext(
    async ({ actionContext, api, requestContext }) =>
      await api.mutateTask({
        spaceId: actionContext.spaceId,
        requestContext,
        taskId,
        body,
      })
  );
}

async function withDispatchTaskContext<T>(
  operation: (context: DispatchTaskOperationContext) => Promise<T>
): Promise<T> {
  if (
    process.env[OPENMELD_DISPATCH_RUNTIME_MODE_ENV] !==
    DISPATCH_OWNED_RUNTIME_MODE
  ) {
    throw new Error(
      "Space Task tools require an active OpenMeld dispatch runtime."
    );
  }
  const actionContext = readDispatchSpaceActionContextFromEnv();
  const profile = await requireOpenMeldProfile({
    openMeldProfileId: actionContext.targetProfileId,
    persistSelection: false,
    authAction: "working with Tasks in the current OpenMeld Space",
  });
  if (
    profile.openMeldProfileId !== actionContext.targetProfileId ||
    profile.profileKind !== "agent"
  ) {
    throw new Error("The Space Task actor does not match the current Agent.");
  }
  const result = await operation({
    actionContext,
    api: createCliSpaceApi(await resolveBaseUrl()),
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: profile,
    }),
  });
  const current = readDispatchSpaceActionContextFromEnv();
  if (
    current.contextId !== actionContext.contextId ||
    current.nonce !== actionContext.nonce ||
    current.spaceId !== actionContext.spaceId ||
    current.sourceEventId !== actionContext.sourceEventId ||
    current.targetProfileId !== actionContext.targetProfileId
  ) {
    throw new Error(
      "The dispatch context changed during the Space Task action."
    );
  }
  return result;
}
