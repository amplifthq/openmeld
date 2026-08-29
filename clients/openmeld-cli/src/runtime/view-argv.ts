import { parseCliViewMode } from "./context";

type ViewArgvOptions = {
  allowMissingValue?: boolean;
};

export type ServiceAutoInstallMode = "always" | "ask" | "never";

const PASSIVE_CLI_QUERY_FLAGS = new Set(["--help", "--version", "-V", "-h"]);
const PASSIVE_CLI_QUERY_COMMANDS = new Set([
  "auth status",
  "service snapshot",
  "service status",
  "service trace",
  "whoami",
]);

export function isStandaloneViewQueryArgv(argv: string[]): boolean {
  const args = argv.slice(2);
  return args.length === 1 && args[0] === "--view";
}

export function parseViewFromArgv(
  argv: string[],
  options?: ViewArgvOptions
): "auto" | "human" | "agent" | null {
  const allowMissingValue = options?.allowMissingValue === true;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== "string") {
      continue;
    }

    // Stop scanning global flags after the terminator so positional args stay untouched.
    if (arg === "--") {
      break;
    }

    if (arg === "--view") {
      const next = argv[i + 1];
      if (typeof next !== "string" || next.startsWith("-")) {
        if (allowMissingValue) {
          return null;
        }
        throw new Error("missing --view value (use auto|human|agent)");
      }
      return parseCliViewMode(next);
    }

    if (arg.startsWith("--view=")) {
      return parseCliViewMode(arg.slice("--view=".length));
    }
  }

  return null;
}

export function parseStandaloneViewSwitchArgv(argv: string[]): string | null {
  const args = argv.slice(2);
  if (args.length === 0) {
    return null;
  }

  let view: string | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== "string") {
      continue;
    }

    if (arg === "--view") {
      const next = args[i + 1];
      if (typeof next !== "string" || next.startsWith("-")) {
        return null;
      }
      view = next.trim().toLowerCase();
      i += 1;
      continue;
    }

    if (arg.startsWith("--view=")) {
      view = arg.slice("--view=".length).trim().toLowerCase();
      continue;
    }

    return null;
  }

  return view;
}

export function parseServiceAutoInstallModeFromArgv(
  argv: string[],
  options?: ViewArgvOptions
): ServiceAutoInstallMode | null {
  const allowMissingValue = options?.allowMissingValue === true;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== "string") {
      continue;
    }

    if (arg === "--") {
      break;
    }

    if (arg === "--service-auto-install") {
      const next = argv[i + 1];
      if (typeof next !== "string" || next.startsWith("-")) {
        if (allowMissingValue) {
          return null;
        }
        throw new Error(
          "missing --service-auto-install value (use ask|always|never)"
        );
      }
      return parseServiceAutoInstallMode(next);
    }

    if (arg.startsWith("--service-auto-install=")) {
      return parseServiceAutoInstallMode(
        arg.slice("--service-auto-install=".length)
      );
    }
  }

  return null;
}

export function parseFirstCommandTokenFromArgv(argv: string[]): string | null {
  return parseLeadingCommandTokensFromArgv(argv, 1)[0] ?? null;
}

export function parseLeadingCommandTokensFromArgv(
  argv: string[],
  maxTokens = 2
): string[] {
  if (maxTokens <= 0) {
    return [];
  }

  const args = argv.slice(2);
  const tokens: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    if (collectTokensAfterTerminator(args, i, tokens, maxTokens)) {
      return tokens;
    }

    if (shouldSkipKnownGlobalFlag(args, i)) {
      i += 1;
      continue;
    }

    const arg = args[i];
    if (typeof arg !== "string" || shouldSkipInlineGlobalFlag(arg)) {
      continue;
    }

    if (pushLeadingCommandToken(arg, tokens, maxTokens)) {
      return tokens;
    }
  }

  return tokens;
}

export function isPassiveCliQueryArgv(argv: string[]): boolean {
  const args = argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== "string") {
      continue;
    }

    if (arg === "--") {
      return false;
    }

    if (
      isKnownGlobalFlagExpectValue(arg) &&
      isGlobalFlagValueCandidate(args[i + 1])
    ) {
      i += 1;
      continue;
    }

    if (
      arg.startsWith("--view=") ||
      arg.startsWith("--service-auto-install=")
    ) {
      continue;
    }

    if (arg === "help" || PASSIVE_CLI_QUERY_FLAGS.has(arg)) {
      return true;
    }
  }

  return PASSIVE_CLI_QUERY_COMMANDS.has(
    parseLeadingCommandTokensFromArgv(argv, 2).join(" ")
  );
}

export function hasJsonOutputArgv(argv: string[]): boolean {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== "string") {
      continue;
    }
    if (arg === "--") {
      return false;
    }
    if (arg === "--json" || arg.startsWith("--json=")) {
      return true;
    }
  }

  return false;
}

export function shouldUseAgentViewForNonInteractiveStart(
  argv: string[],
  interactive: boolean
): boolean {
  if (interactive) {
    return false;
  }

  const explicitView = parseViewFromArgv(argv, {
    allowMissingValue: true,
  });
  if (explicitView !== null) {
    return false;
  }

  return parseFirstCommandTokenFromArgv(argv) === "start";
}

function parseServiceAutoInstallMode(value: string): ServiceAutoInstallMode {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "always" ||
    normalized === "ask" ||
    normalized === "never"
  ) {
    return normalized;
  }
  throw new Error(
    `invalid --service-auto-install value: ${normalized} (use ask|always|never)`
  );
}

function isKnownGlobalFlagExpectValue(value: string): boolean {
  return value === "--view" || value === "--service-auto-install";
}

function isGlobalFlagValueCandidate(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && !value.startsWith("-")
  );
}

function collectTokensAfterTerminator(
  args: string[],
  index: number,
  tokens: string[],
  maxTokens: number
): boolean {
  if (args[index] !== "--") {
    return false;
  }

  for (let i = index + 1; i < args.length; i += 1) {
    const next = args[i];
    if (typeof next !== "string" || next.length === 0) {
      continue;
    }
    tokens.push(next);
    if (tokens.length >= maxTokens) {
      break;
    }
  }

  return true;
}

function shouldSkipKnownGlobalFlag(args: string[], index: number): boolean {
  return (
    isKnownGlobalFlagExpectValue(args[index] ?? "") &&
    isGlobalFlagValueCandidate(args[index + 1])
  );
}

function shouldSkipInlineGlobalFlag(value: string): boolean {
  return (
    value.startsWith("--view=") || value.startsWith("--service-auto-install=")
  );
}

function pushLeadingCommandToken(
  value: string,
  tokens: string[],
  maxTokens: number
): boolean {
  if (value.startsWith("-")) {
    return false;
  }

  tokens.push(value);
  return tokens.length >= maxTokens;
}
