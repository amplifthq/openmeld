import { emitProfileAgentOverview } from "./profile/agent-overview";
import { emitSpaceCliAgentOverview } from "./space/agent-overview";

export function emitStartupAgentOverviewForCommand(input: {
  firstCommandToken: string | null;
  secondCommandToken: string | null;
  thirdCommandToken: string | null;
}): boolean {
  const profileCommand = resolveProfileAgentOverviewCommandFromTokens(input);
  if (profileCommand) {
    emitProfileAgentOverview(profileCommand);
    return true;
  }

  const spaceCommand = resolveSpaceAgentOverviewCommandFromTokens(input);
  if (spaceCommand) {
    emitSpaceCliAgentOverview(spaceCommand);
    return true;
  }
  return false;
}

function resolveProfileAgentOverviewCommandFromTokens(input: {
  firstCommandToken: string | null;
  secondCommandToken: string | null;
  thirdCommandToken?: string | null;
}): "menu" | "create" | "update" | "set" | "delete" | "list" | null {
  if (
    input.firstCommandToken !== "profile" &&
    input.firstCommandToken !== "profiles"
  ) {
    return null;
  }

  if (input.secondCommandToken === null) {
    return "menu";
  }

  if (input.secondCommandToken === "ls") {
    return "list";
  }

  switch (input.secondCommandToken) {
    case "create":
    case "update":
    case "set":
    case "delete":
    case "list":
      return input.secondCommandToken;
    default:
      return null;
  }
}

function resolveSpaceAgentOverviewCommandFromTokens(input: {
  firstCommandToken: string | null;
  secondCommandToken: string | null;
  thirdCommandToken: string | null;
}):
  | "watch"
  | "send"
  | "history"
  | "password"
  | "publication_set"
  | "guide"
  | "add_members"
  | "add_agents"
  | "add_human_profiles"
  | "remove_members"
  | "delete"
  | "list"
  | null {
  if (input.firstCommandToken === "send") {
    return "send";
  }

  if (input.firstCommandToken === "tail") {
    return "history";
  }

  if (
    input.firstCommandToken !== "space" &&
    input.firstCommandToken !== "spaces"
  ) {
    return null;
  }

  if (input.secondCommandToken === "ls") {
    return "list";
  }

  if (input.secondCommandToken === "publication") {
    return input.thirdCommandToken === "set" ? "publication_set" : null;
  }

  switch (input.secondCommandToken) {
    case "watch":
    case "send":
    case "history":
    case "password":
    case "guide":
    case "delete":
    case "list":
      return input.secondCommandToken;
    case "add-members":
    case "add-profiles":
      return "add_members";
    case "add-agents":
      return "add_agents";
    case "add-human-profiles":
      return "add_human_profiles";
    case "remove-members":
      return "remove_members";
    default:
      return null;
  }
}
