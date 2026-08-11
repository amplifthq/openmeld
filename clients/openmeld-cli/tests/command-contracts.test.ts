import { describe, expect, it } from "vitest";
import {
  buildAgentOverviewFromContract,
  createGuideErrorFromContract,
} from "../src/command-contracts/helpers";
import { getCommandEntryContract } from "../src/command-contracts/registry";
import type { CommandEntryName } from "../src/command-entry-checks/types";

const MIGRATED_ENTRY_NAMES: CommandEntryName[] = [
  "root",
  "view",
  "doctor",
  "whoami",
  "upgrade",
  "repair.local-state",
  "uninstall",
  "reset",
  "auth.menu",
  "auth.login",
  "auth.status",
  "auth.logout",
  "service.menu",
  "service.run",
  "service.status",
  "service.snapshot",
  "service.cancel",
  "service.interrupt",
  "service.install",
  "service.reinstall",
  "service.uninstall",
  "service.stop",
  "skills.install",
  "skills.uninstall",
  "space.add-me",
  "space.add-agents",
  "space.add-human-profiles",
  "space.add-members",
  "space.remove-members",
];

describe("command contracts", () => {
  it("registers contracts for migrated command entries", () => {
    for (const entryName of MIGRATED_ENTRY_NAMES) {
      expect(getCommandEntryContract(entryName)).not.toBeNull();
    }
  });

  it("keeps skills install overview and guide arguments in sync", () => {
    const contract = getCommandEntryContract("skills.install");
    expect(contract).not.toBeNull();
    expect(contract?.agentOverview).toBeTruthy();
    expect(contract?.guideScenarios?.required).toBeTruthy();
    const overviewContract = contract?.agentOverview;
    const guideScenario = contract?.guideScenarios?.required;
    if (!(overviewContract && guideScenario)) {
      throw new Error("missing skills.install contract data");
    }

    const context = {
      agentExampleArg: "amp adal",
      includeViewFlag: true,
      knownAgentIds: ["adal", "amp"],
      skills: [{ name: "openmeld-cli", relativePath: "openmeld-cli" }],
      storeDir: "/tmp/.openmeld/skills",
    };
    const overview = buildAgentOverviewFromContract({
      context,
      overview: overviewContract,
    });
    const guideError = createGuideErrorFromContract({
      context,
      guideScenario,
    });

    expect(overview.requiredArguments).toEqual(
      guideError.guide.agentRequiredArgs
    );
    expect(overview.optionalArguments).toEqual(
      guideError.guide.agentOptionalArgs
    );
    expect(overview.commands).toEqual(guideError.guide.agentCommands);
  });

  it("keeps auth login overview and guide commands in sync", () => {
    const contract = getCommandEntryContract("auth.login");
    expect(contract).not.toBeNull();
    expect(contract?.agentOverview).toBeTruthy();
    expect(contract?.guideScenarios?.required).toBeTruthy();
    const overviewContract = contract?.agentOverview;
    const guideScenario = contract?.guideScenarios?.required;
    if (!(overviewContract && guideScenario)) {
      throw new Error("missing auth.login contract data");
    }

    const context = {
      includeViewFlag: true,
      summary: "invalid --method value: use device|ott",
    };
    const overview = buildAgentOverviewFromContract({
      context,
      overview: overviewContract,
    });
    const guideError = createGuideErrorFromContract({
      context,
      guideScenario,
    });

    expect(overview.requiredArguments).toEqual(
      guideError.guide.agentRequiredArgs
    );
    expect(overview.optionalArguments).toEqual(
      guideError.guide.agentOptionalArgs
    );
    expect(overview.commands).toEqual(guideError.guide.agentCommands);
  });

  it("keeps service status read-only and service repair human-action contracts explicit", () => {
    const status = getCommandEntryContract("service.status")?.agentOverview;
    const reinstall =
      getCommandEntryContract("service.reinstall")?.agentOverview;

    expect(status?.humanActionRequired).toBe(false);
    expect(status?.notes).toContain(
      "Status is read-only in agent view and does not change OpenMeld Service."
    );
    expect(status?.notes).toContain(
      "Agent view emits daemon.status.local_result first with local service evidence, then daemon.status.result with full readiness diagnostics."
    );
    expect(status?.stages).toContain(
      "Return fast local service evidence as daemon.status.local_result."
    );
    expect(reinstall?.humanActionRequired).toBe(false);
    expect(reinstall?.commands).toContain(
      "openmeld service status --view agent"
    );
  });

  it("renders space member mutation commands through the profile-aware contract", () => {
    for (const entryName of [
      "space.add-agents",
      "space.add-human-profiles",
      "space.add-members",
      "space.remove-members",
    ] as const) {
      const contract = getCommandEntryContract(entryName);
      const overviewContract = contract?.agentOverview;
      const guideScenario = contract?.guideScenarios?.required;
      if (!(overviewContract && guideScenario)) {
        throw new Error(`missing ${entryName} contract data`);
      }
      const context = {
        includeViewFlag: true,
        profileId: "agt-demo",
      };
      const overview = buildAgentOverviewFromContract({
        context,
        overview: overviewContract,
      });
      const guideError = createGuideErrorFromContract({
        context,
        guideScenario,
      });

      for (const command of [
        ...overview.commands,
        ...(guideError.guide.agentCommands ?? []),
        ...guideError.hints,
      ]) {
        expect(command).toContain("--profile agt-demo");
        expect(command).toContain("--view agent");
      }
      expect(overview.commands).toEqual(guideError.guide.agentCommands);
    }
  });

  it("teaches agents the one-command add-me Space flow", () => {
    const contract = getCommandEntryContract("space.add-me");
    const overviewContract = contract?.agentOverview;
    const guideScenario = contract?.guideScenarios?.required;
    if (!(overviewContract && guideScenario)) {
      throw new Error("missing space.add-me contract data");
    }

    const overview = buildAgentOverviewFromContract({
      context: { includeViewFlag: true },
      overview: overviewContract,
    });
    const guideError = createGuideErrorFromContract({
      context: { includeViewFlag: true },
      guideScenario,
    });

    expect(overview.commands).toContain(
      "openmeld space add-me <space-url-or-id> --project-folder <path> --view agent"
    );
    expect(guideError.guide.agentCommands).toContain(
      "openmeld space add-me <space-url-or-id> --project-folder <path> --view agent"
    );
    expect(overview.optionalArguments).toContain("--project-folder <path>");
    expect(overview.optionalArguments).toContain(
      "--profile <human-profile-id>"
    );
    expect(overview.notes.join("\n")).toContain(
      "signed-in user's acting identity; it is not the Agent Profile being added"
    );
    expect(overview.notes.join("\n")).toContain(
      "--workspace-path`, `--working-directory`, and `--cwd`"
    );
    expect(overview.notes.join("\n")).toContain(
      "Space membership does not prove Wake readiness."
    );
    expect(overview.notes.join("\n")).toContain(
      "add yourself to this Space using the current project folder"
    );
  });
});
