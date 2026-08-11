import { describe, expect, it } from "vitest";
import { resolveSpacePasswordPromptReason } from "../src/space/password-flow";

describe("space password flow", () => {
  it("recognizes password required errors from explicit space password codes", () => {
    expect(
      resolveSpacePasswordPromptReason(
        new Error(
          'HTTP 401: {"ok":false,"error":{"code":"space.password_required","message":"space password required"}}'
        )
      )
    ).toBe("required");
  });

  it("recognizes password invalid errors from explicit space password codes", () => {
    expect(
      resolveSpacePasswordPromptReason(
        new Error(
          'HTTP 403: {"ok":false,"error":{"code":"space.password_invalid","message":"space password invalid"}}'
        )
      )
    ).toBe("invalid");
  });

  it("recognizes wrapped upstream password-required hints without relying on bare status codes", () => {
    expect(
      resolveSpacePasswordPromptReason(
        new Error(
          'HTTP 502: {"ok":false,"error":{"code":"upstream_error","message":"HTTP 401: space password required"}}'
        )
      )
    ).toBe("required");
  });

  it("does not misclassify generic unauthenticated responses as space password prompts", () => {
    expect(
      resolveSpacePasswordPromptReason(
        new Error(
          'HTTP 401: {"ok":false,"error":{"code":"auth.unauthenticated","message":"authentication required"}}'
        )
      )
    ).toBeNull();
  });

  it("does not misclassify generic forbidden responses as space password prompts", () => {
    expect(
      resolveSpacePasswordPromptReason(
        new Error(
          'HTTP 403: {"ok":false,"error":{"code":"space.forbidden","message":"forbidden"}}'
        )
      )
    ).toBeNull();
  });

  it("does not retry invalid space payloads as password prompts", () => {
    expect(
      resolveSpacePasswordPromptReason(
        new Error(
          "fetchSpaceMeta received invalid response payload from https://gateway.openmeld.invalid/v1/spaces/demo/meta: invalid JSON; raw={not-json"
        )
      )
    ).toBeNull();
  });
});
