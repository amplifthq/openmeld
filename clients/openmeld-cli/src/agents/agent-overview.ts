import { formatAgentOverviewPayload } from "../runtime/agent-overview-payload";
import type { Presenter } from "../runtime/presenter";
import {
  type BuiltinAgentSelectionCommand,
  buildBuiltinAgentSelectionExamples,
  getBuiltinAgentSelectionOptionalArguments,
  getBuiltinAgentSelectionRequiredArguments,
} from "./builtin-selection-contract";

export type AgentsAgentOverviewCommand =
  | "menu"
  | "manage"
  | "detect"
  | "list"
  | "show"
  | "enable"
  | "repair"
  | "disable"
  | "config"
  | "custom_list"
  | "custom_add"
  | "custom_update"
  | "custom_remove";

type AgentsAgentOverviewInput = {
  presenter: Presenter;
  command: AgentsAgentOverviewCommand;
};

type AgentsAgentOverviewPayload = {
  summary: string;
  requiredArguments: string[];
  optionalArguments: string[];
  commands: string[];
  stages: string[];
  notes: string[];
  humanActionRequired: boolean;
};

export function emitAgentsAgentOverview(input: AgentsAgentOverviewInput): void {
  input.presenter.data({
    code: `agents.${input.command}.agent_overview`,
    payload: formatAgentOverviewPayload(
      buildAgentsAgentOverviewPayload(input.command)
    ),
  });
}

function buildBuiltinAgentSelectionOverviewPayload(
  command: BuiltinAgentSelectionCommand
): Pick<
  AgentsAgentOverviewPayload,
  "commands" | "optionalArguments" | "requiredArguments"
> {
  return {
    commands: buildBuiltinAgentSelectionExamples({
      command,
      includeViewFlag: true,
    }),
    optionalArguments: getBuiltinAgentSelectionOptionalArguments(command),
    requiredArguments: getBuiltinAgentSelectionRequiredArguments(command),
  };
}

function buildAgentsAgentOverviewPayload(
  command: AgentsAgentOverviewCommand
): AgentsAgentOverviewPayload {
  switch (command) {
    case "menu": {
      return {
        summary:
          "Manage local OpenMeld-connected agents, agent visibility in Space, and custom agent targets.",
        requiredArguments: [],
        optionalArguments: [],
        commands: [
          "openmeld agents --view agent",
          "openmeld agents detect --view agent",
          "openmeld agents list --view agent",
          ...buildBuiltinAgentSelectionExamples({
            command: "enable",
            includeViewFlag: true,
          }),
          "openmeld agents manage --view agent",
        ],
        stages: [
          "Inspect available agents and current registrations.",
          "Choose an explicit subcommand for detect, list, enable, disable, show, config, or custom targets.",
        ],
        notes: [
          "Agent view does not open the human interactive agents menu.",
          "Use explicit subcommands to keep automation deterministic.",
        ],
        humanActionRequired: false,
      };
    }
    case "manage": {
      return {
        summary:
          "Review connected agent IDs and decide whether to inspect, enable, or disable them with explicit commands.",
        requiredArguments: [],
        optionalArguments: [],
        commands: [
          "openmeld agents list --view agent",
          "openmeld agents show <agent-id> --view agent",
          ...buildBuiltinAgentSelectionExamples({
            command: "repair",
            includeViewFlag: true,
          }),
          "openmeld agents config <agent-id> --enabled true|false --view agent",
          ...buildBuiltinAgentSelectionExamples({
            command: "disable",
            includeViewFlag: true,
          }),
        ],
        stages: [
          "List connected agent IDs.",
          "Inspect one agent or change enabled state with explicit subcommands.",
        ],
        notes: ["The manage menu is interactive in human view only."],
        humanActionRequired: true,
      };
    }
    case "detect": {
      return {
        summary:
          "Detect supported local AI tools on this computer and report which ones are available to OpenMeld now.",
        requiredArguments: [],
        optionalArguments: [],
        commands: ["openmeld agents detect --view agent"],
        stages: [
          "Scan supported builtin agent targets.",
          "Return detected agents and whether each one is immediately selectable.",
        ],
        notes: [],
        humanActionRequired: false,
      };
    }
    case "list": {
      return {
        summary:
          "List currently registered OpenMeld agent IDs that can wake and reply in Space.",
        requiredArguments: [],
        optionalArguments: [],
        commands: ["openmeld agents list --view agent"],
        stages: [
          "Load agent registrations from your local OpenMeld config.",
          "Return registered agents and enabled state.",
        ],
        notes: [],
        humanActionRequired: false,
      };
    }
    case "repair": {
      return {
        summary:
          "Repair one or more builtin local agents so OpenMeld can start them again on this computer.",
        ...buildBuiltinAgentSelectionOverviewPayload("repair"),
        stages: [
          "Resolve a fresh launch contract for each requested builtin agent.",
          "Persist the repaired machine launch contract into OpenMeld runtime state.",
        ],
        notes: [
          "Repair does not enable or disable agents. It refreshes how OpenMeld starts them on this computer.",
        ],
        humanActionRequired: false,
      };
    }
    case "show": {
      return {
        summary:
          "Show one registered agent ID, its current OpenMeld config, and how OpenMeld will wake it.",
        requiredArguments: ["<agent-id>"],
        optionalArguments: [],
        commands: ["openmeld agents show <agent-id> --view agent"],
        stages: [
          "Resolve the requested agent ID.",
          "Return the current registration and effective runtime config.",
        ],
        notes: [],
        humanActionRequired: false,
      };
    }
    case "enable": {
      return {
        summary:
          "Enable one or more detected agents so new Space @mentions can wake them.",
        ...buildBuiltinAgentSelectionOverviewPayload("enable"),
        stages: [
          "Resolve selectable detected agents.",
          "Register or re-enable them in your local OpenMeld config.",
          "Return per-agent enable summary.",
        ],
        notes: [
          "Use `openmeld agents detect --view agent` first if you need to discover selectable ids.",
        ],
        humanActionRequired: false,
      };
    }
    case "disable": {
      return {
        summary:
          "Disable one or more registered agents so new Space @mentions stop waking them.",
        ...buildBuiltinAgentSelectionOverviewPayload("disable"),
        stages: [
          "Resolve requested registered agent ids.",
          "Update enabled=false in your local OpenMeld config.",
          "Return per-agent disable summary.",
        ],
        notes: [],
        humanActionRequired: false,
      };
    }
    case "config": {
      return {
        summary:
          "Update a registered agent's OpenMeld configuration with explicit flags.",
        requiredArguments: ["<agent-id>", "--enabled true|false"],
        optionalArguments: [],
        commands: [
          "openmeld agents config <agent-id> --enabled true --view agent",
          "openmeld agents config <agent-id> --enabled false --view agent",
        ],
        stages: [
          "Resolve the requested registered agent id.",
          "Apply explicit config updates.",
          "Return the updated effective config.",
        ],
        notes: [],
        humanActionRequired: false,
      };
    }
    case "custom_list": {
      return {
        summary:
          "List custom agent targets stored in your local OpenMeld config and whether they are currently registered.",
        requiredArguments: [],
        optionalArguments: [],
        commands: ["openmeld agents custom list --view agent"],
        stages: [
          "Load configured custom targets.",
          "Project whether each target is registered and enabled.",
        ],
        notes: [],
        humanActionRequired: false,
      };
    }
    case "custom_add": {
      return {
        summary:
          "Add a custom agent target to your local OpenMeld config with an absolute directory path.",
        requiredArguments: ["--name <name>", "--dir <absolute-path>"],
        optionalArguments: ["--id <id>"],
        commands: [
          "openmeld agents custom add --name <name> --dir <absolute-path> --view agent",
          "openmeld agents custom add --id <id> --name <name> --dir <absolute-path> --view agent",
        ],
        stages: [
          "Validate explicit custom target input.",
          "Save the target in your local OpenMeld config.",
          "Return the created custom target.",
        ],
        notes: [],
        humanActionRequired: false,
      };
    }
    case "custom_update": {
      return {
        summary: "Update a custom agent target while keeping its ID stable.",
        requiredArguments: [
          "--id <id>",
          "one update: --name <name> | --dir <absolute-path>",
        ],
        optionalArguments: [],
        commands: [
          "openmeld agents custom update --id <id> --name <name> --view agent",
          "openmeld agents custom update --id <id> --dir <absolute-path> --view agent",
        ],
        stages: [
          "Resolve the custom target id.",
          "Apply explicit updates.",
          "Return the updated target and changed fields.",
        ],
        notes: [],
        humanActionRequired: false,
      };
    }
    case "custom_remove": {
      return {
        summary:
          "Remove a custom agent target that is not currently registered.",
        requiredArguments: ["--id <id>"],
        optionalArguments: [],
        commands: ["openmeld agents custom remove --id <id> --view agent"],
        stages: [
          "Resolve the custom target id.",
          "Verify it is not currently registered.",
          "Remove it from your local OpenMeld config and report the result.",
        ],
        notes: [
          "Install records are kept after removal; clean them up with OpenMeld skills commands when needed.",
        ],
        humanActionRequired: false,
      };
    }
    default: {
      return assertNever(command);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(
    `unsupported agents agent overview command: ${String(value)}`
  );
}
