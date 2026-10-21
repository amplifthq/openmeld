import process from "node:process";
import type { ComputerConnectionIntent } from "@openmeld/schemas";
import type { PrepareSessionSnapshot } from "@openmeld/schemas/types";
import { getSetupFlowCopy } from "@openmeld/start";
import { ensureCommandAuthenticationOrCancel } from "../auth/command-auth";
import { getCurrentAuthOwnerUserId } from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { openMeldRootDir, resolveOpenMeldEnvPreset } from "../config/paths";
import { writePrepareSessionSetupBootstrapResult } from "../config/prepare-session-api";
import {
  appendLocalAgentsGuideUrl,
  buildLocalAgentsGuideUrl,
  buildNoLocalAgentsNoticeLines,
  confirmContinueWithoutLocalAgents,
} from "../guides/local-agents-guide-url";
import {
  resolveLocalComponentsStatus,
  writeInstalledLocalComponentsSnapshot,
} from "../local-components/manifest";
import {
  assertSelectedAgentControllerReportSubmissionsAccepted,
  type SelectedAgentControllerReportResult,
  submitSelectedAgentControllerReports,
} from "../local-service/reporting/selected-agent-controller-reporting";
import { notifyDaemonRouteCatalogChanged } from "../local-service/state/route-catalog-sync-notifier";
import { formatHarnessDisplayName } from "../member-agents/read";
import {
  addSetupSelectedMemberAgents,
  type SetupMemberAgentsResult,
} from "../member-agents/sync";
import { resolveCliSetupOnboardingPlan } from "../onboarding/cli-onboarding-plan";
import { emitSetupPlanAgentView } from "../onboarding/setup-plan-presenter";
import {
  formatOpenMeldCliCommand,
  resolveSetupFollowUpCliEntryCommand,
} from "../runtime/cli-entry-command";
import { resolveRuntimeContext } from "../runtime/context";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { createPresenter } from "../runtime/presenter/index";
import type { Presenter } from "../runtime/presenter/types";
import { resolveGatewayWebOrigin } from "../space/web-url";
import { runStartLocalAgentsEnable } from "../start-local/agents-local";
import { turnOffUnselectedLocalAgentsForSetup } from "../start-local/local-agent-choice";
import { collectStartLocalReadiness } from "../start-local/readiness";
import {
  LocalMachineFailureError,
  toRecognizedLocalMachineFailureError,
} from "../system/local-machine-recovery";
import { runDaemonServiceParticipationGate } from "../system/local-service-participation-gate";
import { runLocalStateAlignment } from "../system/local-state-alignment";
import { resolveControllingTerminalSession } from "../ui/controlling-terminal";
import { renderInfoCard } from "../ui/info-card";
import {
  emitSetupHumanHeader,
  runWithSetupProgress,
} from "../ui/setup-human-view";
import { formatTerminalHyperlink } from "../ui/terminal-hyperlink";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";
import { runAuthLogin } from "./auth";
import {
  runSetupFirstBootstrap,
  type SetupBootstrapResult,
} from "./setup-bootstrap";
import { withSetupCommandLock } from "./setup-command-lock";
import { syncLocalSetupCurrentDeviceTargetFromServiceContract } from "./setup-current-device";
import { shouldForceSetupServiceRefresh } from "./setup-force-service-refresh";
import {
  runSetupLocalAgentConnection,
  type SetupLocalAgentConnectionResult,
} from "./setup-local-agent-connection";
import { assertSetupServiceUpdateComplete } from "./setup-service-update-truth";
import { runSkillsEnsure } from "./skills";

type SetupServiceGuidance = {
  autoStartDescription: string;
  disableAutoStartCommand: string;
  statusDescription: string;
  stopCommand: string;
  stoppedLocalAgentsDescription: string;
};

type SetupHumanLocalAgentState =
  | "background_syncing"
  | "reported"
  | "none_found"
  | "skipped";

const NON_INTERACTIVE_DEFAULT_LOCAL_AGENTS_NOTICE =
  "Non-interactive: connecting all detected agents (use --local-agent to limit, or --local-agents none to skip).";

export async function runSetup(input: {
  connectionIntent?: ComputerConnectionIntent;
  agent?: string[];
  deviceCode?: string;
  humanProfile?: string;
  localAgent?: string[];
  localAgents?: string;
  ott?: string;
  profile?: string;
  resetThisComputer?: boolean;
  startSession?: string;
  view?: string;
}): Promise<void> {
  try {
    return await withSetupCommandLock({
      lockMeta: {
        command: "openmeld setup",
        path: shouldUseSetupLocalAgentConnection(input)
          ? "delegated_or_profile_setup"
          : "local_setup",
        view: input.view ?? null,
      },
      run: async () => {
        await runSetupUnlocked(input);
      },
      startSession: input.startSession,
      view: input.view,
    });
  } catch (error) {
    const localMachineFailure = toRecognizedLocalMachineFailureError({
      operation: "unknown",
      error,
    });
    throw localMachineFailure ?? error;
  }
}

async function runSetupUnlocked(input: {
  connectionIntent?: ComputerConnectionIntent;
  agent?: string[];
  deviceCode?: string;
  humanProfile?: string;
  localAgent?: string[];
  localAgents?: string;
  ott?: string;
  profile?: string;
  resetThisComputer?: boolean;
  startSession?: string;
  view?: string;
}): Promise<void> {
  await runSetupStartupLocalStateRepair();

  if (shouldUseSetupLocalAgentConnection(input)) {
    const previousExitCode = process.exitCode;
    const setupResult = await runSetupLocalAgentConnection(input);
    if (setupResult.status !== "completed") {
      return;
    }
    await emitSetupCompleteForDelegatedPath({
      view: input.view,
      path: input.startSession ? "setup_session" : "profile_connection",
      setupInput: input,
      setupResult,
    });
    // Nested Service start attempts can mark a transient failure before the
    // Prepare Session reconnects and completes. The completed setup outcome is
    // authoritative for this command, so do not leave that stale exit code
    // behind after the final success has been emitted.
    process.exitCode = previousExitCode;
    return;
  }

  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const interactive = canUseInteractivePrompts(runtime);
  const bootstrapInteractive = runtime.resolvedView === "human";
  const gatewayUrl = await resolveBaseUrl();
  const setupCopy = getSetupFlowCopy("setup");
  emitSetupHumanHeader({
    presenter,
    view: runtime.resolvedView,
  });

  await maybeLogInWithOneTimeToken({
    ott: input.ott,
    view: input.view,
  });
  const authenticated = await ensureCommandAuthenticationOrCancel({
    runtime,
    gatewayUrl,
    promptMessage: "Sign in to OpenMeld before setting up this computer.",
    allowPrompt: interactive,
  });
  if (!authenticated) {
    return;
  }

  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT canonical-setup-command
  // This is the Phase 2 local entry for humans and agents. It establishes the
  // local service session, reports local runtime capabilities, and emits the
  // setup.complete fact that follow-up Space/profile commands must use.
  const initialReadiness = await runWithSetupProgress({
    code: "setup.progress.local_agents.checking",
    completionMessage: "Local agents checked.",
    message: setupCopy.cliProgressCheckingLocalAgents,
    presenter,
    runtime,
    run: async () =>
      await collectStartLocalReadiness({
        auth: {
          status: "valid",
          email: null,
          authBaseUrl: null,
          gatewayUrl,
        },
      }),
  });
  await emitSetupPlanForAgentView({
    presenter,
    profile: input.profile,
    readiness: initialReadiness,
    view: runtime.resolvedView,
  });
  const localAgentsGuideUrl = buildLocalAgentsGuideUrl(gatewayUrl);
  const selectedLocalAgentIds = resolveSetupLocalAgentIds({
    guideUrl: localAgentsGuideUrl,
    localAgent: input.localAgent,
    localAgents: input.localAgents,
    readiness: initialReadiness,
  });
  await confirmZeroLocalAgentSetupIfNeeded({
    explicitSelection: hasExplicitLocalAgentSelection(input),
    guideUrl: localAgentsGuideUrl,
    localAgentsMode: input.localAgents,
    presenter,
    runtime,
    selectedLocalAgentIds,
  });
  emitDefaultLocalAgentsNoticeIfNeeded({
    explicitSelection: hasExplicitLocalAgentSelection(input),
    interactive,
    presenter,
    selectedLocalAgentIds,
  });

  if (selectedLocalAgentIds.length > 0) {
    assertStartLocalAgentsEnableCompleted(
      await runWithSetupProgress({
        code: "setup.progress.local_agents.enabling",
        completionMessage: "Local agents connected.",
        message: setupCopy.cliProgressConnectingLocalAgents,
        presenter,
        runtime,
        run: async () =>
          await runStartLocalAgentsEnable({
            agent: selectedLocalAgentIds,
            interactive,
            presentation: "handoff",
            view: input.view,
          }),
      })
    );
  }

  // Pass the signed-in owner so the gate's alignment check catches a real
  // account switch (and only that). A fresh login into the same account must
  // not force-reinstall a healthy running service.
  const expectedOwnerUserId = await getCurrentAuthOwnerUserId();
  const forceServiceRefresh = shouldForceSetupServiceRefresh();
  const serviceGate = await runWithSetupProgress({
    code: "setup.progress.service.starting",
    completionMessage: "Background service prepared.",
    message: setupCopy.cliProgressStartingService,
    presenter,
    runtime,
    run: async (progress) =>
      await runDaemonServiceParticipationGate({
        intent: "start",
        presenter,
        resolvedView: runtime.resolvedView,
        allowPrompt: interactive,
        autoRepair: true,
        gatewayUrl,
        forcePrompt: true,
        ...(forceServiceRefresh ? { forceRefresh: true } : {}),
        serviceProgress: progress,
        ...(expectedOwnerUserId ? { expectedOwnerUserId } : {}),
        suppressRefreshHumanResultCard: true,
        suppressStartSpinner: true,
        view: input.view,
      }),
  });
  if (serviceGate.status === "cancelled") {
    return;
  }
  if (serviceGate.status !== "aligned") {
    if (serviceGate.localMachineIssue) {
      throw new LocalMachineFailureError({
        issue: serviceGate.localMachineIssue,
      });
    }
    throw new Error(
      serviceGate.errorMessage ??
        "OpenMeld Service could not be started for setup on this computer."
    );
  }

  await assertSetupServiceUpdateComplete({ presenter });
  const openMeldServiceRuntimeIdentity =
    await syncLocalSetupCurrentDeviceTargetFromServiceContract({
      gatewayUrl,
    });
  const finalReadiness = await collectStartLocalReadiness({
    auth: {
      status: "valid",
      email: null,
      authBaseUrl: null,
      gatewayUrl,
    },
  });
  const runtimeReports = await submitSelectedAgentControllerReports({
    readiness: finalReadiness,
    localAgentIds: selectedLocalAgentIds,
  });
  assertSelectedAgentControllerReportSubmissionsAccepted(runtimeReports);

  const routeCatalogSync =
    selectedLocalAgentIds.length > 0
      ? await notifyRouteCatalogAfterSetup({
          reason: "setup_local_capabilities_reported",
        })
      : null;
  if (selectedLocalAgentIds.length > 0) {
    // Before any Agent is added: an unselected agent left on would become one.
    await turnOffUnselectedLocalAgentsForSetup({ selectedLocalAgentIds });
  }
  emitSetupMemberAgentsLine(
    presenter,
    await addSetupSelectedMemberAgents({ selectedLocalAgentIds })
  );

  await runWithSetupProgress({
    code: "setup.progress.skills.updating",
    completionMessage: "OpenMeld skills ready.",
    message: setupCopy.cliProgressUpdatingSkills,
    presenter,
    runtime,
    run: async () =>
      await ensureSetupManagedSkills({
        view: input.view,
      }),
  });
  const localComponents = await runWithSetupProgress({
    code: "setup.progress.local_components.snapshot",
    completionMessage: "Local component status saved.",
    message: "Saving local component status",
    presenter,
    runtime,
    run: async () => await finalizeLocalComponentsSetupSnapshot(),
  });
  const bootstrap = await runSetupFirstBootstrap({
    gatewayUrl,
    interactive: bootstrapInteractive,
    line: (line) => presenter.line(line),
    runtimeReports,
    selectedLocalAgentIds,
  });

  emitSetupComplete({
    bootstrap,
    gatewayUrl,
    humanLocalAgentState: resolveStandardSetupHumanLocalAgentState({
      localAgents: input.localAgents,
      selectedLocalAgentIds,
    }),
    localComponents,
    path: "local_setup",
    presenter,
    routeCatalogSync,
    openMeldServiceRuntimeIdentity,
    runtimeReports,
    selectedLocalAgentIds,
    view: runtime.resolvedView,
  });
}

function emitSetupMemberAgentsLine(
  presenter: Presenter,
  result: SetupMemberAgentsResult
): void {
  if (result.status === "skipped") {
    return;
  }
  if (result.status === "failed") {
    presenter.line({
      code: "setup.member_agents.failed",
      text: `Your Agents will finish setting up when you open OpenMeld (${result.message}).`,
    });
    return;
  }
  const added = result.createdHarnessKinds.map(formatHarnessDisplayName);
  const addable = result.addableHarnessKinds.map(formatHarnessDisplayName);
  if (added.length > 0) {
    presenter.line({
      code: "setup.member_agents.created",
      data: { harnessKinds: result.createdHarnessKinds },
      text: `Added your Agents: ${added.join(", ")}.`,
    });
  }
  if (addable.length > 0) {
    presenter.line({
      code: "setup.member_agents.addable",
      data: { harnessKinds: result.addableHarnessKinds },
      text: `Also found ${addable.join(", ")}. Add one with \`openmeld agent add <harness>\`.`,
    });
  }
}

async function runSetupStartupLocalStateRepair(): Promise<void> {
  await runLocalStateAlignment({
    mode: "repair",
  });
}

function shouldUseSetupLocalAgentConnection(input: {
  agent?: string[];
  humanProfile?: string;
  profile?: string;
  startSession?: string;
}): boolean {
  return Boolean(
    normalizeOptionalString(input.startSession) ??
      normalizeOptionalString(input.humanProfile) ??
      normalizeOptionalString(input.profile) ??
      (input.agent && input.agent.length > 0 ? "agent" : null)
  );
}

async function maybeLogInWithOneTimeToken(input: {
  ott?: string;
  view?: string;
}): Promise<void> {
  const oneTimeToken = normalizeOptionalString(input.ott);
  if (!oneTimeToken) {
    return;
  }
  const result = await runAuthLogin({
    ott: oneTimeToken,
    view: input.view,
    agentOverviewHandled: true,
  });
  if (result !== "completed") {
    throw new Error("OpenMeld sign-in was cancelled before setup ran.");
  }
}

export function resolveSetupLocalAgentIds(input: {
  guideUrl?: string;
  localAgent?: string[];
  localAgents?: string;
  readiness: Awaited<ReturnType<typeof collectStartLocalReadiness>>;
}): string[] {
  const localAgentMode = normalizeOptionalString(input.localAgents);
  const localAgentIds = [
    ...new Set(
      (input.localAgent ?? [])
        .map((agentId) => agentId.trim())
        .filter((agentId) => agentId.length > 0)
    ),
  ];

  if (localAgentMode && localAgentMode !== "all" && localAgentMode !== "none") {
    throw new Error("--local-agents must be either all or none.");
  }
  if (localAgentMode && localAgentIds.length > 0) {
    throw new Error(
      "use either --local-agents <all|none> or --local-agent <id...>, not both"
    );
  }
  if (localAgentMode === "none") {
    return [];
  }

  const selectableById = new Map(
    input.readiness.agents.candidates
      .filter(
        (candidate) =>
          candidate.lifecycleStatus !== "suspended" && candidate.selectable
      )
      .map((candidate) => [candidate.agentId, candidate])
  );
  if (localAgentIds.length > 0) {
    const missingIds = localAgentIds.filter(
      (agentId) => !selectableById.has(agentId)
    );
    if (missingIds.length > 0) {
      const selectableIds = [...selectableById.keys()];
      throw new Error(
        [
          `OpenMeld cannot set up local agent ${missingIds.join(", ")} on this computer.`,
          selectableIds.length > 0
            ? `Available local agents: ${selectableIds.join(", ")}.`
            : formatNoAvailableLocalAgentsFound(input.guideUrl),
        ].join(" ")
      );
    }
    return localAgentIds;
  }

  return [...selectableById.keys()].sort((left, right) =>
    left.localeCompare(right)
  );
}

async function confirmZeroLocalAgentSetupIfNeeded(input: {
  explicitSelection: boolean;
  guideUrl: string;
  localAgentsMode?: string;
  presenter: ReturnType<typeof createPresenter>;
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  selectedLocalAgentIds: readonly string[];
}): Promise<void> {
  if (
    input.selectedLocalAgentIds.length > 0 ||
    normalizeOptionalString(input.localAgentsMode) === "none"
  ) {
    return;
  }

  if (input.explicitSelection) {
    emitSetupNoLocalAgentsWarning(input);
    return;
  }

  const terminal =
    input.runtime.resolvedView === "human"
      ? resolveControllingTerminalSession()
      : null;
  if (!terminal) {
    emitSetupNoLocalAgentsWarning(input);
    return;
  }

  try {
    const decision = await confirmContinueWithoutLocalAgents({
      guideUrl: input.guideUrl,
      streams: terminal.streams,
    });
    if (decision === "continue") {
      return;
    }
    emitSetupNoLocalAgentsCancelled(input);
    throw new Error(
      "OpenMeld setup was cancelled before choosing local agents."
    );
  } finally {
    terminal.close();
  }
}

function emitSetupNoLocalAgentsWarning(input: {
  guideUrl: string;
  presenter: ReturnType<typeof createPresenter>;
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
}): void {
  const lines = buildNoLocalAgentsNoticeLines({ guideUrl: input.guideUrl });
  if (input.runtime.resolvedView === "human") {
    renderInfoCard({
      presenter: input.presenter,
      title: "No Local Agents Found",
      codePrefix: "setup.local_agents.none",
      rows: lines.map((line) => ({ label: "", value: line })),
      sanitize: true,
      minContentWidth: 56,
    });
    return;
  }

  for (const [index, line] of lines.entries()) {
    input.presenter.line({
      code: `setup.local_agents.none.${index + 1}`,
      text: line,
    });
  }
}

function emitSetupNoLocalAgentsCancelled(input: {
  guideUrl: string;
  presenter: ReturnType<typeof createPresenter>;
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
}): void {
  if (input.runtime.resolvedView !== "human") {
    return;
  }
  renderInfoCard({
    presenter: input.presenter,
    title: "Setup Cancelled",
    codePrefix: "setup.local_agents.cancelled",
    rows: [
      {
        label: "",
        value:
          "Install an agent CLI, then re-run the setup command from OpenMeld Web.",
      },
      { label: "", value: `Guide: ${input.guideUrl}` },
    ],
    sanitize: true,
    minContentWidth: 56,
  });
}

function formatNoAvailableLocalAgentsFound(guideUrl?: string): string {
  const message = "No available local agents were found on this computer.";
  return guideUrl ? appendLocalAgentsGuideUrl({ guideUrl, message }) : message;
}

type StartLocalAgentsEnableResult = Awaited<
  ReturnType<typeof runStartLocalAgentsEnable>
>;

function assertStartLocalAgentsEnableCompleted(
  result: StartLocalAgentsEnableResult
): void {
  if (result.status !== "completed") {
    throw new Error(
      "OpenMeld setup cannot continue until selected local agents are available on this computer."
    );
  }
  const blockingError = result.summary.errors[0] ?? null;
  if (!blockingError) {
    return;
  }
  throw new Error(
    blockingError.nextSteps?.[0]
      ? `OpenMeld could not set up ${blockingError.agentId}. Run \`${formatOpenMeldCliCommand(
          blockingError.nextSteps[0]
        )}\`, then run setup again. Detail: ${blockingError.reason}`
      : `OpenMeld could not set up ${blockingError.agentId}. Detail: ${blockingError.reason}`
  );
}

async function notifyRouteCatalogAfterSetup(input: {
  reason: string;
}): Promise<Awaited<ReturnType<typeof notifyDaemonRouteCatalogChanged>>> {
  return await notifyDaemonRouteCatalogChanged({
    reason: input.reason,
  });
}

async function emitSetupCompleteForDelegatedPath(input: {
  path: "setup_session" | "profile_connection";
  setupInput: {
    humanProfile?: string;
    localAgent?: string[];
    localAgents?: string;
    profile?: string;
    startSession?: string;
  };
  setupResult: Extract<
    SetupLocalAgentConnectionResult,
    { status: "completed" }
  >;
  view?: string;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const bootstrapInteractive = runtime.resolvedView === "human";
  const gatewayUrl = await resolveBaseUrl();
  const completionFacts = await resolveDelegatedSetupCompletionFacts({
    gatewayUrl,
    setupInput: input.setupInput,
    setupResult: input.setupResult,
  });
  if (input.path !== "setup_session") {
    await emitSetupPlanForAgentView({
      deviceStatus: completionFacts.openMeldServiceRuntimeIdentity
        ? "connected"
        : "unknown",
      presenter,
      profile: input.setupInput.profile ?? input.setupInput.humanProfile,
      view: runtime.resolvedView,
    });
  }
  const setupCopy = getSetupFlowCopy("setup");
  await runWithSetupProgress({
    code: "setup.progress.skills.updating",
    completionMessage: "OpenMeld skills ready.",
    message: setupCopy.cliProgressUpdatingSkills,
    presenter,
    run: async () =>
      await ensureSetupManagedSkills({
        view: input.view,
      }),
    runtime,
  });
  const localComponents = await runWithSetupProgress({
    code: "setup.progress.local_components.snapshot",
    completionMessage: "Local component status saved.",
    message: "Saving local component status",
    presenter,
    run: async () => await finalizeLocalComponentsSetupSnapshot(),
    runtime,
  });
  const bootstrap = await runSetupFirstBootstrap({
    gatewayUrl,
    interactive: bootstrapInteractive,
    line: (line) => presenter.line(line),
    runtimeReports: completionFacts.runtimeReports,
    selectedLocalAgentIds: completionFacts.selectedLocalAgentIds,
  });
  await recordSetupBootstrapResultForPrepareSession({
    bootstrap,
    gatewayUrl,
    setupSessionSnapshot: input.setupResult.setupSessionSnapshot,
  });
  emitSetupComplete({
    bootstrap,
    gatewayUrl,
    humanLocalAgentState: resolveDelegatedSetupHumanLocalAgentState({
      path: input.path,
      selectedLocalAgentIds: completionFacts.selectedLocalAgentIds,
      setupInput: input.setupInput,
    }),
    localComponents,
    path: input.path,
    presenter,
    routeCatalogSync: completionFacts.routeCatalogSync,
    openMeldServiceRuntimeIdentity:
      completionFacts.openMeldServiceRuntimeIdentity,
    runtimeReports: completionFacts.runtimeReports,
    selectedLocalAgentIds: completionFacts.selectedLocalAgentIds,
    view: runtime.resolvedView,
  });
}

async function recordSetupBootstrapResultForPrepareSession(input: {
  bootstrap: SetupBootstrapResult;
  gatewayUrl: string;
  setupSessionSnapshot: PrepareSessionSnapshot | null;
}): Promise<void> {
  const prepareSessionId = normalizeOptionalText(
    input.setupSessionSnapshot?.prepareSessionId
  );
  if (!prepareSessionId) {
    return;
  }

  try {
    await writePrepareSessionSetupBootstrapResult({
      baseUrl: input.gatewayUrl,
      prepareSessionId,
      setupBootstrap: input.bootstrap,
    });
  } catch (error) {
    console.warn("[openmeld.setup.bootstrap.prepare_session_record_failed]", {
      event: "cli.setup.bootstrap.prepare_session_record_failed",
      error: toErrorMessage(error),
      prepareSessionId,
      status: input.bootstrap.status,
    });
  }
}

async function resolveDelegatedSetupCompletionFacts(input: {
  gatewayUrl: string;
  setupInput: {
    localAgent?: string[];
    localAgents?: string;
    startSession?: string;
  };
  setupResult: Extract<
    SetupLocalAgentConnectionResult,
    { status: "completed" }
  >;
}): Promise<{
  routeCatalogSync: Awaited<
    ReturnType<typeof notifyDaemonRouteCatalogChanged>
  > | null;
  openMeldServiceRuntimeIdentity: {
    deviceId: string;
    runtimeLane: string;
  } | null;
  runtimeReports: readonly SelectedAgentControllerReportResult[];
  selectedLocalAgentIds: readonly string[];
}> {
  const completionFacts = input.setupResult.completionFacts;
  if (completionFacts) {
    const openMeldServiceRuntimeIdentity =
      completionFacts.openMeldServiceRuntimeIdentity &&
      !input.setupInput.startSession
        ? await syncLocalSetupCurrentDeviceTargetFromServiceContract({
            gatewayUrl: input.gatewayUrl,
          })
        : completionFacts.openMeldServiceRuntimeIdentity;
    const routeCatalogSync =
      completionFacts.runtimeReports.length > 0
        ? await notifyRouteCatalogAfterSetup({
            reason: "setup_profile_agent_controller_reported",
          })
        : null;
    return {
      routeCatalogSync,
      openMeldServiceRuntimeIdentity,
      runtimeReports: completionFacts.runtimeReports,
      selectedLocalAgentIds: completionFacts.selectedLocalAgentIds,
    };
  }

  const sessionSelectedLocalAgentIds =
    input.setupResult.setupSessionSnapshot?.selectedLocalAgentIds ?? null;

  if (
    !(
      sessionSelectedLocalAgentIds ||
      hasExplicitLocalAgentSelection(input.setupInput)
    )
  ) {
    return {
      routeCatalogSync: null,
      openMeldServiceRuntimeIdentity: null,
      runtimeReports: [],
      selectedLocalAgentIds: [],
    };
  }

  const selectedLocalAgentIds = sessionSelectedLocalAgentIds
    ? [...sessionSelectedLocalAgentIds]
    : resolveSetupLocalAgentIds({
        guideUrl: buildLocalAgentsGuideUrl(input.gatewayUrl),
        localAgent: input.setupInput.localAgent,
        localAgents: input.setupInput.localAgents,
        readiness: await collectStartLocalReadiness({
          auth: {
            status: "valid",
            email: null,
            authBaseUrl: null,
            gatewayUrl: input.gatewayUrl,
          },
        }),
      });
  const openMeldServiceRuntimeIdentity =
    resolveRuntimeIdentityFromSetupSession(
      input.setupResult.setupSessionSnapshot
    ) ??
    (await syncLocalSetupCurrentDeviceTargetFromServiceContract({
      gatewayUrl: input.gatewayUrl,
    }));
  if (selectedLocalAgentIds.length === 0) {
    return {
      routeCatalogSync: null,
      openMeldServiceRuntimeIdentity,
      runtimeReports: [],
      selectedLocalAgentIds,
    };
  }

  const finalReadiness = await collectStartLocalReadiness({
    auth: {
      status: "valid",
      email: null,
      authBaseUrl: null,
      gatewayUrl: input.gatewayUrl,
    },
  });
  const runtimeReports = await submitSelectedAgentControllerReports({
    readiness: finalReadiness,
    localAgentIds: selectedLocalAgentIds,
  });
  assertSelectedAgentControllerReportSubmissionsAccepted(runtimeReports);
  const routeCatalogSync = await notifyRouteCatalogAfterSetup({
    reason: "setup_session_capabilities_reported",
  });
  // The Connect page's selection arrives as the setup session's agents.
  // Before any Agent is added: an unselected agent left on would become one.
  await turnOffUnselectedLocalAgentsForSetup({ selectedLocalAgentIds });
  await addSetupSelectedMemberAgents({ selectedLocalAgentIds });

  return {
    routeCatalogSync,
    openMeldServiceRuntimeIdentity,
    runtimeReports,
    selectedLocalAgentIds,
  };
}

function resolveRuntimeIdentityFromSetupSession(
  snapshot: PrepareSessionSnapshot | null
): { deviceId: string; runtimeLane: string } | null {
  if (!(snapshot?.deviceId && snapshot.runtimeLane)) {
    return null;
  }
  return {
    deviceId: snapshot.deviceId,
    runtimeLane: snapshot.runtimeLane,
  };
}

function hasExplicitLocalAgentSelection(input: {
  localAgent?: string[];
  localAgents?: string;
}): boolean {
  return Boolean(
    normalizeOptionalString(input.localAgents) ??
      (input.localAgent && input.localAgent.length > 0 ? "local-agent" : null)
  );
}

function emitDefaultLocalAgentsNoticeIfNeeded(input: {
  explicitSelection: boolean;
  interactive: boolean;
  presenter: ReturnType<typeof createPresenter>;
  selectedLocalAgentIds: readonly string[];
}): void {
  if (
    input.explicitSelection ||
    input.interactive ||
    input.selectedLocalAgentIds.length === 0
  ) {
    return;
  }

  input.presenter.line({
    code: "setup.local_agents.default_all",
    text: NON_INTERACTIVE_DEFAULT_LOCAL_AGENTS_NOTICE,
  });
}

function resolveStandardSetupHumanLocalAgentState(input: {
  localAgents?: string;
  selectedLocalAgentIds: readonly string[];
}): SetupHumanLocalAgentState {
  if (input.selectedLocalAgentIds.length > 0) {
    return "reported";
  }
  return normalizeOptionalString(input.localAgents) === "none"
    ? "skipped"
    : "none_found";
}

function resolveDelegatedSetupHumanLocalAgentState(input: {
  path: "setup_session" | "profile_connection";
  selectedLocalAgentIds: readonly string[];
  setupInput: {
    localAgent?: string[];
    localAgents?: string;
  };
}): SetupHumanLocalAgentState {
  if (input.selectedLocalAgentIds.length > 0) {
    return "reported";
  }
  if (normalizeOptionalString(input.setupInput.localAgents) === "none") {
    return "skipped";
  }
  if (
    input.path === "setup_session" &&
    !hasExplicitLocalAgentSelection(input.setupInput)
  ) {
    return "background_syncing";
  }
  return "none_found";
}

function emitSetupComplete(input: {
  bootstrap: SetupBootstrapResult;
  gatewayUrl: string;
  humanLocalAgentState: SetupHumanLocalAgentState;
  localComponents: Awaited<ReturnType<typeof resolveLocalComponentsStatus>>;
  path: "local_setup" | "setup_session" | "profile_connection";
  presenter: ReturnType<typeof createPresenter>;
  routeCatalogSync: Awaited<
    ReturnType<typeof notifyDaemonRouteCatalogChanged>
  > | null;
  openMeldServiceRuntimeIdentity: {
    deviceId: string;
    runtimeLane: string;
  } | null;
  runtimeReports: readonly SelectedAgentControllerReportResult[];
  selectedLocalAgentIds: readonly string[];
  view: "human" | "agent";
}): void {
  const cliCommandPrefix = resolveSetupFollowUpCliEntryCommand();
  const setupStatus =
    input.bootstrap.status === "completed"
      ? ("completed" as const)
      : ("partial" as const);
  const nextAction =
    input.bootstrap.status === "failed"
      ? {
          command: input.bootstrap.retryCommand,
          failedStep: input.bootstrap.failedStep,
          reason: input.bootstrap.message,
        }
      : null;
  const nextCommands = [
    ...(nextAction ? [nextAction.command] : []),
    `${cliCommandPrefix} whoami --view agent`,
    `${cliCommandPrefix} service status --view agent`,
  ];
  const payload = {
    lane: resolveOpenMeldEnvPreset(),
    cliCommandPrefix,
    laneRoot: openMeldRootDir(),
    gatewayUrl: input.gatewayUrl,
    authBaseUrl: null,
    path: input.path,
    setupStatus,
    service: input.openMeldServiceRuntimeIdentity
      ? {
          deviceId: input.openMeldServiceRuntimeIdentity.deviceId,
          runtimeLane: input.openMeldServiceRuntimeIdentity.runtimeLane,
        }
      : null,
    localAgents: {
      selectedAgentIds: [...input.selectedLocalAgentIds],
      reportedCapabilities: input.runtimeReports.map((report) => ({
        agentId: report.agentId,
        agentControllerRef: report.agentControllerRef,
        status:
          report.localParticipationState === "ready"
            ? ("reported" as const)
            : ("blocked" as const),
        reasonCodes: [...report.reasonCodes],
        openMeldServiceRuntimeId:
          report.runtimeReportSubmission.openMeldServiceRuntimeId,
      })),
      spaceSetupHint: formatSetupCompleteSpaceSetupHint({
        bootstrap: input.bootstrap,
        runtimeReports: input.runtimeReports,
      }),
    },
    bootstrap: input.bootstrap,
    localComponents: input.localComponents,
    routeCatalogSync: input.routeCatalogSync,
    serviceGuidance: buildSetupServiceGuidance({ cliCommandPrefix }),
    nextAction,
    nextCommands,
    note: "Use cliCommandPrefix for every follow-up OpenMeld command from this setup. Do not switch lanes.",
  };

  if (input.view === "human") {
    emitSetupHumanCompletion(input);
    return;
  }

  input.presenter.data({
    code: "setup.complete",
    payload: buildSetupCompleteAgentPayload(payload),
  });
}

function emitSetupHumanCompletion(input: {
  bootstrap: SetupBootstrapResult;
  gatewayUrl: string;
  humanLocalAgentState: SetupHumanLocalAgentState;
  presenter: ReturnType<typeof createPresenter>;
  runtimeReports: readonly SelectedAgentControllerReportResult[];
  selectedLocalAgentIds: readonly string[];
}): void {
  const openMeldWebUrl = new URL(
    process.env.OPENMELD_SETUP_WEB_URL ||
      resolveGatewayWebOrigin(input.gatewayUrl)
  ).toString();
  const returnLine = `Continue in OpenMeld: ${openMeldWebUrl}`;
  const sections =
    input.bootstrap.status === "completed"
      ? [
          "🎉 Your computer is connected.",
          ...buildSetupHumanLocalAgentSections(input),
          returnLine,
        ]
      : [
          "⚠️ OpenMeld needs one more step.",
          "Your computer is connected, but OpenMeld could not finish preparing it.",
          `Reason: ${formatSetupHumanLine(input.bootstrap.message)}.`,
          `Next: Run ${formatOpenMeldCliCommand(input.bootstrap.retryCommand)}.`,
          returnLine,
        ];

  for (const [index, text] of joinSetupHumanCompletionSections(
    sections
  ).entries()) {
    input.presenter.line({
      code: `setup.complete.human.${index + 1}`,
      text,
    });
  }
}

function buildSetupHumanLocalAgentSections(input: {
  gatewayUrl: string;
  humanLocalAgentState: SetupHumanLocalAgentState;
  runtimeReports: readonly SelectedAgentControllerReportResult[];
  selectedLocalAgentIds: readonly string[];
}): string[] {
  if (input.humanLocalAgentState === "background_syncing") {
    return ["Local agents are syncing in the background."];
  }
  if (input.humanLocalAgentState === "skipped") {
    return ["Local agents were skipped."];
  }
  if (input.humanLocalAgentState === "none_found") {
    const guideUrl = buildLocalAgentsGuideUrl(input.gatewayUrl);
    return [
      "OpenMeld did not find a supported local agent on this computer.",
      `Install a local agent: ${formatTerminalHyperlink({
        label: guideUrl,
        url: guideUrl,
      })}`,
    ];
  }

  const readyAgentIds = new Set(
    input.runtimeReports
      .filter((report) => report.localParticipationState === "ready")
      .map((report) => report.agentId)
  );
  const readyNames = input.selectedLocalAgentIds
    .filter((agentId) => readyAgentIds.has(agentId))
    .map(formatSetupLocalAgentDisplayName);
  const attentionNames = input.selectedLocalAgentIds
    .filter((agentId) => !readyAgentIds.has(agentId))
    .map(formatSetupLocalAgentDisplayName);
  return [
    ...(readyNames.length > 0
      ? [`Local agents connected: ${readyNames.join(", ")}.`]
      : []),
    ...(attentionNames.length > 0
      ? [`Local agents need attention: ${attentionNames.join(", ")}.`]
      : []),
  ];
}

function joinSetupHumanCompletionSections(
  sections: readonly string[]
): string[] {
  return sections.flatMap((section) => ["", section]);
}

function formatSetupHumanLine(value: string): string {
  return sanitizeTerminalDisplayText(value, "single-line")
    .replaceAll(/\s+/g, " ")
    .trim();
}

async function emitSetupPlanForAgentView(input: {
  deviceStatus?: Parameters<
    typeof resolveCliSetupOnboardingPlan
  >[0]["deviceStatus"];
  presenter: ReturnType<typeof createPresenter>;
  profile?: string;
  readiness?: Parameters<typeof resolveCliSetupOnboardingPlan>[0]["readiness"];
  view: "human" | "agent";
}): Promise<void> {
  if (input.view !== "agent") {
    return;
  }

  const { facts, plan } = await resolveCliSetupOnboardingPlan({
    ...(input.deviceStatus ? { deviceStatus: input.deviceStatus } : {}),
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.readiness ? { readiness: input.readiness } : {}),
  });
  emitSetupPlanAgentView({
    facts,
    mode: "apply",
    plan,
    presenter: input.presenter,
  });
}

function buildSetupServiceGuidance(input: {
  cliCommandPrefix: string;
}): SetupServiceGuidance {
  return {
    autoStartDescription:
      "OpenMeld Service is set to start automatically when you sign in.",
    disableAutoStartCommand: `${input.cliCommandPrefix} service autostart disable`,
    statusDescription: "OpenMeld Service is running in the background.",
    stopCommand: `${input.cliCommandPrefix} service stop`,
    stoppedLocalAgentsDescription:
      "Local agents cannot be activated until OpenMeld Service starts again.",
  };
}

function buildSetupCompleteAgentPayload(input: {
  authBaseUrl: null;
  cliCommandPrefix: string;
  gatewayUrl: string;
  lane: string;
  laneRoot: string;
  bootstrap: SetupBootstrapResult;
  localAgents: {
    reportedCapabilities: Array<{
      agentId: string;
      agentControllerRef: string;
      reasonCodes: string[];
      openMeldServiceRuntimeId: string | null | undefined;
      status: "blocked" | "reported";
    }>;
    selectedAgentIds: string[];
    spaceSetupHint: string | null;
  };
  localComponents: Awaited<ReturnType<typeof resolveLocalComponentsStatus>>;
  nextAction: {
    command: string;
    failedStep: string;
    reason: string;
  } | null;
  nextCommands: string[];
  note: string;
  path: "local_setup" | "setup_session" | "profile_connection";
  routeCatalogSync: Awaited<
    ReturnType<typeof notifyDaemonRouteCatalogChanged>
  > | null;
  service: { deviceId: string; runtimeLane: string } | null;
  serviceGuidance: SetupServiceGuidance;
  setupStatus: "completed" | "partial";
}): Record<string, unknown> {
  return {
    lane: input.lane,
    cliCommandPrefix: input.cliCommandPrefix,
    laneRoot: input.laneRoot,
    gatewayUrl: input.gatewayUrl,
    authBaseUrl: input.authBaseUrl,
    path: input.path,
    setupStatus: input.setupStatus,
    service: input.service,
    localAgents: input.localAgents,
    bootstrap: input.bootstrap,
    localComponents: {
      entrypoint: input.localComponents.entrypoint,
      summaryLabel: input.localComponents.summaryLabel,
      setupAction: input.localComponents.setupAction,
      setupActionLabel: input.localComponents.setupActionLabel,
      cli: {
        status: input.localComponents.cli.status,
        packageVersion: input.localComponents.cli.packageVersion,
        latestPackageVersion:
          input.localComponents.cli.latestPackageVersion ?? null,
      },
      service: {
        status: input.localComponents.service.status,
        installedBundleVersion:
          input.localComponents.service.installedBundleVersion ?? null,
        expectedBundleVersion:
          input.localComponents.service.expectedBundleVersion ?? null,
      },
      skills: {
        status: input.localComponents.skills.status,
        targetCount: input.localComponents.skills.targetCount,
      },
    },
    routeCatalogSync: input.routeCatalogSync,
    serviceGuidance: input.serviceGuidance,
    nextAction: input.nextAction,
    nextCommands: input.nextCommands,
    note: input.note,
  };
}

async function ensureSetupManagedSkills(input: {
  view?: string;
}): Promise<void> {
  const result = await runSkillsEnsure({
    all: true,
    quiet: true,
    suppressAgentOverview: true,
    view: input.view,
  });
  if (result === "cancelled" || result === "back") {
    throw new Error("OpenMeld skills setup was cancelled.");
  }
}

async function finalizeLocalComponentsSetupSnapshot(): Promise<
  Awaited<ReturnType<typeof resolveLocalComponentsStatus>>
> {
  await writeInstalledLocalComponentsSnapshot({
    source: "setup",
  });
  return await resolveLocalComponentsStatus();
}

function formatSetupLocalAgentDisplayName(agentId: string): string {
  const knownDisplayNames: Readonly<Record<string, string>> = {
    antigravity: "Antigravity",
    "claude-code": "Claude Code",
    codex: "Codex",
    cursor: "Cursor",
    "grok-build": "Grok Build",
    openclaw: "OpenClaw",
    opencode: "OpenCode",
  };
  return (
    knownDisplayNames[agentId] ??
    agentId
      .split("-")
      .filter(Boolean)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" ")
  );
}

function formatSetupCompleteSpaceSetupHint(input: {
  bootstrap: SetupBootstrapResult;
  runtimeReports: readonly SelectedAgentControllerReportResult[];
}): string {
  if (input.bootstrap.status === "completed") {
    return "Center Agent will guide setup from OpenMeld Home";
  }
  if (input.bootstrap.status === "failed") {
    return `Bootstrap needs retry: ${input.bootstrap.failedStep}`;
  }
  return formatSetupCompleteLegacySpaceSetupHint(input.runtimeReports);
}

function formatSetupCompleteLegacySpaceSetupHint(
  runtimeReports: readonly SelectedAgentControllerReportResult[]
): string {
  if (runtimeReports.length === 0) {
    return "Choose a local agent when creating a Space";
  }
  const availableCount = runtimeReports.filter(
    (report) => report.localParticipationState === "ready"
  ).length;
  const blockedCount = runtimeReports.length - availableCount;
  if (blockedCount === 0) {
    return "Choose one detected agent to add to a Space";
  }
  if (availableCount === 0) {
    return "Resolve local-agent blockers before adding one to a Space";
  }
  return "Choose a detected agent without blockers, or resolve blockers first";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  return "Unknown error.";
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
