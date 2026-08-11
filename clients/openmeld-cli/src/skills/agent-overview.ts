import { buildAgentOverviewFromContract } from "../command-contracts/helpers";
import { getCommandEntryContract } from "../command-contracts/registry";
import { formatAgentOverviewPayload } from "../runtime/agent-overview-payload";
import type { Presenter } from "../runtime/presenter";

export type SkillsAgentOverviewCommand =
  | "menu"
  | "list"
  | "check"
  | "update"
  | "ensure"
  | "install"
  | "uninstall";

type SkillsAgentOverviewInput = {
  presenter: Presenter;
  command: SkillsAgentOverviewCommand;
  storeDir: string;
  knownAgentIds: string[];
  agentExampleArg: string;
  skills: Array<{
    id: string;
    name: string;
    relativePath: string;
  }>;
};

type SkillsAgentOverviewPayload = {
  summary: string;
  requiredArguments: string[];
  optionalArguments: string[];
  commands: string[];
  stages: string[];
  notes: string[];
  humanActionRequired: boolean;
};

export function emitSkillsAgentOverview(input: SkillsAgentOverviewInput): void {
  input.presenter.data({
    code: `skills.${input.command}.agent_overview`,
    payload: formatAgentOverviewPayload(buildSkillsAgentOverviewPayload(input)),
  });
}

function buildSkillsAgentOverviewPayload(
  input: SkillsAgentOverviewInput
): SkillsAgentOverviewPayload {
  const sharedNotes = buildSharedNotes(input);
  switch (input.command) {
    case "menu": {
      return {
        summary:
          "Manage the OpenMeld skills store and route installs to known or custom agent skills directories.",
        requiredArguments: [],
        optionalArguments: [],
        commands: buildMenuCommands(input),
        stages: [
          "Inspect the local OpenMeld skills store.",
          "Choose an explicit subcommand for list, check, update, install, or uninstall.",
          "If a human wants the interactive menu, switch to human view.",
        ],
        notes: [
          "Agent view does not open the interactive skills menu.",
          ...sharedNotes,
        ],
        humanActionRequired: true,
      };
    }
    case "list": {
      return {
        summary:
          "List every OpenMeld skill currently available in the local OpenMeld skills store.",
        requiredArguments: [],
        optionalArguments: [],
        commands: ["openmeld skills list --view agent"],
        stages: [
          "Load the OpenMeld skills store.",
          "Return all local OpenMeld skills with relative and absolute paths.",
        ],
        notes: sharedNotes,
        humanActionRequired: false,
      };
    }
    case "check": {
      return {
        summary:
          "Check detected and tracked skills targets for missing OpenMeld skills, available updates, or non-OpenMeld skills that need review.",
        requiredArguments: [],
        optionalArguments: [],
        commands: [
          "openmeld skills check --view agent",
          "openmeld skills update --view agent",
        ],
        stages: [
          "Resolve detected and tracked skills targets.",
          "Compare each target with the local OpenMeld skills store.",
          "Return summary counts and per-target state.",
        ],
        notes: sharedNotes,
        humanActionRequired: false,
      };
    }
    case "update": {
      return {
        summary:
          "Update tracked OpenMeld skills targets that are missing or outdated.",
        requiredArguments: [],
        optionalArguments: [],
        commands: [
          "openmeld skills update --view agent",
          "openmeld skills check --view agent",
        ],
        stages: [
          "Resolve tracked OpenMeld skills targets.",
          "Find missing or outdated OpenMeld-managed skills.",
          "Install only the required updates.",
        ],
        notes: sharedNotes,
        humanActionRequired: false,
      };
    }
    case "ensure": {
      return buildSkillsContractOverviewPayload({
        entryName: "skills.ensure",
        input,
      });
    }
    case "install": {
      return buildSkillsContractOverviewPayload({
        entryName: "skills.install",
        input,
      });
    }
    case "uninstall": {
      return buildSkillsContractOverviewPayload({
        entryName: "skills.uninstall",
        input,
      });
    }
    default: {
      return assertNever(input.command);
    }
  }
}

function buildMenuCommands(input: SkillsAgentOverviewInput): string[] {
  const context = {
    agentExampleArg: input.agentExampleArg,
    includeViewFlag: true,
    knownAgentIds: input.knownAgentIds,
    skills: input.skills.map((skill) => ({
      name: skill.name,
      relativePath: skill.relativePath,
    })),
    storeDir: input.storeDir,
  };
  const installOverview =
    getCommandEntryContract("skills.install")?.agentOverview;
  const ensureOverview =
    getCommandEntryContract("skills.ensure")?.agentOverview;
  const uninstallOverview =
    getCommandEntryContract("skills.uninstall")?.agentOverview;
  return [
    "openmeld skills list --view agent",
    "openmeld skills check --view agent",
    "openmeld skills update --view agent",
    ...(ensureOverview
      ? buildAgentOverviewFromContract({
          context,
          overview: ensureOverview,
        }).commands
      : []),
    ...(installOverview
      ? buildAgentOverviewFromContract({
          context,
          overview: installOverview,
        }).commands
      : []),
    ...(uninstallOverview
      ? buildAgentOverviewFromContract({
          context,
          overview: uninstallOverview,
        }).commands
      : []),
  ];
}

function buildSkillsContractOverviewPayload(input: {
  entryName: "skills.ensure" | "skills.install" | "skills.uninstall";
  input: SkillsAgentOverviewInput;
}): SkillsAgentOverviewPayload {
  const contract = getCommandEntryContract(input.entryName);
  if (!contract?.agentOverview) {
    throw new Error(`missing ${input.entryName} command contract`);
  }
  const payload = buildAgentOverviewFromContract({
    context: {
      agentExampleArg: input.input.agentExampleArg,
      includeViewFlag: true,
      knownAgentIds: input.input.knownAgentIds,
      skills: input.input.skills.map((skill) => ({
        name: skill.name,
        relativePath: skill.relativePath,
      })),
      storeDir: input.input.storeDir,
    },
    overview: contract.agentOverview,
  });
  if (typeof payload.humanActionRequired !== "boolean") {
    throw new Error(
      `${input.entryName} command contract must use boolean humanActionRequired`
    );
  }
  return {
    ...payload,
    humanActionRequired: payload.humanActionRequired,
  };
}

function buildSharedNotes(input: SkillsAgentOverviewInput): string[] {
  const knownAgentIds =
    input.knownAgentIds.length > 0
      ? input.knownAgentIds.join(", ")
      : "none detected";
  const localSkills =
    input.skills.length > 0
      ? input.skills
          .map((skill) => `${skill.name} (${skill.relativePath})`)
          .join(", ")
      : "none";
  return [
    `OpenMeld skills store: ${input.storeDir}`,
    `known agent ids: ${knownAgentIds}`,
    `local OpenMeld skills: ${localSkills}`,
  ];
}

function assertNever(value: never): never {
  throw new Error(
    `unsupported skills agent overview command: ${String(value)}`
  );
}
