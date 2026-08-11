import { createCoreRpcHttpError } from "../rpc/errors";

export function parseProjectPayload<T>(
  schema: {
    safeParse(value: unknown): { data: T; success: true } | { success: false };
  },
  value: unknown
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Project request is invalid.",
      status: 400,
    });
  }
  return parsed.data;
}

export function parseProjectResponse<T>(
  schema: {
    safeParse(value: unknown): { data: T; success: true } | { success: false };
  },
  value: unknown
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Failed to build a valid Project response.");
  }
  return parsed.data;
}
