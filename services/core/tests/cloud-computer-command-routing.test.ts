import { cloudComputerOperationSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { resolvePersonalComputerOperation } from "../src/computer/computer-rpc";

describe("personal Computer command routing", () => {
  it("preserves the existing local CLI namespace without a receipt reference", () => {
    expect(
      resolvePersonalComputerOperation(
        cloudComputerOperationSchema.parse({
          action: "command",
          invocationId: "terminal-key",
          command: { action: "poll", key: "build" },
        })
      )
    ).toMatchObject({ invocationId: "local:terminal-key" });
  });

  it.each([
    "remote-submission",
    "local:terminal-key",
  ])("queries the exact receipt namespace %s", (invocationId) => {
    const operation = cloudComputerOperationSchema.parse({
      action: "command",
      invocationId,
      command: {
        action: "poll",
        key: "build",
        reference: {
          invocationId,
          key: "build",
          id: "native-command-id",
          backend: "container",
        },
      },
    });
    expect(resolvePersonalComputerOperation(operation)).toEqual(operation);
  });

  it.each([
    { invocationId: "other-submission" },
    { key: "other-key" },
  ])("rejects contradictory receipt addressing %j", (changed) => {
    const operation = cloudComputerOperationSchema.parse({
      action: "command",
      invocationId: "remote-submission",
      command: {
        action: "poll",
        key: "build",
        reference: {
          invocationId: "remote-submission",
          key: "build",
          id: "native-command-id",
          backend: "container",
          ...changed,
        },
      },
    });
    expect(() => resolvePersonalComputerOperation(operation)).toThrow(
      expect.objectContaining({
        code: "computer.command_reference_mismatch",
        cause: {
          status: 400,
          code: "computer.command_reference_mismatch",
          message: expect.any(String),
        },
      })
    );
  });
});
