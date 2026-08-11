import { getSpaceStatusResponseSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  GatewayHttpError,
  parseGatewayErrorResponse,
  readGatewayJsonResponse,
  toStructuredGatewayFailure,
} from "../src/space/gateway-response";

describe("gateway response helpers", () => {
  it("parses canonical gateway error envelopes", () => {
    const error = parseGatewayErrorResponse({
      response: new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "space.not_found",
            message: "Space not found.",
            requestId: "req-gateway-404",
            upstreamCode: "controller.binding.lookup_failed",
          },
        }),
        {
          status: 404,
          headers: {
            "content-type": "application/json",
            "x-openmeld-request-id": "req-gateway-404",
          },
        }
      ),
      raw: JSON.stringify({
        ok: false,
        error: {
          code: "space.not_found",
          message: "Space not found.",
          requestId: "req-gateway-404",
          upstreamCode: "controller.binding.lookup_failed",
        },
      }),
    });

    expect(error).toBeInstanceOf(GatewayHttpError);
    expect(error).toMatchObject({
      code: "space.not_found",
      requestId: "req-gateway-404",
      status: 404,
      message: "Space not found.",
      upstreamCode: "controller.binding.lookup_failed",
    });
  });

  it("falls back to header requestId when the body is not a canonical gateway error", () => {
    const error = parseGatewayErrorResponse({
      response: new Response("upstream exploded", {
        status: 502,
        headers: {
          "x-openmeld-request-id": "req-header-only",
        },
      }),
      raw: "upstream exploded",
    });

    expect(error).toMatchObject({
      code: "gateway.http_error",
      requestId: "req-header-only",
      status: 502,
      message: "upstream exploded",
    });
  });

  it("throws GatewayHttpError from readGatewayJsonResponse on gateway failures", async () => {
    const response = new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "space.not_found",
          message: "Space not found.",
          requestId: "req-read-json",
          upstreamCode: "controller.binding.lookup_failed",
        },
      }),
      {
        status: 404,
        headers: {
          "content-type": "application/json",
          "x-openmeld-request-id": "req-read-json",
        },
      }
    );

    await expect(
      readGatewayJsonResponse({
        response,
        schema: getSpaceStatusResponseSchema,
        invalidMessage: "invalid space status response",
      })
    ).rejects.toMatchObject({
      code: "space.not_found",
      requestId: "req-read-json",
      status: 404,
      message: "Space not found.",
      upstreamCode: "controller.binding.lookup_failed",
    });
  });

  it("projects GatewayHttpError into a structured failure surface", () => {
    const failure = toStructuredGatewayFailure(
      new GatewayHttpError({
        code: "space.not_found",
        message: "Space not found.",
        requestId: "req-surface",
        status: 404,
        rawBody: '{"ok":false}',
        upstreamCode: "controller.binding.lookup_failed",
      })
    );

    expect(failure).toEqual({
      code: "space.not_found",
      message: "Space not found.",
      requestId: "req-surface",
      status: 404,
      upstreamCode: "controller.binding.lookup_failed",
    });
  });

  it("keeps only a clean message for non-gateway failures", () => {
    const failure = toStructuredGatewayFailure(new Error("join notice down"));

    expect(failure).toEqual({
      code: null,
      message: "join notice down",
      requestId: null,
      status: null,
      upstreamCode: null,
    });
  });

  it("preserves generic network failure codes for non-gateway failures", () => {
    const failure = toStructuredGatewayFailure(
      Object.assign(
        new Error(
          "space.status.read request could not reach http://localhost:8080 (fetch failed)"
        ),
        {
          code: "network.request_failed",
        }
      )
    );

    expect(failure).toEqual({
      code: "network.request_failed",
      message:
        "space.status.read request could not reach http://localhost:8080 (fetch failed)",
      requestId: null,
      status: null,
      upstreamCode: null,
    });
  });

  it("preserves unknown generic failure codes for non-gateway failures", () => {
    const failure = toStructuredGatewayFailure(
      Object.assign(new Error("join notice down"), {
        code: "unknown.code",
      })
    );

    expect(failure).toEqual({
      code: "unknown.code",
      message: "join notice down",
      requestId: null,
      status: null,
      upstreamCode: null,
    });
  });

  it("drops blank generic failure codes for non-gateway failures", () => {
    const failure = toStructuredGatewayFailure(
      Object.assign(new Error("join notice down"), {
        code: "   ",
      })
    );

    expect(failure).toEqual({
      code: null,
      message: "join notice down",
      requestId: null,
      status: null,
      upstreamCode: null,
    });
  });
});
