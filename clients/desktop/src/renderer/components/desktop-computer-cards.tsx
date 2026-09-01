import {
  createAgentControllerInterfaceDisplayRows,
  formatAgentControllerInterfaceSummary,
  getAgentControllerVersionAdvisoryPresentation,
  resolveAgentControllerInterfaceDescription,
  shouldExpandAgentControllerInterface,
} from "@openmeld/agent-runtime";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { SettingsActionMenu } from "@openmeld/ui/components/settings-action-menu";
import {
  SettingsComputerStatusCard,
  type SettingsComputerStatusTone,
  SettingsLocalAgentAdvisoryBadge,
  type SettingsLocalAgentRow,
  SettingsLocalAgentsCard,
} from "@openmeld/ui/components/settings-computers";
import { SettingsDetailList } from "@openmeld/ui/components/settings-detail-list";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  type Icon,
  PauseIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useState } from "react";
import type {
  AgentsView,
  AgentView,
  CliProblem,
  ServiceView,
} from "../../shared/view-types";
import { ConfirmDialog } from "./confirm-dialog";
import { serviceStatusLabel } from "./desktop-service-status";
import { ToggleSwitch } from "./toggle-switch";

export type DesktopServiceActionBusy = "setup" | "start" | "stop" | null;

export type LocalAgentsLoadState =
  | { status: "loading"; view: null; errorMessage: null }
  | { status: "ready"; view: AgentsView; errorMessage: null }
  | { status: "error"; view: null; errorMessage: string };

export function DesktopComputerServiceCard({
  footer,
  onReconnectComputer,
  onSetupComputer,
  onSetServiceAutoStart,
  onStartService,
  onStopService,
  service,
  serviceActionBusy,
  serviceAutoStartBusy,
  serviceAutoStartProblem,
  showServiceControls = true,
}: {
  footer?: ReactNode;
  onReconnectComputer: () => void;
  onSetupComputer: () => void;
  onSetServiceAutoStart: (enabled: boolean) => void;
  onStartService: () => void;
  onStopService: () => void;
  service: ServiceView;
  serviceActionBusy: DesktopServiceActionBusy;
  serviceAutoStartBusy: boolean;
  serviceAutoStartProblem: CliProblem | null;
  showServiceControls?: boolean;
}) {
  return (
    <SettingsComputerStatusCard
      action={
        showServiceControls ? (
          <ServiceControlButtons
            onReconnect={onReconnectComputer}
            onSetup={onSetupComputer}
            onStart={onStartService}
            onStop={onStopService}
            service={service}
            serviceActionBusy={serviceActionBusy}
          />
        ) : null
      }
      description="OpenMeld Service on this Mac."
      error={service.problem?.message}
      statusDescription={serviceStatusDescription(service)}
      statusLabel={serviceStatusLabel(service)}
      title="This Mac"
      tone={serviceStatusTone(service)}
    >
      <ServiceFacts
        onSetServiceAutoStart={onSetServiceAutoStart}
        service={service}
        serviceAutoStartBusy={serviceAutoStartBusy}
        serviceAutoStartProblem={serviceAutoStartProblem}
      />
      {footer ? (
        <div className="border-border/70 border-t pt-3">{footer}</div>
      ) : null}
    </SettingsComputerStatusCard>
  );
}

export function DesktopLocalAgentsCard({
  agentsLoad,
  busyAgentId,
  onOpenLocalAgentsGuide,
  onRetry,
  onToggleAgent,
}: {
  agentsLoad: LocalAgentsLoadState;
  busyAgentId: string | null;
  onOpenLocalAgentsGuide: () => void;
  onRetry: () => void;
  onToggleAgent: (agentId: string, enabled: boolean) => void;
}) {
  const [disableConfirmation, setDisableConfirmation] = useState<{
    agentId: string;
    displayName: string;
  } | null>(null);
  const requestToggleAgent = (agent: AgentView, enabled: boolean) => {
    if (!enabled && agent.enabled === true) {
      setDisableConfirmation({
        agentId: agent.id,
        displayName: agent.displayName,
      });
      return;
    }
    onToggleAgent(agent.id, enabled);
  };
  const localAgentsAction = (
    <LocalAgentsMoreMenu
      isCheckingAgents={agentsLoad.status === "loading"}
      onCheckAgents={onRetry}
    />
  );
  const setDisableConfirmationOpen = (open: boolean) => {
    if (!open) {
      setDisableConfirmation(null);
    }
  };

  if (agentsLoad.status === "ready") {
    const showInstallGuide = shouldShowLocalAgentInstallGuide(agentsLoad.view);
    return (
      <>
        <div className="grid gap-3">
          <SettingsLocalAgentsCard
            action={localAgentsAction}
            description="Local agent programs detected on this Mac."
            emptyMessage={
              showInstallGuide
                ? "No agent CLIs installed yet."
                : "No supported agents on this Mac yet."
            }
            error={localAgentsProblemMessage(agentsLoad.view)}
            rows={localAgentRows({
              busyAgentId,
              onToggleAgent: requestToggleAgent,
              view: agentsLoad.view,
            })}
          />
          {showInstallGuide ? (
            <LocalAgentInstallGuideCallout
              onOpenGuide={onOpenLocalAgentsGuide}
            />
          ) : null}
        </div>
        <ConfirmDialog
          busy={
            disableConfirmation !== null &&
            busyAgentId === disableConfirmation.agentId
          }
          confirmLabel={`Disable ${
            disableConfirmation?.displayName ?? "Local Agent"
          }`}
          confirmVariant="destructive"
          description={`OpenMeld will stop launching ${
            disableConfirmation?.displayName ?? "this local agent"
          } on this Mac. Agent Profiles that use ${
            disableConfirmation?.displayName ?? "this local agent"
          } may not wake until you enable it again.`}
          onConfirm={() => {
            if (disableConfirmation) {
              const agentId = disableConfirmation.agentId;
              setDisableConfirmation(null);
              onToggleAgent(agentId, false);
            }
          }}
          onOpenChange={setDisableConfirmationOpen}
          open={disableConfirmation !== null}
          title={`Disable ${
            disableConfirmation?.displayName ?? "this local agent"
          }?`}
        />
      </>
    );
  }

  if (agentsLoad.status === "error") {
    return (
      <SettingsLocalAgentsCard
        action={localAgentsAction}
        description="Local agent programs detected on this Mac."
        emptyMessage="No supported agents on this Mac yet."
        error={`Could not load local agents. ${agentsLoad.errorMessage}`}
        rows={[]}
      />
    );
  }

  return (
    <SettingsLocalAgentsCard
      description="Local agent programs detected on this Mac."
      emptyMessage="Loading agents..."
      rows={[]}
    />
  );
}

function LocalAgentInstallGuideCallout({
  onOpenGuide,
}: {
  onOpenGuide: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 border border-border/70 bg-muted/20 px-4 py-3 min-[700px]:flex-row min-[700px]:items-center min-[700px]:justify-between">
      <p className="text-muted-foreground text-sm">
        No agent CLIs installed yet? See the install guide.
      </p>
      <Button
        className="w-full min-[700px]:w-auto"
        onClick={onOpenGuide}
        size="sm"
        variant="outline"
      >
        <ArrowSquareOutIcon aria-hidden="true" data-icon="inline-start" />
        See the install guide
      </Button>
    </div>
  );
}

function LocalAgentsMoreMenu({
  isCheckingAgents,
  onCheckAgents,
}: {
  isCheckingAgents: boolean;
  onCheckAgents: () => void;
}) {
  return (
    <SettingsActionMenu
      ariaLabel="Local agents options"
      items={[
        {
          disabled: isCheckingAgents,
          icon: <ArrowClockwiseIcon aria-hidden className="size-4" />,
          id: "check-agents",
          label: isCheckingAgents ? "Checking..." : "Check agents",
          onSelect: onCheckAgents,
        },
      ]}
    />
  );
}

function ServiceControlButtons({
  onReconnect,
  onSetup,
  onStart,
  onStop,
  service,
  serviceActionBusy,
}: {
  onReconnect: () => void;
  onSetup: () => void;
  onStart: () => void;
  onStop: () => void;
  service: ServiceView;
  serviceActionBusy: DesktopServiceActionBusy;
}) {
  const busy = serviceActionBusy !== null;
  const setupMode =
    service.lifecycle === "not_installed" || service.lifecycle === "unknown";
  const setupDisabled = busy || service.problem?.kind === "spawn_failed";
  const setupLabel = setupMode
    ? "Set Up This Computer"
    : "Reconnect This Computer";
  const startLabel =
    serviceActionBusy === "start"
      ? "Starting OpenMeld Service..."
      : "Start OpenMeld Service";
  const stopLabel =
    serviceActionBusy === "stop"
      ? "Stopping OpenMeld Service..."
      : "Stop OpenMeld Service";
  const setupBusyLabel = setupMode
    ? "Setting up this computer..."
    : "Reconnecting this computer...";
  const setupActionLabel =
    serviceActionBusy === "setup" ? setupBusyLabel : setupLabel;

  return (
    <div className="flex w-full items-center gap-1 min-[900px]:justify-end">
      <ServiceIconButton
        disabled={busy || service.lifecycle !== "stopped"}
        icon={PlayIcon}
        label={startLabel}
        onClick={onStart}
      />
      <ServiceIconButton
        disabled={busy || service.lifecycle !== "running"}
        icon={PauseIcon}
        label={stopLabel}
        onClick={onStop}
        tone="danger"
      />
      <ServiceIconButton
        disabled={Boolean(setupDisabled)}
        icon={ArrowClockwiseIcon}
        label={setupActionLabel}
        onClick={setupMode ? onSetup : onReconnect}
      />
    </div>
  );
}

function ServiceIconButton({
  disabled,
  icon: IconComponent,
  label,
  onClick,
  tone = "default",
}: {
  disabled: boolean;
  icon: Icon;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  const button = (
    <Button
      aria-label={label}
      className={cn(
        "text-muted-foreground disabled:text-muted-foreground disabled:opacity-35",
        tone === "danger" &&
          "text-destructive hover:bg-destructive/10 hover:text-destructive disabled:text-muted-foreground"
      )}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      variant="ghost"
    >
      <IconComponent aria-hidden className="size-4" weight="bold" />
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          disabled ? (
            <span className="inline-flex cursor-not-allowed">{button}</span>
          ) : (
            button
          )
        }
      />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function serviceStatusDescription(service: ServiceView): string {
  switch (service.lifecycle) {
    case "running":
      return "OpenMeld Service is running on this Mac.";
    case "stopped":
      return "OpenMeld Service is stopped on this Mac. Local Wake work cannot run here until it starts.";
    case "not_installed":
      return "OpenMeld Service is not installed on this Mac.";
    default:
      return "Desktop could not determine OpenMeld Service status.";
  }
}

function serviceStatusTone(service: ServiceView): SettingsComputerStatusTone {
  if (service.problem) {
    return "danger";
  }
  switch (service.lifecycle) {
    case "running":
      return "connected";
    case "stopped":
    case "not_installed":
      return "warning";
    default:
      return "muted";
  }
}

function ServiceFacts({
  onSetServiceAutoStart,
  service,
  serviceAutoStartBusy,
  serviceAutoStartProblem,
}: {
  onSetServiceAutoStart: (enabled: boolean) => void;
  service: ServiceView;
  serviceAutoStartBusy: boolean;
  serviceAutoStartProblem: CliProblem | null;
}) {
  const attentionMessage = service.attention?.message;
  const attentionNextStep = service.attention?.nextStep;
  const setupGuidance = service.setupGuidance ?? null;
  const serviceAutoStartKnown = typeof service.autoStart === "boolean";
  const serviceAutoStart = service.autoStart === true;
  const serviceAutoStartDisabled = Boolean(
    service.installed !== true || !serviceAutoStartKnown || service.problem
  );

  return (
    <div className="border-border/70 border-t pt-3">
      <dl className="grid gap-3 sm:grid-cols-2">
        <ServiceFact label="OpenMeld CLI" value={formatCliVersion(service)} />
      </dl>
      <div className="mt-3 grid gap-3 border-border/70 border-t pt-3 min-[760px]:grid-cols-[minmax(0,1fr)_auto] min-[760px]:items-center">
        <div className="min-w-0">
          <h3 className="font-medium text-foreground text-sm">
            Start OpenMeld Service automatically
          </h3>
          <p className="mt-1 text-muted-foreground text-xs/relaxed">
            {serviceAutoStartDescription(service) ??
              "Start OpenMeld Service automatically when you sign in to this Mac."}
          </p>
          {serviceAutoStartProblem ? (
            <p className="mt-2 text-destructive text-xs" role="alert">
              {serviceAutoStartProblem.message}
            </p>
          ) : null}
        </div>
        <ToggleSwitch
          busy={serviceAutoStartBusy}
          checked={serviceAutoStart}
          disabled={serviceAutoStartDisabled}
          label="Start OpenMeld Service automatically"
          onChange={onSetServiceAutoStart}
        />
      </div>
      {setupGuidance ? (
        <div className="mt-3 grid gap-2 border-border/70 border-t pt-3 text-xs leading-5">
          <h3 className="font-medium text-foreground text-sm">
            Setup complete
          </h3>
          <p className="text-muted-foreground">
            {setupGuidance.statusDescription}
          </p>
          <p className="text-muted-foreground">
            {setupGuidance.autoStartDescription} Use the switch above to change
            this setting.
          </p>
          <p className="text-muted-foreground">
            If OpenMeld Service is stopped,{" "}
            {setupGuidance.stoppedLocalAgentsDescription}
          </p>
        </div>
      ) : null}
      {attentionMessage || attentionNextStep ? (
        <div className="mt-3 border-border/70 border-t pt-3 text-xs leading-5">
          {attentionMessage ? (
            <p className="text-foreground">{attentionMessage}</p>
          ) : null}
          {attentionNextStep ? (
            <p className="mt-1 text-muted-foreground">{attentionNextStep}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ServiceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 truncate font-medium text-foreground text-sm">
        {value}
      </dd>
    </div>
  );
}

function serviceAutoStartDescription(service: ServiceView): string | null {
  if (service.installed === false) {
    return "Install OpenMeld Service first.";
  }
  if (service.installed !== true) {
    return "Service install status unavailable.";
  }
  if (typeof service.autoStart !== "boolean") {
    return "Autostart status unavailable.";
  }
  return null;
}

function formatCliVersion(service: ServiceView): string {
  const cliVersion = service.cliVersion;
  if (!cliVersion) {
    return "Unknown";
  }
  if (cliVersion.requiredVersion) {
    return `Required v${cliVersion.requiredVersion}`;
  }
  if (cliVersion.updateAvailable && cliVersion.latestVersion) {
    return `Update available v${cliVersion.latestVersion}`;
  }
  if (cliVersion.currentVersion) {
    return `Current v${cliVersion.currentVersion}`;
  }
  return "Unknown";
}

function localAgentsProblemMessage(view: AgentsView): string | null {
  if (!view.problem) {
    return null;
  }
  if (isInfrastructureUpdateProblem(view.problem)) {
    return view.agents.length === 0
      ? "Local agents could not refresh."
      : "Local agents could not fully refresh.";
  }
  if (view.agents.length === 0) {
    return view.problem.message;
  }
  return `Some agent details couldn't refresh. ${view.problem.message}`;
}

function isInfrastructureUpdateProblem(problem: CliProblem): boolean {
  return (
    problem.code === "upgrade.required" ||
    problem.code === "service_update_available" ||
    problem.code === "service.update_required" ||
    problem.code === "service_update_required" ||
    problem.code === "daemon.update_required"
  );
}

function localAgentRows({
  busyAgentId,
  onToggleAgent,
  view,
}: {
  busyAgentId: string | null;
  onToggleAgent: (agent: AgentView, enabled: boolean) => void;
  view: AgentsView;
}): SettingsLocalAgentRow[] {
  return view.agents
    .filter(isUsableAgent)
    .sort(compareAgents)
    .map((agent) => {
      const busy = busyAgentId === agent.id;
      const enabled = agent.enabled === true;
      const agentControllerInterface = agent.agentControllerInterface;
      const versionAdvisory = getAgentControllerVersionAdvisoryPresentation(
        agentControllerInterface
      );
      const setupStatus = resolveAgentSetupSummaryStatus(agent);
      const description = setupStatus
        ? resolveAgentSetupDescription(agent)
        : resolveAgentControllerInterfaceDescription({
            displayDescription: localAgentDescription(agent),
            snapshot: agentControllerInterface,
          });
      const suspendedStatus =
        agent.lifecycleStatus === "suspended"
          ? { label: "Suspended", tone: "warning" as const }
          : null;
      const summaryStatuses = [setupStatus, suspendedStatus].filter(
        (
          status
        ): status is NonNullable<SettingsLocalAgentRow["summaryStatus"]> =>
          status !== null
      );
      const summaryAccessory = versionAdvisory ? (
        <SettingsLocalAgentAdvisoryBadge
          detail={versionAdvisory.detail}
          key="version-advisory"
          label={versionAdvisory.label}
          tone={versionAdvisory.tone}
          updateCommand={versionAdvisory.updateCommand}
        />
      ) : null;
      return {
        badge: <LocalAgentBadge agent={agent} />,
        control: (
          <ToggleSwitch
            busy={busy}
            checked={enabled}
            disabled={!canToggleAgent(agent) || busy}
            label={agent.displayName}
            onChange={(next) => onToggleAgent(agent, next)}
          />
        ),
        defaultExpanded: shouldExpandAgentControllerInterface(
          agentControllerInterface
        ),
        description,
        detail: agentControllerInterface ? (
          <SettingsDetailList
            rows={createAgentControllerInterfaceDisplayRows(
              agentControllerInterface
            )}
          />
        ) : null,
        displayName: agent.displayName,
        id: agent.id,
        logoAgentId: agent.id,
        summaryAccessory,
        summaryMeta: agentControllerInterface
          ? formatAgentControllerInterfaceSummary(agentControllerInterface)
          : null,
        summaryStatuses:
          summaryStatuses.length > 0 ? summaryStatuses : undefined,
      };
    });
}

function shouldShowLocalAgentInstallGuide(view: AgentsView): boolean {
  if (view.problem) {
    return false;
  }
  return (
    view.agents.length === 0 || view.agents.every((agent) => !agent.detected)
  );
}

function resolveAgentSetupSummaryStatus(
  agent: AgentView
): NonNullable<SettingsLocalAgentRow["summaryStatus"]> | null {
  if (!shouldShowAgentSetupStatus(agent)) {
    return null;
  }
  if (agent.launchStatus === "ready") {
    return { label: "Turn on", tone: "warning" };
  }
  if (agent.launchStatus === "needs_choice") {
    return { label: "Choose installation", tone: "warning" };
  }
  return { label: "Can’t start", tone: "danger" };
}

function shouldShowAgentSetupStatus(agent: AgentView): boolean {
  if (agent.lifecycleStatus === "suspended" || !agent.detected) {
    return false;
  }
  if (
    agent.selectable &&
    agent.launchStatus === "ready" &&
    agent.enabled !== true
  ) {
    return true;
  }
  return (
    (agent.enabled === true || agent.selectable) &&
    (agent.launchStatus === "needs_choice" ||
      agent.launchStatus === "needs_repair")
  );
}

function resolveAgentSetupDescription(agent: AgentView): string {
  if (
    agent.selectable &&
    agent.launchStatus === "ready" &&
    agent.enabled !== true
  ) {
    return `Turn on ${agent.displayName} to let OpenMeld launch it on this Mac.`;
  }
  if (agent.launchStatus === "needs_choice") {
    return `OpenMeld found more than one ${agent.displayName} installation. Choose which one to use.`;
  }
  if (agent.launchStatus === "needs_repair") {
    return `OpenMeld found ${agent.displayName}, but can’t start it. Open Details to review the installation.`;
  }
  return localAgentDescription(agent);
}

function LocalAgentBadge({ agent }: { agent: AgentView }) {
  if (!agent.selectable) {
    return <Badge variant="secondary">Unavailable</Badge>;
  }
  if (agent.enabled === true) {
    return <Badge variant="outline">Enabled</Badge>;
  }
  return <Badge variant="secondary">Off</Badge>;
}

function localAgentDescription(agent: AgentView): string {
  if (agent.lifecycleStatus === "suspended" && agent.enabled === true) {
    return "OpenMeld can launch this controller on this Mac.";
  }
  if (!agent.selectable) {
    return friendlyBlocker(agent.blockerReasonCodes);
  }
  if (agent.enabled === true) {
    return "Enabled for local use on this Mac.";
  }
  return "Available to enable on this Mac.";
}

function isUsableAgent(agent: AgentView): boolean {
  return (
    agent.enabled === true ||
    (agent.lifecycleStatus !== "suspended" && agent.selectable)
  );
}

function canToggleAgent(agent: AgentView): boolean {
  return (
    agent.enabled === true ||
    (agent.lifecycleStatus !== "suspended" && agent.selectable)
  );
}

function compareAgents(a: AgentView, b: AgentView): number {
  const rank = agentRank(a) - agentRank(b);
  return rank === 0 ? a.displayName.localeCompare(b.displayName) : rank;
}

function agentRank(agent: AgentView): number {
  if (agent.enabled === true) {
    return 0;
  }
  return agent.selectable ? 1 : 2;
}

function friendlyBlocker(codes: string[]): string {
  if (codes.some((code) => code.includes("not_supported_yet"))) {
    return "Not supported yet";
  }
  if (codes.some((code) => code.includes("not_installed"))) {
    return "Not installed on this Mac";
  }
  const first = codes[0];
  if (!first) {
    return "Unavailable on this Mac";
  }
  const segment = (first.split(".").pop() ?? first).replace(/_/g, " ");
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}
