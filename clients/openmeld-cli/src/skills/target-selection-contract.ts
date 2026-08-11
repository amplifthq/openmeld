import type { Command } from "commander";
import { createCommandContractError } from "../command-contracts/helpers";
import type {
  CommandContractRenderContext,
  CommandPatternContract,
} from "../command-contracts/types";

export type SkillsTargetSelectionCommand = "ensure" | "install" | "uninstall";

type SkillsTargetSelectionDescriptor = {
  actionLabel: string;
  command: SkillsTargetSelectionCommand;
  supportsGuideSelection: boolean;
};

type SkillsTargetSelectionValidationInput = {
  all?: boolean;
  command: SkillsTargetSelectionCommand;
  explicitAgentIds: string[];
  explicitDir: string | null;
  guide?: boolean;
};

type SkillsTargetSelectionRenderContext = CommandContractRenderContext;

const SKILLS_TARGET_SELECTION_DESCRIPTORS = {
  ensure: {
    actionLabel: "Install or update",
    command: "ensure",
    supportsGuideSelection: true,
  },
  install: {
    actionLabel: "Install",
    command: "install",
    supportsGuideSelection: true,
  },
  uninstall: {
    actionLabel: "Uninstall",
    command: "uninstall",
    supportsGuideSelection: false,
  },
} as const satisfies Record<
  SkillsTargetSelectionCommand,
  SkillsTargetSelectionDescriptor
>;

const SKILLS_TARGET_SELECTION_REQUIRED_ARGUMENTS = {
  ensure: [
    "one target selector: --all | --agent <id...> | --dir <absolute-path> | --guide",
  ],
  install: [
    "one target selector: --all | --agent <id...> | --dir <absolute-path> | --guide",
  ],
  uninstall: [
    "one target selector: --all | --agent <id...> | --dir <absolute-path>",
  ],
} as const satisfies Record<SkillsTargetSelectionCommand, string[]>;

const SKILLS_TARGET_SELECTION_OPTIONAL_ARGUMENTS = {
  ensure: [],
  install: [],
  uninstall: ["--dry-run", "--allow-external-targets"],
} as const satisfies Record<SkillsTargetSelectionCommand, string[]>;

const SKILLS_TARGET_SELECTION_ERRORS = {
  ensure: {
    conflict:
      "use exactly one of --all, --agent <id...>, --dir <absolute-path>, or --guide",
    missing:
      "provide exactly one of --all, --agent <id...>, --dir <absolute-path>, or --guide",
  },
  install: {
    conflict:
      "use exactly one of --all, --agent <id...>, --dir <absolute-path>, or --guide",
    missing:
      "provide exactly one of --all, --agent <id...>, --dir <absolute-path>, or --guide",
  },
  uninstall: {
    conflict:
      "use exactly one of --all, --agent <id...>, or --dir <absolute-path>",
    missing:
      "provide exactly one of --all, --agent <id...>, or --dir <absolute-path>",
  },
} as const;

export function getSkillsTargetSelectionPatternContract(
  command: SkillsTargetSelectionCommand
): CommandPatternContract<SkillsTargetSelectionRenderContext> {
  return {
    buildCommands: (context) =>
      buildSkillsTargetSelectionExamples({
        command,
        includeViewFlag: context.includeViewFlag,
        agentExampleArg: context.agentExampleArg,
      }),
    buildHints: (context) =>
      buildSkillsTargetSelectionHints({
        command,
        agentExampleArg: context.agentExampleArg,
      }),
    buildOptionalArguments: () =>
      getSkillsTargetSelectionOptionalArguments(command),
    buildRequiredArguments: () =>
      getSkillsTargetSelectionRequiredArguments(command),
  };
}

export function registerSkillsTargetSelectionOptions(input: {
  command: Command;
  selectionCommand: SkillsTargetSelectionCommand;
  agentExampleArg: string;
}): Command {
  const descriptor = getSkillsTargetSelectionDescriptor(input.selectionCommand);
  input.command.option(
    "--all",
    `${descriptor.actionLabel} skills for all detected local agents`
  );
  input.command.option(
    "--agent <agent...>",
    `${descriptor.actionLabel} skills for specific agent ids (for example: ${input.agentExampleArg})`
  );
  input.command.option(
    "--dir <path>",
    `${descriptor.actionLabel} skills ${
      input.selectionCommand === "install" ? "into" : "from"
    } a specific custom skills directory`
  );
  if (descriptor.supportsGuideSelection) {
    input.command.option("--guide", "Show manual installation guide only");
  }
  return input.command;
}

export function getSkillsTargetSelectionRequiredArguments(
  command: SkillsTargetSelectionCommand
): string[] {
  return [...SKILLS_TARGET_SELECTION_REQUIRED_ARGUMENTS[command]];
}

export function getSkillsTargetSelectionOptionalArguments(
  command: SkillsTargetSelectionCommand
): string[] {
  return [...SKILLS_TARGET_SELECTION_OPTIONAL_ARGUMENTS[command]];
}

export function buildSkillsTargetSelectionExamples(input: {
  agentExampleArg?: string;
  command: SkillsTargetSelectionCommand;
  includeViewFlag?: boolean;
}): string[] {
  const commands = [
    buildSkillsTargetSelectionCommand({
      all: true,
      command: input.command,
      includeViewFlag: input.includeViewFlag,
    }),
    buildSkillsTargetSelectionCommand({
      agentIds: [normalizeAgentExampleArg(input.agentExampleArg)],
      command: input.command,
      includeViewFlag: input.includeViewFlag,
    }),
    buildSkillsTargetSelectionCommand({
      command: input.command,
      dir: "<absolute-path>",
      includeViewFlag: input.includeViewFlag,
    }),
  ];
  if (input.command === "install" || input.command === "ensure") {
    commands.push(
      buildSkillsTargetSelectionCommand({
        command: input.command,
        guide: true,
        includeViewFlag: input.includeViewFlag,
      })
    );
  } else {
    commands.push(
      buildSkillsTargetSelectionCommand({
        all: true,
        command: "uninstall",
        dryRun: true,
        includeViewFlag: input.includeViewFlag,
      })
    );
  }
  return commands;
}

export function buildSkillsTargetSelectionHints(input: {
  agentExampleArg?: string;
  command: SkillsTargetSelectionCommand;
}): string[] {
  return buildSkillsTargetSelectionExamples({
    command: input.command,
    agentExampleArg: input.agentExampleArg,
  });
}

export function buildSkillsTargetSelectionCommand(input: {
  agentIds?: string[];
  all?: boolean;
  allowExternalTargets?: boolean;
  command: SkillsTargetSelectionCommand;
  dir?: string;
  dryRun?: boolean;
  guide?: boolean;
  includeViewFlag?: boolean;
}): string {
  const descriptor = getSkillsTargetSelectionDescriptor(input.command);
  const tokens = ["openmeld", "skills", input.command];
  if (input.all) {
    tokens.push("--all");
  } else if (input.agentIds && input.agentIds.length > 0) {
    tokens.push("--agent", ...input.agentIds);
  } else if (input.dir) {
    tokens.push("--dir", input.dir);
  } else if (input.guide) {
    if (!descriptor.supportsGuideSelection) {
      throw new Error(
        "skills target selection command does not support --guide"
      );
    }
    tokens.push("--guide");
  } else {
    throw new Error(
      `skills target selection command requires one selector for ${input.command}`
    );
  }

  if (input.dryRun) {
    tokens.push("--dry-run");
  }
  if (input.allowExternalTargets) {
    tokens.push("--allow-external-targets");
  }
  if (input.includeViewFlag) {
    tokens.push("--view", "agent");
  }
  return tokens.join(" ");
}

export function validateSkillsTargetSelectionInput(
  input: SkillsTargetSelectionValidationInput
): void {
  const guide =
    getSkillsTargetSelectionDescriptor(input.command).supportsGuideSelection &&
    input.guide === true;
  const selectedModeCount = countSelectedModes({
    agentCount: input.explicitAgentIds.length,
    all: input.all,
    dir: input.explicitDir,
    guide,
  });
  if (selectedModeCount > 1) {
    throw createCommandContractError(
      `skills.${input.command}_invalid`,
      SKILLS_TARGET_SELECTION_ERRORS[input.command].conflict
    );
  }
  if (selectedModeCount === 0) {
    throw createCommandContractError(
      `skills.${input.command}_invalid`,
      SKILLS_TARGET_SELECTION_ERRORS[input.command].missing
    );
  }
}

function countSelectedModes(input: {
  agentCount: number;
  all?: boolean;
  dir: string | null;
  guide: boolean;
}): number {
  return (
    (input.all ? 1 : 0) +
    (input.agentCount > 0 ? 1 : 0) +
    (input.dir ? 1 : 0) +
    (input.guide ? 1 : 0)
  );
}

function getSkillsTargetSelectionDescriptor(
  command: SkillsTargetSelectionCommand
): SkillsTargetSelectionDescriptor {
  return SKILLS_TARGET_SELECTION_DESCRIPTORS[command];
}

function normalizeAgentExampleArg(value: string | undefined): string {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "<id...>";
}
