import { ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE } from "@openmeld/schemas";
import {
  OPENMELD_UPGRADE_FAILURE_HINTS,
  OPENMELD_UPGRADE_METADATA_RECOVERY_HINTS,
} from "./runtime/manual-upgrade";

export function resolveCommonHintByMessage(message: string): string[] | null {
  if (message.includes("OpenMeld version metadata is missing")) {
    return resolveUpgradeHintsFromMessage({
      message,
      defaultHints: OPENMELD_UPGRADE_METADATA_RECOVERY_HINTS,
    });
  }

  if (message.includes("Version check failed (")) {
    return resolveUpgradeHintsFromMessage({
      message,
      defaultHints: OPENMELD_UPGRADE_FAILURE_HINTS,
    });
  }

  if (message.includes("upgrade failed (exit")) {
    return resolveUpgradeHintsFromMessage({
      message,
      defaultHints: OPENMELD_UPGRADE_FAILURE_HINTS,
    });
  }

  if (
    message.includes("openmeld reset requires --yes in non-interactive mode")
  ) {
    return ["openmeld reset --yes"];
  }

  if (
    message.includes("openmeld upgrade requires --yes in non-interactive mode")
  ) {
    return ["openmeld upgrade --yes", "openmeld upgrade --check"];
  }

  if (message.includes("interactive menu is disabled in agent view")) {
    return [
      "openmeld --view human space",
      "openmeld space create --name spaceship --visibility private",
      "openmeld space join <space-id>",
      "openmeld space watch <space-id>",
    ];
  }

  if (
    message.includes("openmeld start in agent view requires explicit agent")
  ) {
    return [
      "openmeld --view human start",
      "openmeld profiles list --view human",
      "openmeld profiles list --view agent",
      'openmeld start --kind agent --profile-id "<existing-agent-profile-id>"',
      'openmeld start --kind agent --profile-name "Agent"',
    ];
  }

  return null;
}

const MANUAL_FALLBACK_COMMAND_REGEX = /Manual fallback:\s*`([^`]+)`/;

export function resolveUpgradeHintsFromMessage(input: {
  message: string;
  defaultHints: readonly string[];
}): string[] {
  const manualFallbackCommand = extractManualFallbackCommand(input.message);
  if (!manualFallbackCommand) {
    return [...input.defaultHints];
  }

  const [, ...remainingHints] = input.defaultHints;
  return [manualFallbackCommand, ...remainingHints];
}

export function extractManualFallbackCommand(message: string): string | null {
  const match = message.match(MANUAL_FALLBACK_COMMAND_REGEX);
  return match?.[1] ?? null;
}

export function resolveSpaceHintByMessage(message: string): string[] | null {
  if (
    message.includes("space.password_required") ||
    message.includes("space.password_invalid") ||
    message.toLowerCase().includes("space password required") ||
    message.toLowerCase().includes("space password invalid")
  ) {
    return [
      "openmeld whoami",
      "openmeld space list",
      "openmeld space join <space-id> --password <value>",
      "Ask a Space member to add this profile if this account should already have access.",
    ];
  }

  if (
    message.includes("space.password_too_short") ||
    message.toLowerCase().includes("password too short") ||
    message.toLowerCase().includes("at least 6 characters")
  ) {
    return [
      "Use at least 6 characters for --password",
      "openmeld space list",
      "openmeld space password <space-id> --password <new-password>",
      "openmeld space create --name <name> --visibility <public|private> --password <value>",
    ];
  }

  if (
    includesMissingRequiredArgumentMessage(message, {
      argument: "space",
      commandPrefix: "openmeld space password",
    })
  ) {
    return [
      "openmeld space list",
      "openmeld space password <space-id> --password <value>",
      "openmeld space password <space-id> --clear",
      "openmeld space join <space-id> --password <value>",
    ];
  }

  if (
    message.includes(
      "missing required 'name' argument for openmeld space create"
    )
  ) {
    return [
      "openmeld --view human space",
      'openmeld space create --name "spaceship" --visibility private',
      'openmeld space create --name "spaceship" --visibility private --guide "Keep it concise and actionable."',
    ];
  }

  if (
    includesMissingRequiredArgumentMessage(message, {
      argument: "text",
      commandPrefix: "openmeld space send",
    })
  ) {
    return [
      'openmeld space send <space-id> "hello world"',
      "openmeld space history <space-id> --kind text --limit 20",
      "openmeld space join <space-id>",
    ];
  }

  if (
    message.includes(
      "agent role is required for this space; pass --role <text>"
    )
  ) {
    return [
      "openmeld space join <space-id> --role <text>",
      "openmeld space history <space-id> --kind text --limit 20",
      "openmeld space watch <space-id>",
    ];
  }

  if (
    includesMissingRequiredArgumentMessage(message, {
      argument: "space",
      commandPrefix: "openmeld space",
    })
  ) {
    return [
      "openmeld --view human space",
      "openmeld space history <space-id> --kind text",
      "openmeld space join <space-id>",
    ];
  }

  return null;
}

export function resolveProfileHintByMessage(message: string): string[] | null {
  if (message.includes(ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE)) {
    return [
      "openmeld profiles list --view human",
      "openmeld start --view human",
      "openmeld profiles create <profileName> --kind agent",
    ];
  }

  if (
    message.includes(
      "openmeld profile menu is interactive in human view only"
    ) ||
    message.includes("openmeld profiles menu is interactive in human view only")
  ) {
    return [
      "openmeld view human",
      "openmeld profiles",
      "openmeld profiles list",
      "openmeld profiles create <profileName> --kind agent",
      "openmeld profiles set <profile-id>",
    ];
  }

  if (
    includesMissingRequiredArgumentMessage(message, {
      argument: "profile",
      commandPrefix: "openmeld profile set",
    })
  ) {
    return [
      "openmeld --view human profiles set",
      "openmeld profiles set <profile-id>",
      "openmeld profiles list",
    ];
  }

  if (
    includesMissingRequiredArgumentMessage(message, {
      argument: "profile",
      commandPrefix: "openmeld profile delete",
    })
  ) {
    return [
      "openmeld --view human profiles delete",
      "openmeld profiles delete <profile-id> --force",
      "openmeld profiles list",
    ];
  }

  if (
    includesMissingRequiredArgumentMessage(message, {
      argument: "profile",
      commandPrefix: "openmeld profile update",
    })
  ) {
    return [
      "openmeld --view human profiles update",
      "openmeld profiles update <profile-id> --name <new-name>",
      "openmeld profiles list",
    ];
  }

  if (
    includesMissingRequiredArgumentMessage(message, {
      argument: "profile",
      commandPrefix: "openmeld profile show",
    })
  ) {
    return [
      "openmeld --view human profiles show",
      "openmeld profiles show <profile-id>",
      "openmeld profiles list",
    ];
  }

  return null;
}

export function includesMissingRequiredArgumentMessage(
  message: string,
  input: { argument: string; commandPrefix: string }
): boolean {
  return (
    message.includes(
      `missing required '${input.argument}' argument for ${input.commandPrefix}`
    ) ||
    message.includes(
      `missing required argument '${input.argument}' for ${input.commandPrefix}`
    )
  );
}
