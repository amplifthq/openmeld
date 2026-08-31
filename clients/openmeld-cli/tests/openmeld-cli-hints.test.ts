import { describe, expect, it } from "vitest";
import { emitHelpfulHints } from "../src/openmeld-cli-hints";
import { withCapturedStdio } from "./helpers/fs";

const UNRELATED_SPACE_WRITE_HINT_RE = /space (create|join|watch)/u;
const INVALID_SPACE_READ_CASES = [
  "board",
  "history",
  "members",
  "status",
].flatMap((command) =>
  [
    "Space target must be a 64-character Space ID or an OpenMeld Space URL.",
    "Space URL must use a trusted OpenMeld Web origin. For a custom local environment, pass --gateway-url explicitly.",
  ].map((message) => ({ command, message }))
);

describe("OpenMeld CLI hints", () => {
  it.each(
    INVALID_SPACE_READ_CASES
  )("keeps an invalid Space $command target read-only and command-specific", async ({
    command,
    message,
  }) => {
    const { plainStdout } = await withCapturedStdio(() =>
      Promise.resolve(
        emitHelpfulHints({
          argv: [
            "node",
            "openmeld",
            "space",
            command,
            "not-a-space",
            "--view",
            "agent",
          ],
          effectiveView: "agent",
          message,
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
      hints: [
        `openmeld space ${command} --profile <profile-id> <space-id-or-url>`,
      ],
    });
    expect(plainStdout).not.toMatch(UNRELATED_SPACE_WRITE_HINT_RE);
  });
});
