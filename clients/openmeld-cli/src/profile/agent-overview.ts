import { formatAgentOverviewPayload } from "../runtime/agent-overview-payload";
import {
  createProfileActionGuideError,
  createProfileCreateGuideError,
  createProfileMenuGuideError,
} from "../runtime/dual-view-guide-catalog";
import { outJsonLine } from "../ui/io";

export type ProfileAgentOverviewCommand =
  | "menu"
  | "create"
  | "update"
  | "set"
  | "delete"
  | "list";

const PROFILE_MENU_STAGES = ["choose_subcommand", "run_subcommand"] as const;
const PROFILE_CREATE_STAGES = [
  "check_arguments",
  "authenticate",
  "create_profile",
  "select_profile",
  "optional_controller_setup",
] as const;
const PROFILE_UPDATE_STAGES = [
  "check_arguments",
  "authenticate",
  "resolve_profile",
  "validate_update",
  "apply_update",
] as const;
const PROFILE_SET_STAGES = [
  "check_arguments",
  "authenticate",
  "resolve_profile",
  "select_profile",
] as const;
const PROFILE_DELETE_STAGES = [
  "check_arguments",
  "authenticate",
  "resolve_profile",
  "confirm_delete",
  "delete_profile",
] as const;
const PROFILE_LIST_STAGES = ["authenticate", "list_profiles"] as const;

const PROFILE_CONTROLLER_MATCH_NOTE =
  "When assigning a controller to an agent profile, prefer the controller that matches the current runtime agent when supported. If unsupported, leave it unbound and tell the user.";

const PROFILE_LIST_COMMANDS = [
  "openmeld profiles list --view agent",
  "openmeld profiles create <profileName> --kind agent --view agent",
  "openmeld profiles set <profile-id> --view agent",
] as const;

const PROFILE_LIST_NOTES = [
  "Use explicit subcommands after listing profiles; agent view never opens the interactive profile menu.",
] as const;

export function emitProfileAgentOverview(
  command: ProfileAgentOverviewCommand
): void {
  outJsonLine({
    type: "result",
    code: `profile.${command}.agent_overview`,
    payload: formatAgentOverviewPayload(
      buildProfileAgentOverviewPayload(command)
    ),
  });
}

function buildProfileAgentOverviewPayload(
  command: ProfileAgentOverviewCommand
): {
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
      summary:
        "Use `openmeld profiles list --view agent` to inspect OpenMeld profiles with machine-readable output.",
      requiredArguments: [],
      optionalArguments: ["--view <auto|human|agent>"],
      commands: [...PROFILE_LIST_COMMANDS],
      stages: PROFILE_LIST_STAGES,
      notes: [...PROFILE_LIST_NOTES],
      humanActionRequired: {
        possible: false,
        steps: [],
      },
    };
  }

  const guide = resolveGuide(command).guide;
  const notes = [...(guide.notes ?? [])];

  if (command === "create" || command === "update") {
    notes.push(PROFILE_CONTROLLER_MATCH_NOTE);
  }

  return {
    summary: resolveSummary(command, guide.summary),
    requiredArguments: guide.agentRequiredArgs ?? [],
    optionalArguments: guide.agentOptionalArgs ?? [],
    commands: guide.agentCommands ?? [],
    stages: resolveStages(command),
    notes,
    humanActionRequired: {
      possible: (guide.humanSteps?.length ?? 0) > 0,
      steps: guide.humanSteps ?? [],
    },
  };
}

function resolveGuide(command: Exclude<ProfileAgentOverviewCommand, "list">) {
  switch (command) {
    case "menu":
      return createProfileMenuGuideError();
    case "create":
      return createProfileCreateGuideError(
        "agent view requires explicit agent create arguments."
      );
    case "update":
      return createProfileActionGuideError(
        "update",
        "explicit profile argument and update fields are required in agent view."
      );
    case "set":
      return createProfileActionGuideError(
        "set",
        "explicit profile argument is required in agent view."
      );
    case "delete":
      return createProfileActionGuideError(
        "delete",
        "explicit profile argument is required in agent view."
      );
    default:
      return createProfileMenuGuideError();
  }
}

function resolveStages(
  command: ProfileAgentOverviewCommand
): readonly string[] {
  switch (command) {
    case "menu":
      return PROFILE_MENU_STAGES;
    case "create":
      return PROFILE_CREATE_STAGES;
    case "update":
      return PROFILE_UPDATE_STAGES;
    case "set":
      return PROFILE_SET_STAGES;
    case "delete":
      return PROFILE_DELETE_STAGES;
    case "list":
      return PROFILE_LIST_STAGES;
    default:
      return PROFILE_MENU_STAGES;
  }
}

function resolveSummary(
  command: Exclude<ProfileAgentOverviewCommand, "list">,
  fallbackSummary: string
): string {
  switch (command) {
    case "menu":
      return "Use explicit `openmeld profiles` subcommands in agent view instead of the interactive menu.";
    case "create":
      return "Use `openmeld profiles create --view agent` with explicit arguments to create an agent profile deterministically.";
    case "update":
      return "Use `openmeld profiles update --view agent` with an explicit profile id and explicit fields to change one profile deterministically.";
    case "set":
      return "Use `openmeld profiles set --view agent` with an explicit profile id to switch the current OpenMeld profile deterministically.";
    case "delete":
      return "Use `openmeld profiles delete --view agent` with an explicit profile id and `--force` to delete profiles deterministically.";
    default:
      return fallbackSummary;
  }
}
