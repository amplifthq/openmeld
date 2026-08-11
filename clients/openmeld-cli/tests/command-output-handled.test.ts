import { describe, expect, it } from "vitest";
import {
  isSpaceCommandOutputHandledError,
  SpaceCommandOutputHandledError,
} from "../src/space/command-output-handled";

describe("space command output handled error", () => {
  it("accepts the concrete error instance", () => {
    expect(
      isSpaceCommandOutputHandledError(
        new SpaceCommandOutputHandledError("already rendered", {
          shouldPrintMessage: false,
        })
      )
    ).toBe(true);
  });

  it("accepts a plain object with the full handled-error shape", () => {
    expect(
      isSpaceCommandOutputHandledError({
        code: "openmeld.space.output_handled",
        message: "already rendered",
        shouldPrintMessage: true,
      })
    ).toBe(true);
  });

  it("rejects plain objects that only carry the handled code", () => {
    expect(
      isSpaceCommandOutputHandledError({
        code: "openmeld.space.output_handled",
      })
    ).toBe(false);
    expect(
      isSpaceCommandOutputHandledError({
        code: "openmeld.space.output_handled",
        message: "already rendered",
      })
    ).toBe(false);
    expect(
      isSpaceCommandOutputHandledError({
        code: "openmeld.space.output_handled",
        shouldPrintMessage: true,
      })
    ).toBe(false);
  });

  it("rejects unrelated errors", () => {
    expect(isSpaceCommandOutputHandledError(new Error("boom"))).toBe(false);
    expect(
      isSpaceCommandOutputHandledError({
        code: "cli.error",
        message: "boom",
        shouldPrintMessage: true,
      })
    ).toBe(false);
  });
});
