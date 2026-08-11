import { describe, expect, it } from "vitest";
import {
  emitProfileAgentOverview,
  type ProfileAgentOverviewCommand,
} from "../src/profile/agent-overview";
import { withCapturedStdio } from "./helpers/fs";

describe("profile agent overview", () => {
  const commands: Array<{
    command: ProfileAgentOverviewCommand;
    code: string;
    expectedStage: string;
    expectedCommand: string;
  }> = [
    {
      command: "menu",
      code: "profile.menu.agent_overview",
      expectedStage: "choose_subcommand",
      expectedCommand: "openmeld profiles list | openmeld profiles ls",
    },
    {
      command: "create",
      code: "profile.create.agent_overview",
      expectedStage: "create_profile",
      expectedCommand:
        "openmeld profiles create <profileName> --kind agent --view agent",
    },
    {
      command: "update",
      code: "profile.update.agent_overview",
      expectedStage: "apply_update",
      expectedCommand: "openmeld profiles update <profile-id> [--profile <id>]",
    },
    {
      command: "set",
      code: "profile.set.agent_overview",
      expectedStage: "select_profile",
      expectedCommand: "openmeld profiles set <profile-id> [--profile <id>]",
    },
    {
      command: "delete",
      code: "profile.delete.agent_overview",
      expectedStage: "delete_profile",
      expectedCommand:
        "openmeld profiles delete <profile-id> [--profile <id>] --force",
    },
    {
      command: "list",
      code: "profile.list.agent_overview",
      expectedStage: "list_profiles",
      expectedCommand: "openmeld profiles list --view agent",
    },
  ];

  for (const item of commands) {
    it(`emits a structured overview for profile ${item.command}`, async () => {
      const { stdout } = await withCapturedStdio(async () => {
        emitProfileAgentOverview(item.command);
        await Promise.resolve();
      });

      const envelope = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as { code?: string; payload?: unknown })
        .find((line) => line.code === item.code);

      expect(envelope).toBeDefined();
      const payload = envelope?.payload as
        | {
            commands?: string[];
            stages?: string[];
            notes?: string[];
            humanActionRequired?: {
              possible?: boolean;
            };
          }
        | undefined;
      expect(
        payload?.commands?.some((command) =>
          command.includes(item.expectedCommand)
        )
      ).toBe(true);
      expect(payload?.stages).toContain(item.expectedStage);
      expect(typeof payload?.humanActionRequired?.possible).toBe("boolean");

      if (item.command === "create" || item.command === "update") {
        expect(payload?.notes).toContain(
          "When assigning a controller to an agent profile, prefer the controller that matches the current runtime agent when supported. If unsupported, leave it unbound and tell the user."
        );
      }
    });
  }

  it("formats profile overview summaries and commands with the resolved CLI entry", async () => {
    const previousCliEntry = process.env.OPENMELD_USER_FACING_CLI_COMMAND;
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";

    try {
      const { stdout } = await withCapturedStdio(async () => {
        emitProfileAgentOverview("create");
        await Promise.resolve();
      });

      const envelope = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as { code?: string; payload?: unknown })
        .find((line) => line.code === "profile.create.agent_overview");

      const payload = envelope?.payload as
        | {
            commands?: string[];
            humanActionRequired?: {
              steps?: string[];
            };
            summary?: string;
          }
        | undefined;
      expect(payload?.summary).toContain(
        "`openmeld-dev profiles create --view agent`"
      );
      expect(payload?.commands).toContain(
        "openmeld-dev profiles create <profileName> --kind agent --view agent"
      );
      expect(payload?.humanActionRequired?.steps).toContain(
        "openmeld-dev view human"
      );
    } finally {
      if (previousCliEntry === undefined) {
        Reflect.deleteProperty(process.env, "OPENMELD_USER_FACING_CLI_COMMAND");
      } else {
        process.env.OPENMELD_USER_FACING_CLI_COMMAND = previousCliEntry;
      }
    }
  });
});
