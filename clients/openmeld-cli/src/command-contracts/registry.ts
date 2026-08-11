import {
  buildBuiltinAgentSelectionExamples,
  getBuiltinAgentSelectionOptionalArguments,
  getBuiltinAgentSelectionRequiredArguments,
} from "../agents/builtin-selection-contract";
import { AUTH_LOGIN_REQUEST_PATTERN_CONTRACT } from "../auth/login-request-contract";
import { getDaemonControlTargetPatternContract } from "../command-contracts/service-control-target";
import type { CommandEntryName } from "../command-entry-checks/types";
import { getCliVersionInfo } from "../runtime/cli-version";
import { getSkillsTargetSelectionPatternContract } from "../skills/target-selection-contract";
import { SPACE_ADD_MEMBERS_AGENT_OVERVIEW_STAGES } from "../space/add-members-progress-contract";
import { getSpaceMemberSelectionPatternContract } from "../space/member-selection-contract";
import { ROOT_ENTRY_COMMANDS } from "../ui/root-entry-catalog";
import type {
  CommandContractRenderContext,
  CommandEntryContract,
} from "./types";

type CommandContractRegistryContext = CommandContractRenderContext & {
  knownAgentIds?: string[];
  skills?: Array<{
    name: string;
    relativePath: string;
  }>;
  storeDir?: string;
  summary?: string;
};

type SkillsContractContext = CommandContractRenderContext & {
  knownAgentIds?: string[];
  skills?: Array<{
    name: string;
    relativePath: string;
  }>;
  storeDir?: string;
};

function buildSpaceAddProfilesContract(input: {
  command: "add-agents" | "add-human-profiles" | "add-members";
  entryName:
    | "space.add-agents"
    | "space.add-human-profiles"
    | "space.add-members";
  humanChoiceText: string;
  summary: string;
  requiredSummary: string;
}): CommandEntryContract<CommandContractRegistryContext> {
  return {
    agentOverview: {
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [
        "space is single-select; profiles support one or many selections.",
        "already-joined profiles are skipped automatically.",
        "Space membership is separate from Agent Profile readiness.",
      ],
      pattern: getSpaceMemberSelectionPatternContract(input.command),
      stages: [...SPACE_ADD_MEMBERS_AGENT_OVERVIEW_STAGES],
      summary: input.summary,
    },
    buildHints: (context) =>
      getSpaceMemberSelectionPatternContract(input.command).buildHints?.({
        ...context,
        includeViewFlag: true,
        profileId: context.profileId ?? "<profile-id>",
      }) ?? [],
    entryName: input.entryName,
    guideScenarios: {
      required: {
        code: `space.${input.command.replaceAll("-", "_")}.arguments.required`,
        humanSteps: [
          "openmeld view human",
          `openmeld space ${input.command}`,
          input.humanChoiceText,
        ],
        notes: [
          "space is single-select; profiles support one or many selections.",
          "already-joined profiles are skipped automatically.",
          "Adding a profile to a Space does not prove Agent Profile readiness.",
        ],
        pattern: getSpaceMemberSelectionPatternContract(input.command),
        summary: (context: { summary?: string }) =>
          context.summary ?? input.requiredSummary,
      },
    },
  };
}

const COMMAND_ENTRY_CONTRACTS: Partial<
  Record<CommandEntryName, CommandEntryContract<CommandContractRegistryContext>>
> = {
  root: {
    agentOverview: {
      commands: () => ROOT_ENTRY_COMMANDS.map((item) => item.command),
      extraPayload: () => ({ cli: getCliVersionInfo() }),
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [
        "Human view renders the branded banner; agent view receives this structured root overview.",
      ],
      optionalArguments: [],
      requiredArguments: [],
      stages: [
        "Recommend the first onboarding command.",
        "List the top-level OpenMeld commands available from the root entry.",
        "Return the currently installed CLI version and release date.",
      ],
      summary:
        "Show the OpenMeld root entry menu, recommend `openmeld start`, and expose the current CLI release metadata.",
    },
    entryName: "root",
  },
  view: {
    agentOverview: {
      commands: [
        "openmeld view --view agent",
        "openmeld view agent --profile <profile-id> --view agent",
        "openmeld view auto --profile <profile-id> --view agent",
      ],
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [
        "Saving a default view requires an active OpenMeld profile or an explicit `--profile`.",
      ],
      optionalArguments: ["[mode]", "--profile <id-or-name>"],
      requiredArguments: [],
      stages: [
        "Read the current default view when no new mode is provided.",
        "Resolve the target OpenMeld profile when saving a new default view.",
        "Return the current or updated default view.",
      ],
      summary:
        "Inspect or save the default OpenMeld view mode for the current or explicit OpenMeld profile.",
    },
    entryName: "view",
  },
  "agents.disable": {
    agentOverview: {
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [],
      optionalArguments: () =>
        getBuiltinAgentSelectionOptionalArguments("disable"),
      requiredArguments: () =>
        getBuiltinAgentSelectionRequiredArguments("disable"),
      stages: [],
      summary: "",
      commands: ({ includeViewFlag = false }) =>
        buildBuiltinAgentSelectionExamples({
          command: "disable",
          includeViewFlag,
        }),
    },
    buildHints: () =>
      buildBuiltinAgentSelectionExamples({ command: "disable" }),
    entryName: "agents.disable",
  },
  "agents.enable": {
    agentOverview: {
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [],
      optionalArguments: () =>
        getBuiltinAgentSelectionOptionalArguments("enable"),
      requiredArguments: () =>
        getBuiltinAgentSelectionRequiredArguments("enable"),
      stages: [],
      summary: "",
      commands: ({ includeViewFlag = false }) =>
        buildBuiltinAgentSelectionExamples({
          command: "enable",
          includeViewFlag,
        }),
    },
    buildHints: () => buildBuiltinAgentSelectionExamples({ command: "enable" }),
    entryName: "agents.enable",
  },
  "agents.repair": {
    agentOverview: {
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [],
      optionalArguments: () =>
        getBuiltinAgentSelectionOptionalArguments("repair"),
      requiredArguments: () =>
        getBuiltinAgentSelectionRequiredArguments("repair"),
      stages: [],
      summary: "",
      commands: ({ includeViewFlag = false }) =>
        buildBuiltinAgentSelectionExamples({
          command: "repair",
          includeViewFlag,
        }),
    },
    buildHints: () => buildBuiltinAgentSelectionExamples({ command: "repair" }),
    entryName: "agents.repair",
  },
  "auth.menu": {
    agentOverview: {
      commands: [
        "openmeld auth status --view agent",
        "openmeld login --view agent --ott <token>",
        "openmeld logout --view agent",
      ],
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [
        "Agent view does not open the human interactive auth menu.",
        "Prefer explicit auth subcommands to keep automation deterministic.",
      ],
      optionalArguments: [],
      requiredArguments: [],
      stages: [
        "Inspect current local auth session state.",
        "Choose an explicit sign-in, sign-out, or status command.",
        "Read the structured auth result or follow-up guidance.",
      ],
      summary:
        "Inspect or change the local OpenMeld authentication session with explicit non-interactive auth subcommands.",
    },
    entryName: "auth.menu",
  },
  "auth.login": {
    agentOverview: {
      humanActionRequired: {
        possible: true,
        steps: [
          "If no one-time token is available, ask a human to open the OpenMeld auth page in a browser.",
          "Ask the human to generate a one-time token or approve the device sign-in request.",
          "Retry the same sign-in command with the returned token when using OTT.",
        ],
      },
      notes: [
        "One-time token sign-in is the preferred automation path in agent view.",
        "When using device flow in agent view, keep browser opening disabled and ask a human to finish approval in the browser.",
      ],
      pattern: AUTH_LOGIN_REQUEST_PATTERN_CONTRACT,
      stages: [
        "Resolve the explicit sign-in method for agent view.",
        "Request a device flow or verify a one-time token.",
        "Persist the local auth session and return success details.",
      ],
      summary:
        "Establish a local OpenMeld sign-in session with an explicit sign-in method and deterministic machine-readable guidance.",
    },
    buildHints: () =>
      AUTH_LOGIN_REQUEST_PATTERN_CONTRACT.buildHints?.({}) ?? [],
    entryName: "auth.login",
    guideScenarios: {
      required: {
        code: "auth.login.arguments.required",
        humanSteps: ["openmeld view human", "openmeld auth", "Select: Sign in"],
        pattern: AUTH_LOGIN_REQUEST_PATTERN_CONTRACT,
        summary: (context: { summary?: string }) =>
          `openmeld auth login: ${context.summary ?? ""}`,
      },
    },
  },
  "auth.logout": {
    agentOverview: {
      commands: [
        "openmeld logout --view agent",
        "openmeld auth status --view agent",
      ],
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [
        "Sign-out only affects your local OpenMeld installation.",
        "Sign-out does not delete cloud OpenMeld profiles or affect other OpenMeld installations on this device.",
      ],
      optionalArguments: [],
      requiredArguments: [],
      stages: [
        "Load the current local sign-in session.",
        "Best-effort stop OpenMeld Service for your local OpenMeld installation.",
        "Clear the saved selected-profile pointers for your local OpenMeld installation.",
        "Remove the saved local sign-in session if it exists.",
        "Return the final sign-out state.",
      ],
      summary:
        "Clear the current local OpenMeld sign-in session and clean up your local OpenMeld service and profile state on this device.",
    },
    entryName: "auth.logout",
  },
  "auth.status": {
    agentOverview: {
      commands: [
        "openmeld auth status --view agent",
        "openmeld login --view agent --ott <token>",
      ],
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: ["Status is read-only in agent view."],
      optionalArguments: [],
      requiredArguments: [],
      stages: [
        "Load the local auth session.",
        "Validate remote auth state when possible.",
        "Return machine-readable auth session details.",
      ],
      summary:
        "Inspect the current OpenMeld authentication session without changing any local auth state.",
    },
    entryName: "auth.status",
  },
  doctor: {
    agentOverview: {
      commands: [
        "openmeld doctor --view agent",
        "openmeld doctor --repair --view agent",
        "openmeld whoami --view agent",
      ],
      humanActionRequired: {
        possible: true,
        steps: [
          "If auth is missing or expired, ask a human to complete `openmeld login`.",
          "If doctor reports device or gateway issues, ask a human to inspect the failing subsystem before retrying.",
        ],
      },
      notes: [
        "Doctor emits a sequence of `doctor.check.*` records instead of one summary payload.",
        "Read every failing check before deciding whether human intervention is required.",
      ],
      optionalArguments: [
        "--profile <id-or-name>",
        "--base-url <url>",
        "--repair",
      ],
      requiredArguments: [],
      stages: [
        "Inspect sign-in and OpenMeld profile readiness.",
        "Probe gateway connectivity and gateway chain health.",
        "Check local agent setup and emit structured pass/fail lines.",
      ],
      summary:
        "Run OpenMeld diagnostics and stream structured check results for profile, gateway, connectivity, and local agent readiness.",
    },
    entryName: "doctor",
  },
  "repair.local-state": {
    agentOverview: {
      commands: [
        "openmeld repair local-state --view agent",
        "openmeld whoami --view agent",
      ],
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [
        "Repair local-state only affects your local OpenMeld installation and does not require sign-in.",
      ],
      optionalArguments: [],
      requiredArguments: [],
      stages: [
        "Inspect local OpenMeld storage versions and known legacy paths.",
        "Apply safe migrations and cleanup tasks.",
        "Return the final local-state alignment report.",
      ],
      summary:
        "Run the local OpenMeld data alignment and cleanup routine for your OpenMeld installation.",
    },
    entryName: "repair.local-state",
  },
  "service.install": {
    agentOverview: {
      commands: [
        "openmeld service install --view agent",
        "openmeld service start --view agent",
      ],
      humanActionRequired: false,
      notes: [
        "Install does not automatically start the service; use `openmeld service start --view agent` next.",
      ],
      optionalArguments: [],
      requiredArguments: [],
      stages: [
        "Prepare OpenMeld Service files for this CLI version.",
        "Persist installation metadata.",
        "Return installation state and local reply readiness.",
      ],
      summary:
        "Install OpenMeld Service runtime files for this OpenMeld installation.",
    },
    entryName: "service.install",
  },
  "service.menu": {
    agentOverview: {
      commands: [
        "openmeld service --view agent",
        "openmeld service status --view agent",
        "openmeld service snapshot --view agent",
        "openmeld service interrupt --dispatch <id> --view agent",
        "openmeld service cancel --dispatch <id> --view agent",
        "openmeld service start --view agent",
        "openmeld service stop --view agent",
        "openmeld service install --view agent",
        "openmeld service repair --view agent",
        "openmeld service uninstall --view agent",
      ],
      humanActionRequired: false,
      notes: [
        "Agent view does not open the human interactive service menu.",
        "Prefer explicit subcommands to keep automation deterministic.",
      ],
      optionalArguments: [],
      requiredArguments: [],
      stages: [
        "Inspect service installation and runtime state.",
        "Choose an explicit lifecycle command.",
        "Execute the requested OpenMeld Service task and read the structured result.",
      ],
      summary:
        "Manage the OpenMeld Service lifecycle on this device with explicit non-interactive commands.",
    },
    entryName: "service.menu",
  },
  "service.reinstall": {
    agentOverview: {
      commands: [
        "openmeld service repair --view agent",
        "openmeld service repair --force --view agent",
        "openmeld service status --view agent",
      ],
      humanActionRequired: false,
      notes: [
        "Use `--force` only when graceful drain times out and you accept possible in-flight task loss.",
      ],
      optionalArguments: ["--force"],
      requiredArguments: [],
      stages: [
        "Drain and tear down the current service safely.",
        "Repair OpenMeld Service files for this CLI version.",
        "Restart or report the service outcome.",
      ],
      summary:
        "Repair OpenMeld Service, preserving runtime data and optionally restarting it.",
    },
    entryName: "service.reinstall",
  },
  "service.run": {
    agentOverview: {
      commands: [
        "openmeld service start --view agent",
        "openmeld service start --mode foreground --view agent",
        "openmeld service status --view agent",
      ],
      humanActionRequired: false,
      notes: [
        "Background mode is the default and recommended mode.",
        "A selected OpenMeld profile is not required; use `--profile` only as an optional override.",
        "Use foreground mode when you need direct startup logs for debugging.",
      ],
      optionalArguments: [
        "--mode background|foreground",
        "--profile <id-or-name>",
        "--gateway-url <url>",
        "--device-id <id>",
        "--heartbeat-ms <n>",
      ],
      requiredArguments: [],
      stages: [
        "Validate local service installation and OpenMeld auth readiness.",
        "Resolve runtime mode and local service hygiene.",
        "Start the daemon and return runtime status.",
      ],
      summary:
        "Start OpenMeld Service with an explicit start mode and the existing OpenMeld sign-in context.",
    },
    entryName: "service.run",
  },
  "service.snapshot": {
    agentOverview: {
      commands: [
        "openmeld service snapshot --view agent",
        "openmeld service status --view agent",
      ],
      humanActionRequired: false,
      notes: [
        "Snapshot capture is read-only and does not modify OpenMeld Service state.",
      ],
      optionalArguments: ["--profile <id-or-name>"],
      requiredArguments: [],
      stages: [
        "Read the current local OpenMeld service status snapshot.",
        "Copy current runtime logs, state, and data into a lane-scoped evidence directory.",
        "Return the saved evidence path for follow-up debugging.",
      ],
      summary:
        "Capture a point-in-time OpenMeld Service evidence snapshot for the current lane.",
    },
    entryName: "service.snapshot",
  },
  "service.status": {
    agentOverview: {
      commands: [
        "openmeld service status --view agent",
        "openmeld service start --view agent",
        "openmeld service repair --view agent",
      ],
      humanActionRequired: false,
      notes: [
        "Status is read-only in agent view and does not change OpenMeld Service.",
        "Agent view emits daemon.status.local_result first with local service evidence, then daemon.status.result with full readiness diagnostics.",
      ],
      optionalArguments: ["--profile <id-or-name>"],
      requiredArguments: [],
      stages: [
        "Read installed service state and runtime state.",
        "Return fast local service evidence as daemon.status.local_result.",
        "Project local device readiness, gateway checks, route observation, and cleanup anomalies.",
        "Return full structured status and reply readiness as daemon.status.result.",
      ],
      summary:
        "Inspect local OpenMeld service installation, runtime state, readiness, and cleanup signals without changing state.",
    },
    entryName: "service.status",
  },
  "service.stop": {
    agentOverview: {
      commands: [
        "openmeld service stop --view agent",
        "openmeld service stop --force --view agent",
        "openmeld service status --view agent",
      ],
      humanActionRequired: false,
      notes: [
        "Use `--force` only when the service does not stop cleanly with the default graceful stop.",
      ],
      optionalArguments: ["--force", "--profile <id-or-name>"],
      requiredArguments: [],
      stages: [
        "Read the current local runtime state.",
        "Stop the active service process or managed service.",
        "Return the final stop result or not-running status.",
      ],
      summary: "Stop OpenMeld Service or the system-managed service instance.",
    },
    entryName: "service.stop",
  },
  "service.uninstall": {
    agentOverview: {
      commands: [
        "openmeld service uninstall --view agent",
        "openmeld service install --view agent",
      ],
      humanActionRequired: false,
      notes: [
        "Future OpenMeld startup checks will strongly recommend repairing OpenMeld Service after uninstall.",
      ],
      optionalArguments: [],
      requiredArguments: [],
      stages: [
        "Stop service processes when needed.",
        "Remove local service runtime assets and install metadata.",
        "Return uninstall state and next startup guidance.",
      ],
      summary:
        "Remove OpenMeld Service runtime files and clear local service state on this device.",
    },
    entryName: "service.uninstall",
  },
  "service.cancel": {
    agentOverview: {
      humanActionRequired: false,
      notes: [
        "`--dispatch` is the primary selector; `--task` is a debug-only backdoor.",
        "Cancel validates only local daemon runtime availability; it does not require OpenMeld sign-in or a selected OpenMeld profile.",
      ],
      pattern: getDaemonControlTargetPatternContract("cancel"),
      stages: [
        "Resolve the local daemon control target.",
        "Send the cancel request through the local daemon control-plane.",
        "Return the accepted or rejected control result.",
      ],
      summary:
        "Send a cancel request to one inflight OpenMeld Service task on this device.",
    },
    buildHints: () =>
      getDaemonControlTargetPatternContract("cancel").buildHints?.({}) ?? [],
    entryName: "service.cancel",
  },
  "service.interrupt": {
    agentOverview: {
      humanActionRequired: false,
      notes: [
        "`--dispatch` is the primary selector; `--task` is a debug-only backdoor.",
        "Interrupt validates only local daemon runtime availability; it does not require OpenMeld sign-in or a selected OpenMeld profile.",
      ],
      pattern: getDaemonControlTargetPatternContract("interrupt"),
      stages: [
        "Resolve the local daemon control target.",
        "Send the interrupt request through the local daemon control-plane.",
        "Return the accepted or rejected control result.",
      ],
      summary:
        "Send an interrupt request to one inflight OpenMeld Service task on this device.",
    },
    buildHints: () =>
      getDaemonControlTargetPatternContract("interrupt").buildHints?.({}) ?? [],
    entryName: "service.interrupt",
  },
  reset: {
    agentOverview: {
      commands: ["openmeld reset --yes --view agent", "openmeld start"],
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [],
      optionalArguments: ["--yes"],
      requiredArguments: [],
      stages: [
        "Confirm the destructive reset intent.",
        "Tear down the local OpenMeld service and remove lane data.",
        "Rebootstrap baseline OpenMeld files and bundled skills.",
      ],
      summary:
        "Destructively reset your local OpenMeld data, rebuild baseline files, and reinstall bundled OpenMeld skills.",
    },
    entryName: "reset",
  },
  "skills.install": {
    agentOverview: {
      humanActionRequired: false,
      notes: (context: SkillsContractContext) => [
        "Agent view requires explicit target selection for install.",
        ...buildSkillsSharedNotes(context),
      ],
      pattern: getSkillsTargetSelectionPatternContract("install"),
      stages: [
        "Resolve explicit install targets.",
        "Install OpenMeld-managed skills into each target.",
        "Return install summary and tracked target state.",
      ],
      summary:
        "Install OpenMeld skills into known agent skills directories or a custom skills directory.",
    },
    buildHints: (context: SkillsContractContext) =>
      getSkillsTargetSelectionPatternContract("install").buildHints?.(
        context
      ) ?? [],
    entryName: "skills.install",
    guideScenarios: {
      required: {
        code: "skills.install.arguments.required",
        hints: (context: SkillsContractContext) =>
          getSkillsTargetSelectionPatternContract("install").buildHints?.(
            context
          ) ?? [],
        humanSteps: ["openmeld view human", "openmeld skills"],
        notes: [
          "Agent view does not open the interactive skills target picker.",
        ],
        pattern: getSkillsTargetSelectionPatternContract("install"),
        summary:
          "openmeld skills install requires explicit target selection in agent/non-interactive mode.",
      },
    },
  },
  "skills.ensure": {
    agentOverview: {
      humanActionRequired: false,
      notes: (context: SkillsContractContext) => [
        "Agent view requires explicit target selection for ensure.",
        "Use ensure when you want one scoped command that installs or updates OpenMeld skills for the selected targets.",
        ...buildSkillsSharedNotes(context),
      ],
      pattern: getSkillsTargetSelectionPatternContract("ensure"),
      stages: [
        "Resolve explicit ensure targets.",
        "Install or update OpenMeld-managed skills for each selected target.",
        "Return install and tracked target state.",
      ],
      summary:
        "Install or update OpenMeld skills for known agent skills directories or a custom skills directory.",
    },
    buildHints: (context: SkillsContractContext) =>
      getSkillsTargetSelectionPatternContract("ensure").buildHints?.(context) ??
      [],
    entryName: "skills.ensure",
    guideScenarios: {
      required: {
        code: "skills.ensure.arguments.required",
        hints: (context: SkillsContractContext) =>
          getSkillsTargetSelectionPatternContract("ensure").buildHints?.(
            context
          ) ?? [],
        humanSteps: ["openmeld view human", "openmeld skills"],
        notes: [
          "Agent view does not open the interactive skills target picker.",
        ],
        pattern: getSkillsTargetSelectionPatternContract("ensure"),
        summary:
          "openmeld skills ensure requires explicit target selection in agent/non-interactive mode.",
      },
    },
  },
  uninstall: {
    agentOverview: {
      commands: [
        "openmeld uninstall --view agent --yes --keep-skills --keep-auth-tokens",
        "openmeld uninstall --view agent --yes --remove-skills --remove-auth-tokens",
      ],
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [
        "Uninstall removes the currently selected local OpenMeld installation by default.",
        "CLI self-removal is always a manual final step.",
      ],
      optionalArguments: [
        "--yes",
        "--keep-skills",
        "--remove-skills",
        "--keep-auth-tokens",
        "--remove-auth-tokens",
      ],
      requiredArguments: [],
      stages: [
        "Resolve uninstall scope and cleanup choices.",
        "Stop local OpenMeld service state and remove your local OpenMeld data.",
        "Return the final manual CLI removal command.",
      ],
      summary:
        "Remove your local OpenMeld data, optionally clear OpenMeld-managed skills and sign-in tokens, and return the final manual CLI removal step.",
    },
    entryName: "uninstall",
  },
  upgrade: {
    agentOverview: {
      commands: [
        "openmeld upgrade --check --view agent",
        "openmeld upgrade --yes --view agent",
        "openmeld reset --yes --view agent",
      ],
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [
        "Agent view requires explicit `--yes` before installing updates.",
        "When local version metadata is missing, reset your local OpenMeld data before retrying upgrade.",
      ],
      optionalArguments: ["--check", "--yes"],
      requiredArguments: [],
      stages: [
        "Read local version metadata and compare with npm latest.",
        "Confirm downgrade safety and explicit installation intent.",
        "Install the latest CLI version and update OpenMeld Service when needed.",
      ],
      summary:
        "Inspect OpenMeld CLI version state and, when explicitly approved, install the latest safe CLI version.",
    },
    entryName: "upgrade",
  },
  whoami: {
    agentOverview: {
      commands: [
        "openmeld whoami --view agent",
        "openmeld whoami --profile <profile-id> --view agent",
        "openmeld auth status --view agent",
      ],
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [
        "Whoami is read-only and does not change profile selection unless the process already has one resolved.",
      ],
      optionalArguments: ["--profile <id-or-name>"],
      requiredArguments: [],
      stages: [
        "Read auth session status.",
        "Resolve the explicit or current OpenMeld profile.",
        "Return auth, profile, and runtime context payloads.",
      ],
      summary:
        "Inspect the current OpenMeld auth session, selected OpenMeld profile, and agent runtime context in one structured response sequence.",
    },
    entryName: "whoami",
  },
  "skills.menu": {
    buildHints: (context: SkillsContractContext) => [
      "openmeld skills list",
      "openmeld skills check",
      "openmeld skills update",
      ...(getSkillsTargetSelectionPatternContract("ensure").buildHints?.(
        context
      ) ?? []),
      ...(getSkillsTargetSelectionPatternContract("install").buildHints?.(
        context
      ) ?? []),
      ...(getSkillsTargetSelectionPatternContract("uninstall").buildHints?.(
        context
      ) ?? []),
    ],
    entryName: "skills.menu",
  },
  "skills.uninstall": {
    agentOverview: {
      humanActionRequired: false,
      notes: (context: SkillsContractContext) => [
        "Agent view requires explicit target selection for uninstall.",
        ...buildSkillsSharedNotes(context),
      ],
      pattern: getSkillsTargetSelectionPatternContract("uninstall"),
      stages: [
        "Resolve explicit uninstall targets.",
        "Audit whether targets are inside this OpenMeld installation.",
        "Remove OpenMeld-managed skills and update tracked state.",
      ],
      summary:
        "Remove OpenMeld-managed skills from known or custom targets with explicit target selection.",
    },
    buildHints: (context: SkillsContractContext) =>
      getSkillsTargetSelectionPatternContract("uninstall").buildHints?.(
        context
      ) ?? [],
    entryName: "skills.uninstall",
    guideScenarios: {
      required: {
        code: "skills.uninstall.arguments.required",
        hints: (context: SkillsContractContext) =>
          getSkillsTargetSelectionPatternContract("uninstall").buildHints?.(
            context
          ) ?? [],
        humanSteps: ["openmeld view human", "openmeld skills"],
        notes: [
          "Agent view does not open the interactive skills target picker.",
        ],
        pattern: getSkillsTargetSelectionPatternContract("uninstall"),
        summary:
          "openmeld skills uninstall requires explicit target selection in agent/non-interactive mode.",
      },
    },
  },
  "space.add-agents": buildSpaceAddProfilesContract({
    command: "add-agents",
    entryName: "space.add-agents",
    humanChoiceText:
      "Choose one space, then select one or more Agent Profiles.",
    requiredSummary:
      "openmeld space add-agents in agent/non-interactive mode requires explicit space and Agent Profile arguments.",
    summary:
      "Use `openmeld space add-agents --profile <profile-id> <space-id> --agent-profile <agent-profile-id...> --view agent` with explicit acting profile, Space ID, and Agent Profile selection.",
  }),
  "space.add-me": {
    agentOverview: {
      commands: ({ includeViewFlag = false }) => [
        `openmeld space add-me <space-url-or-id> --project-folder <path>${includeViewFlag ? " --view agent" : ""}`,
      ],
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [
        "`--profile <human-profile-id>` selects the Human Profile used as the signed-in user's acting identity; it is not the Agent Profile being added.",
        "`--project-folder` is the preferred option name.",
        "`--workspace-path`, `--working-directory`, and `--cwd` are accepted aliases for `--project-folder`.",
        "Space membership does not prove Wake readiness.",
        'Typical use case: the user sends a Space URL and says, "add yourself to this Space using the current project folder."',
      ],
      optionalArguments: [
        "--profile <human-profile-id>",
        "--project-folder <path>",
        "--workspace-path <path>",
        "--working-directory <path>",
        "--cwd <path>",
        "--agent-controller-permission-mode <permission-mode>",
        "--details",
        "--json",
      ],
      requiredArguments: ["<space-url-or-id>"],
      stages: [
        "Parse the Space URL or Space ID and optional profileId.",
        "Detect the current agent controller, or use the Human Profile path when no supported agent controller is present.",
        "For agents, create or reuse the current Agent Profile Binding and set the Project folder.",
        "Add the Human Profile or Agent Profile to the Space through the normal membership write path.",
      ],
      summary:
        "Add the current Human Profile or current local agent to a Space with one command.",
    },
    buildHints: () => [
      "openmeld space add-me <space-url-or-id> --project-folder <path> --view agent",
      "Aliases accepted for Project folder: --workspace-path, --working-directory, --cwd.",
      "Space membership does not prove Wake readiness.",
    ],
    entryName: "space.add-me",
    guideScenarios: {
      required: {
        code: "space.add_me.arguments.required",
        commands: ({ includeViewFlag = false }) => [
          `openmeld space add-me <space-url-or-id> --project-folder <path>${includeViewFlag ? " --view agent" : ""}`,
        ],
        hints: () => [
          "Use --project-folder for the current project directory. The aliases --workspace-path, --working-directory, and --cwd are accepted.",
          "Space membership does not prove Wake readiness.",
        ],
        humanSteps: [
          "openmeld view human",
          "openmeld space add-me <space-url-or-id>",
        ],
        notes: [
          'Typical use case: the user sends a Space URL and says, "add yourself to this Space using the current project folder."',
          "The command accepts a full Space URL such as /o/<org-slug>/spaces/<space-id>?profileId=<human-profile-id>.",
        ],
        optionalArguments: [
          "--profile <human-profile-id>",
          "--project-folder <path>",
          "--workspace-path <path>",
          "--working-directory <path>",
          "--cwd <path>",
          "--agent-controller-permission-mode <permission-mode>",
          "--details",
          "--json",
        ],
        requiredArguments: ["<space-url-or-id>"],
        summary:
          "openmeld space add-me requires a Space URL or Space ID. Agents should use `openmeld space add-me <space-url-or-id> --project-folder <path> --view agent`.",
      },
    },
  },
  "space.add-human-profiles": buildSpaceAddProfilesContract({
    command: "add-human-profiles",
    entryName: "space.add-human-profiles",
    humanChoiceText:
      "Choose one space, then select one or more Human Profiles.",
    requiredSummary:
      "openmeld space add-human-profiles in agent/non-interactive mode requires explicit space and Human Profile arguments.",
    summary:
      "Use `openmeld space add-human-profiles --profile <profile-id> <space-id> --human-profile <human-profile-id...> --view agent` with explicit acting profile, Space ID, and Human Profile selection.",
  }),
  "space.add-members": buildSpaceAddProfilesContract({
    command: "add-members",
    entryName: "space.add-members",
    humanChoiceText: "Choose one space, then select one or more profiles.",
    requiredSummary:
      "openmeld space add-members in agent/non-interactive mode requires explicit space and member arguments.",
    summary:
      "Use `openmeld space add-members --profile <profile-id> <space-id> --member <profile-id...> --view agent` with explicit acting profile, Space ID, and member selection.",
  }),
  "space.remove-members": {
    agentOverview: {
      humanActionRequired: {
        possible: false,
        steps: [],
      },
      notes: [
        "remove-members only manages existing members of the current space.",
        "the current profile and the space creator are never removable through this command.",
      ],
      pattern: getSpaceMemberSelectionPatternContract("remove-members"),
      stages: [
        "check_arguments",
        "authenticate",
        "check_profile",
        "resolve_target",
        "remove_members",
      ],
      summary:
        "Use `openmeld space remove-members --profile <profile-id> <space-id> --member <profile-id...> --view agent` with explicit acting profile, Space ID, and member selection.",
    },
    buildHints: (context) =>
      getSpaceMemberSelectionPatternContract("remove-members").buildHints?.({
        ...context,
        includeViewFlag: true,
        profileId: context.profileId ?? "<profile-id>",
      }) ?? [],
    entryName: "space.remove-members",
    guideScenarios: {
      required: {
        code: "space.remove_members.arguments.required",
        humanSteps: [
          "openmeld view human",
          "openmeld space remove-members",
          "Choose one space, then select one or more members to remove.",
        ],
        notes: [
          "remove-members only manages existing members of the current space.",
          "the current profile and the space creator are never removable through this command.",
        ],
        pattern: getSpaceMemberSelectionPatternContract("remove-members"),
        summary: (context: { summary?: string }) =>
          context.summary ??
          "openmeld space remove-members in agent/non-interactive mode requires explicit space and member arguments.",
      },
    },
  },
};

export function getCommandEntryContract(
  entryName: CommandEntryName
): CommandEntryContract<CommandContractRegistryContext> | null {
  return COMMAND_ENTRY_CONTRACTS[entryName] ?? null;
}

export function getCommandHintsFromContract<
  TContext extends CommandContractRenderContext,
>(input: { context: TContext; entryName: CommandEntryName }): string[] | null {
  const contract = getCommandEntryContract(input.entryName);
  if (!contract?.buildHints) {
    return null;
  }
  return contract.buildHints(input.context);
}

function buildSkillsSharedNotes(context: SkillsContractContext): string[] {
  const notes: string[] = [];
  if (context.storeDir) {
    notes.push(`OpenMeld skills store: ${context.storeDir}`);
  }
  if (context.knownAgentIds) {
    notes.push(
      `known agent ids: ${
        context.knownAgentIds.length > 0
          ? context.knownAgentIds.join(", ")
          : "none detected"
      }`
    );
  }
  if (context.skills) {
    notes.push(
      `local OpenMeld skills: ${
        context.skills.length > 0
          ? context.skills
              .map((skill) => `${skill.name} (${skill.relativePath})`)
              .join(", ")
          : "none"
      }`
    );
  }
  return notes;
}
