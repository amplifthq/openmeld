import { gatewayErrorEnvelopeSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  jsonErrorResponse,
  OPENMELD_HEADER_REQUEST_ID,
  readUpstreamErrorMessage,
  wsErrorFrame,
} from "../src";

describe("gateway-contract errors", () => {
  it("builds a unified json error response", async () => {
    const response = jsonErrorResponse({
      status: 400,
      code: "bad_request",
      message: "invalid input",
      requestId: "req-abc",
      upstreamCode: "controller.binding.lookup_failed",
    });

    expect(response.status).toBe(400);
    expect(response.headers.get(OPENMELD_HEADER_REQUEST_ID)).toBe("req-abc");

    const body = (await response.json()) as {
      ok: boolean;
      error?: {
        code?: string;
        message?: string;
        requestId?: string;
        upstreamCode?: string;
      };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("bad_request");
    expect(body.error?.message).toBe("invalid input");
    expect(body.error?.requestId).toBe("req-abc");
    expect(body.error?.upstreamCode).toBe("controller.binding.lookup_failed");
    expect(gatewayErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  });

  it("builds ws error frame", () => {
    const raw = wsErrorFrame({
      code: "hello_required",
      message: "first frame must be hello",
      requestId: "req-ws",
    });
    const body = JSON.parse(raw) as {
      type?: string;
      error?: { code?: string; requestId?: string };
    };
    expect(body.type).toBe("system.error");
    expect(body.error?.code).toBe("hello_required");
    expect(body.error?.requestId).toBe("req-ws");
    expect(
      gatewayErrorEnvelopeSchema.safeParse({
        ok: false,
        error: body.error,
      }).success
    ).toBe(true);
  });

  it("reads upstream error text", async () => {
    const response = new Response("upstream failed", { status: 502 });
    await expect(readUpstreamErrorMessage(response)).resolves.toBe(
      "upstream failed"
    );
  });

  it("reads upstream error detail from json body", async () => {
    const response = new Response(JSON.stringify({ detail: "invalid input" }), {
      headers: { "content-type": "application/json" },
      status: 400,
    });
    await expect(readUpstreamErrorMessage(response)).resolves.toBe(
      "invalid input"
    );
  });

  it("reads upstream error string field from json body", async () => {
    const response = new Response(
      JSON.stringify({ error: "something wrong" }),
      {
        headers: { "content-type": "application/json" },
        status: 500,
      }
    );
    await expect(readUpstreamErrorMessage(response)).resolves.toBe(
      "something wrong"
    );
  });

  it("falls back to raw json text when message fields are absent", async () => {
    const body = JSON.stringify({ reason: "blocked" });
    const response = new Response(body, {
      headers: { "content-type": "application/json" },
      status: 403,
    });
    await expect(readUpstreamErrorMessage(response)).resolves.toBe(body);
  });
});
