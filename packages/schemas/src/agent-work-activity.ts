import type { AgentWorkActivity } from "./types/protocol/agent-stream";

const GITHUB_REPOSITORY_URL_PATTERN =
  /github\.com(?::|\/)([a-z\d](?:[a-z\d_.-]*[a-z\d])?)\/([a-z\d](?:[a-z\d_.-]*[a-z\d])?)(?:\.git)?(?=$|[\s'"/])/iu;
const GH_REPOSITORY_CLONE_PATTERN =
  /^gh\s+repo\s+clone\s+['"]?([a-z\d](?:[a-z\d_.-]*[a-z\d])?)\/([a-z\d](?:[a-z\d_.-]*[a-z\d])?)(?:\.git)?(?=$|[\s'"])/iu;
const GIT_SUFFIX_PATTERN = /\.git$/iu;
const GIT_BRANCH_ATTACHED_MUTATION_OPTION_PATTERN = /^-[cCdDmM].+/u;
const SHELL_ASSIGNMENT_PATTERN = /^[A-Z_][A-Z\d_]*=/iu;
const SHELL_WHITESPACE_PATTERN = /\s/u;
const UNSUPPORTED_SHELL_SYNTAX_PATTERN =
  /#|`|\$\(|<<|[<>]\(|\|\||(?:^|[^&])&(?:$|[^&])/u;
const SHELL_QUOTES = new Set(["'", '"', "`"]);
const SHELL_SEGMENT_SEPARATORS = new Set([";", "\n", "|", "&"]);
const SAFE_NEUTRAL_EXECUTABLES = new Set(["cd", "echo", "printf"]);
const CONNECTED_APP_WORK_KEYS = new Set<AgentWorkActivity["key"]>([
  "connected_app.action.execute",
  "connected_app.actions.read",
]);
const TEST_EXECUTABLES = new Set(["pytest", "vitest"]);
const QUALITY_EXECUTABLES = new Set(["biome", "eslint", "prettier", "tsc"]);
const BUILD_EXECUTABLES = new Set(["cargo", "go"]);
const INSTALL_EXECUTABLES = new Set(["cargo", "pip", "pip3"]);
const SEARCH_EXECUTABLES = new Set(["rg", "grep", "fd"]);
const READ_EXECUTABLES = new Set([
  "cat",
  "head",
  "less",
  "more",
  "sed",
  "tail",
]);
const REPOSITORY_CHECK_EXECUTABLES = new Set(["ls", "pwd", "test", "["]);
const PACKAGE_MANAGER_EXECUTABLES = new Set(["npm", "pnpm", "yarn", "bun"]);
const PACKAGE_MANAGER_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "--dir",
  "--filter",
  "--prefix",
]);
const GIT_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
]);
const FIND_EXECUTION_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const FD_EXECUTION_ACTIONS = new Set(["-x", "-X", "--exec", "--exec-batch"]);
const GIT_BRANCH_MUTATION_OPTIONS = new Set([
  "-c",
  "-C",
  "-d",
  "-D",
  "-m",
  "-M",
  "--copy",
  "--delete",
  "--edit-description",
  "--move",
  "--set-upstream-to",
  "--unset-upstream",
]);
const PIPX_INSTALL_COMMANDS = new Set([
  "inject",
  "install",
  "reinstall",
  "reinstall-all",
  "upgrade",
  "upgrade-all",
]);

type CommandWords = readonly string[];

export function resolveCommandAgentWorkActivity(
  command: string | null
): AgentWorkActivity | null {
  if (!command?.trim() || hasUnsupportedShellSyntax(command)) {
    return null;
  }
  let resolvedWork: AgentWorkActivity | null = null;
  for (const segment of splitShellSegments(command)) {
    if (hasUnquotedOutputRedirection(segment)) {
      return null;
    }
    const words = tokenizeShellWords(segment);
    if (isSafeNeutralCommand(words)) {
      continue;
    }
    const work = classifyCommandWords(words, segment);
    if (!work) {
      return null;
    }
    if (resolvedWork && !hasSameWorkMeaning(resolvedWork, work)) {
      return null;
    }
    resolvedWork = work;
  }
  return resolvedWork;
}

export function isAgentWorkActivityPresentable(
  work: AgentWorkActivity
): boolean {
  return (
    !CONNECTED_APP_WORK_KEYS.has(work.key) ||
    work.subject?.kind === "connected_app"
  );
}

export function isLegacyAgentActivityWorkCompatible(
  work: AgentWorkActivity | undefined
): boolean {
  return work?.subject?.kind !== "connected_app";
}

function classifyCommandWords(
  words: CommandWords,
  commandSegment: string
): AgentWorkActivity | null {
  if (hasUnquotedOutputRedirection(commandSegment)) {
    return null;
  }
  const normalizedWords = removeExecutionPrefixes(words);
  const executable = basename(normalizedWords[0] ?? "").toLowerCase();
  const args = normalizedWords.slice(1);
  if (!executable) {
    return null;
  }
  if (executable === "command") {
    if (args[0] === "-v" || args[0] === "-V") {
      return work("environment.check");
    }
    return classifyCommandWords(args, commandSegment);
  }
  if (executable === "git") {
    return classifyGitCommand(args, commandSegment);
  }
  if (executable === "gh" && args[0] === "repo" && args[1] === "clone") {
    return repositoryCloneWork(commandSegment);
  }
  if (PACKAGE_MANAGER_EXECUTABLES.has(executable)) {
    return classifyPackageManagerCommand(args);
  }
  return classifyDirectCommand(executable, args);
}

function classifyDirectCommand(
  executable: string,
  args: CommandWords
): AgentWorkActivity | null {
  if (isTestCommand(executable, args[0])) {
    return work("tests.run");
  }
  if (QUALITY_EXECUTABLES.has(executable)) {
    return work("quality.check");
  }
  if (BUILD_EXECUTABLES.has(executable) && args[0] === "build") {
    return work("build.run");
  }
  if (
    (INSTALL_EXECUTABLES.has(executable) &&
      ["add", "install"].includes(args[0] ?? "")) ||
    (executable === "pipx" && PIPX_INSTALL_COMMANDS.has(args[0] ?? ""))
  ) {
    return work("dependencies.install");
  }
  if (executable === "find") {
    return classifyFindCommand(args);
  }
  if (executable === "fd" && hasFdExecutionAction(args)) {
    return null;
  }
  if (SEARCH_EXECUTABLES.has(executable)) {
    return work("source.search");
  }
  if (executable === "sed" && isSedInPlace(args)) {
    return work("source.update");
  }
  if (READ_EXECUTABLES.has(executable)) {
    return work("source.read");
  }
  if (REPOSITORY_CHECK_EXECUTABLES.has(executable)) {
    return work("repository.check");
  }
  return null;
}

function classifyFindCommand(args: CommandWords): AgentWorkActivity | null {
  if (args.includes("-delete")) {
    return work("source.update");
  }
  return args.some((argument) => FIND_EXECUTION_ACTIONS.has(argument))
    ? null
    : work("source.search");
}

function isSedInPlace(args: CommandWords): boolean {
  return args.some(
    (argument) =>
      argument === "-i" ||
      argument.startsWith("-i") ||
      argument === "--in-place" ||
      argument.startsWith("--in-place=")
  );
}

function isTestCommand(
  executable: string,
  firstArgument: string | undefined
): boolean {
  return (
    TEST_EXECUTABLES.has(executable) ||
    (executable === "node" && firstArgument === "--test") ||
    (BUILD_EXECUTABLES.has(executable) && firstArgument === "test")
  );
}

function classifyGitCommand(
  args: CommandWords,
  commandSegment: string
): AgentWorkActivity | null {
  const subcommand = readGitSubcommand(args);
  if (subcommand === "clone") {
    return repositoryCloneWork(commandSegment);
  }
  if (["diff", "log", "show", "status"].includes(subcommand ?? "")) {
    return work("repository.inspect");
  }
  if (subcommand === "branch") {
    return isReadOnlyGitBranchCommand(args) ? work("repository.check") : null;
  }
  if (subcommand === "rev-parse") {
    return work("repository.check");
  }
  return null;
}

function isReadOnlyGitBranchCommand(args: CommandWords): boolean {
  const branchArgs = argsAfterCommand(args, "branch");
  return branchArgs.every(
    (argument) =>
      argument.startsWith("-") && !isGitBranchMutationOption(argument)
  );
}

function isGitBranchMutationOption(argument: string): boolean {
  const option = argument.split("=")[0] ?? argument;
  return (
    GIT_BRANCH_MUTATION_OPTIONS.has(option) ||
    GIT_BRANCH_ATTACHED_MUTATION_OPTION_PATTERN.test(argument)
  );
}

function classifyPackageManagerCommand(
  args: CommandWords
): AgentWorkActivity | null {
  const command = readPackageManagerCommand(args);
  if (!command) {
    return null;
  }
  if (["add", "install"].includes(command)) {
    return work("dependencies.install");
  }
  if (command === "test" || command.startsWith("test:")) {
    return work("tests.run");
  }
  if (["check", "lint", "typecheck"].includes(command)) {
    return work("quality.check");
  }
  if (command === "build") {
    return work("build.run");
  }
  if (command === "exec") {
    return classifyCommandWords(argsAfterCommand(args, command), "");
  }
  if (command === "run") {
    const script = argsAfterCommand(args, command)[0]?.toLowerCase();
    if (!script) {
      return null;
    }
    if (script === "test" || script.startsWith("test:")) {
      return work("tests.run");
    }
    if (["check", "lint", "typecheck"].includes(script)) {
      return work("quality.check");
    }
    if (script === "build") {
      return work("build.run");
    }
    return null;
  }
  return null;
}

function readPackageManagerCommand(args: CommandWords): string | null {
  return readFirstCommandWord(args, PACKAGE_MANAGER_OPTIONS_WITH_VALUE);
}

function argsAfterCommand(args: CommandWords, command: string): string[] {
  const commandIndex = args.findIndex(
    (value) => value.toLowerCase() === command
  );
  return commandIndex >= 0 ? args.slice(commandIndex + 1) : [];
}

function readGitSubcommand(args: CommandWords): string | null {
  return readFirstCommandWord(args, GIT_OPTIONS_WITH_VALUE);
}

function readFirstCommandWord(
  words: CommandWords,
  optionsWithValue: ReadonlySet<string>
): string | null {
  let skipNext = false;
  for (const value of words) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (optionsWithValue.has(value)) {
      skipNext = true;
      continue;
    }
    if (value && !value.startsWith("-")) {
      return value.toLowerCase();
    }
  }
  return null;
}

function removeExecutionPrefixes(words: CommandWords): string[] {
  let index = 0;
  while (SHELL_ASSIGNMENT_PATTERN.test(words[index] ?? "")) {
    index += 1;
  }
  if (words[index] === "sudo") {
    index += 1;
    while ((words[index] ?? "").startsWith("-")) {
      index += 1;
    }
  }
  if (words[index] === "env") {
    index += 1;
    while (
      (words[index] ?? "").startsWith("-") ||
      SHELL_ASSIGNMENT_PATTERN.test(words[index] ?? "")
    ) {
      index += 1;
    }
  }
  if (words[index] === "corepack") {
    index += 1;
  }
  return words.slice(index);
}

function isSafeNeutralCommand(words: CommandWords): boolean {
  const normalizedWords = removeExecutionPrefixes(words);
  return SAFE_NEUTRAL_EXECUTABLES.has(
    basename(normalizedWords[0] ?? "").toLowerCase()
  );
}

function hasSameWorkMeaning(
  left: AgentWorkActivity,
  right: AgentWorkActivity
): boolean {
  return (
    left.key === right.key &&
    left.subject?.kind === right.subject?.kind &&
    left.subject?.label === right.subject?.label
  );
}

function hasUnsupportedShellSyntax(command: string): boolean {
  return UNSUPPORTED_SHELL_SYNTAX_PATTERN.test(command);
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (SHELL_QUOTES.has(character)) {
      current += character;
      quote = character as "'" | '"' | "`";
      continue;
    }
    const next = command[index + 1] ?? "";
    if (SHELL_SEGMENT_SEPARATORS.has(character)) {
      pushShellSegment(segments, current);
      current = "";
      if (isRepeatedShellSeparator(character, next)) {
        index += 1;
      }
      continue;
    }
    current += character;
  }
  pushShellSegment(segments, current);
  return segments;
}

function pushShellSegment(segments: string[], segment: string): void {
  const trimmed = segment.trim();
  if (trimmed) {
    segments.push(trimmed);
  }
}

function isRepeatedShellSeparator(character: string, next: string): boolean {
  return (character === "|" || character === "&") && next === character;
}

function hasUnquotedOutputRedirection(command: string): boolean {
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (SHELL_QUOTES.has(character)) {
      quote = character as "'" | '"' | "`";
      continue;
    }
    if (character === ">") {
      return true;
    }
  }
  return false;
}

function hasFdExecutionAction(args: CommandWords): boolean {
  return args.some((argument) => {
    const option = argument.split("=")[0] ?? argument;
    return FD_EXECUTION_ACTIONS.has(option);
  });
}

function tokenizeShellWords(segment: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  const pushCurrent = (): void => {
    if (current) {
      words.push(current);
      current = "";
    }
  };
  for (const character of segment) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (SHELL_QUOTES.has(character)) {
      quote = character as "'" | '"' | "`";
      continue;
    }
    if (SHELL_WHITESPACE_PATTERN.test(character)) {
      pushCurrent();
      continue;
    }
    current += character;
  }
  pushCurrent();
  return words;
}

function repositoryCloneWork(command: string): AgentWorkActivity {
  const repository = readGitHubRepository(command);
  return {
    key: "repository.clone",
    v: 1,
    ...(repository
      ? {
          subject: {
            kind: "repository" as const,
            label: repository,
          },
        }
      : {}),
  };
}

function readGitHubRepository(command: string): string | null {
  const githubUrlMatch = GITHUB_REPOSITORY_URL_PATTERN.exec(command);
  if (githubUrlMatch) {
    return `${githubUrlMatch[1]}/${githubUrlMatch[2]?.replace(GIT_SUFFIX_PATTERN, "")}`;
  }
  const ghCloneMatch = GH_REPOSITORY_CLONE_PATTERN.exec(command.trim());
  return ghCloneMatch
    ? `${ghCloneMatch[1]}/${ghCloneMatch[2]?.replace(GIT_SUFFIX_PATTERN, "")}`
    : null;
}

function basename(value: string): string {
  return value.split("/").at(-1) ?? value;
}

function work(key: AgentWorkActivity["key"]): AgentWorkActivity {
  return { key, v: 1 };
}
