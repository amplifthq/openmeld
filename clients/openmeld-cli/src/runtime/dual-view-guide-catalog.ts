import { buildAgentFacingPublicationModeGuideLines } from "@openmeld/space-mesh";
import { createGuideErrorFromContract } from "../command-contracts/helpers";
import {
  getCommandEntryContract,
  getCommandHintsFromContract,
} from "../command-contracts/registry";
import { DualViewGuideError } from "./dual-view-guide-error";

type SpaceTargetCommand =
  | "join"
  | "watch"
  | "contract"
  | "status"
  | "guide"
  | "delete";
type SpaceSubcommandTarget = "send" | "history" | "thread" | "password";
type ProfileAction = "set" | "delete" | "show" | "update";
type SpaceAliasCommand = "send" | "tail";
type UpgradeConfirmationScenario = "outdated" | "check_failed";
const SPACE_GATEWAY_PARENT_OPTION_TEXT =
  "parent option: openmeld space --gateway-url <url>";
const SPACE_CONTRACT_SET_USAGE =
  "openmeld space [--gateway-url <url>] contract set [--profile <profile-id>] <space-id> [--dispatch-policy <mention_only|listen_all>] [--publication-mode <collaboration|transparent>] [--allowed-actions <post_message,post_status,stay_silent>] [--result-archive-mode <none|space_reply_only|all_final_results>] [--entry-brief <default|none>] [--dispatch-brief <default|none>] [--json] [--password <value>]";
const SPACE_PUBLICATION_SET_USAGE =
  "openmeld space [--gateway-url <url>] publication set [--profile <profile-id>] <space-id> <collaboration|transparent> --password <space-password> [--json]";
const SPACE_HISTORY_USAGE =
  "openmeld space [--gateway-url <url>] history [--profile <profile-id>] <space-id> [--limit <n>] [--after-signal <signal-id>] [--around-signal <signal-id> --before <n> --after <n>] [--from-profile <profile-id>] [--kind <text|status|system_notice>] [--json] [--password <value>]";
export type ProfileActionGuideExamples = {
  controllerRefExample?: string;
  transportModeExample?: string;
};

export function createStartAgentIdentityGuideError(summary?: string) {
  return new DualViewGuideError({
    code: "start.agent.identity.required",
    guide: {
      summary:
        summary ??
        "openmeld start in agent view requires explicit agent profile selection or creation arguments.",
      humanSteps: ["openmeld view human", "openmeld start"],
      agentRequiredArgs: [
        "--profile-id <existing-agent-profile-id> or --profile <existing-agent-profile-id|name>",
        "or --kind agent --profile-name <name> (create; profile ID issued by OpenMeld)",
      ],
      agentOptionalArgs: ["--gateway-url <url>"],
      agentCommands: [
        "openmeld start --view agent --profile-id <existing-agent-profile-id>",
        "openmeld start --view agent --profile <existing-agent-profile-id-or-name>",
        "openmeld start --view agent --kind agent --profile-name <new-agent-profile-name>",
        "openmeld setup --view agent",
        "openmeld profiles create <new-agent-profile-name> --kind agent --view agent",
        "openmeld profiles list --view agent",
        "openmeld space create --profile <agent-profile-id> --name <space-name> --view agent",
        "openmeld space join --profile <agent-profile-id> <space-id> --view agent",
      ],
      notes: [
        "openmeld start in agent view selects or creates an Agent Profile and returns Space commands. Run `openmeld setup --view agent` when this computer needs local service or agent setup.",
        "creating profiles never accepts custom profile IDs; IDs are issued by OpenMeld auth.",
        "if a human is operating this terminal, switch to human view first.",
      ],
    },
    hints: [
      "openmeld view human",
      "openmeld start --view agent --profile-id <existing-agent-profile-id>",
      "openmeld start --view agent --kind agent --profile-name <new-agent-profile-name>",
      "openmeld setup --view agent",
      "openmeld space create --profile <agent-profile-id> --name <space-name> --view agent",
    ],
  });
}

export function createSpaceMenuGuideError() {
  return new DualViewGuideError({
    code: "space.menu.interactive.required",
    guide: {
      summary: "openmeld space menu is interactive in human view only.",
      humanSteps: ["openmeld view human", "openmeld space"],
      agentCommands: [
        "openmeld space [--gateway-url <url>] list [--profile <profile-id>] [--limit <n>] [--json]",
        "openmeld space [--gateway-url <url>] create [--profile <profile-id>] --name <name> --visibility <public|private> [--guide <text>] [--password <value>] [--join|--no-join] [--output text|ndjson]",
        "openmeld space [--gateway-url <url>] join [--profile <profile-id>] <space-id> [--password <value>] [--local-echo|--no-local-echo] [--history-limit <n>] [--role <text>] [--mention-alias <token>] [--output text|ndjson]",
        "openmeld space [--gateway-url <url>] watch [--profile <profile-id>] <space-id> [--password <value>] [--history-limit <n>] [--output text|ndjson]",
        "openmeld space [--gateway-url <url>] send [--profile <profile-id>] <space-id> [<text...>|--stdin|--text-file <path>] [--file <path>...] [--plain] [--password <value>]",
        SPACE_HISTORY_USAGE,
        "openmeld space [--gateway-url <url>] contract [--profile <profile-id>] <space-id> [--json] [--password <value>]",
        SPACE_CONTRACT_SET_USAGE,
        SPACE_PUBLICATION_SET_USAGE,
        "openmeld space [--gateway-url <url>] status [--profile <profile-id>] <space-id> [--json] [--password <value>]",
        "openmeld space [--gateway-url <url>] updates [--profile <profile-id>] <space-id> --after-signal <signal-id> [--limit <n>] [--json] [--password <value>]",
        "openmeld space [--gateway-url <url>] result [--profile <profile-id>] <space-id> (--dispatch <dispatch-id>|--result-ref <result-ref>) [--json] [--password <value>]",
        "openmeld space [--gateway-url <url>] guide [--profile <profile-id>] <space-id> [--json] [--password <value>]",
        "openmeld space [--gateway-url <url>] guide set [--profile <profile-id>] <space-id> <text...> [--json] [--password <value>]",
        "openmeld space [--gateway-url <url>] guide clear [--profile <profile-id>] <space-id> [--json] [--password <value>]",
        "openmeld space [--gateway-url <url>] add-agents [--profile <profile-id>] <space-id> (--agent-profile <agent-profile-id...>|--all) [--password <value>]",
        "openmeld space [--gateway-url <url>] add-human-profiles [--profile <profile-id>] <space-id> (--human-profile <human-profile-id...>|--all) [--password <value>]",
        "openmeld space [--gateway-url <url>] add-members [--profile <profile-id>] <space-id> (--member <profile-id...>|--all) [--password <value>]",
        "openmeld space [--gateway-url <url>] remove-members [--profile <profile-id>] <space-id> (--member <profile-id...>|--all) [--password <value>]",
        "openmeld space [--gateway-url <url>] leave [--profile <profile-id>] <space-id> [--password <value>]",
        "openmeld space [--gateway-url <url>] delete [--profile <profile-id>] <space-id> [--password <value>]",
        "openmeld space [--gateway-url <url>] password [--profile <profile-id>] <space-id> (--password <value>|--clear)",
      ],
      notes: [
        "Use explicit subcommands in agent view; do not rely on menu.",
        "Gateway overrides stay on the parent command: `openmeld space --gateway-url <url> <subcommand> ...`.",
      ],
    },
    hints: [
      "openmeld space list --profile <profile-id>",
      "openmeld space create --profile <profile-id> --name spaceship",
      "openmeld space join --profile <profile-id> <space-id>",
      "openmeld space watch --profile <profile-id> <space-id>",
    ],
  });
}

export function createSpaceContractSetGuideError(summary?: string) {
  return new DualViewGuideError({
    code: "space.contract.set.arguments.required",
    guide: {
      summary:
        summary ??
        "openmeld space contract set needs an explicit space ID and at least one patch field in agent view.",
      humanSteps: [
        "openmeld view human",
        "openmeld space contract set <space-id>",
        "Follow the guided contract editor.",
      ],
      agentRequiredArgs: ["<space-id>", "at least one patch field"],
      agentOptionalArgs: [
        "--dispatch-policy <mention_only|listen_all>",
        "--publication-mode <collaboration|transparent>",
        "--allowed-actions <post_message,post_status,stay_silent>",
        "--result-archive-mode <none|space_reply_only|all_final_results>",
        "--entry-brief <default|none>",
        "--dispatch-brief <default|none>",
        "--json",
        "--password <value>",
        SPACE_GATEWAY_PARENT_OPTION_TEXT,
        "--profile <profile-id>",
      ],
      agentCommands: [SPACE_CONTRACT_SET_USAGE],
      notes: [
        "agent view must send explicit patch fields; it does not open the interactive editor.",
        "patch writes only the fields you provide.",
      ],
    },
  });
}

export function createSpacePublicationSetGuideError(summary?: string) {
  return new DualViewGuideError({
    code: "space.publication.set.arguments.required",
    guide: {
      summary:
        summary ??
        "openmeld space publication set needs an explicit space ID, mode, and Space password.",
      humanSteps: [
        "openmeld view human",
        "openmeld space publication set <space-id> <collaboration|transparent> --password <space-password>",
      ],
      agentRequiredArgs: [
        "<space-id>",
        "<collaboration|transparent>",
        "--password <space-password>",
      ],
      agentOptionalArgs: [
        "--json",
        SPACE_GATEWAY_PARENT_OPTION_TEXT,
        "--profile <owner-profile-id>",
      ],
      agentCommands: [SPACE_PUBLICATION_SET_USAGE],
      notes: buildAgentFacingPublicationModeGuideLines(),
    },
  });
}

export function createSpaceCreateGuideError(summary?: string) {
  return new DualViewGuideError({
    code: "space.create.arguments.required",
    guide: {
      summary:
        summary ??
        "openmeld space create requires explicit --name and --visibility public|private in agent/non-interactive mode.",
      humanSteps: [
        "openmeld view human",
        "openmeld space",
        'Select "Create a space".',
      ],
      agentRequiredArgs: ["--name <name>", "--visibility <public|private>"],
      agentOptionalArgs: [
        "--guide <text>",
        "--password <value>",
        "--join|--no-join",
        "--output <text|ndjson>",
        SPACE_GATEWAY_PARENT_OPTION_TEXT,
        "--profile <profile-id>",
      ],
      agentCommands: [
        "openmeld space [--gateway-url <url>] create [--profile <profile-id>] --name <name> --visibility <public|private> [--guide <text>] [--password <value>] [--join|--no-join] [--output text|ndjson]",
        "openmeld space [--gateway-url <url>] list [--profile <profile-id>] [--limit <n>] [--json]",
        "openmeld space [--gateway-url <url>] join [--profile <profile-id>] <space-id> [--password <value>] [--local-echo|--no-local-echo] [--history-limit <n>] [--role <text>] [--mention-alias <token>] [--output text|ndjson]",
      ],
      notes: [
        "Agent view does not prompt for missing space names or organization visibility.",
        "Use explicit arguments so create can stay deterministic.",
      ],
    },
    hints: [
      "openmeld space create --profile <profile-id> --name <space-name> --visibility private --view agent",
      "openmeld space list --profile <profile-id> --view agent",
    ],
  });
}

export function createSpaceAddMembersGuideError(
  summary?: string,
  entryName:
    | "space.add-agents"
    | "space.add-human-profiles"
    | "space.add-members" = "space.add-members"
) {
  return createGuideErrorFromContract({
    context: {
      includeViewFlag: true,
      profileId: "<profile-id>",
      summary: summary ?? getSpaceAddProfilesDefaultRequiredSummary(entryName),
    },
    guideScenario: getRequiredCommandGuideScenario(entryName),
  });
}

function getSpaceAddProfilesDefaultRequiredSummary(
  entryName:
    | "space.add-agents"
    | "space.add-human-profiles"
    | "space.add-members"
): string {
  switch (entryName) {
    case "space.add-agents":
      return "openmeld space add-agents in agent/non-interactive mode requires explicit space and Agent Profile arguments.";
    case "space.add-human-profiles":
      return "openmeld space add-human-profiles in agent/non-interactive mode requires explicit space and Human Profile arguments.";
    case "space.add-members":
      return "openmeld space add-members in agent/non-interactive mode requires explicit space and member arguments.";
    default:
      assertNever(entryName);
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected value: ${String(value)}`);
}

export function createSpaceRemoveMembersGuideError(summary?: string) {
  return createGuideErrorFromContract({
    context: {
      includeViewFlag: true,
      profileId: "<profile-id>",
      summary:
        summary ??
        "openmeld space remove-members in agent/non-interactive mode requires explicit space and member arguments.",
    },
    guideScenario: getRequiredCommandGuideScenario("space.remove-members"),
  });
}

export function createSpaceLeaveGuideError(summary?: string) {
  return new DualViewGuideError({
    code: "space.leave.arguments.required",
    guide: {
      summary:
        summary ??
        "openmeld space leave in agent/non-interactive mode requires explicit space argument.",
      humanSteps: [
        "openmeld view human",
        "openmeld space leave",
        "Choose one space, then confirm leaving it.",
      ],
      agentRequiredArgs: ["<space-id>"],
      agentOptionalArgs: [
        "--profile <profile-id>",
        "--password <value>",
        "--view <agent|human|auto>",
      ],
      agentCommands: [
        "openmeld space leave <space-id> --profile <profile-id> --view agent",
        "openmeld space list --profile <profile-id> --view agent",
      ],
      notes: [
        "leave only removes the current profile from the space.",
        "the space creator cannot leave; delete the space instead when only the creator remains.",
      ],
    },
    hints: [
      "openmeld space leave <space-id> --profile <profile-id> --view agent",
    ],
  });
}

export function createSpaceTargetGuideError(command: SpaceTargetCommand) {
  const optionalArgsByCommand: Record<SpaceTargetCommand, string[]> = {
    join: [
      "--password <value>",
      "--local-echo|--no-local-echo",
      "--history-limit <n>",
      "--role <text>",
      "--mention-alias <token>",
      "--output <text|ndjson>",
      SPACE_GATEWAY_PARENT_OPTION_TEXT,
      "--profile <profile-id>",
    ],
    watch: [
      "--password <value>",
      "--history-limit <n>",
      "--output <text|ndjson>",
      SPACE_GATEWAY_PARENT_OPTION_TEXT,
      "--profile <profile-id>",
    ],
    contract: [
      "--json",
      "--password <value>",
      SPACE_GATEWAY_PARENT_OPTION_TEXT,
      "--profile <profile-id>",
    ],
    status: [
      "--json",
      "--password <value>",
      SPACE_GATEWAY_PARENT_OPTION_TEXT,
      "--profile <profile-id>",
    ],
    guide: [
      "--json",
      "--password <value>",
      SPACE_GATEWAY_PARENT_OPTION_TEXT,
      "--profile <profile-id>",
    ],
    delete: [
      "--password <value>",
      SPACE_GATEWAY_PARENT_OPTION_TEXT,
      "--profile <profile-id>",
    ],
  };

  const commandSignaturesByCommand: Record<SpaceTargetCommand, string[]> = {
    join: [
      "openmeld space [--gateway-url <url>] join [--profile <profile-id>] <space-id> [--password <value>] [--local-echo|--no-local-echo] [--history-limit <n>] [--role <text>] [--mention-alias <token>] [--output text|ndjson]",
    ],
    watch: [
      "openmeld space [--gateway-url <url>] watch [--profile <profile-id>] <space-id> [--password <value>] [--history-limit <n>] [--output text|ndjson]",
    ],
    contract: [
      "openmeld space [--gateway-url <url>] contract [--profile <profile-id>] <space-id> [--json] [--password <value>]",
    ],
    status: [
      "openmeld space [--gateway-url <url>] status [--profile <profile-id>] <space-id> [--json] [--password <value>]",
    ],
    guide: [
      "openmeld space [--gateway-url <url>] guide [--profile <profile-id>] <space-id> [--json] [--password <value>]",
      "openmeld space [--gateway-url <url>] guide set [--profile <profile-id>] <space-id> <text...> [--json] [--password <value>]",
      "openmeld space [--gateway-url <url>] guide clear [--profile <profile-id>] <space-id> [--json] [--password <value>]",
    ],
    delete: [
      "openmeld space [--gateway-url <url>] delete [--profile <profile-id>] <space-id> [--password <value>]",
    ],
  };

  return new DualViewGuideError({
    code: `space.${command}.target.required`,
    guide: {
      summary: `openmeld space ${command} requires explicit space target in agent view.`,
      humanSteps: ["openmeld view human", "openmeld space"],
      agentRequiredArgs: [
        `<space-id> (required positional argument for openmeld space ${command})`,
      ],
      agentOptionalArgs: optionalArgsByCommand[command],
      agentCommands: commandSignaturesByCommand[command],
    },
  });
}

export function createSpaceUpdatesGuideError(summary?: string) {
  return new DualViewGuideError({
    code: "space.updates.arguments.required",
    guide: {
      summary:
        summary ??
        "openmeld space updates needs an explicit space ID and --after-signal anchor in agent view.",
      humanSteps: ["openmeld view human", "openmeld space"],
      agentRequiredArgs: ["<space-id>", "--after-signal <signal-id>"],
      agentOptionalArgs: [
        "--limit <n>",
        "--json",
        "--password <value>",
        SPACE_GATEWAY_PARENT_OPTION_TEXT,
        "--profile <profile-id>",
      ],
      agentCommands: [
        "openmeld space [--gateway-url <url>] updates [--profile <profile-id>] <space-id> --after-signal <signal-id> [--limit <n>] [--json] [--password <value>]",
      ],
      notes: [
        "updates reads only formal post-anchor public signals.",
        "use --json for machine consumption in agent view.",
      ],
    },
  });
}

export function createSpaceResultGuideError(summary?: string) {
  return new DualViewGuideError({
    code: "space.result.arguments.required",
    guide: {
      summary:
        summary ??
        "openmeld space result needs an explicit space ID and exactly one selector in agent view.",
      humanSteps: ["openmeld view human", "openmeld space"],
      agentRequiredArgs: [
        "<space-id>",
        "one selector: --dispatch <dispatch-id> | --result-ref <result-ref>",
      ],
      agentOptionalArgs: [
        "--json",
        "--password <value>",
        SPACE_GATEWAY_PARENT_OPTION_TEXT,
        "--profile <profile-id>",
      ],
      agentCommands: [
        "openmeld space [--gateway-url <url>] result [--profile <profile-id>] <space-id> --dispatch <dispatch-id> [--json] [--password <value>]",
        "openmeld space [--gateway-url <url>] result [--profile <profile-id>] <space-id> --result-ref <result-ref> [--json] [--password <value>]",
      ],
      notes: [
        "exactly one selector is required.",
        "lookups stay scoped to the current space.",
      ],
    },
  });
}

export function createSpaceDeleteHumanApprovalGuideError(summary?: string) {
  return new DualViewGuideError({
    code: "space.delete.human_approval_required",
    guide: {
      summary:
        summary ??
        "space delete requires owner human confirmation in an interactive terminal.",
      humanSteps: [
        "Use a human TTY session with the owner account.",
        "Run: openmeld view human",
        "Run: openmeld space delete <space-id>",
        "Confirm deletion when prompted.",
      ],
      agentRequiredArgs: [
        "You cannot delete directly in agent mode/non-interactive sessions.",
      ],
      agentOptionalArgs: [
        SPACE_GATEWAY_PARENT_OPTION_TEXT,
        "--profile <profile-id>",
      ],
      agentCommands: [
        "openmeld view human",
        "openmeld space [--gateway-url <url>] delete [--profile <profile-id>] <space-id>",
      ],
      notes: [
        "For agent-created spaces, the owner's human session must approve deletion.",
        "Future enhancement may support web/email approval flow.",
      ],
    },
    hints: ["openmeld view human", "openmeld space delete <space-id>"],
  });
}

export function createSpaceSubcommandTargetGuideError(
  command: SpaceSubcommandTarget
) {
  const requiredArgsByCommand: Record<SpaceSubcommandTarget, string[]> = {
    send: ["<space-id>", "message text and/or --file <path>"],
    history: ["<space-id>"],
    thread: ["<space-id>", "<thread-id>"],
    password: ["<space-id>", "one action: --password <value> | --clear"],
  };
  const optionalArgsByCommand: Record<SpaceSubcommandTarget, string[]> = {
    send: [
      "--file <path> (repeatable, max 10)",
      "--text-file <path>",
      "--password <value>",
      SPACE_GATEWAY_PARENT_OPTION_TEXT,
      "--profile <profile-id>",
    ],
    history: [
      "--limit <n>",
      "--after-signal <signal-id>",
      "--around-signal <signal-id>",
      "--before <n>",
      "--after <n>",
      "--from-profile <profile-id>",
      "--kind <text|status|system_notice>",
      "--json",
      "--password <value>",
      SPACE_GATEWAY_PARENT_OPTION_TEXT,
      "--profile <profile-id>",
    ],
    thread: [
      "--password <value>",
      SPACE_GATEWAY_PARENT_OPTION_TEXT,
      "--profile <profile-id>",
    ],
    password: [SPACE_GATEWAY_PARENT_OPTION_TEXT, "--profile <profile-id>"],
  };
  const commandByCommand: Record<SpaceSubcommandTarget, string> = {
    send: "openmeld space [--gateway-url <url>] send [--profile <profile-id>] <space-id> [<text...>|--stdin|--text-file <path>] [--file <path>...] [--plain] [--password <value>]",
    history: SPACE_HISTORY_USAGE,
    thread:
      "openmeld space [--gateway-url <url>] thread [--profile <profile-id>] <space-id> <thread-id> [--password <value>]",
    password:
      "openmeld space [--gateway-url <url>] password [--profile <profile-id>] <space-id> (--password <value>|--clear)",
  };
  const summaryByCommand: Record<SpaceSubcommandTarget, string> = {
    send: "openmeld space send requires explicit positional arguments in agent view.",
    history:
      "openmeld space history requires explicit positional arguments in agent view.",
    thread:
      "openmeld space thread requires a space ID and a thread ID in agent view.",
    password:
      "openmeld space password needs a space ID and one action (--password or --clear) in agent view.",
  };
  const humanStepsByCommand: Record<SpaceSubcommandTarget, string[]> = {
    send: ["openmeld view human", "openmeld space"],
    history: ["openmeld view human", "openmeld space"],
    thread: ["openmeld view human", "openmeld space"],
    password: [
      "openmeld view human",
      "openmeld space",
      'Select "Configure a space" -> "Password" and pick the target space by name',
    ],
  };

  return new DualViewGuideError({
    code: `space.${command}.arguments.required`,
    guide: {
      summary: summaryByCommand[command],
      humanSteps: humanStepsByCommand[command],
      agentRequiredArgs: requiredArgsByCommand[command],
      agentOptionalArgs: optionalArgsByCommand[command],
      agentCommands: [
        "openmeld space [--gateway-url <url>] list [--profile <profile-id>] [--limit <n>] [--json]",
        commandByCommand[command],
        "openmeld space [--gateway-url <url>] join [--profile <profile-id>] <space-id> [--history-limit <n>] [--output text|ndjson]",
      ],
    },
  });
}

export function createSpaceProfileRequiredGuideError() {
  return new DualViewGuideError({
    code: "space.profile.required",
    guide: {
      summary:
        "No selected OpenMeld profile is available for this command in the current OpenMeld CLI context.",
      humanSteps: [
        "If this is an interactive human terminal: run `openmeld whoami`, confirm the current profile, then retry.",
        "If no usable profile exists yet, create one first.",
      ],
      agentRequiredArgs: [
        "--profile <profile-id> when no selected profile exists",
      ],
      agentOptionalArgs: ["--view <auto|human|agent>"],
      agentCommands: [
        "openmeld profiles list --view agent",
        "openmeld profiles create <profile-name> --kind agent --view agent",
        "openmeld profiles set <profile-id> --view agent",
        "openmeld whoami --profile <profile-id> --view agent",
        "openmeld space create --profile <profile-id> --name <space-name> --view agent",
        "openmeld space join --profile <profile-id> <space-id> --view agent",
      ],
      notes: [
        "This error is about the selected OpenMeld profile state, not the sign-in state.",
        "In non-TTY/isolated sessions, always pass --profile explicitly.",
      ],
    },
    hints: [
      "openmeld profiles create <profile-name> --kind agent --view agent",
      "openmeld profiles set <profile-id> --view agent",
      "openmeld space create --profile <profile-id> --name <space-name> --view agent",
    ],
  });
}

export function createSpaceAgentProfileOnlyGuideError(input: {
  profileId: string;
  profileKind: string;
}) {
  return new DualViewGuideError({
    code: "space.profile.agent_only",
    guide: {
      summary: `this Space operation requires an Agent Profile (received ${input.profileKind}:${input.profileId}).`,
      humanSteps: [
        "Use a Human Profile when acting for the user.",
        "Use an Agent Profile only when the operation needs an AI teammate identity.",
      ],
      agentRequiredArgs: ["--profile <agent-profile-id>"],
      agentOptionalArgs: ["--view <agent|human|auto>"],
      agentCommands: [
        "openmeld profiles list --view agent",
        "openmeld profiles set <agent-profile-id> --view agent",
        "openmeld space join <space-id> --profile <agent-profile-id> --view agent",
        "openmeld space send <space-id> [<text...>|--stdin|--text-file <path>] [--file <path>...] --profile <agent-profile-id> --view agent",
      ],
      notes: [
        "First run `openmeld profiles list --view agent` to find an agent profile ID.",
        "Then rerun the space command with `--profile <agent-profile-id>`.",
        "`--view agent` controls output format. The command-specific operation decides whether a Human Profile or Agent Profile is valid.",
      ],
    },
    hints: [
      "openmeld profiles list --view agent",
      "openmeld profiles set <agent-profile-id> --view agent",
      "openmeld view human",
    ],
  });
}

export function createSpaceUnsupportedProfileKindGuideError(input: {
  profileId: string;
  profileKind: string;
}) {
  return new DualViewGuideError({
    code: "space.profile.unsupported_kind",
    guide: {
      summary: `Space commands require a human or agent profile (received ${input.profileKind}:${input.profileId}).`,
      humanSteps: [
        "Choose a human profile when you are acting for the user.",
        "Choose an agent profile when that agent identity should speak, be added, or be woken in the Space.",
      ],
      agentRequiredArgs: ["--profile <human-or-agent-profile-id>"],
      agentOptionalArgs: ["--view <agent|human|auto>"],
      agentCommands: [
        "openmeld profiles list --view agent",
        "openmeld space list --profile <profile-id> --view agent",
        "openmeld space history <space-id> --profile <profile-id> --kind text --limit 20 --view agent",
      ],
      notes: [
        "`--view agent` controls machine-readable output. It does not require the acting identity to be an Agent Profile.",
        "System profiles are internal and cannot be used as the acting identity for Space commands.",
      ],
    },
    hints: [
      "openmeld profiles list --view agent",
      "openmeld space list --profile <profile-id> --view agent",
    ],
  });
}

export function createSpaceAddMembersCurrentProfileGuideError(input: {
  profileId: string;
}) {
  return new DualViewGuideError({
    code: "space.add_members.current_profile_join_required",
    guide: {
      summary:
        "Current profile joins a space with `openmeld space join`, not `add-members`.",
      humanSteps: [
        "Stay on the current profile and join the Space directly.",
        "Use add-members only for other profiles you want to bring with you.",
      ],
      agentRequiredArgs: ["<space-id>", `--profile ${input.profileId}`],
      agentOptionalArgs: ["--view <agent|human|auto>"],
      agentCommands: [
        `openmeld space join <space-id> --profile ${input.profileId} --view agent`,
        `openmeld space send <space-id> "hello" --profile ${input.profileId} --view agent`,
      ],
      notes: [
        "add-members is only for additional profiles, not the profile that is currently acting.",
      ],
    },
    hints: [
      `openmeld space join <space-id> --profile ${input.profileId} --view agent`,
    ],
  });
}

export function createSpaceRemoveMembersCurrentProfileGuideError(input: {
  profileId: string;
}) {
  return new DualViewGuideError({
    code: "space.remove_members.current_profile_forbidden",
    guide: {
      summary:
        "Current profile cannot remove itself from a space with `remove-members`. Use `openmeld space leave` instead.",
      humanSteps: [
        "Use `openmeld space leave` when the current profile should exit the space.",
        "Use `remove-members` only for other members.",
        "If you need a different cleanup action, switch to another owned profile first.",
      ],
      agentRequiredArgs: ["<space-id>", `--profile ${input.profileId}`],
      agentOptionalArgs: ["--view <agent|human|auto>"],
      agentCommands: [
        `openmeld space leave <space-id> --profile ${input.profileId} --view agent`,
        `openmeld space history <space-id> --profile ${input.profileId} --kind text --limit 20 --view agent`,
      ],
      notes: [
        "self-removal is blocked for remove-members; leave is the self-exit command.",
      ],
    },
    hints: [
      `openmeld space leave <space-id> --profile ${input.profileId} --view agent`,
    ],
  });
}

export function createSpaceLeaveCreatorGuideError(input: {
  spaceId?: string;
  message?: string;
}) {
  const spaceArg = input.spaceId?.trim() || "<space-id>";
  return new DualViewGuideError({
    code: "space.leave.creator_forbidden",
    guide: {
      summary:
        input.message ??
        "The space creator cannot leave this space. Delete the space instead when only you remain.",
      humanSteps: [
        "If you are done with the space and only you remain, delete the space.",
        "If other members still need it, keep the creator profile in the space.",
      ],
      agentRequiredArgs: ["<space-id>", "--profile <creator-profile-id>"],
      agentOptionalArgs: ["--view <agent|human|auto>"],
      agentCommands: [
        `openmeld space delete ${spaceArg} --profile <creator-profile-id> --view human`,
        `openmeld space status ${spaceArg} --profile <creator-profile-id> --view agent`,
      ],
      notes: [
        "Core is the authority for creator leave checks; CLI only presents the result.",
      ],
    },
    hints: [
      `openmeld space delete ${spaceArg} --profile <creator-profile-id> --view human`,
    ],
  });
}

export function createSpaceRemoveMembersCreatorGuideError(input?: {
  profileId?: string;
}) {
  const creatorProfileId = input?.profileId?.trim();
  return new DualViewGuideError({
    code: "space.remove_members.creator_forbidden",
    guide: {
      summary: "The space creator cannot be removed from this space.",
      humanSteps: [
        "Remove other members instead of the space creator.",
        "If the goal is to retire the space, delete the space from a human owner session.",
      ],
      agentRequiredArgs: ["<space-id>"],
      agentOptionalArgs: [
        "--member <other-profile-id...>",
        "--all",
        "--profile <profile-id>",
      ],
      agentCommands: [
        "openmeld space remove-members <space-id> --profile <profile-id> --member <other-profile-id> --view agent",
        "openmeld view human",
        "openmeld space delete <space-id>",
      ],
      notes: [
        ...(creatorProfileId
          ? [`blocked creator profile: ${creatorProfileId}`]
          : []),
      ],
    },
    hints: [
      "openmeld space remove-members <space-id> --profile <profile-id> --member <other-profile-id> --view agent",
      "openmeld view human",
      "openmeld space delete <space-id>",
    ],
  });
}

export function createSpaceSendInputRequiredGuideError() {
  return new DualViewGuideError({
    code: "send.input.required",
    guide: {
      summary:
        "openmeld space send requires message text or at least one --file <path>.",
      humanSteps: [
        'Use quick text: openmeld space send <space-id> "hello"',
        "Or pipe stdin: echo 'hello' | openmeld space send <space-id> --stdin",
        "Or read message text from a file: openmeld space send <space-id> --text-file /tmp/message.txt",
        "Or share a file without filler text: openmeld space send <space-id> --file /tmp/launch-brief.pdf",
      ],
      agentRequiredArgs: ["exactly one input source"],
      agentOptionalArgs: [
        SPACE_GATEWAY_PARENT_OPTION_TEXT,
        "--profile <profile-id>",
      ],
      agentCommands: [
        'openmeld space send --profile <profile-id> <space-id> "hello"',
        "cat /tmp/message.txt | openmeld space send --profile <profile-id> <space-id> --stdin",
        "openmeld space send --profile <profile-id> <space-id> --text-file /tmp/message.txt",
        "openmeld space send --profile <profile-id> <space-id> --file /tmp/launch-brief.pdf",
        'openmeld space send --profile <profile-id> <space-id> --plain "literal @Agent(wake) text"',
      ],
      notes: [
        "Prefer --stdin/--text-file for multiline or shell-sensitive message text.",
        "Use repeatable --file options to share up to 10 Space Files with or without message text.",
        "Use --plain only when @Name(wake) or @Name(reference) should be sent as literal text.",
      ],
    },
  });
}

export function createSpaceSendInputConflictGuideError() {
  return new DualViewGuideError({
    code: "send.input.conflict",
    guide: {
      summary:
        "openmeld space send received conflicting message text sources. Use only one of: <text...>, --stdin, --text-file <path>.",
      humanSteps: [
        "Pick only one source per command.",
        "Remove extra input flags and retry.",
      ],
      agentRequiredArgs: ["exactly one input source"],
      agentCommands: [
        'openmeld space send --profile <profile-id> <space-id> "hello"',
        "openmeld space send --profile <profile-id> <space-id> --stdin",
        "openmeld space send --profile <profile-id> <space-id> --text-file /tmp/message.txt",
        'openmeld space send --profile <profile-id> <space-id> --plain "literal @Agent(wake) text"',
      ],
      notes: [
        "Do not combine positional text with --stdin or --text-file.",
        "A --file attachment may be combined with any one message text source.",
        "Use --plain only when @Name(wake) or @Name(reference) should be sent as literal text.",
      ],
    },
  });
}

export function createSpaceSendInputFileReadFailedGuideError(
  path: string,
  reason: string
) {
  return new DualViewGuideError({
    code: "send.input.file_read_failed",
    guide: {
      summary: `failed to read send input file: ${path}`,
      humanSteps: [
        "Check file path and permissions.",
        "Retry with a readable UTF-8 text file.",
      ],
      agentRequiredArgs: ["--text-file <path> must exist and be readable"],
      agentCommands: [
        "ls -l <path>",
        "cat <path>",
        "openmeld space send --profile <profile-id> <space-id> --text-file <path>",
      ],
      notes: [`read error: ${reason}`],
    },
  });
}

export function createSpaceSendInputEmptyGuideError() {
  return new DualViewGuideError({
    code: "send.input.empty",
    guide: {
      summary: "send input is empty after normalization.",
      humanSteps: [
        "Provide non-empty text.",
        "For stdin/file mode, ensure content is not blank.",
      ],
      agentRequiredArgs: ["non-empty message text"],
      agentCommands: [
        'openmeld space send --profile <profile-id> <space-id> "hello"',
        "echo 'hello' | openmeld space send --profile <profile-id> <space-id> --stdin",
      ],
    },
  });
}

export function createProfileMenuGuideError() {
  return new DualViewGuideError({
    code: "profile.menu.interactive.required",
    guide: {
      summary: "openmeld profiles menu is interactive in human view only.",
      humanSteps: ["openmeld view human", "openmeld profile"],
      agentRequiredArgs: [
        "set: <profile-id> (or --profile <id>)",
        "delete: <profile-id> (or --profile <id>)",
        "delete in non-interactive mode: --force",
      ],
      agentOptionalArgs: ["--view <auto|human|agent>"],
      agentCommands: [
        "openmeld profiles create <profileName> --kind agent [--name <profileName>]",
        "openmeld start --view human",
        "openmeld profiles list | openmeld profiles ls",
        "openmeld profiles show <profile-id> [--profile <id>]",
        "openmeld profiles set <profile-id> [--profile <id>]",
        "openmeld profiles update <profile-id> [--profile <id>] [--name <profileName>] [--workspace-mode <openmeld-managed|custom>] [--workspace-path <path>]",
        "openmeld profiles delete <profile-id> [--profile <id>] --force",
      ],
    },
    hints: [
      "openmeld view human",
      "openmeld profile",
      "openmeld profiles list",
      "openmeld profiles set <profile>",
    ],
  });
}

export function createProfileCreateGuideError(summary: string) {
  return new DualViewGuideError({
    code: "profile.create.arguments.required",
    guide: {
      summary: `openmeld profiles create: ${summary}`,
      humanSteps: [
        "openmeld view human",
        "openmeld profile",
        "Select: Create profile -> Profile kind (Human or Agent) -> Profile name",
      ],
      agentRequiredArgs: [
        "--kind agent",
        "<profileName> (positional) or --name <profileName>",
      ],
      agentOptionalArgs: ["--view <auto|human|agent>"],
      agentCommands: [
        "openmeld profiles create <profileName> --kind agent --view agent",
        "openmeld profiles list --view agent",
        "openmeld profiles set <profile-id> --view agent",
        "openmeld whoami --profile <profile-id> --view agent",
        "openmeld space create --profile <profile-id> --name <space-name> --view agent",
        "openmeld space join --profile <profile-id> <space-id> --view agent",
      ],
      notes: [
        "agent view can only create agent profiles for the current authenticated owner.",
        "to create a human profile, switch to human view first.",
        "created profiles always include ownerUserId from the authenticated session.",
      ],
    },
  });
}

export function createProfileActionGuideError(
  action: ProfileAction,
  summary: string,
  _examples?: ProfileActionGuideExamples
) {
  const requiredArgsByAction: Record<ProfileAction, string[]> = {
    show: ["<profile-id> (positional) or --profile <id>"],
    set: ["<profile-id> (positional) or --profile <id>"],
    delete: [
      "<profile-id> (positional) or --profile <id>",
      "--force (required in non-interactive mode)",
    ],
    update: [
      "<profile-id> (positional) or --profile <id>",
      "at least one update field: --name or --workspace-mode",
    ],
  };

  const commandByAction: Record<ProfileAction, string> = {
    show: "openmeld profiles show <profile-id> [--profile <id>] [--view <auto|human|agent>]",
    set: "openmeld profiles set <profile-id> [--profile <id>] [--view <auto|human|agent>]",
    delete:
      "openmeld profiles delete <profile-id> [--profile <id>] --force [--view <auto|human|agent>]",
    update:
      "openmeld profiles update <profile-id> [--profile <id>] [--name <profileName>] [--workspace-mode <openmeld-managed|custom>] [--workspace-path <path>] [--view <auto|human|agent>]",
  };

  return new DualViewGuideError({
    code: `profile.${action}.arguments.required`,
    guide: {
      summary: `openmeld profiles ${action}: ${summary}`,
      humanSteps: ["openmeld view human", "openmeld profile"],
      agentRequiredArgs: requiredArgsByAction[action],
      agentOptionalArgs: ["--view <auto|human|agent>"],
      agentCommands: [
        commandByAction[action],
        "openmeld profiles list",
        "openmeld start --view human",
        "openmeld start --kind agent --profile-id <existing-agent-profile-id>",
        "openmeld start --kind agent --profile-name <new-agent-profile-name>",
      ],
    },
  });
}

export function createSkillsMenuGuideError(input: {
  storeDir: string;
  knownAgentIds: string[];
  agentExampleArg?: string;
  skills: Array<{
    id: string;
    name: string;
    relativePath: string;
    absolutePath: string;
  }>;
}) {
  const agentExampleArg = normalizeGuideExample(
    input.agentExampleArg,
    "<id...>"
  );
  const notes = [`OpenMeld skills store: ${input.storeDir}`];
  if (input.knownAgentIds.length > 0) {
    notes.push(`known agent ids: ${input.knownAgentIds.join(", ")}`);
  } else {
    notes.push("known agent ids: none detected");
  }

  if (input.skills.length > 0) {
    notes.push("local OpenMeld skills:");
    for (const skill of input.skills) {
      notes.push(`  - ${skill.name} (${skill.relativePath})`);
    }
  } else {
    notes.push("local OpenMeld skills: none");
  }

  return new DualViewGuideError({
    code: "skills.menu.interactive.required",
    guide: {
      summary: "openmeld skills menu is interactive in human view only.",
      humanSteps: ["openmeld view human", "openmeld skills"],
      agentCommands:
        getCommandHintsFromContract({
          context: {
            agentExampleArg,
            knownAgentIds: input.knownAgentIds,
            skills: input.skills.map((skill) => ({
              name: skill.name,
              relativePath: skill.relativePath,
            })),
            storeDir: input.storeDir,
          },
          entryName: "skills.menu",
        }) ?? [],
      notes,
    },
    hints: [
      "openmeld view human",
      "openmeld skills",
      "openmeld skills list",
      "openmeld skills check",
      "openmeld skills update",
      "openmeld skills install --all",
    ],
  });
}

export function createSkillsActionGuideError(input: {
  action: "ensure" | "install" | "uninstall";
  agentExampleArg?: string;
}) {
  return createGuideErrorFromContract({
    context: {
      agentExampleArg: normalizeGuideExample(input.agentExampleArg, "<id...>"),
    },
    guideScenario: getRequiredCommandGuideScenario(`skills.${input.action}`),
  });
}

function normalizeGuideExample(
  value: string | undefined,
  fallback: string
): string {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : fallback;
}

export function createSpaceAliasTargetGuideError(command: SpaceAliasCommand) {
  const requiredArgsByCommand: Record<SpaceAliasCommand, string[]> = {
    send: ["--space <space-id>", "message text and/or --file <path>"],
    tail: ["--space <space-id>"],
  };
  const optionalArgsByCommand: Record<SpaceAliasCommand, string[]> = {
    send: [
      "--profile <id>",
      "--base-url <url>",
      "--password <value>",
      "--stdin",
      "--text-file <path>",
      "--file <path> (repeatable, max 10)",
    ],
    tail: [
      "--profile <id>",
      "--base-url <url>",
      "--password <value>",
      "--limit <n>",
      "--json",
    ],
  };
  const commandByAlias: Record<SpaceAliasCommand, string> = {
    send: "openmeld send [<text...>|--stdin|--text-file <path>] [--file <path>...] --space <space-id> [--plain] [--password <value>] [--profile <id>] [--base-url <url>]",
    tail: "openmeld tail --space <space-id> [--limit <n>] [--after-signal <signal-id>] [--around-signal <signal-id> --before <n> --after <n>] [--from-profile <profile-id>] [--kind <text|status|system_notice>] [--json] [--password <value>] [--profile <id>] [--base-url <url>]",
  };
  const preferredCommand: Record<SpaceAliasCommand, string> = {
    send: "openmeld space [--gateway-url <url>] send [--profile <profile-id>] <space-id> [<text...>|--stdin|--text-file <path>] [--file <path>...] [--plain] [--password <value>]",
    tail: SPACE_HISTORY_USAGE,
  };

  return new DualViewGuideError({
    code: `space.${command}.alias.target.required`,
    guide: {
      summary: `openmeld ${command} requires explicit --space argument in agent view.`,
      humanSteps: ["openmeld view human", "openmeld space"],
      agentRequiredArgs: requiredArgsByCommand[command],
      agentOptionalArgs: optionalArgsByCommand[command],
      agentCommands: [commandByAlias[command], preferredCommand[command]],
      notes: ["Alias command detected. Prefer `openmeld space ...` commands."],
    },
  });
}

export function createResetConfirmationGuideError() {
  return new DualViewGuideError({
    code: "reset.confirmation.required",
    guide: {
      summary:
        "openmeld reset in agent view requires explicit confirmation flag.",
      humanSteps: ["openmeld view human", "openmeld reset"],
      agentRequiredArgs: ["--yes"],
      agentCommands: ["openmeld reset --yes"],
      notes: [
        "`openmeld reset` is destructive. Keep `--yes` explicit in agent view.",
      ],
    },
    hints: ["openmeld reset --yes"],
  });
}

export function createUpgradeConfirmationGuideError(
  scenario: UpgradeConfirmationScenario
) {
  const summary =
    scenario === "outdated"
      ? "openmeld upgrade in agent view requires --yes before installing updates."
      : "openmeld upgrade in agent view requires --yes when version check fails.";

  const notes =
    scenario === "outdated"
      ? [
          "Use `openmeld upgrade --check` to inspect versions without installing.",
        ]
      : [
          "Use `openmeld upgrade --check` to inspect status first.",
          "When check fails, install requires explicit `--yes` in agent view.",
        ];

  return new DualViewGuideError({
    code: `upgrade.confirmation.required.${scenario}`,
    guide: {
      summary,
      humanSteps: ["openmeld view human", "openmeld upgrade"],
      agentRequiredArgs: ["--yes"],
      agentOptionalArgs: ["--check"],
      agentCommands: ["openmeld upgrade --yes", "openmeld upgrade --check"],
      notes,
    },
    hints: ["openmeld upgrade --yes", "openmeld upgrade --check"],
  });
}

export function createStartAuthenticationGuideError() {
  return new DualViewGuideError({
    code: "start.auth.required",
    guide: {
      summary:
        "openmeld start requires sign-in before OpenMeld profile selection.",
      humanSteps: ["openmeld view human", "openmeld login", "openmeld start"],
      agentCommands: [
        "openmeld auth status --view agent",
        "openmeld login --view agent --method ott --ott <token>",
        "openmeld start --view agent",
      ],
      notes: [
        "If a human is operating this terminal, switch to human view first.",
      ],
    },
    hints: ["openmeld login", "openmeld auth status", "openmeld start"],
  });
}

export function createAuthLoginGuideError(summary: string) {
  return createGuideErrorFromContract({
    context: {
      includeViewFlag: true,
      summary,
    },
    guideScenario: getRequiredCommandGuideScenario("auth.login"),
  });
}

function getRequiredCommandGuideScenario(
  entryName:
    | "auth.login"
    | "skills.ensure"
    | "skills.install"
    | "skills.uninstall"
    | "space.add-agents"
    | "space.add-human-profiles"
    | "space.add-members"
    | "space.remove-members"
) {
  const contract = getCommandEntryContract(entryName);
  const guideScenario = contract?.guideScenarios?.required;
  if (!guideScenario) {
    throw new Error(`missing required guide scenario for ${entryName}`);
  }
  return guideScenario;
}

export function createDoctorFailedGuideError() {
  return new DualViewGuideError({
    code: "doctor.summary.failed",
    guide: {
      summary: "openmeld doctor detected one or more failed checks.",
      humanSteps: ["openmeld view human", "openmeld doctor"],
      agentOptionalArgs: ["--profile <id>", "--gateway-url <url>"],
      agentCommands: [
        "openmeld doctor --view agent [--profile <id>] [--gateway-url <url>]",
        "openmeld whoami --view agent",
        "openmeld auth status --view agent",
      ],
      notes: [
        "Inspect preceding `doctor.check.fail` outputs for exact failure details.",
      ],
    },
  });
}
