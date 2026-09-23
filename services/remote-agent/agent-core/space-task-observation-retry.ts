import {
  SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
  spaceTaskMutationReceiptSchema,
  spaceTaskResponseSchema,
} from "@openmeld/schemas";
import type {
  MutateSpaceTaskBody,
  SpaceTaskMutationReceipt,
} from "@openmeld/schemas/types";

const HTTP_STYLE_RPC_ERROR_PATTERN = /^HTTP\s+(\d{3}):\s*(\{[\s\S]*\})\s*$/u;

export function isSpaceTaskRevisionConflictError(error: unknown): boolean {
  const parsed = readStructuredRpcError(error);
  return (
    parsed?.code === SPACE_TASK_REVISION_CONFLICT_ERROR_CODE ||
    parsed?.upstreamCode === SPACE_TASK_REVISION_CONFLICT_ERROR_CODE
  );
}

/** Only provider observation may rebase after a Task revision conflict. */
export async function mutateSpaceTaskWithObservationConflictRetry(input: {
  mutate: (body: MutateSpaceTaskBody) => Promise<unknown>;
  readCurrentRevision: () => Promise<number>;
  request: MutateSpaceTaskBody;
}): Promise<SpaceTaskMutationReceipt> {
  try {
    return spaceTaskMutationReceiptSchema.parse(
      await input.mutate(input.request)
    );
  } catch (error) {
    if (
      input.request.action !== "observe_external_work_item" ||
      !isSpaceTaskRevisionConflictError(error)
    ) {
      throw error;
    }
    const currentRevision = await input.readCurrentRevision();
    return spaceTaskMutationReceiptSchema.parse(
      await input.mutate({
        ...input.request,
        expectedRevision: currentRevision,
        operationId: crypto.randomUUID(),
      })
    );
  }
}

export function readSpaceTaskRevision(response: unknown): number {
  return spaceTaskResponseSchema.parse(response).task.revision;
}

function readStructuredRpcError(error: unknown): {
  code: string;
  message: string;
  status: number;
  upstreamCode: string | null;
} | null {
  if (!(error instanceof Error)) {
    return null;
  }
  return (
    readStructuredErrorValue(error.cause) ?? parseHttpStyleError(error.message)
  );
}

function readStructuredErrorValue(value: unknown): {
  code: string;
  message: string;
  status: number;
  upstreamCode: string | null;
} | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const code = Reflect.get(value, "code");
  const message = Reflect.get(value, "message");
  const status = Reflect.get(value, "status");
  if (
    typeof code !== "string" ||
    typeof message !== "string" ||
    typeof status !== "number" ||
    status < 400 ||
    status > 599
  ) {
    return null;
  }
  return {
    code,
    message,
    status,
    upstreamCode: readOptionalUpstreamCode(value),
  };
}

function parseHttpStyleError(message: string): {
  code: string;
  message: string;
  status: number;
  upstreamCode: string | null;
} | null {
  const match = HTTP_STYLE_RPC_ERROR_PATTERN.exec(message);
  if (!match) {
    return null;
  }
  const status = Number(match[1]);
  if (status < 400 || status > 599) {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(match[2] ?? "");
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const nested = Reflect.get(payload, "error");
  const source = nested && typeof nested === "object" ? nested : payload;
  const code = Reflect.get(source, "code");
  const errorMessage = Reflect.get(source, "message");
  if (typeof code !== "string" || typeof errorMessage !== "string") {
    return null;
  }
  return {
    code,
    message: errorMessage,
    status,
    upstreamCode: readOptionalUpstreamCode(source),
  };
}

function readOptionalUpstreamCode(value: object): string | null {
  const upstreamCode = Reflect.get(value, "upstreamCode");
  return typeof upstreamCode === "string" && upstreamCode.length > 0
    ? upstreamCode
    : null;
}
