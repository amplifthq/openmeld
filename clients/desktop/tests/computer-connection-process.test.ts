import { describe, expect, it } from "vitest";
import { runConnectionSetup } from "../src/main/computer-connection";

describe("computer setup process outcome", () => {
  it.each([
    { code: 0, event: "setup.complete", succeeds: true },
    { code: 1, event: "setup.complete", succeeds: false },
    { code: 0, event: "setup.started", succeeds: false },
  ])("requires successful exit and completion evidence: $code / $event", async ({
    code,
    event,
    succeeds,
  }) => {
    const result = runConnectionSetup(
      process.execPath,
      [
        "-e",
        `console.log(JSON.stringify({code:${JSON.stringify(event)}}));process.exit(${code});`,
      ],
      { ...process.env, OPENMELD_HOME: "/unused-disposable-process-test" }
    );
    if (succeeds) {
      await expect(result).resolves.toBeUndefined();
    } else {
      await expect(result).rejects.toThrow("could not finish connecting");
    }
  });
});
