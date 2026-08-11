import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  isCancel: vi.fn((value: unknown) => value === "__cancel__"),
  select: selectMock,
}));

import { runViewCommand } from "../src/commands/view";
import { getProfileDefaultView } from "../src/config/profile-view";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("view command", () => {
  beforeEach(() => {
    process.exitCode = undefined;
    selectMock.mockReset();
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("shows the current human view card and offers the other two view options", async () => {
    selectMock.mockResolvedValueOnce("human");

    await withTempHome(async () => {
      const profile = "profile-view-human";
      const { stdout } = await withCapturedStdio(() =>
        runViewCommand({
          effectiveView: "human",
          profile,
          interactive: true,
        })
      );

      const options = (
        selectMock.mock.calls[0]?.[0] as
          | { options?: Array<{ label: string; value: string }> }
          | undefined
      )?.options;

      expect(options).toEqual([
        expect.objectContaining({
          label: "🙂 Human View",
          value: "human",
        }),
        expect.objectContaining({
          label: "🤖 Agent View",
          value: "agent",
        }),
        expect.objectContaining({
          label: "Exit",
          value: "exit",
        }),
      ]);
      expect(stdout).toContain("Current View");
      expect(stdout).toContain("Status: 👓 Auto View");
      expect(stdout).toContain("View Updated");
      expect(stdout).toContain("Status: 🙂 Human View is now the default.");
      await expect(getProfileDefaultView(profile)).resolves.toBe("human");
    });
  });

  it("shows the current human view card without a menu when prompts are unavailable", async () => {
    await withTempHome(async () => {
      const profile = "profile-view-noninteractive";
      const { stdout } = await withCapturedStdio(() =>
        runViewCommand({
          effectiveView: "human",
          profile,
          interactive: false,
        })
      );

      expect(selectMock).not.toHaveBeenCalled();
      expect(stdout).toContain("Current View");
      expect(stdout).toContain(
        "Next: Run `openmeld view <auto|human|agent>` to switch later."
      );
      expect(stdout).not.toContain("Best For:");
    });
  });

  it("shows a human guidance card when saving without an active profile", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(() =>
        runViewCommand({
          effectiveView: "human",
          mode: "agent",
          interactive: true,
        })
      );

      expect(selectMock).not.toHaveBeenCalled();
      expect(stdout).toContain("Default View Needs a Profile");
      expect(stdout).toContain("Status: 🤖 Agent View could not be saved yet.");
      expect(process.exitCode).toBe(1);
    });
  });

  it("keeps agent view output structured", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(() =>
        runViewCommand({
          effectiveView: "agent",
        })
      );

      const lines = stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { code: string });
      expect(lines[0]?.code).toBe("view.agent_overview");
      expect(lines[1]?.code).toBe("view.current");
    });
  });

  it("formats view next steps with the resolved CLI entry in both agent and human output", async () => {
    const previousCliEntry = process.env.OPENMELD_USER_FACING_CLI_COMMAND;
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-canary";

    try {
      await withTempHome(async () => {
        const { stdout: agentStdout } = await withCapturedStdio(() =>
          runViewCommand({
            effectiveView: "agent",
            mode: "agent",
            interactive: true,
          })
        );

        const agentLines = agentStdout
          .trim()
          .split("\n")
          .map(
            (line) =>
              JSON.parse(line) as {
                code: string;
                payload?: { nextSteps?: string[] };
              }
          );
        expect(agentLines[1]?.code).toBe("view.profile_required");
        expect(agentLines[1]?.payload?.nextSteps).toEqual([
          "openmeld-canary start",
          "openmeld-canary profile set <profile-id> --view agent",
          "openmeld-canary view <auto|human|agent> --profile <profile-id> --view agent",
        ]);

        const { stdout: humanStdout } = await withCapturedStdio(() =>
          runViewCommand({
            effectiveView: "human",
            mode: "agent",
            interactive: true,
          })
        );
        expect(humanStdout).toContain(
          "Run `openmeld-canary start` or `openmeld-canary profile set <profile-id>`, then retry `openmeld-canary view <auto|human|agent>`."
        );
      });
    } finally {
      if (previousCliEntry === undefined) {
        Reflect.deleteProperty(process.env, "OPENMELD_USER_FACING_CLI_COMMAND");
      } else {
        process.env.OPENMELD_USER_FACING_CLI_COMMAND = previousCliEntry;
      }
    }
  });

  it("returns quietly when the human switch prompt is cancelled", async () => {
    selectMock.mockResolvedValueOnce("__cancel__");

    await withTempHome(async () => {
      const profile = "profile-view-cancelled";
      const { stdout } = await withCapturedStdio(() =>
        runViewCommand({
          effectiveView: "human",
          profile,
          interactive: true,
        })
      );

      expect(stdout).toContain("Current View");
      expect(stdout).not.toContain("View Updated");
      await expect(getProfileDefaultView(profile)).resolves.toBe("auto");
    });
  });

  it("returns quietly when exit is selected from the human switch menu", async () => {
    selectMock.mockResolvedValueOnce("exit");

    await withTempHome(async () => {
      const profile = "profile-view-exit";
      const { stdout } = await withCapturedStdio(() =>
        runViewCommand({
          effectiveView: "human",
          profile,
          interactive: true,
        })
      );

      expect(stdout).toContain("Current View");
      expect(stdout).not.toContain("View Updated");
      await expect(getProfileDefaultView(profile)).resolves.toBe("auto");
    });
  });
});
