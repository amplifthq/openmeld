import type { SpacePanelKind } from "../panel/space-panel-definition";
import { SPACE_QUIT_PRIMARY_TRIGGER } from "../quit-command";

export type SpaceSlashCommandName =
  | "help"
  | "space"
  | "members"
  | "logs"
  | "quit";

export type SpaceControlCommandAction = "quit";

export type SpacePanelCommand = {
  name: SpacePanelKind;
  panelKind: SpacePanelKind;
  trigger: `/${SpacePanelKind}`;
  description: string;
  kind: "panel";
};

export type SpaceControlCommand = {
  name: SpaceControlCommandAction;
  action: SpaceControlCommandAction;
  trigger: `/${SpaceControlCommandAction}`;
  description: string;
  kind: "control";
};

export type SpaceSlashCommand = SpacePanelCommand | SpaceControlCommand;

const SPACE_SLASH_COMMANDS = [
  {
    name: "help",
    panelKind: "help",
    trigger: "/help",
    description: "Show available Space composer commands",
    kind: "panel",
  },
  {
    name: "space",
    panelKind: "space",
    trigger: "/space",
    description: "Show current Space info",
    kind: "panel",
  },
  {
    name: "members",
    panelKind: "members",
    trigger: "/members",
    description: "Show current Space members",
    kind: "panel",
  },
  {
    name: "logs",
    panelKind: "logs",
    trigger: "/logs",
    description: "Show current Space logs",
    kind: "panel",
  },
  {
    name: "quit",
    action: "quit",
    trigger: SPACE_QUIT_PRIMARY_TRIGGER,
    description: "Leave the current Space session",
    kind: "control",
  },
] as const satisfies readonly SpaceSlashCommand[];

const SPACE_SLASH_COMMAND_BY_TRIGGER = new Map(
  SPACE_SLASH_COMMANDS.map((command) => [command.trigger, command] as const)
);

export function listSpaceSlashCommands(): readonly SpaceSlashCommand[] {
  return SPACE_SLASH_COMMANDS;
}

export function resolveSpaceSlashCommand(
  value: string
): SpaceSlashCommand | null {
  const normalized = normalizeSpaceSlashCommandTrigger(value);
  if (!normalized) {
    return null;
  }
  return (
    SPACE_SLASH_COMMAND_BY_TRIGGER.get(
      normalized as SpaceSlashCommand["trigger"]
    ) ?? null
  );
}

function normalizeSpaceSlashCommandTrigger(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith("/")) {
    return null;
  }
  return normalized.length > 1 ? normalized : null;
}
