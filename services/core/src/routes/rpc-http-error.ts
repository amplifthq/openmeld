import type { Context } from "hono";
import type {
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from "hono/utils/http-status";
import type { HonoBindings } from "../lib/bindings";
import { readCoreRpcHttpStatus } from "../rpc/errors";
import { parseRpcErrorPayload } from "../shared/rpc/rpc-json";

type ErrorStatusCode = ClientErrorStatusCode | ServerErrorStatusCode;

export function mapRpcHttpError(
  c: Context<HonoBindings>,
  error: unknown
): Response {
  const structured = (error as { cause?: unknown }).cause as
    | { code?: unknown; message?: unknown; status?: unknown }
    | undefined;
  const errorMessage = error instanceof Error ? error.message : "";
  const jsonStart = errorMessage.indexOf("{");
  const transported =
    jsonStart >= 0 ? parseRpcErrorPayload(errorMessage.slice(jsonStart)) : null;
  const status =
    typeof structured?.status === "number"
      ? structured.status
      : (readCoreRpcHttpStatus(error) ?? 500);
  const message =
    typeof structured?.message === "string"
      ? structured.message
      : (transported?.message ?? "Request failed.");
  let code = status >= 500 ? "internal_error" : "request_failed";
  if (typeof structured?.code === "string") {
    code = structured.code;
  } else if (transported?.code) {
    code = transported.code;
  }
  return c.json(
    {
      error: {
        code,
        message,
      },
    },
    status as ErrorStatusCode
  );
}
