import { describe, expect, it } from "vitest";
import { parseHttpFailure } from "../src/space/http-failure";

describe("parseHttpFailure", () => {
  it("parses HTTP failure messages with valid status codes", () => {
    expect(
      parseHttpFailure(new Error('HTTP 404: {"code":"not_found"}'))
    ).toEqual({
      status: 404,
      body: '{"code":"not_found"}',
      code: "not_found",
      message: "",
      upstreamCode: null,
    });
  });

  it("preserves upstreamCode from canonical gateway envelopes", () => {
    expect(
      parseHttpFailure(
        new Error(
          'HTTP 503: {"ok":false,"error":{"code":"upstream_error","message":"binding lookup failed","requestId":"req-test","upstreamCode":"controller.binding.lookup_failed"}}'
        )
      )
    ).toEqual({
      status: 503,
      body: '{"ok":false,"error":{"code":"upstream_error","message":"binding lookup failed","requestId":"req-test","upstreamCode":"controller.binding.lookup_failed"}}',
      code: "upstream_error",
      message: "binding lookup failed",
      upstreamCode: "controller.binding.lookup_failed",
    });
  });

  it("rejects status codes outside the valid HTTP range", () => {
    expect(parseHttpFailure(new Error("HTTP 000: invalid"))).toBeNull();
    expect(parseHttpFailure(new Error("HTTP 099: invalid"))).toBeNull();
    expect(parseHttpFailure(new Error("HTTP 600: invalid"))).toBeNull();
    expect(parseHttpFailure(new Error("HTTP 999: invalid"))).toBeNull();
  });

  it("returns null when the error does not match the HTTP failure shape", () => {
    expect(parseHttpFailure(new Error("network offline"))).toBeNull();
  });
});
