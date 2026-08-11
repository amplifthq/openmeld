import process from "node:process";

const OPENMELD_CLI_COMMAND = "openmeld";
const OPENMELD_CLI_NPX_COMMAND = "npx -y openmeld@latest";
const OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND_ENV =
  "OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND";
const OPENMELD_USER_FACING_CLI_COMMAND_ENV = "OPENMELD_USER_FACING_CLI_COMMAND";
const OPENMELD_TOP_LEVEL_COMMANDS = [
  "adapter",
  "agents",
  "auth",
  "computer",
  "daemon",
  "doctor",
  "help",
  "login",
  "profile",
  "profiles",
  "prompt",
  "reset",
  "send",
  "service",
  "setup",
  "skills",
  "space",
  "start",
  "tail",
  "upgrade",
  "view",
  "whoami",
] as const;
const OPENMELD_COMMAND_PREFIX_RE = /^openmeld(?=$|\s)/u;
const OPENMELD_COMMAND_LINE_RE =
  /^(?<prefix>\s*(?:(?:[$*-])\s+|\d+\)\s+)??)(?<command>openmeld(?=$|\s).*)$/u;
const OPENMELD_COMMAND_AFTER_PIPE_RE =
  /^(?<prefix>.*\|\s+)(?<command>openmeld(?=$|\s).*)$/u;
const INLINE_OPENMELD_COMMAND_RE = /`(openmeld(?: [^`]*)?)`/gu;
const CLI_OPTION_NAME_RE = /^[a-z][a-z0-9-]*$/u;
const FIRST_CLI_OPERAND_OR_OPTION_RE =
  /^(?<commandPath>.*?)(?<tail>\s+(?:--|<).*)$/u;
const INLINE_OPENMELD_TOP_LEVEL_MENTION_RE = new RegExp(
  `\\bats (?<command>${OPENMELD_TOP_LEVEL_COMMANDS.join("|")})\\b`,
  "gu"
);
const NEWLINE_SPLIT_RE = /\r?\n/u;
const WHITESPACE_SPLIT_RE = /\s+/u;
const PROFILE_AWARE_TOP_LEVEL_COMMANDS = new Set(["whoami"]);
const PROFILE_AWARE_SPACE_COMMANDS = new Set([
  "add-me",
  "add-agents",
  "add-human-profiles",
  "add-members",
  "contract",
  "create",
  "delete",
  "guide",
  "history",
  "join",
  "leave",
  "list",
  "password",
  "publication",
  "remove-members",
  "result",
  "send",
  "status",
  "updates",
  "watch",
]);
const SPACE_PARENT_OPTIONS_WITH_VALUE = new Set(["--gateway-url"]);

type CliEntryCommandInput = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
};

type ProfileAwareCliCommandInput = CliEntryCommandInput & {
  profileId?: string | null;
  resolvedView?: "human" | "agent" | string;
};

export function resolveUserFacingCliEntryCommand(
  input: CliEntryCommandInput = {}
): string {
  const env = input.env ?? process.env;
  const explicitCommand = normalizeText(
    env[OPENMELD_USER_FACING_CLI_COMMAND_ENV]
  );
  if (explicitCommand.length > 0) {
    return explicitCommand;
  }
  return isNpxCliInvocation(input)
    ? OPENMELD_CLI_NPX_COMMAND
    : OPENMELD_CLI_COMMAND;
}

export function resolveSetupFollowUpCliEntryCommand(
  input: CliEntryCommandInput = {}
): string {
  const env = input.env ?? process.env;
  const setupCommand = normalizeText(
    env[OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND_ENV]
  );
  if (setupCommand.length > 0) {
    return setupCommand;
  }
  return resolveUserFacingCliEntryCommand(input);
}

export function formatOpenMeldCliCommand(
  command: string,
  input: CliEntryCommandInput = {}
): string {
  if (!OPENMELD_COMMAND_PREFIX_RE.test(command)) {
    return command;
  }
  return command.replace(
    OPENMELD_COMMAND_PREFIX_RE,
    resolveUserFacingCliEntryCommand(input)
  );
}

export function formatOpenMeldCliCommands(
  commands: string[],
  input: CliEntryCommandInput = {}
): string[] {
  return commands.map((command) => formatOpenMeldCliLine(command, input));
}

export function formatProfileAwareOpenMeldCliCommand(
  command: string,
  input: ProfileAwareCliCommandInput = {}
): string {
  return formatOpenMeldCliCommand(
    applyProfileAwareCommandScope(command, input),
    input
  );
}

export function formatProfileAwareOpenMeldCliCommands(
  commands: string[],
  input: ProfileAwareCliCommandInput = {}
): string[] {
  return commands.map((command) =>
    formatProfileAwareOpenMeldCliCommand(command, input)
  );
}

export function formatInlineOpenMeldCliCommands(
  text: string,
  input: CliEntryCommandInput = {}
): string {
  return text.replace(INLINE_OPENMELD_COMMAND_RE, (_, command: string) => {
    return `\`${formatOpenMeldCliCommand(command, input)}\``;
  });
}

export function formatOpenMeldCliLine(
  text: string,
  input: CliEntryCommandInput = {}
): string {
  const inlineFormatted = formatInlineOpenMeldCliCommands(text, input);
  const lineMatch = OPENMELD_COMMAND_LINE_RE.exec(inlineFormatted);
  if (lineMatch?.groups?.command) {
    return formatBareOpenMeldCliMentions(
      `${lineMatch.groups.prefix ?? ""}${formatOpenMeldCliCommand(
        lineMatch.groups.command,
        input
      )}`,
      input
    );
  }

  const pipeMatch = OPENMELD_COMMAND_AFTER_PIPE_RE.exec(inlineFormatted);
  if (pipeMatch?.groups?.command) {
    return formatBareOpenMeldCliMentions(
      `${pipeMatch.groups.prefix}${formatOpenMeldCliCommand(
        pipeMatch.groups.command,
        input
      )}`,
      input
    );
  }

  return formatBareOpenMeldCliMentions(inlineFormatted, input);
}

export function formatOpenMeldCliTextBlock(
  text: string,
  input: CliEntryCommandInput = {}
): string {
  return text
    .split(NEWLINE_SPLIT_RE)
    .map((line) => formatOpenMeldCliLine(line, input))
    .join("\n");
}

function isNpxCliInvocation(input: CliEntryCommandInput): boolean {
  const env = input.env ?? process.env;
  const argv = input.argv ?? process.argv;
  const npmCommand = normalizeText(env.npm_command).toLowerCase();
  const npmExecPath = normalizePath(env.npm_execpath);
  const npmUserAgent = normalizeText(env.npm_config_user_agent).toLowerCase();
  const usesNpmExec =
    npmCommand === "exec" &&
    npmExecTargetIsOpenMeldCli(env) &&
    (npmUserAgent.startsWith("npm/") ||
      npmExecPath.includes("/npm/") ||
      npmExecPath.endsWith("/npm-cli.js"));
  if (usesNpmExec) {
    return true;
  }

  const scriptPath = normalizePath(argv[1]);
  return scriptPath.includes("/.npm/") && scriptPath.includes("_npx");
}

function npmExecTargetIsOpenMeldCli(env: NodeJS.ProcessEnv): boolean {
  // Every descendant of `npm exec` inherits npm_command=exec, so a openmeld
  // process spawned inside e.g. `npx vitest` carries the same env markers as
  // `npx openmeld`. npm records the resolved bin command it executed (quoted)
  // in npm_lifecycle_script; only that target proves openmeld itself was the
  // npx invocation.
  const execTarget = normalizeText(env.npm_lifecycle_script).replaceAll(
    '"',
    ""
  );
  return execTarget === OPENMELD_CLI_COMMAND;
}

function formatBareOpenMeldCliMentions(
  text: string,
  input: CliEntryCommandInput = {}
): string {
  return text.replace(
    INLINE_OPENMELD_TOP_LEVEL_MENTION_RE,
    (_, command: string) => {
      return formatOpenMeldCliCommand(`openmeld ${command}`, input);
    }
  );
}

function applyProfileAwareCommandScope(
  command: string,
  input: ProfileAwareCliCommandInput
): string {
  if (!OPENMELD_COMMAND_PREFIX_RE.test(command)) {
    return command;
  }

  let scopedCommand = command.trimEnd();
  const profileId = normalizeText(input.profileId ?? undefined);
  if (profileId.length > 0) {
    scopedCommand = appendCliOption(scopedCommand, "profile", profileId);
  }
  if (input.resolvedView === "agent") {
    scopedCommand = appendCliOption(scopedCommand, "view", "agent");
  }
  return scopedCommand;
}

function appendCliOption(
  command: string,
  optionName: string,
  value: string
): string {
  if (
    !CLI_OPTION_NAME_RE.test(optionName) ||
    hasCliOption(command, optionName)
  ) {
    return command;
  }
  if (optionName === "profile") {
    return insertCliOptionBeforeFirstOperandOrOption(
      command,
      optionName,
      value
    );
  }
  return `${command} --${optionName} ${value}`;
}

function insertCliOptionBeforeFirstOperandOrOption(
  command: string,
  optionName: string,
  value: string
): string {
  if (optionName !== "profile") {
    const match = FIRST_CLI_OPERAND_OR_OPTION_RE.exec(command);
    if (!(match?.groups?.commandPath && match.groups.tail)) {
      return `${command} --${optionName} ${value}`;
    }
    return `${match.groups.commandPath} --${optionName} ${value}${match.groups.tail}`;
  }

  const tokens = command.trim().split(WHITESPACE_SPLIT_RE);
  const insertionIndex = resolveProfileOptionInsertionIndex(tokens);
  if (insertionIndex === null) {
    return command;
  }
  return [
    ...tokens.slice(0, insertionIndex),
    `--${optionName}`,
    value,
    ...tokens.slice(insertionIndex),
  ].join(" ");
}

function hasCliOption(command: string, optionName: string): boolean {
  const optionPattern = new RegExp(`(?:^|\\s)--${optionName}(?:=|\\s|$)`, "u");
  return optionPattern.test(command);
}

function resolveProfileOptionInsertionIndex(tokens: string[]): number | null {
  if (tokens[0] !== OPENMELD_CLI_COMMAND) {
    return null;
  }
  const topLevelCommand = tokens[1] ?? "";
  if (PROFILE_AWARE_TOP_LEVEL_COMMANDS.has(topLevelCommand)) {
    return 2;
  }
  if (topLevelCommand !== "space") {
    return null;
  }

  let index = 2;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (SPACE_PARENT_OPTIONS_WITH_VALUE.has(token)) {
      index += 2;
      continue;
    }
    if (
      [...SPACE_PARENT_OPTIONS_WITH_VALUE].some((option) =>
        token.startsWith(`${option}=`)
      )
    ) {
      index += 1;
      continue;
    }
    break;
  }

  const spaceCommand = tokens[index] ?? "";
  if (!PROFILE_AWARE_SPACE_COMMANDS.has(spaceCommand)) {
    return null;
  }
  return index + 1;
}

function normalizePath(value: string | undefined): string {
  return normalizeText(value).replaceAll("\\", "/").toLowerCase();
}

function normalizeText(value: string | undefined): string {
  return String(value ?? "").trim();
}
