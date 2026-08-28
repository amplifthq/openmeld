import { isAbsolute } from "node:path";
import { cancel, isCancel, select } from "@clack/prompts";
import {
  buildAgentControllerRef,
  createAgentControllerInterfaceDisplayRows,
} from "@openmeld/agent-runtime";
import { compareAgentControllerRefsForDisplay } from "@openmeld/schemas";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import pc from "picocolors";
import { emitAgentsAgentOverview } from "../agents/agent-overview";
import {
  type BuiltinAgentSelectionCommand,
  buildBuiltinAgentSelectionCommand,
  buildBuiltinAgentSelectionExamples,
  validateBuiltinAgentSelectionInput,
} from "../agents/builtin-selection-contract";
import { repairBuiltinControllerInstall } from "../agents/local-controller-install";
import {
  normalizeAgentId,
  normalizeAgentIds,
  parseAgentEnabledOption,
  sortAgentRegistrations,
} from "../agents/model";
import {
  type AgentCustomTarget,
  type AgentTargetDescriptor,
  type AgentTargetState,
  addAgentCustomTarget,
  createRegistrationFromCatalogTarget,
  listAgentCustomTargets,
  listAgentRegistrations,
  listAgentTargetStates,
  readAgentRuntimeConfigHealth,
  removeAgentCustomTarget,
  resolveAgentTargetState,
  updateAgentCustomTarget,
  updateAgentRegistrations,
} from "../agents/registry";
import {
  DEFAULT_RUNTIME_AGENT_TRANSPORT_MODE,
  type RuntimeAgentControllerState,
  type RuntimeAgentTransportMode,
} from "../config/runtime-config";
import { resolveAgentControllerInterfaceSnapshot } from "../local-service/inventory/agent-controller-interface";
import { collectLocalAgentControllerInventory } from "../local-service/inventory/agent-controller-inventory";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommands,
} from "../runtime/cli-entry-command";
import { emitCliJsonEnvelope } from "../runtime/cli-json-output";
import { resolveRuntimeContext } from "../runtime/context";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { createPresenter } from "../runtime/presenter/index";
import {
  promptSearchMultiselect,
  promptSearchSelect,
  type SearchSelectItem,
} from "../ui/search-select";
import { promptTextEntry } from "../ui/text-entry";
import { formatTransportModeDisplay } from "../ui/transport-mode-display";
import {
  buildNotReadyCountValue,
  buildReadyAgentCardRow,
  buildReadyCountValue,
  buildStatusAgentCardRow,
  renderAgentsInfoCard,
} from "./agents-cards";
import {
  buildInteractiveMenuMessage,
  emitHumanSectionHeader,
  emitInteractiveDescription,
} from "./agents-descriptions";
import {
  buildRepairDetailCards,
  buildRepairSummaryRows,
  type DisableSummary,
  type EnableSummary,
  emitDisableSummaryCardsForHuman,
  emitEnableSummaryCardsForHuman,
  type RepairSummary,
} from "./agents-summary-cards";
import {
  formatAgentMention,
  formatAgentsCopy,
  formatAgentsToneText,
  formatStatusTextForHuman,
  normalizeOptionalString,
} from "./agents-text";

type AgentsBaseInput = {
  interactive?: boolean;
  json?: boolean;
  view?: string;
  profile?: string;
};

type AgentsEnableInput = AgentsBaseInput & {
  all?: boolean;
  agent?: string[];
  install?: string;
  presentation?: "handoff" | "standalone";
};

type AgentsDisableInput = AgentsBaseInput & {
  all?: boolean;
  agent?: string[];
};

type AgentsRepairInput = AgentsBaseInput & {
  all?: boolean;
  agent?: string[];
  changeInstall?: boolean;
  install?: string;
  presentation?: "handoff" | "standalone";
};

type AgentsUnregisterInput = AgentsBaseInput & {
  agentId?: string;
};

type AgentsShowInput = AgentsBaseInput & {
  agentId?: string;
};

type AgentsConfigInput = AgentsBaseInput & {
  agentId?: string;
  enabled?: string;
};

type AgentsCustomAddInput = AgentsBaseInput & {
  id?: string;
  name?: string;
  dir?: string;
};

type AgentsCustomUpdateInput = AgentsBaseInput & {
  id?: string;
  name?: string;
  dir?: string;
};

type AgentsCustomRemoveInput = AgentsBaseInput & {
  id?: string;
};

export type AgentsEnableSummary = EnableSummary;

export type AgentsEnableResult = {
  status: "back" | "cancelled" | "completed";
  summary: AgentsEnableSummary;
};

type EnableChoiceCandidate = AgentTargetState;
type BuiltinEnableChoiceCandidate = EnableChoiceCandidate & {
  targetKind: "builtin";
};
type AgentTransportModeSource =
  | "registration"
  | "registry_default"
  | "global_default";
type AgentTransportModeStatus = "missing" | "supported" | "unsupported";
type RegisteredAgentTargetState = AgentTargetState & {
  registration: RuntimeAgentControllerState;
};
type AgentViewLaunchStatus =
  | "available"
  | "needs_choice"
  | "needs_repair"
  | "not_available";

export type AgentsRepairSummary = RepairSummary;

export type AgentsRepairResult = {
  status: "back" | "cancelled" | "completed";
  summary: AgentsRepairSummary;
};

function isBuiltinEnableChoiceCandidate(
  value: AgentTargetState | null | undefined
): value is BuiltinEnableChoiceCandidate {
  return value?.targetKind === "builtin";
}

function hasAgentRegistration(
  value: AgentTargetState | null | undefined
): value is RegisteredAgentTargetState {
  return value?.registration !== null && value?.registration !== undefined;
}

type MenuFlowResult = "completed" | "cancelled";

type PromptChoiceResult<T> =
  | {
      status: "selected";
      value: T;
    }
  | {
      status: "empty";
    }
  | {
      status: "cancelled";
    }
  | {
      status: "back";
    };

type InteractiveCustomAgentsMenuChoice =
  | "add"
  | "edit"
  | "remove"
  | "list"
  | "back";
type AgentsManageAgentActionChoice =
  (typeof AGENTS_MANAGE_AGENT_ACTION_CHOICE)[keyof typeof AGENTS_MANAGE_AGENT_ACTION_CHOICE];
type AgentsMenuChoice =
  (typeof AGENTS_MENU_CHOICE)[keyof typeof AGENTS_MENU_CHOICE];

const AGENTS_MENU_CHOICE = {
  quickEnable: "quick_enable",
  manage: "manage",
  detect: "detect",
  custom: "custom",
  exit: "exit",
} as const;

const AGENTS_MANAGE_AGENT_ACTION_CHOICE = {
  showDetails: "show_details",
  chooseInstall: "choose_install",
  repair: "repair",
  toggleEnabled: "toggle_enabled",
  back: "back",
} as const;

const CUSTOM_AGENTS_COMING_SOON_OPTION_ID = "__custom_agents_coming_soon__";
const NO_REGISTERED_AGENTS_MANAGE_MESSAGE =
  "No agents are set up on this computer yet. Run `openmeld agents detect`, then turn on the ones you want OpenMeld to use.";
const NO_ACTIONABLE_AGENTS_ENABLE_MESSAGE =
  "No more agents are available to enable. Run `openmeld agents detect` to scan this computer again.";
const AGENTS_MENU_DESCRIPTION =
  "Enable agents on this computer so people in a Space can mention them.";
const AGENTS_ENABLE_DESCRIPTION =
  "Choose which new agents OpenMeld should turn on for Space from this computer.";
const AGENTS_SELECT_REGISTERED_DESCRIPTION =
  "Choose an agent on this computer to review or change.";

const AGENTS_MENU_COMMANDS = [
  ...buildBuiltinAgentSelectionExamples({ command: "enable" }),
  ...buildBuiltinAgentSelectionExamples({ command: "repair" }),
  "openmeld agents detect",
  "openmeld agents list",
  "openmeld agents manage",
  ...buildBuiltinAgentSelectionExamples({ command: "disable" }),
  "openmeld agents show <agent-id>",
  "openmeld agents config <agent-id> --enabled true|false",
  "openmeld agents custom list",
  "openmeld agents custom add --name <name> --dir <dir> [--id <id>]",
  "openmeld agents custom update --id <id> [--name <name>] [--dir <dir>]",
  "openmeld agents custom remove --id <id>",
];

const AGENTS_MANAGE_RESULT_COMMANDS = [
  "openmeld agents list",
  "openmeld agents show <agent-id>",
  ...buildBuiltinAgentSelectionExamples({ command: "repair" }),
  "openmeld agents config <agent-id> --enabled true|false",
  ...buildBuiltinAgentSelectionExamples({ command: "disable" }),
];

function formatBuiltinAgentSelectionAlternatives(
  command: BuiltinAgentSelectionCommand
): string {
  return buildBuiltinAgentSelectionExamples({ command })
    .filter((example) => !example.includes(" --install "))
    .map((example) => `\`${example}\``)
    .join(" or ");
}

function buildBuiltinAgentMenuActions(
  command: BuiltinAgentSelectionCommand
): Array<{ command: string; description: string }> {
  switch (command) {
    case "enable":
      return [
        {
          command: buildBuiltinAgentSelectionCommand({
            all: true,
            command,
          }),
          description:
            "Enable every detected agent OpenMeld can use on this computer.",
        },
        {
          command: buildBuiltinAgentSelectionCommand({
            agentIds: ["<id...>"],
            command,
          }),
          description: "Enable selected agents so OpenMeld can use them.",
        },
        {
          command: buildBuiltinAgentSelectionCommand({
            agentIds: ["<id>"],
            command,
            installId: "<install-id>",
          }),
          description:
            "Enable one agent with the exact local install OpenMeld should use.",
        },
      ];
    case "repair":
      return [
        {
          command: buildBuiltinAgentSelectionCommand({
            all: true,
            command,
          }),
          description:
            "Repair every connected builtin agent on this computer that needs attention.",
        },
        {
          command: buildBuiltinAgentSelectionCommand({
            agentIds: ["<id...>"],
            command,
          }),
          description:
            "Refresh how OpenMeld starts selected agents on this computer.",
        },
        {
          command: buildBuiltinAgentSelectionCommand({
            agentIds: ["<id>"],
            command,
            installId: "<install-id>",
          }),
          description: "Repair one agent with the exact local install to use.",
        },
      ];
    case "disable":
      return [
        {
          command: buildBuiltinAgentSelectionCommand({
            all: true,
            command,
          }),
          description:
            "Disable every enabled agent for new mentions in Spaces.",
        },
        {
          command: buildBuiltinAgentSelectionCommand({
            agentIds: ["<id...>"],
            command,
          }),
          description:
            "Disable selected agents so new mentions in Spaces stop waking them.",
        },
      ];
    default: {
      const exhaustiveCheck: never = command;
      throw new Error(
        `unsupported builtin agent selection command: ${exhaustiveCheck}`
      );
    }
  }
}

function formatAgentViewLaunchStatus(
  status: AgentTargetState["launchStatus"]
): AgentViewLaunchStatus {
  return status === "ready" ? "available" : status;
}

function buildQuickEnableOptionHint(actionableBuiltinCount: number): string {
  return actionableBuiltinCount === 1
    ? "1 new agent can be turned on now"
    : `${String(actionableBuiltinCount)} new agents can be turned on now`;
}

function buildManageOptionHint(registeredCount: number): string {
  if (registeredCount === 0) {
    return "No agents are set up on this computer yet";
  }
  if (registeredCount === 1) {
    return "Review 1 agent on this computer";
  }
  return `Review ${String(registeredCount)} agents on this computer`;
}

function buildDetectedAgentsSubtitle(detectedAgentsCount: number): string {
  return detectedAgentsCount === 1
    ? "1 agent found on this computer"
    : `${String(detectedAgentsCount)} agents found on this computer`;
}

function buildEnabledAgentsSubtitle(enabledAgentsCount: number): string {
  return enabledAgentsCount === 1
    ? "1 agent is live for Space"
    : `${String(enabledAgentsCount)} agents are live for Space`;
}

export async function runAgents(input: AgentsBaseInput): Promise<void> {
  const runtime = await resolveRuntimeContext({
    interactive: input.interactive,
    view: input.view,
    profile: input.profile,
  });
  const presenter = createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "menu",
  });
  const payload = await buildAgentsMenuPayload();

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.menu.result",
      payload,
    });
    return;
  }

  if (canUseInteractivePrompts(runtime)) {
    await runInteractiveAgentsMenu({
      profile: input.profile,
      view: runtime.resolvedView,
    });
    return;
  }

  presenter.line({
    code: "agents.menu.header",
    text: "OpenMeld agents commands:",
  });
  for (const command of formatOpenMeldCliCommands(payload.commands)) {
    presenter.line({
      code: "agents.menu.command",
      text: `- ${command}`,
    });
  }
  for (const note of payload.notes) {
    presenter.line({
      code: "agents.menu.note",
      text: `- ${formatAgentsCopy(note)}`,
    });
  }
}

export async function runAgentsManage(input: AgentsBaseInput): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const presenter = createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "manage",
  });

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.manage.result",
      payload: {
        interactive: true,
        supportedView: "human",
        commands: [...AGENTS_MANAGE_RESULT_COMMANDS],
      },
    });
    return;
  }

  if (!canUseInteractivePrompts(runtime)) {
    presenter.line({
      code: "agents.manage.non_interactive",
      text: formatInlineOpenMeldCliCommands(
        "This menu is interactive. In scripts or non-interactive terminals, use `openmeld agents list`, `openmeld agents show <agent-id>`, `openmeld agents config <agent-id> --enabled true|false`, or `openmeld agents disable --agent <id...>`."
      ),
    });
    return;
  }

  const flow = await runInteractiveAgentsManageMenu({
    view: "human",
    profile: input.profile,
  });
  if (flow === "cancelled") {
    cancel("Cancelled.");
  }
}

async function runInteractiveAgentsMenu(input: {
  view: "human";
  profile?: string;
}): Promise<void> {
  while (true) {
    const { enableCandidates, registrations } =
      await resolveAgentsChoiceState();
    const actionableBuiltinCount = enableCandidates.filter(
      (candidate) =>
        canSelectAgentForNewLocalAgentSetup(candidate) && !candidate.registered
    ).length;
    const registeredCount = registrations.length;
    const choice = await select({
      message: buildInteractiveMenuMessage({
        title: "OpenMeld agents:",
        description: AGENTS_MENU_DESCRIPTION,
      }),
      options: [
        ...(actionableBuiltinCount > 0
          ? [
              {
                value: AGENTS_MENU_CHOICE.quickEnable,
                label: "Enable available agents",
                hint: buildQuickEnableOptionHint(actionableBuiltinCount),
              },
            ]
          : []),
        {
          value: AGENTS_MENU_CHOICE.manage,
          label: "Review Agents on This Device",
          hint: buildManageOptionHint(registeredCount),
        },
        {
          value: AGENTS_MENU_CHOICE.detect,
          label: "Find Agents on This Device",
          hint: "Check which supported AI tools OpenMeld can see here",
        },
        {
          value: AGENTS_MENU_CHOICE.exit,
          label: "Exit",
        },
      ],
    });

    if (isCancel(choice)) {
      cancel("Cancelled.");
      return;
    }
    if (choice === AGENTS_MENU_CHOICE.exit) {
      return;
    }

    const flow = await runInteractiveAgentsMenuChoice({
      input,
      choice: choice as AgentsMenuChoice,
    });
    if (flow === "cancelled") {
      cancel("Cancelled.");
      return;
    }
  }
}

async function runInteractiveAgentsMenuChoice(input: {
  input: {
    view: "human";
    profile?: string;
  };
  choice: AgentsMenuChoice;
}): Promise<MenuFlowResult | "continue"> {
  switch (input.choice) {
    case AGENTS_MENU_CHOICE.detect:
      await runAgentsDetect(input.input);
      return "continue";
    case AGENTS_MENU_CHOICE.quickEnable:
      return runInteractiveAgentsEnable(input.input);
    case AGENTS_MENU_CHOICE.manage:
      return runInteractiveAgentsManageMenu(input.input);
    case AGENTS_MENU_CHOICE.custom:
      return runInteractiveCustomAgentsMenu(input.input);
    default:
      return "continue";
  }
}

async function buildAgentsMenuPayload(): Promise<{
  commands: string[];
  notes: string[];
  actions: Array<{ command: string; description: string }>;
  selection: {
    enableCandidates: Array<{
      agentId: string;
      displayName: string;
      targetKind: AgentTargetDescriptor["targetKind"];
      detected: boolean;
      lifecycleStatus: AgentTargetState["lifecycleStatus"];
      registered: boolean;
      enabled: boolean;
      selectable: boolean;
      selectableReason: string | null;
      defaultTransportMode: string | null;
      transportModes: Array<{
        mode: string;
        label: string;
        description: string;
      }>;
      status:
        | "detected_supported"
        | "detected_needs_choice"
        | "detected_needs_repair"
        | "detected_not_supported_yet"
        | "detected_suspended"
        | "not_detected"
        | "custom_coming_soon";
      launchStatus: AgentViewLaunchStatus;
      launchStatusDetail: string | null;
      customDir?: string;
    }>;
    selectableAgentIds: string[];
    registeredAgents: Array<{
      agentId: string;
      displayName: string;
      enabled: boolean;
    }>;
    disableCandidates: Array<{
      agentId: string;
      displayName: string;
      enabled: boolean;
    }>;
    customAgents: {
      supported: boolean;
      message: string;
      commands: string[];
    };
  };
}> {
  const { enableCandidates, registrations } = await resolveAgentsChoiceState();
  const registeredAgents = registrations.map((registration) => ({
    agentId: registration.agentId,
    displayName: registration.displayName,
    enabled: registration.enabled,
  }));
  return {
    commands: formatOpenMeldCliCommands([...AGENTS_MENU_COMMANDS]),
    notes: [
      "Agents are AI tools on this computer. When you enable one, people in a Space can mention `@agent-id` to wake it and get a reply.",
      "Use `openmeld agents detect` to look for supported AI tools on this computer.",
      `Use ${formatBuiltinAgentSelectionAlternatives("enable")} to enable the agents that are available.`,
      `If OpenMeld can see an agent but cannot start it here, use ${formatBuiltinAgentSelectionAlternatives("repair")}.`,
      "Use `openmeld agents manage` to review enabled agents and change them later.",
      "Manage custom agents with `openmeld agents custom`.",
    ].map(formatAgentsCopy),
    actions: [
      ...buildBuiltinAgentMenuActions("enable"),
      ...buildBuiltinAgentMenuActions("repair"),
      {
        command: "openmeld agents detect",
        description: "Look for supported AI tools on this computer.",
      },
      {
        command: "openmeld agents list",
        description: "List the agents people can mention in a Space.",
      },
      {
        command: "openmeld agents manage",
        description: "Review enabled agents and change their settings.",
      },
      ...buildBuiltinAgentMenuActions("disable"),
      {
        command: "openmeld agents show <agent-id>",
        description: "Show one agent's current OpenMeld settings.",
      },
      {
        command: "openmeld agents config <agent-id> --enabled true|false",
        description: "Enable or disable one agent for Space mentions.",
      },
      {
        command: "openmeld agents custom list",
        description:
          "List custom agent targets stored in the local OpenMeld config.",
      },
      {
        command:
          "openmeld agents custom add --name <name> --dir <dir> [--id <id>]",
        description: "Add a custom agent target to the local OpenMeld config.",
      },
      {
        command:
          "openmeld agents custom update --id <id> [--name <name>] [--dir <dir>]",
        description:
          "Update a custom agent target while keeping its id stable.",
      },
      {
        command: "openmeld agents custom remove --id <id>",
        description:
          "Remove a custom agent target that is not currently connected.",
      },
    ].map((action) => ({
      ...action,
      command: formatOpenMeldCliCommands([action.command])[0] ?? action.command,
    })),
    selection: {
      enableCandidates: enableCandidates.map((candidate) => ({
        agentId: candidate.agentId,
        displayName: candidate.displayName,
        targetKind: candidate.targetKind,
        detected: candidate.detected,
        lifecycleStatus: candidate.lifecycleStatus,
        registered: candidate.registered,
        enabled: candidate.enabled,
        selectable: candidate.selectable,
        selectableReason: candidate.selectableReason,
        launchStatus: formatAgentViewLaunchStatus(candidate.launchStatus),
        launchStatusDetail: candidate.launchStatusDetail,
        defaultTransportMode: candidate.defaultTransportMode ?? null,
        transportModes: candidate.transportModes,
        status: resolveEnableCandidateStatus(candidate),
        ...(candidate.customDir ? { customDir: candidate.customDir } : {}),
      })),
      selectableAgentIds: enableCandidates
        .filter(canSelectAgentForNewLocalAgentSetup)
        .map((candidate) => candidate.agentId),
      registeredAgents,
      disableCandidates: registeredAgents.map((agent) => ({
        agentId: agent.agentId,
        displayName: agent.displayName,
        enabled: agent.enabled,
      })),
      customAgents: {
        supported: false,
        message: formatAgentsCopy(
          "Custom agents are not available in this list yet. Use `openmeld agents custom` for now."
        ),
        commands: formatOpenMeldCliCommands([
          "openmeld agents custom list",
          "openmeld agents custom add --name <name> --dir <dir> [--id <id>]",
          "openmeld agents custom update --id <id> [--name <name>] [--dir <dir>]",
          "openmeld agents custom remove --id <id>",
        ]),
      },
    },
  };
}

async function resolveAgentsChoiceState(): Promise<{
  registrations: RuntimeAgentControllerState[];
  enableCandidates: EnableChoiceCandidate[];
}> {
  const enableCandidates = await listAgentTargetStates();
  const registrations = enableCandidates
    .flatMap((candidate) =>
      candidate.registration ? [candidate.registration] : []
    )
    .sort((left, right) =>
      compareAgentControllerRefsForDisplay(left.agentId, right.agentId)
    );
  return {
    registrations,
    enableCandidates,
  };
}

function resolveEnableCandidateStatus(
  candidate: EnableChoiceCandidate
):
  | "detected_supported"
  | "detected_needs_choice"
  | "detected_needs_repair"
  | "detected_not_supported_yet"
  | "detected_suspended"
  | "not_detected"
  | "custom_coming_soon" {
  if (candidate.targetKind === "custom") {
    return "custom_coming_soon";
  }
  if (!candidate.detected) {
    return "not_detected";
  }
  if (candidate.lifecycleStatus === "suspended") {
    return "detected_suspended";
  }
  if (candidate.launchStatus === "needs_choice") {
    return "detected_needs_choice";
  }
  if (candidate.launchStatus === "needs_repair") {
    return "detected_needs_repair";
  }
  if (!candidate.selectable) {
    return "detected_not_supported_yet";
  }
  return "detected_supported";
}

function canSelectAgentForNewLocalAgentSetup(
  candidate: EnableChoiceCandidate
): boolean {
  return (
    candidate.targetKind === "builtin" &&
    candidate.lifecycleStatus !== "suspended" &&
    candidate.selectable
  );
}

function buildUnifiedEnableTargetHint(
  candidate: EnableChoiceCandidate
): string {
  if (candidate.enabled) {
    return "Already turned on in OpenMeld";
  }
  if (!candidate.detected) {
    return "Not found on this computer";
  }
  if (candidate.lifecycleStatus === "suspended") {
    return "Suspended for new OpenMeld profiles";
  }
  if (candidate.launchStatus === "needs_choice") {
    return "Needs your choice on this Mac before OpenMeld can turn it on";
  }
  if (
    !candidate.selectable &&
    candidate.selectableReason === "not_supported_yet"
  ) {
    return "Found on this computer, but OpenMeld doesn't support it yet";
  }
  if (!candidate.selectable && candidate.selectableReason === "needs_repair") {
    return "Needs repair before OpenMeld can start it here";
  }
  if (!candidate.selectable && candidate.selectableReason) {
    return formatSelectableReasonForHuman(candidate.selectableReason);
  }
  return "Available to enable now";
}

function formatSelectableReason(reason: string): string {
  if (reason === "not_detected") {
    return "not found";
  }
  if (reason === "not_supported_yet") {
    return "will be supported soon";
  }
  if (reason === "custom_coming_soon") {
    return "coming soon";
  }
  if (reason === "needs_choice") {
    return "needs your choice";
  }
  if (reason === "needs_repair") {
    return "needs repair";
  }
  if (reason === "suspended") {
    return "suspended";
  }
  return reason;
}

function formatSelectableReasonForHuman(reason: string): string {
  if (reason === "not_detected") {
    return "Not found on this computer";
  }
  if (reason === "not_supported_yet") {
    return "Found on this computer, but OpenMeld doesn't support it yet";
  }
  if (reason === "custom_coming_soon") {
    return "Custom agent support is coming soon";
  }
  if (reason === "needs_choice") {
    return "Needs your choice on this Mac before OpenMeld can use it";
  }
  if (reason === "needs_repair") {
    return "Needs repair on this computer before OpenMeld can start it";
  }
  if (reason === "suspended") {
    return "Suspended for new OpenMeld profiles";
  }
  return formatStatusTextForHuman(reason);
}

function resolveEnableBlockedReason(
  state: {
    targetKind: AgentTargetDescriptor["targetKind"];
    detected: boolean;
    launchStatus?: EnableChoiceCandidate["launchStatus"];
    selectable: boolean;
    selectableReason: string | null;
    lifecycleStatus?: AgentTargetState["lifecycleStatus"];
  } | null
): string {
  if (!state) {
    return "unknown built-in target id";
  }
  if (state.targetKind === "custom") {
    return "custom target is not runnable yet";
  }
  if (!state.detected) {
    return "not found";
  }
  if (state.lifecycleStatus === "suspended") {
    return "suspended for new OpenMeld profiles";
  }
  if (state.launchStatus === "needs_choice") {
    return "needs your choice";
  }
  if (!state.selectable && state.selectableReason === "needs_repair") {
    return "needs repair";
  }
  if (!state.selectable && state.selectableReason) {
    return formatSelectableReason(state.selectableReason);
  }
  return "not selectable in current runtime";
}

function buildRegisteredAgentHint(
  state: EnableChoiceCandidate & { registration: RuntimeAgentControllerState }
): string {
  const activationHint = state.registration.enabled
    ? "Turned on"
    : "Turned off for new @mentions";
  if (state.launchStatus === "needs_choice") {
    return buildMetadataDetailLine([
      activationHint,
      "Needs your choice on this Mac",
    ]);
  }
  if (state.launchStatus === "needs_repair") {
    return buildMetadataDetailLine([
      activationHint,
      "Needs repair on this computer",
    ]);
  }
  return buildMetadataDetailLine([
    activationHint,
    state.registration.enabled ? "Live for Space @mentions" : null,
  ]);
}

async function runInteractiveAgentsEnable(input: {
  view: "human";
  profile?: string;
}): Promise<MenuFlowResult> {
  const { enableCandidates } = await resolveAgentsChoiceState();
  const builtinCandidates = enableCandidates.filter(
    (candidate) => candidate.targetKind === "builtin"
  );
  const actionableCandidates = builtinCandidates.filter(
    (candidate) =>
      canSelectAgentForNewLocalAgentSetup(candidate) && !candidate.registered
  );
  if (actionableCandidates.length === 0) {
    process.stderr.write(
      `${formatAgentsCopy(NO_ACTIONABLE_AGENTS_ENABLE_MESSAGE)}\n`
    );
    return "completed";
  }

  const selectedResult = await promptEnableAgentIdsFromUnifiedBuiltins({
    candidates: actionableCandidates,
  });
  if (selectedResult.status === "cancelled") {
    return "cancelled";
  }
  if (selectedResult.status !== "selected") {
    return "completed";
  }
  await runAgentsEnable({
    agent: selectedResult.value,
    profile: input.profile,
    view: input.view,
  });
  return "completed";
}

async function runInteractiveCustomAgentsMenu(input: {
  view: "human";
  profile?: string;
}): Promise<MenuFlowResult> {
  while (true) {
    const choiceResult = await promptInteractiveCustomAgentsMenuChoice();
    const outcome = await handleInteractiveCustomAgentsMenuChoice({
      input,
      choiceResult,
    });
    if (outcome === "continue") {
      continue;
    }
    return outcome;
  }
}

async function runInteractiveAgentsManageMenu(input: {
  view: "human";
  profile?: string;
}): Promise<MenuFlowResult> {
  const registeredStates = await listRegisteredAgentStates();
  if (registeredStates.length === 0) {
    process.stderr.write(
      `${formatAgentsCopy(NO_REGISTERED_AGENTS_MANAGE_MESSAGE)}\n`
    );
    return "completed";
  }

  while (true) {
    const selectedAgentResult = await promptSelectRegisteredAgent({
      message: "Choose an agent",
      emptyMessage: NO_REGISTERED_AGENTS_MANAGE_MESSAGE,
    });
    if (selectedAgentResult.status === "cancelled") {
      return "cancelled";
    }
    if (selectedAgentResult.status !== "selected") {
      return "completed";
    }

    const selectedState = selectedAgentResult.value;
    const actionResult = await promptInteractiveAgentsManageAgentAction({
      agentId: selectedState.agentId,
      displayName: selectedState.displayName,
      enabled: selectedState.enabled,
      launchStatus: selectedState.launchStatus,
    });
    if (actionResult.status === "cancelled") {
      return "cancelled";
    }
    if (
      actionResult.status !== "selected" ||
      actionResult.value === AGENTS_MANAGE_AGENT_ACTION_CHOICE.back
    ) {
      continue;
    }
    if (actionResult.value === AGENTS_MANAGE_AGENT_ACTION_CHOICE.showDetails) {
      await runAgentsShow({
        agentId: selectedState.agentId,
        profile: input.profile,
        view: input.view,
      });
      continue;
    }
    if (actionResult.value === AGENTS_MANAGE_AGENT_ACTION_CHOICE.repair) {
      await runAgentsRepair({
        agent: [selectedState.agentId],
        profile: input.profile,
        view: input.view,
      });
      continue;
    }
    if (
      actionResult.value === AGENTS_MANAGE_AGENT_ACTION_CHOICE.chooseInstall
    ) {
      await runAgentsRepair({
        agent: [selectedState.agentId],
        changeInstall: true,
        profile: input.profile,
        view: input.view,
      });
      continue;
    }

    await runAgentsConfig({
      agentId: selectedState.agentId,
      enabled: selectedState.enabled ? "false" : "true",
      profile: input.profile,
      view: input.view,
    });
  }
}

async function handleInteractiveCustomAgentsMenuChoice(input: {
  input: {
    view: "human";
    profile?: string;
  };
  choiceResult: PromptChoiceResult<InteractiveCustomAgentsMenuChoice>;
}): Promise<MenuFlowResult | "continue"> {
  if (input.choiceResult.status === "cancelled") {
    return "cancelled";
  }
  if (input.choiceResult.status !== "selected") {
    return "completed";
  }

  switch (input.choiceResult.value) {
    case "back":
      return "completed";
    case "list":
      await runAgentsCustomList({
        profile: input.input.profile,
        view: input.input.view,
      });
      return "continue";
    case "add": {
      const flow = await runInteractiveCustomAgentsAddFlow(input.input);
      return flow === "cancelled" ? "cancelled" : "continue";
    }
    case "remove": {
      const flow = await runInteractiveCustomAgentsRemoveFlow(input.input);
      return flow === "cancelled" ? "cancelled" : "continue";
    }
    case "edit": {
      const flow = await runInteractiveCustomAgentsEditFlow(input.input);
      return flow === "cancelled" ? "cancelled" : "continue";
    }
    default:
      return "completed";
  }
}

async function promptInteractiveAgentsManageAgentAction(input: {
  agentId: string;
  displayName: string;
  enabled: boolean;
  launchStatus: EnableChoiceCandidate["launchStatus"];
}): Promise<PromptChoiceResult<AgentsManageAgentActionChoice>> {
  const action = await select({
    message: buildInteractiveMenuMessage({
      title: `Agent: ${input.agentId}`,
      description: `When on, @${input.agentId} in Space can wake ${input.displayName}.`,
    }),
    options: [
      {
        value: AGENTS_MANAGE_AGENT_ACTION_CHOICE.showDetails,
        label: "View Setup",
      },
      ...(input.launchStatus === "needs_choice"
        ? [
            {
              value: AGENTS_MANAGE_AGENT_ACTION_CHOICE.chooseInstall,
              label: "Choose install on This Device",
              hint: "Pick which local install OpenMeld should use",
            },
          ]
        : []),
      ...(input.launchStatus === "needs_repair"
        ? [
            {
              value: AGENTS_MANAGE_AGENT_ACTION_CHOICE.repair,
              label: "Repair on This Device",
              hint: "Refresh how OpenMeld starts it locally",
            },
          ]
        : []),
      ...(input.launchStatus === "ready"
        ? [
            {
              value: AGENTS_MANAGE_AGENT_ACTION_CHOICE.chooseInstall,
              label: "Change install on This Device",
              hint: "Pick a different local install for future replies",
            },
          ]
        : []),
      {
        value: AGENTS_MANAGE_AGENT_ACTION_CHOICE.toggleEnabled,
        label: input.enabled
          ? "Turn Off for Space @mentions"
          : "Turn On for Space @mentions",
        hint: input.enabled
          ? "Stop waking it for new @mentions"
          : "Allow @mentions to wake it again",
      },
      {
        value: AGENTS_MANAGE_AGENT_ACTION_CHOICE.back,
        label: "Back to Agents",
      },
    ],
  });
  if (isCancel(action)) {
    return {
      status: "cancelled",
    };
  }
  return {
    status: "selected",
    value: action as AgentsManageAgentActionChoice,
  };
}

async function promptInteractiveCustomAgentsMenuChoice(): Promise<
  PromptChoiceResult<InteractiveCustomAgentsMenuChoice>
> {
  const choice = await select({
    message: "Custom Targets:",
    options: [
      {
        value: "add",
        label: "Add custom target",
        hint: "Create a new custom agent target",
      },
      {
        value: "edit",
        label: "Edit custom target",
        hint: "Update name or dir (id remains stable)",
      },
      {
        value: "remove",
        label: "Remove custom target",
        hint: "Blocked when target is currently registered",
      },
      {
        value: "list",
        label: "List custom targets",
        hint: "Show custom targets and current status",
      },
      {
        value: "back",
        label: "Back",
      },
    ],
  });
  if (isCancel(choice)) {
    return {
      status: "cancelled",
    };
  }
  return {
    status: "selected",
    value: choice as InteractiveCustomAgentsMenuChoice,
  };
}

async function runInteractiveCustomAgentsAddFlow(input: {
  view: "human";
  profile?: string;
}): Promise<MenuFlowResult> {
  let namePlaceholder = "e.g. OpenMeld Agent Executor";
  let dirPlaceholder = "/absolute/path/to/skills";
  let idPlaceholder = "leave empty to auto-generate from dir";

  while (true) {
    const nameResult = await promptRequiredInteractiveText({
      message: "Custom target name",
      placeholder: namePlaceholder,
      requiredMessage: "Custom target name is required.",
    });
    if (nameResult.status === "cancelled") {
      return "cancelled";
    }
    if (nameResult.status !== "selected") {
      return "completed";
    }
    namePlaceholder = nameResult.value;

    const addDetails = await promptInteractiveCustomAgentAddDetails({
      dirPlaceholder,
      idPlaceholder,
    });
    if (addDetails.status === "cancelled") {
      return "cancelled";
    }
    if (addDetails.status !== "submitted") {
      continue;
    }
    dirPlaceholder = addDetails.value.dir;
    if (addDetails.value.idInput) {
      idPlaceholder = addDetails.value.idInput;
    }

    await runAgentsCustomAdd({
      name: nameResult.value,
      dir: addDetails.value.dir,
      ...(addDetails.value.id ? { id: addDetails.value.id } : {}),
      profile: input.profile,
      view: input.view,
    });
    return "completed";
  }
}

async function runInteractiveCustomAgentsRemoveFlow(input: {
  view: "human";
  profile?: string;
}): Promise<MenuFlowResult> {
  const selectedTargetResult = await promptSelectCustomTarget({
    message: "Select custom target to remove",
    emptyMessage:
      "No custom targets available. Add a custom target with `openmeld agents custom add --name <name> --dir <dir>`.",
  });
  if (selectedTargetResult.status === "cancelled") {
    return "cancelled";
  }
  if (selectedTargetResult.status !== "selected") {
    return "completed";
  }
  await runAgentsCustomRemove({
    id: selectedTargetResult.value.id,
    profile: input.profile,
    view: input.view,
  });
  return "completed";
}

async function runInteractiveCustomAgentsEditFlow(input: {
  view: "human";
  profile?: string;
}): Promise<MenuFlowResult> {
  while (true) {
    const selectedTargetResult = await promptSelectCustomTarget({
      message: "Select custom target to edit",
      emptyMessage:
        "No custom targets available. Add a custom target with `openmeld agents custom add --name <name> --dir <dir>`.",
    });
    if (selectedTargetResult.status === "cancelled") {
      return "cancelled";
    }
    if (selectedTargetResult.status !== "selected") {
      return "completed";
    }
    const updateRequest = await promptInteractiveCustomAgentUpdate(
      selectedTargetResult.value
    );
    if (updateRequest.status === "cancelled") {
      return "cancelled";
    }
    if (updateRequest.status !== "submitted") {
      continue;
    }

    await runAgentsCustomUpdate({
      id: updateRequest.value.id,
      ...("name" in updateRequest.value
        ? { name: updateRequest.value.name }
        : { dir: updateRequest.value.dir }),
      profile: input.profile,
      view: input.view,
    });
    return "completed";
  }
}

async function promptInteractiveCustomAgentAddDetails(input: {
  dirPlaceholder: string;
  idPlaceholder: string;
}): Promise<
  | {
      status: "submitted";
      value: {
        dir: string;
        id?: string;
        idInput?: string;
      };
    }
  | {
      status: "back" | "cancelled";
    }
> {
  while (true) {
    const dirResult = await promptRequiredInteractiveText({
      message: "Custom target absolute dir",
      placeholder: input.dirPlaceholder,
      requiredMessage: "Custom target absolute dir is required.",
      validate: (value) =>
        isAbsolute(value)
          ? null
          : "Custom target absolute dir must be an absolute path.",
    });
    if (dirResult.status === "cancelled" || dirResult.status === "back") {
      return dirResult;
    }
    if (dirResult.status !== "selected") {
      continue;
    }

    const idResult = await promptInteractiveText({
      message: "Custom target id (optional)",
      placeholder: input.idPlaceholder,
      allowEmpty: true,
    });
    if (idResult.status === "cancelled") {
      return idResult;
    }
    if (idResult.status === "back") {
      input.dirPlaceholder = dirResult.value;
      continue;
    }
    if (idResult.status !== "selected") {
      continue;
    }

    return {
      status: "submitted",
      value: {
        dir: dirResult.value,
        id: normalizeOptionalString(idResult.value) ?? undefined,
        idInput: normalizeOptionalString(idResult.value) ?? undefined,
      },
    };
  }
}

async function promptInteractiveCustomAgentUpdate(
  selectedTarget: AgentCustomTarget
): Promise<
  | {
      status: "submitted";
      value:
        | {
            id: string;
            name: string;
          }
        | {
            id: string;
            dir: string;
          };
    }
  | {
      status: "back" | "cancelled";
    }
> {
  while (true) {
    const field = await promptInteractiveCustomAgentEditField();
    if (field.status === "cancelled" || field.status === "back") {
      return field;
    }
    if (field.status !== "selected") {
      continue;
    }

    const valueResult = await promptInteractiveCustomAgentEditValue({
      field: field.value,
      selectedTarget,
    });
    if (valueResult.status === "cancelled") {
      return valueResult;
    }
    if (valueResult.status === "back") {
      continue;
    }
    if (valueResult.status !== "selected") {
      continue;
    }
    return {
      status: "submitted",
      value:
        field.value === "name"
          ? {
              id: selectedTarget.id,
              name: valueResult.value,
            }
          : {
              id: selectedTarget.id,
              dir: valueResult.value,
            },
    };
  }
}

async function promptInteractiveCustomAgentEditField(): Promise<
  PromptChoiceResult<"name" | "dir">
> {
  const field = await select({
    message: "Edit field",
    options: [
      {
        value: "name",
        label: "Name",
      },
      {
        value: "dir",
        label: "Dir",
      },
      {
        value: "back",
        label: "Back",
      },
    ],
  });
  if (isCancel(field)) {
    return {
      status: "cancelled",
    };
  }
  if (field === "back") {
    return {
      status: "back",
    };
  }
  return {
    status: "selected",
    value: field,
  };
}

function promptInteractiveCustomAgentEditValue(input: {
  field: "name" | "dir";
  selectedTarget: AgentCustomTarget;
}): Promise<PromptChoiceResult<string>> {
  return input.field === "name"
    ? promptRequiredInteractiveText({
        message: "New name",
        placeholder: input.selectedTarget.name,
        requiredMessage: "Custom target name is required.",
      })
    : promptRequiredInteractiveText({
        message: "New absolute dir",
        placeholder: input.selectedTarget.dir,
        requiredMessage: "Custom target absolute dir is required.",
        validate: (nextDir) =>
          isAbsolute(nextDir)
            ? null
            : "Custom target absolute dir must be an absolute path.",
      });
}

async function promptInteractiveText(input: {
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
}): Promise<PromptChoiceResult<string>> {
  const value = await promptTextEntry({
    message: input.message,
    ...(input.placeholder ? { placeholder: input.placeholder } : {}),
    allowBack: true,
    backLabel: "Back",
    allowEmpty: input.allowEmpty === true,
    requiredMessage: "Value is required.",
  });
  if (value.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  if (value.status === "back") {
    return {
      status: "back",
    };
  }
  return {
    status: "selected",
    value: value.value,
  };
}

async function promptRequiredInteractiveText(input: {
  message: string;
  placeholder?: string;
  requiredMessage: string;
  validate?: (value: string) => string | null;
}): Promise<PromptChoiceResult<string>> {
  while (true) {
    const valueResult = await promptInteractiveText({
      message: input.message,
      ...(input.placeholder ? { placeholder: input.placeholder } : {}),
    });
    if (valueResult.status === "cancelled" || valueResult.status === "back") {
      return valueResult;
    }
    if (valueResult.status !== "selected") {
      continue;
    }

    const normalizedValue = normalizeOptionalString(valueResult.value);
    if (!normalizedValue) {
      process.stderr.write(`${input.requiredMessage}\n`);
      continue;
    }

    const validationMessage = input.validate?.(normalizedValue) ?? null;
    if (validationMessage) {
      process.stderr.write(`${validationMessage}\n`);
      continue;
    }
    return {
      status: "selected",
      value: normalizedValue,
    };
  }
}

async function promptSelectCustomTarget(input: {
  message: string;
  emptyMessage: string;
}): Promise<PromptChoiceResult<AgentCustomTarget>> {
  const customTargets = await listAgentCustomTargets();
  if (customTargets.length === 0) {
    process.stderr.write(`${formatAgentsCopy(input.emptyMessage)}\n`);
    return {
      status: "empty",
    };
  }

  const choice = await promptSearchSelect({
    message: input.message,
    items: customTargets.map(buildCustomTargetSearchItem),
    maxVisible: 8,
    allowBack: true,
    backLabel: "Back",
  });
  if (choice.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  if (choice.status === "back") {
    return {
      status: "back",
    };
  }

  const id = normalizeAgentId(choice.value);
  const selectedTarget = customTargets.find((target) => target.id === id);
  if (!selectedTarget) {
    return {
      status: "empty",
    };
  }
  return {
    status: "selected",
    value: selectedTarget,
  };
}

async function promptEnableAgentIdsFromUnifiedBuiltins(input: {
  candidates: EnableChoiceCandidate[];
}): Promise<PromptChoiceResult<string[]>> {
  const selectableCandidates = input.candidates.filter(
    (candidate) =>
      canSelectAgentForNewLocalAgentSetup(candidate) && !candidate.enabled
  );
  if (selectableCandidates.length === 0) {
    process.stderr.write(
      `${formatAgentsCopy(NO_ACTIONABLE_AGENTS_ENABLE_MESSAGE)}\n`
    );
    return {
      status: "empty",
    };
  }

  emitInteractiveDescription(AGENTS_ENABLE_DESCRIPTION);
  const selected = await promptSearchMultiselect({
    message: "Choose agents to enable",
    items: [
      ...selectableCandidates.map(buildUnifiedEnableSearchItem),
      {
        value: CUSTOM_AGENTS_COMING_SOON_OPTION_ID,
        label: "Custom agents (coming soon)",
        detail: formatInlineOpenMeldCliCommands(
          "Use `openmeld agents custom` commands for custom targets for now."
        ),
        searchText:
          "Custom agents (coming soon) Use openmeld agents custom commands for custom targets for now",
        disabled: true,
      },
    ],
    required: true,
    maxVisible: 8,
    allowBack: true,
    backLabel: "Back",
  });
  if (selected.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  if (selected.status === "back") {
    return {
      status: "back",
    };
  }

  const agentIds = normalizeAgentIds(selected.value.sort()).filter(
    (agentId) => agentId !== CUSTOM_AGENTS_COMING_SOON_OPTION_ID
  );
  if (agentIds.length === 0) {
    return {
      status: "empty",
    };
  }
  return {
    status: "selected",
    value: agentIds,
  };
}

async function listRegisteredAgentStates(): Promise<
  Array<
    EnableChoiceCandidate & {
      registration: RuntimeAgentControllerState;
    }
  >
> {
  return (await listAgentTargetStates()).filter(
    (
      state
    ): state is EnableChoiceCandidate & {
      registration: RuntimeAgentControllerState;
    } => Boolean(state.registration)
  );
}

async function promptSelectRegisteredAgent(input: {
  message: string;
  emptyMessage: string;
}): Promise<
  PromptChoiceResult<
    EnableChoiceCandidate & { registration: RuntimeAgentControllerState }
  >
> {
  const registeredStates = await listRegisteredAgentStates();
  if (registeredStates.length === 0) {
    process.stderr.write(`${formatAgentsCopy(input.emptyMessage)}\n`);
    return {
      status: "empty",
    };
  }

  emitInteractiveDescription(AGENTS_SELECT_REGISTERED_DESCRIPTION);
  const choice = await promptSearchSelect({
    message: input.message,
    items: registeredStates.map(buildRegisteredAgentSearchItem),
    maxVisible: 8,
    allowBack: true,
    backLabel: "Back",
  });
  if (choice.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  if (choice.status === "back") {
    return {
      status: "back",
    };
  }
  const agentId = normalizeAgentId(choice.value);
  if (!agentId) {
    return {
      status: "empty",
    };
  }
  const selectedState = registeredStates.find(
    (state) => state.agentId === agentId
  );
  if (!selectedState) {
    return {
      status: "empty",
    };
  }
  return {
    status: "selected",
    value: selectedState,
  };
}

function buildCustomTargetSearchItem(
  target: AgentCustomTarget
): SearchSelectItem<string> {
  return {
    value: target.id,
    label: target.name,
    detail: buildMetadataDetailLine([`ID ${target.id}`, target.dir]),
    searchText: [target.name, target.id, target.dir].join(" "),
  };
}

function buildUnifiedEnableSearchItem(
  candidate: EnableChoiceCandidate
): SearchSelectItem<string> {
  const statusHint = buildUnifiedEnableTargetHint(candidate);
  return {
    value: candidate.agentId,
    label: candidate.displayName,
    detail: buildMetadataDetailLine([`ID ${candidate.agentId}`, statusHint]),
    searchText: [
      candidate.displayName,
      candidate.agentId,
      statusHint,
      candidate.selectableReason ?? "",
    ].join(" "),
    disabled:
      !canSelectAgentForNewLocalAgentSetup(candidate) || candidate.enabled,
  };
}

function buildRegisteredAgentSearchItem(
  state: EnableChoiceCandidate & { registration: RuntimeAgentControllerState }
): SearchSelectItem<string> {
  const enabledHint = buildRegisteredAgentHint(state);
  return {
    value: state.agentId,
    label: state.agentId,
    detail: buildMetadataDetailLine([state.displayName, enabledHint]),
    searchText: [
      state.displayName,
      state.agentId,
      enabledHint,
      "space wake mention reply",
    ].join(" "),
  };
}

function buildMetadataDetailLine(
  parts: Array<string | null | undefined>
): string {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" · ");
}

export async function runAgentsDetect(input: AgentsBaseInput): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const inventory = await collectLocalAgentControllerInventory();
  const detectedAgents = inventory.capabilities
    .filter(
      (capability) =>
        capability.detected &&
        (capability.lifecycleStatus !== "suspended" || capability.enabled)
    )
    .map((capability) => ({
      id: capability.agentId,
      blockerReasonCodes: capability.blockerReasonCodes,
      displayName: capability.displayName,
      launchability: capability.launchability,
      launchStatus: formatAgentViewLaunchStatus(capability.launchStatus),
      launchStatusDetail: capability.launchStatusDetail,
      lifecycleStatus: capability.lifecycleStatus,
      selectable: capability.selectable,
    }));
  const payload = {
    detectedAgents,
    count: detectedAgents.length,
    inventorySource: "local_runtime_inventory",
    source: "builtin_detect",
  };

  if (input.json === true) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "agents.detect",
      ...payload,
    });
    return;
  }

  const presenter = createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "detect",
  });

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.detect.result",
      payload,
    });
    return;
  }

  const readyAgents = detectedAgents.filter(
    (agent) =>
      agent.lifecycleStatus !== "suspended" &&
      agent.launchability === "launchable"
  );
  const needsChoiceAgents = detectedAgents.filter(
    (agent) =>
      agent.lifecycleStatus !== "suspended" &&
      agent.launchability === "needs_choice"
  );
  const needsRepairAgents = detectedAgents.filter(
    (agent) =>
      agent.lifecycleStatus !== "suspended" &&
      agent.launchability === "needs_repair"
  );
  const comingSoonAgents = detectedAgents.filter(
    (agent) =>
      agent.lifecycleStatus !== "suspended" &&
      agent.launchability === "not_supported" &&
      !agent.selectable
  );
  const suspendedAgents = detectedAgents.filter(
    (agent) => agent.lifecycleStatus === "suspended"
  );
  const notDetectedAgents = inventory.capabilities.filter(
    (capability) => !capability.detected
  );
  if (detectedAgents.length === 0) {
    renderAgentsInfoCard({
      presenter,
      codePrefix: "agents.detect.empty.card",
      title: "Agents Found Here",
      rows: [
        {
          label: "Found",
          value: pc.dim("No supported AI agents yet"),
        },
        {
          label: "Next",
          value: formatInlineOpenMeldCliCommands(
            "Open or install the AI tool you want OpenMeld to use, then run `openmeld agents detect` again."
          ),
        },
      ],
      minContentWidth: 36,
    });
    return;
  }

  renderAgentsInfoCard({
    presenter,
    codePrefix: "agents.detect.summary.card",
    title: "Agents Found Here",
    rows: [
      {
        label: "Found",
        value: buildDetectedAgentsSubtitle(detectedAgents.length),
      },
      {
        label: "Available now",
        value: buildReadyCountValue(readyAgents.length, "live for Space"),
      },
      {
        label: "Needs choice",
        value: buildNotReadyCountValue(
          needsChoiceAgents.length,
          "found, needs your choice"
        ),
      },
      {
        label: "Needs repair",
        value: buildNotReadyCountValue(
          needsRepairAgents.length,
          "found, needs repair"
        ),
      },
      {
        label: "Coming soon",
        value: buildNotReadyCountValue(
          comingSoonAgents.length,
          "found, not supported yet"
        ),
      },
      {
        label: "Suspended",
        value: buildNotReadyCountValue(
          suspendedAgents.length,
          "already configured, not offered for new profiles"
        ),
      },
      {
        label: "Not found",
        value: buildNotReadyCountValue(
          notDetectedAgents.length,
          "not found on this computer"
        ),
      },
    ],
    minContentWidth: 42,
  });

  if (readyAgents.length > 0) {
    presenter.line({
      code: "agents.detect.ready.spacer",
      text: "",
    });
    renderAgentsInfoCard({
      presenter,
      codePrefix: "agents.detect.ready.card",
      title: `Available Now (${readyAgents.length})`,
      rows: readyAgents.map((agent) =>
        buildReadyAgentCardRow(agent.id, agent.displayName)
      ),
      minContentWidth: 30,
    });
  }

  if (needsRepairAgents.length > 0) {
    presenter.line({
      code: "agents.detect.needs_repair.spacer",
      text: "",
    });
    renderAgentsInfoCard({
      presenter,
      codePrefix: "agents.detect.needs_repair.card",
      title: `Needs Repair (${needsRepairAgents.length})`,
      rows: needsRepairAgents.map((agent) =>
        buildStatusAgentCardRow({
          agentId: agent.id,
          displayName: agent.displayName,
          // Prefer the real per-agent reason (e.g. "Codex is installed, but
          // OpenMeld can't start it on this device.") over a generic label so
          // an agent that OpenMeld found but could not launch is never
          // reported the same way as one that was never found at all.
          detail:
            agent.launchStatusDetail ??
            "Repair on this computer before OpenMeld can start it",
        })
      ),
      minContentWidth: 36,
    });
  }

  if (needsChoiceAgents.length > 0) {
    presenter.line({
      code: "agents.detect.needs_choice.spacer",
      text: "",
    });
    renderAgentsInfoCard({
      presenter,
      codePrefix: "agents.detect.needs_choice.card",
      title: `Needs Your Choice (${needsChoiceAgents.length})`,
      rows: needsChoiceAgents.map((agent) =>
        buildStatusAgentCardRow({
          agentId: agent.id,
          displayName: agent.displayName,
          detail: "Choose which install OpenMeld should use on this Mac",
        })
      ),
      minContentWidth: 36,
    });
  }

  if (comingSoonAgents.length > 0) {
    presenter.line({
      code: "agents.detect.coming_soon.spacer",
      text: "",
    });
    renderAgentsInfoCard({
      presenter,
      codePrefix: "agents.detect.coming_soon.card",
      title: `Coming Soon (${comingSoonAgents.length})`,
      rows: comingSoonAgents.map((agent) =>
        buildStatusAgentCardRow({
          agentId: agent.id,
          displayName: agent.displayName,
          detail:
            "OpenMeld found it, but builtin runtime support is not available yet",
        })
      ),
      minContentWidth: 36,
    });
  }

  if (suspendedAgents.length > 0) {
    presenter.line({
      code: "agents.detect.suspended.spacer",
      text: "",
    });
    renderAgentsInfoCard({
      presenter,
      codePrefix: "agents.detect.suspended.card",
      title: `Suspended (${suspendedAgents.length})`,
      rows: suspendedAgents.map((agent) =>
        buildStatusAgentCardRow({
          agentId: agent.id,
          displayName: agent.displayName,
          detail:
            "Already configured here, but OpenMeld no longer offers it for new profiles",
        })
      ),
      minContentWidth: 46,
    });
  }
}

export async function runAgentsList(input: AgentsBaseInput): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const states = await listAgentTargetStates();
  const registrations = states
    .filter(hasAgentRegistration)
    .map((state) => buildAgentRegistrationAgentView(state))
    .sort((left, right) =>
      compareAgentControllerRefsForDisplay(left.agentId, right.agentId)
    );
  const payload = {
    registrations,
    count: registrations.length,
  };

  if (input.json === true) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "agents.list",
      ...payload,
    });
    return;
  }

  const presenter = createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "list",
  });

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.list.result",
      payload,
    });
    return;
  }

  const enabledStates = states.filter((state) => state.registration?.enabled);
  const readyEnabledStates = enabledStates.filter(
    (state) => state.launchStatus === "ready"
  );
  const needsChoiceEnabledStates = enabledStates.filter(
    (state) => state.launchStatus === "needs_choice"
  );
  const needsRepairEnabledStates = enabledStates.filter(
    (state) => state.launchStatus === "needs_repair"
  );
  if (
    readyEnabledStates.length === 0 &&
    needsChoiceEnabledStates.length === 0 &&
    needsRepairEnabledStates.length === 0
  ) {
    renderAgentsInfoCard({
      presenter,
      codePrefix: "agents.list.empty.card",
      title: "Agents Available for Space",
      rows: [
        {
          label: "Live now",
          value: pc.dim("No agents are live yet"),
        },
        {
          label: "Next",
          value: formatInlineOpenMeldCliCommands(
            "Run `openmeld agents detect`, then enable the agents you want OpenMeld to use."
          ),
        },
      ],
      minContentWidth: 38,
    });
    return;
  }

  renderAgentsInfoCard({
    presenter,
    codePrefix: "agents.list.summary.card",
    title: "Agents Available for Space",
    rows: [
      {
        label: "Live now",
        value: buildEnabledAgentsSubtitle(readyEnabledStates.length),
      },
      {
        label: "Needs choice",
        value: String(needsChoiceEnabledStates.length),
      },
      {
        label: "Needs repair",
        value: String(needsRepairEnabledStates.length),
      },
      {
        label: "Mention as",
        value: `${formatAgentMention("agent-id")} ${pc.dim("in Space")}`,
      },
    ],
    minContentWidth: 38,
  });
  presenter.line({
    code: "agents.list.ready.spacer",
    text: "",
  });
  renderAgentsInfoCard({
    presenter,
    codePrefix: "agents.list.ready.card",
    title: `Available Agents (${readyEnabledStates.length})`,
    rows: readyEnabledStates.map((state) =>
      buildReadyAgentCardRow(state.agentId, state.displayName)
    ),
    minContentWidth: 30,
  });
  if (needsRepairEnabledStates.length > 0) {
    presenter.line({
      code: "agents.list.needs_repair.spacer",
      text: "",
    });
    renderAgentsInfoCard({
      presenter,
      codePrefix: "agents.list.needs_repair.card",
      title: `Needs Repair (${needsRepairEnabledStates.length})`,
      rows: needsRepairEnabledStates.map((state) =>
        buildStatusAgentCardRow({
          agentId: state.agentId,
          displayName: state.displayName,
          detail:
            "Connected in OpenMeld, but OpenMeld can't start it on this computer yet",
        })
      ),
      minContentWidth: 36,
    });
  }
  if (needsChoiceEnabledStates.length > 0) {
    presenter.line({
      code: "agents.list.needs_choice.spacer",
      text: "",
    });
    renderAgentsInfoCard({
      presenter,
      codePrefix: "agents.list.needs_choice.card",
      title: `Needs Your Choice (${needsChoiceEnabledStates.length})`,
      rows: needsChoiceEnabledStates.map((state) =>
        buildStatusAgentCardRow({
          agentId: state.agentId,
          displayName: state.displayName,
          detail:
            "Connected in OpenMeld, but OpenMeld still needs one install choice on this Mac",
        })
      ),
      minContentWidth: 36,
    });
  }
}

export async function runAgentsShow(input: AgentsShowInput): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const presenter = createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "show",
  });
  const agentId = normalizeAgentId(input.agentId ?? "");
  if (!agentId) {
    throw new Error(
      "agents.invalid_agent_id: provide a non-empty <agent-id> for show"
    );
  }
  const state = await resolveAgentTargetState(agentId);
  if (!hasAgentRegistration(state)) {
    throw new Error(
      `agents.not_registered: agent is not registered: ${agentId}`
    );
  }
  const registration = state.registration;
  let agentControllerInterface: AgentControllerInterfaceSnapshot | null = null;
  if (state.targetKind === "builtin" && state.enabled) {
    const builtinState = state as RegisteredAgentTargetState & {
      targetKind: "builtin";
    };
    agentControllerInterface = await resolveAgentControllerInterfaceSnapshot({
      agentControllerRef: buildAgentControllerRef({
        id: builtinState.agentId,
        kind: "builtin",
      }),
      state: builtinState,
    });
  }

  const payload = {
    agent: buildAgentRegistrationAgentView(state),
    agentControllerInterface:
      input.json === true || runtime.resolvedView === "agent"
        ? projectLegacyAgentControllerInterface(agentControllerInterface)
        : agentControllerInterface,
    installChoices: state.installChoices,
    launchStatus: formatAgentViewLaunchStatus(state.launchStatus),
    launchStatusDetail: state.launchStatusDetail,
    effectiveConfig: buildEffectiveConfig(state),
  };
  if (input.json === true) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "agents.show",
      ...payload,
    });
    return;
  }
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.show.result",
      payload,
    });
    return;
  }

  renderAgentsInfoCard({
    presenter,
    codePrefix: "agents.show.card",
    title: "Agent in OpenMeld",
    rows: [
      {
        label: "Agent",
        value: formatAgentMention(registration.agentId),
      },
      {
        label: "App",
        value: registration.displayName,
      },
      {
        label: "Status",
        value: buildAgentsShowStatusValue({
          enabled: registration.enabled,
          launchStatus: state.launchStatus,
        }),
      },
      {
        label: "Wake",
        value: buildAgentsShowWakeValue({
          agentId: registration.agentId,
          enabled: registration.enabled,
          launchStatus: state.launchStatus,
        }),
      },
      {
        label: "Connection Type",
        value: `${resolveTransportModeForDisplay(state)} ${pc.dim("on this computer")}`,
      },
      ...buildAgentControllerInterfaceRows(agentControllerInterface),
      ...(state.launchStatusDetail
        ? [
            {
              label: "Why",
              value: state.launchStatusDetail,
            },
          ]
        : []),
      ...(state.launchStatus === "needs_choice"
        ? [
            {
              label: "Next",
              value: formatInlineOpenMeldCliCommands(
                `Run \`openmeld agents repair --agent ${registration.agentId}\` and choose one install`
              ),
            },
          ]
        : []),
      ...(state.launchStatus === "needs_repair"
        ? [
            {
              label: "Next",
              value: formatInlineOpenMeldCliCommands(
                `Run \`openmeld agents repair --agent ${registration.agentId}\``
              ),
            },
          ]
        : []),
    ],
    minContentWidth: 34,
  });
}

function projectLegacyAgentControllerInterface(
  snapshot: AgentControllerInterfaceSnapshot | null
): AgentControllerInterfaceSnapshot | null {
  if (!snapshot?.usageLimits) {
    return snapshot;
  }
  const { usageLimits: _usageLimits, ...legacySnapshot } = snapshot;
  return legacySnapshot;
}

function createSilentAgentsPresenter(
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>
): ReturnType<typeof createPresenter> {
  return {
    view: runtime.resolvedView,
    event: () => undefined,
    line: () => undefined,
    data: () => undefined,
  };
}

export async function runAgentsEnable(
  input: AgentsEnableInput
): Promise<AgentsEnableResult> {
  const runtime = await resolveRuntimeContext({
    interactive: input.interactive,
    view: input.view,
    profile: input.profile,
  });
  const presenter =
    input.json === true
      ? createSilentAgentsPresenter(runtime)
      : createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "enable",
    handled: input.presentation === "handoff",
  });
  const explicitIds = normalizeAgentIds(input.agent ?? []);
  const explicitInstallId = normalizeOptionalString(input.install);
  validateBuiltinAgentSelectionInput({
    all: input.all,
    command: "enable",
    explicitIds,
    explicitInstallId,
  });

  const targetStates = await listAgentTargetStates();
  const targetStateById = new Map(
    targetStates.map((state) => [state.agentId, state])
  );
  const selectableBuiltinIds = new Set(
    targetStates
      .filter(canSelectAgentForNewLocalAgentSetup)
      .map((state) => state.agentId)
  );
  const requested = input.all
    ? [...selectableBuiltinIds].sort((left, right) => left.localeCompare(right))
    : explicitIds;
  const summary: EnableSummary = {
    requested,
    registered: [],
    reenabled: [],
    skipped: [],
    errors: [],
    allMode: Boolean(input.all),
  };

  const launchSelections = await collectEnableLaunchActionSelections({
    explicitInstallId,
    interactiveChoiceAllowed:
      input.json === true
        ? false
        : resolveInteractiveChoiceAllowed({
            all: input.all,
            runtime,
          }),
    requested,
    summary,
    targetStateById,
  });
  if (launchSelections.status === "cancelled") {
    cancel("Cancelled.");
    return {
      status: "cancelled",
      summary,
    };
  }
  if (launchSelections.status === "back") {
    return {
      status: "back",
      summary,
    };
  }

  await updateAgentRegistrations((current) =>
    applyEnableSelectionUpdates({
      current,
      requested: requested.filter(
        (agentId) => !launchSelections.blockedAgentIds.has(agentId)
      ),
      selectedLaunchContracts: launchSelections.selectedLaunchContracts,
      selectableBuiltinIds,
      summary,
      targetStateById,
    })
  );
  if (input.json === true) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "agents.enable",
      ...summary,
    });
    return {
      status: "completed",
      summary,
    };
  }

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.enable.result",
      payload: summary,
    });
    return {
      status: "completed",
      summary,
    };
  }

  if (input.presentation !== "handoff") {
    emitEnableSummaryCardsForHuman({
      presenter,
      summary,
      targetStateById,
    });
  }
  return {
    status: "completed",
    summary,
  };
}

export async function runAgentsRegister(
  input: AgentsEnableInput
): Promise<AgentsEnableResult> {
  return await runAgentsEnable(input);
}

export async function runAgentsRepair(
  input: AgentsRepairInput
): Promise<AgentsRepairResult> {
  const runtime = await resolveRuntimeContext({
    interactive: input.interactive,
    view: input.view,
    profile: input.profile,
  });
  const presenter = createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "repair",
    handled: input.presentation === "handoff",
  });

  const explicitIds = normalizeAgentIds(input.agent ?? []);
  const explicitInstallId = normalizeOptionalString(input.install);
  validateBuiltinAgentSelectionInput({
    all: input.all,
    command: "repair",
    explicitIds,
    explicitInstallId,
  });

  const targetStates = await listAgentTargetStates();
  const targetStateById = new Map(
    targetStates.map((state) => [state.agentId, state])
  );
  const requested = input.all
    ? targetStates
        .filter(
          (state) =>
            state.targetKind === "builtin" &&
            state.registered &&
            (state.launchStatus === "needs_choice" ||
              state.launchStatus === "needs_repair")
        )
        .map((state) => state.agentId)
    : explicitIds;
  const summary: RepairSummary = {
    requested,
    repaired: [],
    skipped: [],
    errors: [],
    allMode: Boolean(input.all),
  };

  const repairedLaunchContracts = new Map<
    string,
    EnableChoiceCandidate["launchContract"]
  >();
  const repairOutcome = await collectRepairLaunchActions({
    allowReadyForInstallChange: input.changeInstall === true,
    explicitInstallId,
    interactiveChoiceAllowed: resolveInteractiveChoiceAllowed({
      all: input.all,
      runtime,
    }),
    repairedLaunchContracts,
    requested,
    summary,
    targetStateById,
  });
  if (repairOutcome === "cancelled") {
    cancel("Cancelled.");
    return {
      status: "cancelled",
      summary,
    };
  }
  if (repairOutcome === "back") {
    return {
      status: "back",
      summary,
    };
  }

  if (repairedLaunchContracts.size > 0) {
    await updateAgentRegistrations((current) => {
      const nowIso = new Date().toISOString();
      return sortAgentRegistrations(
        current.map((registration) => {
          const launchContract = repairedLaunchContracts.get(
            registration.agentId
          );
          if (!launchContract) {
            return registration;
          }
          return {
            ...registration,
            launchContract,
            updatedAt: nowIso,
          };
        })
      );
    });
  }
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.repair.result",
      payload: summary,
    });
    return {
      status: "completed",
      summary,
    };
  }

  if (input.presentation !== "handoff") {
    renderAgentsInfoCard({
      presenter,
      codePrefix: "agents.repair.summary.card",
      title: "Agents Repaired",
      rows: buildRepairSummaryRows(summary),
      minContentWidth: 38,
    });
    for (const card of buildRepairDetailCards(summary, targetStateById)) {
      presenter.line({
        code: `agents.repair.${card.codeSuffix}.spacer`,
        text: "",
      });
      renderAgentsInfoCard({
        presenter,
        codePrefix: `agents.repair.${card.codeSuffix}.card`,
        title: card.title,
        rows: card.rows,
        minContentWidth: 32,
      });
    }
  }
  return {
    status: "completed",
    summary,
  };
}

function buildAgentsShowStatusValue(input: {
  enabled: boolean;
  launchStatus: EnableChoiceCandidate["launchStatus"];
}): string {
  if (input.launchStatus === "needs_choice") {
    return formatAgentsToneText("warning", "Needs your choice on this Mac");
  }
  if (input.launchStatus === "needs_repair") {
    return formatAgentsToneText("warning", "Needs repair on this computer");
  }
  if (input.enabled) {
    return formatAgentsToneText("success", "Available in Space");
  }
  return formatAgentsToneText("warning", "Turned off in Space");
}

function buildAgentsShowWakeValue(input: {
  agentId: string;
  enabled: boolean;
  launchStatus: EnableChoiceCandidate["launchStatus"];
}): string {
  const mention = formatAgentMention(input.agentId);
  if (input.launchStatus === "needs_choice") {
    return `New ${mention} mentions will not wake it until you choose one install on this Mac`;
  }
  if (input.launchStatus === "needs_repair") {
    return `New ${mention} mentions will not wake it until you repair it`;
  }
  if (input.enabled) {
    return `${mention} can wake it`;
  }
  return `New ${mention} mentions stay off`;
}

function buildAgentControllerInterfaceRows(
  snapshot: AgentControllerInterfaceSnapshot | null
): Array<{ label: string; value: string }> {
  if (!snapshot) {
    return [];
  }
  return createAgentControllerInterfaceDisplayRows(snapshot);
}

async function promptBuiltinAgentInstallChoice(input: {
  displayName: string;
  installChoices: AgentTargetState["installChoices"];
}): Promise<PromptChoiceResult<string>> {
  const choice = await select({
    message: buildInteractiveMenuMessage({
      title: `Choose the ${input.displayName} install OpenMeld should use`,
      description: `We found more than one ${input.displayName} install on this Mac. Pick the one OpenMeld should launch for replies.`,
    }),
    options: [
      ...input.installChoices.map((installChoice) => ({
        value: installChoice.installId,
        label: installChoice.label,
        hint: installChoice.detail,
      })),
      {
        value: "__back__",
        label: "Back",
      },
    ],
  });
  if (isCancel(choice)) {
    return {
      status: "cancelled",
    };
  }
  if (choice === "__back__") {
    return {
      status: "back",
    };
  }
  return {
    status: "selected",
    value: String(choice),
  };
}

function buildInstallChoiceNextSteps(input: {
  agentId: string;
  command: "enable" | "repair";
  installChoices: AgentTargetState["installChoices"];
}): string[] {
  return input.installChoices.map((installChoice) =>
    buildBuiltinAgentSelectionCommand({
      agentIds: [input.agentId],
      command: input.command,
      installId: installChoice.installId,
    })
  );
}

function createInstallChoiceError(input: {
  agentId: string;
  command: "enable" | "repair";
  installChoices: AgentTargetState["installChoices"];
  reason: string;
  summary?: string;
}): EnableSummary["errors"][number] {
  return {
    agentId: input.agentId,
    code: "controller.launch.choice_required",
    humanActionRequired: true,
    installChoices: input.installChoices,
    nextSteps: buildInstallChoiceNextSteps({
      agentId: input.agentId,
      command: input.command,
      installChoices: input.installChoices,
    }),
    reason: input.reason,
    summary:
      input.summary ??
      "OpenMeld needs one install choice on this Mac before it can continue.",
  };
}

type BuiltinLaunchActionResolution =
  | {
      launchContract: NonNullable<EnableChoiceCandidate["launchContract"]>;
      status: "resolved";
    }
  | {
      error: EnableSummary["errors"][number];
      status: "blocked";
    }
  | {
      status: "cancelled";
    }
  | {
      status: "not_needed";
    }
  | {
      status: "back";
    };

async function resolveBuiltinLaunchAction(input: {
  command: "enable" | "repair";
  explicitInstallId: string | null;
  interactiveChoiceAllowed: boolean;
  state: EnableChoiceCandidate & { targetKind: "builtin" };
}): Promise<BuiltinLaunchActionResolution> {
  const shouldResolveLaunchContract =
    input.command === "repair" ||
    Boolean(input.explicitInstallId) ||
    input.state.launchStatus === "needs_choice" ||
    input.state.launchStatus === "needs_repair";
  if (!shouldResolveLaunchContract) {
    return {
      status: "not_needed",
    };
  }

  let repairResult = await repairBuiltinControllerInstall({
    agentId: input.state.agentId,
    detected: input.state.detected,
    displayName: input.state.displayName,
    installId: input.explicitInstallId,
    runtimeSupported: input.state.runtimeSupported,
  });
  if (
    !repairResult.ok &&
    repairResult.errorCode === "controller.launch.choice_required" &&
    input.interactiveChoiceAllowed
  ) {
    const installChoice = await promptBuiltinAgentInstallChoice({
      displayName: input.state.displayName,
      installChoices: repairResult.installChoices,
    });
    if (installChoice.status === "cancelled") {
      return {
        status: "cancelled",
      };
    }
    if (installChoice.status === "back" || installChoice.status === "empty") {
      return {
        status: "back",
      };
    }
    repairResult = await repairBuiltinControllerInstall({
      agentId: input.state.agentId,
      detected: input.state.detected,
      displayName: input.state.displayName,
      installId: installChoice.value,
      runtimeSupported: input.state.runtimeSupported,
    });
  }
  if (!repairResult.ok) {
    return {
      error:
        repairResult.errorCode === "controller.launch.choice_required"
          ? createInstallChoiceError({
              agentId: input.state.agentId,
              command: input.command,
              installChoices: repairResult.installChoices,
              reason: repairResult.errorMessage,
            })
          : {
              agentId: input.state.agentId,
              code: repairResult.errorCode,
              reason: repairResult.errorMessage,
            },
      status: "blocked",
    };
  }
  return {
    launchContract: repairResult.launchContract,
    status: "resolved",
  };
}

function resolveInteractiveChoiceAllowed(input: {
  all?: boolean;
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
}): boolean {
  return (
    input.runtime.resolvedView === "human" &&
    canUseInteractivePrompts(input.runtime) &&
    input.all !== true
  );
}

async function collectEnableLaunchActionSelections(input: {
  explicitInstallId: string | null;
  interactiveChoiceAllowed: boolean;
  requested: string[];
  summary: EnableSummary;
  targetStateById: Map<string, EnableChoiceCandidate>;
}): Promise<
  | {
      blockedAgentIds: Set<string>;
      selectedLaunchContracts: Map<
        string,
        EnableChoiceCandidate["launchContract"]
      >;
      status: "completed";
    }
  | {
      status: "cancelled";
    }
  | {
      status: "back";
    }
> {
  const blockedAgentIds = new Set<string>();
  const selectedLaunchContracts = new Map<
    string,
    EnableChoiceCandidate["launchContract"]
  >();

  for (const requestedId of input.requested) {
    const state = input.targetStateById.get(requestedId) ?? null;
    if (!isBuiltinEnableChoiceCandidate(state)) {
      continue;
    }
    const launchAction = await resolveBuiltinLaunchAction({
      command: "enable",
      explicitInstallId: input.explicitInstallId,
      interactiveChoiceAllowed: input.interactiveChoiceAllowed,
      state,
    });
    if (launchAction.status === "not_needed") {
      continue;
    }
    if (launchAction.status === "cancelled" || launchAction.status === "back") {
      return {
        status: launchAction.status,
      };
    }
    if (launchAction.status === "blocked") {
      blockedAgentIds.add(state.agentId);
      input.summary.errors.push(launchAction.error);
      continue;
    }
    selectedLaunchContracts.set(state.agentId, launchAction.launchContract);
  }

  return {
    blockedAgentIds,
    selectedLaunchContracts,
    status: "completed",
  };
}

async function collectRepairLaunchActions(input: {
  allowReadyForInstallChange: boolean;
  explicitInstallId: string | null;
  interactiveChoiceAllowed: boolean;
  repairedLaunchContracts: Map<string, EnableChoiceCandidate["launchContract"]>;
  requested: string[];
  summary: RepairSummary;
  targetStateById: Map<string, EnableChoiceCandidate>;
}): Promise<"back" | "cancelled" | "completed"> {
  for (const requestedId of input.requested) {
    const candidate = resolveRepairCandidate({
      allowReadyForInstallChange: input.allowReadyForInstallChange,
      requestedId,
      targetStateById: input.targetStateById,
    });
    if (!candidate.ok) {
      input.summary.errors.push(candidate.error);
      continue;
    }
    if (
      !(input.allowReadyForInstallChange || input.explicitInstallId) &&
      candidate.state.launchStatus === "ready" &&
      candidate.state.registration?.launchContract
    ) {
      input.summary.skipped.push({
        agentId: requestedId,
        reason: "already_ready",
      });
      continue;
    }

    const launchAction = await resolveBuiltinLaunchAction({
      command: "repair",
      explicitInstallId: input.explicitInstallId,
      interactiveChoiceAllowed: input.interactiveChoiceAllowed,
      state: candidate.state,
    });
    if (launchAction.status === "cancelled" || launchAction.status === "back") {
      return launchAction.status;
    }
    if (launchAction.status === "blocked") {
      input.summary.errors.push(launchAction.error);
      continue;
    }
    if (launchAction.status === "not_needed") {
      continue;
    }
    input.repairedLaunchContracts.set(requestedId, launchAction.launchContract);
    input.summary.repaired.push(requestedId);
  }

  return "completed";
}

function applyEnableSelectionUpdates(input: {
  current: RuntimeAgentControllerState[];
  requested: string[];
  selectedLaunchContracts: Map<string, EnableChoiceCandidate["launchContract"]>;
  selectableBuiltinIds: Set<string>;
  summary: EnableSummary;
  targetStateById: Map<string, EnableChoiceCandidate>;
}): RuntimeAgentControllerState[] {
  const next = [...input.current];
  const existingById = new Map(
    next.map((registration, index) => [registration.agentId, index])
  );
  for (const requestedId of input.requested) {
    applySingleEnableSelection({
      existingById,
      next,
      requestedId,
      selectedLaunchContracts: input.selectedLaunchContracts,
      selectableBuiltinIds: input.selectableBuiltinIds,
      summary: input.summary,
      targetStateById: input.targetStateById,
    });
  }
  return sortAgentRegistrations(next);
}

function applySingleEnableSelection(input: {
  existingById: Map<string, number>;
  next: RuntimeAgentControllerState[];
  requestedId: string;
  selectedLaunchContracts: Map<string, EnableChoiceCandidate["launchContract"]>;
  selectableBuiltinIds: Set<string>;
  summary: EnableSummary;
  targetStateById: Map<string, EnableChoiceCandidate>;
}): void {
  if (!input.selectableBuiltinIds.has(input.requestedId)) {
    const blockedState = input.targetStateById.get(input.requestedId) ?? null;
    input.summary.errors.push({
      agentId: input.requestedId,
      code: "agents.invalid_agent_id",
      reason: resolveEnableBlockedReason(blockedState),
    });
    return;
  }

  const targetState = input.targetStateById.get(input.requestedId);
  if (targetState?.targetKind !== "builtin") {
    input.summary.errors.push({
      agentId: input.requestedId,
      code: "agents.config_write_failed",
      reason: "selectable built-in target missing from catalog",
    });
    return;
  }

  const selectedLaunchContract =
    input.selectedLaunchContracts.get(targetState.agentId) ?? null;
  const resolvedLaunchContract =
    selectedLaunchContract ?? targetState.launchContract ?? undefined;
  if (targetState.launchStatus === "needs_choice" && !selectedLaunchContract) {
    input.summary.errors.push(
      createInstallChoiceError({
        agentId: targetState.agentId,
        command: "enable",
        installChoices: targetState.installChoices,
        reason:
          targetState.launchStatusDetail ??
          "OpenMeld needs one install choice on this Mac before it can turn this on.",
      })
    );
    return;
  }

  const existingIndex = input.existingById.get(targetState.agentId);
  if (existingIndex === undefined) {
    input.next.push(
      createRegistrationFromCatalogTarget({
        ...targetState,
        ...(resolvedLaunchContract
          ? { launchContract: resolvedLaunchContract }
          : {}),
      })
    );
    input.existingById.set(targetState.agentId, input.next.length - 1);
    input.summary.registered.push(targetState.agentId);
    return;
  }

  const existing = input.next[existingIndex];
  if (!existing) {
    input.summary.errors.push({
      agentId: targetState.agentId,
      code: "agents.config_write_failed",
      reason: "registration index missing",
    });
    return;
  }

  if (existing.enabled && selectedLaunchContract) {
    input.next[existingIndex] = applyTargetRuntimeDefaults({
      registration: {
        ...existing,
        launchContract: selectedLaunchContract,
        updatedAt: new Date().toISOString(),
      },
      targetState,
    });
    input.summary.reenabled.push(targetState.agentId);
    return;
  }

  if (existing.enabled) {
    input.summary.skipped.push({
      agentId: targetState.agentId,
      reason: "already_enabled",
    });
    return;
  }

  input.next[existingIndex] = applyTargetRuntimeDefaults({
    registration: {
      ...existing,
      enabled: true,
      ...(resolvedLaunchContract
        ? { launchContract: resolvedLaunchContract }
        : {}),
      updatedAt: new Date().toISOString(),
    },
    targetState,
  });
  input.summary.reenabled.push(targetState.agentId);
}

function applyTargetRuntimeDefaults(input: {
  registration: RuntimeAgentControllerState;
  targetState: EnableChoiceCandidate;
}): RuntimeAgentControllerState {
  return {
    ...input.registration,
    ...(input.targetState.defaultStreamingMode
      ? { streamingMode: input.targetState.defaultStreamingMode }
      : {}),
    ...(input.targetState.defaultTransportMode
      ? { transportMode: input.targetState.defaultTransportMode }
      : {}),
  };
}

function resolveRepairCandidate(input: {
  allowReadyForInstallChange?: boolean;
  requestedId: string;
  targetStateById: Map<string, EnableChoiceCandidate>;
}):
  | {
      ok: true;
      state: BuiltinEnableChoiceCandidate;
    }
  | {
      error: RepairSummary["errors"][number];
      ok: false;
    } {
  const state = input.targetStateById.get(input.requestedId) ?? null;
  if (!isBuiltinEnableChoiceCandidate(state)) {
    if (!state) {
      return {
        error: {
          agentId: input.requestedId,
          code: "agents.invalid_agent_id",
          reason: "unknown built-in target id",
        },
        ok: false,
      };
    }
    return {
      error: {
        agentId: input.requestedId,
        code: "agents.invalid_agent_id",
        reason: "custom target is not runnable yet",
      },
      ok: false,
    };
  }
  if (!state.registered) {
    return {
      error: {
        agentId: input.requestedId,
        code: "agents.not_registered",
        reason: "agent is not registered",
      },
      ok: false,
    };
  }
  if (
    input.allowReadyForInstallChange !== true &&
    !(
      state.launchStatus === "needs_choice" ||
      state.launchStatus === "needs_repair"
    )
  ) {
    return {
      error: {
        agentId: input.requestedId,
        code: "controller.launch.needs_repair",
        reason: "already available",
      },
      ok: false,
    };
  }
  return {
    ok: true,
    state,
  };
}

export async function runAgentsDisable(
  input: AgentsDisableInput
): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const presenter =
    input.json === true
      ? createSilentAgentsPresenter(runtime)
      : createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "disable",
  });
  const explicitIds = normalizeAgentIds(input.agent ?? []);
  validateBuiltinAgentSelectionInput({
    all: input.all,
    command: "disable",
    explicitIds,
    explicitInstallId: null,
  });

  const registrations = await listAgentRegistrations();
  const displayNameById = new Map(
    registrations.map((registration) => [
      registration.agentId,
      registration.displayName,
    ])
  );
  const requested = input.all
    ? registrations.map((registration) => registration.agentId)
    : explicitIds;
  const summary: DisableSummary = {
    requested,
    disabled: [],
    skipped: [],
    errors: [],
    allMode: Boolean(input.all),
  };

  await updateAgentRegistrations((current) => {
    const next = [...current];
    const byId = new Map(
      next.map((registration, index) => [registration.agentId, index])
    );
    for (const agentId of requested) {
      const index = byId.get(agentId);
      if (index === undefined) {
        summary.errors.push({
          agentId,
          code: "agents.not_registered",
          reason: "agent is not registered",
        });
        continue;
      }
      const registration = next[index];
      if (!registration) {
        summary.errors.push({
          agentId,
          code: "agents.config_write_failed",
          reason: "registration index missing",
        });
        continue;
      }
      if (!registration.enabled) {
        summary.skipped.push({
          agentId,
          reason: "already_disabled",
        });
        continue;
      }
      next[index] = {
        ...registration,
        enabled: false,
        updatedAt: new Date().toISOString(),
      };
      summary.disabled.push(agentId);
    }
    return sortAgentRegistrations(next);
  });
  if (input.json === true) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "agents.disable",
      ...summary,
    });
    return;
  }

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.disable.result",
      payload: summary,
    });
    return;
  }

  emitDisableSummaryCardsForHuman({
    presenter,
    summary,
    displayNameById,
  });
}

export async function runAgentsUnregister(
  input: AgentsUnregisterInput
): Promise<void> {
  const agentId = normalizeAgentId(input.agentId ?? "");
  if (!agentId) {
    throw new Error(
      "agents.invalid_agent_id: provide a non-empty <agent-id> for unregister"
    );
  }
  await runAgentsDisable({
    agent: [agentId],
    profile: input.profile,
    view: input.view,
  });
}

export async function runAgentsConfig(input: AgentsConfigInput): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const presenter = createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "config",
  });
  const agentId = normalizeAgentId(input.agentId ?? "");
  if (!agentId) {
    throw new Error(
      "agents.invalid_agent_id: provide a non-empty <agent-id> for config"
    );
  }

  const enabled = parseAgentEnabledOption(input.enabled);
  if (enabled === undefined) {
    throw new Error(
      "agents.config_invalid: provide at least one option (--enabled)"
    );
  }

  const updatedFields: string[] = [];
  const nextRegistrations = await updateAgentRegistrations((current) => {
    const index = current.findIndex((item) => item.agentId === agentId);
    if (index < 0) {
      throw new Error(
        `agents.not_registered: agent is not registered: ${agentId}`
      );
    }
    const next = [...current];
    const selected = next[index];
    if (!selected) {
      throw new Error("agents.config_write_failed: registration index missing");
    }
    const existing = { ...selected };
    if (enabled !== undefined) {
      existing.enabled = enabled;
      updatedFields.push("enabled");
    }
    existing.updatedAt = new Date().toISOString();
    next[index] = existing;
    return sortAgentRegistrations(next);
  });
  const effectiveConfig =
    nextRegistrations.find((item) => item.agentId === agentId) ?? null;

  if (!effectiveConfig) {
    throw new Error("agents.config_write_failed: config update returned empty");
  }
  const payload = {
    agentId,
    updatedFields,
    effectiveConfig,
  };
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.config.result",
      payload,
    });
    return;
  }

  renderAgentsInfoCard({
    presenter,
    codePrefix: "agents.config.result.card",
    title: "Agent Updated",
    rows: [
      {
        label: "Agent",
        value: formatAgentMention(effectiveConfig.agentId),
      },
      {
        label: "App",
        value: effectiveConfig.displayName,
      },
      {
        label: "Status",
        value: enabled
          ? formatAgentsToneText("success", "Available for new @mentions")
          : formatAgentsToneText("warning", "Turned off for new @mentions"),
      },
      {
        label: "Wake",
        value: enabled
          ? `New ${formatAgentMention(effectiveConfig.agentId)} mentions can wake it`
          : `New ${formatAgentMention(effectiveConfig.agentId)} mentions stay off`,
      },
    ],
    minContentWidth: 34,
  });
}

export async function runAgentsCustomList(
  input: AgentsBaseInput
): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const presenter = createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "custom_list",
  });
  const [targets, states] = await Promise.all([
    listAgentCustomTargets(),
    listAgentTargetStates(),
  ]);
  const customStateById = new Map(
    states
      .filter((state) => state.targetKind === "custom")
      .map((state) => [state.agentId, state])
  );
  const payloadTargets = targets.map((target) => {
    const state = customStateById.get(target.id);
    return {
      id: target.id,
      name: target.name,
      dir: target.dir,
      registered: state?.registered ?? false,
      enabled: state?.enabled ?? false,
    };
  });
  const payload = {
    targets: payloadTargets,
    count: payloadTargets.length,
  };

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.custom.list.result",
      payload,
    });
    return;
  }

  emitHumanSectionHeader(presenter, {
    codePrefix: "agents.custom.list",
    title: "Custom agents",
  });
  if (payloadTargets.length === 0) {
    presenter.line({
      code: "agents.custom.list.empty",
      text: "No custom agents configured.",
    });
    presenter.line({
      code: "agents.custom.list.hint",
      text: formatInlineOpenMeldCliCommands(
        "Tip: run `openmeld agents custom add --name <name> --dir <dir>`."
      ),
    });
    return;
  }
  presenter.line({
    code: "agents.custom.list.subtitle",
    text: `Configured custom agents: ${payloadTargets.length}`,
  });
  for (const target of payloadTargets) {
    presenter.line({
      code: "agents.custom.list.item",
      text: `- ${target.name} (${target.id}) • dir=${target.dir} • registered=${target.registered ? "true" : "false"} • enabled=${target.enabled ? "true" : "false"}`,
    });
  }
}

export async function runAgentsCustomAdd(
  input: AgentsCustomAddInput
): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const presenter = createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "custom_add",
  });
  const name = normalizeOptionalString(input.name);
  const dir = normalizeOptionalString(input.dir);
  if (!(name && dir)) {
    throw new Error(
      "agents.custom.invalid_argument: provide --name <name> and --dir <dir>"
    );
  }
  if (!isAbsolute(dir)) {
    throw new Error(
      "agents.custom.invalid_argument: --dir must be an absolute path"
    );
  }
  const id = normalizeOptionalString(input.id) ?? undefined;
  const target = await addAgentCustomTarget({
    name,
    dir,
    ...(id ? { id } : {}),
  });
  const payload = {
    target,
  };

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.custom.add.result",
      payload,
    });
    return;
  }

  emitHumanSectionHeader(presenter, {
    codePrefix: "agents.custom.add",
    title: "Custom Agent Added",
  });
  presenter.line({
    code: "agents.custom.add.result",
    text: `${target.name} (${target.id}) -> ${target.dir}`,
  });
}

export async function runAgentsCustomUpdate(
  input: AgentsCustomUpdateInput
): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const presenter = createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "custom_update",
  });
  const id = normalizeAgentId(input.id ?? "");
  if (!id) {
    throw new Error("agents.custom.invalid_argument: provide --id <id>");
  }

  const name = normalizeOptionalString(input.name) ?? undefined;
  const dir = normalizeOptionalString(input.dir) ?? undefined;
  if (name === undefined && dir === undefined) {
    throw new Error(
      "agents.custom.invalid_argument: provide at least one option (--name/--dir)"
    );
  }
  if (dir && !isAbsolute(dir)) {
    throw new Error(
      "agents.custom.invalid_argument: --dir must be an absolute path"
    );
  }
  const updated = await updateAgentCustomTarget({
    id,
    ...(name ? { name } : {}),
    ...(dir ? { dir } : {}),
  });
  const payload = {
    target: updated.target,
    updatedFields: updated.updatedFields,
  };

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.custom.update.result",
      payload,
    });
    return;
  }

  emitHumanSectionHeader(presenter, {
    codePrefix: "agents.custom.update",
    title: "Custom Agent Updated",
  });
  const fields =
    updated.updatedFields.length > 0
      ? updated.updatedFields.join(", ")
      : "no field changed";
  presenter.line({
    code: "agents.custom.update.result",
    text: `${updated.target.id}: ${fields}`,
  });
}

export async function runAgentsCustomRemove(
  input: AgentsCustomRemoveInput
): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const presenter = createPresenter(runtime);
  await emitAgentsConfigParseFallbackSignal({
    presenter,
    view: runtime.resolvedView,
  });
  emitAgentsOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "custom_remove",
  });
  const id = normalizeAgentId(input.id ?? "");
  if (!id) {
    throw new Error("agents.custom.invalid_argument: provide --id <id>");
  }

  const registrations = await listAgentRegistrations();
  const inUse = registrations.some(
    (registration) => registration.agentId === id
  );
  if (inUse) {
    throw new Error(
      `agents.custom.in_use: target is currently registered: ${id}`
    );
  }

  const removed = await removeAgentCustomTarget({
    id,
  });
  const payload = {
    targetId: id,
    removed,
    installsPolicy: "kept",
  };

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "agents.custom.remove.result",
      payload,
    });
    return;
  }

  emitHumanSectionHeader(presenter, {
    codePrefix: "agents.custom.remove",
    title: "Custom Agent Removed",
  });
  presenter.line({
    code: "agents.custom.remove.result",
    text: `${removed.name} (${removed.id}) removed`,
  });
  presenter.line({
    code: "agents.custom.remove.note",
    text: formatInlineOpenMeldCliCommands(
      "Installs records are kept; cleanup via `openmeld skills uninstall`."
    ),
  });
}

function buildAgentRegistrationAgentView(
  state: RegisteredAgentTargetState
): RuntimeAgentControllerState & {
  configuredTransportMode: RuntimeAgentTransportMode | null;
  configuredTransportModeStatus: AgentTransportModeStatus;
  defaultTransportMode: RuntimeAgentTransportMode | null;
  effectiveConfig: ReturnType<typeof buildEffectiveConfig>;
  effectiveTransportMode: RuntimeAgentTransportMode;
  lifecycleStatus: AgentTargetState["lifecycleStatus"];
  supportedTransportModes: RuntimeAgentTransportMode[];
  transportModeSource: AgentTransportModeSource;
} {
  const transportProjection = resolveTransportModeProjection(state);
  return {
    ...state.registration,
    lifecycleStatus: state.lifecycleStatus,
    configuredTransportMode: transportProjection.configuredTransportMode,
    configuredTransportModeStatus:
      transportProjection.configuredTransportModeStatus,
    defaultTransportMode: transportProjection.defaultTransportMode,
    effectiveConfig: buildEffectiveConfig(state),
    effectiveTransportMode: transportProjection.effectiveTransportMode,
    supportedTransportModes: transportProjection.supportedTransportModes,
    transportModeSource: transportProjection.transportModeSource,
  };
}

function buildEffectiveConfig(state: RegisteredAgentTargetState): {
  configuredTransportMode: RuntimeAgentTransportMode | null;
  configuredTransportModeStatus: AgentTransportModeStatus;
  defaultTransportMode: RuntimeAgentTransportMode | null;
  enabled: boolean;
  effectiveTransportMode: RuntimeAgentTransportMode;
  supportedTransportModes: RuntimeAgentTransportMode[];
  transportMode: RuntimeAgentTransportMode;
  transportModeSource: AgentTransportModeSource;
} {
  const transportProjection = resolveTransportModeProjection(state);
  return {
    configuredTransportMode: transportProjection.configuredTransportMode,
    configuredTransportModeStatus:
      transportProjection.configuredTransportModeStatus,
    defaultTransportMode: transportProjection.defaultTransportMode,
    enabled: state.registration.enabled,
    effectiveTransportMode: transportProjection.effectiveTransportMode,
    supportedTransportModes: transportProjection.supportedTransportModes,
    transportMode: transportProjection.effectiveTransportMode,
    transportModeSource: transportProjection.transportModeSource,
  };
}

function emitAgentsOverviewIfAgent(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  command:
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
  handled?: boolean;
}): void {
  if (input.resolvedView !== "agent" || input.handled) {
    return;
  }
  emitAgentsAgentOverview({
    presenter: input.presenter,
    command: input.command,
  });
}

function resolveTransportModeForDisplay(
  state: RegisteredAgentTargetState
): string {
  return formatTransportModeDisplay(
    resolveTransportModeProjection(state).effectiveTransportMode
  );
}

function resolveTransportModeProjection(state: RegisteredAgentTargetState): {
  configuredTransportMode: RuntimeAgentTransportMode | null;
  configuredTransportModeStatus: AgentTransportModeStatus;
  defaultTransportMode: RuntimeAgentTransportMode | null;
  effectiveTransportMode: RuntimeAgentTransportMode;
  supportedTransportModes: RuntimeAgentTransportMode[];
  transportModeSource: AgentTransportModeSource;
} {
  const supportedTransportModes = state.transportModes.map(
    (transportMode) => transportMode.mode
  );
  const configuredTransportMode = state.registration.transportMode ?? null;
  let configuredTransportModeStatus: AgentTransportModeStatus;
  if (configuredTransportMode === null) {
    configuredTransportModeStatus = "missing";
  } else if (
    supportedTransportModes.length === 0 ||
    supportedTransportModes.includes(configuredTransportMode)
  ) {
    configuredTransportModeStatus = "supported";
  } else {
    configuredTransportModeStatus = "unsupported";
  }
  if (
    configuredTransportModeStatus === "supported" &&
    configuredTransportMode
  ) {
    return {
      configuredTransportMode,
      configuredTransportModeStatus,
      defaultTransportMode: state.defaultTransportMode ?? null,
      effectiveTransportMode: configuredTransportMode,
      supportedTransportModes,
      transportModeSource: "registration",
    };
  }
  const registryTransportMode =
    state.defaultTransportMode ?? supportedTransportModes[0] ?? null;
  if (registryTransportMode) {
    return {
      configuredTransportMode,
      configuredTransportModeStatus,
      defaultTransportMode: state.defaultTransportMode ?? null,
      effectiveTransportMode: registryTransportMode,
      supportedTransportModes,
      transportModeSource: "registry_default",
    };
  }
  return {
    configuredTransportMode,
    configuredTransportModeStatus,
    defaultTransportMode: null,
    effectiveTransportMode: DEFAULT_RUNTIME_AGENT_TRANSPORT_MODE,
    supportedTransportModes,
    transportModeSource: "global_default",
  };
}

async function emitAgentsConfigParseFallbackSignal(input: {
  presenter: ReturnType<typeof createPresenter>;
  view: "human" | "agent";
}): Promise<void> {
  const health = await readAgentRuntimeConfigHealth();
  if (!health.parseFallback) {
    return;
  }
  const reason = health.reason ?? "unknown";
  const data = {
    reason,
    strategy: "fallback_to_empty_config",
  };
  if (input.view === "agent") {
    input.presenter.line({
      code: "agents.config_parse_fallback",
      text: `runtime config parse fallback applied (${reason})`,
      data,
    });
    return;
  }
  input.presenter.line({
    code: "agents.config_parse_fallback",
    text: `warning: runtime config parse fallback applied (${reason})`,
    data,
  });
}
