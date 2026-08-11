import { formatAgentOverviewPayload } from "../runtime/agent-overview-payload";
import {
  createSpaceAddMembersGuideError,
  createSpaceContractSetGuideError,
  createSpaceCreateGuideError,
  createSpaceDeleteHumanApprovalGuideError,
  createSpaceLeaveGuideError,
  createSpaceMenuGuideError,
  createSpacePublicationSetGuideError,
  createSpaceRemoveMembersGuideError,
  createSpaceResultGuideError,
  createSpaceSubcommandTargetGuideError,
  createSpaceTargetGuideError,
  createSpaceUpdatesGuideError,
} from "../runtime/dual-view-guide-catalog";
import type { Presenter } from "../runtime/presenter";
import { outJsonLine } from "../ui/io";
import { SPACE_ADD_MEMBERS_AGENT_OVERVIEW_STAGES } from "./add-members-progress-contract";

export type SpaceAgentOverviewCommand =
  | "menu"
  | "create"
  | "join"
  | "watch"
  | "send"
  | "history"
  | "contract"
  | "contract_set"
  | "publication_set"
  | "status"
  | "updates"
  | "result"
  | "password"
  | "guide"
  | "add_members"
  | "add_agents"
  | "add_human_profiles"
  | "remove_members"
  | "leave"
  | "delete"
  | "list";

const STAGES_BY_COMMAND: Record<SpaceAgentOverviewCommand, readonly string[]> =
  {
    menu: ["choose_subcommand", "run_subcommand"],
    create: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "service_check",
      "preflight",
      "create_space",
      "join_optional",
    ],
    join: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "service_check",
      "preflight",
      "role_context",
      "connect",
    ],
    watch: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "service_check",
      "resolve_target",
      "connect",
    ],
    send: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "preflight",
      "resolve_message",
      "send_message",
    ],
    history: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "read_history",
    ],
    contract: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "read_contract",
    ],
    contract_set: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "patch_contract",
    ],
    publication_set: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "verify_owner",
      "verify_space_password",
      "patch_contract",
    ],
    status: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "read_space_status",
    ],
    updates: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "read_updates",
    ],
    result: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "read_dispatch_result",
    ],
    password: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "resolve_target",
      "update_password",
    ],
    guide: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "resolve_target",
      "read_or_update_guide",
    ],
    add_members: SPACE_ADD_MEMBERS_AGENT_OVERVIEW_STAGES,
    add_agents: SPACE_ADD_MEMBERS_AGENT_OVERVIEW_STAGES,
    add_human_profiles: SPACE_ADD_MEMBERS_AGENT_OVERVIEW_STAGES,
    remove_members: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "resolve_target",
      "remove_members",
    ],
    leave: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "resolve_target",
      "confirm_human_view",
      "leave_space",
      "sync_profile_space_history",
    ],
    delete: [
      "check_arguments",
      "authenticate",
      "check_profile",
      "confirm_human_approval",
      "delete_space",
    ],
    list: ["authenticate", "check_profile", "list_spaces"],
  };

const SUMMARY_BY_COMMAND: Record<SpaceAgentOverviewCommand, string> = {
  menu: "Use explicit `openmeld space` subcommands in agent view instead of the interactive menu.",
  create:
    "Use `openmeld space create --view agent` to create a space with explicit arguments and machine-readable follow-up output.",
  join: "Use `openmeld space join --view agent` with an explicit space ID to connect deterministically.",
  watch:
    "Use `openmeld space watch --view agent` with an explicit space ID to read space activity deterministically.",
  send: "Use `openmeld space send --view agent` with an explicit space ID and explicit message input.",
  history:
    "Use `openmeld space history --kind text --brief --view agent` with an explicit space ID for conversation context. Use `--json` only when you need signal envelopes plus `messageReadProjection`.",
  contract:
    "Use `openmeld space contract --view agent` with an explicit space ID to read the current space contract deterministically.",
  contract_set:
    "Use `openmeld space contract set --view agent` with an explicit space ID and explicit patch flags to update the current space contract deterministically.",
  publication_set:
    "Use `openmeld space publication set --view agent` with an explicit Space ID, mode, owner profile, and Space password to change how agent output becomes visible.",
  status:
    "Use `openmeld space status --view agent` with an explicit space ID to read the current space status deterministically.",
  updates:
    "Use `openmeld space updates --view agent` with an explicit anchor signal to read formal post-anchor updates deterministically as signal envelopes plus `messageReadProjection`.",
  result:
    "Use `openmeld space result --view agent` with exactly one selector to read an archived dispatch result plus `messageReadProjection`. Use `openmeld service trace --view agent` to diagnose Wake execution and the final visible Space outcome.",
  password:
    "Use `openmeld space password --view agent` with an explicit space ID and one explicit password action.",
  guide:
    "Use `openmeld space guide --view agent` to read, `openmeld space guide set --view agent` to update, and `openmeld space guide clear --view agent` to clear the current space guide deterministically.",
  add_members:
    "Use `openmeld space add-members --profile <profile-id> <space-id> --member <profile-id...> --view agent` with explicit acting profile, Space ID, and member selection.",
  add_agents:
    "Use `openmeld space add-agents --profile <profile-id> <space-id> --agent-profile <agent-profile-id...> --view agent` with explicit acting profile, Space ID, and Agent Profile selection. This command only adds Agent Profiles.",
  add_human_profiles:
    "Use `openmeld space add-human-profiles --profile <profile-id> <space-id> --human-profile <human-profile-id...> --view agent` with explicit acting profile, Space ID, and Human Profile selection. This command only adds Human Profiles.",
  remove_members:
    "Use `openmeld space remove-members --profile <profile-id> <space-id> --member <profile-id...> --view agent` with explicit acting profile, Space ID, and member selection.",
  leave:
    "Use `openmeld space leave --view agent` with an explicit space ID to remove the current profile from a space.",
  delete:
    "Use `openmeld space delete --view agent` only to guide a human operator; deletion still needs human approval.",
  list: "Use `openmeld space list --view agent` to inspect known spaces for the current OpenMeld profile.",
};

const SPACE_LIST_COMMANDS = [
  "openmeld space list --profile <profile-id> --view agent",
  "openmeld space create --profile <profile-id> --name <space-name> --view agent",
  "openmeld space join --profile <profile-id> <space-id> --view agent",
] as const;

const SPACE_LIST_NOTES = [
  "List uses the current OpenMeld profile context. Pass --profile explicitly in isolated or non-persistent sessions.",
] as const;

export function emitSpaceAgentOverview(input: {
  presenter: Presenter;
  resolvedView: "human" | "agent";
  command: SpaceAgentOverviewCommand;
}): void {
  if (input.resolvedView !== "agent") {
    return;
  }

  input.presenter.data({
    code: `space.${input.command}.agent_overview`,
    payload: formatAgentOverviewPayload(
      buildSpaceAgentOverviewPayload(input.command)
    ),
  });
}

export function emitSpaceCliAgentOverview(
  command: SpaceAgentOverviewCommand
): void {
  outJsonLine({
    type: "result",
    code: `space.${command}.agent_overview`,
    payload: formatAgentOverviewPayload(
      buildSpaceAgentOverviewPayload(command)
    ),
  });
}

function buildSpaceAgentOverviewPayload(command: SpaceAgentOverviewCommand): {
  summary: string;
  requiredArguments: string[];
  optionalArguments: string[];
  commands: string[];
  stages: readonly string[];
  notes: string[];
  humanActionRequired: {
    possible: boolean;
    steps: string[];
  };
} {
  if (command === "list") {
    return {
      summary: SUMMARY_BY_COMMAND.list,
      requiredArguments: [],
      optionalArguments: [
        "--limit <n>",
        "--json",
        "parent option: openmeld space --gateway-url <url>",
        "--profile <profile-id>",
      ],
      commands: [...SPACE_LIST_COMMANDS],
      stages: STAGES_BY_COMMAND.list,
      notes: [...SPACE_LIST_NOTES],
      humanActionRequired: {
        possible: false,
        steps: [],
      },
    };
  }

  const guide = resolveGuide(command).guide;
  return {
    summary: SUMMARY_BY_COMMAND[command],
    requiredArguments: guide.agentRequiredArgs ?? [],
    optionalArguments: guide.agentOptionalArgs ?? [],
    commands: guide.agentCommands ?? [],
    stages: STAGES_BY_COMMAND[command],
    notes: guide.notes ?? [],
    humanActionRequired: resolveSpaceAgentOverviewHumanActionRequired({
      command,
      humanSteps: guide.humanSteps ?? [],
    }),
  };
}

function resolveSpaceAgentOverviewHumanActionRequired(input: {
  command: Exclude<SpaceAgentOverviewCommand, "list">;
  humanSteps: string[];
}): { possible: boolean; steps: string[] } {
  if (input.command !== "delete") {
    return {
      possible: false,
      steps: [],
    };
  }
  return {
    possible: input.humanSteps.length > 0,
    steps: input.humanSteps,
  };
}

function resolveGuide(command: Exclude<SpaceAgentOverviewCommand, "list">) {
  switch (command) {
    case "menu":
      return createSpaceMenuGuideError();
    case "create":
      return createSpaceCreateGuideError();
    case "join":
      return createSpaceTargetGuideError("join");
    case "watch":
      return createSpaceTargetGuideError("watch");
    case "send":
      return createSpaceSubcommandTargetGuideError("send");
    case "history":
      return createSpaceSubcommandTargetGuideError("history");
    case "contract":
      return createSpaceTargetGuideError("contract");
    case "contract_set":
      return createSpaceContractSetGuideError();
    case "publication_set":
      return createSpacePublicationSetGuideError();
    case "status":
      return createSpaceTargetGuideError("status");
    case "updates":
      return createSpaceUpdatesGuideError();
    case "result":
      return createSpaceResultGuideError();
    case "password":
      return createSpaceSubcommandTargetGuideError("password");
    case "guide":
      return createSpaceTargetGuideError("guide");
    case "add_members":
      return createSpaceAddMembersGuideError();
    case "add_agents":
      return createSpaceAddMembersGuideError(undefined, "space.add-agents");
    case "add_human_profiles":
      return createSpaceAddMembersGuideError(
        undefined,
        "space.add-human-profiles"
      );
    case "remove_members":
      return createSpaceRemoveMembersGuideError();
    case "leave":
      return createSpaceLeaveGuideError();
    case "delete":
      return createSpaceDeleteHumanApprovalGuideError();
    default:
      return createSpaceMenuGuideError();
  }
}
