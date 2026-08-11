import { forgetComputerRouteParamsSchema } from "@openmeld/schemas";
import type { ForgetComputerRouteParams } from "@openmeld/schemas/types";

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseDeviceRouteParams(
  deviceId: unknown
): ParseResult<ForgetComputerRouteParams> {
  const parsed = forgetComputerRouteParamsSchema.safeParse({ deviceId });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid deviceId",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}
