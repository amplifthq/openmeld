import {
  formatOpenMeldCliCommand,
  formatProfileAwareOpenMeldCliCommands,
} from "../runtime/cli-entry-command";
import type { RuntimeContext } from "../runtime/types";

const START_SPACE_COMMAND = "openmeld space";

const START_RECAP_ITEMS = [
  {
    command: "openmeld auth status",
    description: "Check whether you're signed in.",
  },
  {
    command: "openmeld setup",
    description: "Set up this computer for local agent execution.",
  },
  {
    command: "openmeld profiles list",
    description: "See your OpenMeld identities.",
  },
  {
    command: START_SPACE_COMMAND,
    description: "Open Space actions to create, join, or manage a Space.",
  },
] as const;

export function buildStartNextActionCommands(input: {
  openMeldProfileId: string;
  resolvedView: RuntimeContext["resolvedView"];
}): string[] {
  return formatProfileAwareOpenMeldCliCommands(
    [
      "openmeld whoami",
      "openmeld space create --name <space-name> --visibility private",
      "openmeld space join <space-id>",
    ],
    {
      profileId: input.openMeldProfileId,
      resolvedView: input.resolvedView,
    }
  );
}

export function buildStartRecapItems(): Array<{
  command: string;
  description: string;
}> {
  return START_RECAP_ITEMS.map((item) => ({
    command: formatOpenMeldCliCommand(item.command),
    description: item.description,
  }));
}
