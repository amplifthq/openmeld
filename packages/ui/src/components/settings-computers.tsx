import type { AgentControllerUsageLimits } from "@openmeld/schemas/types";
import {
  CaretRightIcon,
  DesktopTowerIcon,
  PlusIcon,
  PulseIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import { Fragment, type ReactNode, useRef, useState } from "react";
import { Badge } from "#components/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#components/dialog";
import { LocalAgentLogo } from "#components/local-agent-logo";
import { hasLocalAgentLogo } from "#components/local-agent-logo-utils";
import { SkeletonRows } from "#components/skeleton-content";
import {
  Tooltip,
  TooltipContent,
  TooltipHint,
  TooltipTrigger,
} from "#components/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#fluid/accordion";
import { FluidCardGroup, FluidCardItem } from "#fluid/card";
import { ScrollArea } from "#fluid/scroll-area";
import { Surface } from "#fluid/surface";
import {
  resolveStatusToneAdvisoryBadgeClassName,
  resolveStatusToneIndicatorClassName,
  resolveStatusToneSoftTextClassName,
  resolveStatusToneStrongTextClassName,
} from "#lib/status-tone";
import { cn } from "#lib/utils";

export type SettingsComputerLocalAgentIcon = {
  agentId: string;
  displayName: string;
  muted?: boolean;
};

export type SettingsComputerSummaryStatus = {
  label: string;
  localAgent?: SettingsComputerLocalAgentIcon;
  showLabel: boolean;
  tone: "checking" | "danger" | "muted" | "ready" | "warning";
};

const EMPTY_COMPUTER_LOCAL_AGENT_ICONS =
  [] as const satisfies readonly SettingsComputerLocalAgentIcon[];

export type SettingsComputerSummaryCardContentProps = {
  className?: string;
  icon?: ReactNode;
  lastSeenLabel: string;
  localAgents?: readonly SettingsComputerLocalAgentIcon[];
  localAgentsSummaryLabel?: string;
  name: string;
  platformLabel: string;
  recordBadgeLabel?: string | null;
  status: SettingsComputerSummaryStatus | null;
  statusIndicatorTestId?: string;
};

export function SettingsComputerSummaryCardContent({
  className,
  icon,
  lastSeenLabel,
  localAgents = EMPTY_COMPUTER_LOCAL_AGENT_ICONS,
  localAgentsSummaryLabel,
  name,
  platformLabel,
  recordBadgeLabel,
  status,
  statusIndicatorTestId,
}: SettingsComputerSummaryCardContentProps) {
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
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 max-w-full font-medium text-foreground text-sm max-sm:basis-full max-sm:break-words sm:truncate">
                {name}
              </span>
              {recordBadgeLabel ? (
                <Badge className="shrink-0" variant="secondary">
                  {recordBadgeLabel}
                </Badge>
              ) : null}
              {status ? (
                <span className="inline-flex max-w-full shrink-0 items-center gap-2 max-sm:shrink">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "status-dot",
                      resolveStatusToneIndicatorClassName(status.tone, "quiet")
                    )}
                    data-testid={statusIndicatorTestId}
                  />
                  {status.showLabel ? null : (
                    <span className="sr-only">{status.label}</span>
                  )}
                  {status.showLabel ? (
                    <span
                      className={cn(
                        "inline-flex min-w-0 items-center gap-1.5 font-medium text-xs",
                        resolveStatusToneStrongTextClassName(status.tone)
                      )}
                    >
                      {status.localAgent &&
                      hasLocalAgentLogo(status.localAgent.agentId) ? (
                        <LocalAgentLogo
                          agentId={status.localAgent.agentId}
                          size="xs"
                        />
                      ) : null}
                      {status.label}
                    </span>
                  ) : null}
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

export function SettingsAddComputerCardContent({
  description = "Set up OpenMeld Service and local agents.",
  descriptionClassName,
  iconContainerClassName,
  icon,
  title = "Add a Computer",
  titleAriaHidden,
  titleClassName,
}: {
  description?: ReactNode;
  descriptionClassName?: string;
  iconContainerClassName?: string;
  icon?: ReactNode;
  title?: string;
  titleAriaHidden?: boolean;
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
        {icon ?? <PlusIcon aria-hidden="true" className="size-5" />}
      </span>
      <span className="flex flex-col items-center gap-1">
        <span
          aria-hidden={titleAriaHidden}
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
  const supportedIcons = icons.filter((icon) =>
    hasLocalAgentLogo(icon.agentId)
  );
  const visibleIcons = supportedIcons.slice(0, 5);
  const hiddenIcons = supportedIcons.slice(5);
  if (supportedIcons.length === 0) {
    return summaryLabel ? (
      <span className="shrink-0 text-muted-foreground">{summaryLabel}</span>
    ) : null;
  }

  return (
    <span className="flex shrink-0 items-center justify-end gap-2">
      <span className="sr-only">
        {supportedIcons.map((icon) => icon.displayName).join(", ")}
        {" local agents"}
      </span>
      {visibleIcons.map((icon, index) => (
        <Tooltip key={icon.agentId}>
          <TooltipTrigger
            render={
              <span className="inline-flex size-5 items-center justify-center opacity-90 transition-opacity hover:opacity-100">
                <LocalAgentLogo
                  agentId={icon.agentId}
                  className={icon.muted ? "opacity-50 grayscale" : undefined}
                  size="sm"
                />
              </span>
            }
          />
          <TooltipContent side="top">
            {icon.displayName}
            {index === visibleIcons.length - 1 && hiddenIcons.length > 0
              ? ` · Also supports ${hiddenIcons
                  .map((hiddenIcon) => hiddenIcon.displayName)
                  .join(", ")}`
              : null}
          </TooltipContent>
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
                className={cn("status-dot", resolveStatusDotClassName(tone))}
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
  // `checking` is informational: the last known facts still stand while a
  // newer check is pending, so it neither alarms nor dims the agent identity.
  tone?: "checking" | "danger" | "muted" | "ready" | "warning";
};

export type SettingsLocalAgentRow = {
  advisory?: ReactNode;
  badge?: ReactNode;
  checkedAtLabel?: ReactNode;
  control?: ReactNode;
  defaultExpanded?: boolean;
  description?: string;
  descriptionTone?: "default" | "warning";
  detail?: ReactNode;
  displayName: string;
  id: string;
  identityMuted?: boolean;
  logoAgentId?: string;
  muted?: boolean;
  summaryAccessory?: ReactNode;
  summaryMeta?: ReactNode;
  summarySupplement?: ReactNode;
  summaryStatus?: SettingsLocalAgentRowSummaryStatus;
  summaryStatuses?: readonly SettingsLocalAgentRowSummaryStatus[];
};

/** A usage limit at or below this percent left reads as Low. */
export const LOW_CAPACITY_REMAINING_THRESHOLD_PERCENT = 20;
const US_USAGE_PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});
const US_USAGE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

type UsageLimitPresentation = {
  label:
    | "Available"
    | "Exhausted"
    | "Low"
    | "Stale"
    | "Unavailable"
    | "Unsupported";
  tone: "danger" | "muted" | "ready" | "warning";
};

type UsageLimitSummary = {
  accessibleDetails: string;
  limit: AgentControllerUsageLimits[number];
  presentation: UsageLimitPresentation;
  remainingPercent: number;
};

export function SettingsLocalAgentUsageSummary({
  agentName,
  limits,
  nowMs = Date.now(),
}: {
  agentName: string;
  limits?: AgentControllerUsageLimits;
  nowMs?: number;
}) {
  const providerGroups = groupProviderUsageLimits(limits);
  if (providerGroups) {
    const providerSummaries = providerGroups
      .map((group) => ({
        group,
        summary: resolveUsageLimitSummary(group.limits),
      }))
      .filter(
        (
          item
        ): item is typeof item & {
          summary: NonNullable<typeof item.summary>;
        } => item.summary !== null
      );
    if (providerSummaries.length === 0) {
      return null;
    }
    const visibleSummaries = providerSummaries.slice(0, 3);
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="inline-flex h-5 shrink-0 items-center gap-2 font-medium text-xs tabular-nums"
              data-testid="local-agent-usage-summary"
            >
              {visibleSummaries.map(({ group, summary }) => (
                <span
                  aria-label={`${group.displayName} usage, ${summary.accessibleDetails}`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={summary.remainingPercent}
                  aria-valuetext={`${formatRemainingPercent(summary.remainingPercent)} left`}
                  className="inline-flex items-center gap-1"
                  key={group.id}
                  role="progressbar"
                >
                  <UsageLimitRing
                    className="size-4"
                    remainingPercent={summary.remainingPercent}
                    tone={summary.presentation.tone}
                  />
                  <span>{group.displayName}</span>
                  <span>
                    {formatRemainingPercent(summary.remainingPercent)}
                  </span>
                </span>
              ))}
              {providerSummaries.length > visibleSummaries.length ? (
                <span>
                  +{providerSummaries.length - visibleSummaries.length}
                </span>
              ) : null}
            </span>
          }
        />
        <UsageTooltipContent>
          <span className="font-medium">{agentName}</span>
          <UsageLimitPreviewGrid limits={limits ?? []} nowMs={nowMs} />
        </UsageTooltipContent>
      </Tooltip>
    );
  }
  const summary = resolveUsageLimitSummary(limits);
  if (!summary) {
    return null;
  }
  const accessibleLabel = `${agentName} usage limits, ${summary.accessibleDetails}`;
  const remainingPercentLabel = formatRemainingPercent(
    summary.remainingPercent
  );
  const orderedLimits = orderUsageLimitsForDisplay({ agentName, limits });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={accessibleLabel}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={summary.remainingPercent}
            aria-valuetext={`${remainingPercentLabel} left`}
            className="inline-flex h-5 shrink-0 items-center gap-1 font-medium text-xs tabular-nums"
            data-testid="local-agent-usage-summary"
            role="progressbar"
          >
            <UsageLimitRing
              className="size-4"
              remainingPercent={summary.remainingPercent}
              tone={summary.presentation.tone}
            />
            <span>{remainingPercentLabel}</span>
          </span>
        }
      />
      <UsageTooltipContent>
        <span className="font-medium">{agentName}</span>
        {orderedLimits && orderedLimits.length > 0 ? (
          <UsageLimitPreviewGrid limits={orderedLimits} nowMs={nowMs} />
        ) : (
          <span className="text-muted-foreground">
            Not reported by provider yet.
          </span>
        )}
      </UsageTooltipContent>
    </Tooltip>
  );
}

export type LocalAgentUsageSource = {
  id: string;
  label: string;
  limits: AgentControllerUsageLimits;
};

export function hasLocalAgentUsage(sources: readonly LocalAgentUsageSource[]) {
  return sources.some(
    (source) => resolveUsageLimitSummary(source.limits) !== null
  );
}

/** A single controller logo with separate, source-labelled quota previews. */
export function SettingsLocalAgentUsageDockItem({
  agentName,
  children,
  sources,
  nowMs,
  stackOrder = 0,
}: {
  agentName: string;
  children: ReactNode;
  sources: readonly LocalAgentUsageSource[];
  nowMs: number;
  stackOrder?: number;
}) {
  const groups = sources.flatMap((source) =>
    (
      groupProviderUsageLimits(source.limits) ?? [
        { id: "default", displayName: agentName, limits: source.limits },
      ]
    ).map((group) => ({
      ...group,
      id: `${source.id}:${group.id}`,
      label: `${source.label} · ${group.displayName}`,
      summary: resolveUsageLimitSummary(group.limits),
    }))
  );
  const summaries = groups.filter((group) => group.summary !== null);
  const visible = summaries.slice(0, 1);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="relative inline-flex size-[27px] shrink-0 items-end hover:z-50!"
            data-testid={`local-agent-usage-dock-${agentName}`}
            style={{ zIndex: stackOrder }}
          />
        }
      >
        <span className="sr-only">{agentName}</span>
        {children}
        <span className="absolute top-0 right-0 flex -space-x-1.5">
          {visible.map(({ id, label, summary }) =>
            summary ? (
              <span
                aria-label={`${label} usage, ${summary.accessibleDetails}`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={summary.remainingPercent}
                aria-valuetext={`${formatRemainingPercent(summary.remainingPercent)} left`}
                className="relative"
                key={id}
                role="progressbar"
              >
                <UsageLimitRing
                  className="size-[13.5px] [&>circle:first-child]:fill-card"
                  remainingPercent={summary.remainingPercent}
                  strokeWidth={3}
                  tone={summary.presentation.tone}
                />
              </span>
            ) : null
          )}
        </span>
      </TooltipTrigger>
      <UsageTooltipContent>
        {sources.length === 0 && <span>{agentName}</span>}
        {sources.map((source) => (
          <span className="grid gap-3" key={source.id}>
            <span className="font-medium">
              {source.label} · {agentName}
            </span>
            <UsageLimitPreviewGrid
              limits={
                orderUsageLimitsForDisplay({
                  agentName,
                  limits: source.limits,
                }) ?? []
              }
              nowMs={nowMs}
            />
          </span>
        ))}
      </UsageTooltipContent>
    </Tooltip>
  );
}

function UsageTooltipContent({ children }: { children: ReactNode }) {
  return (
    <TooltipContent
      className="block w-96 max-w-[calc(100vw-2rem)] bg-popover p-0 text-popover-foreground shadow-md ring-1 ring-border"
      side="top"
      sideOffset={6}
    >
      <ScrollArea
        contentClassName="grid gap-4 p-3"
        scrollFade
        viewportClassName="max-h-[min(18rem,60vh)]"
      >
        {children}
      </ScrollArea>
    </TooltipContent>
  );
}

function UsageLimitPreviewGrid({
  limits,
  nowMs,
}: {
  limits: AgentControllerUsageLimits;
  nowMs: number;
}) {
  return (
    <span className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-start">
      {limits.map((limit) => (
        <UsageLimitPreview key={limit.key} limit={limit} nowMs={nowMs} />
      ))}
    </span>
  );
}

function UsageLimitPreview({
  limit,
  nowMs,
}: {
  limit: AgentControllerUsageLimits[number];
  nowMs: number;
}) {
  const presentation = resolveUsageLimitPresentation(limit);
  const remainingPercent = resolveRemainingPercent(limit.usedPercent);
  return (
    <span className="flex w-28 flex-col items-center gap-1.5 whitespace-normal text-center text-[10px] leading-snug">
      {remainingPercent === null ? (
        <span>{resolveMissingUsageCopy(limit)}</span>
      ) : (
        <span className="relative grid size-12 place-items-center">
          <UsageLimitRing
            className="absolute inset-0 size-full"
            remainingPercent={remainingPercent}
            strokeWidth={1.75}
            tone={presentation.tone}
          />
          <span className="flex flex-col items-center tabular-nums">
            <span className="font-medium text-xs">
              {formatRemainingPercent(remainingPercent)}
            </span>
            <span className="text-[8px] text-muted-foreground">left</span>
          </span>
        </span>
      )}
      {limit.provider && (
        <span className="font-medium">{limit.provider.displayName}</span>
      )}
      <span className="font-medium">{limit.label}</span>
      {presentation.label !== "Available" && (
        <span
          className={resolveStatusToneStrongTextClassName(presentation.tone)}
        >
          {presentation.label}
        </span>
      )}
      <span className="text-muted-foreground">
        {formatUsageLimitReset(limit.resetsAt, nowMs)}
      </span>
      {limit.status === "stale" && (
        <span className="text-muted-foreground">
          {formatRelativePastDuration(
            Math.max(0, nowMs - Date.parse(limit.observedAt))
          )}
        </span>
      )}
    </span>
  );
}

export function SettingsLocalAgentUsageLimits({
  agentName,
  limits,
  nowMs = Date.now(),
  fillColumns = false,
  compact = false,
}: {
  agentName: string;
  limits?: AgentControllerUsageLimits;
  nowMs?: number;
  /**
   * When true, one or two usage windows fill the available row. Three or more
   * use a responsive grid that wraps before the labels become cramped.
   */
  fillColumns?: boolean;
  compact?: boolean;
}) {
  if (limits === undefined) {
    return null;
  }
  const orderedLimits = orderUsageLimitsForDisplay({ agentName, limits });
  if (compact && orderedLimits?.length) {
    return <UsageLimitPreviewGrid limits={orderedLimits} nowMs={nowMs} />;
  }
  const providerGroups = groupProviderUsageLimits(orderedLimits);
  let usageContent: ReactNode;
  if (providerGroups) {
    const reportedProviderGroups = providerGroups.filter((group) =>
      group.limits.some((limit) => limit.usedPercent !== null)
    );
    const unreportedProviderGroups = providerGroups.filter((group) =>
      group.limits.every((limit) => limit.usedPercent === null)
    );
    usageContent = (
      <div className="space-y-7" data-testid="local-agent-usage-provider-grid">
        {reportedProviderGroups.map((group) => (
          <section
            aria-label={`${group.displayName} usage limits`}
            className="space-y-3"
            key={group.id}
          >
            <h5 className="font-medium text-sm">{group.displayName}</h5>
            <SettingsLocalAgentUsageLimitCollection
              agentName={`${agentName} ${group.displayName}`}
              fillColumns={fillColumns}
              limits={group.limits}
              nowMs={nowMs}
            />
          </section>
        ))}
        <SettingsLocalAgentUnreportedProviders
          groups={unreportedProviderGroups}
        />
      </div>
    );
  } else if (orderedLimits && orderedLimits.length > 0) {
    usageContent = (
      <SettingsLocalAgentUsageLimitCollection
        agentName={agentName}
        fillColumns={fillColumns}
        limits={orderedLimits}
        nowMs={nowMs}
      />
    );
  } else {
    usageContent = (
      <p className="text-muted-foreground text-xs leading-5">
        Usage not reported yet.
      </p>
    );
  }

  return (
    <section aria-label={`${agentName} usage limits`} className="space-y-2.5">
      <div>
        <h4 className="font-medium text-sm">Usage limits</h4>
        <p className="mt-0.5 text-muted-foreground text-xs leading-5">
          Limits reported by your signed-in accounts. Availability varies by
          provider and sign-in method.
        </p>
      </div>
      {usageContent}
    </section>
  );
}

type ProviderUsageLimitGroup = {
  displayName: string;
  id: string;
  limits: AgentControllerUsageLimits;
};

function groupProviderUsageLimits(
  limits?: AgentControllerUsageLimits
): ProviderUsageLimitGroup[] | null {
  if (!(limits?.length && limits.every((limit) => limit.provider))) {
    return null;
  }
  const groups = new Map<string, ProviderUsageLimitGroup>();
  for (const limit of limits) {
    const provider = limit.provider;
    if (!provider) {
      continue;
    }
    const group = groups.get(provider.id);
    if (group) {
      group.limits.push(limit);
      continue;
    }
    groups.set(provider.id, {
      displayName: provider.displayName,
      id: provider.id,
      limits: [limit],
    });
  }
  return [...groups.values()];
}

function SettingsLocalAgentUsageLimitCollection({
  agentName,
  fillColumns,
  limits,
  nowMs,
}: {
  agentName: string;
  fillColumns: boolean;
  limits: AgentControllerUsageLimits;
  nowMs: number;
}) {
  const quantifiedLimits = limits.filter((limit) => limit.usedPercent !== null);
  const unreportedLimits = limits.filter((limit) => limit.usedPercent === null);
  return (
    <div className="space-y-4">
      {quantifiedLimits.length > 0 ? (
        <div
          className={cn(
            "grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3",
            fillColumns &&
              quantifiedLimits.length === 1 &&
              "grid-cols-1 sm:grid-cols-1",
            fillColumns && quantifiedLimits.length === 2 && "sm:grid-cols-2"
          )}
          data-testid="local-agent-usage-limit-grid"
        >
          {quantifiedLimits.map((limit) => (
            <SettingsLocalAgentUsageLimitGauge
              agentName={agentName}
              key={limit.key}
              limit={limit}
              nowMs={nowMs}
            />
          ))}
        </div>
      ) : null}
      <SettingsLocalAgentUnreportedLimits limits={unreportedLimits} />
    </div>
  );
}

function SettingsLocalAgentUnreportedLimits({
  limits,
}: {
  limits: AgentControllerUsageLimits;
}) {
  if (limits.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1 text-xs leading-5">
      {limits.map((limit) => {
        const presentation = resolveUsageLimitPresentation(limit);
        return (
          <p
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
            key={limit.key}
          >
            <span className="font-medium">{limit.label}</span>
            <span
              className={resolveStatusToneSoftTextClassName(presentation.tone)}
            >
              {resolveMissingUsageStatusLabel(presentation.label, limit.reason)}
            </span>
          </p>
        );
      })}
    </div>
  );
}

function SettingsLocalAgentUnreportedProviders({
  groups,
}: {
  groups: readonly ProviderUsageLimitGroup[];
}) {
  const rows = new Map<string, string[]>();
  for (const group of groups) {
    const firstLimit = group.limits[0];
    if (!firstLimit) {
      continue;
    }
    const label = resolveMissingUsageStatusLabel(
      resolveUsageLimitPresentation(firstLimit).label,
      firstLimit.reason
    );
    const providerNames = rows.get(label);
    if (providerNames) {
      providerNames.push(group.displayName);
    } else {
      rows.set(label, [group.displayName]);
    }
  }
  if (rows.size === 0) {
    return null;
  }
  return (
    <div
      className="space-y-1 text-muted-foreground text-xs leading-5"
      data-testid="local-agent-usage-unreported"
    >
      {[...rows].map(([label, providerNames]) => (
        <p className="flex flex-wrap items-baseline gap-x-2" key={label}>
          <span className="font-medium">{label}</span>
          <span>{providerNames.join(", ")}</span>
        </p>
      ))}
    </div>
  );
}

/** Body-only dashboard content, sharing the existing quota policy and donut. */
export function SettingsLocalAgentUsageReadout({
  agentName,
  limits,
  nowMs = Date.now(),
}: {
  agentName: string;
  limits: AgentControllerUsageLimits;
  nowMs?: number;
}) {
  const ordered = orderUsageLimitsForDisplay({ agentName, limits }) ?? [];
  const quantified = ordered.filter((limit) => limit.usedPercent !== null);
  const summary = resolveUsageLimitSummary(quantified);
  const collapsed = quantified.length > 2 && summary !== null;
  const visible = collapsed ? [summary.limit] : quantified;
  const remaining = collapsed
    ? quantified.filter((limit) => limit !== summary.limit)
    : [];
  const unreported = ordered.filter((limit) => limit.usedPercent === null);
  if (ordered.length === 0) {
    return (
      <p className="text-muted-foreground text-xs leading-5">
        Usage not reported yet.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {visible.map((limit) => (
        <SettingsLocalAgentUsageLimitGauge
          agentName={agentName}
          key={`${limit.provider?.id ?? "default"}/${limit.key}`}
          layout="card"
          limit={limit}
          nowMs={nowMs}
        />
      ))}
      {remaining.some((limit) => limit.status === "stale") ? (
        <p className="text-muted-foreground text-xs">Includes stale reports</p>
      ) : null}
      {remaining.length > 0 ? (
        <details className="group/usage-details">
          <summary className="cursor-pointer rounded-sm text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            View all {quantified.length} usage windows
          </summary>
          <div className="mt-3 space-y-3">
            {remaining.map((limit) => (
              <SettingsLocalAgentUsageLimitGauge
                agentName={agentName}
                key={`${limit.provider?.id ?? "default"}/${limit.key}`}
                layout="card"
                limit={limit}
                nowMs={nowMs}
              />
            ))}
          </div>
        </details>
      ) : null}
      {unreported.map((limit) => (
        <div
          className="space-y-1 text-xs leading-5"
          key={`${limit.provider?.id ?? "default"}/${limit.key}`}
        >
          <p className="font-medium">
            {[limit.provider?.displayName, limit.label]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-muted-foreground">
            {resolveMissingUsageStatusLabel(
              resolveUsageLimitPresentation(limit).label
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * One-line card readout: the most constrained window with its percent left,
 * one muted line (status only when not Available, then the reset), and every
 * window in the tooltip.
 */
export function SettingsLocalAgentUsageCompactReadout({
  agentName,
  limits,
  nowMs = Date.now(),
}: {
  agentName: string;
  limits: AgentControllerUsageLimits;
  nowMs?: number;
}) {
  const ordered = orderUsageLimitsForDisplay({ agentName, limits }) ?? [];
  const summary = resolveUsageLimitSummary(ordered);
  if (!summary) {
    return (
      <p className="text-muted-foreground text-xs leading-5">
        Usage not reported yet.
      </p>
    );
  }
  const { limit, presentation, remainingPercent } = summary;
  const remainingLabel = `${formatRemainingPercent(remainingPercent)} left`;
  const resetLabel = formatUsageLimitReset(limit.resetsAt, nowMs);
  const otherCount = ordered.length - 1;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className="flex min-w-0 items-center gap-2"
            data-testid="local-agent-usage-compact"
          >
            <meter
              aria-label={`${agentName} ${limit.label}, ${remainingLabel}, ${presentation.label}, ${resetLabel}`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={remainingPercent}
              aria-valuetext={remainingLabel}
              className="sr-only"
              max={100}
              min={0}
              value={remainingPercent}
            />
            <UsageLimitRing
              className="size-5 shrink-0"
              remainingPercent={remainingPercent}
              tone={presentation.tone}
            />
            <div className="min-w-0">
              <p className="truncate font-medium text-sm leading-5">
                <span className="tabular-nums">{remainingLabel}</span>
                <span className="text-muted-foreground"> · {limit.label}</span>
              </p>
              <p className="truncate text-muted-foreground text-xs leading-5">
                {presentation.label === "Available" ? null : (
                  <span
                    className={cn(
                      "font-medium",
                      resolveStatusToneSoftTextClassName(presentation.tone)
                    )}
                  >
                    {presentation.label} ·{" "}
                  </span>
                )}
                {resetLabel}
                {otherCount > 0 ? ` · +${otherCount} more` : null}
              </p>
            </div>
          </div>
        }
      />
      <UsageTooltipContent>
        <span className="font-medium">{agentName}</span>
        <UsageLimitPreviewGrid limits={ordered} nowMs={nowMs} />
      </UsageTooltipContent>
    </Tooltip>
  );
}

function SettingsLocalAgentUsageLimitGauge({
  agentName,
  layout = "gauge",
  limit,
  nowMs,
}: {
  agentName: string;
  layout?: "gauge" | "card";
  limit: AgentControllerUsageLimits[number];
  nowMs: number;
}) {
  const presentation = resolveUsageLimitPresentation(limit);
  const remainingPercent = resolveRemainingPercent(limit.usedPercent);
  const resetLabel = formatUsageLimitReset(limit.resetsAt, nowMs);
  const observedLabel = formatUsageLimitObservation({
    nowMs,
    observedAt: limit.observedAt,
    stale: limit.status === "stale",
  });
  const accessibleLabel = [
    [
      agentName,
      layout === "card" ? limit.provider?.displayName : null,
      limit.label,
    ]
      .filter(Boolean)
      .join(" "),
    remainingPercent === null
      ? null
      : `${formatRemainingPercent(remainingPercent)} left`,
    presentation.label,
    resetLabel,
    observedLabel,
  ]
    .filter(Boolean)
    .join(", ");

  if (remainingPercent === null) {
    return null;
  }

  return (
    <div
      className={
        layout === "card"
          ? "grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1"
          : "grid min-w-0 justify-items-center gap-2 text-center"
      }
    >
      <p
        className={cn(
          "font-medium text-sm leading-5",
          layout === "card" && "col-start-2 row-start-1 break-words"
        )}
      >
        {layout === "card" && limit.provider ? (
          <span className="block text-muted-foreground text-xs">
            {limit.provider.displayName}
          </span>
        ) : null}
        {limit.label}
      </p>
      <UsageLimitGaugeFrame
        label={accessibleLabel}
        layout={layout}
        remainingPercent={remainingPercent}
      >
        <UsageLimitRing
          className="absolute inset-0 size-full"
          remainingPercent={remainingPercent}
          strokeWidth={2}
          tone={presentation.tone}
        />
        <span className="flex flex-col items-center font-medium tabular-nums leading-none">
          <span className="text-sm" data-usage-limit-value>
            {formatRemainingPercent(remainingPercent)}
          </span>
          <span
            className="mt-1 text-[9px] text-muted-foreground"
            data-usage-limit-unit
          >
            left
          </span>
        </span>
      </UsageLimitGaugeFrame>
      {layout !== "card" || presentation.label !== "Available" ? (
        <span
          className={cn(
            "font-medium text-xs",
            layout === "card" && "col-start-2",
            resolveStatusToneSoftTextClassName(presentation.tone)
          )}
        >
          {presentation.label}
        </span>
      ) : null}
      <p
        className={cn(
          "flex text-muted-foreground text-xs leading-5",
          layout === "card"
            ? "col-start-2 flex-col"
            : "flex-wrap justify-center gap-x-1"
        )}
      >
        <UsageLimitTime dateTime={limit.resetsAt} label={resetLabel} />
        {layout === "card" ? null : <span aria-hidden="true">·</span>}
        <UsageLimitTime dateTime={limit.observedAt} label={observedLabel} />
      </p>
    </div>
  );
}

function UsageLimitGaugeFrame({
  label,
  layout,
  remainingPercent,
  children,
}: {
  label: string;
  layout: "gauge" | "card";
  remainingPercent: number;
  children: ReactNode;
}) {
  const attributes = {
    "aria-label": label,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": remainingPercent,
    "aria-valuetext": `${formatRemainingPercent(remainingPercent)} left`,
  };
  return layout === "card" ? (
    <div className="relative col-start-1 row-span-3 row-start-1 grid size-16 place-items-center">
      <meter
        {...attributes}
        className="sr-only"
        max={100}
        min={0}
        value={remainingPercent}
      />
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  ) : (
    <div
      {...attributes}
      className="relative grid size-18 place-items-center"
      role="progressbar"
    >
      {children}
    </div>
  );
}

function UsageLimitRing({
  className,
  remainingPercent,
  strokeWidth = 2.5,
  tone,
}: {
  className?: string;
  remainingPercent: number;
  strokeWidth?: number;
  tone: UsageLimitPresentation["tone"];
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn(
        "-rotate-90",
        resolveStatusToneStrongTextClassName(tone),
        className
      )}
      viewBox="0 0 20 20"
    >
      <circle
        className="text-muted-foreground/20"
        cx="10"
        cy="10"
        fill="none"
        r="7.5"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      <circle
        cx="10"
        cy="10"
        fill="none"
        pathLength="100"
        r="7.5"
        stroke="currentColor"
        strokeDasharray={`${remainingPercent} 100`}
        strokeLinecap="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}

function orderUsageLimitsForDisplay(input: {
  agentName: string;
  limits?: AgentControllerUsageLimits;
}): AgentControllerUsageLimits | undefined {
  if (
    input.agentName.trim().toLocaleLowerCase("en-US") !== "codex" ||
    !input.limits?.some(isCodexOverallWeeklyUsageLimit)
  ) {
    return input.limits;
  }
  return input.limits.toSorted(
    (left, right) =>
      Number(isCodexOverallWeeklyUsageLimit(right)) -
      Number(isCodexOverallWeeklyUsageLimit(left))
  );
}

function isCodexOverallWeeklyUsageLimit(
  limit: AgentControllerUsageLimits[number]
): boolean {
  return limit.label.trim().toLocaleLowerCase("en-US") === "weekly usage";
}

function UsageLimitTime({
  dateTime,
  label,
}: {
  dateTime: string | null;
  label: string;
}) {
  return dateTime ? (
    <TooltipHint content={formatExactUsageLimitTime(dateTime)}>
      <time dateTime={dateTime}>{label}</time>
    </TooltipHint>
  ) : (
    <span>{label}</span>
  );
}

function resolveUsageLimitPresentation(
  limit: AgentControllerUsageLimits[number]
): UsageLimitPresentation {
  if (limit.status === "exhausted") {
    return { label: "Exhausted", tone: "danger" };
  }
  if (limit.status === "stale") {
    return { label: "Stale", tone: "warning" };
  }
  if (limit.status === "unavailable") {
    return { label: "Unavailable", tone: "muted" };
  }
  if (limit.status === "unsupported") {
    return { label: "Unsupported", tone: "muted" };
  }
  const remainingPercent = resolveRemainingPercent(limit.usedPercent);
  if (
    remainingPercent !== null &&
    remainingPercent <= LOW_CAPACITY_REMAINING_THRESHOLD_PERCENT
  ) {
    return { label: "Low", tone: "warning" };
  }
  return { label: "Available", tone: "ready" };
}

function resolveUsageLimitSummary(
  limits?: AgentControllerUsageLimits
): UsageLimitSummary | null {
  const quantifiedLimits = (limits ?? []).filter(
    (limit) => limit.usedPercent !== null
  );
  const [firstLimit, ...remainingLimits] = quantifiedLimits;
  if (!firstLimit) {
    return null;
  }

  let selectedLimit = firstLimit;
  let selectedPresentation = resolveUsageLimitPresentation(selectedLimit);
  for (const limit of remainingLimits) {
    const presentation = resolveUsageLimitPresentation(limit);
    const selectedPriority = resolveUsageLimitSummaryPriority(
      selectedPresentation.label
    );
    const priority = resolveUsageLimitSummaryPriority(presentation.label);
    if (
      priority > selectedPriority ||
      (priority === selectedPriority &&
        (limit.usedPercent ?? -1) > (selectedLimit.usedPercent ?? -1))
    ) {
      selectedLimit = limit;
      selectedPresentation = presentation;
    }
  }

  const remainingPercent = resolveRemainingPercent(selectedLimit.usedPercent);
  if (remainingPercent === null) {
    return null;
  }

  return {
    accessibleDetails: `${formatRemainingPercent(remainingPercent)} left, ${selectedPresentation.label}`,
    limit: selectedLimit,
    presentation: selectedPresentation,
    remainingPercent,
  };
}

function resolveUsageLimitSummaryPriority(
  label: UsageLimitPresentation["label"]
): number {
  switch (label) {
    case "Exhausted":
      return 6;
    case "Stale":
      return 5;
    case "Low":
      return 4;
    case "Unavailable":
      return 3;
    case "Unsupported":
      return 2;
    default:
      return 1;
  }
}

function resolveMissingUsageCopy(
  limit: AgentControllerUsageLimits[number]
): string {
  if (limit.reason) {
    return resolveMissingUsageStatusLabel("Unavailable", limit.reason);
  }
  if (limit.status === "unsupported") {
    return "Not reported by provider.";
  }
  if (limit.status === "unavailable") {
    return "Usage not reported.";
  }
  return "Usage percentage not reported.";
}

function resolveMissingUsageStatusLabel(
  label: UsageLimitPresentation["label"],
  reason?: AgentControllerUsageLimits[number]["reason"]
): string {
  if (reason) {
    return {
      not_applicable: "Usage unavailable for this account",
      not_authenticated: "Sign in to view usage",
      not_reported: "Usage not reported",
      refresh_failed: "Could not refresh usage",
    }[reason];
  }
  if (label === "Stale") {
    return "Stale usage report";
  }
  if (label === "Exhausted") {
    return "Usage exhausted";
  }
  if (label === "Unsupported") {
    return "Usage not supported";
  }
  if (label === "Unavailable") {
    return "Usage not reported";
  }
  return "Usage not reported";
}

function formatRemainingPercent(value: number): string {
  return `${US_USAGE_PERCENT_FORMATTER.format(value)}%`;
}

function resolveRemainingPercent(usedPercent: number | null): number | null {
  if (usedPercent === null) {
    return null;
  }
  const remainingPercent = Math.round((100 - usedPercent) * 10) / 10;
  return Math.max(0, Math.min(100, remainingPercent));
}

function formatUsageLimitReset(resetsAt: string | null, nowMs: number): string {
  if (!resetsAt) {
    return "Reset time not reported";
  }
  const resetAtMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetAtMs)) {
    return "Reset time not reported";
  }
  const remainingMs = resetAtMs - nowMs;
  if (remainingMs <= 0) {
    return "Reset time passed";
  }
  return `Resets ${formatRelativeFutureDuration(remainingMs)}`;
}

function formatUsageLimitObservation(input: {
  nowMs: number;
  observedAt: string;
  stale: boolean;
}): string {
  const observedAtMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedAtMs)) {
    return input.stale
      ? "Last updated time unavailable"
      : "Updated time unavailable";
  }
  const elapsedMs = Math.max(0, input.nowMs - observedAtMs);
  const prefix = input.stale ? "Last updated" : "Updated";
  return `${prefix} ${formatRelativePastDuration(elapsedMs)}`;
}

function formatRelativeFutureDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes < 1) {
    return "in less than a minute";
  }
  if (minutes < 60) {
    return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const days = Math.floor(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

function formatRelativePastDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function formatExactUsageLimitTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : US_USAGE_TIME_FORMATTER.format(date);
}

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
  const tooltipContent = updateCommand
    ? `${detail} Open Details to copy the update command and see how to run it.`
    : `${detail} Use the same installer or package manager you used to install this local agent.`;

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
  loading?: boolean;
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
  loading = false,
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
        {rows.length === 0 && loading && !error ? (
          <SkeletonRows label="Loading local agents" />
        ) : null}
        {rows.length === 0 && !loading && !error ? (
          <p className="text-muted-foreground text-sm">{emptyMessage}</p>
        ) : null}
        {rows.length > 0 ? <SettingsLocalAgentRows rows={rows} /> : null}
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

export function SettingsLocalAgentCardGrid({
  className,
  rows,
}: {
  className?: string;
  rows: readonly SettingsLocalAgentRow[];
}) {
  return (
    <FluidCardGroup
      className={cn("grid gap-3 lg:grid-cols-2", className)}
      role="list"
    >
      {rows.map((row) => (
        <Surface key={row.id} role="listitem">
          <SettingsLocalAgentCard row={row} />
        </Surface>
      ))}
    </FluidCardGroup>
  );
}

function resolveLocalAgentCardStatus(
  row: SettingsLocalAgentRow
): SettingsLocalAgentRowSummaryStatus {
  const statuses =
    row.summaryStatuses ?? (row.summaryStatus ? [row.summaryStatus] : []);
  const [status] = statuses;
  if (status) {
    return status;
  }
  return row.muted
    ? { label: "Off", tone: "muted" }
    : { label: "Ready", tone: "ready" };
}

function SettingsLocalAgentCard({ row }: { row: SettingsLocalAgentRow }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Dismissing the dialog (overlay click or close button) removes the popup
  // on pointerdown, so the same click then lands on this card and would
  // instantly reopen the dialog. Remember when the dialog closed and ignore
  // that click-through.
  const closedAtRef = useRef(0);
  const status = resolveLocalAgentCardStatus(row);
  const identityMuted = row.identityMuted || status.tone === "muted";
  const hasDialog = Boolean(row.detail || row.description);
  const openDetails = () => {
    if (Date.now() - closedAtRef.current < 300) {
      return;
    }
    setDetailsOpen(true);
  };

  return (
    <FluidCardItem
      className={cn("rounded-md bg-transparent", hasDialog && "cursor-pointer")}
      data-muted={row.muted ? "true" : undefined}
      data-testid={`settings-local-agent-row-${row.id}`}
      itemId={row.id}
      onClick={hasDialog ? openDetails : undefined}
    >
      <div className="flex min-w-0 gap-4 px-5 pt-5 pb-4">
        {/* The quiet account states (Off, Not signed in) are the only ones that
            dim the card; a stale service snapshot still shows full-color
            content because the switch and the reported status stay real. */}
        <div
          className="flex min-w-0 flex-1 flex-col gap-2.5"
          data-testid="settings-local-agent-row-trigger"
        >
          <div className="flex items-center">
            <SettingsLocalAgentIcon
              agentId={row.logoAgentId ?? row.id}
              muted={identityMuted}
              size="lg"
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <p
              className={cn(
                "font-medium text-sm",
                identityMuted ? "text-muted-foreground" : "text-foreground"
              )}
            >
              {row.displayName}
            </p>
            <span
              aria-hidden="true"
              className={cn(
                "status-dot",
                resolveStatusToneIndicatorClassName(status.tone ?? "muted")
              )}
              data-testid={`settings-local-agent-status-dot-${row.id}`}
            />
            <span
              className={cn(
                "shrink-0 font-medium text-sm",
                resolveLocalAgentSummaryStatusClassName(status.tone)
              )}
            >
              {status.label}
            </span>
            {row.summaryAccessory}
            {row.summarySupplement}
          </div>
          {row.summaryMeta ? (
            <p className="truncate text-muted-foreground text-xs">
              {row.summaryMeta}
            </p>
          ) : null}
        </div>
        {row.advisory ? (
          <div className="absolute top-3.5 right-4 flex justify-end">
            {row.advisory}
          </div>
        ) : null}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the wrapper shields the switch from the card's open-dialog click; the switch keeps its own semantics. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: same shielding purpose; no interactive role is added. */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only shield; the switch inside is keyboard accessible on its own. */}
        <div
          className="flex shrink-0 items-center"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <SettingsLocalAgentRowControl control={row.control} />
        </div>
      </div>
      {hasDialog || row.checkedAtLabel ? (
        <div
          className="flex min-h-5 items-center justify-between gap-3 px-5 pb-3.5"
          data-testid="settings-local-agent-footer"
        >
          <span className="min-w-0 truncate text-muted-foreground text-xs">
            {row.checkedAtLabel}
          </span>
          {hasDialog ? (
            <button
              aria-label={`${row.displayName} details`}
              className="inline-flex items-center gap-0.5 rounded-sm text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              data-testid="settings-local-agent-more-button"
              onClick={(event) => {
                event.stopPropagation();
                openDetails();
              }}
              type="button"
            >
              Details
              <CaretRightIcon aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      <SettingsLocalAgentDetailsDialog
        onOpenChange={(open) => {
          if (!open) {
            closedAtRef.current = Date.now();
          }
          setDetailsOpen(open);
        }}
        open={detailsOpen}
        row={row}
        status={status}
      />
    </FluidCardItem>
  );
}

function SettingsLocalAgentDetailsDialog({
  onOpenChange,
  open,
  row,
  status,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  row: SettingsLocalAgentRow;
  status: SettingsLocalAgentRowSummaryStatus;
}) {
  if (!(row.detail || row.description)) {
    return null;
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100dvh-6rem)] sm:max-w-2xl">
        <DialogHeader className="min-w-0 pr-8">
          <div className="flex min-w-0 items-center gap-3">
            <SettingsLocalAgentIcon
              agentId={row.logoAgentId ?? row.id}
              muted={status.tone === "muted"}
              size="lg"
            />
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <DialogTitle className="min-w-0 break-words font-medium text-base">
                  {row.displayName}
                </DialogTitle>
                <p className="flex shrink-0 items-center gap-1.5 font-medium text-xs">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "status-dot",
                      resolveStatusToneIndicatorClassName(
                        status.tone ?? "muted"
                      )
                    )}
                  />
                  <span
                    className={cn(
                      resolveLocalAgentSummaryStatusClassName(status.tone)
                    )}
                  >
                    {status.label}
                  </span>
                </p>
              </div>
              {row.description ? (
                <DialogDescription>{row.description}</DialogDescription>
              ) : null}
              {row.checkedAtLabel ? (
                <p className="text-muted-foreground text-xs">
                  {row.checkedAtLabel}
                </p>
              ) : null}
            </div>
          </div>
        </DialogHeader>
        {row.detail ? (
          <div className="border-border/70 border-t pt-3">{row.detail}</div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SettingsLocalAgentIcon({
  agentId,
  muted,
  size = "default",
}: {
  agentId: string;
  muted?: boolean;
  size?: "default" | "lg";
}) {
  if (size === "lg") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "grid size-10 shrink-0 place-items-center",
          muted ? "text-muted-foreground opacity-50" : "text-foreground"
        )}
      >
        <LocalAgentLogo
          agentId={agentId}
          className="size-10"
          size="md"
          variant="plain"
        />
      </span>
    );
  }
  if (hasLocalAgentLogo(agentId)) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center",
          muted ? "text-muted-foreground opacity-50" : "text-foreground"
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
