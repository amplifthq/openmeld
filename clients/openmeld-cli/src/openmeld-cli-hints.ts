import {
  resolveAuthenticationGuidanceFromError,
  resolveAuthenticationGuidanceFromMessage,
} from "./auth/auth-guidance";
import { getCommandHintsFromContract } from "./command-contracts/registry";
import { resolveCommandEntryNameFromTokens } from "./command-entry-checks/command-entry-name";
import { DEFAULT_AGENT_EXAMPLE_PAIR } from "./openmeld-cli-help-text";
import {
  resolveCommonHintByMessage,
  resolveProfileHintByMessage,
  resolveSpaceHintByMessage,
} from "./openmeld-error-hints";
import { formatOpenMeldCliLine } from "./runtime/cli-entry-command";
import { DualViewGuideError } from "./runtime/dual-view-guide-error";
import { normalizeHelpfulHintsForView } from "./runtime/helpful-hints";
import {
  parseFirstCommandTokenFromArgv,
  parseLeadingCommandTokensFromArgv,
} from "./runtime/view-argv";
import { errLine, outJsonLine, outLine } from "./ui/io";

export function emitSpaceAddAgentsMemberAliasHint(): void {
  errLine(
    "hint: `--member` on `openmeld space add-agents` is a compatibility alias; use `--agent-profile <agent-profile-id...>`."
  );
}

export function emitSetupFirstHint(invokedCommand: string): void {
  errLine(
    `hint: most machine-state problems are handled by \`openmeld setup\`; \`${invokedCommand}\` is a deep tool kept for support flows.`
  );
}

export function emitHelpfulHints(input: {
  argv: string[];
  effectiveView: "auto" | "human" | "agent";
  message: string;
  error?: unknown;
}): void {
  const hints = normalizeHelpfulHintsForView(
    buildHints(input.argv, input.message, input.error),
    input.effectiveView
  ).map((hint) => formatOpenMeldCliLine(hint));
  if (hints.length === 0) {
    return;
  }

  if (input.effectiveView === "agent") {
    outJsonLine({
      type: "hints",
      code: "cli.hints",
      hints,
    });
    return;
  }

  outLine("");
  outLine("available commands:");
  for (const hint of hints) {
    outLine(`  - ${hint}`);
  }
}

function buildHints(
  argv: string[],
  message: string,
  error?: unknown
): string[] {
  if (
    resolveAuthenticationGuidanceFromError(error) !== null ||
    resolveAuthenticationGuidanceFromMessage(message) !== null
  ) {
    return [];
  }

  if (error instanceof DualViewGuideError) {
    return [];
  }

  const contractEntryName = resolveCommandEntryNameFromTokens(
    parseLeadingCommandTokensFromArgv(argv, 3)
  );
  if (contractEntryName) {
    const contractHints = getCommandHintsFromContract({
      context: {
        agentExampleArg: DEFAULT_AGENT_EXAMPLE_PAIR,
      },
      entryName: contractEntryName,
    });
    if (contractHints && contractHints.length > 0) {
      return contractHints;
    }
  }

  const commonHints = resolveCommonHintByMessage(message);
  if (commonHints) {
    return commonHints;
  }

  const spaceHints = resolveSpaceHintByMessage(message);
  if (spaceHints) {
    return spaceHints;
  }

  const profileHints = resolveProfileHintByMessage(message);
  if (profileHints) {
    return profileHints;
  }

  const token = parseFirstCommandTokenFromArgv(argv);
  if (isSpaceCommandToken(token)) {
    return [
      "openmeld space create --name spaceship --visibility private",
      "openmeld space join <space-id>",
      "openmeld space watch <space-id>",
    ];
  }

  if (token === "profile" || token === "profiles") {
    return [
      "openmeld start",
      "openmeld init",
      "openmeld profiles create <profileName> --kind agent",
      "openmeld profiles list",
      "openmeld profiles set <profile-id>",
      "openmeld profiles update <profile-id> --name <new-name>",
      "openmeld profiles delete <profile-id> --force",
    ];
  }

  return [];
}

function isSpaceCommandToken(token: string | null): boolean {
  return token === "space" || token === "spaces";
}
