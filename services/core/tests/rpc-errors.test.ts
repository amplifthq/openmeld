import { describe, expect, it } from "vitest";
import {
  createCoreRpcHttpError,
  createCoreRpcStructuredError,
  isRpcReceiverMethodNotImplementedError,
  readCoreRpcHttpStatus,
  toHttpStyleRpcErrorMessage,
} from "../src/rpc/errors";

describe("rpc error helpers", () => {
  it("builds structured error payload", () => {
    expect(createCoreRpcStructuredError(404, "not found")).toEqual({
      status: 404,
      message: "not found",
    });
  });

  it("formats structured error to HTTP-style message", () => {
    const message = toHttpStyleRpcErrorMessage({
      status: 400,
      message: "invalid payload",
    });
    expect(message).toBe("HTTP 400: invalid payload");
  });

  it("creates HTTP errors with structured cause", () => {
    const error = createCoreRpcHttpError({
      status: 404,
    }) as Error & { cause?: unknown; status?: unknown; code?: unknown };
    expect(error.message).toBe("HTTP 404");
    expect(error.status).toBe(404);
    expect(error.code).toBeUndefined();
    expect(error.cause).toEqual({
      status: 404,
      message: "upstream_http_404",
    });
  });

  it("keeps optional error code in structured cause", () => {
    const error = createCoreRpcHttpError({
      status: 401,
      reason: "authentication required",
      code: "auth.unauthenticated",
    }) as Error & { cause?: unknown; status?: unknown; code?: unknown };
    expect(error.status).toBe(401);
    expect(error.code).toBe("auth.unauthenticated");
    expect(error.message).toBe(
      'HTTP 401: {"ok":false,"error":{"code":"auth.unauthenticated","message":"authentication required"}}'
    );
    expect(error.cause).toEqual({
      status: 401,
      code: "auth.unauthenticated",
      message: "authentication required",
    });
  });

  it("recovers HTTP status across Worker RPC error serialization shapes", () => {
    expect(readCoreRpcHttpStatus({ status: 422 })).toBe(422);
    expect(
      readCoreRpcHttpStatus({
        cause: {
          cause: { status: 403 },
        },
      })
    ).toBe(403);
    expect(
      readCoreRpcHttpStatus(
        new Error('HTTP 400: {"ok":false,"error":{"message":"invalid input"}}')
      )
    ).toBe(400);
    expect(
      readCoreRpcHttpStatus(new Error("transport unavailable"))
    ).toBeNull();
  });

  it("recognizes only the Cloudflare receiver method-not-implemented Error", () => {
    expect(
      isRpcReceiverMethodNotImplementedError(
        new Error("The RPC receiver does not implement the method")
      )
    ).toBe(true);
    expect(
      isRpcReceiverMethodNotImplementedError(
        new Error("The Auth RPC request failed")
      )
    ).toBe(false);
    expect(
      isRpcReceiverMethodNotImplementedError(
        "The RPC receiver does not implement the method"
      )
    ).toBe(false);
  });
});
