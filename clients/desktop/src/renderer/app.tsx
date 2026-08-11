import { Button } from "@openmeld/ui/components/button";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  DotsThreeIcon,
  GearSixIcon,
  type Icon,
  PlayIcon,
} from "@phosphor-icons/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  DesktopWindowDestination,
  OpenMeldBridge,
} from "../shared/ipc-contract";
import type {
  AuthView,
  CliProblem,
  DesktopSettingsView,
  DesktopUpdateView,
  ServiceView,
} from "../shared/view-types";
import { LOCAL_AGENTS_GUIDE_PATH } from "../shared/web-paths";
import { ConfirmDialog } from "./components/confirm-dialog";
import type { DesktopServiceActionBusy } from "./components/desktop-computer-cards";
import {
  DESKTOP_PROFILES_NAV_ITEMS,
  DesktopProfiles,
} from "./components/desktop-profiles";
import {
  DesktopSettings,
  type LocalAgentsLoadState,
} from "./components/desktop-settings";
import { DESKTOP_SETTINGS_NAV_ITEMS } from "./components/desktop-settings-nav";
import {
  type StatusWindowDestination,
  StatusWindowShell,
} from "./components/status-window-shell";
import { WindowShell } from "./components/window-shell";
import {
  ConnectedScreen,
  NeedsAttentionScreen,
  SetUpScreen,
  SignInScreen,
  StoppedScreen,
} from "./screens/screens";
import { Splash } from "./screens/splash";
import { decideScreen } from "./state/decide-screen";

const SPLASH_MIN_MS = 1500;
const SPLASH_FADE_MS = 500;
const LIVE_STATE_POLL_MS = 30_000;
const DESKTOP_UPDATE_POLL_MS = 15 * 60_000;
const UNKNOWN_AUTH: AuthView = { signedIn: null, email: null, problem: null };
const UNKNOWN_DESKTOP_SETTINGS: DesktopSettingsView = {
  openAtLogin: null,
  problem: {
    code: "desktop_settings.unavailable",
    message: "Desktop preferences are unavailable.",
  },
};
const LOADING_AGENTS: LocalAgentsLoadState = {
  status: "loading",
  view: null,
  errorMessage: null,
};

type AppProps = { bridge: OpenMeldBridge; skipSplash?: boolean };
type ServiceActionBusy =
  | "setup"
  | "install-cli"
  | "start"
  | "stop"
  | "update-cli"
  | "update-service"
  | null;
type LoadAgentsOptions = { showLoading?: boolean };
type RefreshServiceStatusOptions = { preserveSetupGuidance?: boolean };
type RefreshLiveStateOptions = LoadAgentsOptions & RefreshServiceStatusOptions;

export function App({ bridge, skipSplash = false }: AppProps) {
  const [auth, setAuth] = useState<AuthView | null>(null);
  const [service, setService] = useState<ServiceView | null>(null);
  const [agentsLoad, setAgentsLoad] =
    useState<LocalAgentsLoadState>(LOADING_AGENTS);
  const [desktopSettings, setDesktopSettings] =
    useState<DesktopSettingsView | null>(null);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateView | null>(
    null
  );
  const [activeDestination, setActiveDestination] =
    useState<StatusWindowDestination>("home");
  const [activeProfilesSectionId, setActiveProfilesSectionId] =
    useState("agent-profiles");
  const [activeSettingsSectionId, setActiveSettingsSectionId] =
    useState("general");
  const [phase, setPhase] = useState<"splash" | "leaving" | "app">(
    skipSplash ? "app" : "splash"
  );
  const [serviceActionBusy, setServiceActionBusy] =
    useState<ServiceActionBusy>(null);
  const [serviceAutoStartBusy, setServiceAutoStartBusy] = useState(false);
  const [serviceAutoStartProblem, setServiceAutoStartProblem] =
    useState<CliProblem | null>(null);
  const [signInBusy, setSignInBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutProblem, setSignOutProblem] = useState<CliProblem | null>(null);
  const [desktopSettingsBusy, setDesktopSettingsBusy] = useState(false);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const splashReady = useRef(false);
  const appEntryStarted = useRef(skipSplash);

  const loadAgents = useCallback(
    (options: LoadAgentsOptions = {}) => {
      if (options.showLoading !== false) {
        setAgentsLoad(LOADING_AGENTS);
      }
      bridge.getAgents().then(
        (view) => {
          setAgentsLoad({ status: "ready", view, errorMessage: null });
        },
        (error) => {
          setAgentsLoad({
            status: "error",
            view: null,
            errorMessage: agentLoadErrorMessage(error),
          });
        }
      );
    },
    [bridge]
  );

  const refreshAuthStatus = useCallback(() => {
    bridge.getAuthStatus().then(setAuth, () => setAuth(UNKNOWN_AUTH));
  }, [bridge]);

  const refreshServiceStatus = useCallback(
    (options: RefreshServiceStatusOptions = {}) => {
      bridge.getServiceStatus().then((next) => {
        setService((current) => mergeServiceStatus(current, next, options));
      }, noop);
    },
    [bridge]
  );

  const refreshDesktopSettings = useCallback(() => {
    bridge
      .getDesktopSettings()
      .then(setDesktopSettings, () =>
        setDesktopSettings(UNKNOWN_DESKTOP_SETTINGS)
      );
  }, [bridge]);

  const refreshDesktopUpdateStatus = useCallback(() => {
    bridge.getDesktopUpdateStatus().then(setDesktopUpdate, () => {
      setDesktopUpdate(null);
    });
  }, [bridge]);

  const refreshLiveState = useCallback(
    (options: RefreshLiveStateOptions = {}) => {
      refreshAuthStatus();
      refreshServiceStatus(options);
      loadAgents(options);
      refreshDesktopSettings();
    },
    [
      loadAgents,
      refreshAuthStatus,
      refreshDesktopSettings,
      refreshServiceStatus,
    ]
  );

  const refreshLiveStateInBackground = useCallback(() => {
    refreshLiveState({
      preserveSetupGuidance: true,
      showLoading: false,
    });
  }, [refreshLiveState]);

  const refresh = useCallback(() => {
    setServiceAutoStartProblem(null);
    setSignOutProblem(null);
    refreshLiveState({ showLoading: true });
    refreshDesktopUpdateStatus();
  }, [refreshDesktopUpdateStatus, refreshLiveState]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useVisibleRefresh({
    enabled: phase === "app",
    intervalMs: LIVE_STATE_POLL_MS,
    onRefresh: refreshLiveStateInBackground,
    refreshOnResume: true,
  });
  useVisibleRefresh({
    enabled: phase === "app",
    intervalMs: DESKTOP_UPDATE_POLL_MS,
    onRefresh: refreshDesktopUpdateStatus,
  });

  // Splash: hold for a minimum, then fade once the service status has arrived.
  useEffect(() => {
    const timer = setTimeout(() => {
      splashReady.current = true;
      setPhase((p) => (p === "splash" && service ? "leaving" : p));
    }, SPLASH_MIN_MS);
    return () => clearTimeout(timer);
  }, [service]);

  useEffect(() => {
    if (phase === "splash" && splashReady.current && service) {
      setPhase("leaving");
    }
  }, [phase, service]);

  const enterDestination = useCallback(
    (destination: DesktopWindowDestination) => {
      if (!appEntryStarted.current) {
        appEntryStarted.current = true;
        // Shrink the wide splash window down to the compact app size.
        bridge.enterApp().catch(noop);
      }
      setActiveDestination(destination);
      setPhase("app");
    },
    [bridge]
  );

  const enterApp = useCallback(() => {
    enterDestination("home");
  }, [enterDestination]);

  useEffect(() => {
    return bridge.onWindowDestinationChange((destination) => {
      enterDestination(destination);
    });
  }, [bridge, enterDestination]);

  useEffect(() => {
    if (phase !== "leaving") {
      return;
    }
    const timer = setTimeout(() => {
      enterApp();
    }, SPLASH_FADE_MS);
    return () => clearTimeout(timer);
  }, [phase, enterApp]);

  const runService = useCallback(
    (
      action: Exclude<ServiceActionBusy, null>,
      op: () => Promise<ServiceView>
    ) => {
      setServiceActionBusy(action);
      op()
        .then((next) => {
          setService(next);
          loadAgents();
        }, noop)
        .finally(() => setServiceActionBusy(null));
    },
    [loadAgents]
  );

  const onSetup = useCallback(
    () => runService("setup", () => bridge.setupComputer()),
    [bridge, runService]
  );
  const onInstallCli = useCallback(
    () => runService("install-cli", () => bridge.installCli()),
    [bridge, runService]
  );
  const onStart = useCallback(
    () => runService("start", () => bridge.startService()),
    [bridge, runService]
  );
  const onStop = useCallback(
    () => runService("stop", () => bridge.stopService()),
    [bridge, runService]
  );
  const onUpdateCli = useCallback(
    () => runService("update-cli", () => bridge.updateCli()),
    [bridge, runService]
  );
  const onUpdateService = useCallback(
    () => runService("update-service", () => bridge.updateService()),
    [bridge, runService]
  );

  const onSignIn = useCallback(() => {
    setSignInBusy(true);
    bridge
      .signIn()
      .then((next) => {
        setAuth(next);
        refresh();
      }, noop)
      .finally(() => setSignInBusy(false));
  }, [bridge, refresh]);

  const onSignOut = useCallback(() => {
    setSignOutBusy(true);
    setSignOutProblem(null);
    bridge
      .signOutOnThisMac()
      .then((next) => {
        setAuth(next.auth);
        setService(next.service);
        setSignOutProblem(next.logout.problem);
        loadAgents();
      }, noop)
      .finally(() => setSignOutBusy(false));
  }, [bridge, loadAgents]);

  const onToggleAgent = useCallback(
    (agentId: string, enabled: boolean) => {
      setBusyAgentId(agentId);
      setAgentsLoad((current) =>
        applyLocalAgentEnabledUpdate(current, agentId, enabled)
      );
      bridge
        .setAgentEnabled(agentId, enabled)
        .then(
          (view) => {
            setAgentsLoad({ status: "ready", view, errorMessage: null });
          },
          () => {
            loadAgents({ showLoading: false });
          }
        )
        .finally(() => setBusyAgentId(null));
    },
    [bridge, loadAgents]
  );

  const onOpenWeb = useCallback(() => {
    bridge.openWeb().catch(noop);
  }, [bridge]);

  const onOpenLocalAgentsGuide = useCallback(() => {
    bridge.openWeb(LOCAL_AGENTS_GUIDE_PATH).catch(noop);
  }, [bridge]);

  const onOpenDesktopDownloadPage = useCallback(() => {
    bridge.openDesktopDownloadPage().catch(noop);
  }, [bridge]);

  const onOpenNodeDownloadPage = useCallback(() => {
    bridge.openNodeDownloadPage().catch(noop);
  }, [bridge]);

  const onQuitDesktop = useCallback(() => {
    bridge.quitDesktop().catch(noop);
  }, [bridge]);

  const onOpenSettingsGeneral = useCallback(() => {
    setActiveDestination("settings");
    setActiveSettingsSectionId("general");
  }, []);

  const onSetOpenAtLogin = useCallback(
    (enabled: boolean) => {
      setDesktopSettingsBusy(true);
      bridge
        .setOpenAtLogin(enabled)
        .then(setDesktopSettings, () =>
          setDesktopSettings(UNKNOWN_DESKTOP_SETTINGS)
        )
        .finally(() => setDesktopSettingsBusy(false));
    },
    [bridge]
  );

  const onSetServiceAutoStart = useCallback(
    (enabled: boolean) => {
      setServiceAutoStartBusy(true);
      setServiceAutoStartProblem(null);
      bridge
        .setServiceAutoStart(enabled)
        .then((next) => {
          setService(next.service);
          setServiceAutoStartProblem(next.problem);
        }, noop)
        .finally(() => setServiceAutoStartBusy(false));
    },
    [bridge]
  );

  if (phase !== "app") {
    return <Splash leaving={phase === "leaving"} onGoHome={enterApp} />;
  }

  const resolvedAuth = auth ?? UNKNOWN_AUTH;
  const resolvedService = service ?? unknownService();
  const screen = decideScreen({ auth: resolvedAuth, service: resolvedService });
  const desktopServiceActionBusy = isSettingsServiceActionBusy(
    serviceActionBusy
  )
    ? serviceActionBusy
    : null;
  let destinationContent: ReactNode;

  if (activeDestination === "profiles") {
    destinationContent = (
      <DesktopProfiles
        activeSectionId={activeProfilesSectionId}
        auth={resolvedAuth}
        onOpenWeb={onOpenWeb}
        onSignIn={onSignIn}
        signInBusy={signInBusy}
      />
    );
  } else if (activeDestination === "settings") {
    destinationContent = (
      <DesktopSettings
        activeSectionId={activeSettingsSectionId}
        agentsLoad={agentsLoad}
        auth={resolvedAuth}
        busyAgentId={busyAgentId}
        desktopSettings={desktopSettings}
        desktopSettingsBusy={desktopSettingsBusy}
        onOpenLocalAgentsGuide={onOpenLocalAgentsGuide}
        onOpenWeb={onOpenWeb}
        onQuitDesktop={onQuitDesktop}
        onReconnectComputer={onSetup}
        onRetry={refresh}
        onSelectSection={setActiveSettingsSectionId}
        onSetOpenAtLogin={onSetOpenAtLogin}
        onSetServiceAutoStart={onSetServiceAutoStart}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
        onStartService={onStart}
        onStopService={onStop}
        onToggleAgent={onToggleAgent}
        service={resolvedService}
        serviceActionBusy={desktopServiceActionBusy}
        serviceAutoStartBusy={serviceAutoStartBusy}
        serviceAutoStartProblem={serviceAutoStartProblem}
        signInBusy={signInBusy}
        signOutBusy={signOutBusy}
        signOutProblem={signOutProblem}
      />
    );
  } else {
    destinationContent = (
      <div className="mx-auto flex w-full max-w-3xl flex-col px-8 pt-8 pb-10">
        {shouldShowDesktopUpdate(desktopUpdate) ? (
          <DesktopUpdateNotice
            onOpenDownloadPage={onOpenDesktopDownloadPage}
            update={desktopUpdate}
          />
        ) : null}
        <HomeScreenContent
          agentsLoad={agentsLoad}
          busyAgentId={busyAgentId}
          email={resolvedAuth.email}
          onInstallCli={onInstallCli}
          onOpenLocalAgentsGuide={onOpenLocalAgentsGuide}
          onOpenNodeDownloadPage={onOpenNodeDownloadPage}
          onRetry={refresh}
          onSetServiceAutoStart={onSetServiceAutoStart}
          onSetup={onSetup}
          onSignIn={onSignIn}
          onStart={onStart}
          onStop={onStop}
          onToggleAgent={onToggleAgent}
          onUpdateCli={onUpdateCli}
          onUpdateService={onUpdateService}
          screen={screen}
          service={resolvedService}
          serviceActionBusy={serviceActionBusy}
          serviceAutoStartBusy={serviceAutoStartBusy}
          serviceAutoStartProblem={serviceAutoStartProblem}
          serviceBusy={serviceActionBusy !== null}
          serviceControlActionBusy={desktopServiceActionBusy}
          signInBusy={signInBusy}
        />
      </div>
    );
  }

  return (
    <WindowShell variant="app">
      <StatusWindowShell
        accountLabel={resolvedAuth.email}
        activeDestination={activeDestination}
        activeProfilesSectionId={activeProfilesSectionId}
        activeSettingsSectionId={activeSettingsSectionId}
        headerActions={
          <HeaderActions
            activeDestination={activeDestination}
            onOpenSettings={onOpenSettingsGeneral}
            onOpenWeb={onOpenWeb}
            onReconnect={onSetup}
            onRetry={refresh}
            onStart={onStart}
            screen={screen}
            serviceActionBusy={serviceActionBusy}
          />
        }
        onDestinationChange={setActiveDestination}
        onProfilesSectionChange={setActiveProfilesSectionId}
        onSettingsSectionChange={setActiveSettingsSectionId}
        profilesItems={DESKTOP_PROFILES_NAV_ITEMS}
        settingsItems={DESKTOP_SETTINGS_NAV_ITEMS}
      >
        {destinationContent}
      </StatusWindowShell>
    </WindowShell>
  );
}

function applyLocalAgentEnabledUpdate(
  current: LocalAgentsLoadState,
  agentId: string,
  enabled: boolean
): LocalAgentsLoadState {
  if (current.status !== "ready") {
    return current;
  }

  let changed = false;
  const agents = current.view.agents.map((agent) => {
    if (agent.id !== agentId) {
      return agent;
    }
    changed = true;
    return {
      ...agent,
      enabled,
    };
  });

  if (!changed) {
    return current;
  }

  return {
    ...current,
    view: {
      ...current.view,
      agents,
    },
  };
}

function HeaderActions({
  activeDestination,
  onOpenSettings,
  onOpenWeb,
  onReconnect,
  onRetry,
  onStart,
  screen,
  serviceActionBusy,
}: {
  activeDestination: StatusWindowDestination;
  onOpenSettings: () => void;
  onOpenWeb: () => void;
  onReconnect: () => void;
  onRetry: () => void;
  onStart: () => void;
  screen: ReturnType<typeof decideScreen>;
  serviceActionBusy: ServiceActionBusy;
}) {
  if (activeDestination === "home") {
    return (
      <HomeActionsMenu
        onOpenSettings={onOpenSettings}
        onOpenWeb={onOpenWeb}
        onReconnect={onReconnect}
        onRetry={onRetry}
        onStart={onStart}
        screen={screen}
        serviceActionBusy={serviceActionBusy}
      />
    );
  }

  return (
    <Button onClick={onOpenWeb} size="sm">
      Open OpenMeld Web
    </Button>
  );
}

function DesktopUpdateNotice({
  onOpenDownloadPage,
  update,
}: {
  onOpenDownloadPage: () => void;
  update: DesktopUpdateView;
}) {
  const required = update.status === "required";
  const title = required
    ? "OpenMeld Desktop update required"
    : "OpenMeld Desktop update available";
  const fallbackDescription = required
    ? "Install the latest OpenMeld Desktop build to keep this app supported."
    : "A newer OpenMeld Desktop build is available.";
  const versionLine = update.latestVersion
    ? `Current ${formatVersion(update.currentVersion)} · Latest v${update.latestVersion}`
    : null;

  return (
    <div className="mb-4 border border-amber-500/25 bg-amber-500/10 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <output className="block min-w-0 space-y-1">
          <span className="block font-medium text-amber-100 text-sm">
            {title}
          </span>
          <span className="block text-amber-100/80 text-xs">
            {update.message ?? fallbackDescription}
          </span>
          {versionLine ? (
            <span className="block text-amber-100/60 text-xs">
              {versionLine}
            </span>
          ) : null}
        </output>
        <Button
          className="shrink-0"
          onClick={onOpenDownloadPage}
          size="sm"
          variant="outline"
        >
          Download Update
        </Button>
      </div>
    </div>
  );
}

function HomeActionsMenu({
  onOpenSettings,
  onOpenWeb,
  onReconnect,
  onRetry,
  onStart,
  screen,
  serviceActionBusy,
}: {
  onOpenSettings: () => void;
  onOpenWeb: () => void;
  onReconnect: () => void;
  onRetry: () => void;
  onStart: () => void;
  screen: ReturnType<typeof decideScreen>;
  serviceActionBusy: ServiceActionBusy;
}) {
  const [open, setOpen] = useState(false);
  const [confirmReconnect, setConfirmReconnect] = useState(false);

  const closeAndRun = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="relative">
      <Button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Home actions"
        onClick={() => setOpen((current) => !current)}
        size="icon"
        variant="ghost"
      >
        <DotsThreeIcon aria-hidden size={18} weight="bold" />
      </Button>
      {open ? (
        <div
          className="no-drag absolute top-full right-0 z-50 mt-2 w-56 border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          role="menu"
        >
          <HomeMenuItem
            Icon={ArrowSquareOutIcon}
            label="Open OpenMeld Web"
            onSelect={() => closeAndRun(onOpenWeb)}
          />
          {screen === "connected" ? (
            <HomeMenuItem
              disabled={serviceActionBusy !== null}
              Icon={ArrowClockwiseIcon}
              label={
                serviceActionBusy === "setup"
                  ? "Reconnecting..."
                  : "Reconnect OpenMeld Service"
              }
              onSelect={() => {
                setOpen(false);
                setConfirmReconnect(true);
              }}
            />
          ) : null}
          {screen === "stopped" ? (
            <HomeMenuItem
              disabled={serviceActionBusy !== null}
              Icon={PlayIcon}
              label={
                serviceActionBusy === "start"
                  ? "Starting..."
                  : "Start OpenMeld Service"
              }
              onSelect={() => closeAndRun(onStart)}
            />
          ) : null}
          {screen === "needs_attention" ? (
            <HomeMenuItem
              disabled={serviceActionBusy !== null}
              Icon={ArrowClockwiseIcon}
              label="Refresh status"
              onSelect={() => closeAndRun(onRetry)}
            />
          ) : null}
          <hr className="my-1 border-border border-t" />
          <HomeMenuItem
            Icon={GearSixIcon}
            label="Open Settings"
            onSelect={() => closeAndRun(onOpenSettings)}
          />
        </div>
      ) : null}
      <ConfirmDialog
        busy={serviceActionBusy === "setup"}
        confirmLabel="Reconnect"
        description="This reruns setup for this Mac and may restart OpenMeld Service. It will not sign you out."
        onConfirm={() => {
          setConfirmReconnect(false);
          onReconnect();
        }}
        onOpenChange={setConfirmReconnect}
        open={confirmReconnect}
        title="Reconnect this computer?"
      />
    </div>
  );
}

function HomeMenuItem({
  disabled = false,
  Icon,
  label,
  onSelect,
}: {
  disabled?: boolean;
  Icon: Icon;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      className="flex h-8 w-full items-center gap-2 px-2 text-left text-foreground text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onSelect}
      role="menuitem"
      type="button"
    >
      <Icon aria-hidden className="size-4 text-muted-foreground" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

type ScreenHandlers = {
  service: ServiceView;
  agentsLoad: LocalAgentsLoadState;
  busyAgentId: string | null;
  email: string | null;
  serviceBusy: boolean;
  serviceActionBusy: ServiceActionBusy;
  serviceControlActionBusy: DesktopServiceActionBusy;
  serviceAutoStartBusy: boolean;
  serviceAutoStartProblem: CliProblem | null;
  signInBusy: boolean;
  onSetup: () => void;
  onInstallCli: () => void;
  onOpenLocalAgentsGuide: () => void;
  onOpenNodeDownloadPage: () => void;
  onStart: () => void;
  onStop: () => void;
  onSignIn: () => void;
  onRetry: () => void;
  onSetServiceAutoStart: (enabled: boolean) => void;
  onToggleAgent: (agentId: string, enabled: boolean) => void;
  onUpdateCli: () => void;
  onUpdateService: () => void;
};

function HomeScreenContent({
  screen,
  ...h
}: ScreenHandlers & { screen: ReturnType<typeof decideScreen> }) {
  switch (screen) {
    case "sign_in":
      return <SignInScreen busy={h.signInBusy} onSignIn={h.onSignIn} />;
    case "set_up":
      return (
        <SetUpScreen
          agentsLoad={h.agentsLoad}
          busy={h.serviceBusy}
          busyAgentId={h.busyAgentId}
          onOpenLocalAgentsGuide={h.onOpenLocalAgentsGuide}
          onRetry={h.onRetry}
          onSetServiceAutoStart={h.onSetServiceAutoStart}
          onSetup={h.onSetup}
          onStartService={h.onStart}
          onStopService={h.onStop}
          onToggleAgent={h.onToggleAgent}
          service={h.service}
          serviceActionBusy={h.serviceControlActionBusy}
          serviceAutoStartBusy={h.serviceAutoStartBusy}
          serviceAutoStartProblem={h.serviceAutoStartProblem}
        />
      );
    case "stopped":
      return (
        <StoppedScreen
          agentsLoad={h.agentsLoad}
          busy={h.serviceBusy}
          busyAgentId={h.busyAgentId}
          onOpenLocalAgentsGuide={h.onOpenLocalAgentsGuide}
          onRetry={h.onRetry}
          onSetServiceAutoStart={h.onSetServiceAutoStart}
          onSetup={h.onSetup}
          onStart={h.onStart}
          onStop={h.onStop}
          onToggleAgent={h.onToggleAgent}
          service={h.service}
          serviceActionBusy={h.serviceControlActionBusy}
          serviceAutoStartBusy={h.serviceAutoStartBusy}
          serviceAutoStartProblem={h.serviceAutoStartProblem}
        />
      );
    case "connected":
      return (
        <ConnectedScreen
          agentsLoad={h.agentsLoad}
          busyAgentId={h.busyAgentId}
          cliUpdateBusy={h.serviceActionBusy === "update-cli"}
          email={h.email}
          onOpenLocalAgentsGuide={h.onOpenLocalAgentsGuide}
          onReconnectComputer={h.onSetup}
          onRetry={h.onRetry}
          onSetServiceAutoStart={h.onSetServiceAutoStart}
          onSetupComputer={h.onSetup}
          onStartService={h.onStart}
          onStopService={h.onStop}
          onToggleAgent={h.onToggleAgent}
          onUpdateCli={h.onUpdateCli}
          onUpdateService={h.onUpdateService}
          service={h.service}
          serviceActionBusy={h.serviceControlActionBusy}
          serviceAutoStartBusy={h.serviceAutoStartBusy}
          serviceAutoStartProblem={h.serviceAutoStartProblem}
          serviceUpdateBusy={h.serviceActionBusy === "update-service"}
        />
      );
    default:
      return (
        <NeedsAttentionScreen
          busy={h.serviceBusy}
          cliUpdateBusy={h.serviceActionBusy === "update-cli"}
          installCliBusy={h.serviceActionBusy === "install-cli"}
          onInstallCli={h.onInstallCli}
          onOpenNodeDownloadPage={h.onOpenNodeDownloadPage}
          onRetry={h.onRetry}
          onSetup={h.onSetup}
          onUpdateCli={h.onUpdateCli}
          onUpdateService={h.onUpdateService}
          service={h.service}
          serviceUpdateBusy={h.serviceActionBusy === "update-service"}
        />
      );
  }
}

function useVisibleRefresh({
  enabled,
  intervalMs,
  onRefresh,
  refreshOnResume = false,
}: {
  enabled: boolean;
  intervalMs: number;
  onRefresh: () => void;
  refreshOnResume?: boolean;
}) {
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const refreshIfVisible = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      onRefreshRef.current();
    };

    const timer = window.setInterval(refreshIfVisible, intervalMs);
    if (refreshOnResume) {
      window.addEventListener("focus", refreshIfVisible);
      document.addEventListener("visibilitychange", refreshIfVisible);
    }
    return () => {
      window.clearInterval(timer);
      if (refreshOnResume) {
        window.removeEventListener("focus", refreshIfVisible);
        document.removeEventListener("visibilitychange", refreshIfVisible);
      }
    };
  }, [enabled, intervalMs, refreshOnResume]);
}

function unknownService(): ServiceView {
  return {
    lifecycle: "unknown",
    installed: null,
    running: null,
    autoStart: null,
    cliVersion: null,
    runtimeProjection: null,
    attention: null,
    problem: null,
  };
}

function mergeServiceStatus(
  current: ServiceView | null,
  next: ServiceView,
  options: RefreshServiceStatusOptions
): ServiceView {
  if (
    !options.preserveSetupGuidance ||
    next.setupGuidance ||
    !current?.setupGuidance ||
    current.lifecycle !== "running" ||
    next.lifecycle !== "running"
  ) {
    return next;
  }

  return { ...next, setupGuidance: current.setupGuidance };
}

function isSettingsServiceActionBusy(
  action: ServiceActionBusy
): action is "setup" | "start" | "stop" {
  return action === "setup" || action === "start" || action === "stop";
}

function shouldShowDesktopUpdate(
  update: DesktopUpdateView | null
): update is DesktopUpdateView {
  return update?.status === "available" || update?.status === "required";
}

function formatVersion(version: string | null): string {
  return version ? `v${version}` : "unknown";
}

function agentLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "OpenMeld Desktop could not load local agents on this Mac.";
}

function noop() {
  // Errors surface through the per-screen problem fields; swallow transport
  // rejects so a single failed read never blanks the whole window.
}
