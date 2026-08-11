import { createCoreRpcHttpError } from "../rpc/errors";

export function parseRoutinePayload<T>(
  schema: {
    safeParse(value: unknown): { data: T; success: true } | { success: false };
  },
  value: unknown
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Routine request is invalid.",
      code: "invalid_payload",
    });
  }
  return parsed.data;
}

export function parseRoutineResponse<T>(
  schema: {
    safeParse(value: unknown): { data: T; success: true } | { success: false };
  },
  value: unknown
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Failed to build a valid Routine response.");
  }
  return parsed.data;
}
