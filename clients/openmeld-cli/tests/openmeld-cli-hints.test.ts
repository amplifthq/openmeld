import { describe, expect, it } from "vitest";
import { emitHelpfulHints } from "../src/openmeld-cli-hints";
import { withCapturedStdio } from "./helpers/fs";

const UNRELATED_SPACE_WRITE_HINT_RE = /space (create|join|watch)/u;

describe("OpenMeld CLI hints", () => {
  it("keeps an invalid Space read target read-only and command-specific", async () => {
    const { plainStdout } = await withCapturedStdio(() =>
      Promise.resolve(
        emitHelpfulHints({
          argv: [
            "node",
            "openmeld",
            "space",
            "board",
            "not-a-space",
            "--view",
            "agent",
          ],
          effectiveView: "agent",
          message:
            "Space target must be a 64-character Space ID or an OpenMeld Space URL.",
        })
      )
    );

    const payload = JSON.parse(plainStdout) as {
      hints: string[];
      type: string;
    };
    expect(payload).toEqual({
      type: "hints",
      code: "cli.hints",
      hints: ["openmeld space board --profile <profile-id> <space-id-or-url>"],
    });
    expect(plainStdout).not.toMatch(UNRELATED_SPACE_WRITE_HINT_RE);
  });
});
