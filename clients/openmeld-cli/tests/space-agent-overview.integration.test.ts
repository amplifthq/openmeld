import { describe, expect, it } from "vitest";
import { SPACE_ADD_MEMBERS_AGENT_OVERVIEW_STAGES } from "../src/space/add-members-progress-contract";
import { emitSpaceCliAgentOverview } from "../src/space/agent-overview";
import { withCapturedStdio } from "./helpers/fs";

describe("space agent overview", () => {
  const commands = [
    ["menu", "space.menu.agent_overview", "choose_subcommand"],
    ["create", "space.create.agent_overview", "service_check"],
    ["join", "space.join.agent_overview", "service_check"],
    ["watch", "space.watch.agent_overview", "resolve_target"],
    ["send", "space.send.agent_overview", "resolve_message"],
    ["history", "space.history.agent_overview", "read_history"],
    ["contract", "space.contract.agent_overview", "read_contract"],
    ["updates", "space.updates.agent_overview", "read_updates"],
    ["result", "space.result.agent_overview", "read_dispatch_result"],
    ["password", "space.password.agent_overview", "update_password"],
    ["guide", "space.guide.agent_overview", "read_or_update_guide"],
    [
      "add_members",
      "space.add_members.agent_overview",
      "add_members/write_membership",
    ],
    [
      "add_agents",
      "space.add_agents.agent_overview",
      "add_members/write_membership",
    ],
    [
      "add_human_profiles",
      "space.add_human_profiles.agent_overview",
      "add_members/write_membership",
    ],
    ["remove_members", "space.remove_members.agent_overview", "remove_members"],
    ["delete", "space.delete.agent_overview", "confirm_human_approval"],
    ["list", "space.list.agent_overview", "list_spaces"],
  ] as const;

  for (const [command, code, stage] of commands) {
    it(`emits a structured overview for space ${command}`, async () => {
      const { stdout } = await withCapturedStdio(async () => {
        emitSpaceCliAgentOverview(command);
        await Promise.resolve();
      });

      const envelope = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as { code?: string; payload?: unknown })
        .find((line) => line.code === code);

      expect(envelope).toBeDefined();
      const payload = envelope?.payload as
        | {
            commands?: string[];
            stages?: string[];
            humanActionRequired?: {
              possible?: boolean;
            };
          }
        | undefined;
      expect(payload?.stages).toContain(stage);
      expect(payload?.commands?.length).toBeGreaterThan(0);
      expect(typeof payload?.humanActionRequired?.possible).toBe("boolean");
    });
  }

  it("advertises passive link generation in the Agent View Space menu", async () => {
    const { stdout } = await withCapturedStdio(async () => {
      emitSpaceCliAgentOverview("menu");
      await Promise.resolve();
    });
    const envelope = parseAgentOverviewEnvelope(stdout);
    const payload = envelope.payload as { commands?: string[] };

    expect(payload.commands).toContain(
      "openmeld space [--gateway-url <url>] link <space-id> [--signal <signal-id>] [--thread-root-signal <signal-id>] --view agent"
    );
  });

  it("formats space overview summaries and commands with the resolved CLI entry", async () => {
    const previousCliEntry = process.env.OPENMELD_USER_FACING_CLI_COMMAND;
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-canary";

    try {
      const { stdout } = await withCapturedStdio(async () => {
        emitSpaceCliAgentOverview("list");
        await Promise.resolve();
      });

      const envelope = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as { code?: string; payload?: unknown })
        .find((line) => line.code === "space.list.agent_overview");

      const payload = envelope?.payload as
        | {
            commands?: string[];
            summary?: string;
          }
        | undefined;
      expect(payload?.summary).toContain(
        "`openmeld-canary space list --view agent`"
      );
      expect(payload?.commands).toContain(
        "openmeld-canary space list --profile <profile-id> --view agent"
      );
      expect(payload?.commands).toContain(
        "openmeld-canary space create --profile <profile-id> --name <space-name> --view agent"
      );
    } finally {
      if (previousCliEntry === undefined) {
        Reflect.deleteProperty(process.env, "OPENMELD_USER_FACING_CLI_COMMAND");
      } else {
        process.env.OPENMELD_USER_FACING_CLI_COMMAND = previousCliEntry;
      }
    }
  });

  it("keeps add-members agent overview commands profile-aware and membership-focused", async () => {
    const { stdout } = await withCapturedStdio(async () => {
      emitSpaceCliAgentOverview("add_members");
      await Promise.resolve();
    });
    const envelope = parseAgentOverviewEnvelope(stdout);
    const payload = envelope.payload as {
      commands?: string[];
      stages?: string[];
    };

    expect(payload.commands).toContain(
      "openmeld space add-members --profile <profile-id> <space-id> --member <profile-id...> --view agent"
    );
    expect(payload.commands).toContain(
      "openmeld space add-members --profile <profile-id> <space-id> --all --view agent"
    );
    expect(payload.stages).toEqual(SPACE_ADD_MEMBERS_AGENT_OVERVIEW_STAGES);
  });

  it("keeps the add-agents agent overview agent-only and free of legacy flags", async () => {
    const { stdout } = await withCapturedStdio(async () => {
      emitSpaceCliAgentOverview("add_agents");
      await Promise.resolve();
    });
    const envelope = parseAgentOverviewEnvelope(stdout);
    const payload = envelope.payload as {
      commands?: string[];
      summary?: string;
    };

    expect(envelope.code).toBe("space.add_agents.agent_overview");
    expect(payload.commands).toContain(
      "openmeld space add-agents --profile <profile-id> <space-id> --agent-profile <agent-profile-id...> --view agent"
    );
    expect(payload.summary).toContain("openmeld space add-agents");
    expect(payload.summary).not.toContain("add-members");
    for (const command of payload.commands ?? []) {
      expect(command).not.toContain("--member ");
    }
  });

  it("keeps the add-human-profiles agent overview human-only and free of legacy flags", async () => {
    const { stdout } = await withCapturedStdio(async () => {
      emitSpaceCliAgentOverview("add_human_profiles");
      await Promise.resolve();
    });
    const envelope = parseAgentOverviewEnvelope(stdout);
    const payload = envelope.payload as {
      commands?: string[];
      summary?: string;
    };

    expect(envelope.code).toBe("space.add_human_profiles.agent_overview");
    expect(payload.commands).toContain(
      "openmeld space add-human-profiles --profile <profile-id> <space-id> --human-profile <human-profile-id...> --view agent"
    );
    expect(payload.summary).toContain("openmeld space add-human-profiles");
    expect(payload.summary).not.toContain("add-members");
    for (const command of payload.commands ?? []) {
      expect(command).not.toContain("--member ");
    }
  });

  it("does not mark deterministic agent-view space commands as human-action required", async () => {
    const deterministicCommands = ["create", "send", "add_members"] as const;

    for (const command of deterministicCommands) {
      const { stdout } = await withCapturedStdio(async () => {
        emitSpaceCliAgentOverview(command);
        await Promise.resolve();
      });
      const envelope = parseAgentOverviewEnvelope(stdout);
      const payload = envelope.payload as {
        humanActionRequired?: { possible?: boolean; steps?: string[] };
      };

      expect(payload.humanActionRequired).toEqual({
        possible: false,
        steps: [],
      });
    }
  });

  it("keeps delete marked as human-action required", async () => {
    const { stdout } = await withCapturedStdio(async () => {
      emitSpaceCliAgentOverview("delete");
      await Promise.resolve();
    });
    const envelope = parseAgentOverviewEnvelope(stdout);
    const payload = envelope.payload as {
      humanActionRequired?: { possible?: boolean; steps?: string[] };
    };

    expect(payload.humanActionRequired?.possible).toBe(true);
    expect(payload.humanActionRequired?.steps?.length).toBeGreaterThan(0);
  });
});

function parseAgentOverviewEnvelope(stdout: string): {
  code?: string;
  payload?: unknown;
} {
  const envelope = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { code?: string; payload?: unknown })
    .find((line) => String(line.code ?? "").endsWith(".agent_overview"));
  if (!envelope) {
    throw new Error(`Missing agent overview envelope in stdout: ${stdout}`);
  }
  return envelope;
}
