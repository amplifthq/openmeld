#!/usr/bin/env node
// Claude Code PreToolUse adapter for repository Bash safety rules.
//
// Stable policy stays in AGENTS.md and the routed owner documents. This file
// only parses common direct, wrapper, control-flow, redirection, and nested
// command shapes well enough to catch accidental violations without treating
// quoted search text as executable shell syntax. It is a fail-closed
// defense-in-depth guard for coding agents, not a shell sandbox or a security
// boundary against deliberately obfuscated commands.

import { basename, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const BLOCKED_MESSAGES = {
  "raw-wrangler-deploy":
    "Blocked by AGENTS.md: raw wrangler deploys bypass the guarded release entrypoint. Use the scoped release lane in developing/engineering/production-release.md.",
  "raw-package-publish":
    "Blocked by AGENTS.md: raw package publishing bypasses the guarded release pipeline. Use developing/engineering/production-release.md.",
  "push-no-verify":
    "Blocked by AGENTS.md: do not bypass pre-push hooks with --no-verify. Verify and push normally.",
  "commit-all":
    "Blocked by AGENTS.md: git commit -a/--all can include concurrent work. Stage and commit explicit pathspecs.",
  "openmeld-home-destruction":
    "Blocked by AGENTS.md lane safety: ~/.openmeld is published user state. Use an isolated lane and follow the repair/reset policy.",
};

const VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "-g",
  "-u",
  "--chdir",
  "--config",
  "--cwd",
  "--dir",
  "--filter",
  "--git-dir",
  "--prefix",
  "--userconfig",
  "--group",
  "--unset",
  "--user",
  "--work-tree",
  "--workspace",
]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn"]);
const SHELL_EXECUTABLES = new Set(["bash", "dash", "sh", "zsh"]);
const EXECUTION_WRAPPERS = new Set([
  "command",
  "env",
  "exec",
  "nice",
  "nohup",
  "sudo",
  "time",
]);
const WRAPPER_VALUE_OPTIONS = new Map([
  ["command", new Set()],
  ["env", new Set(["-C", "-S", "-u", "--chdir", "--split-string", "--unset"])],
  ["exec", new Set(["-a"])],
  ["nice", new Set(["-n", "--adjustment"])],
  ["nohup", new Set()],
  [
    "sudo",
    new Set([
      "-C",
      "-D",
      "-g",
      "-h",
      "-p",
      "-R",
      "-T",
      "-U",
      "-u",
      "--chdir",
      "--close-from",
      "--group",
      "--host",
      "--other-user",
      "--prompt",
      "--role",
      "--type",
      "--user",
    ]),
  ],
  ["time", new Set(["-f", "-o", "--format", "--output"])],
]);
const PACKAGE_RUNNER_VALUE_OPTIONS = new Set([
  ...VALUE_OPTIONS,
  "-p",
  "--package",
]);
const CONTROL_PREFIXES = new Set([
  "!",
  "do",
  "elif",
  "else",
  "if",
  "then",
  "until",
  "while",
]);
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const COMMIT_ALL_SHORT_RE = /^-[A-Za-z]*a[A-Za-z]*$/;
const PUBLISHED_HOME_RE =
  /^(?:~|\$HOME|\$\{HOME\}|\/Users\/[^/]+)\/+\.openmeld(?:\/|$)/;
const HOME_FIRST_SEGMENT_RE = /^(?:~|\$HOME|\$\{HOME\}|\/Users\/[^/]+)\/+(.*)/;
const SHELL_COMMAND_OPTION_RE = /^-[^-]*c[^-]*$/;
const WHITESPACE_RE = /\s/;
const LEADING_TABS_RE = /^\t+/;
const REDIRECTION_ONLY_RE = /^\d*(?:<>|>>?|<<<|<<|<|>&|<&|>\|)$/;
const REDIRECTION_WITH_TARGET_RE = /^\d*(?:<>|>>?|<<<|<<|<|>&|<&|>\|).+/;
const HEREDOC_WORD_RE = /^[^\s;&|<>]+/;
const SHELL_LITERAL_PATTERN_CHARACTERS = new Set([
  "$",
  "*",
  "?",
  "[",
  "]",
  "{",
  "}",
  "~",
]);
const DOUBLE_QUOTED_LITERAL_PATTERN_CHARACTERS = new Set([
  "*",
  "?",
  "[",
  "]",
  "~",
]);

function finishToken(tokens, state) {
  if (state.started) {
    tokens.push(state.value);
    state.value = "";
    state.started = false;
  }
}

function finishSegment(state) {
  finishToken(state.tokens, state.token);
  if (state.tokens.length > 0) {
    state.segments.push(state.tokens);
    state.tokens = [];
  }
}

function consumeQuotedCharacter(char, state) {
  state.token.started = true;
  if (state.quote === "'") {
    if (char === "'") {
      state.quote = null;
    } else {
      state.token.value += SHELL_LITERAL_PATTERN_CHARACTERS.has(char)
        ? `\\${char}`
        : char;
    }
    return;
  }
  if (char === '"') {
    state.quote = null;
  } else if (char === "\\") {
    state.escaped = true;
  } else {
    state.token.value += DOUBLE_QUOTED_LITERAL_PATTERN_CHARACTERS.has(char)
      ? `\\${char}`
      : char;
  }
}

function isRedirectionAmpersand(char, tokenValue) {
  return char === "&" && (tokenValue.endsWith(">") || tokenValue.endsWith("<"));
}

function isCommandGroupBoundary(char, tokenStarted) {
  return (
    char === "(" ||
    char === ")" ||
    ((char === "{" || char === "}") && !tokenStarted)
  );
}

function consumeUnquotedCharacter(command, index, state) {
  const char = command[index];
  if (char === "\\") {
    state.escaped = true;
    state.token.started = true;
    return index;
  }
  if (char === "'" || char === '"') {
    state.quote = char;
    state.token.started = true;
    return index;
  }
  if (WHITESPACE_RE.test(char)) {
    finishToken(state.tokens, state.token);
    if (char === "\n") {
      finishSegment(state);
    }
    return index;
  }
  const redirectionAmpersand = isRedirectionAmpersand(char, state.token.value);
  if (char === ";" || char === "|" || (char === "&" && !redirectionAmpersand)) {
    finishSegment(state);
    return command[index + 1] === char ? index + 1 : index;
  }
  if (redirectionAmpersand) {
    state.token.value += char;
    state.token.started = true;
    return index;
  }
  if (isCommandGroupBoundary(char, state.token.started)) {
    finishSegment(state);
    return index;
  }
  if (char === "#" && !state.token.started) {
    let commentEnd = index;
    while (commentEnd < command.length && command[commentEnd] !== "\n") {
      commentEnd += 1;
    }
    finishSegment(state);
    return commentEnd;
  }
  state.token.value += char;
  state.token.started = true;
  return index;
}

export function tokenizeShell(command) {
  const state = {
    escaped: false,
    quote: null,
    segments: [],
    token: { started: false, value: "" },
    tokens: [],
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (state.escaped) {
      if (char !== "\n") {
        state.token.value += SHELL_LITERAL_PATTERN_CHARACTERS.has(char)
          ? `\\${char}`
          : char;
        state.token.started = true;
      }
      state.escaped = false;
    } else if (state.quote !== null) {
      consumeQuotedCharacter(char, state);
    } else {
      index = consumeUnquotedCharacter(command, index, state);
    }
  }
  if (state.quote !== null || state.escaped) {
    throw new Error("unterminated shell quote or escape");
  }
  finishSegment(state);
  return state.segments;
}

function skipAssignments(tokens, start) {
  let index = start;
  while (ASSIGNMENT_RE.test(tokens[index] ?? "")) {
    index += 1;
  }
  return index;
}

function skipWrapper(tokens, start) {
  const wrapper = basename(tokens[start] ?? "");
  const valueOptions = WRAPPER_VALUE_OPTIONS.get(wrapper) ?? new Set();
  let index = start + 1;
  while (index < tokens.length) {
    const value = tokens[index];
    if (wrapper === "env" && ASSIGNMENT_RE.test(value)) {
      index += 1;
    } else if (value.startsWith("-")) {
      index += valueOptions.has(value) ? 2 : 1;
    } else {
      break;
    }
  }
  return index;
}

function skipRedirections(tokens, start) {
  let index = start;
  while (index < tokens.length) {
    const value = tokens[index];
    if (REDIRECTION_ONLY_RE.test(value)) {
      index += 2;
    } else if (REDIRECTION_WITH_TARGET_RE.test(value)) {
      index += 1;
    } else {
      break;
    }
  }
  return index;
}

function commandView(tokens) {
  let index = 0;
  let previous = -1;
  while (index !== previous) {
    previous = index;
    index = skipAssignments(tokens, index);
    while (CONTROL_PREFIXES.has(tokens[index] ?? "")) {
      index += 1;
    }
    index = skipRedirections(tokens, index);
    if (
      basename(tokens[index] ?? "") === "corepack" &&
      PACKAGE_MANAGERS.has(basename(tokens[index + 1] ?? ""))
    ) {
      index += 1;
    }
    if (EXECUTION_WRAPPERS.has(basename(tokens[index] ?? ""))) {
      index = skipWrapper(tokens, index);
    }
  }
  return {
    executable: basename(tokens[index] ?? ""),
    args: tokens.slice(index + 1),
  };
}

function commandAfterOptions(args, valueOptions = VALUE_OPTIONS) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") {
      return { command: args[index + 1] ?? "", args: args.slice(index + 2) };
    }
    if (valueOptions.has(value)) {
      index += 1;
      continue;
    }
    if (value.startsWith("--") && value.includes("=")) {
      continue;
    }
    if (value.startsWith("-")) {
      continue;
    }
    return { command: value, args: args.slice(index + 1) };
  }
  return { command: "", args: [] };
}

function resolveWrangler(view) {
  if (view.executable === "wrangler") {
    return view.args;
  }
  if (["bunx", "npx"].includes(view.executable)) {
    const nested = commandAfterOptions(view.args, PACKAGE_RUNNER_VALUE_OPTIONS);
    return basename(nested.command) === "wrangler" ? nested.args : null;
  }
  if (PACKAGE_MANAGERS.has(view.executable)) {
    const packageManager = commandAfterOptions(view.args);
    if (!["dlx", "exec"].includes(packageManager.command)) {
      return null;
    }
    const nested = commandAfterOptions(
      packageManager.args,
      PACKAGE_RUNNER_VALUE_OPTIONS
    );
    return basename(nested.command) === "wrangler" ? nested.args : null;
  }
  return null;
}

function isRawWranglerDeploy(view) {
  const args = resolveWrangler(view);
  if (!args || args.includes("--dry-run")) {
    return false;
  }
  const command = commandAfterOptions(args);
  if (command.command === "deploy") {
    return true;
  }
  if (command.command !== "versions") {
    return false;
  }
  return commandAfterOptions(command.args).command === "deploy";
}

function packageManagerCommand(view) {
  if (!PACKAGE_MANAGERS.has(view.executable)) {
    return null;
  }
  return commandAfterOptions(view.args);
}

function gitCommand(view) {
  if (view.executable !== "git") {
    return null;
  }
  return commandAfterOptions(view.args);
}

function matchesPublishedHomeSegment(segment) {
  const braceStart = findUnescapedCharacter(segment, "{");
  const braceEnd = findUnescapedCharacter(segment, "}", braceStart + 1);
  if (braceStart >= 0 && braceEnd > braceStart) {
    const prefix = segment.slice(0, braceStart);
    const suffix = segment.slice(braceEnd + 1);
    return segment
      .slice(braceStart + 1, braceEnd)
      .split(",")
      .some((choice) =>
        matchesPublishedHomeSegment(`${prefix}${choice}${suffix}`)
      );
  }
  if (segment === ".openmeld") {
    return true;
  }
  const wildcardIndex = findFirstUnescapedPatternCharacter(segment);
  return (
    wildcardIndex >= 0 &&
    ".openmeld".startsWith(segment.slice(0, wildcardIndex))
  );
}

function findUnescapedCharacter(value, expected, start = 0) {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
    } else if (value[index] === expected) {
      return index;
    }
  }
  return -1;
}

function findFirstUnescapedPatternCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
    } else if (["*", "?", "["].includes(value[index])) {
      return index;
    }
  }
  return -1;
}

function matchesPublishedHomePath(value) {
  if (PUBLISHED_HOME_RE.test(value)) {
    return true;
  }
  const home = value.match(HOME_FIRST_SEGMENT_RE);
  const firstSegment = home?.[1].split("/", 1)[0];
  return firstSegment ? matchesPublishedHomeSegment(firstSegment) : false;
}

function removesPublishedState(view) {
  if (view.executable !== "rm") {
    return false;
  }
  return view.args.some(
    (value) =>
      value !== "--" &&
      !value.startsWith("-") &&
      matchesPublishedHomePath(value)
  );
}

function nestedShellCommand(view) {
  if (!SHELL_EXECUTABLES.has(view.executable)) {
    return null;
  }
  const optionIndex = view.args.findIndex(
    (value) => SHELL_COMMAND_OPTION_RE.test(value) || value === "--command"
  );
  return optionIndex >= 0 ? (view.args[optionIndex + 1] ?? null) : null;
}

function nestedShellHereString(view) {
  if (!SHELL_EXECUTABLES.has(view.executable)) {
    return null;
  }
  for (let index = 0; index < view.args.length; index += 1) {
    const value = view.args[index];
    if (value === "<<<") {
      return view.args[index + 1] ?? null;
    }
    if (value.startsWith("<<<")) {
      return value.slice(3);
    }
  }
  return null;
}

function nestedEvaluatedCommand(view) {
  return view.executable === "eval" ? view.args.join(" ") : null;
}

function commandStringOption(args) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (["-c", "--call"].includes(value)) {
      return args[index + 1] ?? null;
    }
    if (value.startsWith("--call=")) {
      return value.slice("--call=".length);
    }
  }
  return null;
}

function nestedPackageRunnerCommand(view) {
  if (["bunx", "npx"].includes(view.executable)) {
    return commandStringOption(view.args);
  }
  const packageManager = packageManagerCommand(view);
  return packageManager?.command === "exec"
    ? commandStringOption(packageManager.args)
    : null;
}

function blockedRuleForView(view) {
  if (isRawWranglerDeploy(view)) {
    return "raw-wrangler-deploy";
  }
  if (packageManagerCommand(view)?.command === "publish") {
    return "raw-package-publish";
  }
  const git = gitCommand(view);
  if (git?.command === "push" && git.args.includes("--no-verify")) {
    return "push-no-verify";
  }
  if (
    git?.command === "commit" &&
    git.args.some(
      (value) => value === "--all" || COMMIT_ALL_SHORT_RE.test(value)
    )
  ) {
    return "commit-all";
  }
  return removesPublishedState(view) ? "openmeld-home-destruction" : null;
}

function findClosingBacktick(command, start) {
  for (let index = start; index < command.length; index += 1) {
    if (command[index] === "\\") {
      index += 1;
    } else if (command[index] === "`") {
      return index;
    }
  }
  throw new Error("unterminated shell command substitution");
}

function consumeScanSyntax(char, state) {
  if (state.escaped) {
    state.escaped = false;
    return true;
  }
  if (state.quote === "'") {
    if (char === "'") {
      state.quote = null;
    }
    return true;
  }
  if (char === "\\") {
    state.escaped = true;
    return true;
  }
  if (char === "'" && state.quote === null) {
    state.quote = "'";
    return true;
  }
  if (char === '"') {
    state.quote = state.quote === '"' ? null : '"';
    return true;
  }
  return false;
}

function findClosingParenthesis(command, start) {
  let depth = 1;
  const state = { escaped: false, quote: null };
  for (let index = start; index < command.length; index += 1) {
    const char = command[index];
    if (consumeScanSyntax(char, state)) {
      continue;
    }
    if (state.quote === null && char === "(") {
      depth += 1;
    } else if (state.quote === null && char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error("unterminated shell command substitution");
}

export function extractCommandSubstitutions(command) {
  const substitutions = [];
  const state = { escaped: false, quote: null };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (consumeScanSyntax(char, state)) {
      continue;
    }
    if (char === "$" && command[index + 1] === "(") {
      const end = findClosingParenthesis(command, index + 2);
      substitutions.push(command.slice(index + 2, end));
      index = end;
    } else if (char === "`") {
      const end = findClosingBacktick(command, index + 1);
      substitutions.push(command.slice(index + 1, end));
      index = end;
    }
  }
  return substitutions;
}

function findHeredocDeclaration(line) {
  const state = { escaped: false, quote: null };
  for (let index = 0; index < line.length - 1; index += 1) {
    const char = line[index];
    if (
      state.quote === null &&
      char === "<" &&
      line[index + 1] === "<" &&
      line[index - 1] !== "<" &&
      line[index + 2] !== "<"
    ) {
      return parseHeredocDelimiter(line.slice(index + 2));
    }
    consumeScanSyntax(char, state);
  }
  return null;
}

function parseHeredocDelimiter(source) {
  const stripTabs = source.startsWith("-");
  const word = source
    .slice(stripTabs ? 1 : 0)
    .trimStart()
    .match(HEREDOC_WORD_RE)?.[0];
  if (!word) {
    throw new Error("heredoc is missing a delimiter");
  }
  const state = { delimiter: "", escaped: false, quote: null, quoted: false };
  for (const char of word) {
    consumeHeredocDelimiterCharacter(char, state);
  }
  if (state.escaped || state.quote !== null) {
    throw new Error("heredoc delimiter has an unterminated quote or escape");
  }
  return {
    delimiter: state.delimiter,
    expands: !state.quoted,
    stripTabs,
  };
}

function consumeHeredocDelimiterCharacter(char, state) {
  if (state.escaped) {
    state.delimiter += char;
    state.escaped = false;
    state.quoted = true;
  } else if (char === "\\" && state.quote !== "'") {
    state.escaped = true;
  } else if (char === "'" || char === '"') {
    if (state.quote === null) {
      state.quote = char;
      state.quoted = true;
    } else if (state.quote === char) {
      state.quote = null;
    } else {
      state.delimiter += char;
    }
  } else {
    state.delimiter += char;
  }
}

function lineRunsShell(line) {
  return tokenizeShell(line).some((tokens) => {
    const executable = commandView(tokens).executable;
    return SHELL_EXECUTABLES.has(executable) || executable === "eval";
  });
}

function recordHeredocBody(active, body, executableBodies, expandingBodies) {
  const text = body.join("\n");
  if (active.executable) {
    executableBodies.push(text);
  } else if (active.expands) {
    expandingBodies.push(text);
  }
}

export function separateHeredocBodies(command) {
  const surfaceLines = [];
  const executableBodies = [];
  const expandingBodies = [];
  let active = null;
  let body = [];
  for (const line of command.split("\n")) {
    if (active) {
      const candidate = active.stripTabs
        ? line.replace(LEADING_TABS_RE, "")
        : line;
      if (candidate === active.delimiter) {
        recordHeredocBody(active, body, executableBodies, expandingBodies);
        active = null;
        body = [];
      } else {
        body.push(line);
      }
      surfaceLines.push("");
      continue;
    }
    surfaceLines.push(line);
    const declaration = findHeredocDeclaration(line);
    if (declaration) {
      active = {
        ...declaration,
        executable: lineRunsShell(line),
      };
    }
  }
  if (active) {
    throw new Error("unterminated heredoc");
  }
  return {
    command: surfaceLines.join("\n"),
    executableBodies,
    expandingBodies,
  };
}

export function findBlockedCommand(command, depth = 0) {
  if (depth > 3) {
    throw new Error("nested shell command limit exceeded");
  }
  const heredoc = separateHeredocBodies(command);
  for (const body of heredoc.executableBodies) {
    const blocked = findBlockedCommand(body, depth + 1);
    if (blocked) {
      return blocked;
    }
  }
  const expansionSurfaces = [heredoc.command, ...heredoc.expandingBodies];
  for (const substitution of expansionSurfaces.flatMap((surface) =>
    extractCommandSubstitutions(surface)
  )) {
    const blocked = findBlockedCommand(substitution, depth + 1);
    if (blocked) {
      return blocked;
    }
  }
  for (const tokens of tokenizeShell(heredoc.command)) {
    const view = commandView(tokens);
    const blocked = blockedRuleForView(view);
    if (blocked) {
      return blocked;
    }
    const nested =
      nestedShellCommand(view) ??
      nestedShellHereString(view) ??
      nestedEvaluatedCommand(view) ??
      nestedPackageRunnerCommand(view);
    if (nested !== null) {
      const blocked = findBlockedCommand(nested, depth + 1);
      if (blocked) {
        return blocked;
      }
    }
  }
  return null;
}

export function evaluateHookInput(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    return {
      code: 2,
      message: `Claude Bash safety guard could not parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (payload?.tool_name !== "Bash") {
    return { code: 0, message: "" };
  }
  const command = payload?.tool_input?.command;
  if (typeof command !== "string" || command.trim().length === 0) {
    return {
      code: 2,
      message:
        "Claude Bash safety guard received a Bash call without a command.",
    };
  }

  try {
    const blocked = findBlockedCommand(command);
    return blocked
      ? { code: 2, message: BLOCKED_MESSAGES[blocked] }
      : { code: 0, message: "" };
  } catch (error) {
    return {
      code: 2,
      message: `Claude Bash safety guard could not inspect the command: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function runHook() {
  let input = "";
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    const result = evaluateHookInput(input);
    if (result.message) {
      process.stderr.write(`${result.message}\n`);
    }
    process.exit(result.code);
  });
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) {
  runHook();
}
