import { formatRemovedCcRelationMessage } from "@openmeld/space";

const ROOT_OPTIONS_WITH_VALUES = ["--service-auto-install", "--view"] as const;
const SPACE_OPTIONS_WITH_VALUES = [
  ...ROOT_OPTIONS_WITH_VALUES,
  "--gateway-url",
  "--profile",
] as const;
const SPACE_ACTION_REPLY_OPTIONS_WITH_VALUES = [
  ...SPACE_OPTIONS_WITH_VALUES,
  "--reference",
  "--wake",
] as const;
const OPTIONS_WITH_VALUES_BY_COMMAND_STAGE = [
  new Set<string>(ROOT_OPTIONS_WITH_VALUES),
  new Set<string>(SPACE_OPTIONS_WITH_VALUES),
  new Set<string>(SPACE_OPTIONS_WITH_VALUES),
  new Set<string>(SPACE_ACTION_REPLY_OPTIONS_WITH_VALUES),
] as const;
const COMMAND_TOKENS_BY_STAGE = [
  new Set(["space", "spaces"]),
  new Set(["action"]),
  new Set(["reply"]),
] as const;

type CommandStage = 0 | 1 | 2 | 3;

export function getRemovedCcCliInputMessage(
  argv: readonly string[]
): string | null {
  let commandStage: CommandStage = 0;
  let skipOptionValue = false;

  for (const arg of argv.slice(2)) {
    if (skipOptionValue) {
      skipOptionValue = false;
      continue;
    }
    if (arg === "--") {
      return null;
    }
    const optionsWithValues =
      OPTIONS_WITH_VALUES_BY_COMMAND_STAGE[commandStage];
    if (optionsWithValues.has(arg)) {
      skipOptionValue = true;
      continue;
    }
    if (hasInlineOptionValue(arg, optionsWithValues)) {
      continue;
    }
    if (commandStage === 3 && (arg === "--cc" || arg.startsWith("--cc="))) {
      return formatRemovedCcRelationMessage("--reference");
    }
    if (arg.startsWith("-")) {
      return null;
    }
    const nextCommandStage = advanceCommandStage(commandStage, arg);
    if (nextCommandStage === null) {
      return null;
    }
    commandStage = nextCommandStage;
  }

  return null;
}

function hasInlineOptionValue(
  arg: string,
  optionsWithValues: ReadonlySet<string>
): boolean {
  for (const option of optionsWithValues) {
    if (arg.startsWith(`${option}=`)) {
      return true;
    }
  }
  return false;
}

function advanceCommandStage(
  commandStage: CommandStage,
  arg: string
): CommandStage | null {
  if (commandStage === 3) {
    return commandStage;
  }
  if (!COMMAND_TOKENS_BY_STAGE[commandStage].has(arg)) {
    return null;
  }
  return (commandStage + 1) as CommandStage;
}
