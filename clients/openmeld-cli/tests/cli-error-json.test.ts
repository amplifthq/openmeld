import { describe, expect, it } from "vitest";
import {
  buildCliErrorJsonEnvelope,
  emitCliErrorJson,
} from "../src/runtime/cli-error-json";
import { withCapturedStdio } from "./helpers/fs";

describe("cli error json envelope", () => {
  it("builds a canonical error envelope", () => {
    expect(
      buildCliErrorJsonEnvelope({ code: "cli.error", message: "boom" })
    ).toEqual({
      schemaVersion: 1,
      type: "error",
      error: { code: "cli.error", message: "boom" },
    });
  });

  it("includes requestId only when present", () => {
    expect(
      buildCliErrorJsonEnvelope({
        code: "gateway.invalid_response",
        message: "bad response",
        requestId: "req_123",
      }).error.requestId
    ).toBe("req_123");
    expect(
      buildCliErrorJsonEnvelope({
        code: "cli.error",
        message: "boom",
        requestId: null,
      })
    ).not.toHaveProperty("error.requestId");
  });

  it("keeps the legacy strict v1 error wire shape", () => {
    const envelope = buildCliErrorJsonEnvelope({
      code: "gateway.invalid_response",
      message:
        "invalid Routine list response. Diagnostic evidence: HTTP status 200; schema issue routines.0.status: Invalid option.",
      requestId: "req_123",
    });

    expect(envelope).toEqual({
      schemaVersion: 1,
      type: "error",
      error: {
        code: "gateway.invalid_response",
        message:
          "invalid Routine list response. Diagnostic evidence: HTTP status 200; schema issue routines.0.status: Invalid option.",
        requestId: "req_123",
      },
    });
    expect(Object.keys(envelope.error)).toEqual([
      "code",
      "message",
      "requestId",
    ]);
  });

  it("emits exactly one canonical JSON line", async () => {
    const { stdout } = await withCapturedStdio(() =>
      Promise.resolve(emitCliErrorJson({ code: "cli.error", message: "boom" }))
    );
    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      schemaVersion: 1,
      type: "error",
      error: { code: "cli.error", message: "boom" },
    });
  });
});
