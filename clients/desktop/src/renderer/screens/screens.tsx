import { Button } from "@openmeld/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@openmeld/ui/components/card";
import { cn } from "@openmeld/ui/lib/utils";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CliProblem, ServiceView } from "../../shared/view-types";
import { ConfirmDialog } from "../components/confirm-dialog";
import {
  DesktopComputerServiceCard,
  DesktopLocalAgentsCard,
  type DesktopServiceActionBusy,
  type LocalAgentsLoadState,
} from "../components/desktop-computer-cards";
import { DesktopSetupProgress } from "../components/desktop-setup-progress";

const SIMPLE_EMAIL_LOCAL_PART_PATTERN = /^[a-z]+$/i;

function StatusDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

function ProblemNote({ message }: { message: string }) {
  return (
    <p className="text-destructive text-sm" role="alert">
      {message}
    </p>
  );
}

function HomeIntro({
  description,
  email,
  status,
  tone,
}: {
  description?: string;
  email: string | null;
  status?: string;
  tone?: "connected" | "warning" | "muted";
}) {
  return (
    <section className="space-y-3">
      {status && tone ? (
        <div className="flex items-center gap-2">
          <StatusDot color={statusDotColor(tone)} />
          <span className="font-medium text-muted-foreground text-xs">
            {status}
          </span>
        </div>
      ) : null}
      <div className="space-y-1">
        <h2 className="font-semibold text-2xl text-foreground tracking-normal">
          Hello, {formatGreetingName(email)}
        </h2>
        {description ? (
          <p className="max-w-xl text-muted-foreground text-sm">
            {description}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function HomePanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "gap-0 bg-card/45 py-0 ring-border/80 transition-colors",
        className
      )}
    >
      {children}
    </Card>
  );
}

function PanelHeader({
  description,
  title,
  trailing,
}: {
  description?: string;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <CardHeader className="border-border/70 border-b px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle aria-level={3} className="text-sm" role="heading">
            {title}
          </CardTitle>
          {description ? (
            <p className="text-muted-foreground text-xs">{description}</p>
          ) : null}
        </div>
        {trailing ? <div className="shrink-0 pt-0.5">{trailing}</div> : null}
      </div>
    </CardHeader>
  );
}

// ---------- Sign in ----------
export function SignInScreen({
  busy,
  onSignIn,
}: {
  busy: boolean;
  onSignIn: () => void;
}) {
  return (
    <div className="space-y-6">
      <HomeIntro
        description="Sign in once, then OpenMeld Desktop can connect this Mac."
        email={null}
        status="Signed out"
        tone="muted"
      />
      <HomePanel>
        <PanelHeader title="Sign in to OpenMeld" />
        <CardContent className="space-y-5 px-4 py-4">
          <p className="text-muted-foreground text-sm">
            Connect this Mac to your OpenMeld account so local agents can be
            reached from Spaces.
          </p>
          <Button className="w-full" disabled={busy} onClick={onSignIn}>
            {busy ? "Waiting for your browser..." : "Sign In"}
          </Button>
          {busy ? (
            <p className="text-muted-foreground text-xs">
              Finish signing in in the browser window that opened.
            </p>
          ) : null}
        </CardContent>
      </HomePanel>
    </div>
  );
}

// ---------- Set up this computer ----------
export function SetUpScreen({
  agentsLoad,
  busyAgentId,
  busy,
  onSetup,
  onOpenLocalAgentsGuide,
  onRetry,
  onSetServiceAutoStart,
  onStartService,
  onStopService,
  onToggleAgent,
  service,
  serviceActionBusy,
  serviceAutoStartBusy,
  serviceAutoStartProblem,
}: {
  agentsLoad: LocalAgentsLoadState;
  busyAgentId: string | null;
  busy: boolean;
  onSetup: () => void;
  onOpenLocalAgentsGuide: () => void;
  onRetry: () => void;
  onSetServiceAutoStart: (enabled: boolean) => void;
  onStartService: () => void;
  onStopService: () => void;
  onToggleAgent: (agentId: string, enabled: boolean) => void;
  service: ServiceView;
  serviceActionBusy: DesktopServiceActionBusy;
  serviceAutoStartBusy: boolean;
  serviceAutoStartProblem: CliProblem | null;
}) {
  const [setupRunId, setSetupRunId] = useState(0);
  const lastTriggeredSetupRunId = useRef(0);
  const setupStarted = setupRunId > 0;
  const setupWaitingToStart =
    setupStarted && lastTriggeredSetupRunId.current !== setupRunId;
  const setupInProgress = setupWaitingToStart || serviceActionBusy === "setup";

  useEffect(() => {
    if (!setupStarted || lastTriggeredSetupRunId.current === setupRunId) {
      return;
    }
    lastTriggeredSetupRunId.current = setupRunId;
    onSetup();
  }, [onSetup, setupRunId, setupStarted]);

  const beginSetup = () => {
    setSetupRunId((current) => current + 1);
  };

  return (
    <div className="space-y-6">
      <HomeIntro
        description="Connect this Mac before local agents can reply from OpenMeld Spaces."
        email={null}
        status="Not set up"
        tone="warning"
      />
      <div className="space-y-3">
        <DesktopComputerServiceCard
          footer={
            setupStarted ? (
              <DesktopSetupProgress
                canRetry={!(busy || setupInProgress)}
                mode="first_run"
                onRetry={beginSetup}
                service={service}
                setupInProgress={setupInProgress}
              />
            ) : (
              <HomeServicePrimaryAction
                busy={busy}
                busyLabel="Starting setup..."
                description="OpenMeld Desktop will install or update OpenMeld CLI, prepare OpenMeld Service, and connect local agents from this app."
                label="Start Setup"
                onAction={beginSetup}
                title="Set up this Mac"
              />
            )
          }
          onReconnectComputer={onSetup}
          onSetServiceAutoStart={onSetServiceAutoStart}
          onSetupComputer={onSetup}
          onStartService={onStartService}
          onStopService={onStopService}
          service={service}
          serviceActionBusy={serviceActionBusy}
          serviceAutoStartBusy={serviceAutoStartBusy}
          serviceAutoStartProblem={serviceAutoStartProblem}
          showServiceControls={false}
        />
        <DesktopLocalAgentsCard
          agentsLoad={agentsLoad}
          busyAgentId={busyAgentId}
          onOpenLocalAgentsGuide={onOpenLocalAgentsGuide}
          onRetry={onRetry}
          onToggleAgent={onToggleAgent}
        />
      </div>
    </div>
  );
}

// ---------- Stopped ----------
export function StoppedScreen({
  agentsLoad,
  busyAgentId,
  busy,
  onRetry,
  onOpenLocalAgentsGuide,
  onSetServiceAutoStart,
  onStart,
  onStop,
  onSetup,
  onToggleAgent,
  service,
  serviceActionBusy,
  serviceAutoStartBusy,
  serviceAutoStartProblem,
}: {
  agentsLoad: LocalAgentsLoadState;
  busyAgentId: string | null;
  busy: boolean;
  onRetry: () => void;
  onOpenLocalAgentsGuide: () => void;
  onSetServiceAutoStart: (enabled: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  onSetup: () => void;
  onToggleAgent: (agentId: string, enabled: boolean) => void;
  service: ServiceView;
  serviceActionBusy: DesktopServiceActionBusy;
  serviceAutoStartBusy: boolean;
  serviceAutoStartProblem: CliProblem | null;
}) {
  return (
    <div className="space-y-6">
      <HomeIntro
        description="OpenMeld Service is installed, but it is not running right now."
        email={null}
        status="Stopped"
        tone="warning"
      />
      <div className="space-y-3">
        <DesktopComputerServiceCard
          footer={
            <HomeServicePrimaryAction
              busy={busy}
              busyLabel="Starting OpenMeld Service..."
              description="Start the background service so this Mac can run local agents for Spaces."
              label="Start OpenMeld Service"
              onAction={onStart}
              title="Start OpenMeld Service"
            />
          }
          onReconnectComputer={onSetup}
          onSetServiceAutoStart={onSetServiceAutoStart}
          onSetupComputer={onSetup}
          onStartService={onStart}
          onStopService={onStop}
          service={service}
          serviceActionBusy={serviceActionBusy}
          serviceAutoStartBusy={serviceAutoStartBusy}
          serviceAutoStartProblem={serviceAutoStartProblem}
          showServiceControls={false}
        />
        <DesktopLocalAgentsCard
          agentsLoad={agentsLoad}
          busyAgentId={busyAgentId}
          onOpenLocalAgentsGuide={onOpenLocalAgentsGuide}
          onRetry={onRetry}
          onToggleAgent={onToggleAgent}
        />
      </div>
    </div>
  );
}

function HomeServicePrimaryAction({
  busy,
  busyLabel,
  description,
  label,
  onAction,
  title,
}: {
  busy: boolean;
  busyLabel: string;
  description: string;
  label: string;
  onAction: () => void;
  title: string;
}) {
  return (
    <div className="grid gap-3 min-[760px]:grid-cols-[minmax(0,1fr)_auto] min-[760px]:items-center">
      <div className="min-w-0">
        <p className="font-medium text-foreground text-sm">{title}</p>
        <p className="mt-1 text-muted-foreground text-xs/relaxed">
          {description}
        </p>
      </div>
      <Button
        className="w-full min-[760px]:w-auto"
        disabled={busy}
        onClick={onAction}
        size="sm"
      >
        {busy ? busyLabel : label}
      </Button>
    </div>
  );
}

// ---------- Needs attention ----------
export function NeedsAttentionScreen({
  service,
  busy,
  cliUpdateBusy,
  installCliBusy,
  onInstallCli,
  onOpenNodeDownloadPage,
  onSetup,
  onRetry,
  onUpdateCli,
  onUpdateService,
  serviceUpdateBusy,
}: {
  service: ServiceView;
  busy: boolean;
  cliUpdateBusy: boolean;
  installCliBusy: boolean;
  onInstallCli: () => void;
  onOpenNodeDownloadPage: () => void;
  onSetup: () => void;
  onRetry: () => void;
  onUpdateCli: () => void;
  onUpdateService: () => void;
  serviceUpdateBusy: boolean;
}) {
  const cliMissing = service.problem?.kind === "spawn_failed";
  const cliSetupIssue = resolveCliSetupIssue(service.problem);
  const cliIssue = resolveCliIssue(service, null);
  const serviceIssue = resolveServiceIssue(service);
  const primaryAction = resolveNeedsAttentionAction({
    busy,
    cliIssue,
    cliMissing,
    cliSetupIssue,
    cliUpdateBusy,
    installCliBusy,
    onInstallCli,
    onOpenNodeDownloadPage,
    onSetup,
    onUpdateCli,
    onUpdateService,
    serviceIssue,
    serviceUpdateBusy,
  });
  const title =
    cliSetupIssue?.title ??
    cliIssue?.title ??
    serviceIssue?.title ??
    (cliMissing ? "OpenMeld CLI not available" : "Status unavailable");
  const description =
    cliSetupIssue?.description ??
    cliIssue?.description ??
    serviceIssue?.description ??
    (cliMissing
      ? "OpenMeld Desktop could not open OpenMeld CLI on this Mac."
      : "OpenMeld Desktop could not read the service status. The service may still be running.");
  const rawProblem =
    service.problem &&
    !(cliSetupIssue || cliIssue || serviceIssue || cliMissing)
      ? service.problem
      : null;

  return (
    <div className="space-y-6">
      <HomeIntro
        description="OpenMeld Desktop needs one thing fixed before this Mac can report a clean state."
        email={null}
        status="Needs attention"
        tone="warning"
      />
      <HomePanel>
        <PanelHeader title={title} />
        <CardContent className="space-y-5 px-4 py-4">
          <p className="text-muted-foreground text-sm">{description}</p>
          {rawProblem ? <ProblemNote message={rawProblem.message} /> : null}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={primaryAction.disabled}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </Button>
            <Button
              className="flex-1"
              disabled={busy}
              onClick={onRetry}
              variant="outline"
            >
              Try again
            </Button>
          </div>
        </CardContent>
      </HomePanel>
    </div>
  );
}

// ---------- Connected (dashboard) ----------
export function ConnectedScreen({
  service,
  agentsLoad,
  busyAgentId,
  email,
  cliUpdateBusy,
  onReconnectComputer,
  onOpenLocalAgentsGuide,
  onRetry,
  onSetServiceAutoStart,
  onSetupComputer,
  onStartService,
  onStopService,
  onToggleAgent,
  onUpdateCli,
  onUpdateService,
  serviceActionBusy,
  serviceAutoStartBusy,
  serviceAutoStartProblem,
  serviceUpdateBusy,
}: {
  service: ServiceView;
  agentsLoad: LocalAgentsLoadState;
  busyAgentId: string | null;
  email: string | null;
  cliUpdateBusy: boolean;
  onReconnectComputer: () => void;
  onOpenLocalAgentsGuide: () => void;
  onRetry: () => void;
  onSetServiceAutoStart: (enabled: boolean) => void;
  onSetupComputer: () => void;
  onStartService: () => void;
  onStopService: () => void;
  onToggleAgent: (agentId: string, enabled: boolean) => void;
  onUpdateCli: () => void;
  onUpdateService: () => void;
  serviceActionBusy: DesktopServiceActionBusy;
  serviceAutoStartBusy: boolean;
  serviceAutoStartProblem: CliProblem | null;
  serviceUpdateBusy: boolean;
}) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmReconnect, setConfirmReconnect] = useState(false);
  const agentsProblem =
    agentsLoad.status === "ready" ? agentsLoad.view.problem : null;

  return (
    <div className="space-y-6">
      <HomeIntro email={email} />

      <div className="space-y-3">
        <DesktopComputerServiceCard
          footer={
            <ConnectedUpdateActions
              agentsProblem={agentsProblem}
              cliUpdateBusy={cliUpdateBusy}
              onUpdateCli={onUpdateCli}
              onUpdateService={onUpdateService}
              service={service}
              serviceUpdateBusy={serviceUpdateBusy}
            />
          }
          onReconnectComputer={() => setConfirmReconnect(true)}
          onSetServiceAutoStart={onSetServiceAutoStart}
          onSetupComputer={onSetupComputer}
          onStartService={onStartService}
          onStopService={() => setConfirmStop(true)}
          service={service}
          serviceActionBusy={serviceActionBusy}
          serviceAutoStartBusy={serviceAutoStartBusy}
          serviceAutoStartProblem={serviceAutoStartProblem}
        />
        <DesktopLocalAgentsCard
          agentsLoad={agentsLoad}
          busyAgentId={busyAgentId}
          onOpenLocalAgentsGuide={onOpenLocalAgentsGuide}
          onRetry={onRetry}
          onToggleAgent={onToggleAgent}
        />
      </div>

      <ConfirmDialog
        busy={serviceActionBusy === "stop"}
        confirmLabel="Stop OpenMeld Service"
        confirmVariant="destructive"
        description="This stops OpenMeld Service on this Mac. This Mac cannot receive local Wake work until OpenMeld Service is started again."
        onConfirm={() => {
          setConfirmStop(false);
          onStopService();
        }}
        onOpenChange={setConfirmStop}
        open={confirmStop}
        title="Stop OpenMeld Service?"
      />
      <ConfirmDialog
        busy={serviceActionBusy === "setup"}
        confirmLabel="Reconnect This Computer"
        description="This reruns setup for this Mac and may restart OpenMeld Service. It will not sign you out."
        onConfirm={() => {
          setConfirmReconnect(false);
          onReconnectComputer();
        }}
        onOpenChange={setConfirmReconnect}
        open={confirmReconnect}
        title="Reconnect this computer?"
      />
    </div>
  );
}

function ConnectedUpdateActions({
  agentsProblem,
  cliUpdateBusy,
  onUpdateCli,
  onUpdateService,
  service,
  serviceUpdateBusy,
}: {
  agentsProblem: CliProblem | null;
  cliUpdateBusy: boolean;
  onUpdateCli: () => void;
  onUpdateService: () => void;
  service: ServiceView;
  serviceUpdateBusy: boolean;
}) {
  const cliIssue = resolveCliIssue(service, agentsProblem);
  const serviceIssue = resolveServiceIssue(service);
  const rawProblem =
    service.problem && !(cliIssue || serviceIssue) ? service.problem : null;

  if (!(cliIssue || serviceIssue || rawProblem)) {
    return null;
  }

  return (
    <div className="space-y-3">
      {cliIssue ? (
        <ConnectedActionNotice
          actionLabel={
            cliUpdateBusy ? "Updating OpenMeld CLI..." : cliIssue.actionLabel
          }
          description={cliIssue.description}
          disabled={cliUpdateBusy}
          onAction={onUpdateCli}
          title={cliIssue.title}
        />
      ) : null}
      {serviceIssue ? (
        <ConnectedActionNotice
          actionLabel={
            serviceUpdateBusy
              ? "Updating OpenMeld Service..."
              : serviceIssue.actionLabel
          }
          description={serviceIssue.description}
          disabled={serviceUpdateBusy}
          onAction={onUpdateService}
          title={serviceIssue.title}
        />
      ) : null}
      {rawProblem ? (
        <p className="text-destructive text-xs" role="alert">
          {rawProblem.message}
        </p>
      ) : null}
    </div>
  );
}

type ActionNoticeProps = {
  actionLabel: string;
  description: string;
  disabled: boolean;
  onAction: () => void;
  title: string;
};

function ConnectedActionNotice({
  actionLabel,
  description,
  disabled,
  onAction,
  title,
}: ActionNoticeProps) {
  return (
    <div className="flex flex-col gap-2 text-xs min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground leading-5">{description}</p>
      </div>
      <Button
        className="shrink-0"
        disabled={disabled}
        onClick={onAction}
        size="sm"
      >
        {actionLabel}
      </Button>
    </div>
  );
}

function formatGreetingName(email: string | null): string {
  if (!email) {
    return "there";
  }
  const localPart = email.split("@")[0]?.trim();
  if (!localPart) {
    return email;
  }
  if (SIMPLE_EMAIL_LOCAL_PART_PATTERN.test(localPart)) {
    return localPart.charAt(0).toUpperCase() + localPart.slice(1);
  }
  return email;
}

function statusDotColor(tone: "connected" | "warning" | "muted"): string {
  if (tone === "connected") {
    return "#10b981";
  }
  if (tone === "warning") {
    return "#f59e0b";
  }
  return "#71717a";
}

type ActionIssue = {
  actionLabel: string;
  description: string;
  title: string;
};

type CliSetupIssue = ActionIssue & {
  action: "install_cli" | "open_node_download";
};

type NeedsAttentionActionInput = {
  busy: boolean;
  cliIssue: ActionIssue | null;
  cliMissing: boolean;
  cliSetupIssue: CliSetupIssue | null;
  cliUpdateBusy: boolean;
  installCliBusy: boolean;
  onInstallCli: () => void;
  onOpenNodeDownloadPage: () => void;
  onSetup: () => void;
  onUpdateCli: () => void;
  onUpdateService: () => void;
  serviceIssue: ActionIssue | null;
  serviceUpdateBusy: boolean;
};

function resolveNeedsAttentionAction(input: NeedsAttentionActionInput): {
  disabled: boolean;
  label: string;
  onClick: () => void;
} {
  if (input.cliSetupIssue) {
    if (input.cliSetupIssue.action === "open_node_download") {
      return {
        disabled: false,
        label: input.cliSetupIssue.actionLabel,
        onClick: input.onOpenNodeDownloadPage,
      };
    }
    return {
      disabled: input.busy,
      label: input.installCliBusy
        ? "Installing OpenMeld CLI..."
        : input.cliSetupIssue.actionLabel,
      onClick: input.onInstallCli,
    };
  }
  if (input.cliIssue) {
    return {
      disabled: input.busy,
      label: input.cliUpdateBusy
        ? "Updating OpenMeld CLI..."
        : "Update OpenMeld CLI",
      onClick: input.onUpdateCli,
    };
  }
  if (input.serviceIssue) {
    return {
      disabled: input.busy,
      label: input.serviceUpdateBusy
        ? "Updating OpenMeld Service..."
        : "Update OpenMeld Service",
      onClick: input.onUpdateService,
    };
  }
  return {
    disabled: input.busy,
    label: input.cliMissing
      ? "Set Up This Computer"
      : "Reconnect OpenMeld Service",
    onClick: input.onSetup,
  };
}

function resolveCliSetupIssue(
  problem: CliProblem | null
): CliSetupIssue | null {
  if (!problem) {
    return null;
  }
  if (problem.code === "desktop.node_missing") {
    return {
      action: "open_node_download",
      actionLabel: "Install Node.js LTS",
      description:
        "Install Node.js LTS, return to OpenMeld Desktop, then choose Try again. After Node.js and npm are available, OpenMeld Desktop will continue CLI and Service setup from this app.",
      title: "Node.js is required.",
    };
  }
  if (problem.code === "desktop.npm_missing") {
    return {
      action: "open_node_download",
      actionLabel: "Install Node.js LTS",
      description:
        "npm is required for OpenMeld Desktop to install OpenMeld CLI. The current Node.js LTS installer includes npm; install it, return here, then choose Try again.",
      title: "npm is required.",
    };
  }
  if (problem.code === "desktop.openmeld_cli_missing") {
    return {
      action: "install_cli",
      actionLabel: "Install OpenMeld CLI",
      description:
        "OpenMeld Desktop will install the official OpenMeld CLI for you with npm. You do not need to run Terminal commands; after the install finishes, continue setup from this app.",
      title: "OpenMeld CLI is not installed.",
    };
  }
  if (
    problem.code === "desktop.openmeld_cli_install_failed" ||
    problem.code === "desktop.openmeld_cli_install_timed_out" ||
    problem.code === "desktop.npm_spawn_failed"
  ) {
    return {
      action: "install_cli",
      actionLabel: "Retry OpenMeld CLI Install",
      description: problem.message,
      title: "OpenMeld CLI could not be installed.",
    };
  }
  return null;
}

function resolveCliIssue(
  service: ServiceView,
  agentsProblem: CliProblem | null
): ActionIssue | null {
  if (service.problem && isCliUpdateProblem(service.problem)) {
    return requiredCliUpdateIssue(service);
  }
  if (agentsProblem && isCliUpdateProblem(agentsProblem)) {
    return requiredCliUpdateIssue(service);
  }
  if (service.cliVersion?.updateAvailable === true) {
    return {
      actionLabel: "Update OpenMeld CLI",
      description: service.cliVersion.latestVersion
        ? `v${service.cliVersion.latestVersion} is available.`
        : "A newer OpenMeld CLI is available.",
      title: "OpenMeld CLI update available.",
    };
  }
  return null;
}

function requiredCliUpdateIssue(service: ServiceView): ActionIssue {
  const target =
    service.cliVersion?.requiredVersion ?? service.cliVersion?.latestVersion;
  return {
    actionLabel: "Update OpenMeld CLI",
    description: target
      ? `Update OpenMeld CLI to v${target} to keep Desktop commands working.`
      : "Update OpenMeld CLI to keep Desktop commands working.",
    title: "OpenMeld CLI update required.",
  };
}

function resolveServiceIssue(service: ServiceView): ActionIssue | null {
  if (service.problem && isServiceUpdateProblem(service.problem)) {
    return isRequiredServiceUpdateCode(service.problem.code)
      ? requiredServiceUpdateIssue()
      : availableServiceUpdateIssue();
  }
  if (isServiceAttentionUpdate(service)) {
    return isRequiredServiceAttention(service.attention)
      ? requiredServiceUpdateIssue()
      : availableServiceUpdateIssue();
  }
  return null;
}

function availableServiceUpdateIssue(): ActionIssue {
  return {
    actionLabel: "Update OpenMeld Service",
    description: "Update the local background service on this Mac.",
    title: "OpenMeld Service update available.",
  };
}

function requiredServiceUpdateIssue(): ActionIssue {
  return {
    actionLabel: "Update OpenMeld Service",
    description: "Update the local background service before using this Mac.",
    title: "OpenMeld Service update required.",
  };
}

function isCliUpdateProblem(problem: CliProblem): boolean {
  return problem.code === "upgrade.required";
}

function isServiceUpdateProblem(problem: CliProblem): boolean {
  return (
    isRequiredServiceUpdateCode(problem.code) ||
    problem.code === "service_update_available"
  );
}

function isServiceAttentionUpdate(service: ServiceView): boolean {
  const attention = service.attention;
  if (!attention) {
    return false;
  }
  return (
    attention.code === "service_update_available" ||
    attention.code === "service_update_required" ||
    attention.anomalyCodes.includes("bundle_content_drift")
  );
}

function isRequiredServiceAttention(
  attention: ServiceView["attention"]
): boolean {
  return attention ? isRequiredServiceUpdateCode(attention.code) : false;
}

function isRequiredServiceUpdateCode(code: string): boolean {
  return (
    code === "service.update_required" ||
    code === "service_update_required" ||
    code === "daemon.update_required"
  );
}
