import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommands,
  formatOpenMeldCliLine,
} from "./cli-entry-command";

type AgentOverviewHumanActionRequired =
  | boolean
  | {
      possible: boolean;
      steps: string[];
    };

type AgentOverviewPayload = {
  summary: string;
  commands: string[];
  notes: string[];
  humanActionRequired: AgentOverviewHumanActionRequired;
};

export function formatAgentOverviewPayload<T extends AgentOverviewPayload>(
  payload: T
): T {
  return {
    ...payload,
    summary: formatInlineOpenMeldCliCommands(payload.summary),
    commands: formatOpenMeldCliCommands(payload.commands),
    notes: payload.notes.map((note) => formatOpenMeldCliLine(note)),
    humanActionRequired: formatHumanActionRequired(payload.humanActionRequired),
  };
}

function formatHumanActionRequired(
  humanActionRequired: AgentOverviewHumanActionRequired
): AgentOverviewHumanActionRequired {
  if (typeof humanActionRequired === "boolean") {
    return humanActionRequired;
  }

  return {
    ...humanActionRequired,
    steps: formatOpenMeldCliCommands(humanActionRequired.steps),
  };
}
