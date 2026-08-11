import type { Command } from "commander";
import { createCommandContractError } from "../command-contracts/helpers";
import type {
  CommandContractRenderContext,
  CommandPatternContract,
} from "../command-contracts/types";
import { formatProfileAwareOpenMeldCliCommand } from "../runtime/cli-entry-command";

export type SpaceMemberSelectionCommand =
  | "add-agents"
  | "add-human-profiles"
  | "add-members"
  | "remove-members";

type SpaceMemberSelectionRenderContext = CommandContractRenderContext;

const SPACE_MEMBER_SELECTION_REQUIRED_ARGUMENT = [
  "<space-id>",
  "one selection mode: <selector-option> <selector-operand> | --all",
] as const;
const SPACE_MEMBER_SELECTION_OPTIONAL_ARGUMENTS = [
  "--password <value>",
  "parent option: openmeld space --gateway-url <url>",
  "--profile <profile-id>",
] as const;
const SPACE_MEMBER_SELECTION_CONFLICT_ERRORS = {
  "add-agents":
    "`openmeld space add-agents`: use either --agent-profile <agent-profile-id...> or --all, not both",
  "add-human-profiles":
    "`openmeld space add-human-profiles`: use either --human-profile <human-profile-id...> or --all, not both",
  "add-members":
    "`openmeld space add-members`: use either --member <profile-id...> or --all, not both",
  "remove-members":
    "`openmeld space remove-members`: use either --member <profile-id...> or --all, not both",
} as const;
const SPACE_MEMBER_SELECTION_MISSING_ERRORS = {
  "add-agents":
    "`openmeld space add-agents` requires --agent-profile <agent-profile-id...> or --all in non-interactive mode",
  "add-human-profiles":
    "`openmeld space add-human-profiles` requires --human-profile <human-profile-id...> or --all in non-interactive mode",
  "add-members":
    "`openmeld space add-members` requires --member <profile-id...> or --all in non-interactive mode",
  "remove-members":
    "`openmeld space remove-members` requires --member <profile-id...> or --all in non-interactive mode",
} as const;

export function getSpaceMemberSelectionPatternContract(
  command: SpaceMemberSelectionCommand
): CommandPatternContract<SpaceMemberSelectionRenderContext> {
  const selector = getSpaceMemberSelectionSelector(command);
  return {
    buildCommands: (context) =>
      buildSpaceMemberSelectionExamples({
        command,
        includeViewFlag: context.includeViewFlag,
        profileId: context.profileId,
      }),
    buildHints: (context) =>
      buildSpaceMemberSelectionExamples({
        command,
        includeViewFlag: context.includeViewFlag,
        profileId: context.profileId,
      }),
    buildOptionalArguments: () => [
      ...SPACE_MEMBER_SELECTION_OPTIONAL_ARGUMENTS,
    ],
    buildRequiredArguments: () =>
      SPACE_MEMBER_SELECTION_REQUIRED_ARGUMENT.map((argument) =>
        argument
          .replace("<selector-option>", selector.option)
          .replace("<selector-operand>", selector.operand)
      ),
  };
}

export function registerSpaceMemberSelectionOptions(input: {
  command: Command;
  selectionCommand: SpaceMemberSelectionCommand;
}): Command {
  const selector = getSpaceMemberSelectionSelector(input.selectionCommand);
  return input.command
    .option(
      `${selector.option} ${selector.operand}`,
      `${selector.label} id(s) to ${selector.action} (single or multiple)`
    )
    .option("--all", selector.allDescription);
}

export function buildSpaceMemberSelectionExamples(input: {
  command: SpaceMemberSelectionCommand;
  includeViewFlag?: boolean;
  profileId?: string | null;
}): string[] {
  const selector = getSpaceMemberSelectionSelector(input.command);
  return [
    buildSpaceMemberSelectionCommand({
      command: input.command,
      includeViewFlag: input.includeViewFlag,
      memberIds: [selector.operand],
      profileId: input.profileId,
    }),
    buildSpaceMemberSelectionCommand({
      all: true,
      command: input.command,
      includeViewFlag: input.includeViewFlag,
      profileId: input.profileId,
    }),
  ];
}

export function validateSpaceMemberSelectionInput(input: {
  all: boolean;
  command: SpaceMemberSelectionCommand;
  explicitMemberIds: string[];
}): void {
  if (input.all && input.explicitMemberIds.length > 0) {
    throw createCommandContractError(
      `space.${input.command}.selector_invalid`,
      SPACE_MEMBER_SELECTION_CONFLICT_ERRORS[input.command]
    );
  }
  if (!(input.all || input.explicitMemberIds.length > 0)) {
    throw createCommandContractError(
      `space.${input.command}.selector_missing`,
      SPACE_MEMBER_SELECTION_MISSING_ERRORS[input.command]
    );
  }
}

function buildSpaceMemberSelectionCommand(input: {
  all?: boolean;
  command: SpaceMemberSelectionCommand;
  includeViewFlag?: boolean;
  memberIds?: string[];
  profileId?: string | null;
}): string {
  const tokens = ["openmeld", "space", input.command, "<space-id>"];
  if (input.all) {
    tokens.push("--all");
  } else if (input.memberIds && input.memberIds.length > 0) {
    tokens.push(
      getSpaceMemberSelectionSelector(input.command).option,
      ...input.memberIds
    );
  } else {
    throw new Error("space member selection command requires a selector");
  }
  if (input.includeViewFlag) {
    return formatProfileAwareOpenMeldCliCommand(tokens.join(" "), {
      profileId: input.profileId ?? "<profile-id>",
      resolvedView: "agent",
    });
  }
  return tokens.join(" ");
}

function getSpaceMemberSelectionSelector(
  command: SpaceMemberSelectionCommand
): {
  action: string;
  allDescription: string;
  label: string;
  option: "--agent-profile" | "--human-profile" | "--member";
  operand:
    | "<agent-profile-id...>"
    | "<human-profile-id...>"
    | "<profile-id...>";
} {
  switch (command) {
    case "add-agents":
      return {
        action: "add",
        allDescription:
          "Add all eligible Agent Profiles that are not yet in this space",
        label: "Agent Profile",
        option: "--agent-profile",
        operand: "<agent-profile-id...>",
      };
    case "add-human-profiles":
      return {
        action: "add",
        allDescription:
          "Add all eligible Human Profiles that are not yet in this space",
        label: "Human Profile",
        option: "--human-profile",
        operand: "<human-profile-id...>",
      };
    case "add-members":
      return {
        action: "add",
        allDescription:
          "Add all eligible profiles that are not yet in this space",
        label: "Profile",
        option: "--member",
        operand: "<profile-id...>",
      };
    case "remove-members":
      return {
        action: "remove",
        allDescription: "Remove all eligible members that are currently active",
        label: "Profile",
        option: "--member",
        operand: "<profile-id...>",
      };
    default:
      assertNever(command);
  }
}

function assertNever(value: never): never {
  throw new Error(
    `unexpected space member selection command: ${String(value)}`
  );
}
