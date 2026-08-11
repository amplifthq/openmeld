import type { Command } from "commander";

export function parseHelpTargetTokens(args: string[]): string[] {
  const tokens: string[] = [];
  for (const arg of args) {
    if (arg === "--" || arg.startsWith("-")) {
      break;
    }
    tokens.push(arg);
  }
  return tokens;
}

export function resolveHelpCommandTarget(
  root: Command,
  path: string[]
): Command | null {
  let current: Command = root;
  for (const token of path) {
    const next = resolveSubcommandByToken(current, token);
    if (!next) {
      return null;
    }
    current = next;
  }
  return current;
}

function resolveSubcommandByToken(
  command: Command,
  token: string
): Command | null {
  for (const subcommand of command.commands) {
    if (subcommand.name() === token) {
      return subcommand;
    }
    if (subcommand.aliases().includes(token)) {
      return subcommand;
    }
  }
  return null;
}
