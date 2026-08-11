import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpApp } from "../app";

function isRuntimeEvidenceEvent(
  value: unknown,
  event: string
): value is { event: string; requestId?: unknown } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { event?: unknown }).event === event
  );
}

describe("createHttpApp error responses", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never exposes internal error detail in the client response", async () => {
    const app = createHttpApp();

    app.get("/__test/error", () => {
      throw new Error("sensitive stack detail");
    });

    const response = await app.request(
      "http://localhost/__test/error",
      undefined,
      {
        CORS_ORIGINS: "https://gateway.openmeld.invalid",
      }
    );

    expect(response.status).toBe(500);

    const payload = await response.json();
    expect(payload).toEqual({
      ok: false,
      code: "core.internal_error",
      message: "Internal server error",
      requestId: expect.any(String),
    });
    expect(payload).not.toHaveProperty("detail");
  });

  it("records the forwarded request id in Cloudflare runtime evidence", async () => {
    // Successful http_request evidence is analytics-only by logging policy;
    // only failed requests reach the console. A thrown handler emits evidence
    // before the error response exists, so the request id comes from the
    // gateway-forwarded x-openmeld-request-id header.
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createHttpApp();

    app.get("/__test/evidence-error", () => {
      throw new Error("evidence path");
    });

    const forwardedRequestId = "req-evidence-1";
    const response = await app.request(
      "http://localhost/__test/evidence-error",
      {
        headers: {
          "x-openmeld-request-id": forwardedRequestId,
        },
      },
      {
        OPENMELD_WORKER_ENVIRONMENT: "local",
        CORS_ORIGINS: "https://gateway.openmeld.invalid",
      }
    );

    expect(response.status).toBe(500);
    expect(
      infoSpy.mock.calls.some(
        ([entry]) =>
          isRuntimeEvidenceEvent(entry, "core.openmeld.http_request") &&
          entry.requestId === forwardedRequestId
      )
    ).toBe(true);
  });
});
