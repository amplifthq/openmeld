import type { Context } from "hono";
import type {
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from "hono/utils/http-status";
import type { HonoBindings } from "../lib/bindings";

type ErrorStatusCode = ClientErrorStatusCode | ServerErrorStatusCode;

export function mapRpcHttpError(
  c: Context<HonoBindings>,
  error: unknown
): Response {
  const structured = (error as { cause?: unknown }).cause as
    | { code?: unknown; message?: unknown; status?: unknown }
    | undefined;
  const status =
    typeof structured?.status === "number" ? structured.status : 500;
  const message =
    typeof structured?.message === "string"
      ? structured.message
      : "Request failed.";
  let code = status >= 500 ? "internal_error" : "request_failed";
  if (typeof structured?.code === "string") {
    code = structured.code;
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
