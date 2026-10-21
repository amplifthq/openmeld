import { AGENT_PROFILE_WORK_CONCURRENCY_LIMIT } from "@openmeld/agent-runtime";
import {
  computerConnectionIntentSchema,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  MEMBER_AGENTS_ENABLED,
  TEAMMATE_AGENT_REQUESTS_ENABLED,
} from "@openmeld/schemas";
import { Command, Option } from "commander";
import {
  runActivityContext,
  runActivityHealth,
  runActivityHook,
  runActivityInstall,
  runActivityStatus,
  runActivitySync,
  runActivityUninstall,
} from "./agent-activity/activity-command";
import {
  runAgentActivityRead,
  runAgentActivitySessions,
  runProjectsArchive,
  runProjectsBind,
  runProjectsCreate,
  runProjectsList,
  runProjectsUnbind,
  runProjectsUpdate,
} from "./agent-activity/command";
import { runProjectsCliCommand } from "./agent-activity/entry";
import {
  runProjectsConnectionsList,
  runProjectsConnectionsRemove,
  runProjectsConnectionsSetDefault,
} from "./agent-activity/project-connections-command";
import {
  type ProjectArchiveOptions,
  type ProjectBindOptions,
  type ProjectConnectionsRemoveOptions,
  type ProjectConnectionsSetDefaultOptions,
  type ProjectCreateOptions,
  type ProjectOutputOptions,
  type ProjectUnbindOptions,
  type ProjectUpdateOptions,
  registerAgentActivityCommands,
  registerProjectCommands,
} from "./agent-activity/registration";
import { registerBuiltinAgentSelectionOptions } from "./agents/builtin-selection-contract";
import { runCenterAgentAsk } from "./center-agent/ask-command";
import {
  runCenterAgentContext,
  runCenterAgentContextReceipt,
} from "./center-agent/context-command";
import {
  runCenterAgentAudit,
  runCenterAgentDesignate,
  runCenterAgentPause,
  runCenterAgentResume,
  runCenterAgentStatus,
} from "./center-agent/management-command";
import { registerDaemonControlTargetOptions } from "./command-contracts/service-control-target";
import {
  finishCurrentCommandCheckScope,
  startCurrentCommandCheckScope,
} from "./command-entry-checks/current-command-check-state";
import { applyEntryCheckResult } from "./command-entry-checks/entry-check-blocked-json";
import { runCommandEntryFlow } from "./command-entry-checks/run-command-entry-flow";
import {
  runAgents,
  runAgentsConfig,
  runAgentsCustomAdd,
  runAgentsCustomList,
  runAgentsCustomRemove,
  runAgentsCustomUpdate,
  runAgentsDetect,
  runAgentsDisable,
  runAgentsEnable,
  runAgentsList,
  runAgentsManage,
  runAgentsRepair,
  runAgentsShow,
} from "./commands/agents";
import { runAgentsLogin } from "./commands/agents-login";
import {
  runAuthLogin,
  runAuthLogout,
  runAuthMenu,
  runAuthStatus,
} from "./commands/auth";
import {
  runComputerCurrent,
  runComputerList,
  runComputerRename,
} from "./commands/computer";
import { runDoctor } from "./commands/doctor";
import { runFeedback } from "./commands/feedback";
import { runInstallSelf } from "./commands/install-self";
import { emitLocalHelperSkillsDeprecation } from "./commands/local-helper-skills-deprecation";
import { applyProductionReleaseDefaultsToProcessEnv } from "./commands/production-release-defaults";
import {
  runProfileCreate,
  runProfileDelete,
  runProfileList,
  runProfileMenu,
  runProfileSet,
  runProfileShow,
  runProfileUpdate,
} from "./commands/profile";
import { runPrompt } from "./commands/prompt";
import { runRepairLocalState } from "./commands/repair";
import { runReset } from "./commands/reset";
import {
  isManagedSystemServiceBootstrapRun,
  runDaemon,
  runDaemonAutostart,
  runDaemonCancel,
  runDaemonInstall,
  runDaemonInterrupt,
  runDaemonReinstall,
  runDaemonRunAfterEntryChecks,
  runDaemonSnapshot,
  runDaemonStatusFlow,
  runDaemonStop,
  runDaemonUninstall,
} from "./commands/service";
import { runServiceAccountControl } from "./commands/service-account-control";
import { emitDaemonAgentOverview } from "./commands/service-agent-overview";
import { runServiceTrace } from "./commands/service-trace";
import { runSetup } from "./commands/setup";
import {
  runSkillsCheck,
  runSkillsEnsure,
  runSkillsInstall,
  runSkillsUninstall,
  runSkillsUpdate,
} from "./commands/skills";
import {
  emitTopLevelAgentOverview,
  emitTopLevelCliAgentOverview,
} from "./commands/top-level-agent-overview";
import {
  runUninstall,
  UNINSTALL_INTERNAL_SAFE_VALIDATION_FLAG,
} from "./commands/uninstall";
import {
  isUpgradeOutputHandledError,
  runUpgrade,
  UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG,
} from "./commands/upgrade";
import { runViewCommand } from "./commands/view";
import { runWhoami } from "./commands/whoami";
import { runMacOsNativeKeychainHelperIfRequested } from "./config/macos-native-keychain";
import { resolveOpenMeldEnvironmentTarget } from "./config/openmeld-environment-target";
import { ensureSystemLayout } from "./config/system-layout";
import { registerFilesCommands } from "./files/command";
import { parseNonNegativeIntegerOption } from "./lib/number-options";
import {
  resolveManagedCliDelegation,
  runManagedCliDelegation,
} from "./local-components/managed-command-authority";
import { runPendingDaemonServiceUpdate } from "./local-service/lifecycle/daemon-service-update-coordinator";
import { runServiceAccountCarrier } from "./local-service/lifecycle/service-account-authorization";
import {
  resolveProfileCreateMemberAgentController,
  runAgentAdd,
  runAgentList,
  runAgentShow,
} from "./member-agents/command";
import {
  runSessionArchive,
  runSessionDelete,
  runSessionList,
  runSessionRename,
  runSessionRestore,
} from "./member-agents/session-command";
import { emitStartupAgentOverviewForCommand } from "./openmeld-agent-overview";
import {
  runStartFromCliOptions,
  withAuthLoginOptions,
  withSpaceProfileOption,
  withStartOptions,
} from "./openmeld-cli-command-options";
import {
  normalizeOptionalString,
  runCommandWithEntryChecks,
} from "./openmeld-cli-entry-checks";
import {
  emitAgentViewHumanRecoveryHint,
  emitCliError,
  readCliErrorRequestId,
  resolveCliErrorCode,
  stripCliErrorCodePrefix,
} from "./openmeld-cli-error-output";
import {
  parseHelpTargetTokens,
  resolveHelpCommandTarget,
} from "./openmeld-cli-help-target";
import {
  buildCommandHelpExamples,
  buildTopLevelHelpText,
  DEFAULT_AGENT_EXAMPLE_PAIR,
} from "./openmeld-cli-help-text";
import {
  emitHelpfulHints,
  emitSetupFirstHint,
  emitSpaceAddAgentsMemberAliasHint,
} from "./openmeld-cli-hints";
import type {
  AgentsConfigCliOptions,
  AgentsCustomAddCliOptions,
  AgentsCustomRemoveCliOptions,
  AgentsCustomUpdateCliOptions,
  AgentsEnableCliOptions,
  AuthLoginCliOptions,
  ComputerRenameCliOptions,
  FeedbackCliOptions,
  ResetCliOptions,
  ServiceControlCliOptions,
  ServiceReinstallCliOptions,
  ServiceRunCliOptions,
  ServiceSnapshotCliOptions,
  ServiceStopCliOptions,
  ServiceTraceCliOptions,
  SkillsInstallCliOptions,
  SkillsUninstallCliOptions,
  SpaceAddMeCliOptions,
  SpaceAddMembersCliOptions,
  SpaceLeaveCliOptions,
  SpaceRemoveMembersCliOptions,
  UninstallCliOptions,
  UpgradeCliOptions,
  ViewCliOptions,
} from "./openmeld-cli-options";
import {
  getGlobalViewOption,
  readConfiguredDefaultView,
  resolveEffectiveViewForError,
  resolveEffectiveViewForOutput,
  stripViewArgs,
} from "./openmeld-cli-view";
import {
  runOrgComputers,
  runOrgCurrent,
  runOrgDirectory,
  runOrgInviteLink,
  runOrgList,
  runOrgSwitch,
} from "./org/command";
import { runOrganizationInvitationRequests } from "./org/invitation-requests-command";
import {
  runOrganizationSkillsAdd,
  runOrganizationSkillsAddAll,
  runOrganizationSkillsList,
  runOrganizationSkillsLoad,
  runOrganizationSkillsScan,
  runOrganizationSkillsShow,
} from "./organization-skills/command";
import { formatAgentControllerPermissionModeHelp } from "./profile/controller-permission-mode-input";
import { runProfileCurrentSession } from "./profile/current-session-command";
import { runProfileExecutionMode } from "./profile/execution-mode-command";
import { hasExplicitProfileUpdateField } from "./profile/profile-update-cli-options";
import {
  runProfileCreationRequestCancel,
  runProfileCreationRequestCreate,
  runProfileCreationRequestDecide,
  runProfileCreationRequestList,
  runProfileCreationRequestPreferenceGet,
  runProfileCreationRequestPreferenceSet,
  runProfileCreationRequestRetry,
} from "./profile-creation-request/command";
import {
  runRoutinesCreate,
  runRoutinesDelete,
  runRoutinesList,
  runRoutinesPause,
  runRoutinesResume,
  runRoutinesRuns,
  runRoutinesShow,
  runRoutinesUpdate,
} from "./routines/command";
import { runRoutinesCliCommand } from "./routines/entry";
import {
  type RoutineCreateOptions,
  type RoutineDeleteOptions,
  type RoutineOutputOptions,
  type RoutineRunsOptions,
  type RoutineUpdateOptions,
  registerRoutinesCommands,
} from "./routines/registration";
import { shouldEmitAgentOverview } from "./runtime/agent-overview-output";
import {
  formatInlineOpenMeldCliCommands,
  resolveUserFacingCliEntryCommand,
} from "./runtime/cli-entry-command";
import { emitCliErrorJson } from "./runtime/cli-error-json";
import { emitCliJsonEnvelope } from "./runtime/cli-json-output";
import { installCliOutputErrorHandlers } from "./runtime/cli-output-error-handler";
import { isCliOutputHandledError } from "./runtime/cli-output-handled-error";
import { resolveRuntimeContext } from "./runtime/context";
import {
  isBinaryDistribution,
  resolveOpenMeldDistribution,
} from "./runtime/distribution";
import {
  createProfileActionGuideError,
  createProfileCreateGuideError,
  createSpaceAddMembersGuideError,
  createSpaceAliasTargetGuideError,
  createSpaceContractSetGuideError,
  createSpaceLeaveGuideError,
  createSpacePublicationSetGuideError,
  createSpaceRemoveMembersGuideError,
  createSpaceResultGuideError,
  createSpaceSubcommandTargetGuideError,
  createSpaceTargetGuideError,
  createSpaceUpdatesGuideError,
} from "./runtime/dual-view-guide-catalog";
import { createPresenter } from "./runtime/presenter/index";
import { createSilentPresenter } from "./runtime/presenter/silent";
import { resolveRetiredCliCommandMessage } from "./runtime/retired-command-argv";
import { OPENMELD_VERSION } from "./runtime/version";
import {
  hasJsonOutputArgv,
  isCliMetadataQueryArgv,
  isPassiveCliQueryArgv,
  isStandaloneViewQueryArgv,
  parseLeadingCommandTokensFromArgv,
  parseStandaloneViewSwitchArgv,
  parseViewFromArgv,
} from "./runtime/view-argv";
import { registerSkillsTargetSelectionOptions } from "./skills/target-selection-contract";
import { runSpaceAccess } from "./space/access-command";
import {
  runSpaceActionHelp,
  runSpaceActionReply,
  runSpaceActionSilent,
  runSpaceActionStatus,
  runSpaceActionTargets,
  runSpaceActionWake,
} from "./space/action-command";
import { runSpaceActionMcpServer } from "./space/action-mcp-server";
import { runSpaceAddMe } from "./space/add-me-command";
import { runSpaceBoard } from "./space/board-command";
import {
  runSpaceAddMembers,
  runSpaceCreate,
  runSpaceDelete,
  runSpaceHistory,
  runSpaceJoin,
  runSpaceLeave,
  runSpaceList,
  runSpacePassword,
  runSpaceRemoveMembers,
  runSpaceSend,
  runSpaceWatch,
} from "./space/command";
import { resolveSpaceCommandCliOptions } from "./space/command-cli-options";
import { isSpaceCommandOutputHandledError } from "./space/command-output-handled";
import { runSpaceContract } from "./space/contract-command";
import { runSpaceContractSet } from "./space/contract-set-command";
import { normalizePublicationModeCliValue } from "./space/contract-set-options";
import { runDirectMessage } from "./space/direct-message";
import { registerSpaceFilesCommands } from "./space/files-registration";
import {
  runSpaceGuideClear,
  runSpaceGuideRead,
  runSpaceGuideSet,
} from "./space/guide-command";
import { runSpaceInvitations } from "./space/invitations-command";
import { runSpaceLink } from "./space/link-command";
import { registerSpaceMemberSelectionOptions } from "./space/member-selection-contract";
import { runSpaceMembers } from "./space/members-command";
import { runSpaceMenu } from "./space/menu";
import {
  runSpaceOrganizationList,
  runSpaceSelfServeJoin,
} from "./space/organization-space-command";
import { runSpaceActionSuggestPermissionMode } from "./space/permission-mode-suggestion-command";
import { getRemovedCcCliInputMessage } from "./space/removed-addressing";
import { runSpaceRespond } from "./space/respond-command";
import { runSpaceResult } from "./space/result-command";
import {
  resolveSpaceEntryCommandTarget,
  resolveSpaceReadCommandTarget,
} from "./space/space-target";
import { runSpaceStatus } from "./space/status-command";
import { runSpaceThread } from "./space/thread";
import { runSpaceUpdates } from "./space/updates-command";
import {
  runSpaceWakeProgress,
  runSpaceWakeStop,
} from "./space/wake-control-command";
import { printOpenMeldBanner, renderOpenMeldTagline } from "./ui/brand";
import { errLine, outLine } from "./ui/io";

installCliOutputErrorHandlers();

const program = new Command();
const AGENT_RAW_STREAM_OPTION_DESCRIPTION =
  "Agent raw stream: keep session meta and members, then emit raw events without overview or hints";
const TAGLINE_COMMANDS = new Set([
  "auth",
  "org",
  "binding",
  "bindings",
  "center-agent",
  "routines",
  "agents",
  "computer",
  "service",
  "daemon",
  "space",
  "spaces",
  "profiles",
  "profile",
  "setup",
  "doctor",
  "whoami",
]);

type SpaceHistoryKindOption = "text" | "status" | "system_notice";

function collectRepeatedOptionValue(
  value: string,
  previous: readonly string[] = []
): string[] {
  return [...previous, value];
}

function parseSpaceHistoryKindOption(value: string): SpaceHistoryKindOption {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "text" ||
    normalized === "status" ||
    normalized === "system_notice"
  ) {
    return normalized;
  }
  throw new Error("kind must be one of: text, status, system_notice");
}

applyProductionReleaseDefaultsToProcessEnv();

program.name(resolveUserFacingCliEntryCommand()).version(OPENMELD_VERSION);
program.option("--view <mode>", "View mode: auto|human|agent", "auto");
program.option(
  "--service-auto-install <mode>",
  "Service auto-install policy on startup: ask|always|never",
  "ask"
);
program.configureHelp({ showGlobalOptions: true });
program.showHelpAfterError(
  formatInlineOpenMeldCliCommands("(run `openmeld --help` for usage)")
);
program.addHelpText("after", buildTopLevelHelpText());

program
  .command("prompt")
  .alias("p")
  .description("Read the OpenMeld guide entry or one guide topic.")
  .argument(
    "[topic]",
    "Guide topic: overview|onboarding|space|commands|runtime"
  )
  .option(
    "--raw",
    "Print the original Markdown source for the selected topic",
    false
  )
  .option("--json", "Print canonical StructuredGuidePayload JSON", false)
  .action(async (topic, opts: { raw?: boolean; json?: boolean }) => {
    await runPrompt({
      topic: typeof topic === "string" ? topic : undefined,
      raw: opts.raw === true,
      json: opts.json === true,
    });
  });

program
  .command("view")
  .description("Show or change the default view mode.")
  .argument("[mode]", "View mode: auto|human|agent")
  .option(
    "--profile <name>",
    "Profile to use (defaults to your selected profile)"
  )
  .action(async (mode, opts: ViewCliOptions) => {
    await runCommandWithEntryChecks({
      routeTokens: ["view"],
      profile: opts.profile,
      run: async () => {
        const effectiveView = await resolveEffectiveViewForOutput();
        await runViewCommand({
          effectiveView,
          mode,
          profile: opts.profile,
        });
      },
    });
  });

program
  .command("feedback")
  .description("Send product feedback to OpenMeld.")
  .argument("<message>", "Short feedback summary or full message")
  .option(
    "--category <category>",
    "Feedback category: bug|experience|idea|question",
    "experience"
  )
  .option("--details <text>", "Additional details")
  .option("--email <address>", "Contact email for follow-up")
  .option("--as <kind>", "Submitter kind: human|local_agent")
  .option("--no-context", "Do not include CLI version or operating system")
  .option("--inbox-key <key>", "Feedback Inbox key")
  .option("--json", "Print one machine-readable JSON envelope", false)
  .action(async (message: string, opts: FeedbackCliOptions) => {
    const view = opts.json === true ? "agent" : getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["feedback"],
      view,
      run: async () => {
        await runFeedback({
          message,
          category: opts.category,
          details: opts.details,
          email: opts.email,
          submitterKind: opts.as,
          includeContext: opts.context !== false,
          inboxKey: opts.inboxKey,
          view,
        });
      },
    });
  });

withStartOptions(
  program
    .command("start")
    .description("Initial onboarding: set up your OpenMeld identity profile.")
).action(async (opts) => {
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["start"],
    view,
    profile: opts.profileId,
    gatewayUrl: opts.gatewayUrl,
    run: async () => {
      await runStartFromCliOptions({
        ...opts,
        view,
      });
    },
  });
});

program
  .command("setup")
  .description("Set up this computer for OpenMeld Space Wake.")
  .option(
    "--connection-intent <json>",
    "Account and exact previous Computer session explicitly reviewed for this connection"
  )
  .option(
    "--profile <id>",
    "Existing OpenMeld agent profile ID to connect to this computer"
  )
  .option(
    "--agent <id...>",
    "Builtin local agent ID to repair directly when you already know the target"
  )
  .option(
    "--human-profile <id>",
    "Retired OpenMeld Web setup flag; copy a fresh setup command from OpenMeld Web instead"
  )
  .option(
    "--ott <token>",
    "One-time token to sign in on this device before setup"
  )
  .option(
    "--device-code <code>",
    "Browser-approved code used to create this computer's independent sign-in session"
  )
  .option(
    "--start-session <opaque-token>",
    "Continue an OpenMeld Web Prepare setup command on this device"
  )
  .option(
    "--local-agents <mode>",
    "Select local agents during setup: all or none"
  )
  .option(
    "--local-agent <id...>",
    "Select specific local agent IDs during setup"
  )
  .option(
    "--reset-this-computer",
    "Stop stale local OpenMeld Service state before reconnecting this computer"
  )
  .addHelpText(
    "after",
    buildCommandHelpExamples("Primary entry points", [
      "openmeld setup",
      "openmeld setup --start-session <opaque-token> --local-agents all",
      "openmeld setup --profile <agent-profile-id> --local-agent <local-agent-id>",
    ])
  )
  .action(
    async (opts: {
      connectionIntent?: string;
      agent?: string[];
      deviceCode?: string;
      humanProfile?: string;
      localAgent?: string[];
      localAgents?: string;
      ott?: string;
      profile?: string;
      resetThisComputer?: boolean;
      startSession?: string;
    }) => {
      const view = getGlobalViewOption();
      const connectionIntent = opts.connectionIntent
        ? computerConnectionIntentSchema.parse(
            JSON.parse(opts.connectionIntent)
          )
        : undefined;
      if (connectionIntent && !(opts.startSession && opts.deviceCode)) {
        throw new Error(
          "--connection-intent requires --start-session and --device-code."
        );
      }
      await runCommandWithEntryChecks({
        routeTokens: ["setup"],
        view,
        profile: opts.profile,
        run: async () => {
          await runSetup({
            connectionIntent,
            agent: opts.agent,
            deviceCode: opts.deviceCode,
            humanProfile: opts.humanProfile,
            localAgent: opts.localAgent,
            localAgents: opts.localAgents,
            ott: opts.ott,
            profile: opts.profile,
            resetThisComputer: Boolean(opts.resetThisComputer),
            startSession: opts.startSession,
            view,
          });
          await maybeRunAgentViewRecoveryAfterSuccess({
            view,
            profile: opts.profile,
          });
        },
      });
    }
  );

const repairCommand = program
  .command("repair", { hidden: true })
  .description("Repair your local OpenMeld data.")
  .action(async () => {
    emitSetupFirstHint("openmeld repair");
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["repair"],
      view,
      run: async () => {
        await runRepairLocalState({
          view,
        });
      },
    });
  });

repairCommand
  .command("local-state")
  .description("Run automatic local OpenMeld data upgrade and cleanup.")
  .option(
    "--data-only",
    "Repair local OpenMeld data without checking OpenMeld Service."
  )
  .action(async (opts: { dataOnly?: boolean }) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["repair", "local-state"],
      view,
      run: async () => {
        await runRepairLocalState({
          includeDaemonService: !opts.dataOnly,
          view,
        });
      },
    });
  });

program
  .command("uninstall")
  .description("Remove your local OpenMeld data from this device.")
  .option("--yes", "Skip confirmation in interactive mode")
  .option(
    "--force",
    "Required together with --all-lanes in non-interactive mode"
  )
  .option("--keep-skills", "Keep OpenMeld-installed skills on this device")
  .option(
    "--remove-skills",
    "Remove OpenMeld-installed skills managed by OpenMeld for the selected scope"
  )
  .option("--keep-auth-tokens", "Keep OpenMeld auth tokens on this device")
  .option(
    "--remove-auth-tokens",
    "Remove OpenMeld auth tokens from this device too"
  )
  .addOption(new Option(UNINSTALL_INTERNAL_SAFE_VALIDATION_FLAG).hideHelp())
  .addOption(
    new Option(
      "--all-lanes",
      "Remove local OpenMeld data for OpenMeld, OpenMeld Dev, and OpenMeld Canary"
    ).hideHelp()
  )
  .action(async (opts: UninstallCliOptions) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["uninstall"],
      view,
      run: async () => {
        await runUninstall({
          yes: Boolean(opts.yes),
          force: Boolean(opts.force),
          allLanes: Boolean(opts.allLanes),
          keepSkills: Boolean(opts.keepSkills),
          removeSkills: Boolean(opts.removeSkills),
          keepAuthTokens: Boolean(opts.keepAuthTokens),
          removeAuthTokens: Boolean(opts.removeAuthTokens),
          internalSafeValidation: Boolean(opts.internalSafeValidation),
          view,
        });
      },
    });
  });

program
  .command("reset", { hidden: true })
  .description("Reset local OpenMeld state and reinitialize baseline files.")
  .option("--yes", "Skip confirmation prompts and execute reset immediately")
  .action(async (opts: ResetCliOptions) => {
    emitSetupFirstHint("openmeld reset");
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["reset"],
      view,
      run: async () => {
        await runReset({
          yes: Boolean(opts.yes),
          view,
        });
      },
    });
  });

program
  .command("upgrade")
  .description("Check latest OpenMeld CLI version and upgrade when needed.")
  .option("--yes", "Skip confirmation prompts and execute upgrade")
  .option("--check", "Check version only without installing")
  .addOption(new Option(UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG).hideHelp())
  .action(async (opts: UpgradeCliOptions) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["upgrade"],
      view,
      run: async () => {
        await runUpgrade({
          yes: Boolean(opts.yes),
          check: Boolean(opts.check),
          internalAlignService: Boolean(opts.internalAlignService),
          view,
        });
      },
    });
  });

// Binary distribution only: install this binary into the managed layout.
// Called by the downloaded install script (which delegates to `<tmp>/openmeld
// install-self`) and by `openmeld update`. Hidden and absent under npm.
if (isBinaryDistribution()) {
  program
    .command("install-self", { hidden: true })
    .description(
      "Install this binary into the managed OpenMeld layout and point the current-version link at it."
    )
    .option("--json", "Print machine-readable JSON.", false)
    .option(
      "--force",
      "Install even if a newer version is already present.",
      false
    )
    .action(async (opts: { json?: boolean; force?: boolean }) => {
      await runInstallSelf({
        json: opts.json === true,
        force: opts.force === true,
      });
    });
}

const authCmd = program
  .command("auth")
  .description("Manage your OpenMeld sign-in.");

authCmd.action(async () => {
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["auth"],
    view,
    run: async () => {
      await runAuthMenu({
        view,
      });
      await maybeRunAgentViewRecoveryAfterSuccess({
        view,
      });
    },
  });
});

authCmd
  .command("status")
  .description("Show your sign-in status.")
  .action(async () => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["auth", "status"],
      view,
      run: async () => {
        await runAuthStatus({
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

withAuthLoginOptions(
  authCmd.command("login").description("Sign in through your browser.")
).action(async (opts: AuthLoginCliOptions) => {
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["auth", "login"],
    view,
    run: async () => {
      await runAuthLogin({
        authUrl: opts.authUrl,
        clientId: opts.clientId,
        open: opts.open,
        method: opts.method,
        ott: opts.ott,
        view,
      });
    },
  });
});

authCmd
  .command("logout")
  .description("Sign out on this device.")
  .action(async () => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["auth", "logout"],
      view,
      run: async () => {
        await runAuthLogout({
          view,
        });
      },
    });
  });

const orgCmd = program
  .command("org")
  .description("Manage OpenMeld organizations.");

orgCmd
  .command("invitation-requests")
  .description(
    "Request invitations, share approval-required links, and review requests."
  )
  .argument(
    "<action>",
    "create | list | get | approve | reject | cancel | link | request"
  )
  .option("--email <email>", "Recipient email for create")
  .option("--space <id>", "Optional target Space for create or link")
  .option("--request <id>", "Request ID for get, approve, reject, or cancel")
  .option("--token <token>", "Shared link token for request")
  .action(async (action, opts) =>
    runOrganizationInvitationRequests({
      action,
      ...opts,
      view: getGlobalViewOption(),
    })
  );

orgCmd
  .command("list")
  .description("List your OpenMeld organizations.")
  .action(async () => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["org", "list"],
      view,
      run: async () => {
        await runOrgList({
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

orgCmd
  .command("current")
  .description("Show the active OpenMeld organization.")
  .action(async () => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["org", "current"],
      view,
      run: async () => {
        await runOrgCurrent({
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

orgCmd
  .command("switch")
  .description("Switch the active OpenMeld organization.")
  .argument("<slug>", "OpenMeld organization slug")
  .action(async (slug: string) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["org", "switch"],
      view,
      run: async () => {
        await runOrgSwitch({
          slug,
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

orgCmd
  .command("directory")
  .description("List Organization members and Agent Profiles.")
  .option("--json", "Print one machine-readable JSON envelope.", false)
  .action(async (opts: { json?: boolean }) => {
    const json = opts.json === true;
    const view = json ? "agent" : getGlobalViewOption();
    await runCommandWithEntryChecks({
      jsonOutput: json,
      routeTokens: ["org", "directory"],
      view,
      run: async () => {
        await runOrgDirectory({ json, view });
      },
    });
  });

orgCmd
  .command("computers")
  .description("List member Computers and team-safe Local Agent details.")
  .option("--json", "Print one machine-readable JSON envelope.", false)
  .action(async (opts: { json?: boolean }) => {
    const json = opts.json === true;
    const view = json ? "agent" : getGlobalViewOption();
    await runCommandWithEntryChecks({
      jsonOutput: json,
      routeTokens: ["org", "computers"],
      view,
      run: async () => {
        await runOrgComputers({ json, view });
      },
    });
  });

const orgInviteLinkCmd = orgCmd
  .command("invite-link")
  .description("Manage the active Organization invite link.");

for (const action of ["get", "create", "revoke"] as const) {
  orgInviteLinkCmd
    .command(action)
    .description(resolveOrganizationInviteLinkDescription(action))
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(async (opts: { json?: boolean }) => {
      const json = opts.json === true;
      const view = json ? "agent" : getGlobalViewOption();
      await runCommandWithEntryChecks({
        jsonOutput: json,
        routeTokens: ["org", "invite-link", action],
        view,
        run: async () => {
          await runOrgInviteLink({ action, json, view });
        },
      });
    });
}

function resolveOrganizationInviteLinkDescription(
  action: "get" | "create" | "revoke"
): string {
  if (action === "get") {
    return "Show the active Organization invite link.";
  }
  if (action === "create") {
    return "Create or reset the Organization invite link.";
  }
  return "Revoke the active Organization invite link.";
}

const centerAgentCmd = program
  .command("center-agent")
  .description("Use and manage an Organization Center Agent.");

centerAgentCmd
  .command("ask")
  .description(
    "Ask the Center Agent from a Local Agent through your existing Center Agent Chat."
  )
  .argument("[text...]", "Request for the Center Agent")
  .option("--stdin", "Read request text from stdin (EOF to finish)", false)
  .option("--file <path>", "Read request text from a UTF-8 file")
  .option(
    "--organization <slug-or-id>",
    "Use this Organization instead of the active Organization"
  )
  .option(
    "--via <client>",
    "Override the automatically detected Local Agent client shown in OpenMeld"
  )
  .option(
    "--session <id>",
    "Override the automatically detected Local Agent session locator"
  )
  .option(
    "--timeout <seconds>",
    "Maximum time to wait for a reply (default: 600; max: 3600)"
  )
  .option(
    "--no-wait",
    "Submit to Center Agent Chat and return without waiting for a reply"
  )
  .option("--json", "Print machine-readable JSON.", false)
  .action(
    async (
      textParts: string[] | undefined,
      opts: {
        file?: string;
        json?: boolean;
        organization?: string;
        session?: string;
        stdin?: boolean;
        timeout?: string;
        via?: string;
        wait?: boolean;
      }
    ) => {
      const view = opts.json === true ? "agent" : getGlobalViewOption();
      await runCommandWithEntryChecks({
        routeTokens: ["center-agent", "ask"],
        view,
        run: async () => {
          await runCenterAgentAsk({
            file: opts.file,
            organization: opts.organization,
            sessionId: opts.session,
            stdin: opts.stdin === true,
            text: Array.isArray(textParts) ? textParts.join(" ") : "",
            timeoutSeconds: parseNonNegativeIntegerOption(
              opts.timeout,
              "--timeout"
            ),
            via: opts.via,
            view,
            wait: opts.wait !== false,
          });
          await maybeRunAgentViewRecoveryAfterSuccess({
            view,
          });
        },
      });
    }
  );

centerAgentCmd
  .command("status")
  .description("Show the active Organization Center Agent designation.")
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: { json?: boolean }) => {
    const view = opts.json === true ? "agent" : getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["center-agent", "status"],
      view,
      run: async () => {
        await runCenterAgentStatus({
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

const centerAgentContextCmd = centerAgentCmd
  .command("context")
  .description(
    "Read a bounded, source-linked projection of your Center Agent Chat for a Local Agent."
  )
  .option("--cursor <cursor>", "Continue with older visible messages")
  .option("--conversation <space-id>", "Read this Center Agent session")
  .option("--limit <count>", "Maximum visible messages (default: 20; max: 50)")
  .option(
    "--max-tokens <count>",
    "Maximum estimated context tokens (default: 8000; max: 32768)"
  )
  .option(
    "--organization <slug-or-id>",
    "Use this Organization instead of the active Organization"
  )
  .option(
    "--via <client>",
    "Override the automatically detected Local Agent client shown in OpenMeld"
  )
  .option(
    "--session <id>",
    "Override the automatically detected Local Agent session locator"
  )
  .option("--json", "Print machine-readable JSON.", false)
  .action(
    async (opts: {
      conversation?: string;
      cursor?: string;
      json?: boolean;
      limit?: string;
      maxTokens?: string;
      organization?: string;
      session?: string;
      via?: string;
    }) => {
      const view = opts.json === true ? "agent" : getGlobalViewOption();
      await runCommandWithEntryChecks({
        routeTokens: ["center-agent", "context"],
        view,
        run: async () => {
          await runCenterAgentContext({
            spaceId: opts.conversation,
            cursor: opts.cursor,
            limit: parseNonNegativeIntegerOption(opts.limit, "--limit"),
            maxContextTokens: parseNonNegativeIntegerOption(
              opts.maxTokens,
              "--max-tokens"
            ),
            organization: opts.organization,
            sessionId: opts.session,
            via: opts.via,
            view,
          });
          await maybeRunAgentViewRecoveryAfterSuccess({ view });
        },
      });
    }
  );

centerAgentContextCmd
  .command("receipt")
  .description(
    "Record which manifest messages the Local Agent added to its working context."
  )
  .argument("<manifest-id>", "Center Agent Context Manifest ID")
  .option("--all", "Record every message in the manifest as loaded", false)
  .option(
    "--entry <source-ref-id=materialized-content-hash>",
    "Record one exact loaded manifest entry (repeatable)",
    collectRepeatedOptionValue,
    []
  )
  .option(
    "--organization <slug-or-id>",
    "Use the Organization that issued this context manifest"
  )
  .option(
    "--via <client>",
    "Override the automatically detected Local Agent client shown in OpenMeld"
  )
  .option(
    "--session <id>",
    "Override the automatically detected Local Agent session locator"
  )
  .option("--json", "Print machine-readable JSON.", false)
  .action(
    async (
      manifestId: string,
      opts: {
        all?: boolean;
        entry?: string[];
        json?: boolean;
        organization?: string;
        session?: string;
        via?: string;
      }
    ) => {
      const view = opts.json === true ? "agent" : getGlobalViewOption();
      const organization =
        opts.organization ??
        centerAgentContextCmd.opts<{ organization?: string }>().organization;
      await runCommandWithEntryChecks({
        routeTokens: ["center-agent", "context"],
        view,
        run: async () => {
          await runCenterAgentContextReceipt({
            all: opts.all === true,
            entries: opts.entry,
            manifestId,
            organization,
            sessionId: opts.session,
            via: opts.via,
            view,
          });
          await maybeRunAgentViewRecoveryAfterSuccess({ view });
        },
      });
    }
  );

centerAgentCmd
  .command("designate")
  .description("Designate an Agent Profile as the Center Agent.")
  .argument("<agent-profile-id>", "OpenMeld Agent Profile ID")
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (agentProfileId: string, opts: { json?: boolean }) => {
    const view = opts.json === true ? "agent" : getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["center-agent", "designate"],
      view,
      run: async () => {
        await runCenterAgentDesignate({
          agentProfileId,
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

centerAgentCmd
  .command("pause")
  .description(
    "Pause the active Organization Center Agent and stop its current tasks."
  )
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: { json?: boolean }) => {
    const view = opts.json === true ? "agent" : getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["center-agent", "pause"],
      view,
      run: async () => {
        await runCenterAgentPause({
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

centerAgentCmd
  .command("resume")
  .description("Resume the active Organization Center Agent.")
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: { json?: boolean }) => {
    const view = opts.json === true ? "agent" : getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["center-agent", "resume"],
      view,
      run: async () => {
        await runCenterAgentResume({
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

centerAgentCmd
  .command("audit")
  .description("List Center Agent audit entries for the active Organization.")
  .option("--limit <count>", "Maximum audit entries to list (1-200)")
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: { json?: boolean; limit?: string }) => {
    const view = opts.json === true ? "agent" : getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["center-agent", "audit"],
      view,
      run: async () => {
        await runCenterAgentAudit({
          limit: parseNonNegativeIntegerOption(opts.limit, "--limit"),
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

registerRoutinesCommands(program, {
  list: async (opts: RoutineOutputOptions) => {
    await runRoutinesCliCommand({
      command: "list",
      json: opts.json,
      run: runRoutinesList,
    });
  },
  create: async (opts: RoutineCreateOptions) => {
    await runRoutinesCliCommand({
      command: "create",
      json: opts.json,
      run: async (output) => {
        await runRoutinesCreate({
          ...output,
          agentProfileId: opts.agent,
          scope: opts.scope,
          cronExpression: opts.cron,
          dailyTime: opts.daily,
          instructions: opts.instructions,
          name: opts.name,
          runAtIso: opts.runAt,
          targetSpaceId: opts.targetSpace,
          timezone: opts.timezone,
        });
      },
    });
  },
  show: async (routineId: string, opts: RoutineOutputOptions) => {
    await runRoutinesCliCommand({
      command: "show",
      json: opts.json,
      run: async (output) => {
        await runRoutinesShow({ ...output, routineId });
      },
    });
  },
  update: async (routineId: string, opts: RoutineUpdateOptions) => {
    await runRoutinesCliCommand({
      command: "update",
      json: opts.json,
      run: async (output) => {
        await runRoutinesUpdate({
          ...output,
          cronExpression: opts.cron,
          dailyTime: opts.daily,
          instructions: opts.instructions,
          name: opts.name,
          runAtIso: opts.runAt,
          routineId,
          targetSpaceId: opts.targetSpace,
          timezone: opts.timezone,
        });
      },
    });
  },
  pause: async (routineId: string, opts: RoutineOutputOptions) => {
    await runRoutinesCliCommand({
      command: "pause",
      json: opts.json,
      run: async (output) => {
        await runRoutinesPause({ ...output, routineId });
      },
    });
  },
  resume: async (routineId: string, opts: RoutineOutputOptions) => {
    await runRoutinesCliCommand({
      command: "resume",
      json: opts.json,
      run: async (output) => {
        await runRoutinesResume({ ...output, routineId });
      },
    });
  },
  delete: async (routineId: string, opts: RoutineDeleteOptions) => {
    await runRoutinesCliCommand({
      command: "delete",
      json: opts.json,
      run: async (output) => {
        await runRoutinesDelete({
          ...output,
          routineId,
          yes: opts.yes,
        });
      },
    });
  },
  runs: async (routineId: string, opts: RoutineRunsOptions) => {
    await runRoutinesCliCommand({
      command: "runs",
      json: opts.json,
      run: async (output) => {
        await runRoutinesRuns({
          ...output,
          beforeScheduledFor: opts.beforeScheduledFor,
          limit: opts.limit,
          routineId,
        });
      },
    });
  },
});

registerProjectCommands(program, {
  list: async (opts: ProjectOutputOptions) => {
    await runProjectsCliCommand({
      command: "list",
      json: opts.json,
      run: runProjectsList,
    });
  },
  create: async (opts: ProjectCreateOptions) => {
    await runProjectsCliCommand({
      command: "create",
      json: opts.json,
      run: async (output) => {
        await runProjectsCreate({
          ...output,
          name: opts.name,
          slug: opts.slug,
        });
      },
    });
  },
  update: async (projectId: string, opts: ProjectUpdateOptions) => {
    await runProjectsCliCommand({
      command: "update",
      json: opts.json,
      run: async (output) => {
        await runProjectsUpdate({
          ...output,
          name: opts.name,
          projectId,
          slug: opts.slug,
        });
      },
    });
  },
  archive: async (projectId: string, opts: ProjectArchiveOptions) => {
    await runProjectsCliCommand({
      command: "archive",
      json: opts.json,
      run: async (output) => {
        await runProjectsArchive({
          ...output,
          projectId,
          yes: opts.yes,
        });
      },
    });
  },
  bind: async (projectSlug: string, opts: ProjectBindOptions) => {
    await runProjectsCliCommand({
      command: "bind",
      json: opts.json,
      run: async (output) => {
        await runProjectsBind({
          ...output,
          allowUnverified: opts.allowUnverified,
          path: opts.path,
          projectSlug,
          repository: opts.repository,
          share: opts.share,
        });
      },
    });
  },
  connectionsList: async (projectSlug: string, opts: ProjectOutputOptions) => {
    await runProjectsCliCommand({
      command: "connections.list",
      json: opts.json,
      run: async (output) => {
        await runProjectsConnectionsList({
          ...output,
          projectSlug,
        });
      },
    });
  },
  connectionsSetDefault: async (
    projectSlug: string,
    opts: ProjectConnectionsSetDefaultOptions
  ) => {
    await runProjectsCliCommand({
      command: "connections.set-default",
      json: opts.json,
      run: async (output) => {
        await runProjectsConnectionsSetDefault({
          ...output,
          generation: opts.generation,
          projectSlug,
        });
      },
    });
  },
  connectionsRemove: async (
    projectSlug: string,
    opts: ProjectConnectionsRemoveOptions
  ) => {
    await runProjectsCliCommand({
      command: "connections.remove",
      json: opts.json,
      run: async (output) => {
        await runProjectsConnectionsRemove({
          ...output,
          generation: opts.generation,
          path: opts.path,
          projectSlug,
          replacementGeneration: opts.replacementGeneration,
        });
      },
    });
  },
  unbind: async (projectSlug: string, opts: ProjectUnbindOptions) => {
    await runProjectsCliCommand({
      command: "unbind",
      json: opts.json,
      run: async (output) => {
        await runProjectsUnbind({
          ...output,
          organizationId: opts.organization,
          projectId: opts.projectId,
          projectSlug,
        });
      },
    });
  },
});

registerAgentActivityCommands(program, {
  history: runAgentActivityHistory,
  context: runActivityContext,
  health: runActivityHealth,
  hook: runActivityHook,
  install: runActivityInstall,
  read: runAgentActivityRead,
  sessions: runAgentActivitySessions,
  status: runActivityStatus,
  sync: runActivitySync,
  uninstall: runActivityUninstall,
});

withAuthLoginOptions(
  program.command("login").description("Alias for `openmeld auth login`.")
).action(async (opts: AuthLoginCliOptions) => {
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["login"],
    view,
    run: async () => {
      await runAuthLogin({
        authUrl: opts.authUrl,
        clientId: opts.clientId,
        open: opts.open,
        method: opts.method,
        ott: opts.ott,
        view,
      });
    },
  });
});

program
  .command("logout")
  .description("Alias for `openmeld auth logout`.")
  .action(async () => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["logout"],
      view,
      run: async () => {
        await runAuthLogout({
          view,
        });
      },
    });
  });

const computerCmd = program
  .command("computer")
  .description("Inspect and name computers in OpenMeld.");

computerCmd
  .command("cloud")
  .description(
    "Read your personal cloud Computer or run a file or command operation."
  )
  .option(
    "--operation <json>",
    "Computer operation: describe, browser, preview, files, read, write, edit, list, or command. Use describe to discover capabilities."
  )
  .addHelpText(
    "after",
    `
Without --operation, show your personal cloud Computer.

Examples:
  openmeld computer cloud --operation '{"action":"describe"}'
  openmeld computer cloud --operation '{"action":"read","path":"/computer/home/example.txt"}'

Use describe before running commands to inspect the operation schemas.
Commands require a stable invocationId and key; poll the same invocation to read its result.`
  )
  .action(async (opts: { operation?: string }) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["computer", "cloud"],
      view,
      run: async () => {
        const { runCloudComputer } = await import("./commands/cloud-computer");
        await runCloudComputer({ operation: opts.operation, view });
      },
    });
  });

computerCmd
  .command("wait-for-update")
  .description(
    "Wait for the existing Service update before requesting a new computer connection. Use --view agent."
  )
  .action(async () => {
    const { runComputerUpdateWait } = await import(
      "./commands/computer-update-wait"
    );
    await runComputerUpdateWait();
  });

computerCmd
  .command("disconnect")
  .description(
    "Disconnect this computer from its reviewed account without forgetting its record."
  )
  .option(
    "--connection-intent <json>",
    "Account and exact Computer session reviewed for disconnection"
  )
  .option("--expected-account <id>", "Account shown in OpenMeld Web")
  .option("--device <id>", "Computer device shown in OpenMeld Web")
  .option(
    "--runtime-lane <lane>",
    "Computer runtime lane shown in OpenMeld Web"
  )
  .action(
    async (opts: {
      connectionIntent?: string;
      expectedAccount?: string;
      device?: string;
      runtimeLane?: string;
    }) => {
      const view = getGlobalViewOption();
      await runCommandWithEntryChecks({
        routeTokens: ["computer", "disconnect"],
        view,
        run: async () => {
          const { runComputerDisconnect, runComputerDisconnectTarget } =
            await import("./commands/computer-disconnect");
          if (!opts.connectionIntent) {
            const { desktopComputerDisconnectRequestSchema } = await import(
              "@openmeld/schemas"
            );
            await runComputerDisconnectTarget(
              desktopComputerDisconnectRequestSchema.parse({
                expectedAccount: opts.expectedAccount,
                expectedConnection: {
                  deviceId: opts.device,
                  runtimeLane: opts.runtimeLane,
                },
              }),
              view
            );
            return;
          }
          if (opts.expectedAccount || opts.device || opts.runtimeLane) {
            throw new Error(
              "Use either a connection intent or an explicit Computer target."
            );
          }
          await runComputerDisconnect(
            computerConnectionIntentSchema.parse(
              JSON.parse(opts.connectionIntent)
            ),
            view
          );
        },
      });
    }
  );

computerCmd.addHelpText(
  "after",
  buildCommandHelpExamples("Examples", [
    "openmeld computer list",
    "openmeld computer current",
    'openmeld computer rename "Office MacBook"',
    "openmeld computer rename --clear",
  ])
);

computerCmd.action(() => {
  computerCmd.help();
});

computerCmd
  .command("list")
  .description("List computers on your account.")
  .action(async () => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["computer", "list"],
      view,
      run: async () => {
        await runComputerList({ view });
      },
    });
  });

computerCmd
  .command("current")
  .description("Show this computer and its current OpenMeld diagnostics.")
  .option(
    "--brief",
    "Print compact Wake, update, and local-agent readiness",
    false
  )
  .action(async (opts) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["computer", "current"],
      view,
      run: async () => {
        await runComputerCurrent({ view, brief: opts.brief === true });
      },
    });
  });

computerCmd
  .command("rename")
  .description("Rename this computer in OpenMeld.")
  .argument("[name...]", "New computer name")
  .option("--clear", "Use this computer's system name again")
  .action(
    async (nameParts: string[] | undefined, opts: ComputerRenameCliOptions) => {
      const view = getGlobalViewOption();
      await runCommandWithEntryChecks({
        routeTokens: ["computer", "rename"],
        view,
        run: async () => {
          await runComputerRename({
            clear: Boolean(opts.clear),
            nameParts: nameParts ?? [],
            view,
          });
        },
      });
    }
  );

registerFilesCommands(program, (routeTokens, run) =>
  runCommandWithEntryChecks({
    routeTokens,
    view: getGlobalViewOption(),
    run,
  })
);

const skillsCmd = program
  .command("skills")
  .description("Read and load Organization Skills.")
  .option("--json", "Print one machine-readable JSON envelope.", false);

function skillsJsonRequested(opts: { json?: boolean }): boolean {
  return opts.json === true || skillsCmd.opts().json === true;
}

registerPluginCommands(program, {
  view: getGlobalViewOption,
  run: (routeTokens, run) =>
    runCommandWithEntryChecks({
      routeTokens,
      view: getGlobalViewOption(),
      run,
    }),
});

skillsCmd.action(async (opts: { json?: boolean }) => {
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["skills"],
    view,
    run: async () => {
      await runOrganizationSkillsList({
        json: opts.json === true,
        view,
      });
    },
  });
});

registerSkillsTargetSelectionOptions({
  command: skillsCmd
    .command("ensure")
    .description(
      "Install or update OpenMeld skills for your agents on this device."
    ),
  selectionCommand: "ensure",
  agentExampleArg: DEFAULT_AGENT_EXAMPLE_PAIR,
}).action(async (opts: SkillsInstallCliOptions) => {
  const view = getGlobalViewOption();
  emitLocalHelperSkillsDeprecation("ensure");
  await runCommandWithEntryChecks({
    routeTokens: ["skills", "ensure"],
    view,
    run: async () => {
      await runSkillsEnsure({
        ...opts,
        view,
      });
    },
  });
});

registerSkillsTargetSelectionOptions({
  command: skillsCmd
    .command("install")
    .description("Install OpenMeld skills for your agents on this device."),
  selectionCommand: "install",
  agentExampleArg: DEFAULT_AGENT_EXAMPLE_PAIR,
}).action(async (opts: SkillsInstallCliOptions) => {
  const view = getGlobalViewOption();
  emitLocalHelperSkillsDeprecation("install");
  await runCommandWithEntryChecks({
    routeTokens: ["skills", "install"],
    view,
    run: async () => {
      await runSkillsInstall({
        ...opts,
        view,
      });
    },
  });
});

registerSkillsTargetSelectionOptions({
  command: skillsCmd
    .command("uninstall")
    .description("Remove OpenMeld skills from your agents on this device."),
  selectionCommand: "uninstall",
  agentExampleArg: DEFAULT_AGENT_EXAMPLE_PAIR,
})
  .option("--dry-run", "Preview uninstall targets without removing files")
  .option(
    "--allow-external-targets",
    "Allow uninstall on targets outside this OpenMeld installation"
  )
  .action(async (opts: SkillsUninstallCliOptions) => {
    const view = getGlobalViewOption();
    emitLocalHelperSkillsDeprecation("uninstall");
    await runCommandWithEntryChecks({
      routeTokens: ["skills", "uninstall"],
      view,
      run: async () => {
        await runSkillsUninstall({
          ...opts,
          view,
        });
      },
    });
  });

skillsCmd
  .command("add")
  .description(
    "Add a local or GitHub Skill, or every eligible Skill in a repository."
  )
  .argument(
    "<source>",
    "Local Skill directory or GitHub Skill or repository URL"
  )
  .option(
    "--preview",
    "Show the exact Skill and source commit without adding it"
  )
  .option(
    "--operation-id <id>",
    "Reuse this ID to safely retry a GitHub install or repository batch"
  )
  .option("--all", "Install every eligible Skill in a GitHub repository")
  .option("--json", "Print one machine-readable JSON envelope.", false)
  .action(
    async (
      source: string,
      opts: {
        all?: boolean;
        json?: boolean;
        operationId?: string;
        preview?: boolean;
      }
    ) => {
      if (opts.all && opts.preview) {
        throw new Error(
          "Use skills scan to preview a repository before --all."
        );
      }
      const view = getGlobalViewOption();
      await runCommandWithEntryChecks({
        routeTokens: ["skills", "add"],
        view,
        run: async () => {
          if (opts.all) {
            await runOrganizationSkillsAddAll({
              json: skillsJsonRequested(opts),
              operationId: opts.operationId,
              source,
              view,
            });
          } else {
            await runOrganizationSkillsAdd({
              json: skillsJsonRequested(opts),
              previewOnly: opts.preview === true,
              operationId: opts.operationId,
              source,
              view,
            });
          }
        },
      });
    }
  );

skillsCmd
  .command("scan")
  .description(
    "List the Skills in a GitHub repository without installing them."
  )
  .argument("<url>", "GitHub repository or folder URL")
  .option("--json", "Print one machine-readable JSON envelope.", false)
  .action(async (url: string, opts: { json?: boolean }) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["skills", "scan"],
      view,
      run: async () => {
        await runOrganizationSkillsScan({
          json: skillsJsonRequested(opts),
          url,
          view,
        });
      },
    });
  });

skillsCmd
  .command("list")
  .alias("ls")
  .description("List Skills in the active Organization.")
  .option("--json", "Print one machine-readable JSON envelope.", false)
  .action(async (opts: { json?: boolean }) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["skills", "list"],
      view,
      run: async () => {
        await runOrganizationSkillsList({
          json: skillsJsonRequested(opts),
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

skillsCmd
  .command("show")
  .description("Show one Skill in the active Organization.")
  .argument("<skill>", "Organization Skill name or id")
  .option("--json", "Print one machine-readable JSON envelope.", false)
  .action(async (skill: string, opts: { json?: boolean }) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["skills", "show"],
      view,
      run: async () => {
        await runOrganizationSkillsShow({
          json: skillsJsonRequested(opts),
          skill,
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

skillsCmd
  .command("load")
  .description("Load one enabled Skill into the private OpenMeld cache.")
  .argument("<skill>", "Organization Skill name or id")
  .option(
    "--release <release-id>",
    "Load this exact release instead of the active release"
  )
  .option("--json", "Print one machine-readable JSON envelope.", false)
  .action(async (skill: string, opts: { json?: boolean; release?: string }) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["skills", "load"],
      view,
      run: async () => {
        await runOrganizationSkillsLoad({
          json: skillsJsonRequested(opts),
          releaseId: opts.release,
          skill,
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

skillsCmd
  .command("check")
  .description("Check whether OpenMeld skills are installed and up to date.")
  .action(async () => {
    const view = getGlobalViewOption();
    emitLocalHelperSkillsDeprecation("check");
    await runCommandWithEntryChecks({
      routeTokens: ["skills", "check"],
      view,
      run: async () => {
        await runSkillsCheck({
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

skillsCmd
  .command("update")
  .alias("upgrade")
  .description("Update OpenMeld skills where they are already installed.")
  .action(async () => {
    const view = getGlobalViewOption();
    emitLocalHelperSkillsDeprecation("update");
    await runCommandWithEntryChecks({
      routeTokens: ["skills", "update"],
      view,
      run: async () => {
        await runSkillsUpdate({
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

const agentsCmd = program
  .command("agents")
  .description("Find, enable, and review OpenMeld agents on this device.");

agentsCmd
  .command("login <agent-id>")
  .description(
    "Sign in to the selected Antigravity ACP installation and verify a new session."
  )
  .option(
    "--method <id>",
    "Authentication method offered by Antigravity ACP.",
    "oauth-personal"
  )
  .action(async (agentId: string, opts: { method: string }) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["agents", "login"],
      view,
      run: () => runAgentsLogin({ agentId, method: opts.method, view }),
    });
  });

agentsCmd.action(async () => {
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["agents"],
    view,
    run: async () => {
      await runAgents({
        view,
      });
      await maybeRunAgentViewRecoveryAfterSuccess({
        view,
      });
    },
  });
});

agentsCmd
  .command("detect")
  .description("Find supported AI tools on this device.")
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: { json?: boolean }) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["agents", "detect"],
      view,
      run: async () => {
        await runAgentsDetect({
          json: Boolean(opts.json),
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

agentsCmd
  .command("list")
  .alias("ls")
  .description("List the agents OpenMeld can use on this device.")
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: { json?: boolean }) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["agents", "list"],
      view,
      run: async () => {
        await runAgentsList({
          json: Boolean(opts.json),
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

agentsCmd
  .command("manage")
  .description(
    "Review connected agents and enable or disable them interactively."
  )
  .action(async () => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["agents", "manage"],
      view,
      run: async () => {
        await runAgentsManage({
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

registerBuiltinAgentSelectionOptions({
  command: agentsCmd
    .command("enable")
    .alias("register")
    .description(
      "Enable agents so people can mention them in Spaces and OpenMeld can use them in automations."
    ),
  selectionCommand: "enable",
})
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: AgentsEnableCliOptions & { json?: boolean }) => {
    const json = opts.json === true;
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["agents", "enable"],
      view,
      run: async () => {
        await runAgentsEnable({
          all: Boolean(opts.all),
          agent: opts.agent,
          install: opts.install,
          json,
          view,
        });
        if (!json) {
          await maybeRunAgentViewRecoveryAfterSuccess({
            view,
          });
        }
      },
    });
  });

registerBuiltinAgentSelectionOptions({
  command: agentsCmd
    .command("repair")
    .description(
      "Refresh how OpenMeld starts one or more connected agents here."
    ),
  selectionCommand: "repair",
}).action(async (opts: AgentsEnableCliOptions) => {
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["agents", "repair"],
    view,
    run: async () => {
      await runAgentsRepair({
        all: Boolean(opts.all),
        agent: opts.agent,
        install: opts.install,
        view,
      });
      await maybeRunAgentViewRecoveryAfterSuccess({
        view,
      });
    },
  });
});

registerBuiltinAgentSelectionOptions({
  command: agentsCmd
    .command("disable")
    .alias("unregister")
    .description("Disable one or more connected agents in OpenMeld.")
    .argument(
      "[agent-id]",
      "Registered agent ID (optional positional compatibility)"
    ),
  selectionCommand: "disable",
})
  .option("--json", "Print machine-readable JSON.", false)
  .action(
    async (
      agentId: string | undefined,
      opts: AgentsEnableCliOptions & { json?: boolean }
    ) => {
      const json = opts.json === true;
      const requestedAgents = [
        ...(Array.isArray(opts.agent) ? opts.agent : []),
        ...(typeof agentId === "string" ? [agentId] : []),
      ];
      const view = getGlobalViewOption();
      await runCommandWithEntryChecks({
        routeTokens: ["agents", "disable"],
        view,
        run: async () => {
          await runAgentsDisable({
            all: Boolean(opts.all),
            agent: requestedAgents,
            json,
            view,
          });
          if (!json) {
            await maybeRunAgentViewRecoveryAfterSuccess({
              view,
            });
          }
        },
      });
    }
  );

agentsCmd
  .command("show")
  .description(
    "Show how a connected agent is currently configured in OpenMeld."
  )
  .argument("[agent-id]", "Registered agent ID")
  .action(async (agentId: string | undefined) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["agents", "show"],
      view,
      run: async () => {
        await runAgentsShow({
          agentId,
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

const agentsCustomCmd = agentsCmd
  .command("custom")
  .description("Manage custom agent targets stored in local OpenMeld config.");

agentsCustomCmd
  .command("list")
  .alias("ls")
  .description("List custom agent targets.")
  .action(async () => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["agents", "custom", "list"],
      view,
      run: async () => {
        await runAgentsCustomList({
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

agentsCustomCmd
  .command("add")
  .description("Add a custom agent target.")
  .option("--id <id>", "Custom target ID (optional; auto-generated from dir)")
  .option("--name <name>", "Custom target display name")
  .option("--dir <dir>", "Custom target absolute directory path")
  .action(async (opts: AgentsCustomAddCliOptions) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["agents", "custom", "add"],
      view,
      run: async () => {
        await runAgentsCustomAdd({
          id: opts.id,
          name: opts.name,
          dir: opts.dir,
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

agentsCustomCmd
  .command("update")
  .description("Update a custom agent target (ID is immutable).")
  .option("--id <id>", "Custom target ID")
  .option("--name <name>", "New custom target display name")
  .option("--dir <dir>", "New custom target absolute directory path")
  .action(async (opts: AgentsCustomUpdateCliOptions) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["agents", "custom", "update"],
      view,
      run: async () => {
        await runAgentsCustomUpdate({
          id: opts.id,
          name: opts.name,
          dir: opts.dir,
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

agentsCustomCmd
  .command("remove")
  .description(
    "Remove a custom agent target (blocked when the target is still registered)."
  )
  .option("--id <id>", "Custom target ID")
  .action(async (opts: AgentsCustomRemoveCliOptions) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["agents", "custom", "remove"],
      view,
      run: async () => {
        await runAgentsCustomRemove({
          id: opts.id,
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

agentsCmd
  .command("config")
  .description(
    "Update a registered agent's local OpenMeld configuration. Prefer `openmeld agents manage` for the interactive flow."
  )
  .argument("[agent-id]", "Registered agent ID")
  .option("--enabled <value>", "Set enabled: true|false")
  .action(async (agentId: string | undefined, opts: AgentsConfigCliOptions) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["agents", "config"],
      view,
      run: async () => {
        await runAgentsConfig({
          agentId,
          enabled: opts.enabled,
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

const serviceCmd = program
  .command("service")
  .alias("daemon")
  .description("Manage OpenMeld Service on this device.")
  .action(async () => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["service"],
      view,
      run: async () => {
        await runDaemon({
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

serviceCmd
  .command("start")
  .description("Start OpenMeld Service on this device.")
  .option(
    "--expected-account <id>",
    "Require this signed-in account for Service control"
  )
  .option("--mode <mode>", "Start mode: background (default) or foreground")
  .option(
    "--gateway-url <url>",
    "OpenMeld gateway URL (command line, OPENMELD_GATEWAY_URL, or saved OpenMeld settings)"
  )
  .option(
    "--profile <id-or-name>",
    "Optional OpenMeld profile override used for owner resolution"
  )
  .option("--device-id <id>", "Override daemon device id for this run")
  .option(
    "--heartbeat-ms <n>",
    "Heartbeat interval in milliseconds (default: 25000)"
  )
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts) => await runServiceStartCliAction(opts));

serviceCmd
  .command("run", { hidden: true })
  .option("--account-admission-id <id>", "CLI-owned Service startup admission")
  .description(
    "Run OpenMeld Service in this process. System service entrypoint (launchd/systemd unit definitions call this); humans should use `openmeld service start`."
  )
  .option("--mode <mode>", "Run mode: background (default) or foreground")
  .option(
    "--gateway-url <url>",
    "OpenMeld gateway URL (command line, OPENMELD_GATEWAY_URL, or saved OpenMeld settings)"
  )
  .option(
    "--profile <id-or-name>",
    "Optional OpenMeld profile override used for owner resolution"
  )
  .option("--device-id <id>", "Override daemon device id for this run")
  .option(
    "--heartbeat-ms <n>",
    "Heartbeat interval in milliseconds (default: 25000)"
  )
  .action(async (opts) => await runServiceStartCliAction(opts));

serviceCmd
  .command("update-worker", { hidden: true })
  .description("Resume one durable OpenMeld Service update in the background.")
  .action(async () => {
    const result = await runPendingDaemonServiceUpdate();
    if (result?.phase === "restored" || result?.phase === "needs_help") {
      process.exitCode = 1;
    }
  });

serviceCmd
  .command("status")
  .description("Show OpenMeld Service status on this device.")
  .option("--json", "Print machine-readable JSON.", false)
  .option(
    "--profile <id-or-name>",
    "Optional OpenMeld profile context for local service diagnostics"
  )
  .action(async (opts: { profile?: string; json?: boolean }) => {
    const json = opts.json === true;
    const view = json ? "agent" : getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["service", "status"],
      profile: opts.profile,
      view,
      run: async () => {
        await runDaemonStatusFlow({
          json,
          profile: opts.profile,
          view,
        });
        if (!json) {
          await maybeRunAgentViewRecoveryAfterSuccess({
            view,
          });
        }
      },
    });
  });

const serviceAutostartCmd = serviceCmd
  .command("autostart")
  .description(
    "Manage OpenMeld Service automatic startup without changing the current process state."
  );

serviceAutostartCmd
  .command("enable")
  .description(
    "Allow OpenMeld Service to start automatically when you sign in."
  )
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: { json?: boolean }) => {
    const json = opts.json === true;
    const view = json ? "agent" : getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["service", "autostart", "enable"],
      view,
      run: async () => {
        await runDaemonAutostart({
          action: "enable",
          json,
          view,
        });
        if (!json) {
          await maybeRunAgentViewRecoveryAfterSuccess({
            view,
          });
        }
      },
    });
  });

serviceAutostartCmd
  .command("disable")
  .description(
    "Prevent OpenMeld Service from starting automatically when you sign in."
  )
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: { json?: boolean }) => {
    const json = opts.json === true;
    const view = json ? "agent" : getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["service", "autostart", "disable"],
      view,
      run: async () => {
        await runDaemonAutostart({
          action: "disable",
          json,
          view,
        });
        if (!json) {
          await maybeRunAgentViewRecoveryAfterSuccess({
            view,
          });
        }
      },
    });
  });

serviceCmd
  .command("snapshot")
  .description("Capture an OpenMeld Service evidence snapshot on this device.")
  .option(
    "--profile <id-or-name>",
    "OpenMeld profile used for route observation"
  )
  .action(async (opts: ServiceSnapshotCliOptions) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["service", "snapshot"],
      profile: opts.profile,
      view,
      run: async () => {
        await runDaemonSnapshot({
          profile: opts.profile,
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

registerDaemonControlTargetOptions({
  command: serviceCmd
    .command("interrupt")
    .description("Send an interrupt request to an inflight local daemon task."),
}).action(async (opts: ServiceControlCliOptions) => {
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["service", "interrupt"],
    view,
    run: async () => {
      await runDaemonInterrupt({
        dispatch: opts.dispatch,
        reason: opts.reason,
        task: opts.task,
        view,
      });
      await maybeRunAgentViewRecoveryAfterSuccess({
        view,
      });
    },
  });
});

registerDaemonControlTargetOptions({
  command: serviceCmd
    .command("cancel")
    .description("Send a cancel request to an inflight local daemon task."),
}).action(async (opts: ServiceControlCliOptions) => {
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["service", "cancel"],
    view,
    run: async () => {
      await runDaemonCancel({
        dispatch: opts.dispatch,
        reason: opts.reason,
        task: opts.task,
        view,
      });
      await maybeRunAgentViewRecoveryAfterSuccess({
        view,
      });
    },
  });
});

serviceCmd
  .command("trace")
  .description("Read a Space delivery trace for debugging.")
  .requiredOption("--space <id>", "Space ID (64-character hex)")
  .option("--dispatch <id>", "Dispatch ID")
  .option("--source-signal <id>", "Source signal ID")
  .option("--client-message <id>", "Client message ID from the sender")
  .option(
    "--target-profile <id>",
    "Target OpenMeld profile ID for source-signal lookup"
  )
  .option("--password <value>", "Space password for protected access")
  .option("--profile <id>", "OpenMeld profile ID used for auth context")
  .option(
    "--gateway-url <url>",
    "OpenMeld gateway URL (command line, OPENMELD_GATEWAY_URL, or saved OpenMeld settings)"
  )
  .option("--details", "Print the full trace payload in agent view", false)
  .action(async (opts: ServiceTraceCliOptions) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["service", "trace"],
      view,
      profile: opts.profile,
      gatewayUrl: opts.gatewayUrl,
      run: async () => {
        const dispatchId = normalizeOptionalString(opts.dispatch);
        const sourceSignalId = normalizeOptionalString(opts.sourceSignal);
        const clientMessageId = normalizeOptionalString(opts.clientMessage);
        const targetProfileId = normalizeOptionalString(opts.targetProfile);
        const selectorCount =
          Number(dispatchId !== null) +
          Number(sourceSignalId !== null) +
          Number(clientMessageId !== null);
        if (selectorCount !== 1) {
          throw new Error(
            "exactly one of --dispatch, --source-signal, or --client-message is required"
          );
        }
        await runServiceTrace({
          profile: opts.profile,
          baseUrl: opts.gatewayUrl,
          space: String(opts.space ?? ""),
          ...(dispatchId ? { dispatchId } : {}),
          details: opts.details === true,
          ...(sourceSignalId ? { sourceSignalId } : {}),
          ...(clientMessageId ? { clientMessageId } : {}),
          ...(targetProfileId ? { targetProfileId } : {}),
          password: opts.password,
          view,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
          profile: opts.profile,
        });
      },
    });
  });

serviceCmd
  .command("install")
  .description("Install OpenMeld Service on this device.")
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: { json?: boolean }) => {
    const json = opts.json === true;
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["service", "install"],
      view,
      run: async () => {
        await runDaemonInstall({
          json,
          view,
        });
        if (!json) {
          await maybeRunAgentViewRecoveryAfterSuccess({
            view,
          });
        }
      },
    });
  });

serviceCmd
  .command("uninstall")
  .description("Remove OpenMeld Service from this device.")
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: { json?: boolean }) => {
    const json = opts.json === true;
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["service", "uninstall"],
      view,
      run: async () => {
        await runDaemonUninstall({
          json,
          view,
        });
        if (!json) {
          await maybeRunAgentViewRecoveryAfterSuccess({
            view,
          });
        }
      },
    });
  });

serviceCmd
  .command("repair")
  .description("Repair OpenMeld Service on this device.")
  .option(
    "--force",
    "Allow force-continue when graceful stop/drain times out (may drop in-flight tasks)"
  )
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: ServiceReinstallCliOptions & { json?: boolean }) => {
    await runServiceMaintenanceCliAction(opts, "repair");
  });

serviceCmd
  .command("update")
  .description("Update OpenMeld Service on this device.")
  .option(
    "--force",
    "This option is no longer needed. Updates always let running Agent work finish."
  )
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: ServiceReinstallCliOptions & { json?: boolean }) => {
    await runServiceMaintenanceCliAction(opts, "update");
  });

serviceCmd
  .command("reinstall", { hidden: true })
  .description("Deprecated alias for `openmeld service repair`.")
  .option(
    "--force",
    "Allow force-continue when graceful stop/drain times out (may drop in-flight tasks)"
  )
  .option("--json", "Print machine-readable JSON.", false)
  .action(async (opts: ServiceReinstallCliOptions & { json?: boolean }) => {
    errLine(
      "hint: `openmeld service reinstall` is a deprecated alias; use `openmeld service repair`."
    );
    await runServiceMaintenanceCliAction(opts, "repair");
  });

serviceCmd
  .command("stop")
  .description("Stop OpenMeld Service on this device.")
  .option(
    "--expected-account <id>",
    "Require this signed-in account for Service control"
  )
  .option(
    "--force",
    "Send SIGKILL immediately instead of SIGTERM (human flow defaults to confirmation)"
  )
  .option(
    "--profile <id-or-name>",
    "Optional OpenMeld profile override used for state sync"
  )
  .option("--json", "Print machine-readable JSON.", false)
  .action(
    async (
      opts: ServiceStopCliOptions & { json?: boolean; expectedAccount?: string }
    ) => {
      if (opts.expectedAccount !== undefined) {
        if (!opts.json || opts.force || opts.profile) {
          throw new Error(
            "Account-bound Service control requires --json and does not accept force or profile overrides."
          );
        }
        await runServiceAccountControl({
          operation: "stop",
          expectedAccount: opts.expectedAccount,
        });
        return;
      }
      const json = opts.json === true;
      const view = getGlobalViewOption();
      await runCommandWithEntryChecks({
        routeTokens: ["service", "stop"],
        view,
        run: async () => {
          await runDaemonStop({
            force: Boolean(opts.force),
            json,
            profile: opts.profile,
            view,
          });
          if (!json) {
            await maybeRunAgentViewRecoveryAfterSuccess({
              view,
            });
          }
        },
      });
    }
  );

async function runServiceStartCliAction(
  opts: ServiceRunCliOptions & {
    json?: boolean;
    expectedAccount?: string;
    accountAdmissionId?: string;
  }
): Promise<void> {
  if (opts.expectedAccount !== undefined) {
    if (
      !opts.json ||
      opts.profile ||
      opts.deviceId ||
      opts.gatewayUrl ||
      opts.heartbeatMs ||
      opts.mode
    ) {
      throw new Error(
        "Account-bound Service control requires --json and does not accept startup overrides."
      );
    }
    await runServiceAccountControl({
      operation: "start",
      expectedAccount: opts.expectedAccount,
    });
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "daemon.run",
      ok: true,
      reason: "started",
    });
    return;
  }
  if (opts.accountAdmissionId) {
    const { accountAdmissionId, ...remaining } = opts;
    await runServiceAccountCarrier(
      accountAdmissionId,
      async () => await runServiceStartCliAction(remaining)
    );
    return;
  }
  const json = opts.json === true;
  const view = getGlobalViewOption();
  if (
    !json &&
    shouldEmitAgentOverview({
      resolvedView: view === "agent" ? "agent" : "human",
    })
  ) {
    const runtime = await resolveRuntimeContext({
      view,
    });
    const presenter = createPresenter(runtime);
    emitDaemonAgentOverview({
      presenter,
      command: "run",
    });
  }
  const run = async (): Promise<void> => {
    const result = await runDaemonRunAfterEntryChecks({
      deviceId: opts.deviceId,
      gatewayUrl: opts.gatewayUrl,
      heartbeatMs: parseNonNegativeIntegerOption(
        opts.heartbeatMs,
        "--heartbeat-ms"
      ),
      profile: opts.profile,
      mode: opts.mode,
      view,
      agentOverviewHandled: view === "agent",
      outputMode: json ? "silent" : "normal",
    });
    if (json) {
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type: "daemon.run",
        ok: result.ok,
        reason: result.reason,
      });
    } else {
      await maybeRunAgentViewRecoveryAfterSuccess({
        view,
      });
    }
  };

  if (isManagedSystemServiceBootstrapRun()) {
    await run();
    return;
  }

  await runCommandWithEntryChecks({
    routeTokens: ["service", "run"],
    view,
    profile: opts.profile,
    gatewayUrl: opts.gatewayUrl,
    run,
  });
}

async function runServiceMaintenanceCliAction(
  opts: ServiceReinstallCliOptions & { json?: boolean },
  displayAction: "repair" | "update"
): Promise<void> {
  const json = opts.json === true;
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["service", "reinstall"],
    view,
    run: async () => {
      const result = await runDaemonReinstall(
        {
          displayAction,
          force: Boolean(opts.force),
          json,
          view,
        },
        {
          suppressInstallOutput: true,
        }
      );
      if (result.ok && !json) {
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      }
    },
  });
}

const spaceCmd = program
  .command("space")
  .alias("spaces")
  .description("Manage OpenMeld spaces.");
spaceCmd
  .option(
    "--gateway-url <url>",
    "OpenMeld gateway URL (command line, OPENMELD_GATEWAY_URL, or saved OpenMeld settings)"
  )
  .option(
    "--profile <id>",
    "OpenMeld profile ID (defaults to your selected profile)"
  )
  .action(async (opts) => {
    const view = getGlobalViewOption();
    if (view === "agent") {
      await runSpaceMenu({
        profile: opts.profile,
        baseUrl: opts.gatewayUrl,
        view,
        entryChecksHandled: true,
      });
      return;
    }
    await runCommandWithEntryChecks({
      routeTokens: ["space"],
      view,
      profile: opts.profile,
      gatewayUrl: opts.gatewayUrl,
      run: async () => {
        await runSpaceMenu({
          profile: opts.profile,
          baseUrl: opts.gatewayUrl,
          view,
          entryChecksHandled: true,
        });
      },
    });
  });

registerSpaceFilesCommands(spaceCmd);

spaceCmd
  .command("invitations")
  .description(
    "Send and manage email-bound Space invitations, or accept invitations for your account."
  )
  .argument(
    "<action>",
    "create | list | pending | preview | accept | resend | revoke"
  )
  .option("--space <id>", "Target Space ID for create or list")
  .option("--email <email>", "Recipient email for create")
  .option(
    "--invitation <id>",
    "Invitation ID for preview, accept, resend, or revoke"
  )
  .action(async (action, opts) => {
    await runSpaceInvitations({
      action,
      space: opts.space,
      email: opts.email,
      invitationId: opts.invitation,
      view: getGlobalViewOption(),
    });
  });

spaceCmd
  .command("link")
  .description("Create a Web link to a Space, message, or thread message.")
  .argument("[space]", "Space ID (64-character hex)")
  .option("--signal <id>", "Message signal ID")
  .option("--thread-root-signal <id>", "Thread root signal ID")
  .action(async (space, opts, command: Command) => {
    const cliOptions = resolveSpaceCommandCliOptions(command, opts);
    const spaceValue = String(space ?? "").trim();
    if (!spaceValue) {
      throw new Error(
        "missing required argument for openmeld space link: <space-id>"
      );
    }
    await runSpaceLink({
      baseUrl: cliOptions.gatewayUrl,
      signalId:
        typeof opts.signal === "string" ? opts.signal.trim() : undefined,
      space: spaceValue,
      threadRootSignalId:
        typeof opts.threadRootSignal === "string"
          ? opts.threadRootSignal.trim()
          : undefined,
      view: getGlobalViewOption(),
    });
  });

const spaceActionCmd = spaceCmd
  .command("action")
  .description("Record a dispatch-scoped OpenMeld Space Action.")
  .action(async () => {
    await runSpaceActionHelp();
  });

spaceActionCmd
  .command("reply")
  .description("Record a final Space reply for the current dispatch.")
  .argument("[message...]", "Reply message")
  .addOption(
    new Option(
      "--placement <placement>",
      "Reply location: thread or conversation"
    ).choices(["thread", "conversation"])
  )
  .option(
    "--message-file <path>",
    "Read the UTF-8 reply message from a file; use - for stdin"
  )
  .option(
    "--wake <target>",
    "Wake another Agent Profile with this reply",
    collectRepeatedOptionValue,
    []
  )
  .option(
    "--reference <target>",
    "Reference an Agent Profile",
    collectRepeatedOptionValue,
    []
  )
  .option(
    "--mention <target>",
    "Mention a Human Profile",
    collectRepeatedOptionValue,
    []
  )
  .option(
    "--file <path>",
    "Share a local file in this Space reply",
    collectRepeatedOptionValue,
    []
  )
  .action(async (messageParts, opts) => {
    await runSpaceActionReply({
      filePaths: Array.isArray(opts.file) ? opts.file : [],
      messageFilePath:
        typeof opts.messageFile === "string" ? opts.messageFile : undefined,
      messageParts: Array.isArray(messageParts) ? messageParts : [],
      placement:
        opts.placement === "thread" || opts.placement === "conversation"
          ? opts.placement
          : undefined,
      mentionTargets: Array.isArray(opts.mention) ? opts.mention : [],
      wakeTargets: Array.isArray(opts.wake) ? opts.wake : [],
      referenceTargets: Array.isArray(opts.reference) ? opts.reference : [],
    });
  });

spaceActionCmd
  .command("wake")
  .description(
    "Record a final handoff message that wakes another Agent Profile."
  )
  .argument("<target>", "Target Agent Profile")
  .argument("<message...>", "Handoff message")
  .action(async (target, messageParts) => {
    await runSpaceActionWake({
      target,
      messageParts: Array.isArray(messageParts) ? messageParts : [],
    });
  });

// Compatibility for frozen/in-flight legacy work; not offered to new Agents.
spaceActionCmd
  .command("status", { hidden: true })
  .description("Record a legacy final Space status for an existing dispatch.")
  .argument("<status>", "Final status: done|blocked|needs_input|handoff")
  .argument("<text...>", "Short status text")
  .action(async (status, textParts) => {
    await runSpaceActionStatus({
      status,
      textParts: Array.isArray(textParts) ? textParts : [],
    });
  });

spaceActionCmd
  .command("silent")
  .description("Record an explicit no-public-reply final outcome.")
  .requiredOption("--reason <reason>", "Reason for staying silent")
  .action(async (opts) => {
    await runSpaceActionSilent({
      reason: opts.reason,
    });
  });

spaceActionCmd
  .command("suggest-permission-mode")
  .description(
    "Show your owner a one-click card for the permission mode this task suggested."
  )
  .action(async () => {
    await runSpaceActionSuggestPermissionMode();
  });

spaceActionCmd
  .command("targets")
  .description("List current dispatch Space Action targets.")
  .action(async () => {
    await runSpaceActionTargets();
  });

spaceActionCmd
  .command("help")
  .description("Show OpenMeld Space Action help.")
  .action(async () => {
    await runSpaceActionHelp();
  });

withSpaceProfileOption(
  spaceCmd
    .command("create")
    .description("Create a new space and print its space ID.")
    .option(
      "--name <name>",
      "Space name (<=80 chars; prompted in human interactive mode)"
    )
    .option(
      "--visibility <public|private>",
      "Organization visibility for this space"
    )
    .option("--guide <text>", "Optional space guide")
    .option(
      "--password <value>",
      "Optional space password (minimum 6 characters; numbers/letters/symbols accepted)"
    )
    .option("--join", "Join immediately after create")
    .option("--no-join", "Do not ask to join after create")
    .option(
      "--output <mode>",
      "Output mode when auto-joining: ndjson|text",
      "text"
    )
).action(async (opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const view = getGlobalViewOption();
  if (
    view === "agent" &&
    (normalizeOptionalString(opts.name) === null ||
      normalizeOptionalString(opts.visibility) === null)
  ) {
    await runSpaceCreate({
      profile: cliOptions.profile,
      baseUrl: cliOptions.gatewayUrl,
      name: opts.name,
      visibility: opts.visibility,
      guide: opts.guide,
      password: opts.password,
      join: opts.join,
      output: opts.output,
      view,
    });
    return;
  }
  await runCommandWithEntryChecks({
    routeTokens: ["space", "create"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceCreate({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        name: opts.name,
        visibility: opts.visibility,
        guide: opts.guide,
        password: opts.password,
        join: opts.join,
        output: opts.output,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("delete")
    .description("Delete one or more spaces (requires owner confirmation).")
    .argument("[space]", "Space ID (64-character hex)")
    .option("--password <value>", "Space password for protected access")
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "delete"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceDelete({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: typeof space === "string" ? space : undefined,
        password: cliOptions.password,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("join")
    .description(
      "Open an existing Space membership and chat; use --self-serve to join a public Organization Space and exit."
    )
    .argument("[space]", "Space ID (64-character hex)")
    .option(
      "--self-serve",
      "Join a public Organization Space as the current Human Profile without opening chat",
      false
    )
    .option(
      "--local-echo",
      "Show local optimistic echo before server events (enabled by default in human interactive join)"
    )
    .option("--no-local-echo", "Clean mode: only render server events")
    .option(
      "--history-limit <n>",
      "Recent history preload size on join (default: 100; 0 disables preload)",
      "100"
    )
    .option("--role <text>", "Role in this space")
    .option(
      "--mention-alias <token>",
      "Space-level mention alias (used by @alias in this space)"
    )
    .option("--password <value>", "Space password for protected access")
    .option(
      "--output <mode>",
      "Output mode: ndjson|text (default: text)",
      "text"
    )
    .option("--raw-stream", AGENT_RAW_STREAM_OPTION_DESCRIPTION, false)
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const localEcho = opts.noLocalEcho !== true;
  const view = getGlobalViewOption();
  if (opts.selfServe === true) {
    const spaceValue = normalizeOptionalString(space);
    if (!spaceValue) {
      throw Object.assign(
        new Error(
          "space join --self-serve requires an explicit public Organization Space ID"
        ),
        { code: "space.join.self_serve.space_required" }
      );
    }
    await runCommandWithEntryChecks({
      routeTokens: ["space", "join", "--self-serve"],
      view,
      profile: cliOptions.profile,
      gatewayUrl: cliOptions.gatewayUrl,
      run: async () => {
        await runSpaceSelfServeJoin({
          profile: cliOptions.profile,
          baseUrl: cliOptions.gatewayUrl,
          space: spaceValue,
          password: opts.password,
          view,
          entryChecksHandled: true,
        });
      },
    });
    return;
  }
  if (view === "agent" && normalizeOptionalString(space) === null) {
    await runSpaceJoin({
      profile: cliOptions.profile,
      baseUrl: cliOptions.gatewayUrl,
      space: typeof space === "string" ? space : undefined,
      output: opts.output,
      password: opts.password,
      localEcho,
      historyLimit: parseNonNegativeIntegerOption(
        opts.historyLimit,
        "history-limit"
      ),
      role: opts.role,
      mentionAlias: opts.mentionAlias,
      rawStream: opts.rawStream === true,
      view,
    });
    return;
  }
  await runCommandWithEntryChecks({
    routeTokens: ["space", "join"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceJoin({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: typeof space === "string" ? space : undefined,
        output: opts.output,
        password: cliOptions.password,
        localEcho,
        historyLimit: parseNonNegativeIntegerOption(
          opts.historyLimit,
          "history-limit"
        ),
        role: opts.role,
        mentionAlias: opts.mentionAlias,
        rawStream: opts.rawStream === true,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("respond")
    .description("Review and answer a task waiting for you in this Space.")
    .argument("<space>", "Space ID (64-character hex)")
    .option("--execution <id>", "Exact execution from the pending request")
    .option("--interaction <id>", "Exact interaction from the pending request")
    .option(
      "--response <json>",
      "Explicit response JSON; omit to review the available choices"
    )
    .option("--password <value>", "Space password for protected access")
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "respond"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () =>
      await runSpaceRespond({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: String(space),
        password: cliOptions.password,
        view,
        execution: normalizeOptionalString(opts.execution) ?? undefined,
        interaction: normalizeOptionalString(opts.interaction) ?? undefined,
        response: normalizeOptionalString(opts.response) ?? undefined,
        entryChecksHandled: true,
      }),
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("wake-progress")
    .description(
      "Read live Wake progress for this Space; use result or service trace after execution."
    )
    .argument("<space>", "Space URL or 64-character Space ID")
    .option(
      "--client-message <client-message-id>",
      "Read progress for one client message instead of the active Space summary"
    )
    .option(
      "--target-profile <profile-id>",
      "Narrow progress to one target Agent Profile"
    )
    .option(
      "--source-profile <profile-id>",
      "Narrow the active summary to work requested by one profile"
    )
    .option("--password <value>", "Space password for protected access")
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const target = resolveSpaceReadCommandTarget({
    baseUrl: cliOptions.gatewayUrl,
    profile: cliOptions.profile,
    space: String(space ?? "").trim(),
  });

  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "wake-progress"],
    view,
    profile: target.profile,
    gatewayUrl: target.baseUrl,
    run: async () => {
      await runSpaceWakeProgress({
        profile: target.profile,
        baseUrl: target.baseUrl,
        space: target.space,
        clientMessageId:
          normalizeOptionalString(opts.clientMessage) ?? undefined,
        sourceProfileId:
          normalizeOptionalString(opts.sourceProfile) ?? undefined,
        targetProfileId:
          normalizeOptionalString(opts.targetProfile) ?? undefined,
        password: cliOptions.password,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("wake-stop")
    .description(
      "Request Stop for one live Wake and report only the server-confirmed state."
    )
    .argument("<space>", "Space URL or 64-character Space ID")
    .option(
      "--client-message <client-message-id>",
      "Select the Wake by client message ID"
    )
    .option(
      "--source-signal <signal-id>",
      "Select the Wake by source Space signal ID"
    )
    .requiredOption(
      "--target-profile <profile-id>",
      "Target Agent Profile ID for the selected Wake"
    )
    .option("--reason <text>", "Reason recorded with the Stop request")
    .option("--password <value>", "Space password for protected access")
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const target = resolveSpaceReadCommandTarget({
    baseUrl: cliOptions.gatewayUrl,
    profile: cliOptions.profile,
    space: String(space ?? "").trim(),
  });

  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "wake-stop"],
    view,
    profile: target.profile,
    gatewayUrl: target.baseUrl,
    run: async () => {
      await runSpaceWakeStop({
        profile: target.profile,
        baseUrl: target.baseUrl,
        space: target.space,
        clientMessageId:
          normalizeOptionalString(opts.clientMessage) ?? undefined,
        sourceSignalId: normalizeOptionalString(opts.sourceSignal) ?? undefined,
        targetProfileId: String(opts.targetProfile),
        reason: normalizeOptionalString(opts.reason) ?? undefined,
        password: cliOptions.password,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("add-me")
    .description("Add me to this Space.")
    .argument("<space>", "Space URL or Space ID")
    .option("--password <value>", "Space password for protected access")
    .option(
      "--agent-profile <id>",
      "Reuse this exact Agent Profile; omitted means create a new one"
    )
    .option(
      "--project-folder <path>",
      "Project folder for this agent profile",
      collectRepeatedOptionValue
    )
    .option(
      "--workspace-path <path>",
      "Alias for --project-folder",
      collectRepeatedOptionValue
    )
    .option(
      "--working-directory <path>",
      "Alias for --project-folder",
      collectRepeatedOptionValue
    )
    .option(
      "--cwd <path>",
      "Alias for --project-folder",
      collectRepeatedOptionValue
    )
    .option(
      "--agent-controller-permission-mode <policy>",
      formatAgentControllerPermissionModeHelp()
    )
    .option("--model <model>", "Model for this Agent Profile Binding")
    .option(
      "--reasoning-effort <level>",
      "Reasoning effort for the selected model"
    )
    .option(
      "--confirm-dangerous-agent-controller-permission-mode",
      "Confirm a dangerous Agent Controller Permission Mode without prompting",
      false
    )
    .option("--details", "Print detailed add-me diagnostics")
    .option("--json", "Print machine-readable add-me diagnostics", false)
).action(
  async (
    space,
    opts: SpaceAddMeCliOptions,
    command: Command
  ): Promise<void> => {
    const cliOptions = resolveSpaceCommandCliOptions(command, opts);
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["space", "add-me"],
      view,
      profile: cliOptions.profile,
      gatewayUrl: cliOptions.gatewayUrl,
      run: async () => {
        await runSpaceAddMe({
          agentProfile: opts.agentProfile,
          profile: cliOptions.profile,
          baseUrl: cliOptions.gatewayUrl,
          space,
          password: cliOptions.password,
          projectFolders: {
            projectFolder: opts.projectFolder,
            workspacePath: opts.workspacePath,
            workingDirectory: opts.workingDirectory,
            cwd: opts.cwd,
          },
          agentControllerPermissionModeInput:
            opts.agentControllerPermissionMode,
          confirmDangerousAgentControllerPermissionMode:
            opts.confirmDangerousAgentControllerPermissionMode === true,
          details: opts.details === true,
          json: opts.json === true,
          model: opts.model,
          reasoningEffort: opts.reasoningEffort,
          view,
          entryChecksHandled: true,
        });
      },
    });
  }
);

withSpaceProfileOption(
  registerSpaceMemberSelectionOptions({
    command: spaceCmd
      .command("add-members")
      .alias("add-profiles")
      .description("Add Organization Directory profiles to a Space.")
      .argument("[space]", "Space ID (64-character hex)")
      .option("--password <value>", "Space password for protected access")
      .option("--details", "Print detailed add-members progress in agent view"),
    selectionCommand: "add-members",
  })
).action(
  async (
    space,
    opts: SpaceAddMembersCliOptions,
    command: Command
  ): Promise<void> => {
    const cliOptions = resolveSpaceCommandCliOptions(command, opts);
    const outputView = await resolveEffectiveViewForOutput();
    let members: string[] | undefined;
    if (Array.isArray(opts.member)) {
      members = opts.member;
    } else if (typeof opts.member === "string") {
      members = [opts.member];
    }
    if (
      outputView === "agent" &&
      (typeof space !== "string" || space.trim().length === 0) &&
      !(opts.all === true) &&
      !members?.length
    ) {
      throw createSpaceAddMembersGuideError();
    }
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["space", "add-members"],
      view,
      profile: cliOptions.profile,
      gatewayUrl: cliOptions.gatewayUrl,
      run: async () => {
        await runSpaceAddMembers({
          mode: "profiles",
          profile: cliOptions.profile,
          baseUrl: cliOptions.gatewayUrl,
          space: typeof space === "string" ? space : undefined,
          password: cliOptions.password,
          members,
          all: opts.all === true,
          details: opts.details === true,
          view,
          entryChecksHandled: true,
          membershipSource: "organization_directory",
        });
      },
    });
  }
);

withSpaceProfileOption(
  registerSpaceMemberSelectionOptions({
    command: spaceCmd
      .command("add-agents")
      .description("Add Organization Directory Agent Profiles to a Space.")
      .argument("[space]", "Space ID (64-character hex)")
      .option("--password <value>", "Space password for protected access")
      .option("--details", "Print detailed add-agents progress in agent view")
      .addOption(
        new Option(
          "--member <profile-id...>",
          "Agent Profile id(s) to add (compatibility alias)"
        ).hideHelp()
      ),
    selectionCommand: "add-agents",
  })
).action(
  async (
    space,
    opts: SpaceAddMembersCliOptions,
    command: Command
  ): Promise<void> => {
    const cliOptions = resolveSpaceCommandCliOptions(command, opts);
    const outputView = await resolveEffectiveViewForOutput();
    let members: string[] | undefined;
    if (Array.isArray(opts.agentProfile)) {
      members = opts.agentProfile;
    } else if (typeof opts.agentProfile === "string") {
      members = [opts.agentProfile];
    } else if (Array.isArray(opts.member)) {
      members = opts.member;
      emitSpaceAddAgentsMemberAliasHint();
    } else if (typeof opts.member === "string") {
      members = [opts.member];
      emitSpaceAddAgentsMemberAliasHint();
    }
    if (
      outputView === "agent" &&
      (typeof space !== "string" || space.trim().length === 0) &&
      !(opts.all === true) &&
      !members?.length
    ) {
      throw createSpaceAddMembersGuideError(
        "openmeld space add-agents in agent/non-interactive mode requires explicit space and Agent Profile arguments.",
        "space.add-agents"
      );
    }
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["space", "add-agents"],
      view,
      profile: cliOptions.profile,
      gatewayUrl: cliOptions.gatewayUrl,
      run: async () => {
        await runSpaceAddMembers({
          mode: "agents",
          profile: cliOptions.profile,
          baseUrl: cliOptions.gatewayUrl,
          space: typeof space === "string" ? space : undefined,
          password: cliOptions.password,
          members,
          all: opts.all === true,
          details: opts.details === true,
          view,
          entryChecksHandled: true,
          membershipSource: "organization_directory",
        });
      },
    });
  }
);

withSpaceProfileOption(
  registerSpaceMemberSelectionOptions({
    command: spaceCmd
      .command("add-human-profiles")
      .description("Add your own Human Profiles as members of a space.")
      .argument("[space]", "Space ID (64-character hex)")
      .option("--password <value>", "Space password for protected access")
      .option(
        "--details",
        "Print detailed add-human-profiles progress in agent view"
      ),
    selectionCommand: "add-human-profiles",
  })
).action(
  async (
    space,
    opts: SpaceAddMembersCliOptions,
    command: Command
  ): Promise<void> => {
    const cliOptions = resolveSpaceCommandCliOptions(command, opts);
    const outputView = await resolveEffectiveViewForOutput();
    let members: string[] | undefined;
    if (Array.isArray(opts.humanProfile)) {
      members = opts.humanProfile;
    } else if (typeof opts.humanProfile === "string") {
      members = [opts.humanProfile];
    }
    if (
      outputView === "agent" &&
      (typeof space !== "string" || space.trim().length === 0) &&
      !(opts.all === true) &&
      !members?.length
    ) {
      throw createSpaceAddMembersGuideError(
        "openmeld space add-human-profiles in agent/non-interactive mode requires explicit space and Human Profile arguments.",
        "space.add-human-profiles"
      );
    }
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["space", "add-human-profiles"],
      view,
      profile: cliOptions.profile,
      gatewayUrl: cliOptions.gatewayUrl,
      run: async () => {
        await runSpaceAddMembers({
          mode: "human_profiles",
          profile: cliOptions.profile,
          baseUrl: cliOptions.gatewayUrl,
          space: typeof space === "string" ? space : undefined,
          password: cliOptions.password,
          members,
          all: opts.all === true,
          details: opts.details === true,
          view,
          entryChecksHandled: true,
        });
      },
    });
  }
);

withSpaceProfileOption(
  registerSpaceMemberSelectionOptions({
    command: spaceCmd
      .command("remove-members")
      .description("Remove your managed members from a space.")
      .argument("[space]", "Space ID (64-character hex)")
      .option("--password <value>", "Space password for protected access"),
    selectionCommand: "remove-members",
  })
).action(
  async (
    space,
    opts: SpaceRemoveMembersCliOptions,
    command: Command
  ): Promise<void> => {
    const cliOptions = resolveSpaceCommandCliOptions(command, opts);
    const outputView = await resolveEffectiveViewForOutput();
    let members: string[] | undefined;
    if (Array.isArray(opts.member)) {
      members = opts.member;
    } else if (typeof opts.member === "string") {
      members = [opts.member];
    }
    if (
      outputView === "agent" &&
      (typeof space !== "string" || space.trim().length === 0) &&
      !(opts.all === true) &&
      !members?.length
    ) {
      throw createSpaceRemoveMembersGuideError();
    }
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["space", "remove-members"],
      view,
      profile: cliOptions.profile,
      gatewayUrl: cliOptions.gatewayUrl,
      run: async () => {
        await runSpaceRemoveMembers({
          profile: cliOptions.profile,
          baseUrl: cliOptions.gatewayUrl,
          space: typeof space === "string" ? space : undefined,
          password: cliOptions.password,
          members,
          all: opts.all === true,
          view,
          entryChecksHandled: true,
        });
      },
    });
  }
);

withSpaceProfileOption(
  spaceCmd
    .command("leave")
    .description("Leave a space with the current profile.")
    .argument("[space]", "Space ID (64-character hex)")
    .option("--password <value>", "Space password for protected access")
).action(
  async (
    space,
    opts: SpaceLeaveCliOptions,
    command: Command
  ): Promise<void> => {
    const cliOptions = resolveSpaceCommandCliOptions(command, opts);
    const outputView = await resolveEffectiveViewForOutput();
    if (
      outputView === "agent" &&
      (typeof space !== "string" || space.trim().length === 0)
    ) {
      throw createSpaceLeaveGuideError();
    }
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["space", "leave"],
      view,
      profile: cliOptions.profile,
      gatewayUrl: cliOptions.gatewayUrl,
      run: async () => {
        await runSpaceLeave({
          profile: cliOptions.profile,
          baseUrl: cliOptions.gatewayUrl,
          space: typeof space === "string" ? space : undefined,
          password: cliOptions.password,
          view,
          entryChecksHandled: true,
        });
      },
    });
  }
);

withSpaceProfileOption(
  spaceCmd
    .command("watch")
    .description("Watch a space in read-only mode.")
    .argument("[space]", "Space ID (64-character hex)")
    .option(
      "--history-limit <n>",
      "Recent history preload size on watch (default: 100; 0 disables preload)",
      "100"
    )
    .option("--password <value>", "Space password for protected access")
    .option(
      "--output <mode>",
      "Output mode: ndjson|text (default: text)",
      "text"
    )
    .option("--raw-stream", AGENT_RAW_STREAM_OPTION_DESCRIPTION, false)
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const outputView = await resolveEffectiveViewForOutput();
  if (
    outputView === "agent" &&
    (typeof space !== "string" || space.trim().length === 0)
  ) {
    throw createSpaceTargetGuideError("watch");
  }
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "watch"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceWatch({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: typeof space === "string" ? space : undefined,
        password: cliOptions.password,
        output: opts.output,
        historyLimit: parseNonNegativeIntegerOption(
          opts.historyLimit,
          "history-limit"
        ),
        rawStream: opts.rawStream === true,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("dm")
    .description(
      "Open a Direct Message with a person or Agent, optionally sending a message."
    )
    .argument("<target-profile-id>", "Exact recipient Profile ID")
    .argument("[text...]", "Message text")
    .option("--stdin", "Read message text from stdin")
    .option("--text-file <path>", "Read message text from a UTF-8 file")
    .option("--wake", "Ask the recipient Agent to start work")
    .option(
      "--space <space-id>",
      "Send to the exact Direct Message from an earlier receipt"
    )
    .option(
      "--message-id <uuid>",
      "Stable message ID; reuse it when retrying a send"
    )
    .option(
      "--new-chat <uuid>",
      "Create a separate Human–Center Agent chat; reuse the ID on retries"
    )
).action(async (targetProfileId, textParts, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  await runDirectMessage({
    targetProfileId,
    text: Array.isArray(textParts) ? textParts.join(" ") : "",
    stdin: opts.stdin === true,
    textFile: opts.textFile,
    profile: cliOptions.profile,
    baseUrl: cliOptions.gatewayUrl,
    clientMessageId: opts.messageId,
    spaceId: opts.space,
    creationId: opts.newChat,
    wake: opts.wake === true,
    view: getGlobalViewOption(),
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("send")
    .description("Send one message to a Space.")
    .option(
      "--new-task",
      `Start an independent task with Codex, Claude Code, or official Antigravity ACP (up to ${AGENT_PROFILE_WORK_CONCURRENCY_LIMIT} per Agent)`
    )
    .option(
      "--fork-from <signal-id>",
      "Fork a Codex or Claude Code task from its Wake request or Agent reply"
    )
    .option(
      "--continue-from <signal-id>",
      "Continue from the Agent's Wake request or reply; use --reply-to for thread placement"
    )
    .option(
      "--task-access <mode>",
      "Extra restriction: space_context, read_only (Codex), or workspace. Omit to use Agent settings"
    )
    .option(
      "--task-workspace <mode>",
      "Working copy: isolated (private project worktree) or current; does not change task access"
    )
    .option("--project <slug>", "Project for a new code task")
    .option("--repository <url>", "Repository associated with --project")
    .argument("[space]", "Space ID (64-character hex)")
    .argument("[text...]", "Text to send")
    .option(
      "--file <path>",
      "Share a local file in this Space message (repeatable, max 10)",
      collectRepeatedOptionValue,
      []
    )
    .option("--stdin", "Read message text from stdin (EOF to finish)", false)
    .option("--text-file <path>", "Read message text from a UTF-8 file")
    .option(
      "--wake <profile-id>",
      "Wake an Agent Profile; adds @name to the text (repeatable)",
      collectRepeatedOptionValue,
      []
    )
    .option(
      "--reference <profile-id>",
      "Reference an Agent Profile (repeatable)",
      collectRepeatedOptionValue,
      []
    )
    .option(
      "--mention <profile-id>",
      "Mention a Human Profile (repeatable)",
      collectRepeatedOptionValue,
      []
    )
    .option(
      "--plain",
      "Assert that this message has no recipients; text is always literal",
      false
    )
    .option(
      "--reply-to <signal-id>",
      "Reply into the thread of a message (creates the thread if it does not exist yet)"
    )
    .option(
      "--client-message <id>",
      "Stable request ID for retrying or stopping this send before it starts"
    )
    .option("--password <value>", "Space password for protected access")
).action(async (space, textParts, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const spaceValue = String(space ?? "").trim();
  const outputView = await resolveEffectiveViewForOutput();
  if (!spaceValue) {
    if (outputView === "agent") {
      throw createSpaceSubcommandTargetGuideError("send");
    }
    throw createSpaceSubcommandTargetGuideError("send");
  }
  const textValue = Array.isArray(textParts)
    ? textParts.join(" ")
    : String(textParts ?? "");
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "send"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      const projectWork = await resolveCliProjectWork({
        baseUrl: cliOptions.gatewayUrl,
        projectSlug: opts.project,
        repositoryUrl: opts.repository,
      });
      await runSpaceSend({
        clientMessageId:
          typeof opts.clientMessage === "string"
            ? opts.clientMessage
            : undefined,
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: spaceValue,
        filePaths: Array.isArray(opts.file) ? opts.file.map(String) : [],
        contextSourceSignalId: opts.forkFrom ?? opts.continueFrom,
        contextSelection: resolveSpaceTaskSelection({
          space: spaceValue,
          wakeTargets: opts.wake,
          newTask: opts.newTask,
          forkFrom: opts.forkFrom,
          continueFrom: opts.continueFrom,
          taskAccess: opts.taskAccess,
          taskWorkspace: opts.taskWorkspace,
          projectWork,
        }),
        password: cliOptions.password,
        text: textValue,
        stdin: Boolean(opts.stdin),
        textFile: typeof opts.textFile === "string" ? opts.textFile : undefined,
        plainText: opts.plain === true,
        wakeTargets: opts.wake,
        referenceTargets: opts.reference,
        mentionTargets: opts.mention,
        replyToSignalId:
          typeof opts.replyTo === "string" ? opts.replyTo : undefined,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("history")
    .description("Read recent or anchored space history.")
    .argument("[space]", "Space URL or 64-character Space ID")
    .option("--limit <n>", "Max items (default: 20)")
    .option(
      "--after-signal <signal-id>",
      "Read history strictly after one signal"
    )
    .option(
      "--around-signal <signal-id>",
      "Read a local context window around one signal"
    )
    .option(
      "--before <n>",
      "Context items before --around-signal anchor (requires --around-signal)"
    )
    .option(
      "--after <n>",
      "Context items after --around-signal anchor (requires --around-signal)"
    )
    .option(
      "--from-profile <profile-id>",
      "Filter history to one sender profile ID (repeatable)",
      collectRepeatedOptionValue,
      []
    )
    .option(
      "--kind <text|status|system_notice>",
      "Filter history to one public signal kind (repeatable)",
      (value: string, previous: readonly SpaceHistoryKindOption[] = []) => {
        return [
          ...previous,
          parseSpaceHistoryKindOption(value),
        ] as SpaceHistoryKindOption[];
      },
      []
    )
    .option(
      "--brief",
      "Print compact message-only JSON for quick agent checks",
      false
    )
    .option("--json", "Print raw JSON envelopes (ndjson)", false)
    .option("--raw-stream", AGENT_RAW_STREAM_OPTION_DESCRIPTION, false)
    .option("--password <value>", "Space password for protected access")
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const spaceValue = String(space ?? "").trim();
  const outputView = await resolveEffectiveViewForOutput();
  if (!spaceValue) {
    if (outputView === "agent") {
      throw createSpaceSubcommandTargetGuideError("history");
    }
    throw new Error(
      "missing required 'space' argument for openmeld space history"
    );
  }
  const target = resolveSpaceReadCommandTarget({
    baseUrl: cliOptions.gatewayUrl,
    profile: cliOptions.profile,
    space: spaceValue,
  });

  const limit = parseNonNegativeIntegerOption(opts.limit, "limit");
  const beforeCount = parseNonNegativeIntegerOption(opts.before, "before");
  const afterCount = parseNonNegativeIntegerOption(opts.after, "after");
  if (typeof opts.aroundSignal === "string" && opts.limit !== undefined) {
    throw new Error("--around-signal cannot be combined with --limit");
  }
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "history"],
    view,
    profile: target.profile,
    gatewayUrl: target.baseUrl,
    run: async () => {
      await runSpaceHistory({
        profile: target.profile,
        baseUrl: target.baseUrl,
        space: target.space,
        password: cliOptions.password,
        limit: limit ?? 20,
        brief: Boolean(opts.brief),
        json: Boolean(opts.json),
        rawStream: opts.rawStream === true,
        afterSignalId: opts.afterSignal,
        aroundSignalId: opts.aroundSignal,
        beforeCount,
        afterCount,
        fromProfileIds: opts.fromProfile,
        kinds: opts.kind,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("thread")
    .description("Read a thread's nested replies by thread ID.")
    .argument("[space]", "Space ID (64-character hex)")
    .argument("[thread]", "Thread ID (thr_...)")
    .option("--password <value>", "Space password for protected access")
).action(async (space, thread, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const spaceValue = String(space ?? "").trim();
  const threadValue = String(thread ?? "").trim();
  if (!spaceValue) {
    throw createSpaceSubcommandTargetGuideError("thread");
  }
  if (!threadValue) {
    throw new Error(
      "missing required 'thread' argument for openmeld space thread"
    );
  }
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "thread"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceThread({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: spaceValue,
        threadId: threadValue,
        password: cliOptions.password,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

const spaceContractCmd = withSpaceProfileOption(
  spaceCmd
    .command("contract")
    .description("Read the current space contract.")
    .argument("[space]", "Space ID (64-character hex)")
    .option("--json", "Print canonical JSON", false)
    .option("--password <value>", "Space password for protected access")
);

spaceContractCmd.action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const spaceValue = String(space ?? "").trim();
  const outputView = await resolveEffectiveViewForOutput();
  if (!spaceValue && outputView === "agent") {
    throw createSpaceTargetGuideError("contract");
  }

  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "contract"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceContract({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: spaceValue,
        password: cliOptions.password,
        json: Boolean(opts.json),
        view,
        entryChecksHandled: true,
      });
    },
  });
});

const spaceBoardCmd = withSpaceProfileOption(
  spaceCmd
    .command("board")
    .description("Read the current Space Board.")
    .argument("<space>", "Space URL or 64-character Space ID")
    .option("--json", "Print canonical JSON", false)
    .option("--password <value>", "Space password for protected access")
);

spaceBoardCmd.action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const target = resolveSpaceReadCommandTarget({
    baseUrl: cliOptions.gatewayUrl,
    profile: cliOptions.profile,
    space: String(space).trim(),
  });

  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "board"],
    view,
    profile: target.profile,
    gatewayUrl: target.baseUrl,
    run: async () => {
      await runSpaceBoard({
        profile: target.profile,
        baseUrl: target.baseUrl,
        space: target.space,
        password: cliOptions.password,
        json: Boolean(opts.json),
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("members")
    .description("List the people and agents in a Space.")
    .argument("<space>", "Space URL or 64-character Space ID")
    .option("--json", "Print the versioned machine-readable envelope", false)
    .option(
      "--brief",
      "Print compact member identities and Core-owned Wake availability",
      false
    )
    .option(
      "--target <member>",
      "Return one exact Space member by ID, name, or mention label"
    )
    .option("--password <value>", "Space password for protected access")
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const target = resolveSpaceReadCommandTarget({
    baseUrl: cliOptions.gatewayUrl,
    profile: cliOptions.profile,
    space: String(space).trim(),
  });
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "members"],
    view,
    profile: target.profile,
    gatewayUrl: target.baseUrl,
    run: async () => {
      await runSpaceMembers({
        profile: target.profile,
        baseUrl: target.baseUrl,
        space: target.space,
        password: cliOptions.password,
        json: cliOptions.json === true,
        brief: opts.brief === true,
        target: opts.target,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceContractCmd
    .command("set")
    .description("Update the current space contract.")
    .argument("[space]", "Space ID (64-character hex)")
    .option(
      "--dispatch-policy <mode>",
      "Dispatch policy: mention_only|listen_all"
    )
    .option(
      "--publication-mode <mode>",
      "Publication mode: collaboration|transparent"
    )
    .option(
      "--allowed-actions <values>",
      "Comma-separated actions: post_message,post_status,stay_silent"
    )
    .option(
      "--result-archive-mode <mode>",
      "Result archive mode: none|space_reply_only|all_final_results"
    )
    .option("--entry-brief <mode>", "Entry Brief mode: default|none")
    .option("--dispatch-brief <mode>", "Dispatch Brief mode: default|none")
    .option("--json", "Print canonical JSON", false)
    .option("--password <value>", "Space password for protected access")
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const spaceValue = String(space ?? "").trim();
  const outputView = await resolveEffectiveViewForOutput();
  if (!spaceValue && outputView === "agent") {
    throw createSpaceContractSetGuideError();
  }

  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "contract", "set"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceContractSet({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: spaceValue,
        password: cliOptions.password,
        dispatchPolicy:
          typeof opts.dispatchPolicy === "string"
            ? opts.dispatchPolicy
            : undefined,
        publicationMode:
          typeof opts.publicationMode === "string"
            ? opts.publicationMode
            : undefined,
        allowedActions:
          typeof opts.allowedActions === "string"
            ? opts.allowedActions
            : undefined,
        resultArchiveMode:
          typeof opts.resultArchiveMode === "string"
            ? opts.resultArchiveMode
            : undefined,
        entryBrief:
          typeof opts.entryBrief === "string" ? opts.entryBrief : undefined,
        dispatchBrief:
          typeof opts.dispatchBrief === "string"
            ? opts.dispatchBrief
            : undefined,
        json: cliOptions.json === true,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

const spacePublicationCmd = spaceCmd
  .command("publication")
  .description("Manage how a Space publishes agent output.");

withSpaceProfileOption(
  spacePublicationCmd
    .command("set")
    .description("Set Space publication mode.")
    .argument("[space]", "Space ID (64-character hex)")
    .argument("[mode]", "Publication mode: collaboration|transparent")
    .option("--json", "Print canonical JSON", false)
    .option(
      "--password <value>",
      "Space password proof; required to change publication mode"
    )
).action(async (space, mode, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const spaceValue = String(space ?? "").trim();
  const publicationMode = normalizePublicationModeCliValue(
    typeof mode === "string" ? mode : undefined
  );
  const outputView = await resolveEffectiveViewForOutput();
  const hasPassword = String(cliOptions.password ?? "").trim().length > 0;
  if (
    !(spaceValue && publicationMode && hasPassword) &&
    outputView === "agent"
  ) {
    throw createSpacePublicationSetGuideError();
  }
  if (!(spaceValue && publicationMode)) {
    throw new Error(
      "missing required arguments for openmeld space publication set: <space-id> <collaboration|transparent>"
    );
  }

  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "publication", "set"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceContractSet({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: spaceValue,
        password: cliOptions.password,
        publicationMode,
        outputTitle: "Space publication mode updated:",
        json: cliOptions.json === true,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("access")
    .description(
      "Resolve whether this profile can view and participate in a Space."
    )
    .argument("[space]", "Space URL or 64-character Space ID")
    .option("--json", "Print canonical JSON", false)
    .option("--password <value>", "Space password for protected access")
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const spaceValue = String(space ?? "").trim();
  const outputView = await resolveEffectiveViewForOutput();
  if (!spaceValue && outputView === "agent") {
    throw createSpaceTargetGuideError("access");
  }
  if (!spaceValue) {
    throw new Error(
      "missing required argument for openmeld space access: <space-url-or-id>"
    );
  }
  const target = resolveSpaceEntryCommandTarget({
    baseUrl: cliOptions.gatewayUrl,
    profile: cliOptions.profile,
    space: spaceValue,
  });

  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "access"],
    view,
    profile: target.profile,
    gatewayUrl: target.baseUrl,
    jsonOutput: cliOptions.json === true,
    run: async () => {
      await runSpaceAccess({
        profile: target.profile,
        baseUrl: target.baseUrl,
        space: target.space,
        signalId: target.signalId,
        threadRootSignalId: target.threadRootSignalId,
        password: cliOptions.password,
        json: cliOptions.json === true,
        view,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("status")
    .description(
      "Read Organization visibility, link access, and current Space status."
    )
    .argument("[space]", "Space URL or 64-character Space ID")
    .option("--json", "Print canonical JSON", false)
    .option("--password <value>", "Space password for protected access")
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const spaceValue = String(space ?? "").trim();
  const outputView = await resolveEffectiveViewForOutput();
  if (!spaceValue && outputView === "agent") {
    throw createSpaceTargetGuideError("status");
  }
  const target = resolveSpaceReadCommandTarget({
    baseUrl: cliOptions.gatewayUrl,
    profile: cliOptions.profile,
    space: spaceValue,
  });

  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "status"],
    view,
    profile: target.profile,
    gatewayUrl: target.baseUrl,
    run: async () => {
      await runSpaceStatus({
        profile: target.profile,
        baseUrl: target.baseUrl,
        space: target.space,
        password: cliOptions.password,
        json: Boolean(opts.json),
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("updates")
    .description("Read formal updates after a specific signal.")
    .argument("[space]", "Space ID (64-character hex)")
    .requiredOption(
      "--after-signal <signal-id>",
      "Read updates strictly after this signal ID"
    )
    .option("--limit <n>", "Max updates to show (default: 20)", "20")
    .option("--json", "Print filtered raw signals as ndjson", false)
    .option("--password <value>", "Space password for protected access")
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const spaceValue = String(space ?? "").trim();
  const afterSignalId = String(opts.afterSignal ?? "").trim();
  const outputView = await resolveEffectiveViewForOutput();
  if (!(spaceValue && afterSignalId) && outputView === "agent") {
    throw createSpaceUpdatesGuideError();
  }

  const limit = parseNonNegativeIntegerOption(opts.limit, "limit");
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "updates"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceUpdates({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: spaceValue,
        afterSignalId,
        limit: limit ?? 20,
        password: cliOptions.password,
        json: Boolean(opts.json),
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("result")
    .description("Read one formal dispatch result scoped to this space.")
    .argument("[space]", "Space URL or 64-character Space ID")
    .option("--dispatch <dispatch-id>", "Lookup by dispatch ID")
    .option("--result-ref <result-ref>", "Lookup by dispatch result ref")
    .option("--json", "Print canonical JSON", false)
    .option("--password <value>", "Space password for protected access")
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const spaceValue = String(space ?? "").trim();
  const dispatchId = normalizeOptionalString(opts.dispatch);
  const resultRef = normalizeOptionalString(opts.resultRef);
  const selectorCount =
    Number(dispatchId !== null) + Number(resultRef !== null);
  const outputView = await resolveEffectiveViewForOutput();
  if (
    (spaceValue.length === 0 || selectorCount !== 1) &&
    outputView === "agent"
  ) {
    throw createSpaceResultGuideError();
  }

  const target = resolveSpaceReadCommandTarget({
    baseUrl: cliOptions.gatewayUrl,
    profile: cliOptions.profile,
    space: String(space ?? "").trim(),
  });

  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "result"],
    view,
    profile: target.profile,
    gatewayUrl: target.baseUrl,
    run: async () => {
      await runSpaceResult({
        profile: target.profile,
        baseUrl: target.baseUrl,
        space: target.space,
        ...(dispatchId ? { dispatchId } : {}),
        ...(resultRef ? { resultRef } : {}),
        password: cliOptions.password,
        json: Boolean(opts.json),
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("list")
    .alias("ls")
    .description(
      "List known Spaces; use --organization to discover the active Organization Space directory."
    )
    .option("--limit <n>", "Max spaces to show (default: 20)", "20")
    .option(
      "--organization",
      "List Organization discovery and self-serve joining visibility",
      false
    )
    .option("--json", "Print machine-readable JSON", false)
).action(async (opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const limit = parseNonNegativeIntegerOption(opts.limit, "limit");
  const view = getGlobalViewOption();
  if (opts.organization === true) {
    await runCommandWithEntryChecks({
      routeTokens: ["space", "list", "--organization"],
      view,
      profile: cliOptions.profile,
      gatewayUrl: cliOptions.gatewayUrl,
      jsonOutput: Boolean(opts.json),
      run: async () => {
        await runSpaceOrganizationList({
          profile: cliOptions.profile,
          baseUrl: cliOptions.gatewayUrl,
          limit: limit ?? 20,
          json: Boolean(opts.json),
          view,
          entryChecksHandled: true,
        });
      },
    });
    return;
  }
  await runCommandWithEntryChecks({
    routeTokens: ["space", "list"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceList({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        limit: limit ?? 20,
        json: Boolean(opts.json),
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceCmd
    .command("password")
    .description("Set, change, or clear a space password.")
    .argument("[space]", "Space ID (64-character hex)")
    .option("--password <value>", "New space password value")
    .option("--clear", "Clear current space password", false)
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const spaceValue = String(space ?? "").trim();
  const outputView = await resolveEffectiveViewForOutput();
  const passwordValue =
    typeof opts.password === "string" ? opts.password : undefined;
  const clearRequested = opts.clear === true ? true : undefined;
  if (
    outputView === "agent" &&
    (spaceValue.length === 0 ||
      (passwordValue === undefined && !clearRequested))
  ) {
    throw createSpaceSubcommandTargetGuideError("password");
  }
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "password"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpacePassword({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: spaceValue.length > 0 ? spaceValue : undefined,
        password: passwordValue,
        clear: clearRequested,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

program
  .command("send")
  .description("Alias for `openmeld space send`.")
  .option(
    "--new-task",
    `Start an independent task with Codex, Claude Code, or official Antigravity ACP (up to ${AGENT_PROFILE_WORK_CONCURRENCY_LIMIT} per Agent)`
  )
  .option(
    "--fork-from <signal-id>",
    "Fork a Codex or Claude Code task from its Wake request or Agent reply"
  )
  .option(
    "--continue-from <signal-id>",
    "Continue from the Agent's Wake request or reply; does not select a reply thread"
  )
  .option(
    "--task-access <mode>",
    "Extra restriction: space_context, read_only (Codex), or workspace. Omit to use Agent settings"
  )
  .option(
    "--task-workspace <mode>",
    "Working copy: isolated (private project worktree) or current; does not change task access"
  )
  .option("--project <slug>", "Project for a new code task")
  .option("--repository <url>", "Repository associated with --project")
  .argument("[text...]", "Text to send")
  .option("--profile <id>", "OpenMeld profile ID")
  .option("--base-url <url>", "OpenMeld gateway URL")
  .option("--space <space>", "Space ID (64-character hex)")
  .option("--stdin", "Read message text from stdin (EOF to finish)", false)
  .option(
    "--file <path>",
    "Share a local file in this Space message (repeatable, max 10)",
    collectRepeatedOptionValue,
    []
  )
  .option("--text-file <path>", "Read message text from a UTF-8 file")
  .option(
    "--wake <profile-id>",
    "Wake an Agent Profile; adds @name to the text (repeatable)",
    collectRepeatedOptionValue,
    []
  )
  .option(
    "--reference <profile-id>",
    "Reference an Agent Profile (repeatable)",
    collectRepeatedOptionValue,
    []
  )
  .option(
    "--mention <profile-id>",
    "Mention a Human Profile (repeatable)",
    collectRepeatedOptionValue,
    []
  )
  .option(
    "--plain",
    "Assert that this message has no recipients; text is always literal",
    false
  )
  .option("--password <value>", "Space password for protected access")
  .action(
    async (
      textParts: string[] | undefined,
      opts: {
        profile?: string;
        baseUrl?: string;
        space?: string;
        stdin?: boolean;
        newTask?: boolean;
        forkFrom?: string;
        continueFrom?: string;
        taskAccess?: string;
        taskWorkspace?: string;
        project?: string;
        repository?: string;
        file?: string[];
        textFile?: string;
        plain?: boolean;
        wake?: string[];
        reference?: string[];
        mention?: string[];
        password?: string;
      }
    ) => {
      const space = String(opts.space ?? "").trim();
      if (!space) {
        throw createSpaceAliasTargetGuideError("send");
      }
      const view = getGlobalViewOption();
      await runCommandWithEntryChecks({
        routeTokens: ["send"],
        view,
        profile: opts.profile,
        gatewayUrl: opts.baseUrl,
        run: async () => {
          const projectWork = await resolveCliProjectWork({
            baseUrl: opts.baseUrl,
            projectSlug: opts.project,
            repositoryUrl: opts.repository,
          });
          await runSpaceSend({
            profile: opts.profile,
            contextSourceSignalId: opts.forkFrom ?? opts.continueFrom,
            contextSelection: resolveSpaceTaskSelection({
              space,
              wakeTargets: opts.wake,
              newTask: opts.newTask,
              forkFrom: opts.forkFrom,
              continueFrom: opts.continueFrom,
              taskAccess: opts.taskAccess,
              taskWorkspace: opts.taskWorkspace,
              projectWork,
            }),
            baseUrl: opts.baseUrl,
            space,
            password: opts.password,
            text: Array.isArray(textParts) ? textParts.join(" ") : "",
            stdin: Boolean(opts.stdin),
            filePaths: Array.isArray(opts.file) ? opts.file.map(String) : [],
            textFile:
              typeof opts.textFile === "string" ? opts.textFile : undefined,
            plainText: opts.plain === true,
            wakeTargets: opts.wake,
            referenceTargets: opts.reference,
            mentionTargets: opts.mention,
            view,
            entryChecksHandled: true,
          });
        },
      });
    }
  );

program
  .command("tail")
  .description("Alias for `openmeld space history`.")
  .option("--profile <id>", "OpenMeld profile ID")
  .option("--base-url <url>", "OpenMeld gateway URL")
  .option("--space <space>", "Space ID (64-character hex)")
  .option("--limit <n>", "Max items (default: 20)")
  .option(
    "--after-signal <signal-id>",
    "Read history strictly after one signal"
  )
  .option(
    "--around-signal <signal-id>",
    "Read a local context window around one signal"
  )
  .option(
    "--before <n>",
    "Context items before --around-signal anchor (requires --around-signal)"
  )
  .option(
    "--after <n>",
    "Context items after --around-signal anchor (requires --around-signal)"
  )
  .option(
    "--from-profile <profile-id>",
    "Filter history to one sender profile ID (repeatable)",
    collectRepeatedOptionValue,
    []
  )
  .option(
    "--kind <text|status|system_notice>",
    "Filter history to one public signal kind (repeatable)",
    (value: string, previous: readonly SpaceHistoryKindOption[] = []) => {
      return [
        ...previous,
        parseSpaceHistoryKindOption(value),
      ] as SpaceHistoryKindOption[];
    },
    []
  )
  .option("--json", "Print raw JSON envelopes (ndjson)", false)
  .option("--raw-stream", AGENT_RAW_STREAM_OPTION_DESCRIPTION, false)
  .option("--password <value>", "Space password for protected access")
  .action(
    async (opts: {
      profile?: string;
      baseUrl?: string;
      space?: string;
      limit?: string;
      afterSignal?: string;
      aroundSignal?: string;
      before?: string;
      after?: string;
      fromProfile?: readonly string[];
      kind?: readonly SpaceHistoryKindOption[];
      json?: boolean;
      password?: string;
      rawStream?: boolean;
    }) => {
      const space = String(opts.space ?? "").trim();
      if (!space) {
        throw createSpaceAliasTargetGuideError("tail");
      }
      const limit = parseNonNegativeIntegerOption(opts.limit, "limit");
      const beforeCount = parseNonNegativeIntegerOption(opts.before, "before");
      const afterCount = parseNonNegativeIntegerOption(opts.after, "after");
      if (typeof opts.aroundSignal === "string" && opts.limit !== undefined) {
        throw new Error("--around-signal cannot be combined with --limit");
      }
      const view = getGlobalViewOption();
      await runCommandWithEntryChecks({
        routeTokens: ["tail"],
        view,
        profile: opts.profile,
        gatewayUrl: opts.baseUrl,
        run: async () => {
          await runSpaceHistory({
            profile: opts.profile,
            baseUrl: opts.baseUrl,
            space,
            password: opts.password,
            limit: limit ?? 20,
            json: Boolean(opts.json),
            rawStream: opts.rawStream === true,
            afterSignalId: opts.afterSignal,
            aroundSignalId: opts.aroundSignal,
            beforeCount,
            afterCount,
            fromProfileIds: opts.fromProfile,
            kinds: opts.kind,
            view,
            entryChecksHandled: true,
          });
        },
      });
    }
  );

const spaceGuideCmd = withSpaceProfileOption(
  spaceCmd
    .command("guide")
    .description("Read the current space guide.")
    .argument("[space]", "Space ID (64-character hex)")
    .option("--json", "Print canonical StructuredGuidePayload JSON", false)
    .option("--password <value>", "Space password for protected access")
);

spaceGuideCmd.action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const outputView = await resolveEffectiveViewForOutput();
  if (
    outputView === "agent" &&
    (typeof space !== "string" || space.trim().length === 0)
  ) {
    throw createSpaceTargetGuideError("guide");
  }
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "guide"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceGuideRead({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: String(space ?? "").trim(),
        password: cliOptions.password,
        json: cliOptions.json === true,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceGuideCmd
    .command("set")
    .description("Update the current space guide.")
    .argument("[space]", "Space ID (64-character hex)")
    .argument("<text...>", "Guide text to set")
    .option("--json", "Print canonical StructuredGuidePayload JSON", false)
    .option("--password <value>", "Space password for protected access")
).action(async (space, textParts, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const guide = Array.isArray(textParts) ? textParts.join(" ").trim() : "";
  const outputView = await resolveEffectiveViewForOutput();
  if (outputView === "agent" && String(space ?? "").trim().length === 0) {
    throw createSpaceTargetGuideError("guide");
  }
  if (guide.length === 0) {
    throw new Error("space guide text cannot be empty");
  }

  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "guide", "set"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceGuideSet({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: String(space ?? "").trim(),
        password: cliOptions.password,
        guide,
        json: cliOptions.json === true,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

withSpaceProfileOption(
  spaceGuideCmd
    .command("clear")
    .description("Clear the current space guide.")
    .argument("[space]", "Space ID (64-character hex)")
    .option("--json", "Print canonical StructuredGuidePayload JSON", false)
    .option("--password <value>", "Space password for protected access")
).action(async (space, opts, command: Command) => {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const outputView = await resolveEffectiveViewForOutput();
  if (outputView === "agent" && String(space ?? "").trim().length === 0) {
    throw createSpaceTargetGuideError("guide");
  }

  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "guide", "clear"],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await runSpaceGuideClear({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        space: String(space ?? "").trim(),
        password: cliOptions.password,
        json: cliOptions.json === true,
        view,
        entryChecksHandled: true,
      });
    },
  });
});

program
  .command("doctor")
  .description("Check your OpenMeld setup on this device.")
  .option(
    "--gateway-url <url>",
    "OpenMeld gateway URL (command line, OPENMELD_GATEWAY_URL, or saved OpenMeld settings)"
  )
  .option(
    "--profile <id>",
    "OpenMeld profile ID (defaults to your selected profile)"
  )
  .option("--repair", "Repair your OpenMeld setup when possible.")
  .action(async (opts) => {
    const view = getGlobalViewOption();
    if (
      shouldEmitAgentOverview({
        resolvedView: view === "agent" ? "agent" : "human",
      })
    ) {
      emitTopLevelCliAgentOverview("doctor");
    }
    await runCommandWithEntryChecks({
      routeTokens: ["doctor"],
      view,
      profile: opts.profile,
      gatewayUrl: opts.gatewayUrl,
      run: async () => {
        await runDoctor({
          baseUrl: opts.gatewayUrl,
          profile: opts.profile,
          view,
          repair: Boolean(opts.repair),
          agentOverviewHandled: view === "agent",
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
          profile: opts.profile,
        });
      },
    });
  });

program
  .command("whoami")
  .description("Show your sign-in and selected profile.")
  .option(
    "--profile <id>",
    "OpenMeld profile ID (defaults to your selected profile)"
  )
  .action(async (opts) => {
    const view = getGlobalViewOption();
    if (
      shouldEmitAgentOverview({
        resolvedView: view === "agent" ? "agent" : "human",
      })
    ) {
      emitTopLevelCliAgentOverview("whoami");
    }
    await runCommandWithEntryChecks({
      routeTokens: ["whoami"],
      view,
      profile: opts.profile,
      run: async () => {
        await runWhoami({
          profile: opts.profile,
          view,
          agentOverviewHandled: view === "agent",
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
          profile: opts.profile,
        });
      },
    });
  });

// Hidden from help while the MemberAgent release flag is off; running it then
// prints the not-enabled message without calling Auth.
async function runMemberAgentCommand(input: {
  routeTokens: string[];
  view?: string;
  run: () => Promise<void>;
}): Promise<void> {
  // While the flag is off, skip the sign-in entry check: the handler only
  // prints the not-enabled message and must not contact Auth first.
  if (!MEMBER_AGENTS_ENABLED) {
    await input.run();
    return;
  }
  await runCommandWithEntryChecks(input);
}

const memberAgentCmd = program
  .command("agent", { hidden: !MEMBER_AGENTS_ENABLED })
  .description("See your Agents: one per harness, with their Agent Profiles.");

memberAgentCmd
  .command("list")
  .alias("ls")
  .description(
    "List your Agents in the current organization and any unassigned Agent Profiles."
  )
  .action(async () => {
    const view = getGlobalViewOption();
    await runMemberAgentCommand({
      routeTokens: ["agent", "list"],
      view,
      run: () => runAgentList({ view }),
    });
  });

memberAgentCmd
  .command("add")
  .description(
    "Add an Agent for a harness found on your computer, such as codex."
  )
  .argument("<harness>", "Harness to add, such as claude-code or codex")
  .action(async (harness: string) => {
    const view = getGlobalViewOption();
    await runMemberAgentCommand({
      routeTokens: ["agent", "add"],
      view,
      run: () => runAgentAdd({ harness, view }),
    });
  });

memberAgentCmd
  .command("show")
  .description("Show one Agent with its Agent Profiles.")
  .argument("<agent>", "Agent ID, harness (such as codex), or Agent name")
  .action(async (memberAgent: string) => {
    const view = getGlobalViewOption();
    await runMemberAgentCommand({
      routeTokens: ["agent", "show"],
      view,
      run: () => runAgentShow({ memberAgent, view }),
    });
  });

// Agent Direct Message Sessions, behind the same MemberAgent release flag.
const sessionCmd = program
  .command("session", { hidden: !MEMBER_AGENTS_ENABLED })
  .description(
    "See and manage your Direct Message Sessions with one of your Agents."
  );

sessionCmd
  .command("list")
  .alias("ls")
  .description("List your Sessions with an Agent, grouped by Agent Profile.")
  .requiredOption(
    "--agent <agent>",
    "Agent ID, harness (such as codex), or Agent name"
  )
  .option("--profile <profileId>", "Only this Agent Profile's Sessions")
  .option(
    "--limit <n>",
    "Sessions per state and Profile, 1 to 100 (default 20)"
  )
  .action(async (opts: { agent: string; profile?: string; limit?: string }) => {
    const view = getGlobalViewOption();
    await runMemberAgentCommand({
      routeTokens: ["session", "list"],
      view,
      run: () =>
        runSessionList({
          memberAgent: opts.agent,
          ...(opts.profile === undefined ? {} : { profile: opts.profile }),
          ...(opts.limit === undefined ? {} : { limit: opts.limit }),
          view,
        }),
    });
  });

sessionCmd
  .command("rename")
  .description("Rename one of your Sessions.")
  .argument("<spaceId>", "Session ID (its Direct Message Space ID)")
  .argument("<title>", "New Session title")
  .action(async (spaceId: string, title: string) => {
    const view = getGlobalViewOption();
    await runMemberAgentCommand({
      routeTokens: ["session", "rename"],
      view,
      run: () => runSessionRename({ spaceId, title, view }),
    });
  });

sessionCmd
  .command("archive")
  .description("Archive one of your Sessions. Restore it at any time.")
  .argument("<spaceId>", "Session ID (its Direct Message Space ID)")
  .action(async (spaceId: string) => {
    const view = getGlobalViewOption();
    await runMemberAgentCommand({
      routeTokens: ["session", "archive"],
      view,
      run: () => runSessionArchive({ spaceId, view }),
    });
  });

sessionCmd
  .command("restore")
  .description("Restore one of your archived Sessions.")
  .argument("<spaceId>", "Session ID (its Direct Message Space ID)")
  .action(async (spaceId: string) => {
    const view = getGlobalViewOption();
    await runMemberAgentCommand({
      routeTokens: ["session", "restore"],
      view,
      run: () => runSessionRestore({ spaceId, view }),
    });
  });

sessionCmd
  .command("delete")
  .description("Permanently delete one of your Sessions and its messages.")
  .argument("<spaceId>", "Session ID (its Direct Message Space ID)")
  .option("-y, --yes", "Delete without asking (required in Agent View)")
  .action(async (spaceId: string, opts: { yes?: boolean }) => {
    const view = getGlobalViewOption();
    await runMemberAgentCommand({
      routeTokens: ["session", "delete"],
      view,
      run: () => runSessionDelete({ spaceId, yes: opts.yes === true, view }),
    });
  });

const profileCmd = program
  .command("profiles")
  .alias("profile")
  .description("Manage OpenMeld profiles.");

profileCmd
  .command("execution-mode")
  .description(
    "Read or change independent-task admission for an Agent Profile."
  )
  .argument("<profile>", "Agent Profile ID")
  .option(
    "--mode <mode>",
    "parallel or serial; serial lets existing tasks finish"
  )
  .action(async (profile: string, options: { mode?: string }) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["profile", "execution-mode"],
      view,
      run: () => runProfileExecutionMode({ profile, mode: options.mode, view }),
    });
  });

profileCmd.action(async () => {
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["profile"],
    view,
    run: async () => {
      await runProfileMenu({
        view,
        entryChecksHandled: true,
      });
    },
  });
});

profileCmd
  .command("create")
  .description(
    "Create an Agent Profile, or an additional Human Profile when enabled."
  )
  .argument("[profileName]", "OpenMeld profile name")
  .option("--name <profileName>", "OpenMeld profile name")
  .option(
    "--kind <kind>",
    "Profile kind (agent; human when additional Human Profile creation is enabled)"
  )
  .option(
    "--agent-controller <ref>",
    "Agent controller for this profile, such as builtin:codex or custom:reviewer"
  )
  .option(
    "--agent-controller-conversation-id <id>",
    "Legacy direct-create conversation ID; for requests use --session resume --native-session"
  )
  .option("--model <modelId>", "Model intent for this Agent Profile Binding")
  .option(
    "--reasoning-effort <level>",
    "Reasoning effort intent for the selected model"
  )
  .option(
    "--agent-controller-permission-mode <policy>",
    formatAgentControllerPermissionModeHelp()
  )
  .option(
    "--agent-controller-collaboration-mode <mode>",
    "Collaboration mode for this Agent Controller, such as codex:default or codex:plan"
  )
  .option(
    "--open-code-permission <json>",
    "OpenCode permission configuration as a JSON object"
  )
  .option(
    "--confirm-dangerous-agent-controller-permission-mode",
    "Confirm a dangerous Agent Controller Permission Mode without prompting",
    false
  )
  .addOption(
    new Option(
      "--member-agent <agent>",
      "Parent Agent (ID or harness); the new Profile must use its harness"
    ).hideHelp(!MEMBER_AGENTS_ENABLED)
  )
  .option(
    "--owner <userId>",
    "Agent owner: self (creating for other members is not available)"
  )
  .option(
    "--computer <computerId>",
    "Exact computerId from `openmeld org computers --view agent`"
  )
  .option("--project <projectId>", "Default Project for the new Agent")
  .option(
    "--shared-conversation <id>",
    "Connect an existing shared Bot conversation"
  )
  .option(
    "--acknowledge-shared-conversation",
    "Acknowledge shared messages and stopping the Bot's current work",
    false
  )
  .option(
    "--no-default-project",
    "Let OpenMeld choose the working folder instead of reusing your saved Default Project"
  )
  .option(
    "--session <strategy>",
    "Session strategy for an owner request: new, resume, or fork",
    "new"
  )
  .option(
    "--native-session <id>",
    "Native provider Session ID required for resume or fork"
  )
  .option("--space <spaceId>", "Add the created Agent to this Space")
  .option("--source <source>", "Request source: cli or local-agent", "cli")
  .option(
    "--request-key <key>",
    "Stable idempotency key for safely retrying an owner request"
  )
  .option(
    "--organization <slugOrId>",
    "Organization slug or ID; defaults to the current Organization"
  )
  .action(async (profileName, opts) => {
    const outputView = await resolveEffectiveViewForOutput();
    const targetName =
      (typeof profileName === "string" ? profileName : undefined) ?? opts.name;
    if (outputView === "agent") {
      if (
        typeof opts.kind !== "string" ||
        opts.kind.trim().toLowerCase() !== "agent"
      ) {
        throw createProfileCreateGuideError(
          "agent view can only create agent profiles; pass --kind agent."
        );
      }
      if (typeof targetName !== "string" || targetName.trim().length === 0) {
        throw createProfileCreateGuideError(
          "explicit profile name is required in agent view."
        );
      }
    }
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["profile", "create"],
      view,
      run: async () => {
        if (!(await applyProfileCreateMemberAgent(opts, view))) {
          return;
        }
        const usesCreationRequest = shouldUseProfileCreationRequest(opts);
        assertSupportedProfileCreationRequestSessionInput({
          agentControllerConversationId: opts.agentControllerConversationId,
          usesCreationRequest,
        });
        if (usesCreationRequest) {
          if (
            typeof opts.kind === "string" &&
            opts.kind.trim().toLowerCase() !== "agent"
          ) {
            throw createProfileCreateGuideError(
              "--owner can only create an Agent Profile; pass --kind agent."
            );
          }
          await runProfileCreationRequestCreate({
            agentController: opts.agentController,
            agentControllerCollaborationMode:
              opts.agentControllerCollaborationMode,
            agentControllerPermissionModeInput:
              opts.agentControllerPermissionMode,
            confirmDangerousAgentControllerPermissionMode: Boolean(
              opts.confirmDangerousAgentControllerPermissionMode
            ),
            defaultProjectId: opts.project,
            idempotencyKey: opts.requestKey,
            modelId: opts.model,
            openCodePermissionInput: opts.openCodePermission,
            nativeSessionId: opts.nativeSession,
            sharedConversationId: opts.sharedConversation,
            acknowledgeSharedConversation: opts.acknowledgeSharedConversation,
            organization: opts.organization,
            profileName: targetName,
            reasoningLevel: opts.reasoningEffort,
            ...(opts.defaultProject === false
              ? { reuseSavedDefaultProject: false }
              : {}),
            requestedSpaceId: opts.space,
            sessionStrategy: opts.session,
            source: opts.source,
            targetComputerId: opts.computer,
            targetOwner: typeof opts.owner === "string" ? opts.owner : "self",
            view,
          });
          return;
        }
        await runProfileCreate({
          profileName: targetName,
          kind: opts.kind,
          agentController: opts.agentController,
          agentControllerConversationId: opts.agentControllerConversationId,
          agentControllerPermissionModeInput:
            typeof opts.agentControllerPermissionMode === "string"
              ? opts.agentControllerPermissionMode
              : undefined,
          confirmDangerousAgentControllerPermissionMode: Boolean(
            opts.confirmDangerousAgentControllerPermissionMode
          ),
          model: typeof opts.model === "string" ? opts.model : undefined,
          reasoningEffort:
            typeof opts.reasoningEffort === "string"
              ? opts.reasoningEffort
              : undefined,
          view,
          entryChecksHandled: true,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

// Resolves `--member-agent` into the Agent Controller to create with. Returns
// false when creation was refused and the reason was already reported.
async function applyProfileCreateMemberAgent(
  opts: {
    agentController?: string;
    memberAgent?: unknown;
    organization?: unknown;
  },
  view: string | undefined
): Promise<boolean> {
  if (typeof opts.memberAgent !== "string") {
    return true;
  }
  const agentController = await resolveProfileCreateMemberAgentController({
    agentController: opts.agentController,
    memberAgent: opts.memberAgent,
    ...(typeof opts.organization === "string"
      ? { organization: opts.organization }
      : {}),
    view,
  });
  if (!agentController) {
    return false;
  }
  opts.agentController = agentController;
  return true;
}

function shouldUseProfileCreationRequest(input: {
  agentController?: unknown;
  agentControllerCollaborationMode?: unknown;
  computer?: unknown;
  defaultProject?: unknown;
  nativeSession?: unknown;
  sharedConversation?: unknown;
  openCodePermission?: unknown;
  organization?: unknown;
  owner?: unknown;
  project?: unknown;
  session?: unknown;
  space?: unknown;
}): boolean {
  return (
    input.agentController === HOSTED_REMOTE_AGENT_CONTROLLER_REF ||
    typeof input.owner === "string" ||
    typeof input.computer === "string" ||
    typeof input.project === "string" ||
    input.defaultProject === false ||
    typeof input.space === "string" ||
    typeof input.organization === "string" ||
    typeof input.agentControllerCollaborationMode === "string" ||
    typeof input.openCodePermission === "string" ||
    typeof input.nativeSession === "string" ||
    typeof input.sharedConversation === "string" ||
    input.session !== "new"
  );
}

function assertSupportedProfileCreationRequestSessionInput(input: {
  agentControllerConversationId?: unknown;
  usesCreationRequest: boolean;
}): void {
  if (
    input.usesCreationRequest &&
    typeof input.agentControllerConversationId === "string"
  ) {
    throw createProfileCreateGuideError(
      "--agent-controller-conversation-id cannot be combined with owner-request options because that legacy flag would lose the requested session. Use --session resume --native-session <id> instead."
    );
  }
}

profileCmd
  .command("current-session")
  .description(
    "Find the Agent Profile bound to this exact local Agent session without scanning profiles."
  )
  .option("--provider <provider>", "Provider: codex or claude-code")
  .option("--native-session <id>", "Exact provider thread or session ID")
  .action(async (opts) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["profile", "current-session"],
      view,
      run: async () => {
        await runProfileCurrentSession({
          nativeSessionId: opts.nativeSession,
          provider: opts.provider,
          view,
        });
      },
    });
  });

profileCmd
  .command("list")
  .alias("ls")
  .description("List OpenMeld profiles.")
  .action(async () => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["profile", "list"],
      view,
      run: async () => {
        await runProfileList({
          view,
          entryChecksHandled: true,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
        });
      },
    });
  });

const profileRequestsCmd = profileCmd
  // Launch hold: keep exact commands for self-creation recovery and isolated
  // Request an Agent development, without advertising the unreleased product.
  .command("requests", { hidden: !TEAMMATE_AGENT_REQUESTS_ENABLED })
  .description(
    "Create and manage Organization Agent Profile creation requests."
  );

profileRequestsCmd
  .command("create")
  .description("Create an Agent Profile for yourself.")
  .argument("<profileName>", "Agent Profile name")
  .requiredOption("--owner <userId>", "Agent owner: self")
  .option(
    "--session <strategy>",
    "Session strategy: new, resume, or fork",
    "new"
  )
  .option(
    "--native-session <id>",
    "Native provider Session ID required for resume or fork"
  )
  .option("--space <spaceId>", "Intended Space to record on the request")
  .option("--source <source>", "Request source: cli or local-agent", "cli")
  .option(
    "--request-key <key>",
    "Stable idempotency key to safely retry this request"
  )
  .option(
    "--organization <slugOrId>",
    "Organization slug or ID; defaults to the current Organization"
  )
  .action(async (profileName, opts) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["profile", "requests", "create"],
      view,
      run: async () => {
        await runProfileCreationRequestCreate({
          idempotencyKey: opts.requestKey,
          nativeSessionId: opts.nativeSession,
          organization: opts.organization,
          profileName,
          requestedSpaceId: opts.space,
          sessionStrategy: opts.session,
          source: opts.source,
          targetOwner: opts.owner,
          view,
        });
      },
    });
  });

profileRequestsCmd
  .command("list")
  .alias("ls")
  .description("List Agent Profile creation requests involving you.")
  .option(
    "--organization <slugOrId>",
    "Organization slug or ID; defaults to the current Organization"
  )
  .action(async (opts) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["profile", "requests", "list"],
      view,
      run: async () => {
        await runProfileCreationRequestList({
          organization: opts.organization,
          view,
        });
      },
    });
  });

for (const decision of ["approve", "decline"] as const) {
  profileRequestsCmd
    .command(decision, { hidden: !TEAMMATE_AGENT_REQUESTS_ENABLED })
    .description(
      `${decision === "approve" ? "Approve" : "Decline"} an Agent Profile creation request for you.`
    )
    .argument("<requestId>", "Agent Profile creation request ID")
    .option(
      "--organization <slugOrId>",
      "Organization slug or ID; defaults to the current Organization"
    )
    .action(async (requestId, opts) => {
      const view = getGlobalViewOption();
      await runCommandWithEntryChecks({
        routeTokens: ["profile", "requests", decision],
        view,
        run: async () => {
          await runProfileCreationRequestDecide({
            decision,
            organization: opts.organization,
            requestId,
            view,
          });
        },
      });
    });
}

for (const action of ["cancel", "retry"] as const) {
  profileRequestsCmd
    .command(action)
    .description(
      `${action === "cancel" ? "Cancel" : "Retry"} an Agent Profile creation request.`
    )
    .argument("<requestId>", "Agent Profile creation request ID")
    .option(
      "--organization <slugOrId>",
      "Organization slug or ID; defaults to the current Organization"
    )
    .action(async (requestId, opts) => {
      const view = getGlobalViewOption();
      await runCommandWithEntryChecks({
        routeTokens: ["profile", "requests", action],
        view,
        run: async () => {
          const input = {
            organization: opts.organization,
            requestId,
            view,
          };
          if (action === "cancel") {
            await runProfileCreationRequestCancel(input);
          } else {
            await runProfileCreationRequestRetry(input);
          }
        },
      });
    });
}

const profileRequestPreferencesCmd = profileRequestsCmd
  .command("preferences", { hidden: !TEAMMATE_AGENT_REQUESTS_ENABLED })
  .description("Manage approvals for teammate Agent Profile requests.");

profileRequestPreferencesCmd
  .command("get")
  .description("Show your Agent Profile creation approval preferences.")
  .option(
    "--organization <slugOrId>",
    "Organization slug or ID; defaults to the current Organization"
  )
  .action(async (opts) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["profile", "requests", "preferences", "get"],
      view,
      run: async () => {
        await runProfileCreationRequestPreferenceGet({
          organization: opts.organization,
          view,
        });
      },
    });
  });

profileRequestPreferencesCmd
  .command("set")
  .description("Update your Agent Profile creation approval preferences.")
  .requiredOption(
    "--new-session <policy>",
    "New-session policy: never-allow, ask-every-time, or automatically-allow"
  )
  .requiredOption(
    "--existing-session <policy>",
    "Existing-session policy: never-allow, ask-every-time, or automatically-allow"
  )
  .option(
    "--organization <slugOrId>",
    "Organization slug or ID; defaults to the current Organization"
  )
  .action(async (opts) => {
    const view = getGlobalViewOption();
    await runCommandWithEntryChecks({
      routeTokens: ["profile", "requests", "preferences", "set"],
      view,
      run: async () => {
        await runProfileCreationRequestPreferenceSet({
          existingSessionPolicy: opts.existingSession,
          newSessionPolicy: opts.newSession,
          organization: opts.organization,
          view,
        });
      },
    });
  });

profileCmd
  .command("set")
  .description("Switch to a different OpenMeld profile.")
  .argument("[profile]", "OpenMeld profile ID")
  .option("--profile <id>", "OpenMeld profile ID")
  .action(async (profile, opts) => {
    const outputView = await resolveEffectiveViewForOutput();
    const view = getGlobalViewOption();
    const targetProfile =
      (typeof profile === "string" ? profile : undefined) ?? opts.profile;
    if (
      outputView === "agent" &&
      (typeof targetProfile !== "string" || targetProfile.trim().length === 0)
    ) {
      throw createProfileActionGuideError(
        "set",
        "explicit profile argument is required in agent view."
      );
    }
    await runCommandWithEntryChecks({
      routeTokens: ["profile", "set"],
      view,
      profile: targetProfile,
      run: async () => {
        await runProfileSet({
          profile: targetProfile,
          view,
          entryChecksHandled: true,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
          profile: targetProfile,
        });
      },
    });
  });

profileCmd
  .command("show")
  .description("Show one OpenMeld profile.")
  .argument("[profile]", "OpenMeld profile ID")
  .option("--profile <id>", "OpenMeld profile ID")
  .option("--details", "Print detailed Agent Profile diagnostics")
  .option("--json", "Print machine-readable JSON", false)
  .action(async (profile, opts) => {
    const view = getGlobalViewOption();
    const targetProfile =
      (typeof profile === "string" ? profile : undefined) ?? opts.profile;
    await runCommandWithEntryChecks({
      routeTokens: ["profile", "show"],
      view,
      profile: targetProfile,
      run: async () => {
        await runProfileShow({
          profile: targetProfile,
          details: Boolean(opts.details),
          json: Boolean(opts.json),
          view,
          entryChecksHandled: true,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
          profile: targetProfile,
        });
      },
    });
  });

profileCmd
  .command("update")
  .description("Update an OpenMeld profile.")
  .argument("[profile]", "OpenMeld profile ID")
  .option("--profile <id>", "OpenMeld profile ID")
  .option("--name <profileName>", "OpenMeld profile name")
  .option(
    "--agent-controller <ref>",
    "Agent controller for this profile, such as builtin:codex or custom:reviewer"
  )
  .option(
    "--agent-controller-conversation-id <id>",
    "Private Agent Controller conversation ID for this Agent Profile"
  )
  .option("--model <modelId>", "Model intent for this Agent Profile Binding")
  .option(
    "--reasoning-effort <level>",
    "Reasoning effort intent for the selected model"
  )
  .option(
    "--agent-controller-permission-mode <policy>",
    formatAgentControllerPermissionModeHelp()
  )
  .option(
    "--confirm-dangerous-agent-controller-permission-mode",
    "Confirm a dangerous Agent Controller Permission Mode without prompting",
    false
  )
  .option(
    "--workspace-mode <mode>",
    "Workspace mode for this agent profile: openmeld-managed or custom"
  )
  .option(
    "--workspace-path <path>",
    "Custom workspace folder for this agent profile"
  )
  .option("--details", "Print detailed Agent Profile diagnostics")
  .action(async (profile, opts) => {
    const outputView = await resolveEffectiveViewForOutput();
    const view = getGlobalViewOption();
    const targetProfile =
      (typeof profile === "string" ? profile : undefined) ?? opts.profile;
    if (outputView === "agent") {
      if (
        typeof targetProfile !== "string" ||
        targetProfile.trim().length === 0
      ) {
        throw createProfileActionGuideError(
          "update",
          "explicit profile argument is required in agent view."
        );
      }
      if (!hasExplicitProfileUpdateField(opts)) {
        throw createProfileActionGuideError(
          "update",
          "at least one update field is required in agent view."
        );
      }
    }
    await runCommandWithEntryChecks({
      routeTokens: ["profile", "update"],
      view,
      profile: targetProfile,
      run: async () => {
        await runProfileUpdate({
          profile: targetProfile,
          profileName: opts.name,
          agentController:
            typeof opts.agentController === "string"
              ? opts.agentController
              : undefined,
          agentControllerConversationId:
            typeof opts.agentControllerConversationId === "string"
              ? opts.agentControllerConversationId
              : undefined,
          agentControllerPermissionModeInput:
            typeof opts.agentControllerPermissionMode === "string"
              ? opts.agentControllerPermissionMode
              : undefined,
          confirmDangerousAgentControllerPermissionMode: Boolean(
            opts.confirmDangerousAgentControllerPermissionMode
          ),
          model: typeof opts.model === "string" ? opts.model : undefined,
          reasoningEffort:
            typeof opts.reasoningEffort === "string"
              ? opts.reasoningEffort
              : undefined,
          workspaceMode:
            typeof opts.workspaceMode === "string"
              ? opts.workspaceMode
              : undefined,
          workspacePath:
            typeof opts.workspacePath === "string"
              ? opts.workspacePath
              : undefined,
          details: Boolean(opts.details),
          view,
          entryChecksHandled: true,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
          profile: targetProfile,
        });
      },
    });
  });

profileCmd
  .command("delete")
  .description("Delete an OpenMeld profile.")
  .argument("[profile]", "OpenMeld profile ID")
  .option("--profile <id>", "OpenMeld profile ID")
  .option("--force", "Delete without confirmation")
  .action(async (profile, opts) => {
    const outputView = await resolveEffectiveViewForOutput();
    const view = getGlobalViewOption();
    const targetProfile =
      (typeof profile === "string" ? profile : undefined) ?? opts.profile;
    if (
      outputView === "agent" &&
      (typeof targetProfile !== "string" || targetProfile.trim().length === 0)
    ) {
      throw createProfileActionGuideError(
        "delete",
        "explicit profile argument is required in agent view."
      );
    }
    await runCommandWithEntryChecks({
      routeTokens: ["profile", "delete"],
      view,
      profile: targetProfile,
      run: async () => {
        await runProfileDelete({
          profile: targetProfile,
          force: Boolean(opts.force),
          view,
          entryChecksHandled: true,
        });
        await maybeRunAgentViewRecoveryAfterSuccess({
          view,
          profile: targetProfile,
        });
      },
    });
  });

async function maybeRunAgentViewRecoveryAfterSuccess(input: {
  view?: string;
  profile?: string;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  if (runtime.resolvedView !== "agent") {
    return;
  }
  emitAgentViewHumanRecoveryHint();
}

async function handlePreParseStandaloneCommand(
  argv: string[]
): Promise<boolean> {
  if (handleExplicitHelpCommand(argv)) {
    return true;
  }

  if (isPassiveCliQueryArgv(argv)) {
    await program.parseAsync(argv);
    return true;
  }

  if (argv.length <= 2) {
    await runRootCommand();
    return true;
  }

  if (isStandaloneViewQueryArgv(argv)) {
    await runViewCommand({
      effectiveView: await resolveEffectiveViewForOutput(),
    });
    return true;
  }

  const viewSwitch = parseStandaloneViewSwitchArgv(argv);
  if (viewSwitch) {
    await runViewCommand({
      effectiveView: await resolveEffectiveViewForOutput(),
      mode: viewSwitch,
    });
    return true;
  }

  return false;
}

async function main() {
  if (await runMacOsNativeKeychainHelperIfRequested()) {
    return;
  }
  const argv = process.argv.map((arg) => (arg === "--h" ? "--help" : arg));
  if (
    argv.length === 6 &&
    argv[2] === "computer" &&
    argv[3] === "wait-for-update" &&
    argv[4] === "--view" &&
    argv[5] === "agent"
  ) {
    const { runComputerUpdateWait } = await import(
      "./commands/computer-update-wait"
    );
    await runComputerUpdateWait();
    return;
  }
  if (
    (argv.length === 5 ||
      (argv.length === 6 && argv[5] === "--include-stopped")) &&
    argv[2] === "computer" &&
    argv[3] === "connection-review" &&
    argv[4] === "--json"
  ) {
    const { readComputerConnectionReview } = await import(
      "./commands/computer-connection-review"
    );
    outLine(
      JSON.stringify(
        await readComputerConnectionReview({
          includeStopped: argv[5] === "--include-stopped",
        })
      )
    );
    return;
  }
  // Exact read-only probes precede managed delegation and layout repair. The
  // carrier probe must describe this executable, not a newer delegated CLI.
  if (argv.length === 5 && argv[2] === "service" && argv[4] === "--json") {
    if (argv[3] === "control-carrier-capability") {
      const { readServiceControlCarrierCapability } = await import(
        "./commands/service-control-carrier-capability"
      );
      outLine(JSON.stringify(readServiceControlCarrierCapability()));
      return;
    }
    if (argv[3] === "control-capabilities") {
      const { readServiceControlCapabilities } = await import(
        "./commands/service-control-capabilities"
      );
      const capabilities = await readServiceControlCapabilities().catch(() => ({
        deviceId: null,
        start: false,
        stop: false,
      }));
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type: "service.control_capabilities",
        ...capabilities,
      });
      return;
    }
  }
  if (isDispatchSpaceActionToolServerArgv(argv)) {
    await runSpaceActionMcpServer();
    return;
  }
  if (isDispatchSpaceActionArgv(argv)) {
    await runLocalCli(argv);
    return;
  }
  if (await delegateToManagedCliIfAuthoritative(argv)) {
    return;
  }
  await runLocalCli(argv);
}

function isDispatchSpaceActionToolServerArgv(argv: readonly string[]): boolean {
  return (
    argv.length === 5 &&
    argv[2] === "space" &&
    argv[3] === "action" &&
    argv[4] === "tool-server"
  );
}

function isDispatchSpaceActionArgv(argv: readonly string[]): boolean {
  return argv[2] === "space" && argv[3] === "action";
}

async function runLocalCli(argv: string[]): Promise<void> {
  try {
    // The dispatch-owned executable records an already-authorized action.
    // It must not repair global state or switch binaries before doing so.
    // The action handler still validates the dispatch context and permissions.
    if (isDispatchSpaceActionArgv(argv)) {
      await program.parseAsync(argv);
      return;
    }
    if (isCliMetadataQueryArgv(argv)) {
      await handlePreParseStandaloneCommand(argv);
      return;
    }
    await ensureSystemLayout();
    // Account handoff owns Service recovery. Generic commands must remain
    // usable when that Service cannot start, especially install-self, upgrade
    // and diagnostics. Auth storage still isolates uncommitted credentials.

    const removedCcInputMessage = getRemovedCcCliInputMessage(argv);
    if (removedCcInputMessage) {
      throw new Error(removedCcInputMessage);
    }

    const retiredCommandMessage = resolveRetiredCliCommandMessage(argv);
    if (retiredCommandMessage) {
      throw new Error(retiredCommandMessage);
    }

    if (await handlePreParseStandaloneCommand(argv)) {
      return;
    }

    const startupOutputView = await resolveEffectiveViewForOutput();
    const [
      firstCommandToken = null,
      secondCommandToken = null,
      thirdCommandToken = null,
    ] = parseLeadingCommandTokensFromArgv(argv, 3);
    if (
      startupOutputView === "agent" &&
      argv.includes("--details") &&
      !isPassiveCliQueryArgv(argv) &&
      !argv.includes("--raw-stream") &&
      !argv.includes(UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG)
    ) {
      emitStartupAgentOverviewForCommand({
        firstCommandToken,
        secondCommandToken,
        thirdCommandToken,
      });
    }

    const explicitView = parseViewFromArgv(argv);
    const configuredView = await readConfiguredDefaultView({ argv });
    const effectiveView = explicitView ?? configuredView;

    if (await shouldPrintTagline(argv, effectiveView)) {
      outLine(renderOpenMeldTagline());
      outLine("");
    }

    await program.parseAsync(argv);
  } catch (err) {
    if (handleKnownOutputError(err)) {
      return;
    }
    const effectiveView = await resolveEffectiveViewForError(argv);
    const message = err instanceof Error ? err.message : String(err);
    const code = resolveCliErrorCode({
      defaultCode: "cli.error",
      message,
      error: err,
    });
    const normalizedMessage = stripCliErrorCodePrefix(message, code);

    if (hasJsonOutputArgv(argv)) {
      emitCliErrorJson({
        code,
        message: normalizedMessage,
        requestId: readCliErrorRequestId(err),
      });
      process.exitCode = 1;
      return;
    }

    await emitCliError({
      argv,
      effectiveView,
      code,
      message: normalizedMessage,
      error: err,
    });
    emitHelpfulHints({ argv, effectiveView, message, error: err });
    process.exitCode = 1;
  }
}

function handleKnownOutputError(error: unknown): boolean {
  if (isCliOutputHandledError(error) || isUpgradeOutputHandledError(error)) {
    process.exitCode = 1;
    return true;
  }
  if (!isSpaceCommandOutputHandledError(error)) {
    return false;
  }
  if (error.shouldPrintMessage && error.message.trim()) {
    errLine(error.message);
  }
  process.exitCode = 1;
  return true;
}

async function runRootCommand(): Promise<void> {
  const jsonOutput = hasJsonOutputArgv(process.argv);
  const runtime = await resolveRuntimeContext();
  const presenter = jsonOutput
    ? createSilentPresenter(runtime.resolvedView)
    : createPresenter(runtime);
  const environmentTarget = await resolveOpenMeldEnvironmentTarget();

  if (runtime.resolvedView === "agent") {
    emitTopLevelAgentOverview({
      presenter,
      command: "root",
    });
  }

  startCurrentCommandCheckScope();
  try {
    const result = await runCommandEntryFlow({
      entryName: "root",
      argv: process.argv,
      runtime,
      presenter,
      allowPrompt: runtime.interactive,
      environmentTarget,
      gatewayUrl: null,
      profileArg: null,
      jsonOutput,
    });
    if (
      applyEntryCheckResult({ result, jsonOutput }) &&
      runtime.resolvedView !== "agent"
    ) {
      printOpenMeldBanner();
    }
  } finally {
    finishCurrentCommandCheckScope();
  }
}

async function delegateToManagedCliIfAuthoritative(
  argv: string[]
): Promise<boolean> {
  const delegation = await resolveManagedCliDelegation({
    argv,
    currentVersion: OPENMELD_VERSION,
    distribution: resolveOpenMeldDistribution(),
  });
  if (delegation.status !== "delegate") {
    return false;
  }
  process.exitCode = await runManagedCliDelegation(delegation);
  return true;
}

async function shouldPrintTagline(
  argv: string[],
  effectiveView: "auto" | "human" | "agent"
): Promise<boolean> {
  if (hasJsonOutputArgv(argv)) {
    return false;
  }

  const resolvedView =
    effectiveView === "auto"
      ? (await resolveRuntimeContext({ view: "auto" })).resolvedView
      : effectiveView;

  if (resolvedView === "agent") {
    return false;
  }

  const [firstCommand] = parseLeadingCommandTokensFromArgv(argv, 2);
  if (firstCommand === "setup") {
    return false;
  }

  const token = firstCommand;
  if (!token) {
    return false;
  }
  return TAGLINE_COMMANDS.has(token);
}

function handleExplicitHelpCommand(argv: string[]): boolean {
  const args = stripViewArgs(argv.slice(2));
  if (args.length === 0 || args[0] !== "help") {
    return false;
  }

  const targetTokens = parseHelpTargetTokens(args.slice(1));
  const explicitView = parseViewFromArgv(argv, { allowMissingValue: true });
  const effectiveView = explicitView === "agent" ? "agent" : "human";
  if (targetTokens.length === 0) {
    if (effectiveView === "agent") {
      emitTopLevelCliAgentOverview("root");
      return true;
    }
    program.outputHelp();
    return true;
  }

  const targetCommand = resolveHelpCommandTarget(program, targetTokens);
  if (!targetCommand) {
    throw new Error(`unknown help target: ${targetTokens.join(" ")}`);
  }
  if (
    effectiveView === "agent" &&
    emitStartupAgentOverviewForCommand({
      firstCommandToken: targetTokens[0] ?? null,
      secondCommandToken: targetTokens[1] ?? null,
      thirdCommandToken: targetTokens[2] ?? null,
    })
  ) {
    return true;
  }
  targetCommand.outputHelp();
  return true;
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  errLine(message);
  process.exitCode = 1;
});

import { runAgentActivityHistory } from "./agent-activity/command";
import { registerPluginCommands } from "./plugins/registration";
import {
  resolveCliProjectWork,
  resolveSpaceTaskSelection,
} from "./space/send-input";
