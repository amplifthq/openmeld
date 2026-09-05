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
            "--view",
            "agent",
            "space",
            "--gateway-url",
            "http://localhost:8787",
            "--profile",
            "profile-explicit",
            command,
            "not-a-space",
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

  it("keeps a malformed Space history query on the same read command", async () => {
    const { plainStdout } = await withCapturedStdio(() =>
      Promise.resolve(
        emitHelpfulHints({
          argv: [
            "node",
            "openmeld",
            "--view",
            "agent",
            "space",
            "history",
            "space-123",
            "--around-signal",
            "signal-123",
          ],
          effectiveView: "agent",
          message: "aroundSignalId cannot be combined with limit.",
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
        "openmeld space history --profile <profile-id> <space-id-or-url> --kind text --brief --limit 20",
      ],
    });
    expect(plainStdout).not.toMatch(UNRELATED_SPACE_WRITE_HINT_RE);
  });
});
