import {
  DesktopTowerIcon,
  PlusIcon,
  PulseIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import { Fragment, type ReactNode } from "react";
import { Badge } from "#components/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#components/card";
import { LocalAgentLogo } from "#components/local-agent-logo";
import { hasLocalAgentLogo } from "#components/local-agent-logo-utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#fluid/accordion";
import {
  resolveStatusToneAdvisoryBadgeClassName,
  resolveStatusToneIndicatorClassName,
  resolveStatusToneRingIndicatorClassName,
  resolveStatusToneSoftTextClassName,
  resolveStatusToneStrongTextClassName,
} from "#lib/status-tone";
import { cn } from "#lib/utils";

export type SettingsComputerLocalAgentIcon = {
  agentId: string;
  displayName: string;
};

const EMPTY_COMPUTER_LOCAL_AGENT_ICONS =
  [] as const satisfies readonly SettingsComputerLocalAgentIcon[];

export type SettingsComputerSummaryCardContentProps = {
  active?: boolean;
  activeIndicatorTestId?: string;
  activeLabel?: string;
  advisoryLabel?: string | null;
  advisoryTone?: "warning" | "danger";
  className?: string;
  icon?: ReactNode;
  lastSeenLabel: string;
  localAgents?: readonly SettingsComputerLocalAgentIcon[];
  localAgentsSummaryLabel?: string;
  name: string;
  platformLabel: string;
  recordBadgeLabel?: string | null;
  serviceConnectionStatus?: "connected" | "not_connected" | null;
};

export function SettingsComputerSummaryCardContent({
  active = false,
  activeIndicatorTestId,
  activeLabel = "Active computer",
  advisoryLabel,
  advisoryTone = "warning",
  className,
  icon,
  lastSeenLabel,
  localAgents = EMPTY_COMPUTER_LOCAL_AGENT_ICONS,
  localAgentsSummaryLabel,
  name,
  platformLabel,
  recordBadgeLabel,
  serviceConnectionStatus,
}: SettingsComputerSummaryCardContentProps) {
  const shouldRenderStatusIndicator =
    serviceConnectionStatus === undefined
      ? active
      : serviceConnectionStatus !== null;
  const statusIndicatorLabel =
    serviceConnectionStatus === "not_connected"
      ? "OpenMeld Service is not connected"
      : activeLabel;

  return (
    <div
      className={cn(
        "flex h-full w-full min-w-0 flex-1 flex-col justify-between gap-3 px-3.5 pt-4 pb-3",
        className
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3 pr-16">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center border border-border/70 bg-background/45 text-muted-foreground transition-colors group-data-[state=active]:text-foreground">
            {icon ?? (
              <DesktopTowerIcon aria-hidden="true" className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-foreground text-sm">
                {name}
              </span>
              {recordBadgeLabel ? (
                <Badge className="shrink-0" variant="secondary">
                  {recordBadgeLabel}
                </Badge>
              ) : null}
              {shouldRenderStatusIndicator ? (
                <span className="inline-flex shrink-0 items-center">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-2 w-2 rounded-full ring-2",
                      resolveServiceConnectionIndicatorClassName(
                        serviceConnectionStatus ?? "connected"
                      )
                    )}
                    data-testid={activeIndicatorTestId}
                  />
                  <span className="sr-only">{statusIndicatorLabel}</span>
                </span>
              ) : null}
              {advisoryLabel ? (
                <span
                  className={cn(
                    "shrink-0 font-medium text-xs",
                    resolveComputerAdvisoryClassName(advisoryTone)
                  )}
                >
                  {advisoryLabel}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block whitespace-normal text-muted-foreground text-xs leading-5">
              {platformLabel}
            </span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3 border-border/70 border-t pt-2.5 text-xs leading-5">
        <span className="min-w-0 text-muted-foreground">{lastSeenLabel}</span>
        <SettingsComputerLocalAgentSummary
          icons={localAgents}
          summaryLabel={localAgentsSummaryLabel}
        />
      </div>
    </div>
  );
}

function resolveComputerAdvisoryClassName(
  tone: NonNullable<SettingsComputerSummaryCardContentProps["advisoryTone"]>
): string {
  return resolveStatusToneStrongTextClassName(tone);
}

function resolveServiceConnectionIndicatorClassName(
  status: NonNullable<
    SettingsComputerSummaryCardContentProps["serviceConnectionStatus"]
  >
): string {
  switch (status) {
    case "not_connected":
      return resolveStatusToneRingIndicatorClassName("danger");
    default:
      return resolveStatusToneRingIndicatorClassName("ready");
  }
}

export function SettingsAddComputerCardContent({
  description = "Set up OpenMeld Service and local agents.",
  descriptionClassName,
  iconContainerClassName,
  title = "Add a Computer",
  titleClassName,
}: {
  description?: ReactNode;
  descriptionClassName?: string;
  iconContainerClassName?: string;
  title?: string;
  titleClassName?: string;
}) {
  return (
    <>
      <span
        className={cn(
          "grid size-10 place-items-center rounded-md border border-border/70 bg-background/45 text-muted-foreground transition-colors group-hover:text-foreground",
          iconContainerClassName
        )}
      >
        <PlusIcon aria-hidden="true" className="size-5" />
      </span>
      <span className="flex flex-col items-center gap-1">
        <span
          className={cn("font-medium text-foreground text-sm", titleClassName)}
        >
          {title}
        </span>
        <span
          className={cn(
            "max-w-48 text-muted-foreground text-xs leading-5",
            descriptionClassName
          )}
        >
          {description}
        </span>
      </span>
    </>
  );
}

function SettingsComputerLocalAgentSummary({
  icons,
  summaryLabel,
}: {
  icons: readonly SettingsComputerLocalAgentIcon[];
  summaryLabel?: string;
}) {
  const visibleIcons = icons.filter((icon) => hasLocalAgentLogo(icon.agentId));
  if (visibleIcons.length === 0) {
    return summaryLabel ? (
      <span className="shrink-0 text-muted-foreground">{summaryLabel}</span>
    ) : null;
  }

  return (
    <span className="flex shrink-0 items-center justify-end gap-2">
      <span className="sr-only">
        {visibleIcons.map((icon) => icon.displayName).join(", ")} local agents
      </span>
      {visibleIcons.map((icon) => (
        <Tooltip key={icon.agentId}>
          <TooltipTrigger
            render={
              <span className="inline-flex size-5 items-center justify-center opacity-90 transition-opacity hover:opacity-100">
                <LocalAgentLogo agentId={icon.agentId} size="sm" />
              </span>
            }
          />
          <TooltipContent side="top">{icon.displayName}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

export type SettingsComputerStatusTone =
  | "connected"
  | "checking"
  | "warning"
  | "danger"
  | "muted";

export type SettingsComputerStatusCardProps = {
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  description: string;
  error?: string | null;
  statusDescription?: string;
  statusLabel: string;
  title?: string;
  tone?: SettingsComputerStatusTone;
};

export function SettingsComputerStatusCard({
  action,
  children,
  className,
  description,
  error,
  statusDescription,
  statusLabel,
  title = "OpenMeld Service",
  tone = "muted",
}: SettingsComputerStatusCardProps) {
  return (
    <Card className={className} data-testid="settings-computer-status-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PulseIcon className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <p
              className={cn(
                "flex items-center gap-2 font-medium text-sm",
                resolveStatusTextClassName(tone)
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  resolveStatusDotClassName(tone)
                )}
              />
              {statusLabel}
            </p>
            {statusDescription ? (
              <p className="max-w-2xl text-muted-foreground text-xs leading-5">
                {statusDescription}
              </p>
            ) : null}
          </div>
        </div>
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}

export type SettingsLocalAgentRowSummaryStatus = {
  label: ReactNode;
  tone?: "danger" | "muted" | "warning";
};

export type SettingsLocalAgentRow = {
  badge?: ReactNode;
  control?: ReactNode;
  defaultExpanded?: boolean;
  description?: string;
  descriptionTone?: "default" | "warning";
  detail?: ReactNode;
  displayName: string;
  id: string;
  logoAgentId?: string;
  muted?: boolean;
  summaryAccessory?: ReactNode;
  summaryMeta?: ReactNode;
  summaryStatus?: SettingsLocalAgentRowSummaryStatus;
  summaryStatuses?: readonly SettingsLocalAgentRowSummaryStatus[];
};

export type SettingsLocalAgentAdvisoryBadgeProps = {
  detail: string;
  label: string;
  tone?: "muted" | "warning";
  updateCommand: string | null;
};

export function SettingsLocalAgentAdvisoryBadge({
  detail,
  label,
  tone = "warning",
  updateCommand,
}: SettingsLocalAgentAdvisoryBadgeProps) {
  const tooltipContent = updateCommand ? (
    <>
      <span>
        {detail} Run this command on this computer to update this controller.
      </span>
      <code className="block max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-sm border border-background/20 bg-background/10 px-2 py-1 font-mono text-[11px] text-background leading-4">
        {updateCommand}
      </code>
    </>
  ) : (
    `${detail} Update this controller from the installer or package manager used on this computer.`
  );

  const badge = (
    <Badge
      className={cn(
        tone === "warning" && resolveStatusToneAdvisoryBadgeClassName()
      )}
      variant="secondary"
    >
      {label}
    </Badge>
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex shrink-0">{badge}</span>}
      />
      <TooltipContent
        className="max-w-sm flex-col items-start gap-2 whitespace-normal text-left"
        side="top"
      >
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}

export type SettingsLocalAgentsCardProps = {
  action?: ReactNode;
  className?: string;
  description: string;
  emptyMessage?: string;
  error?: string | null;
  rows: readonly SettingsLocalAgentRow[];
  title?: string;
};

export function SettingsLocalAgentsCard({
  action,
  className,
  description,
  emptyMessage = "No supported agents on this computer yet.",
  error,
  rows,
  title = "Local agents",
}: SettingsLocalAgentsCardProps) {
  return (
    <Card className={className} data-testid="settings-local-agents-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RobotIcon className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="mb-3 text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{emptyMessage}</p>
        ) : (
          <SettingsLocalAgentRows rows={rows} />
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsLocalAgentRows({
  className,
  rows,
}: {
  className?: string;
  rows: readonly SettingsLocalAgentRow[];
}) {
  return (
    <Accordion
      className={cn("w-full divide-y divide-border", className)}
      defaultValue={resolveDefaultExpandedLocalAgentRowIds(rows)}
      multiple
    >
      {rows.map((row) => (
        <SettingsLocalAgentRowView key={row.id} row={row} />
      ))}
    </Accordion>
  );
}

function resolveDefaultExpandedLocalAgentRowIds(
  rows: readonly SettingsLocalAgentRow[]
): string[] {
  const defaultExpandedIds: string[] = [];
  for (const row of rows) {
    if (row.defaultExpanded) {
      defaultExpandedIds.push(row.id);
    }
  }
  return defaultExpandedIds;
}

function SettingsLocalAgentRowView({ row }: { row: SettingsLocalAgentRow }) {
  if (row.detail) {
    return (
      <AccordionItem
        className="w-full min-w-0"
        data-muted={row.muted ? "true" : undefined}
        data-testid={`settings-local-agent-row-${row.id}`}
        value={row.id}
      >
        <div
          className={cn(
            "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch",
            row.muted ? null : "hover:bg-muted/15"
          )}
        >
          <div
            className="w-full min-w-0"
            data-testid="settings-local-agent-row-trigger"
          >
            <AccordionTrigger
              aria-label={`${row.displayName} details`}
              className="h-full min-w-0 px-4 py-4"
            >
              <SettingsLocalAgentRowSummary row={row} />
            </AccordionTrigger>
          </div>
          <SettingsLocalAgentRowControl
            className="py-4 pr-4 pl-4"
            control={row.control}
          />
        </div>
        <AccordionContent>
          <div className="border-border/70 border-t px-4 py-3">
            {row.detail}
          </div>
        </AccordionContent>
      </AccordionItem>
    );
  }

  return (
    <div
      className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4"
      data-muted={row.muted ? "true" : undefined}
      data-testid={`settings-local-agent-row-${row.id}`}
    >
      <SettingsLocalAgentRowSummary row={row} />
      <SettingsLocalAgentRowControl control={row.control} />
    </div>
  );
}

function SettingsLocalAgentRowSummary({ row }: { row: SettingsLocalAgentRow }) {
  const summaryStatuses =
    row.summaryStatuses ?? (row.summaryStatus ? [row.summaryStatus] : []);
  const summaryItems: {
    content: ReactNode;
    className: string;
    key: string;
  }[] = summaryStatuses.map((status, index) => ({
    className: resolveLocalAgentSummaryStatusClassName(status.tone),
    content: status.label,
    key: `status-${index}`,
  }));
  if (row.summaryMeta) {
    summaryItems.push({
      className: "min-w-0 truncate text-muted-foreground",
      content: row.summaryMeta,
      key: "meta",
    });
  }

  return (
    <div className="flex min-w-0 flex-1 items-start gap-4">
      <SettingsLocalAgentIcon
        agentId={row.logoAgentId ?? row.id}
        muted={row.muted === true}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p
            className={cn(
              "truncate font-medium text-sm",
              row.muted ? "text-muted-foreground" : "text-foreground"
            )}
          >
            {row.displayName}
          </p>
          {row.badge}
          {summaryItems.length > 0 ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-xs">
              {summaryItems.map((item, index) => (
                <Fragment key={item.key}>
                  {index > 0 ? (
                    <span className="shrink-0 text-muted-foreground">·</span>
                  ) : null}
                  <span className={item.className}>{item.content}</span>
                </Fragment>
              ))}
            </span>
          ) : null}
          {row.summaryAccessory}
        </div>
        {row.description ? (
          <p
            className={cn(
              "text-xs leading-5",
              row.descriptionTone === "warning"
                ? resolveStatusToneSoftTextClassName("warning")
                : "text-muted-foreground"
            )}
          >
            {row.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function resolveLocalAgentSummaryStatusClassName(
  tone: SettingsLocalAgentRowSummaryStatus["tone"]
): string {
  return cn(
    "shrink-0 truncate font-medium",
    tone && tone !== "muted"
      ? resolveStatusToneStrongTextClassName(tone)
      : "text-muted-foreground"
  );
}

function SettingsLocalAgentRowControl({
  className,
  control,
}: {
  className?: string;
  control?: ReactNode;
}) {
  if (!control) {
    return null;
  }

  return (
    <div
      className={cn(
        "ml-auto flex shrink-0 items-center justify-end",
        className
      )}
      data-testid="settings-local-agent-row-control"
    >
      {control}
    </div>
  );
}

function SettingsLocalAgentIcon({
  agentId,
  muted,
}: {
  agentId: string;
  muted?: boolean;
}) {
  if (hasLocalAgentLogo(agentId)) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center text-foreground",
          muted ? "opacity-50" : null
        )}
      >
        <LocalAgentLogo
          agentId={agentId}
          className="h-7 w-7"
          size="md"
          variant="plain"
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 grid h-8 w-8 shrink-0 place-items-center text-muted-foreground",
        muted ? "opacity-50" : null
      )}
    >
      <RobotIcon className="h-4 w-4" />
    </span>
  );
}

function resolveStatusTextClassName(tone: SettingsComputerStatusTone): string {
  switch (tone) {
    case "connected":
      return resolveStatusToneSoftTextClassName("ready");
    case "checking":
      return resolveStatusToneSoftTextClassName("checking");
    case "warning":
      return resolveStatusToneSoftTextClassName("warning");
    case "danger":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function resolveStatusDotClassName(tone: SettingsComputerStatusTone): string {
  switch (tone) {
    case "connected":
      return resolveStatusToneIndicatorClassName("ready", "quiet");
    case "checking":
      return resolveStatusToneIndicatorClassName("checking", "quiet");
    case "warning":
      return resolveStatusToneIndicatorClassName("warning", "quiet");
    case "danger":
      return "bg-destructive";
    default:
      return "bg-muted-foreground";
  }
}
