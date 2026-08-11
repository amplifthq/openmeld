import type { Command } from "commander";

export type BuiltinAgentSelectionCommand = "disable" | "enable" | "repair";

export type BuiltinAgentSelectionDescriptor = {
  allOptionDescription: string;
  agentOptionDescription: string;
  command: BuiltinAgentSelectionCommand;
  supportsInstallSelection: boolean;
};

type BuiltinAgentSelectionCommandInput = {
  agentIds?: string[];
  all?: boolean;
  command: BuiltinAgentSelectionCommand;
  includeViewFlag?: boolean;
  installId?: string;
};

type BuiltinAgentSelectionValidationInput = {
  all?: boolean;
  command: BuiltinAgentSelectionCommand;
  explicitIds: string[];
  explicitInstallId: string | null;
};

const BUILTIN_AGENT_SELECTION_REQUIRED_ARGUMENT =
  "one selection mode: --all | --agent <id...>";
const BUILTIN_AGENT_SELECTION_INSTALL_ARGUMENT =
  "--install <install-id> with one --agent <id>";
const BUILTIN_AGENT_SELECTION_CONFLICT_ERROR =
  "use either --all or --agent <id...>, not both";
const BUILTIN_AGENT_SELECTION_MISSING_ERROR =
  "provide --all or --agent <id...>";
const BUILTIN_AGENT_SELECTION_INSTALL_CONSTRAINT_ERROR =
  "use --install only with one --agent <id>";
const BUILTIN_AGENT_SELECTION_INSTALL_OPTION_DESCRIPTION =
  "Choose the exact detected install OpenMeld should use for one builtin agent";

const BUILTIN_AGENT_SELECTION_DESCRIPTORS = {
  disable: {
    allOptionDescription: "Disable all connected agents",
    agentOptionDescription: "Disable specific connected agent IDs",
    command: "disable",
    supportsInstallSelection: false,
  },
  enable: {
    allOptionDescription:
      "Enable every detected agent OpenMeld can use on this computer",
    agentOptionDescription:
      "Enable specific agent IDs (built-in ID or custom target ID)",
    command: "enable",
    supportsInstallSelection: true,
  },
  repair: {
    allOptionDescription: "Repair every connected agent that needs repair",
    agentOptionDescription: "Repair specific connected agent IDs",
    command: "repair",
    supportsInstallSelection: true,
  },
} as const satisfies Record<
  BuiltinAgentSelectionCommand,
  BuiltinAgentSelectionDescriptor
>;

export function getBuiltinAgentSelectionDescriptor(
  command: BuiltinAgentSelectionCommand
): BuiltinAgentSelectionDescriptor {
  return BUILTIN_AGENT_SELECTION_DESCRIPTORS[command];
}

export function registerBuiltinAgentSelectionOptions(input: {
  command: Command;
  selectionCommand: BuiltinAgentSelectionCommand;
}): Command {
  const descriptor = getBuiltinAgentSelectionDescriptor(input.selectionCommand);
  input.command.option("--agent <agent...>", descriptor.agentOptionDescription);
  if (descriptor.supportsInstallSelection) {
    input.command.option(
      "--install <install-id>",
      BUILTIN_AGENT_SELECTION_INSTALL_OPTION_DESCRIPTION
    );
  }
  input.command.option("--all", descriptor.allOptionDescription);
  return input.command;
}

export function getBuiltinAgentSelectionRequiredArguments(
  _command: BuiltinAgentSelectionCommand
): string[] {
  return [BUILTIN_AGENT_SELECTION_REQUIRED_ARGUMENT];
}

export function getBuiltinAgentSelectionOptionalArguments(
  command: BuiltinAgentSelectionCommand
): string[] {
  return getBuiltinAgentSelectionDescriptor(command).supportsInstallSelection
    ? [BUILTIN_AGENT_SELECTION_INSTALL_ARGUMENT]
    : [];
}

export function buildBuiltinAgentSelectionCommand(
  input: BuiltinAgentSelectionCommandInput
): string {
  const descriptor = getBuiltinAgentSelectionDescriptor(input.command);
  const tokens = ["openmeld", "agents", input.command];
  if (input.all) {
    tokens.push("--all");
  } else if (input.agentIds && input.agentIds.length > 0) {
    tokens.push("--agent", ...input.agentIds);
  } else {
    throw new Error(
      `builtin agent selection command requires --all or --agent for ${input.command}`
    );
  }

  if (input.installId) {
    if (!descriptor.supportsInstallSelection) {
      throw new Error(
        `builtin agent selection command does not support --install for ${input.command}`
      );
    }
    tokens.push("--install", input.installId);
  }

  if (input.includeViewFlag) {
    tokens.push("--view", "agent");
  }
  return tokens.join(" ");
}

export function buildBuiltinAgentSelectionExamples(input: {
  command: BuiltinAgentSelectionCommand;
  includeViewFlag?: boolean;
}): string[] {
  const descriptor = getBuiltinAgentSelectionDescriptor(input.command);
  const commands = [
    buildBuiltinAgentSelectionCommand({
      all: true,
      command: input.command,
      includeViewFlag: input.includeViewFlag,
    }),
    buildBuiltinAgentSelectionCommand({
      agentIds: ["<id...>"],
      command: input.command,
      includeViewFlag: input.includeViewFlag,
    }),
  ];
  if (descriptor.supportsInstallSelection) {
    commands.push(
      buildBuiltinAgentSelectionCommand({
        agentIds: ["<id>"],
        command: input.command,
        includeViewFlag: input.includeViewFlag,
        installId: "<install-id>",
      })
    );
  }
  return commands;
}

export function validateBuiltinAgentSelectionInput(
  input: BuiltinAgentSelectionValidationInput
): void {
  const descriptor = getBuiltinAgentSelectionDescriptor(input.command);
  if (input.all && input.explicitIds.length > 0) {
    throw new Error(
      `agents.config_invalid: ${BUILTIN_AGENT_SELECTION_CONFLICT_ERROR}`
    );
  }
  if (!(input.all || input.explicitIds.length > 0)) {
    throw new Error(
      `agents.${input.command}_invalid: ${BUILTIN_AGENT_SELECTION_MISSING_ERROR}`
    );
  }
  if (
    input.explicitInstallId &&
    (!descriptor.supportsInstallSelection ||
      input.all ||
      input.explicitIds.length !== 1)
  ) {
    throw new Error(
      `agents.${input.command}_invalid: ${BUILTIN_AGENT_SELECTION_INSTALL_CONSTRAINT_ERROR}`
    );
  }
}
