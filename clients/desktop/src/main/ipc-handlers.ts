import type { CliCommandResult } from "../shared/types";
import type {
  AgentsView,
  AuthSignOutView,
  AuthView,
  CliProblem,
  DesktopSettingsProblem,
  DesktopSettingsView,
  DesktopUpdateView,
  ServiceAutoStartUpdateView,
  ServiceView,
} from "../shared/view-types";
import { readAuthStatus, runSignIn, runSignOut } from "./cli/auth";
import {
  type CommandDeps,
  cliVersionStatus,
  detectAgents,
  disableAgents,
  disableServiceAutoStart,
  enableAgents,
  enableServiceAutoStart,
  installCli,
  installService,
  listAgents,
  serviceStatus,
  showAgent,
  startService,
  stopService,
  upgradeCli,
} from "./cli/commands";
import { readOpenMeldCliSetupProblem } from "./cli/install-cli";
import { runSetup, type SetupResult } from "./cli/setup";
import {
  resolveDesktopDownloadPageUrl,
  resolveDesktopWebUrl,
  resolveNodeDownloadUrl,
} from "./desktop-environment";
import { toAgentsView, toServiceView } from "./state/view-state";

type AuthReader = (deps?: CommandDeps) => Promise<AuthView>;
type AuthSignOutRunner = (
  deps?: CommandDeps
) => Promise<AuthSignOutView["logout"]>;
type SetupRunner = (deps?: CommandDeps) => Promise<SetupResult>;
type DesktopUpdateStatusReader = () => Promise<DesktopUpdateView>;
type DesktopDownloadPageOpener = () => Promise<void>;

export type DesktopCommandSet = {
  serviceStatus(deps?: CommandDeps): Promise<CliCommandResult>;
  installService(deps?: CommandDeps): Promise<CliCommandResult>;
  installCli(deps?: CommandDeps): Promise<CliCommandResult>;
  startService(deps?: CommandDeps): Promise<CliCommandResult>;
  stopService(deps?: CommandDeps): Promise<CliCommandResult>;
  upgradeCli(deps?: CommandDeps): Promise<CliCommandResult>;
  enableServiceAutoStart(deps?: CommandDeps): Promise<CliCommandResult>;
  disableServiceAutoStart(deps?: CommandDeps): Promise<CliCommandResult>;
  cliVersionStatus(deps?: CommandDeps): Promise<ServiceView["cliVersion"]>;
  detectAgents(deps?: CommandDeps): Promise<CliCommandResult>;
  listAgents(deps?: CommandDeps): Promise<CliCommandResult>;
  showAgent(agentId: string, deps?: CommandDeps): Promise<CliCommandResult>;
  enableAgents(
    input: { agentIds: readonly string[] },
    deps?: CommandDeps
  ): Promise<CliCommandResult>;
  disableAgents(
    input: { agentIds: readonly string[] },
    deps?: CommandDeps
  ): Promise<CliCommandResult>;
};

export type DesktopHandlers = {
  getAuthStatus(): Promise<AuthView>;
  signIn(): Promise<AuthView>;
  signOutOnThisMac(): Promise<AuthSignOutView>;
  getServiceStatus(): Promise<ServiceView>;
  installService(): Promise<ServiceView>;
  installCli(): Promise<ServiceView>;
  updateService(): Promise<ServiceView>;
  startService(): Promise<ServiceView>;
  stopService(): Promise<ServiceView>;
  upgradeCli(): Promise<ServiceView>;
  setServiceAutoStart(enabled: boolean): Promise<ServiceAutoStartUpdateView>;
  setupComputer(): Promise<ServiceView>;
  getAgents(): Promise<AgentsView>;
  setAgentEnabled(agentId: string, enabled: boolean): Promise<AgentsView>;
  openWeb(path?: string): Promise<void>;
  openNodeDownloadPage(): Promise<void>;
  getDesktopSettings(): Promise<DesktopSettingsView>;
  setOpenAtLogin(enabled: boolean): Promise<DesktopSettingsView>;
  getDesktopUpdateStatus(): Promise<DesktopUpdateView>;
  openDesktopDownloadPage(): Promise<void>;
};

export type DesktopHandlerDeps = {
  commands?: DesktopCommandSet;
  commandDeps?: CommandDeps;
  openExternal?: (url: string) => Promise<unknown>;
  /** Injectable auth reads for tests. */
  auth?: {
    readAuthStatus: AuthReader;
    runSignIn: AuthReader;
    runSignOut: AuthSignOutRunner;
  };
  /** Injectable setup runner for tests. */
  setup?: { runSetup: SetupRunner };
  /** Injectable Electron app preferences for tests and main-process wiring. */
  desktopSettings?: {
    getOpenAtLogin(): boolean;
    setOpenAtLogin(enabled: boolean): void | Promise<void>;
  };
  /** Injectable Desktop app update reader/opener for tests and main-process wiring. */
  desktopUpdate?: {
    getStatus: DesktopUpdateStatusReader;
    openDownloadPage: DesktopDownloadPageOpener;
  };
};

const DEFAULT_COMMANDS: DesktopCommandSet = {
  serviceStatus,
  installService,
  installCli,
  startService,
  stopService,
  upgradeCli,
  enableServiceAutoStart,
  disableServiceAutoStart,
  cliVersionStatus,
  detectAgents,
  listAgents,
  showAgent,
  enableAgents,
  disableAgents,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readRegisteredAgentIds(list: CliCommandResult): string[] {
  if (!(list.ok && Array.isArray(list.data.registrations))) {
    return [];
  }
  const ids = new Set<string>();
  for (const raw of list.data.registrations) {
    if (!isRecord(raw)) {
      continue;
    }
    const id = asString(raw.agentId) ?? asString(raw.id);
    if (id) {
      ids.add(id);
    }
  }
  return [...ids];
}

function agentDetailReadFailure(
  agentId: string,
  message: string
): CliCommandResult {
  return {
    ok: false,
    kind: "cli_error",
    error: {
      code: "desktop.agent_detail_unavailable",
      message: `${message} (${agentId})`,
    },
    exitCode: 1,
    rawStdout: "",
  };
}

export function createDesktopHandlers(
  deps: DesktopHandlerDeps = {}
): DesktopHandlers {
  const commands = deps.commands ?? DEFAULT_COMMANDS;
  const commandDeps = deps.commandDeps;
  const auth = deps.auth ?? { readAuthStatus, runSignIn, runSignOut };
  const setup = deps.setup ?? { runSetup };
  const desktopSettings = deps.desktopSettings;
  const desktopUpdate = deps.desktopUpdate ?? {
    getStatus: unavailableDesktopUpdate,
    openDownloadPage: async () => {
      await deps.openExternal?.(
        resolveDesktopDownloadPageUrl({ env: commandDeps?.env })
      );
    },
  };
  let serviceMutationQueue: Promise<void> = Promise.resolve();
  let agentMutationQueue: Promise<void> = Promise.resolve();
  let desktopSettingsQueue: Promise<void> = Promise.resolve();

  async function readServiceStatus(): Promise<ServiceView> {
    const service = toServiceView(await commands.serviceStatus(commandDeps));
    if (service.problem?.kind === "spawn_failed") {
      const setupProblem = readOpenMeldCliSetupProblem(commandDeps);
      if (setupProblem) {
        return { ...service, problem: setupProblem };
      }
    }
    if (service.problem !== null || service.cliVersion !== null) {
      return service;
    }
    const cliVersion = await commands
      .cliVersionStatus(commandDeps)
      .catch(() => null);
    return {
      ...service,
      cliVersion,
    };
  }

  async function mutateServiceAndReadStatus(
    mutation: () => Promise<CliCommandResult>
  ): Promise<ServiceView> {
    const mutationResult = await mutation();
    const service = await readServiceStatus();
    const mutationProblem = problemFromResult(mutationResult);
    return mutationProblem ? { ...service, problem: mutationProblem } : service;
  }

  async function runSetupAndReadServiceStatus(): Promise<ServiceView> {
    const result = await setup.runSetup(commandDeps);
    const service = await readServiceStatus();
    const serviceWithGuidance = result.serviceGuidance
      ? { ...service, setupGuidance: result.serviceGuidance }
      : service;
    return result.problem
      ? { ...serviceWithGuidance, problem: result.problem }
      : serviceWithGuidance;
  }

  async function updateServiceAutoStartAndReadStatus(
    mutation: () => Promise<CliCommandResult>
  ): Promise<ServiceAutoStartUpdateView> {
    const mutationResult = await mutation();
    const service = await readServiceStatus();
    return {
      service,
      problem: problemFromResult(mutationResult),
    };
  }

  async function readAgents(): Promise<AgentsView> {
    const [detect, list] = await Promise.all([
      commands.detectAgents(commandDeps),
      commands.listAgents(commandDeps),
    ]);
    const details = await readRegisteredAgentDetails(list);
    return toAgentsView(detect, list, details);
  }

  function readRegisteredAgentDetails(
    list: CliCommandResult
  ): Promise<CliCommandResult[]> {
    const agentIds = readRegisteredAgentIds(list);
    if (agentIds.length === 0) {
      return Promise.resolve([]);
    }
    return Promise.all(
      agentIds.map((agentId) =>
        commands
          .showAgent(agentId, commandDeps)
          .catch(() =>
            agentDetailReadFailure(
              agentId,
              "Desktop could not read this local agent's controller details."
            )
          )
      )
    );
  }

  function enqueueServiceMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = serviceMutationQueue.then(task, task);
    serviceMutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function enqueueAgentMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = agentMutationQueue.then(task, task);
    agentMutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function enqueueDesktopSettingsMutation<T>(
    task: () => Promise<T>
  ): Promise<T> {
    const run = desktopSettingsQueue.then(task, task);
    desktopSettingsQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function readDesktopSettings(): DesktopSettingsView {
    if (!desktopSettings) {
      return unavailableDesktopSettings();
    }
    try {
      return {
        openAtLogin: desktopSettings.getOpenAtLogin(),
        problem: null,
      };
    } catch (error) {
      return desktopSettingsProblem(error, "desktop_settings.read_failed");
    }
  }

  return {
    getAuthStatus: () => auth.readAuthStatus(commandDeps),
    signIn: () => auth.runSignIn(commandDeps),
    signOutOnThisMac: () =>
      enqueueServiceMutation(async () => {
        const logout = await auth.runSignOut(commandDeps);
        const [nextAuth, service] = await Promise.all([
          auth.readAuthStatus(commandDeps),
          readServiceStatus(),
        ]);
        return { auth: nextAuth, service, logout };
      }),
    getServiceStatus: readServiceStatus,
    installService: () =>
      enqueueServiceMutation(() =>
        mutateServiceAndReadStatus(() => commands.installService(commandDeps))
      ),
    installCli: () =>
      enqueueServiceMutation(() =>
        mutateServiceAndReadStatus(() => commands.installCli(commandDeps))
      ),
    updateService: () => enqueueServiceMutation(runSetupAndReadServiceStatus),
    startService: () =>
      enqueueServiceMutation(() =>
        mutateServiceAndReadStatus(() => commands.startService(commandDeps))
      ),
    stopService: () =>
      enqueueServiceMutation(() =>
        mutateServiceAndReadStatus(() => commands.stopService(commandDeps))
      ),
    upgradeCli: () =>
      enqueueServiceMutation(() =>
        mutateServiceAndReadStatus(() => commands.upgradeCli(commandDeps))
      ),
    setServiceAutoStart(enabled) {
      return enqueueServiceMutation(() =>
        updateServiceAutoStartAndReadStatus(() =>
          enabled
            ? commands.enableServiceAutoStart(commandDeps)
            : commands.disableServiceAutoStart(commandDeps)
        )
      );
    },
    setupComputer: () => enqueueServiceMutation(runSetupAndReadServiceStatus),
    getAgents: readAgents,
    setAgentEnabled(agentId, enabled) {
      return enqueueAgentMutation(async () => {
        const mutationResult = enabled
          ? await commands.enableAgents({ agentIds: [agentId] }, commandDeps)
          : await commands.disableAgents({ agentIds: [agentId] }, commandDeps);
        const agents = await readAgents();
        const mutationProblem = problemFromResult(mutationResult);
        return mutationProblem
          ? { ...agents, problem: mutationProblem }
          : agents;
      });
    },
    async openWeb(path) {
      await deps.openExternal?.(
        resolveDesktopWebUrl({ env: commandDeps?.env, path })
      );
    },
    async openNodeDownloadPage() {
      await deps.openExternal?.(
        resolveNodeDownloadUrl({ env: commandDeps?.env })
      );
    },
    getDesktopSettings: async () => readDesktopSettings(),
    setOpenAtLogin(enabled) {
      return enqueueDesktopSettingsMutation(async () => {
        if (!desktopSettings) {
          return unavailableDesktopSettings();
        }
        try {
          await desktopSettings.setOpenAtLogin(enabled);
          return readDesktopSettings();
        } catch (error) {
          return desktopSettingsProblem(
            error,
            "desktop_settings.update_failed"
          );
        }
      });
    },
    getDesktopUpdateStatus: () => desktopUpdate.getStatus(),
    openDesktopDownloadPage: () => desktopUpdate.openDownloadPage(),
  };
}

function problemFromResult(result: CliCommandResult): CliProblem | null {
  if (result.ok) {
    return null;
  }
  return {
    kind: result.kind,
    code: result.error.code,
    message: result.error.message,
    requestId: result.error.requestId ?? null,
  };
}

function unavailableDesktopSettings(): DesktopSettingsView {
  return {
    openAtLogin: null,
    problem: {
      code: "desktop_settings.unavailable",
      message: "Desktop preferences are unavailable in this runtime.",
    },
  };
}

function unavailableDesktopUpdate(): Promise<DesktopUpdateView> {
  return Promise.resolve({
    status: "idle",
    checked: false,
    currentVersion: null,
    latestVersion: null,
    minimumSupportedVersion: null,
    downloadPageUrl: resolveDesktopDownloadPageUrl(),
    message: null,
    macosArm64: null,
    problem: {
      code: "desktop_update.unavailable",
      message: "Desktop update checks are unavailable in this runtime.",
    },
  });
}

function desktopSettingsProblem(
  error: unknown,
  code: string
): DesktopSettingsView {
  const message = error instanceof Error ? error.message : String(error);
  const problem: DesktopSettingsProblem = {
    code,
    message,
  };
  return {
    openAtLogin: null,
    problem,
  };
}
